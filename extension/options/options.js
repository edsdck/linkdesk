// Settings page (spec section 10).

import { toWallpaper } from '../lib/image.js';
import { normalizeSettings } from '../lib/model.js';
import { bindSiteAccess, importedMessage, readExportFile, requestImport } from '../shared/importers.js';
import { el, send, WALLPAPERS } from '../shared/ui.js';

const $ = (id) => document.getElementById(id);

let settings = normalizeSettings(null);
let wallpaperImage = null;

function status(text) {
  $('status').textContent = text;
}

function renderWallpapers() {
  const options = Object.entries(WALLPAPERS).map(([value, { label, css }]) => {
    const input = el('input', {
      type: 'radio',
      name: 'wallpaper',
      value,
      'aria-label': label,
      checked: settings.wallpaper.kind === 'preset' && settings.wallpaper.value === value,
    });
    const swatch = el('span', { title: label });
    swatch.style.background = css;
    return el('label', {}, [input, swatch]);
  });
  if (wallpaperImage) {
    const input = el('input', {
      type: 'radio',
      name: 'wallpaper',
      value: 'image',
      'aria-label': 'Your image',
      checked: settings.wallpaper.kind === 'image',
    });
    const swatch = el('span', { title: 'Your image' });
    swatch.style.backgroundImage = `url("${wallpaperImage}")`;
    options.push(el('label', {}, [input, swatch]));
  }
  $('wallpapers').replaceChildren(...options);
}

function render() {
  for (const input of document.querySelectorAll('input[name="icon-size"]')) input.checked = input.value === settings.iconSize;
  renderWallpapers();
}

async function load() {
  const all = await browser.storage.local.get(['settings', 'wallpaperImage']);
  settings = normalizeSettings(all.settings);
  wallpaperImage = all.wallpaperImage ?? null;
  render();
}

function saveSettings(patch) {
  send('setSettings', { patch }).catch((error) => status(error.message));
}

document.addEventListener('change', (event) => {
  const { name, value } = event.target;
  if (name === 'icon-size') saveSettings({ iconSize: value });
  if (name === 'wallpaper') saveSettings({ wallpaper: value === 'image' ? { kind: 'image' } : { kind: 'preset', value } });
});

$('wallpaper-upload').addEventListener('click', () => $('wallpaper-file').click());
$('wallpaper-file').addEventListener('change', async (event) => {
  const file = event.target.files[0];
  event.target.value = '';
  if (!file) return;
  const note = $('wallpaper-note');
  note.hidden = false;
  note.textContent = 'Preparing image…';
  try {
    await send('setWallpaperImage', { data: await toWallpaper(file) });
    note.hidden = true;
  } catch {
    note.textContent = 'That image couldn’t be used.';
  }
});

bindSiteAccess($('site-access'));

for (const [id, kind] of [['import-top', 'topSites'], ['import-bookmarks', 'bookmarks']]) {
  $(id).addEventListener('click', () => {
    requestImport(kind).then(
      (count) => count !== null && status(importedMessage(count)),
      (error) => status(error.message),
    );
  });
}

$('export').addEventListener('click', async () => {
  try {
    const data = await send('exportData');
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    const stamp = new Date().toISOString().slice(0, 10);
    const link = el('a', { href: url, download: `linkdesk-${stamp}.json` });
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    status('Exported.');
  } catch (error) {
    status(error.message);
  }
});

function ask(dialog) {
  return new Promise((resolve) => {
    const finish = (value) => {
      dialog.removeEventListener('click', onClick);
      dialog.removeEventListener('cancel', onCancel);
      if (dialog.open) dialog.close();
      resolve(value);
    };
    const onClick = (event) => {
      const value = event.target.closest('button')?.value;
      if (value) finish(value);
    };
    const onCancel = () => finish('cancel');
    dialog.addEventListener('click', onClick);
    dialog.addEventListener('cancel', onCancel);
    dialog.showModal();
  });
}

$('import-file-button').addEventListener('click', () => $('import-file').click());
$('import-file').addEventListener('change', async (event) => {
  const file = event.target.files[0];
  event.target.value = '';
  if (!file) return;
  try {
    const data = await readExportFile(file);
    const mode = await ask($('import-mode'));
    if (mode === 'cancel') return;
    status('Importing…');
    const { added } = await send('importData', { data, mode });
    status(importedMessage(added));
  } catch (error) {
    status(error.message);
  }
});

$('reset').addEventListener('click', async () => {
  if ((await ask($('reset-confirm'))) !== 'reset') return;
  try {
    await send('reset');
    status('Your desktop was reset.');
  } catch (error) {
    status(error.message);
  }
});

function focusSection(id) {
  const section = id && document.getElementById(id);
  if (!section) return;
  for (const other of document.querySelectorAll('.setting.highlight')) other.classList.remove('highlight');
  section.classList.add('highlight');
  section.scrollIntoView({ block: 'center' });
  section.querySelector('input, button')?.focus();
}

// The desktop's Settings… / Wallpaper… reuse this tab when it's already open.
browser.runtime.onMessage.addListener((message) => {
  if (message?.type !== 'settings:show') return undefined;
  return (async () => {
    const tab = await browser.tabs.getCurrent();
    await browser.tabs.update(tab.id, { active: true });
    await browser.windows.update(tab.windowId, { focused: true });
    focusSection(message.section);
    return 'shown';
  })();
});

browser.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.settings) settings = normalizeSettings(changes.settings.newValue);
  if (changes.wallpaperImage) wallpaperImage = changes.wallpaperImage.newValue ?? null;
  if (changes.settings || changes.wallpaperImage) render();
});

load().then(() => focusSection(location.hash.slice(1)));
