import { EditorError } from '../errors.js';

export const MAX_IMAGE_INPUT_BYTES = 16 * 1024 * 1024;
/** Bound each argument list while preserving encoded source bytes exactly. */
export function imageBase64(bytes, encode = btoa) {
  const chunks = [];
  for (let offset = 0; offset < bytes.length; offset += 32768)
    chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 32768)));
  return encode(chunks.join(''));
}
const unsupported = cause => new EditorError('UnsupportedImageFormat', 'Neither the native engine nor this browser can decode this image format.', { cause });

/** Only a native decoder rejection permits conversion. Supported source bytes never enter canvas.
 * Canvas supplies the smaller PNG/JPEG-80 carrier; native code still owns output sizing and validation. */
export async function convertUnsupportedImage(data, type, { window, active }) {
  active();
  if (!window?.document || !window.Blob) throw unsupported();
  let bitmap, image, imageUrl, canvas;
  try {
    const bytes = Uint8Array.from(window.atob(data), value => value.charCodeAt(0));
    if (!bytes.length || bytes.length > MAX_IMAGE_INPUT_BYTES) throw new EditorError('InvalidArgument', 'The image input exceeds the supported size.');
    // Public pasteImage has no MIME parameter. Give browser-only SVG decoding its
    // required media type when the caller supplied self-describing XML bytes.
    const svg = !type && /^(?:\s*<\?xml[^>]*>)*\s*<svg[\s>]/i.test(new TextDecoder().decode(bytes.subarray(0, 1024)));
    const blob = new window.Blob([bytes], { type: type || (svg ? 'image/svg+xml' : '') });
    try { if (window.createImageBitmap) bitmap = await window.createImageBitmap(blob); }
    catch { active(); /* Some browsers decode SVG only through an Image element. */ }
    if (!bitmap) {
      active();
      if (!window.Image || !window.URL?.createObjectURL) throw unsupported();
      image = new window.Image();
      imageUrl = window.URL.createObjectURL(blob);
      await new Promise((resolve, reject) => {
        image.onload = resolve; image.onerror = reject; image.src = imageUrl;
      });
    }
    active();
    const width = bitmap ? bitmap.width : image.naturalWidth, height = bitmap ? bitmap.height : image.naturalHeight;
    if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0 || width > 16384 || height > 16384 || width * height > 16777216)
      throw new EditorError('InvalidArgument', 'The image dimensions exceed the supported size.');
    canvas = window.document.createElement('canvas'); canvas.width = width; canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw unsupported();
    context.drawImage(bitmap ?? image, 0, 0);
    const encode = (mime, quality) => new Promise((resolve, reject) => {
      try { canvas.toBlob(resolve, mime, quality); } catch (error) { reject(error); }
    });
    let candidates;
    try { candidates = await Promise.all([encode('image/png'), encode('image/jpeg', 0.8)]); }
    catch (error) { active(); throw unsupported(error); }
    active();
    const selected = candidates.filter(blob => blob?.size > 0).sort((a,b) => a.size - b.size)[0];
    if (!selected) throw unsupported();
    if (selected.size > MAX_IMAGE_INPUT_BYTES) throw new EditorError('InvalidArgument', 'The converted image exceeds the supported input size.');
    const result = new Uint8Array(await selected.arrayBuffer()); active();
    return imageBase64(result, value => window.btoa(value));
  } catch (error) {
    active();
    if (error instanceof EditorError) throw error;
    throw unsupported(error);
  } finally {
    bitmap?.close();
    if (image) { image.onload = null; image.onerror = null; image.src = ''; }
    if (imageUrl) window.URL.revokeObjectURL(imageUrl);
    if (canvas) { canvas.width = 0; canvas.height = 0; }
  }
}
