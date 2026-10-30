// Imports from Firefox (most visited, bookmarks) and from an export file.
// Permission prompts are raised by the caller, synchronously in its click handler.

import { dataUrlToBlob, toIconPng } from '../lib/image.js';
import { isHttpUrl } from '../lib/url.js';
import { el, send } from './ui.js';

async function existingUrls() {
  const { layout } = await browser.storage.local.get('layout');
  return new Set((layout?.links ?? []).map((link) => link.url));
}

async function addSkippingDuplicates(items) {
  const have = await existingUrls();
  const fresh = [];
  for (const item of items) {
    if (!isHttpUrl(item.url) || have.has(item.url)) continue;
    have.add(item.url);
    fresh.push(item);
  }
  if (fresh.length) await send('addLinks', { items: fresh, meta: { fetchTitle: false } });
  return fresh.length;
}

export async function importTopSites() {
  const sites = await browser.topSites.get({ limit: 24, onePerDomain: true, includeFavicon: true });
  const items = [];
  for (const site of sites) {
    let iconData = null;
    if (site.favicon?.startsWith('data:image/')) {
      try {
        iconData = await toIconPng(await dataUrlToBlob(site.favicon));
      } catch {
        iconData = null;
      }
    }
    items.push({ url: site.url, name: site.title, nameEdited: false, icon: { kind: 'site' }, iconData });
  }
  return addSkippingDuplicates(items);
}

function collectBookmarks(node, path, out) {
  if (node.url) {
    if (isHttpUrl(node.url)) out.push({ id: node.id, url: node.url, title: node.title || node.url, folder: path });
    return;
  }
  const name = node.id === 'root________' ? '' : node.title;
  for (const child of node.children ?? []) collectBookmarks(child, name ? [...path, { id: node.id, title: name }] : path, out);
}

// Shows a picker with the bookmarks toolbar preselected. Resolves to the number imported.
export async function importBookmarks() {
  const [root] = await browser.bookmarks.getTree();
  const all = [];
  collectBookmarks(root, [], all);
  if (!all.length) return 0;

  const groups = new Map();
  for (const bookmark of all) {
    const key = bookmark.folder.map((f) => f.title).join(' › ') || 'Bookmarks';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(bookmark);
  }

  const dialog = el('dialog', { class: 'bookmark-picker', 'aria-labelledby': 'bm-title' });
  const list = el('div', { class: 'bookmark-list' });
  for (const [title, items] of groups) {
    const rows = items.map((bookmark) =>
      el('label', { class: 'bookmark-row' }, [
        el('input', {
          type: 'checkbox',
          value: bookmark.id,
          checked: bookmark.folder.some((f) => f.id === 'toolbar_____'),
        }),
        el('span', { text: bookmark.title }),
      ]),
    );
    list.append(el('fieldset', {}, [el('legend', { text: title }), ...rows]));
  }
  const cancel = el('button', { type: 'button', text: 'Cancel' });
  const confirm = el('button', { type: 'button', class: 'primary', text: 'Import selected' });
  dialog.append(
    el('h2', { id: 'bm-title', text: 'Import bookmarks' }),
    list,
    el('div', { class: 'button-row' }, [cancel, confirm]),
  );
  document.body.append(dialog);

  const chosen = await new Promise((resolve) => {
    cancel.addEventListener('click', () => resolve(null));
    dialog.addEventListener('cancel', () => resolve(null));
    confirm.addEventListener('click', () =>
      resolve(new Set([...list.querySelectorAll('input:checked')].map((input) => input.value))),
    );
    dialog.showModal();
  });
  dialog.close();
  dialog.remove();
  if (!chosen?.size) return 0;
  return addSkippingDuplicates(
    all
      .filter((bookmark) => chosen.has(bookmark.id))
      .map((bookmark) => ({ url: bookmark.url, name: bookmark.title, nameEdited: false, icon: { kind: 'site' } })),
  );
}

export async function readExportFile(file) {
  if (file.size > 50_000_000) throw new Error('That file is too large.');
  try {
    return JSON.parse(await file.text());
  } catch {
    throw new Error("That file isn't a Linkdesk export.");
  }
}

export const SITE_ACCESS = { origins: ['<all_urls>'] };

const IMPORTS = {
  topSites: importTopSites,
  bookmarks: importBookmarks,
};

// Call straight from a click handler: the permission request has to come first,
// synchronously. Resolves to the number imported, or null if the user said no.
export function requestImport(kind) {
  return browser.permissions.request({ permissions: [kind] }).then((ok) => (ok ? IMPORTS[kind]() : null));
}

export const importedMessage = (count) =>
  count ? `Imported ${count} ${count === 1 ? 'link' : 'links'}.` : 'Nothing new to import.';

// Keeps a "Fetch site icons and titles" checkbox in sync with the permission.
export function bindSiteAccess(checkbox) {
  const sync = () => browser.permissions.contains(SITE_ACCESS).then((ok) => {
    checkbox.checked = ok;
  });
  checkbox.addEventListener('change', () => {
    if (checkbox.checked) {
      browser.permissions.request(SITE_ACCESS).then((ok) => {
        checkbox.checked = ok;
        if (ok) send('retryIcons').catch(() => {});
      });
    } else {
      browser.permissions.remove(SITE_ACCESS);
    }
  });
  browser.permissions.onAdded.addListener(sync);
  browser.permissions.onRemoved.addListener(sync);
  sync();
}
