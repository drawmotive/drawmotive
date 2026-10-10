import { createHash, timingSafeEqual } from 'node:crypto';

const redirects = new Set([301, 302, 303, 307, 308]);
const safeUrl = value => {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Release downloads require HTTPS URLs without embedded credentials');
  return url;
};
const description = url => url.origin + url.pathname;
const header = (response, name) => response.headers?.get(name);
const integer = value => /^(0|[1-9][0-9]*)$/.test(value ?? '') && Number.isSafeInteger(Number(value)) ? Number(value) : undefined;

/** HTTP status is retained so an unavailable npm archive remains pending. */
export class ReleaseDownloadHttpError extends Error {
  constructor(status, url) { super('Release download failed: HTTP ' + status + ' at ' + description(url)); this.status = status; }
}

function expectedDigest(value) {
  let match;
  if ((match = /^sha512-([A-Za-z0-9+/]{86}==)$/.exec(value ?? ''))) return { algorithm: 'sha512', digest: Buffer.from(match[1], 'base64') };
  if ((match = /^sha256:([a-f0-9]{64})$/.exec(value ?? ''))) return { algorithm: 'sha256', digest: Buffer.from(match[1], 'hex') };
  throw new Error('Release downloads require an expected npm SHA512 integrity or SHA256 digest');
}

/** Redirects retain the request budget, but credentials never cross origins.
 * Signed asset URLs are transport only and do not replace the caller's digest. */
async function responseFor(url, options, request) {
  let current = url;
  const headers = new Headers(options.headers);
  for (let hop = 0; hop <= 5; hop++) {
    const response = await request(current.href, { ...options, headers, redirect: 'manual', credentials: 'omit' });
    if (!redirects.has(response.status)) return response;
    const location = header(response, 'location');
    if (!location || hop === 5) throw new Error('Release download redirect is missing or exceeds the limit');
    const next = safeUrl(new URL(location, current));
    if (next.origin !== current.origin) { headers.delete('Authorization'); headers.delete('Cookie'); headers.delete('Proxy-Authorization'); }
    await response.body?.cancel();
    current = next;
  }
}

/** Archive bytes are trusted only after complete hash verification. A proved
 * Content-Range permits bounded parallel requests; ignored ranges stay serial.
 * Each request budget covers redirects, headers and the complete response body. */
export async function downloadReleaseBytes(value, { expectedHash, expectedSize, request = fetch, headers = {}, timeoutMs = 60000, rangeSize = 512 * 1024, concurrency = 4, signal } = {}) {
  const url = safeUrl(value), expected = expectedDigest(expectedHash);
  if (expectedSize !== undefined && (!Number.isSafeInteger(expectedSize) || expectedSize < 0)) throw new Error('Invalid expected release download size');
  if (!Number.isSafeInteger(rangeSize) || rangeSize < 1 || !Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > 8 || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1) throw new Error('Invalid release download limits');
  const controller = new AbortController();
  const fetchBytes = async (start, end, total) => {
    const budget = AbortSignal.timeout(timeoutMs);
    const requestSignal = AbortSignal.any([budget, controller.signal, ...(signal ? [signal] : [])]);
    const requestHeaders = new Headers(headers);
    requestHeaders.set('Cache-Control', 'no-cache');
    requestHeaders.set('Accept-Encoding', 'identity');
    requestHeaders.set('Range', `bytes=${start}-${end}`);
    try {
      const response = await responseFor(url, { headers: requestHeaders, signal: requestSignal }, request);
      if (response.status !== 200 && response.status !== 206) throw new ReleaseDownloadHttpError(response.status, url);
      const encoding = header(response, 'content-encoding');
      if (encoding && encoding !== 'identity') throw new Error('Release download uses an encoded response body');
      const range = header(response, 'content-range');
      let rangeTotal;
      if (response.status === 206) {
        const match = /^bytes ([0-9]+)-([0-9]+)[/]([0-9]+)$/.exec(range ?? '');
        const values = match?.slice(1).map(integer);
        if (!values || values.some(number => number === undefined) || values[2] < 1 || values[0] !== start || values[1] !== Math.min(end, values[2] - 1) || (total !== undefined && values[2] !== total) || (expectedSize !== undefined && values[2] !== expectedSize)) throw new Error('Release download Content-Range conflicts with the requested bytes or total');
        rangeTotal = values[2];
      } else if (total !== undefined || range) throw new Error('Release download stopped honoring the proved byte ranges');
      const bytes = Buffer.from(await response.arrayBuffer());
      // A transport must not declare completion after its budget was aborted.
      requestSignal.throwIfAborted();
      const size = rangeTotal === undefined ? expectedSize : Math.min(end, rangeTotal - 1) - start + 1;
      if (size !== undefined && bytes.length !== size) throw new Error('Release download body size conflicts with its requested range or expected size');
      const contentLength = header(response, 'content-length');
      if (contentLength !== undefined && contentLength !== null && integer(contentLength) !== bytes.length) throw new Error('Release download body size conflicts with Content-Length');
      return { bytes, total: rangeTotal };
    } catch (error) {
      if (error instanceof ReleaseDownloadHttpError) throw error;
      const detail = budget.aborted ? `request exceeded ${timeoutMs} ms` : requestSignal.aborted ? 'request was aborted' : error.message;
      throw new Error(`Release download failed at ${description(url)} (bytes=${start}-${end}): ${detail}`, { cause: error });
    }
  };
  let bytes;
  try {
    const first = await fetchBytes(0, rangeSize - 1);
    if (first.total === undefined) bytes = first.bytes;
    else {
      const chunks = [first.bytes];
      let next = rangeSize;
      const workers = Array.from({ length: Math.min(concurrency, Math.ceil((first.total - first.bytes.length) / rangeSize)) }, async () => {
        while (next < first.total) {
          const start = next; next += rangeSize;
          const part = await fetchBytes(start, Math.min(start + rangeSize - 1, first.total - 1), first.total);
          chunks[start / rangeSize] = part.bytes;
        }
      });
      try { await Promise.all(workers); }
      catch (error) { controller.abort(); await Promise.allSettled(workers); throw error; }
      bytes = Buffer.concat(chunks, first.total);
    }
    const actual = createHash(expected.algorithm).update(bytes).digest();
    if (!timingSafeEqual(actual, expected.digest)) throw new Error('Downloaded release archive differs from the expected hash: ' + description(url));
    return bytes;
  } finally { controller.abort(); }
}
