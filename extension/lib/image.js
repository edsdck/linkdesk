// Image decoding and re-encoding. Needs a DOM (pages and the background event page).

export const ICON_PX = 128;
export const WALLPAPER_MAX_WIDTH = 2560;
export const WALLPAPER_MAX_BYTES = 1_000_000;
const MAX_PIXELS = 40_000_000; // refuse decompression bombs

async function loadImage(blob) {
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    // `load` gives the size from the header; pixels are decoded only when drawn,
    // so an oversized image is refused before it is decoded.
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = () => reject(new Error('Not an image'));
      img.src = url;
    });
    if (img.naturalWidth * img.naturalHeight > MAX_PIXELS) throw new Error('Image too large');
    return img;
  } finally {
    // The decoded image stays usable after the object URL is revoked.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

function asTypedBlob(blob, hint = '') {
  if (blob.type.startsWith('image/')) return blob;
  if (/svg/i.test(hint)) return new Blob([blob], { type: 'image/svg+xml' });
  return new Blob([blob], { type: 'image/png' }); // Firefox sniffs the real format
}

// Any decodable image → 128×128 PNG data URL, contained and centred.
export async function toIconPng(blob, hint) {
  const img = await loadImage(asTypedBlob(blob, hint));
  const w = img.naturalWidth || ICON_PX;
  const h = img.naturalHeight || ICON_PX;
  if (w < 2 || h < 2) throw new Error('Image too small');
  const scale = Math.min(ICON_PX / w, ICON_PX / h);
  const dw = Math.round(w * scale);
  const dh = Math.round(h * scale);
  const canvas = document.createElement('canvas');
  canvas.width = ICON_PX;
  canvas.height = ICON_PX;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, (ICON_PX - dw) / 2, (ICON_PX - dh) / 2, dw, dh);
  return canvas.toDataURL('image/png');
}

export async function dataUrlToBlob(dataUrl) {
  return (await fetch(dataUrl)).blob();
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function canvasBlob(canvas, type, quality) {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

// Wallpaper: at most 2560 px wide and 1 MB, as WebP (JPEG if WebP isn't available).
export async function toWallpaper(blob) {
  const img = await loadImage(blob);
  const scale = Math.min(1, WALLPAPER_MAX_WIDTH / img.naturalWidth);
  let width = Math.round(img.naturalWidth * scale);
  let height = Math.round(img.naturalHeight * scale);
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    canvas.getContext('2d').drawImage(img, 0, 0, width, height);
    for (const quality of [0.85, 0.7, 0.55]) {
      const out = (await canvasBlob(canvas, 'image/webp', quality)) ?? (await canvasBlob(canvas, 'image/jpeg', quality));
      if (out && out.size <= WALLPAPER_MAX_BYTES) return blobToDataUrl(out);
    }
    width = Math.round(width * 0.75);
    height = Math.round(height * 0.75);
  }
  throw new Error('Image too large');
}
