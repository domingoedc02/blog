import type { Extensions } from '@tiptap/core';
import { Image } from '@tiptap/extension-image';
import { Link } from '@tiptap/extension-link';
import { StarterKit } from '@tiptap/starter-kit';

/**
 * The single source of truth for allowed rich-text content (BLOG-14, per
 * decision/content-format's "defined once" rule). Two things live here,
 * kept in lock-step by hand since one necessarily configures the other:
 *
 * 1. Plain-data allow-lists (node/mark type names, attribute keys, allowed
 *    attribute values) that {@link import("./validate").validatePostContent}
 *    and {@link import("./render").renderPostContent} walk directly,
 *    without instantiating ProseMirror — fast, and independently testable
 *    from TipTap's own (looser) runtime behaviour.
 * 2. {@link contentExtensions}, the TipTap/ProseMirror extension array that
 *    both the admin editor (BLOG-30) and `render.ts`'s `generateHTML` call
 *    build their schema from.
 *
 * This module is imported by client code (the eventual editor), so it must
 * never import anything server-only (no `src/lib/env.ts`, no `server-only`
 * package) — the R2 image-origin allow-list is threaded in as a parameter
 * by callers instead (see validate.ts/render.ts), not read from env here.
 *
 * TipTap is pinned to v2 (decision/tech-stack) — the installed v3 line
 * must not be used.
 */

export const ALLOWED_NODE_TYPES = [
  'doc',
  'paragraph',
  'text',
  'heading',
  'image',
  'codeBlock',
  'blockquote',
  'bulletList',
  'orderedList',
  'listItem',
  'horizontalRule',
  'hardBreak',
] as const;
export type AllowedNodeType = (typeof ALLOWED_NODE_TYPES)[number];

export const ALLOWED_MARK_TYPES = ['bold', 'italic', 'strike', 'code', 'link'] as const;
export type AllowedMarkType = (typeof ALLOWED_MARK_TYPES)[number];

export const ALLOWED_HEADING_LEVELS = [2, 3, 4] as const;
export type AllowedHeadingLevel = (typeof ALLOWED_HEADING_LEVELS)[number];

/** Everywhere a URL can appear in content: editor links and nowhere else (image `src` has its own, stricter, same-origin-only rule below). */
export const ALLOWED_LINK_SCHEMES = ['http:', 'https:', 'mailto:'] as const;
export type AllowedLinkScheme = (typeof ALLOWED_LINK_SCHEMES)[number];

export const DEFAULT_CODE_BLOCK_LANGUAGE = 'plaintext';

/**
 * Provisional Shiki language-id allow-list. The issue's own "Open
 * questions" defers the exact list to "once the pinned Shiki version is
 * locked" (BLOG-24, which also owns the full renderer/Shiki wiring this
 * task only lays groundwork for) — decision/tech-stack pins Shiki to
 * "latest" with no exact version yet. This is a reasonable starter set
 * covering the languages research/users' tech-blog audience is likely to
 * use; BLOG-24 should replace it with the pinned Shiki version's actual
 * bundled grammar ids rather than silently keeping this list forever.
 */
export const ALLOWED_CODE_BLOCK_LANGUAGES = [
  DEFAULT_CODE_BLOCK_LANGUAGE,
  'text',
  'typescript',
  'tsx',
  'javascript',
  'jsx',
  'json',
  'html',
  'css',
  'bash',
  'shell',
  'sql',
  'python',
  'go',
  'rust',
  'yaml',
  'markdown',
  'diff',
  'dockerfile',
  'graphql',
] as const;

/**
 * The exact attribute keys each allowed node type may carry, matching
 * what the TipTap extensions below actually produce (verified against
 * @tiptap/extension-image, extension-code-block, extension-ordered-list,
 * extension-heading, extension-link at the pinned v2.27.3). A key not
 * listed here is unknown/unexpected for that type — validate.ts rejects it
 * on write, render.ts strips it on render — not something an unmodified
 * editor would ever produce for that node.
 */
export const NODE_ATTRIBUTE_ALLOWLIST: Readonly<Record<AllowedNodeType, readonly string[]>> = {
  doc: [],
  paragraph: [],
  text: [],
  heading: ['level'],
  image: ['src', 'alt', 'title'],
  codeBlock: ['language'],
  blockquote: [],
  bulletList: [],
  orderedList: ['start', 'type'],
  listItem: [],
  horizontalRule: [],
  hardBreak: [],
};

/**
 * The exact attribute keys each allowed mark type may carry. `link`'s
 * `target`/`rel`/`class` are TipTap's own always-serialized defaults
 * (@tiptap/extension-link addAttributes) — their values are inconsequential
 * since render.ts's sanitize-html pass unconditionally forces the correct
 * `rel`/`target` on every external link regardless of what's stored.
 */
export const MARK_ATTRIBUTE_ALLOWLIST: Readonly<Record<AllowedMarkType, readonly string[]>> = {
  bold: [],
  italic: [],
  strike: [],
  code: [],
  link: ['href', 'target', 'rel', 'class'],
};

/**
 * TipTap's own `isAllowedUri` default (@tiptap/extension-link) permits a
 * broader built-in list (ftp:, tel:, sms:, cid:, xmpp:, ...) than this
 * project allows. Overriding `isAllowedUri` entirely — rather than only
 * setting `protocols` — is required so Link's own `renderHTML`/paste/
 * autolink behaviour matches our allow-list exactly, not TipTap's wider one.
 */
function isAllowedLinkUri(uri: string | undefined): boolean {
  if (!uri) {
    return false;
  }
  return ALLOWED_LINK_SCHEMES.includes(extractScheme(uri) as AllowedLinkScheme);
}

/**
 * Extracts a URL's scheme the way a browser would — case-insensitively,
 * and after stripping ASCII control characters (tab/newline/CR and other
 * C0 controls) anywhere in the string, since browsers strip these before
 * parsing a scheme and an attacker can use them to obfuscate
 * `javascript:` as `java\tscript:` / `\njavascript:` / etc. Returns the
 * scheme including its trailing colon (e.g. `"https:"`), or `undefined`
 * if the string has no scheme at all (a bare relative path, which this
 * project's allow-list also rejects — deny-by-default, not just
 * deny-known-bad).
 */
export function extractScheme(rawUrl: string): string | undefined {
  const stripped = rawUrl.replace(/[\u0000-\u001f]+/g, '').trim();
  const match = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(stripped);
  const scheme = match?.[1];
  return scheme ? `${scheme.toLowerCase()}:` : undefined;
}

/**
 * The TipTap/ProseMirror extension set, configured to match the allow-list
 * above as closely as TipTap's own options allow (defence-in-depth: even
 * if validate.ts/render.ts's JSON-level walk had a bug, `generateHTML`
 * built from this schema still can't produce a script/iframe/`on*` node,
 * and Link's `renderHTML` independently strips a disallowed `href`).
 *
 * Dropcursor/Gapcursor/History are deliberately excluded — they're
 * editor-interaction-only extensions with no node/mark type of their own
 * (nothing to allow-list), irrelevant to the render path this task owns.
 * BLOG-30's editor setup should add them locally alongside this array,
 * not fork this file.
 */
export const contentExtensions: Extensions = [
  StarterKit.configure({
    dropcursor: false,
    gapcursor: false,
    history: false,
    heading: { levels: [...ALLOWED_HEADING_LEVELS] },
    codeBlock: { defaultLanguage: DEFAULT_CODE_BLOCK_LANGUAGE },
  }),
  Link.configure({
    openOnClick: false,
    autolink: false,
    protocols: ['mailto'],
    HTMLAttributes: {
      target: '_blank',
      rel: 'noopener noreferrer nofollow ugc',
    },
    isAllowedUri: (url) => isAllowedLinkUri(url),
  }),
  Image.configure({
    inline: false,
    allowBase64: false,
  }),
];

/**
 * The ProseMirror-JSON shape stored in `posts.content_json` (spec/data-model)
 * and walked by validate.ts/render.ts. Deliberately `unknown`-friendly at
 * the edges (`attrs`, `text`) — the whole point of validate.ts/sanitize.ts
 * is to narrow an untrusted `unknown` payload down to this shape, not to
 * assume it already matches.
 */
export interface ContentMark {
  type: string;
  attrs?: Record<string, unknown>;
}

export interface ContentNode {
  type: string;
  attrs?: Record<string, unknown>;
  marks?: ContentMark[];
  text?: string;
  content?: ContentNode[];
}

/** A validated/sanitised document always has `type: "doc"` at its root. */
export type ContentJson = ContentNode & { type: 'doc' };
