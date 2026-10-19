/**
 * Shrink a photo in the browser before uploading: decode → draw on a canvas
 * no larger than MAX_EDGE px on its long edge → re-encode as JPEG (q 0.82).
 * Phone photos (4–12 MB) become ~200–500 KB, well under the server's
 * uploads.maxMb cap. Transparent PNGs are flattened onto white. The server
 * still checks the real bytes (magic numbers) and size.
 */
export const MAX_EDGE = 1600;
export const JPEG_QUALITY = 0.82;

export async function resizeImage(file: File): Promise<Blob> {
  if (!/^image\/(jpeg|png|webp)$/i.test(file.type)) {
    throw new Error('Please choose a JPG, PNG or WebP photo.');
  }
  const url = URL.createObjectURL(file);
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
