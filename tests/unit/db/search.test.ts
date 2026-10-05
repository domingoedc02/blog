import { describe, expect, it } from 'vitest';

import { extractPlainText, joinTagNames } from '@/lib/db/search-core';

describe('extractPlainText', () => {
  it('returns an empty string for null/non-object input', () => {
    expect(extractPlainText(null)).toBe('');
    expect(extractPlainText(undefined)).toBe('');
    expect(extractPlainText('not an object')).toBe('');
  });

  it('concatenates text nodes depth-first, space-separated', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Hello' },
            { type: 'text', text: 'world' },
          ],
        },
        {
          type: 'bulletList',
          content: [
            {
              type: 'listItem',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'first' }] }],
            },
            {
              type: 'listItem',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'second' }] }],
            },
          ],
        },
      ],
    };

    expect(extractPlainText(doc)).toBe('Hello world first second');
  });

  it('ignores nodes with no text and no content (e.g. a hard break)', () => {
    const doc = { type: 'doc', content: [{ type: 'hardBreak' }, { type: 'text', text: 'after' }] };
    expect(extractPlainText(doc)).toBe('after');
  });

  it('handles an empty document', () => {
    expect(extractPlainText({ type: 'doc', content: [] })).toBe('');
  });
});

describe('joinTagNames', () => {
  it('space-joins tag names', () => {
    expect(joinTagNames(['typescript', 'nextjs'])).toBe('typescript nextjs');
  });

  it('returns an empty string for no tags', () => {
    expect(joinTagNames([])).toBe('');
  });
});
