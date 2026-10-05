import { PayloadTooLargeError } from '@/lib/errors';

/**
 * Reads a request body while enforcing a byte cap, throwing
 * {@link PayloadTooLargeError} the moment the cap is exceeded — never
 * after buffering the whole oversized body into memory first (BLOG-29's
 * acceptance criteria: "rejected 413 before the body is fully parsed into
 * memory"). Also closes the gap security-eng flagged in BLOG-5's review:
 * BLOG-5's middleware-level cap only checks `Content-Length`, which a
 * chunked-transfer-encoding (or simply lying) request can bypass — the
 * streamed byte-count check below is enforced regardless of what, if
 * anything, `Content-Length` claims.
 *
 * Two layers, cheapest first:
 * 1. `Content-Length`, if present and already over the cap, rejects
 *    without touching the body stream at all.
 * 2. Otherwise streams the body in chunks, counting bytes as they arrive
 *    and aborting (cancelling the reader) the instant the running total
 *    exceeds the cap — a forged/absent `Content-Length` can't bypass this.
 *
 * Returns the body as a UTF-8 string (empty string for no body), for the
 * caller to `JSON.parse` / validate — the stream can only be read once, so
 * this is the single point every route reads its body through.
 */
export async function readLimitedBody(request: Request, limitBytes: number): Promise<string> {
  const contentLength = request.headers.get('content-length');
  if (contentLength !== null) {
    const declared = Number(contentLength);
    if (Number.isFinite(declared) && declared > limitBytes) {
      throw new PayloadTooLargeError(
        `Request body (${declared} bytes) exceeds the ${limitBytes}-byte limit for this route.`,
        { limitBytes },
      );
    }
  }

  if (!request.body) {
    return '';
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    total += value.byteLength;
    if (total > limitBytes) {
      await reader.cancel();
      throw new PayloadTooLargeError(
        `Request body exceeds the ${limitBytes}-byte limit for this route.`,
        { limitBytes },
      );
    }
    chunks.push(value);
  }

  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString('utf-8');
}
