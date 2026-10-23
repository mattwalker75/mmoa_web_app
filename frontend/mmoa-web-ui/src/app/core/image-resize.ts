/**
 * Shrink a photo in the browser before uploading: decode → draw on a canvas
 * no larger than MAX_EDGE px on its long edge → re-encode as JPEG (q 0.82).
 * Phone photos (4–12 MB) become ~200–500 KB, well under the server's
 * uploads.maxMb cap. Transparent PNGs are flattened onto white. The server
 * still checks the real bytes (magic numbers) and size.
 */
export const MAX_EDGE = 1600;
export const JPEG_QUALITY = 0.82;

const ACCEPTED_TYPE_RE = /^image\/(jpeg|png|webp)$/i;

/**
 * Some pickers (notably on Android) hand over a real photo with an empty
 * `type`, so the MIME type alone would wrongly refuse it. Read the first
 * bytes and recognise the three accepted formats by their magic numbers:
 *   JPEG  FF D8 FF
 *   PNG   89 50 4E 47
 *   WebP  "RIFF" …… "WEBP"
 * Returns the sniffed MIME type, or null when the bytes match none of them.
 * (The server repeats this check on the uploaded bytes — this only stops good
 * files from being refused client-side.)
 */
export async function sniffImageType(file: Blob): Promise<string | null> {
  let b: Uint8Array;
  try {
    b = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  } catch {
    return null;
  }
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length >= 4 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  const ascii = (from: number, to: number) => String.fromCharCode(...b.subarray(from, to));
  if (b.length >= 12 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
  return null;
}

export async function resizeImage(file: File): Promise<Blob> {
  // Trust a declared JPEG/PNG/WebP type; otherwise (empty or odd `type`) let
  // the bytes decide. The sniffed type stands in for file.type from here on.
  const type = ACCEPTED_TYPE_RE.test(file.type) ? file.type.toLowerCase() : await sniffImageType(file);
  if (!type) {
    throw new Error('Please choose a JPG, PNG or WebP photo.');
  }
  const url = URL.createObjectURL(file.type === type ? file : new Blob([file], { type }));
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("That file couldn't be read as an image."));
      i.src = url;
    });
    const scale = Math.min(1, MAX_EDGE / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Your browser could not process this image.');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(b => b ? resolve(b) : reject(new Error('Your browser could not process this image.')), 'image/jpeg', JPEG_QUALITY));
  } finally {
    URL.revokeObjectURL(url);
  }
}
