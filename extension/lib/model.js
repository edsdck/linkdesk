// Pure operations on the stored layout. The background script is the only
// caller that writes the results to storage.

import { cellKey, firstFreeCell } from './grid.js';
import { colorFor, graphemes, hostOf, isHttpUrl, letterFor, MAX_URL } from './url.js';

export const LAYOUT_VERSION = 1;
export const DEFAULT_COLS = 8;
export const ICON_KINDS = ['site', 'upload', 'letter'];
export const ICON_SIZES = ['s', 'm', 'l'];
export const WALLPAPER_PRESETS = ['plain', 'dawn', 'ocean', 'forest', 'dusk', 'midnight'];
export const MAX_NAME = 200;
export { MAX_URL };

// Errors whose message is safe to show to the user as is.
export class UserError extends Error {}

export const isWebUrl = (url) => isHttpUrl(url) && url.length <= MAX_URL;

export const DEFAULT_SETTINGS = Object.freeze({
  iconSize: 'm',
  wallpaper: Object.freeze({ kind: 'preset', value: 'plain' }),
});

export const iconKey = (id) => `icon:${id}`;

export function emptyLayout() {
  return { version: LAYOUT_VERSION, cols: DEFAULT_COLS, links: [] };
}

// Bounds keep a hostile import from making a grid millions of cells tall.
export const MAX_COLS = 200;
export const MAX_ROWS = 5000;

const isCell = (cell) =>
  cell && Number.isInteger(cell.col) && Number.isInteger(cell.row)
  && cell.col >= 0 && cell.row >= 0 && cell.col < MAX_COLS && cell.row < MAX_ROWS;

export function cleanIcon(icon, url) {
  const kind = ICON_KINDS.includes(icon?.kind) ? icon.kind : 'site';
  if (kind === 'letter') {
    const text = graphemes(icon.text, 2) || letterFor('', url);
    const color = /^#[0-9a-f]{6}$/i.test(icon.color ?? '') ? icon.color.toLowerCase() : colorFor(url);
    return { kind, text, color };
  }
  const clean = { kind };
  if (kind === 'site') {
    // Only web URLs: image data never goes into the layout key.
    if (isWebUrl(icon?.source)) clean.source = icon.source;
    clean.status = ['pending', 'ok', 'failed'].includes(icon?.status) ? icon.status : 'pending';
    clean.retries = Number.isInteger(icon?.retries) ? icon.retries : 0;
  }
  return clean;
}

// Brings any stored value up to the current layout shape. Never throws.
export function migrate(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.links)) return emptyLayout();
  const seen = new Set();
  const links = [];
  for (const link of raw.links) {
    if (!link || typeof link.id !== 'string' || seen.has(link.id) || !isWebUrl(link.url)) continue;
    seen.add(link.id);
    links.push({
      id: link.id,
      url: link.url,
      name: String(link.name ?? '').slice(0, MAX_NAME) || hostOf(link.url),
      nameEdited: Boolean(link.nameEdited),
      icon: cleanIcon(link.icon, link.url),
      cell: isCell(link.cell) ? { col: link.cell.col, row: link.cell.row } : { col: 0, row: 0 },
      createdAt: Number(link.createdAt) || 0,
      updatedAt: Number(link.updatedAt) || 0,
    });
  }
  const cols = Number.isInteger(raw.cols) && raw.cols > 0 ? raw.cols : DEFAULT_COLS;
  return { version: LAYOUT_VERSION, cols, links: resolveClashes(links, cols) };
}

export function normalizeSettings(raw) {
  const iconSize = ICON_SIZES.includes(raw?.iconSize) ? raw.iconSize : DEFAULT_SETTINGS.iconSize;
  const wp = raw?.wallpaper;
  const wallpaper =
    wp?.kind === 'image'
      ? { kind: 'image', value: 'image' }
      : { kind: 'preset', value: WALLPAPER_PRESETS.includes(wp?.value) ? wp.value : 'plain' };
  return { iconSize, wallpaper };
}

// Moves links that share a cell to the next free cell. Links in `keep` win their cells.
function resolveClashes(links, cols, keep = new Set()) {
  const occupied = new Set(links.filter((link) => keep.has(link.id)).map((link) => cellKey(link.cell)));
  return links.map((link) => {
    if (keep.has(link.id)) return link;
    let cell = link.cell;
    if (occupied.has(cellKey(cell))) cell = firstFreeCell(occupied, cols, { col: 0, row: cell.row });
    occupied.add(cellKey(cell));
    return cell === link.cell ? link : { ...link, cell };
  });
}

function occupiedOf(layout) {
  return new Set(layout.links.map((link) => cellKey(link.cell)));
}

// items: [{ url, name?, nameEdited?, icon?, cell? }]. Invalid URLs are skipped.
export function addLinks(layout, items, { now, newId }) {
  const occupied = occupiedOf(layout);
  const added = [];
  for (const item of items) {
    if (!isWebUrl(item.url)) continue;
    // Any free cell is kept, even beyond the current width: narrow windows reflow for display only.
    const wanted = isCell(item.cell) ? item.cell : null;
    // A taken cell (say a link dropped on another) gives the next free one after it, not the top-left.
    const cell = wanted && !occupied.has(cellKey(wanted))
      ? { ...wanted }
      : firstFreeCell(occupied, layout.cols, wanted && wanted.col < layout.cols ? wanted : undefined);
    occupied.add(cellKey(cell));
    const name = String(item.name ?? '').trim().slice(0, MAX_NAME);
    added.push({
      id: newId(),
      url: item.url,
      name: name || hostOf(item.url),
      nameEdited: Boolean(item.nameEdited && name),
      icon: cleanIcon(item.icon, item.url),
      cell,
      createdAt: now,
      updatedAt: now,
    });
  }
  return { layout: { ...layout, links: [...layout.links, ...added] }, added };
}

export function updateLink(layout, id, patch, now) {
  let updated = null;
  const links = layout.links.map((link) => {
    if (link.id !== id) return link;
    const url = patch.url !== undefined && isWebUrl(patch.url) ? patch.url : link.url;
    const next = { ...link, url, updatedAt: now };
    if (patch.name !== undefined) {
      const name = String(patch.name).trim().slice(0, MAX_NAME);
      next.name = name || hostOf(url);
      next.nameEdited = Boolean(name) && (patch.nameEdited ?? true);
    }
    if (patch.icon !== undefined) next.icon = cleanIcon(patch.icon, url);
    updated = next;
    return next;
  });
  return { layout: { ...layout, links }, link: updated };
}

export function removeLinks(layout, ids) {
  const drop = new Set(ids);
  const removed = layout.links.filter((link) => drop.has(link.id));
  return { layout: { ...layout, links: layout.links.filter((link) => !drop.has(link.id)) }, removed };
}

// Puts removed links back with their ids. A cell taken meanwhile moves them to a free one.
export function restoreLinks(layout, links) {
  const occupied = occupiedOf(layout);
  const existing = new Set(layout.links.map((link) => link.id));
  const restored = [];
  for (const link of links) {
    if (existing.has(link.id)) continue;
    const cell = occupied.has(cellKey(link.cell)) ? firstFreeCell(occupied, layout.cols) : link.cell;
    occupied.add(cellKey(cell));
    restored.push({ ...link, cell });
  }
  return { layout: { ...layout, links: [...layout.links, ...restored] }, restored };
}

// cells: { id: { col, row } } for the links that changed. Unknown ids and invalid
// cells are ignored. A link outside the patch that now shares a cell moves aside.
export function setCells(layout, cells) {
  const moved = new Set();
  const links = layout.links.map((link) => {
    const cell = cells[link.id];
    if (!isCell(cell)) return link;
    moved.add(link.id);
    return { ...link, cell: { col: cell.col, row: cell.row } };
  });
  return { ...layout, links: resolveClashes(links, layout.cols, moved) };
}

export function findDuplicate(layout, url, exceptId) {
  return layout.links.find((link) => link.url === url && link.id !== exceptId) ?? null;
}
