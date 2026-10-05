import { describe, expect, it } from 'vitest';

import type { ContentJson } from '@/lib/content/schema';
import { isAllowedImageSrc, validatePostContent } from '@/lib/content/validate';
import { ValidationError } from '@/lib/errors';

const ALLOWED_IMAGE_ORIGIN = 'https://media.example.test';
const OPTS = { allowedImageOrigin: ALLOWED_IMAGE_ORIGIN };

function paragraph(text: string): ContentJson {
  return {
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
  };
}

describe('validatePostContent — disallowed node types (BLOG-19 AC #1)', () => {
  it('throws for a hand-crafted disallowed node type', () => {
    const doc: ContentJson = {
      type: 'doc',
      content: [{ type: 'scriptBlock', content: [{ type: 'text', text: 'alert(1)' }] }],
    };
    expect(() => validatePostContent(doc, OPTS)).toThrow(ValidationError);
  });

  it('throws for an iframe-shaped node', () => {
    const doc: ContentJson = {
      type: 'doc',
      content: [{ type: 'iframe', attrs: { src: 'https://evil.example' } }],
    };
    expect(() => validatePostContent(doc, OPTS)).toThrow(ValidationError);
  });

  it('throws for an unknown mark type', () => {
    const doc: ContentJson = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'x', marks: [{ type: 'underline' }] }],
        },
      ],
    };
    expect(() => validatePostContent(doc, OPTS)).toThrow(ValidationError);
  });

  it('throws for an attribute key not in the allow-list (deny-by-default)', () => {
    const doc: ContentJson = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          attrs: { onclick: 'alert(1)' },
          content: [{ type: 'text', text: 'x' }],
        },
      ],
    };
    expect(() => validatePostContent(doc, OPTS)).toThrow(ValidationError);
  });

  it('accepts a well-formed minimal document', () => {
    expect(() => validatePostContent(paragraph('hello world'), OPTS)).not.toThrow();
  });
});

describe('validatePostContent — link href scheme (BLOG-19 AC #2)', () => {
  function docWithLinkHref(href: string): ContentJson {
    return {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'click', marks: [{ type: 'link', attrs: { href } }] }],
        },
      ],
    };
  }

  it.each([
    'javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'vbscript:msgbox(1)',
  ])('rejects %s', (href) => {
    expect(() => validatePostContent(docWithLinkHref(href), OPTS)).toThrow(ValidationError);
  });

  it.each(['http://example.com', 'https://example.com/post', 'mailto:author@example.com'])(
    'accepts %s',
    (href) => {
      expect(() => validatePostContent(docWithLinkHref(href), OPTS)).not.toThrow();
    },
  );
});

describe('validatePostContent — image src origin (BLOG-19 AC #3)', () => {
  function docWithImageSrc(src: string): ContentJson {
    return { type: 'doc', content: [{ type: 'image', attrs: { src } }] };
  }

  it('rejects a data: URI', () => {
    expect(() => validatePostContent(docWithImageSrc('data:image/png;base64,AAAA'), OPTS)).toThrow(
      ValidationError,
    );
  });

  it('rejects an off-origin https URL', () => {
    expect(() => validatePostContent(docWithImageSrc('https://evil.example/x.png'), OPTS)).toThrow(
      ValidationError,
    );
  });

  it('accepts a same-origin URL under the configured R2 base', () => {
    expect(() =>
      validatePostContent(docWithImageSrc(`${ALLOWED_IMAGE_ORIGIN}/uploads/a.webp`), OPTS),
    ).not.toThrow();
  });
});

describe('isAllowedImageSrc', () => {
  it('rejects a protocol-relative URL (no explicit scheme)', () => {
    expect(isAllowedImageSrc('//media.example.test/x.png', ALLOWED_IMAGE_ORIGIN)).toBe(false);
  });
});

describe('validatePostContent — heading level allow-list', () => {
  it.each([1, 5, 99])('rejects heading level %i', (level) => {
    const doc: ContentJson = {
      type: 'doc',
      content: [{ type: 'heading', attrs: { level }, content: [{ type: 'text', text: 'Title' }] }],
    };
    expect(() => validatePostContent(doc, OPTS)).toThrow(ValidationError);
  });

  it.each([2, 3, 4])('accepts heading level %i', (level) => {
    const doc: ContentJson = {
      type: 'doc',
      content: [{ type: 'heading', attrs: { level }, content: [{ type: 'text', text: 'Title' }] }],
    };
    expect(() => validatePostContent(doc, OPTS)).not.toThrow();
  });
});

describe('validatePostContent — codeBlock language (soft normalise, not a hard failure)', () => {
  it('falls back to plaintext instead of throwing for an unknown language', () => {
    const doc: ContentJson = {
      type: 'doc',
      content: [
        {
          type: 'codeBlock',
          attrs: { language: 'php-malicious-nonsense' },
          content: [{ type: 'text', text: 'x' }],
        },
      ],
    };
    const result = validatePostContent(doc, OPTS);
    expect(result.content?.[0]?.attrs?.language).toBe('plaintext');
  });

  it('keeps a recognised language id unchanged', () => {
    const doc: ContentJson = {
      type: 'doc',
      content: [
        {
          type: 'codeBlock',
          attrs: { language: 'typescript' },
          content: [{ type: 'text', text: 'const x = 1;' }],
        },
      ],
    };
    const result = validatePostContent(doc, OPTS);
    expect(result.content?.[0]?.attrs?.language).toBe('typescript');
  });
});
