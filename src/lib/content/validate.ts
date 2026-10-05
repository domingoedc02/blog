import {
  ALLOWED_CODE_BLOCK_LANGUAGES,
  ALLOWED_HEADING_LEVELS,
  ALLOWED_LINK_SCHEMES,
  ALLOWED_MARK_TYPES,
  ALLOWED_NODE_TYPES,
  DEFAULT_CODE_BLOCK_LANGUAGE,
  MARK_ATTRIBUTE_ALLOWLIST,
  NODE_ATTRIBUTE_ALLOWLIST,
  extractScheme,
  type AllowedMarkType,
  type AllowedNodeType,
  type ContentJson,
  type ContentMark,
  type ContentNode,
} from '@/lib/content/schema';
import { ValidationError } from '@/lib/errors';

/**
 * The write path's enforcement point (BLOG-14): walks an untrusted
 * `contentJson` payload — e.g. a draft `PATCH`/autosave/publish body —
 * against the allow-list in schema.ts and throws {@link ValidationError}
 * on the FIRST disallowed node type, mark type, attribute, or URL scheme
 * it finds. Nothing is written to `posts.content_json` when this throws
 * (spec/security threat #1).
 *
 * The one deliberate exception to "throw on anything unexpected" is
 * `codeBlock.language`: an unknown language id is a soft normalise to
 * {@link DEFAULT_CODE_BLOCK_LANGUAGE}, per the issue's acceptance
 * criteria — it's harmless content, not a security violation, so it
 * isn't worth losing an author's draft over.
 */
export interface ValidateContentOptions {
  /**
   * The origin `image.src` values must start with (e.g.
   * `https://media.example.com`), derived by the caller from
   * `R2_PUBLIC_BASE_URL` (there is no `lib/storage`/`lib/seo` typed
   * accessor yet — BLOG-25/a future task — so for now the caller reads
   * `env.R2_PUBLIC_BASE_URL` directly and passes the origin in; this
   * module deliberately never reads `process.env` or hardcodes a domain).
   */
  allowedImageOrigin: string;
}

export function validatePostContent(json: unknown, options: ValidateContentOptions): ContentJson {
  const node = assertObject(json, '$');
  if (node.type !== 'doc') {
    throw new ValidationError(`root node must be "doc", got "${String(node.type)}"`, {
      path: '$',
      reason: 'invalid-root',
    });
  }
  return assertNode(node, '$', options) as ContentJson;
}

function assertObject(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ValidationError(`expected an object at ${path}`, { path, reason: 'not-an-object' });
  }
  return value as Record<string, unknown>;
}

function assertNode(
  raw: Record<string, unknown>,
  path: string,
  options: ValidateContentOptions,
): ContentNode {
  const type = raw.type;
  if (typeof type !== 'string' || !ALLOWED_NODE_TYPES.includes(type as AllowedNodeType)) {
    throw new ValidationError(`disallowed node type "${String(type)}" at ${path}`, {
      path,
      reason: 'disallowed-node-type',
    });
  }
  const nodeType = type as AllowedNodeType;

  const attrs = assertAttrs(raw.attrs, NODE_ATTRIBUTE_ALLOWLIST[nodeType], path);
  const validatedAttrs = assertNodeSpecificAttrs(nodeType, attrs, path, options);

  const result: ContentNode = { type: nodeType };
  if (validatedAttrs) {
    result.attrs = validatedAttrs;
  }

  if (raw.text !== undefined) {
    if (typeof raw.text !== 'string') {
      throw new ValidationError(`"text" must be a string at ${path}`, {
        path,
        reason: 'invalid-text',
      });
    }
    result.text = raw.text;
  }

  if (raw.marks !== undefined) {
    if (!Array.isArray(raw.marks)) {
      throw new ValidationError(`"marks" must be an array at ${path}`, {
        path,
        reason: 'invalid-marks',
      });
    }
    result.marks = raw.marks.map((mark, index) =>
      assertMark(assertObject(mark, `${path}.marks[${index}]`), `${path}.marks[${index}]`),
    );
  }

  if (raw.content !== undefined) {
    if (!Array.isArray(raw.content)) {
      throw new ValidationError(`"content" must be an array at ${path}`, {
        path,
        reason: 'invalid-content',
      });
    }
    result.content = raw.content.map((child, index) =>
      assertNode(
        assertObject(child, `${path}.content[${index}]`),
        `${path}.content[${index}]`,
        options,
      ),
    );
  }

  return result;
}

function assertMark(raw: Record<string, unknown>, path: string): ContentMark {
  const type = raw.type;
  if (typeof type !== 'string' || !ALLOWED_MARK_TYPES.includes(type as AllowedMarkType)) {
    throw new ValidationError(`disallowed mark type "${String(type)}" at ${path}`, {
      path,
      reason: 'disallowed-mark-type',
    });
  }
  const markType = type as AllowedMarkType;
  const attrs = assertAttrs(raw.attrs, MARK_ATTRIBUTE_ALLOWLIST[markType], path);

  if (markType === 'link') {
    const href = attrs?.href;
    if (typeof href !== 'string' || href.length === 0) {
      throw new ValidationError(`link mark missing "href" at ${path}`, {
        path,
        reason: 'missing-href',
      });
    }
    const scheme = extractScheme(href);
    if (
      !scheme ||
      !ALLOWED_LINK_SCHEMES.includes(scheme as (typeof ALLOWED_LINK_SCHEMES)[number])
    ) {
      throw new ValidationError(`disallowed link scheme in "${href}" at ${path}`, {
        path,
        reason: 'disallowed-link-scheme',
      });
    }
  }

  const result: ContentMark = { type: markType };
  if (attrs) {
    result.attrs = attrs;
  }
  return result;
}

/** Rejects any attribute key not in the allow-list for this node/mark type — deny-by-default. */
function assertAttrs(
  raw: unknown,
  allowedKeys: readonly string[],
  path: string,
): Record<string, unknown> | undefined {
  if (raw === undefined) {
    return undefined;
  }
  const attrs = assertObject(raw, `${path}.attrs`);
  for (const key of Object.keys(attrs)) {
    if (!allowedKeys.includes(key)) {
      throw new ValidationError(`disallowed attribute "${key}" at ${path}.attrs`, {
        path: `${path}.attrs.${key}`,
        reason: 'disallowed-attribute',
      });
    }
  }
  return attrs;
}

function assertNodeSpecificAttrs(
  nodeType: AllowedNodeType,
  attrs: Record<string, unknown> | undefined,
  path: string,
  options: ValidateContentOptions,
): Record<string, unknown> | undefined {
  if (nodeType === 'heading') {
    const level = attrs?.level;
    if (typeof level !== 'number' || !ALLOWED_HEADING_LEVELS.includes(level as 2 | 3 | 4)) {
      throw new ValidationError(`disallowed heading level "${String(level)}" at ${path}`, {
        path: `${path}.attrs.level`,
        reason: 'disallowed-heading-level',
      });
    }
  }

  if (nodeType === 'image') {
    const src = attrs?.src;
    if (typeof src !== 'string' || !isAllowedImageSrc(src, options.allowedImageOrigin)) {
      throw new ValidationError(`disallowed image src "${String(src)}" at ${path}`, {
        path: `${path}.attrs.src`,
        reason: 'disallowed-image-src',
      });
    }
  }

  if (nodeType === 'codeBlock') {
    const language = attrs?.language;
    if (
      typeof language !== 'string' ||
      !ALLOWED_CODE_BLOCK_LANGUAGES.includes(
        language as (typeof ALLOWED_CODE_BLOCK_LANGUAGES)[number],
      )
    ) {
      // Soft normalise, not a hard failure — see this module's docblock.
      return { ...attrs, language: DEFAULT_CODE_BLOCK_LANGUAGE };
    }
  }

  return attrs;
}

/**
 * `src` must be same-origin with the configured R2 public base URL and
 * use an absolute `https:`/`http:` URL — never `data:`, never any other
 * origin (spec/security threat #4, Input validation).
 */
export function isAllowedImageSrc(src: string, allowedOrigin: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(src);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return false;
  }
  let allowed: URL;
  try {
    allowed = new URL(allowedOrigin);
  } catch {
    return false;
  }
  return parsed.origin === allowed.origin;
}
