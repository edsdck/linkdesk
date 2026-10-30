// The link editor dialog (spec section 7).

import { toIconPng } from '../lib/image.js';
import { findDuplicate } from '../lib/model.js';
import { colorFor, graphemes, hostOf, letterFor, normalizeUrl } from '../lib/url.js';
import { openSettings, send, swatches, tile } from '../shared/ui.js';

const $ = (id) => document.getElementById(id);

const dialog = $('editor');
const form = $('editor-form');
const urlInput = $('editor-url');
const nameInput = $('editor-name');
const letterInput = $('editor-letter');
const preview = $('editor-preview');
const fileInput = $('editor-file');
const iconNote = $('editor-icon-note');

let session = null;

function kind() {
  return form.elements['icon-kind'].value;
}

function setKind(value) {
  form.elements['icon-kind'].value = value;
}

function currentUrl() {
  return normalizeUrl(urlInput.value);
}

function draftLink() {
  const url = currentUrl() ?? session.link?.url ?? '';
  const name = nameInput.value.trim() || hostOf(url);
  const k = kind();
  if (k === 'letter') return { url, name, icon: { kind: 'letter', text: session.letter || letterFor(name, url), color: session.color } };
  return { url, name, icon: { kind: k } };
}

function renderPreview() {
  const link = draftLink();
  const data = kind() === 'site' ? session.siteData : kind() === 'upload' ? session.uploadData : null;
  const node = tile(link, data);
  preview.replaceChildren(node);
}

function showNote(text, { settingsLink = false } = {}) {
  $('editor-icon-note-text').textContent = text ?? '';
  $('editor-open-settings').hidden = !settingsLink;
  iconNote.hidden = !text;
}

$('editor-open-settings').addEventListener('click', () => openSettings());

function renderColors() {
  $('editor-colors').replaceChildren(
    swatches('editor-color', session.color, (color) => {
      session.color = color;
      session.colorTouched = true;
      setKind('letter');
      renderPreview();
    }),
  );
}

async function fetchPreview() {
  const url = currentUrl();
  if (!url) return;
  const token = (session.fetchToken = Symbol('fetch'));
  showNote('Getting the site icon…');
  let meta;
  try {
    // The icon found last time is tried first (spec section 7, Refresh).
    const source = session.link?.url === url ? session.siteSource : null;
    meta = await send('previewMeta', { url, source });
  } catch {
    meta = { access: true, iconData: null };
  }
  if (!session || session.fetchToken !== token) return;
  if (!meta.access) {
    showNote('Turn on “Fetch site icons and titles” to get site icons.', { settingsLink: true });
    return;
  }
  session.siteData = meta.iconData;
  session.siteSource = meta.source;
  session.siteFetchedFor = url;
  if (meta.title && !session.nameTouched && !nameInput.value.trim()) nameInput.value = meta.title;
  showNote(meta.iconData ? '' : 'Couldn’t get the site icon.');
  renderPreview();
}

function checkUrl() {
  const url = currentUrl();
  const invalid = !url && Boolean(urlInput.value.trim());
  $('editor-url-error').hidden = !invalid;
  urlInput.setAttribute('aria-invalid', String(invalid));
  $('editor-dup').hidden = !url || !findDuplicate(session.layout, url, session.link?.id);
  // Describe the field only with the notes that are showing: hidden ones would still be read out.
  const notes = ['editor-url-error', 'editor-dup'].filter((id) => !$(id).hidden);
  if (notes.length) urlInput.setAttribute('aria-describedby', notes.join(' '));
  else urlInput.removeAttribute('aria-describedby');
  if (!session.letterTouched) {
    session.letter = letterFor(nameInput.value, url ?? '');
    letterInput.value = session.letter;
  }
  if (!session.colorTouched && url && !session.link?.icon.color) {
    session.color = colorFor(url);
    renderColors();
  }
  renderPreview();
  return url;
}

urlInput.addEventListener('input', () => checkUrl());
urlInput.addEventListener('change', () => {
  const url = checkUrl();
  if (url && kind() === 'site' && session.siteFetchedFor !== url) fetchPreview();
});
nameInput.addEventListener('input', () => {
  session.nameTouched = true;
  if (!session.letterTouched) {
    session.letter = letterFor(nameInput.value, currentUrl() ?? '');
    letterInput.value = session.letter;
  }
  renderPreview();
});
letterInput.addEventListener('input', () => {
  session.letterTouched = true;
  session.letter = graphemes(letterInput.value, 2);
  // Show the cut, so what's typed matches the tile.
  if (letterInput.value !== session.letter) letterInput.value = session.letter;
  setKind('letter');
  renderPreview();
});
form.addEventListener('change', (event) => {
  if (event.target.name !== 'icon-kind') return;
  if (kind() !== 'site') showNote('');
  if (kind() === 'site' && currentUrl() && session.siteFetchedFor !== currentUrl()) fetchPreview();
  renderPreview();
});
$('editor-refresh').addEventListener('click', () => {
  setKind('site');
  session.siteFetchedFor = null;
  fetchPreview();
});
$('editor-choose').addEventListener('click', () => fileInput.click());
// Clicking "Upload" with the mouse opens the picker; arrowing through the radios must not.
form.querySelector('input[name="icon-kind"][value="upload"]').addEventListener('click', (event) => {
  if (event.detail > 0 && !session?.uploadData) fileInput.click();
});
fileInput.addEventListener('change', async () => {
  const file = fileInput.files[0];
  fileInput.value = '';
  if (!file || !session) return;
  const current = session;
  try {
    const data = await toIconPng(file, file.type || file.name);
    if (session !== current) return; // the dialog was closed meanwhile
    session.uploadData = data;
    setKind('upload');
    showNote('');
  } catch {
    if (session !== current) return;
    showNote('That image couldn’t be read.');
  }
  renderPreview();
});
// Pasting an image anywhere in the dialog (outside text fields) uses it as the icon.
dialog.addEventListener('paste', async (event) => {
  const file = [...(event.clipboardData?.files ?? [])].find((f) => f.type.startsWith('image/'));
  if (!file || !session) return;
  event.preventDefault();
  const current = session;
  try {
    const data = await toIconPng(file, file.type);
    if (session !== current) return;
    session.uploadData = data;
    setKind('upload');
    renderPreview();
  } catch {
    if (session === current) showNote('That image couldn’t be read.');
  }
});

$('editor-cancel').addEventListener('click', () => dialog.close());
$('editor-delete').addEventListener('click', () => {
  const { link, onDelete } = session;
  dialog.close();
  onDelete(link);
});
dialog.addEventListener('close', () => {
  session = null;
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const url = checkUrl();
  if (!url) {
    $('editor-url-error').hidden = false;
    urlInput.focus();
    return;
  }
  const name = nameInput.value.trim();
  const k = kind();
  let icon;
  let iconData = null;
  if (k === 'letter') {
    icon = { kind: 'letter', text: session.letter || letterFor(name, url), color: session.color };
  } else if (k === 'upload') {
    if (!session.uploadData) {
      showNote('Choose an image first.');
      $('editor-choose').focus();
      return;
    }
    icon = { kind: 'upload' };
    iconData = session.uploadData;
  } else {
    const fresh = session.siteFetchedFor === url && session.siteData;
    icon = { kind: 'site', source: fresh ? session.siteSource : undefined, status: fresh ? 'ok' : 'pending' };
    iconData = fresh ? session.siteData : null;
  }
  const { link, cell, onSaved } = session;
  const nameEdited = Boolean(name) && (session.nameTouched || Boolean(link?.nameEdited));
  dialog.close();
  try {
    if (link) {
      const keepSite = k === 'site' && link.icon.kind === 'site' && link.url === url && !iconData;
      // A new URL with a name the user never edited: take the new site's title.
      const retitle = link.url !== url && !nameEdited;
      await send('updateLink', {
        id: link.id,
        patch: { url, name: retitle ? '' : name, nameEdited, icon: keepSite ? link.icon : icon },
        iconData,
        refetch: k === 'site' && !iconData && !keepSite,
        fetchTitle: retitle,
      });
      onSaved?.({ type: 'edit', link });
    } else {
      const ids = await send('addLinks', {
        items: [{ url, name, nameEdited, icon, iconData, cell }],
        meta: { fetchTitle: !name },
      });
      onSaved?.({ type: 'add', ids, name: name || hostOf(url) });
    }
  } catch (error) {
    onSaved?.({ type: 'error', message: error.message });
  }
});

// opts: { link?, iconData?, layout, cell?, onSaved, onDelete }
export function openEditor(opts) {
  const { link = null, iconData = null, layout } = opts;
  session = {
    ...opts,
    link,
    layout,
    siteData: link?.icon.kind === 'site' ? iconData : null,
    siteSource: link?.icon.source ?? null,
    siteFetchedFor: link?.icon.kind === 'site' && iconData ? link.url : null,
    uploadData: link?.icon.kind === 'upload' ? iconData : null,
    letter: link?.icon.kind === 'letter' ? link.icon.text : letterFor(link?.name ?? '', link?.url ?? ''),
    color: link?.icon.kind === 'letter' ? link.icon.color : colorFor(link?.url ?? ''),
    nameTouched: false,
    letterTouched: link?.icon.kind === 'letter',
    colorTouched: link?.icon.kind === 'letter',
  };
  $('editor-title').textContent = link ? 'Edit link' : 'New link';
  $('editor-delete').hidden = !link;
  urlInput.value = link?.url ?? '';
  nameInput.value = link?.name ?? '';
  letterInput.value = session.letter;
  setKind(link?.icon.kind ?? 'site');
  $('editor-url-error').hidden = true;
  showNote('');
  renderColors();
  checkUrl();
  dialog.showModal();
  (link ? nameInput : urlInput).focus();
}
