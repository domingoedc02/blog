import { describe, expect, it } from 'vitest';

import { renderPostContent } from '@/lib/content/render';
import { sanitizeContentHtml } from '@/lib/content/sanitize';
import type { ContentJson } from '@/lib/content/schema';

const ALLOWED_IMAGE_ORIGIN = 'https://media.example.test';
const OPTS = { allowedImageOrigin: ALLOWED_IMAGE_ORIGIN };

describe('sanitizeContentHtml — explicit allow-list over raw HTML', () => {
  it('strips a script tag entirely', () => {
    const html = sanitizeContentHtml('<p>hi</p><script>alert(1)</script>');
    expect(html).not.toContain('<script');
    expect(html).toContain('<p>hi</p>');
  });

  it('strips on* handler attributes and style attributes', () => {
    const html = sanitizeContentHtml('<p onclick="alert(1)" style="color:red">hi</p>');
    expect(html).not.toContain('onclick');
    expect(html).not.toContain('style=');
  });

  it('forces target/rel on every link regardless of what was supplied', () => {
    const html = sanitizeContentHtml('<a href="https://example.com">link</a>');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('noopener');
    expect(html).toContain('noreferrer');
    expect(html).toContain('nofollow');
    expect(html).toContain('ugc');
  });

  it('drops a disallowed tag (iframe) entirely', () => {
    const html = sanitizeContentHtml('<iframe src="https://evil.example"></iframe><p>safe</p>');
    expect(html).not.toContain('<iframe');
    expect(html).toContain('<p>safe</p>');
  });
});

describe('renderPostContent — link href is rejected on write and stripped on render (BLOG-19 AC #2)', () => {
  it('never emits a javascript: href as a clickable/executable attribute, even from a bypassed/legacy row', async () => {
    const doc: ContentJson = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'click me',
              marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }],
            },
          ],
        },
      ],
    };
    const html = await renderPostContent(doc, OPTS);
    expect(html).not.toMatch(/href\s*=\s*["']?\s*javascript:/i);
    expect(html).toContain('click me');
  });
});

describe('renderPostContent — a legacy/tampered row with a disallowed element still renders safely (BLOG-19 AC #4)', () => {
  it('excludes a disallowed node type that bypassed write-time validation', async () => {
    // Simulates a row from before a schema tightening — never passed through
    // validatePostContent, going straight to renderPostContent as a real
    // render path would for an existing DB row.
    const legacyRow: ContentJson = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'before' }] },
        { type: 'scriptBlock', content: [{ type: 'text', text: 'alert(1)' }] } as never,
        { type: 'paragraph', content: [{ type: 'text', text: 'after' }] },
      ],
    };
    const html = await renderPostContent(legacyRow, OPTS);
    expect(html).not.toContain('scriptBlock');
    expect(html).not.toMatch(/<script/i);
    expect(html).toContain('before');
    expect(html).toContain('after');
  });

  it('drops an image node whose src is outside the configured origin', async () => {
    const legacyRow: ContentJson = {
      type: 'doc',
      content: [{ type: 'image', attrs: { src: 'https://evil.example/x.png' } }],
    };
    const html = await renderPostContent(legacyRow, OPTS);
    expect(html).not.toContain('evil.example');
    expect(html).not.toContain('<img');
  });

  it('normalises an unknown codeBlock language to plaintext instead of dropping the block', async () => {
    const doc: ContentJson = {
      type: 'doc',
      content: [
        {
          type: 'codeBlock',
          attrs: { language: 'not-a-real-language' },
          content: [{ type: 'text', text: 'x = 1' }],
        },
      ],
    };
    const html = await renderPostContent(doc, OPTS);
    expect(html).toContain('x = 1');
  });

  it('still renders real content (link, image, code block, nested list) unchanged', async () => {
    const doc: ContentJson = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'see ' },
            {
              type: 'text',
              text: 'this',
              marks: [{ type: 'link', attrs: { href: 'https://example.com' } }],
            },
          ],
        },
        { type: 'image', attrs: { src: `${ALLOWED_IMAGE_ORIGIN}/a.webp`, alt: 'a description' } },
        {
          type: 'codeBlock',
          attrs: { language: 'typescript' },
          content: [{ type: 'text', text: 'const x = 1;' }],
        },
        {
          type: 'bulletList',
          content: [
            {
              type: 'listItem',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'one' }] }],
            },
            {
              type: 'listItem',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'two' }] }],
            },
          ],
        },
      ],
    };
    const html = await renderPostContent(doc, OPTS);
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain(`src="${ALLOWED_IMAGE_ORIGIN}/a.webp"`);
    expect(html).toContain('alt="a description"');
    expect(html).toContain('const'); // Shiki-highlighted, so not a plain substring match on the whole line
    expect(html).toContain('<ul>');
    expect(html).toContain('one');
    expect(html).toContain('two');
  });
});
