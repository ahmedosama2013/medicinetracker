/* Photo capture, compression and object-URL lifetime.
 *
 * Compression is not optional. A modern phone camera produces 3-6 MB per shot;
 * fifteen of those will hit a storage quota, and the failure mode is a thrown
 * exception mid-save rather than a warning. Resizing to 800px on the longest
 * edge at JPEG 0.7 lands at roughly 60-120 KB, which is plenty to tell one
 * white tablet from another.
 *
 * Every object URL in the app is created here and revoked here. Views call
 * `release(token)` on unmount; nothing else should call createObjectURL.
 */

const MAX_EDGE = 800;
const QUALITY = 0.7;

/** Decode a Blob, honouring EXIF orientation where the browser allows it. */
async function decode(blob) {
  if (globalThis.createImageBitmap) {
    try {
      return await createImageBitmap(blob, { imageOrientation: 'from-image' });
    } catch {
      try {
        return await createImageBitmap(blob);
      } catch { /* fall through to the <img> path */ }
    }
  }
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Image decode failed')); };
    img.src = url;
  });
}

function targetSize(width, height) {
  const longest = Math.max(width, height);
  if (longest <= MAX_EDGE) return { width, height };
  const scale = MAX_EDGE / longest;
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

function canvasToBlob(canvas) {
  return new Promise((resolve, reject) => {
    if (canvas.toBlob) {
      canvas.toBlob(blob => (blob ? resolve(blob) : reject(new Error('Encode failed'))), 'image/jpeg', QUALITY);
      return;
    }
    try {
      // Safari fallback: dataURL then back to a Blob.
      const dataUrl = canvas.toDataURL('image/jpeg', QUALITY);
      resolve(dataUrlToBlob(dataUrl));
    } catch (err) {
      reject(err);
    }
  });
}

/** File or Blob in, compressed JPEG Blob out. */
export async function compress(file) {
  const source = await decode(file);
  const width = source.width || source.naturalWidth;
  const height = source.height || source.naturalHeight;
  if (!width || !height) throw new Error('Image has no dimensions');

  const size = targetSize(width, height);
  const canvas = document.createElement('canvas');
  canvas.width = size.width;
  canvas.height = size.height;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, size.width, size.height);
  source.close?.();

  const blob = await canvasToBlob(canvas);
  canvas.width = 0;                     // let the backing store go early
  canvas.height = 0;
  return blob;
}

// ---- object URL bookkeeping ----------------------------------------------

const live = new Map();   // token -> url

let nextToken = 1;

/** Returns { url, token }. Hold the token, release it on unmount. */
export function objectUrl(blob) {
  const url = URL.createObjectURL(blob);
  const token = nextToken;
  nextToken += 1;
  live.set(token, url);
  return { url, token };
}

export function release(token) {
  const url = live.get(token);
  if (!url) return;
  URL.revokeObjectURL(url);
  live.delete(token);
}

/** Release a batch. Views collect tokens and hand the array back as cleanup. */
export function releaseAll(tokens) {
  for (const token of tokens) release(token);
}

// ---- base64, for export and import ---------------------------------------

export function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error('Read failed'));
    reader.readAsDataURL(blob);
  });
}

export function dataUrlToBlob(dataUrl) {
  const [head, body] = String(dataUrl).split(',');
  if (!body) throw new Error('Not a data URL');
  const mime = /:(.*?);/.exec(head)?.[1] || 'image/jpeg';
  const binary = atob(body);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}
