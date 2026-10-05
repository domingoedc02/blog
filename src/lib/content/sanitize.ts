import sanitizeHtmlLib from 'sanitize-html';

/**
 * The HTML-level allow-list — render.ts's second, independent defence
 * after the JSON-level walk, per decision/content-format and
 * spec/security's Input validation section. This is an explicit
 * deny-by-default `allowedTags`/`allowedAttributes` list, not an
 * extension of `sanitize-html`'s own (permissive) defaults — see this
 * task's Security notes: starting from the library's defaults would
 * silently allow tags/attributes this project never agreed to.
 *
 * Tags/attributes here are exactly what src/lib/content/schema.ts's
 * `contentExtensions` can produce via `generateHTML` — nothing more.
 * `style` and every `on*` handler attribute are stripped automatically
 * by omission (they're not in `allowedAttributes` for any tag); Shiki's
 * own inline `style` on highlighted `<span>`s is applied in render.ts
 * AFTER this pass runs, so it's never subject to this filter and never
 * needs to be allow-listed here (spec/security's CSP `style-src
 * 'unsafe-inline'` carve-out is for that Shiki output, not for this
 * sanitiser letting user-authored `style` through).
 */
const ALLOWED_TAGS = [
  'p',
  'h2',
  'h3',
  'h4',
  'strong',
  'em',
  's',
  'code',
  'pre',
  'blockquote',
  'ul',
  'ol',
  'li',
  'hr',
  'br',
  'a',
  'img',
];

const ALLOWED_ATTRIBUTES: sanitizeHtmlLib.IOptions['allowedAttributes'] = {
  a: ['href', 'target', 'rel'],
  img: ['src', 'alt', 'title'],
  ol: ['start', 'type'],
  code: ['class'], // the codeBlock's `language-<id>` class only; Shiki replaces this subtree afterwards.
};

export const sanitizeHtmlConfig: sanitizeHtmlLib.IOptions = {
  allowedTags: ALLOWED_TAGS,
  allowedAttributes: ALLOWED_ATTRIBUTES,
  allowedSchemes: ['http', 'https', 'mailto'],
  allowedSchemesByTag: { img: ['http', 'https'] },
  allowProtocolRelative: false,
  disallowedTagsMode: 'discard',
  // Every link in this app is to an external destination — there is no
  // internal post-to-post linking feature (spec/flows) — so force the
  // tabnabbing-safe rel/target on every `<a>`, overwriting whatever TipTap
  // (or a legacy row) happened to store, per spec/security verbatim.
  transformTags: {
    a: sanitizeHtmlLib.simpleTransform(
      'a',
      { target: '_blank', rel: 'noopener noreferrer nofollow ugc' },
      true,
    ),
  },
};

/** Runs the configured allow-list over a trusted-shape HTML string (defence-in-depth). */
export function sanitizeContentHtml(html: string): string {
  return sanitizeHtmlLib(html, sanitizeHtmlConfig);
}
