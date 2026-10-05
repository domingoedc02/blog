import { generateHTML } from '@tiptap/html';
import { codeToHtml } from 'shiki';

import { sanitizeContentHtml } from '@/lib/content/sanitize';
import {
  ALLOWED_CODE_BLOCK_LANGUAGES,
  ALLOWED_HEADING_LEVELS,
  ALLOWED_LINK_SCHEMES,
  ALLOWED_MARK_TYPES,
  ALLOWED_NODE_TYPES,
  DEFAULT_CODE_BLOCK_LANGUAGE,
  MARK_ATTRIBUTE_ALLOWLIST,
  NODE_ATTRIBUTE_ALLOWLIST,
  contentExtensions,
  extractScheme,
  type AllowedHeadingLevel,
  type AllowedMarkType,
  type AllowedNodeType,
  type ContentJson,
  type ContentMark,
  type ContentNode,
} from '@/lib/content/schema';
import { isAllowedImageSrc } from '@/lib/content/validate';

export interface RenderContentOptions {
  /** Same meaning as {@link import("./validate").ValidateContentOptions.allowedImageOrigin}. */
  allowedImageOrigin: string;
}

/**
 * Shiki theme for highlighted code blocks. Not fixed anywhere in team
 * memory — a reasonable single-theme default, consistent with
 * decision/content-format's "pre-rendered server-side" inline-style
 * approach (spec/security's CSP `style-src 'unsafe-inline'` carve-out
 * exists for exactly this). BLOG-24/BLOG-15 (dark mode) may want a
 * dual light/dark theme later; flagging rather than deciding that here.
 */
const SHIKI_THEME = 'github-dark';

/**
 * The render path's enforcement point (BLOG-14). Unlike
 * {@link import("./validate").validatePostContent} (write path, throws on
 * the first violation), this NEVER throws on a malformed/legacy payload —
 * a stored row written before a schema tightening, or one that somehow
 * bypassed write-time validation, must still render as a safe page, not
 * 500 the request. It:
 *
 * 1. Re-validates/sanitises the JSON leniently (strips/normalises
 *    anything disallowed instead of rejecting the whole document).
 * 2. Serializes to HTML via TipTap's `generateHTML` (schema.ts's own
 *    extension set — a second, structural line of defence).
 * 3. Runs the result through `sanitize-html`'s allow-list
 *    (sanitize.ts) — defence-in-depth against a schema bug or a row
 *    written outside the normal API path.
 * 4. Highlights code blocks with Shiki, applied AFTER step 3 so Shiki's
 *    own trusted inline-style output is never subject to (and never
 *    needs allow-listing in) the user-content sanitiser.
 */
export async function renderPostContent(
  json: unknown,
  options: RenderContentOptions,
): Promise<string> {
  const safeJson = sanitizeContentJson(json, options);

  let rawHtml: string;
  try {
    rawHtml = generateHTML(safeJson, contentExtensions);
  } catch {
    // Stripping down to the allow-list still produced a document ProseMirror's
    // own content model rejects (e.g. a blockquote left with no children once
    // its only child was dropped) — fail safe to the plain text rather than 500.
    rawHtml = `<p>${escapeHtml(extractPlainText(safeJson))}</p>`;
  }

  const sanitized = sanitizeContentHtml(rawHtml);
  return highlightCodeBlocks(sanitized, collectCodeBlocks(safeJson));
}

/**
 * The lenient twin of validate.ts's walker: same allow-list, but strips/
 * normalises instead of throwing, so a legacy or tampered row degrades to
 * "whatever of it was safe" instead of failing the whole render.
 */
export function sanitizeContentJson(json: unknown, options: RenderContentOptions): ContentJson {
  if (typeof json !== 'object' || json === null || Array.isArray(json)) {
    return { type: 'doc', content: [] };
  }
  const node = sanitizeNode(json as Record<string, unknown>, options);
  if (!node || node.type !== 'doc') {
    return { type: 'doc', content: [] };
  }
  return node as ContentJson;
}

function sanitizeNode(
  raw: Record<string, unknown>,
  options: RenderContentOptions,
): ContentNode | null {
  const type = raw.type;
  if (typeof type !== 'string' || !ALLOWED_NODE_TYPES.includes(type as AllowedNodeType)) {
    return null; // Unknown/disallowed node type: drop it, don't try to guess what it meant.
  }
  const nodeType = type as AllowedNodeType;

  const attrs = sanitizeAttrs(raw.attrs, NODE_ATTRIBUTE_ALLOWLIST[nodeType]);
  const node: ContentNode = { type: nodeType };

  if (nodeType === 'heading') {
    const level = attrs?.level;
    const clamped: AllowedHeadingLevel =
      typeof level === 'number' && ALLOWED_HEADING_LEVELS.includes(level as AllowedHeadingLevel)
        ? (level as AllowedHeadingLevel)
        : 2;
    node.attrs = { ...attrs, level: clamped };
  } else if (nodeType === 'image') {
    const src = attrs?.src;
    if (typeof src !== 'string' || !isAllowedImageSrc(src, options.allowedImageOrigin)) {
      return null; // No safe fallback for an image with a bad src — drop it.
    }
    node.attrs = { ...attrs };
  } else if (nodeType === 'codeBlock') {
    const language = attrs?.language;
    const normalized =
      typeof language === 'string' &&
      ALLOWED_CODE_BLOCK_LANGUAGES.includes(
        language as (typeof ALLOWED_CODE_BLOCK_LANGUAGES)[number],
      )
        ? language
        : DEFAULT_CODE_BLOCK_LANGUAGE;
    node.attrs = { ...attrs, language: normalized };
  } else if (attrs) {
    node.attrs = attrs;
  }

  if (typeof raw.text === 'string') {
    node.text = raw.text;
  }

  if (Array.isArray(raw.marks)) {
    const marks = raw.marks
      .map((mark) => sanitizeMark(mark))
      .filter((mark): mark is ContentMark => mark !== null);
    if (marks.length > 0) {
      node.marks = marks;
    }
  }

  if (Array.isArray(raw.content)) {
    const content = raw.content
      .map((child) =>
        typeof child === 'object' && child !== null && !Array.isArray(child)
          ? sanitizeNode(child as Record<string, unknown>, options)
          : null,
      )
      .filter((child): child is ContentNode => child !== null);
    node.content = content;
  }

  return node;
}

function sanitizeMark(raw: unknown): ContentMark | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return null;
  }
  const record = raw as Record<string, unknown>;
  const type = record.type;
  if (typeof type !== 'string' || !ALLOWED_MARK_TYPES.includes(type as AllowedMarkType)) {
    return null;
  }
  const markType = type as AllowedMarkType;
  const attrs = sanitizeAttrs(record.attrs, MARK_ATTRIBUTE_ALLOWLIST[markType]);

  if (markType === 'link') {
    const href = attrs?.href;
    const scheme = typeof href === 'string' ? extractScheme(href) : undefined;
    if (
      !scheme ||
      !ALLOWED_LINK_SCHEMES.includes(scheme as (typeof ALLOWED_LINK_SCHEMES)[number])
    ) {
      return null; // Strip the whole mark — never emit a link with a neutralised-but-present href.
    }
  }

  return attrs ? { type: markType, attrs } : { type: markType };
}

function sanitizeAttrs(
  raw: unknown,
  allowedKeys: readonly string[],
): Record<string, unknown> | undefined {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return undefined;
  }
  const record = raw as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const key of allowedKeys) {
    if (key in record) {
      result[key] = record[key];
    }
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

function extractPlainText(node: ContentNode): string {
  if (node.type === 'text') {
    return node.text ?? '';
  }
  return (node.content ?? []).map(extractPlainText).join('');
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

interface CodeBlockContent {
  language: string;
  code: string;
}

function collectCodeBlocks(node: ContentNode): CodeBlockContent[] {
  const blocks: CodeBlockContent[] = [];
  const visit = (current: ContentNode) => {
    if (current.type === 'codeBlock') {
      const language =
        typeof current.attrs?.language === 'string'
          ? current.attrs.language
          : DEFAULT_CODE_BLOCK_LANGUAGE;
      const code = (current.content ?? []).map((child) => child.text ?? '').join('');
      blocks.push({ language, code });
      return; // codeBlock content is `text*` — nothing further to descend into.
    }
    for (const child of current.content ?? []) {
      visit(child);
    }
  };
  visit(node);
  return blocks;
}

/** Shiki's "no highlighting" grammar is `text`, not our `plaintext` alias. */
function toShikiLang(language: string): string {
  return language === DEFAULT_CODE_BLOCK_LANGUAGE ? 'text' : language;
}

/**
 * TipTap's codeBlock always renders as `<pre><code class="language-X">...`
 * (CodeBlock's own `renderHTML`, schema.ts's `defaultLanguage` guarantees
 * `X` is never empty) — matched here, in document order, against the
 * codeBlocks collected from the same (already-sanitised) JSON tree, and
 * replaced with Shiki's highlighted markup. A block whose language Shiki
 * can't highlight falls back to the already-safe, already-sanitized
 * plain block rather than failing the whole render.
 */
async function highlightCodeBlocks(html: string, codeBlocks: CodeBlockContent[]): Promise<string> {
  if (codeBlocks.length === 0) {
    return html;
  }
  const pattern = /<pre><code class="language-[a-zA-Z0-9_-]+">[\s\S]*?<\/code><\/pre>/g;
  const parts: string[] = [];
  let lastIndex = 0;
  let index = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(html))) {
    parts.push(html.slice(lastIndex, match.index));
    const block = codeBlocks[index];
    if (block) {
      try {
        parts.push(
          await codeToHtml(block.code, { lang: toShikiLang(block.language), theme: SHIKI_THEME }),
        );
      } catch {
        parts.push(match[0]);
      }
    } else {
      parts.push(match[0]);
    }
    index += 1;
    lastIndex = pattern.lastIndex;
  }
  parts.push(html.slice(lastIndex));
  return parts.join('');
}
