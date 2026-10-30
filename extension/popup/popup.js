// Toolbar popup: add the current page in one click, or edit name and icon first.

import { colorFor, graphemes, hostOf, isHttpUrl, letterFor } from '../lib/url.js';
import { send, swatches, tile } from '../shared/ui.js';

const $ = (id) => document.getElementById(id);
const form = $('compact');

const state = {
  tab: null,
  letter: '',
  color: '',
  letterTouched: false,
};

const kind = () => form.elements['icon-kind'].value;
const name = () => $('name').value.trim() || state.tab.title || hostOf(state.tab.url);

function previewLink() {
  const url = state.tab.url;
  if (kind() === 'letter') return { url, name: name(), icon: { kind: 'letter', text: state.letter, color: state.color } };
  return { url, name: name(), icon: { kind: kind() } };
}

function renderPreview() {
  const link = previewLink();
  // The tab's own favicon, shown as is; the stored copy is fetched by the background script.
  $('preview').replaceChildren(tile(link, kind() === 'site' ? state.tab.favIconUrl : null));
}

function note(text) {
  $('icon-note').textContent = text;
  $('icon-note').hidden = !text;
}

async function add() {
  const editing = !form.hidden;
  const k = editing ? kind() : 'site';
  const typed = $('name').value.trim();
  const item = {
    name: editing ? name() : state.tab.title,
    nameEdited: editing && Boolean(typed) && typed !== state.tab.title,
    icon: k === 'letter' ? { kind: 'letter', text: state.letter, color: state.color } : { kind: k },
  };
  $('add').disabled = true;
  try {
    await send('addFromTab', { tabId: state.tab.id, item });
    // A status region that changes is announced; the form stays, just inert, so focus isn't dropped.
    $('done').textContent = 'Added to your desktop';
    $('main').inert = true;
    setTimeout(() => window.close(), 900);
  } catch (error) {
    $('add').disabled = false;
    note(error.message);
  }
}

async function init() {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  state.tab = tab;
  const supported = isHttpUrl(tab?.url);
  $('page-title').textContent = tab?.title || 'This page';
  $('page-host').textContent = supported ? hostOf(tab.url) : '';
  if (!supported) {
    $('unsupported').hidden = false;
    $('add').hidden = true;
    $('edit-first').hidden = true;
    state.tab = { url: '', title: tab?.title ?? '' };
    renderPreview();
    return;
  }
  state.letter = letterFor(tab.title, tab.url);
  state.color = colorFor(tab.url);
  $('name').value = tab.title ?? '';
  $('letter').value = state.letter;
  $('colors').replaceChildren(
    swatches('popup-color', state.color, (color) => {
      state.color = color;
      form.elements['icon-kind'].value = 'letter';
      renderPreview();
    }),
  );
  const { layout } = await browser.storage.local.get('layout');
  $('dup').hidden = !(layout?.links ?? []).some((link) => link.url === tab.url);
  renderPreview();
  $('add').focus();
}

$('add').addEventListener('click', add);
$('edit-first').addEventListener('click', () => {
  form.hidden = !form.hidden;
  $('edit-first').setAttribute('aria-expanded', String(!form.hidden));
  if (!form.hidden) $('name').focus();
});
form.addEventListener('submit', (event) => {
  event.preventDefault();
  add();
});
form.addEventListener('change', () => renderPreview());
$('name').addEventListener('input', () => {
  if (!state.letterTouched) {
    state.letter = letterFor($('name').value, state.tab.url);
    $('letter').value = state.letter;
  }
  renderPreview();
});
$('letter').addEventListener('input', () => {
  state.letterTouched = true;
  state.letter = graphemes($('letter').value, 2);
  if ($('letter').value !== state.letter) $('letter').value = state.letter;
  form.elements['icon-kind'].value = 'letter';
  renderPreview();
});
init();
