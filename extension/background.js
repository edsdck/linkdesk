// Event page: owns every storage write, the context menus and icon fetching.

import { allowedIconUrls, fetchFirstIcon, fetchPageMeta, MAX_IMAGE_BYTES, typeHint } from './lib/fetcher.js';
import { rankIcons } from './lib/favicon.js';
import { dataUrlToBlob, toIconPng, toWallpaper } from './lib/image.js';
import {
  addLinks, emptyLayout, iconKey, isWebUrl, migrate, normalizeSettings, removeLinks, restoreLinks, setCells, updateLink,
  UserError,
} from './lib/model.js';
import { DESKTOP_IDS, ICON_ITEMS, menuId, PAGE_ITEMS } from './lib/menus.js';
import { buildExport, isSafeImageDataUrl, MAX_WALLPAPER_CHARS, validateImport } from './lib/transfer.js';
import { isHttpUrl } from './lib/url.js';

const NEWTAB_URL = browser.runtime.getURL('newtab/newtab.html');
const EXTENSION_ORIGIN = browser.runtime.getURL('');
const STALE_PENDING_MS = 60_000;
const MAX_PARALLEL_FETCHES = 4;
const IN_PAGE_TIMEOUT_MS = 5000;

// ---- storage, one writer ---------------------------------------------------

let chain = Promise.resolve();
function enqueue(task) {
  const run = chain.then(task);
  chain = run.catch(() => {});
  return run;
}

async function readLayout() {
  const { layout } = await browser.storage.local.get('layout');
  return migrate(layout);
}

const saveLayout = (layout) => browser.storage.local.set({ layout });
const newId = () => crypto.randomUUID();

// ---- icons and titles ------------------------------------------------------

const hasHostAccess = () => browser.permissions.contains({ origins: ['<all_urls>'] });

// Injected into a tab (activeTab). Must be self-contained.
function readIconLinksInPage() {
  const candidates = [...document.querySelectorAll('link[rel][href]')].map((el) => ({
    href: el.href,
    rel: el.getAttribute('rel'),
    sizes: el.getAttribute('sizes') ?? '',
    type: el.getAttribute('type') ?? '',
  }));
  return { candidates, base: document.baseURI, origin: location.origin };
}

// Injected into a tab (activeTab). Fetches same-site icons as the page. Must be self-contained.
async function fetchIconInPage(urls, maxBytes, timeoutMs) {
  for (const url of urls) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { credentials: 'omit', signal: controller.signal });
      if (!response.ok || Number(response.headers.get('content-length')) > maxBytes) continue;
      const blob = await response.blob();
      if (blob.size === 0 || blob.size > maxBytes) continue;
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
      });
      return { dataUrl, type: blob.type, source: url };
    } catch {
      // try the next one
    } finally {
      clearTimeout(timer);
    }
  }
  return null;
}

async function iconFromTab(tabId) {
  try {
    const [first] = await browser.scripting.executeScript({ target: { tabId }, func: readIconLinksInPage });
    const found = first?.result;
    if (!found) return null;
    const urls = rankIcons(found.candidates, found.base).filter((url) => {
      try {
        return new URL(url).origin === found.origin;
      } catch {
        return false;
      }
    });
    const [second] = await browser.scripting.executeScript({
      target: { tabId },
      func: fetchIconInPage,
      args: [urls, MAX_IMAGE_BYTES, IN_PAGE_TIMEOUT_MS],
    });
    const result = second?.result;
    if (!result) return null;
    return { data: await toIconPng(await dataUrlToBlob(result.dataUrl), typeHint(result.type, result.source)), source: result.source };
  } catch {
    return null;
  }
}

// Fetches what a link is missing (site icon, title) and stores it.
// opts: { tabId, favIconUrl, title, fetchTitle, retry }
async function resolveMeta(id, opts = {}) {
  const layout = await readLayout();
  const link = layout.links.find((item) => item.id === id);
  if (!link) return;
  const wantsIcon = link.icon.kind === 'site' && link.icon.status !== 'ok';
  const wantsTitle = !link.nameEdited && Boolean(opts.fetchTitle);
  if (!wantsIcon && !wantsTitle) return;
  // Tab hints (its favicon, title, the tab to read icons from) describe the URL the
  // link had when it was added; after an edit they belong to another page.
  if (opts.forUrl && opts.forUrl !== link.url) {
    opts = { ...opts, tabId: undefined, favIconUrl: undefined, title: undefined };
  }

  let icon = null;
  let title = opts.title ?? '';
  const tabIcon = isHttpUrl(opts.favIconUrl) || /^data:image\//.test(opts.favIconUrl ?? '') ? [opts.favIconUrl] : [];
  if (await hasHostAccess()) {
    // Refresh tries the icon it found last time first.
    const stored = opts.preferSource && link.icon.source ? [link.icon.source] : [];
    if (wantsIcon && stored.length) icon = await fetchFirstIcon(allowedIconUrls(stored, link.url));
    const meta = !icon || wantsTitle ? await fetchPageMeta(link.url) : { title: '', iconUrls: [] };
    title = title || meta.title;
    if (wantsIcon && !icon) icon = await fetchFirstIcon(allowedIconUrls([...tabIcon, ...meta.iconUrls], link.url));
  } else if (wantsIcon) {
    const dataIcon = tabIcon.filter((url) => url.startsWith('data:'));
    if (dataIcon.length) icon = await fetchFirstIcon(dataIcon);
    if (!icon && opts.tabId != null) icon = await iconFromTab(opts.tabId);
  }

  await enqueue(async () => {
    const current = await readLayout();
    const now = current.links.find((item) => item.id === id);
    if (!now || now.url !== link.url) return;
    const patch = {};
    // Skip parts the user changed while we were fetching.
    const iconUntouched = JSON.stringify(now.icon) === JSON.stringify(link.icon);
    if (wantsIcon && iconUntouched) {
      patch.icon = icon
        ? { kind: 'site', source: icon.source, status: 'ok', retries: 0 }
        : { kind: 'site', source: now.icon.source, status: 'failed', retries: now.icon.retries + (opts.retry ? 1 : 0) };
    }
    if (wantsTitle && !now.nameEdited && now.name === link.name && title) patch.name = title;
    if (!Object.keys(patch).length) return;
    if (patch.name !== undefined) patch.nameEdited = false;
    const { layout: next } = updateLink(current, id, patch, Date.now());
    const write = { layout: next };
    if (patch.icon?.status === 'ok') write[iconKey(id)] = icon.data;
    await browser.storage.local.set(write);
  });
}

// At most a few fetches at a time. A link is queued once; a request for a link that
// is already being fetched (say its URL was just edited) runs again afterwards.
const metaQueue = [];
const metaJobs = new Map(); // id → { opts, running, waiters, rerun }
let metaRunning = 0;

function scheduleMeta(id, opts) {
  return new Promise((resolve) => {
    const job = metaJobs.get(id);
    if (job && !job.running) {
      job.opts = { ...job.opts, ...opts };
      job.waiters.push(resolve);
    } else if (job) {
      job.rerun ??= { opts: {}, waiters: [] };
      job.rerun.opts = { ...job.rerun.opts, ...opts };
      job.rerun.waiters.push(resolve);
    } else {
      metaJobs.set(id, { opts, running: false, waiters: [resolve], rerun: null });
      metaQueue.push(id);
      pumpMeta();
    }
  });
}

function pumpMeta() {
  while (metaRunning < MAX_PARALLEL_FETCHES && metaQueue.length) {
    const id = metaQueue.shift();
    const job = metaJobs.get(id);
    job.running = true;
    metaRunning += 1;
    resolveMeta(id, job.opts)
      .catch(() => {})
      .finally(() => {
        metaRunning -= 1;
        metaJobs.delete(id);
        for (const done of job.waiters) done();
        if (job.rerun) {
          const { opts, waiters } = job.rerun;
          scheduleMeta(id, opts).then(() => waiters.forEach((done) => done()));
        }
        pumpMeta();
      });
  }
}

// ---- operations ------------------------------------------------------------

// items: [{ url, name, nameEdited, icon, cell, iconData }]
async function addItems(items, metaOpts = {}) {
  const added = await enqueue(async () => {
    const layout = await readLayout();
    // Same filter as addLinks, so added[i] belongs to prepared[i].
    const prepared = items.filter((item) => isWebUrl(item.url)).map((item) => ({
      ...item,
      icon: item.icon?.kind === 'site' && item.iconData ? { ...item.icon, status: 'ok' } : item.icon,
    }));
    const result = addLinks(layout, prepared, { now: Date.now(), newId });
    const write = { layout: result.layout };
    result.added.forEach((link, index) => {
      const data = prepared[index].iconData;
      if (data && link.icon.kind !== 'letter') write[iconKey(link.id)] = data;
    });
    await browser.storage.local.set(write);
    return result.added;
  });
  for (const link of added) {
    const fetchTitle = metaOpts.fetchTitle ?? !link.nameEdited;
    scheduleMeta(link.id, { ...metaOpts, fetchTitle, forUrl: link.url });
  }
  return added;
}

async function deleteItems(ids) {
  return enqueue(async () => {
    const layout = await readLayout();
    const { layout: next, removed } = removeLinks(layout, ids);
    const keys = removed.map((link) => iconKey(link.id));
    const icons = await browser.storage.local.get(keys);
    await browser.storage.local.set({ layout: next });
    await browser.storage.local.remove(keys);
    return removed.map((link) => ({ link, iconData: icons[iconKey(link.id)] ?? null }));
  });
}

async function restoreItems(items) {
  return enqueue(async () => {
    const layout = await readLayout();
    const { layout: next, restored } = restoreLinks(layout, items.map((item) => item.link));
    const write = { layout: next };
    for (const link of restored) {
      const data = items.find((item) => item.link.id === link.id)?.iconData;
      if (data) write[iconKey(link.id)] = data;
    }
    await browser.storage.local.set(write);
    return restored.map((link) => link.id);
  });
}

async function editLink({ id, patch, iconData, refetch, fetchTitle }) {
  await enqueue(async () => {
    const layout = await readLayout();
    const before = layout.links.find((item) => item.id === id);
    if (!before) throw new UserError('This link was deleted.');
    const sameUrl = patch.url === undefined || patch.url === before.url;
    let icon = patch.icon;
    if (patch.icon?.kind === 'site' && iconData) icon = { ...patch.icon, status: 'ok' };
    // Still a site icon for the same URL: keep the current state, which may have been
    // fetched after the editor opened.
    else if (patch.icon?.kind === 'site' && before.icon.kind === 'site' && sameUrl) icon = before.icon;
    const { layout: next, link } = updateLink(layout, id, { ...patch, icon }, Date.now());
    const write = { layout: next };
    if (iconData && link.icon.kind !== 'letter') write[iconKey(id)] = iconData;
    // A new URL or icon kind without new image data must not keep showing the old image.
    const stale = link.icon.kind === 'letter' || (!iconData && (link.url !== before.url || link.icon.kind !== before.icon.kind));
    if (stale) await browser.storage.local.remove(iconKey(id));
    await browser.storage.local.set(write);
  });
  if (refetch || fetchTitle) scheduleMeta(id, { fetchTitle: Boolean(fetchTitle) });
}

async function refreshIcon(id) {
  await enqueue(async () => {
    const layout = await readLayout();
    const link = layout.links.find((item) => item.id === id);
    if (!link || link.icon.kind !== 'site') return;
    const { layout: next } = updateLink(layout, id, { icon: { ...link.icon, status: 'pending' } }, Date.now());
    await saveLayout(next);
  });
  await scheduleMeta(id, { fetchTitle: false, preferSource: true });
}

async function retryIcons() {
  if (!(await hasHostAccess())) return;
  const layout = await readLayout();
  const now = Date.now();
  for (const link of layout.links) {
    if (link.icon.kind !== 'site') continue;
    const failed = link.icon.status === 'failed' && link.icon.retries < 1;
    const stale = link.icon.status === 'pending' && now - link.updatedAt > STALE_PENDING_MS;
    if (failed || stale) scheduleMeta(link.id, { retry: true, fetchTitle: false });
  }
}

// For the editor preview. `source` (the icon found last time) is tried first.
async function previewMeta(url, source) {
  if (!isHttpUrl(url) || !(await hasHostAccess())) return { access: false };
  const meta = await fetchPageMeta(url);
  const icon = await fetchFirstIcon(allowedIconUrls([...(isHttpUrl(source) ? [source] : []), ...meta.iconUrls], url));
  return { access: true, title: meta.title, iconData: icon?.data ?? null, source: icon?.source ?? null };
}

async function reencodeIcon(data) {
  try {
    return await toIconPng(await dataUrlToBlob(data));
  } catch {
    return null;
  }
}

async function importData(raw, mode) {
  const { items, settings, wallpaperImage } = validateImport(raw);
  for (const item of items) {
    if (!item.iconData) continue;
    item.iconData = await reencodeIcon(item.iconData);
    if (!item.iconData && item.icon.kind === 'upload') item.icon = { kind: 'letter' };
    if (!item.iconData && item.icon.kind === 'site') item.icon = { ...item.icon, status: 'failed' };
  }
  let wallpaper = null;
  if (wallpaperImage && mode === 'replace') {
    try {
      wallpaper = await toWallpaper(await dataUrlToBlob(wallpaperImage));
    } catch {
      wallpaper = null;
    }
  }
  if (mode === 'replace') {
    await enqueue(async () => {
      const all = await browser.storage.local.get(null);
      const cols = migrate(all.layout).cols;
      await browser.storage.local.remove(Object.keys(all).filter((key) => key.startsWith('icon:')));
      await browser.storage.local.set({ layout: { ...emptyLayout(), cols } });
    });
  }
  const added = await addItems(items, { fetchTitle: false });
  // Merge keeps the current settings; replace takes the file's.
  if (mode === 'replace') {
    const keepImage = settings.wallpaper.kind === 'image' && wallpaper;
    const write = { settings: keepImage ? settings : { ...settings, wallpaper: settings.wallpaper.kind === 'image' ? { kind: 'preset', value: 'plain' } : settings.wallpaper } };
    if (keepImage) write.wallpaperImage = wallpaper;
    else await browser.storage.local.remove('wallpaperImage');
    await browser.storage.local.set(write);
  }
  return { added: added.length, skipped: (raw.links?.length ?? 0) - added.length };
}

async function exportData() {
  const all = await browser.storage.local.get(null);
  const layout = migrate(all.layout);
  const icons = {};
  for (const link of layout.links) if (all[iconKey(link.id)]) icons[link.id] = all[iconKey(link.id)];
  const settings = normalizeSettings(all.settings);
  const wallpaperImage = settings.wallpaper.kind === 'image' ? all.wallpaperImage : null;
  return buildExport({ layout, settings, icons, wallpaperImage }, Date.now());
}

async function resetAll() {
  await enqueue(async () => {
    await browser.storage.local.clear();
    await browser.storage.local.set({ layout: emptyLayout(), settings: normalizeSettings({}) });
  });
}

const handlers = {
  addLinks: ({ items, meta }) => addItems(items, meta).then((links) => links.map((link) => link.id)),
  deleteLinks: ({ ids }) => deleteItems(ids),
  restoreLinks: ({ items }) => restoreItems(items),
  updateLink: (message) => editLink(message),
  setCells: ({ cells }) => enqueue(async () => saveLayout(setCells(await readLayout(), cells))),
  setCols: ({ cols }) =>
    enqueue(async () => {
      const layout = await readLayout();
      if (Number.isInteger(cols) && cols > 0 && layout.cols !== cols) await saveLayout({ ...layout, cols });
    }),
  setSettings: ({ patch }) =>
    enqueue(async () => {
      const { settings } = await browser.storage.local.get('settings');
      await browser.storage.local.set({ settings: normalizeSettings({ ...normalizeSettings(settings), ...patch }) });
    }),
  setWallpaperImage: ({ data }) =>
    enqueue(async () => {
      if (!isSafeImageDataUrl(data, MAX_WALLPAPER_CHARS)) throw new UserError('That image couldn’t be used.');
      const { settings } = await browser.storage.local.get('settings');
      const next = normalizeSettings({ ...normalizeSettings(settings), wallpaper: { kind: 'image' } });
      await browser.storage.local.set({ wallpaperImage: data, settings: next });
    }),
  refreshIcon: ({ id }) => refreshIcon(id),
  retryIcons: () => retryIcons(),
  previewMeta: ({ url, source }) => previewMeta(url, source),
  addFromTab: ({ tabId, item }) =>
    browser.tabs.get(tabId).then((tab) =>
      addItems([{ ...item, url: item.url ?? tab.url }], { tabId, favIconUrl: tab.favIconUrl, title: tab.title, fetchTitle: false }),
    ),
  importData: ({ data, mode }) => importData(data, mode),
  exportData: () => exportData(),
  reset: () => resetAll(),
};

browser.runtime.onMessage.addListener((message, sender) => {
  if (sender.id !== browser.runtime.id || !String(sender.url ?? '').startsWith(EXTENSION_ORIGIN)) return undefined;
  const handler = handlers[message?.type];
  if (!handler) return undefined;
  return Promise.resolve()
    .then(() => handler(message))
    .then(
      (result) => ({ ok: true, result }),
      (error) => ({ ok: false, error: error instanceof UserError ? error.message : 'Something went wrong.' }),
    );
});

// ---- context menus ---------------------------------------------------------

function createDesktopItems(items, contexts) {
  for (const [name, title] of items) {
    // Limited to the Linkdesk page by URL pattern, and hidden: the page shows them
    // (menus.onShown) only for right-clicks on the desktop or an icon.
    browser.menus.create({
      id: menuId(name),
      contexts,
      viewTypes: ['tab'],
      documentUrlPatterns: [`${NEWTAB_URL}*`],
      visible: false,
      ...(title ? { title } : { type: 'separator' }),
    });
  }
}

async function createMenus() {
  await browser.menus.removeAll();
  const web = ['http://*/*', 'https://*/*'];
  browser.menus.create({ id: 'add-page', title: 'Add page to Linkdesk', contexts: ['page'], documentUrlPatterns: web });
  browser.menus.create({
    id: 'add-link',
    title: 'Add link to Linkdesk',
    contexts: ['link'],
    documentUrlPatterns: web,
    targetUrlPatterns: web,
  });
  createDesktopItems(ICON_ITEMS, ['link']);
  createDesktopItems(PAGE_ITEMS, ['page']);
}

browser.runtime.onInstalled.addListener(async () => {
  await createMenus();
  const { layout, settings } = await browser.storage.local.get(['layout', 'settings']);
  if (!layout) await browser.storage.local.set({ layout: emptyLayout() });
  if (!settings) await browser.storage.local.set({ settings: normalizeSettings({}) });
});
browser.runtime.onStartup.addListener(createMenus);

// The desktop page shows its items per right-click; hide them again afterwards.
browser.menus.onHidden.addListener(() => {
  for (const id of DESKTOP_IDS) browser.menus.update(id, { visible: false });
});

function flashBadge(tabId) {
  browser.action.setBadgeBackgroundColor({ color: '#0061e0', tabId });
  browser.action.setBadgeText({ text: '✓', tabId });
  setTimeout(() => browser.action.setBadgeText({ text: '', tabId }), 2000);
}

browser.menus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === 'add-page' && tab && isHttpUrl(info.pageUrl)) {
    await addItems([{ url: info.pageUrl, name: tab.title, nameEdited: false, icon: { kind: 'site' } }], {
      tabId: tab.id,
      favIconUrl: tab.favIconUrl,
      fetchTitle: false,
    });
    flashBadge(tab.id);
  } else if (info.menuItemId === 'add-link' && tab && isHttpUrl(info.linkUrl)) {
    const name = String(info.linkText ?? '').trim();
    await addItems([{ url: info.linkUrl, name, nameEdited: false, icon: { kind: 'site' } }], { fetchTitle: !name });
    flashBadge(tab.id);
  }
});
