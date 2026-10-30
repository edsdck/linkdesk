// Export / import file format. Validation is pure; the background script
// re-encodes every accepted image before storing it.

import { cleanIcon, MAX_NAME, MAX_URL, normalizeSettings, UserError } from './model.js';
import { isHttpUrl } from './url.js';

export const FORMAT = 'linkdesk';
export const FORMAT_VERSION = 1;
export const MAX_LINKS = 2000;
export const MAX_ICON_CHARS = 300_000;
export const MAX_WALLPAPER_CHARS = 1_500_000;

const IMAGE_DATA_URL = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/;

export function isSafeImageDataUrl(value, maxChars) {
  return typeof value === 'string' && value.length <= maxChars && IMAGE_DATA_URL.test(value);
}

export function buildExport({ layout, settings, icons, wallpaperImage }, now) {
  return {
    format: FORMAT,
    version: FORMAT_VERSION,
    exportedAt: new Date(now).toISOString(),
    settings,
    links: layout.links.map(({ url, name, nameEdited, icon, cell, id }) => ({ id, url, name, nameEdited, icon, cell })),
    icons,
    ...(wallpaperImage ? { wallpaperImage } : {}),
  };
}

export class ImportError extends UserError {}

// Returns { items, settings, wallpaperImage } or throws ImportError with a user-facing message.
export function validateImport(data) {
  if (!data || typeof data !== 'object' || data.format !== FORMAT) {
    throw new ImportError("That file isn't a Linkdesk export.");
  }
  if (data.version !== FORMAT_VERSION) throw new ImportError('That export was made by a newer version of Linkdesk.');
  if (!Array.isArray(data.links)) throw new ImportError('That export has no links.');
  if (data.links.length > MAX_LINKS) throw new ImportError(`That export has more than ${MAX_LINKS} links.`);

  const icons = data.icons && typeof data.icons === 'object' ? data.icons : {};
  const items = [];
  for (const link of data.links) {
    if (!link || !isHttpUrl(link.url) || link.url.length > MAX_URL) continue;
    const icon = cleanIcon(link.icon, link.url);
    const iconData = typeof link.id === 'string' ? icons[link.id] : undefined;
    const item = {
      url: new URL(link.url).href,
      name: String(link.name ?? '').slice(0, MAX_NAME),
      nameEdited: Boolean(link.nameEdited),
      icon,
      cell: link.cell,
    };
    if (icon.kind !== 'letter' && isSafeImageDataUrl(iconData, MAX_ICON_CHARS)) item.iconData = iconData;
    if (icon.kind === 'upload' && !item.iconData) item.icon = cleanIcon({ kind: 'letter' }, link.url);
    if (icon.kind === 'site') item.icon = { ...icon, status: item.iconData ? 'ok' : 'failed', retries: 0 };
    items.push(item);
  }

  const settings = normalizeSettings(data.settings);
  const wallpaperImage = isSafeImageDataUrl(data.wallpaperImage, MAX_WALLPAPER_CHARS) ? data.wallpaperImage : null;
  if (settings.wallpaper.kind === 'image' && !wallpaperImage) settings.wallpaper = { kind: 'preset', value: 'plain' };
  return { items, settings, wallpaperImage };
}
