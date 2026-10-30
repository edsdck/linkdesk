// The desktop: grid of links, moving, selection, menus, paste and drop, undo.

import * as grid from '../lib/grid.js';
import { DESKTOP_IDS, MIN_PASTE_VERSION, PASTE_ID } from '../lib/menus.js';
import { migrate, normalizeSettings } from '../lib/model.js';
import { hostOf, parseLinkText } from '../lib/url.js';
import { bindSiteAccess, importedMessage, readExportFile, requestImport } from '../shared/importers.js';
import { applyWallpaper, el, followFirefoxTheme, loadState, openSettings, send, tile } from '../shared/ui.js';
import { openEditor } from './editor.js';

const $ = (id) => document.getElementById(id);
const desktop = $('desktop');
const gridEl = $('grid');
const dotsEl = $('dots');
const dropEl = $('drop-target');
const bandEl = $('band');

// The single source for icon sizes; CSS reads them as variables.
const SIZES = {
  s: { tile: 40, w: 88, h: 96 },
  m: { tile: 48, w: 100, h: 108 },
  l: { tile: 64, w: 120, h: 128 },
};
const PAD = 24;
const DRAG_THRESHOLD = 4;
const TOAST_MS = 6000;
const SCROLL_EDGE = 40;
const DIRECTIONS = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' };

const state = {
  stored: migrate(null), // layout as last read from storage
  layout: migrate(null), // stored + local moves not yet confirmed
  settings: normalizeSettings(null),
  icons: new Map(),
  wallpaperImage: null,
  cols: 1,
  display: new Map(),
  selected: new Set(),
  focusId: null,
  tabId: null,
  menuTarget: null,
  menuCell: null,
};

// Cells this tab has moved but storage hasn't echoed back yet. Applied on top of
// every storage update, so an older echo never pulls an icon back mid-sequence.
const pendingCells = new Map();

let press = null; // pointer down on an icon, not yet a drag
let drag = null; // icon being moved
let band = null; // selection rectangle
let renaming = null; // id of the icon whose label is being edited
let swallowRelease = false; // a drag was cancelled with Esc while the button is still down
let renderQueued = false;
let ready = false;
let changedBeforeReady = false;
const undoStack = [];

// ---- geometry --------------------------------------------------------------

const metrics = () => SIZES[state.settings.iconSize];
const linkById = (id) => state.layout.links.find((link) => link.id === id) ?? null;
const iconEl = (id) => (id ? gridEl.querySelector(`.icon[data-id="${CSS.escape(id)}"]`) : null);

function cellPos({ col, row }) {
  const { w, h } = metrics();
  return { left: PAD + col * w, top: PAD + row * h };
}

// Grid cell under a viewport point, or null when outside the desktop.
function cellAt(clientX, clientY) {
  const rect = desktop.getBoundingClientRect();
  if (clientX < rect.left || clientX >= rect.right || clientY < rect.top || clientY >= rect.bottom) return null;
  const { w, h } = metrics();
  const col = Math.floor((clientX - rect.left - PAD) / w);
  const row = Math.floor((clientY - rect.top + desktop.scrollTop - PAD) / h);
  if (col < 0 || col >= state.cols || row < 0) return null;
  return { col, row };
}

// ---- state -----------------------------------------------------------------

function refreshLayout() {
  // A pending move is done once storage shows it.
  for (const link of state.stored.links) {
    const cell = pendingCells.get(link.id);
    if (cell && cell.col === link.cell.col && cell.row === link.cell.row) pendingCells.delete(link.id);
  }
  const links = state.stored.links.map((link) => {
    const cell = pendingCells.get(link.id);
    return cell ? { ...link, cell } : link;
  });
  state.layout = { ...state.stored, links };
}

// Saves the cells that differ from the saved ones (including icons that were only
// displaced by a narrow window) and returns the previous saved cells for undo.
function saveCells(next) {
  const changed = {};
  const previous = {};
  for (const link of state.layout.links) {
    const cell = next.get(link.id);
    if (!cell || (cell.col === link.cell.col && cell.row === link.cell.row)) continue;
    changed[link.id] = { ...cell };
    previous[link.id] = { ...link.cell };
  }
  if (!Object.keys(changed).length) return null;
  for (const [id, cell] of Object.entries(changed)) pendingCells.set(id, cell);
  refreshLayout();
  render();
  const forget = () => {
    for (const [id, cell] of Object.entries(changed)) if (pendingCells.get(id) === cell) pendingCells.delete(id);
    refreshLayout();
    scheduleRender();
  };
  send('setCells', { cells: changed }).then(
    // Normally the storage echo clears these; the timer covers another tab moving them first.
    () => setTimeout(forget, 2000),
    (error) => {
      showToast(error.message);
      forget();
    },
  );
  return previous;
}

// ---- rendering -------------------------------------------------------------

// Updates an existing icon in place (so a press or focus survives a re-render), or makes a new one.
function iconNode(link, existing) {
  const node = existing ?? el('a', { class: 'icon', draggable: 'false', tabindex: '-1', dataset: { id: link.id } }, [
    el('span', { class: 'tile' }),
    el('span', { class: 'label' }),
  ]);
  const iconData = state.icons.get(link.id);
  const look = JSON.stringify([link.url, link.name, link.icon, iconData?.length, iconData?.slice(-32)]);
  if (node.dataset.look !== look) {
    node.dataset.look = look;
    node.href = link.url;
    node.title = link.name;
    node.querySelector('.tile').replaceWith(tile(link, iconData));
    const label = node.querySelector('.label');
    if (label) label.textContent = link.name;
  }
  markSelected(node, state.selected.has(link.id));
  const { left, top } = cellPos(state.display.get(link.id));
  node.style.left = `${left}px`;
  node.style.top = `${top}px`;
  return node;
}

// Visible highlight plus hidden text, so screen readers hear "…, selected" on the link.
function markSelected(node, on) {
  let note = node.querySelector('.selected-note');
  if (on) {
    node.dataset.selected = 'true';
    if (!note) node.append(el('span', { class: 'selected-note sr-only', text: ', selected' }));
  } else {
    delete node.dataset.selected;
    note?.remove();
  }
}

function readingOrder() {
  return [...state.display].sort(([, a], [, b]) => a.row - b.row || a.col - b.col).map(([id]) => id);
}

function updateTabStops() {
  const order = readingOrder();
  const stop = state.focusId && order.includes(state.focusId) ? state.focusId : order[0];
  for (const node of gridEl.children) node.tabIndex = node.dataset.id === stop ? 0 : -1;
}

function render() {
  renderQueued = false;
  if (drag || renaming) {
    renderQueued = true;
    return;
  }
  const size = metrics();
  desktop.dataset.size = state.settings.iconSize;
  desktop.style.setProperty('--tile', `${size.tile}px`);
  desktop.style.setProperty('--cell-w', `${size.w}px`);
  desktop.style.setProperty('--cell-h', `${size.h}px`);
  applyWallpaper(desktop, state.settings, state.wallpaperImage);
  state.cols = grid.columnsFor(desktop.clientWidth, size.w, PAD);
  state.display = grid.displayCells(state.layout.links, state.cols);

  const ids = new Set(state.layout.links.map((link) => link.id));
  for (const id of state.selected) if (!ids.has(id)) state.selected.delete(id);
  if (state.focusId && !ids.has(state.focusId)) state.focusId = null;

  const hadFocus = gridEl.contains(document.activeElement);
  const byId = new Map(state.layout.links.map((link) => [link.id, link]));
  const existing = new Map([...gridEl.children].map((node) => [node.dataset.id, node]));
  const nodes = readingOrder().map((id) => iconNode(byId.get(id), existing.get(id)));
  // Only touch the DOM order when it changed; moving a node would drop an in-progress press.
  const sameOrder = nodes.length === gridEl.children.length && nodes.every((node, i) => gridEl.children[i] === node);
  if (!sameOrder) gridEl.replaceChildren(...nodes);
  let maxRow = -1;
  for (const cell of state.display.values()) maxRow = Math.max(maxRow, cell.row);
  gridEl.style.height = `${PAD * 2 + (maxRow + 2) * size.h}px`;
  const empty = $('empty');
  // Focus inside the first-run card would be lost when it hides; move it to the first link.
  const leavingCard = state.layout.links.length > 0 && !empty.hidden && empty.contains(document.activeElement);
  empty.hidden = state.layout.links.length > 0;
  updateTabStops();
  if (hadFocus) (iconEl(state.focusId) ?? desktop).focus({ preventScroll: true });
  else if (leavingCard) iconEl(readingOrder()[0])?.focus({ preventScroll: true });
}

function scheduleRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(render);
}

// The column count is shared with the background (for links added from the toolbar or
// menus). Only the window the user is looking at reports it, and only when it changes.
let colsTimer = 0;
function reportColsSoon() {
  clearTimeout(colsTimer);
  colsTimer = setTimeout(() => {
    if (document.visibilityState !== 'visible' || !document.hasFocus()) return;
    if (state.cols !== state.stored.cols) send('setCols', { cols: state.cols }).catch(() => {});
  }, 500);
}

// ---- feedback: live region, toast, undo ------------------------------------

function announce(text) {
  const live = $('live');
  live.textContent = '';
  requestAnimationFrame(() => {
    live.textContent = text;
  });
}

const toast = { node: $('toast'), timer: 0, entry: null, paused: false };

function hideToast() {
  clearTimeout(toast.timer);
  toast.node.hidden = true;
  toast.entry = null;
  toast.paused = false;
}

function armToast() {
  clearTimeout(toast.timer);
  if (!toast.paused) toast.timer = setTimeout(hideToast, TOAST_MS);
}

// Every toast is also read out once through the live region.
function showToast(text, entry = null) {
  $('toast-text').textContent = text;
  $('toast-undo').hidden = !entry;
  toast.entry = entry;
  toast.node.hidden = false;
  armToast();
  announce(text);
}

for (const [type, paused] of [['pointerenter', true], ['pointerleave', false], ['focusin', true], ['focusout', false]]) {
  toast.node.addEventListener(type, () => {
    toast.paused = paused;
    if (paused) clearTimeout(toast.timer);
    else armToast();
  });
}
$('toast-undo').addEventListener('click', async () => {
  await undo(toast.entry);
  // The button just hid itself; keep focus on the desktop.
  (iconEl(state.focusId) ?? desktop).focus({ preventScroll: true });
});

// entry: { kind: 'cells' | 'restore' | 'remove' | 'rename', ready?, ... }. Undo lives only in this tab.
function pushUndo(entry, message) {
  entry.message = message;
  undoStack.push(entry);
  if (undoStack.length > 50) undoStack.shift();
  showToast(message, entry);
}

async function undo(entry = undoStack.at(-1)) {
  if (!entry) return;
  const index = undoStack.lastIndexOf(entry);
  if (index >= 0) undoStack.splice(index, 1);
  hideToast();
  try {
    await entry.ready; // a delete pushes its entry before the reply with the removed links arrives
    if (entry.kind === 'cells') {
      saveCells(new Map(Object.entries(entry.cells)));
    } else if (entry.kind === 'restore') {
      await send('restoreLinks', { items: entry.items });
    } else if (entry.kind === 'remove') {
      await send('deleteLinks', { ids: entry.ids });
    } else if (entry.kind === 'rename') {
      await send('updateLink', { id: entry.id, patch: { name: entry.name, nameEdited: entry.nameEdited } });
    }
    announce(`Undone: ${entry.message}`);
  } catch (error) {
    showToast(error.message);
    await resync();
  }
}

// After a failed write, drop optimistic local changes and show what storage has.
async function resync() {
  applyStored(await loadState());
  render();
}

// ---- actions ---------------------------------------------------------------

function commitMove(id, target, message = `Moved “${linkById(id)?.name}”`) {
  const from = state.display.get(id);
  if (!from || (from.col === target.col && from.row === target.row)) return false;
  const previous = saveCells(grid.moveTo(state.display, id, target));
  if (!previous) return false;
  pushUndo({ kind: 'cells', cells: previous }, message);
  return true;
}

function packGrid() {
  const previous = saveCells(grid.pack(state.display, state.cols));
  if (previous) pushUndo({ kind: 'cells', cells: previous }, 'Packed to top-left');
  else showToast('Already packed');
}

// The icon keyboard focus goes to after `ids` are deleted.
function focusAfterDelete(ids) {
  const gone = new Set(ids);
  const order = readingOrder();
  const index = order.indexOf(state.focusId);
  if (index < 0 || !gone.has(state.focusId)) return state.focusId;
  return order.slice(index + 1).find((id) => !gone.has(id)) ?? order.slice(0, index).reverse().find((id) => !gone.has(id)) ?? null;
}

async function deleteIds(ids) {
  if (!ids.length) return;
  const names = ids.map((id) => linkById(id)?.name ?? '');
  state.focusId = focusAfterDelete(ids);
  state.stored = { ...state.stored, links: state.stored.links.filter((link) => !ids.includes(link.id)) };
  refreshLayout();
  for (const id of ids) state.selected.delete(id);
  render();
  // Pushed now, so Ctrl+Z straight after Delete undoes this delete and not the step before.
  const entry = { kind: 'restore', items: [] };
  const reply = send('deleteLinks', { ids });
  entry.ready = reply.then((removed) => {
    entry.items = removed;
  });
  pushUndo(entry, ids.length === 1 ? `Deleted “${names[0]}”` : `Deleted ${ids.length} links`);
  try {
    await entry.ready;
  } catch (error) {
    const index = undoStack.indexOf(entry);
    if (index >= 0) undoStack.splice(index, 1); // Ctrl+Z may have taken it already
    showToast(error.message);
    await resync();
  }
}

async function addFromText(text, cell, title = '') {
  const url = parseLinkText(text);
  if (!url) {
    showToast('That’s not a link');
    return;
  }
  try {
    const ids = await send('addLinks', {
      items: [{ url, name: title, nameEdited: false, icon: { kind: 'site' }, cell }],
      meta: { fetchTitle: !title },
    });
    pushUndo({ kind: 'remove', ids }, `Added “${title || hostOf(url)}”`);
  } catch (error) {
    showToast(error.message);
  }
}

function openLinkEditor(link, cell = null) {
  openEditor({
    link,
    iconData: link ? state.icons.get(link.id) : null,
    layout: state.layout,
    cell,
    onSaved: (result) => {
      if (result.type === 'add') pushUndo({ kind: 'remove', ids: result.ids }, `Added “${result.name}”`);
      if (result.type === 'error') showToast(result.message);
    },
    onDelete: (deleted) => deleteIds([deleted.id]),
  });
}

function setSelection(ids) {
  state.selected = new Set(ids);
  for (const node of gridEl.children) markSelected(node, state.selected.has(node.dataset.id));
}

function selectionCount() {
  const n = state.selected.size;
  return n === 1 ? '1 link selected' : `${n} links selected`;
}

function startRename(id) {
  const node = iconEl(id);
  const link = linkById(id);
  if (!node || !link || renaming) return;
  renaming = id;
  const input = el('input', { type: 'text', class: 'rename', value: link.name, maxlength: '200', 'aria-label': 'Name' });
  node.querySelector('.label').replaceWith(input);
  let done = false;
  // refocus: Enter/Esc keep focus on the icon; a blur (Tab, click elsewhere) lets it go.
  const finish = (save, refocus) => {
    if (done) return;
    done = true;
    renaming = null;
    const name = input.value.trim();
    input.replaceWith(el('span', { class: 'label', text: link.name }));
    delete node.dataset.look;
    if (save && name && name !== link.name) {
      state.stored = {
        ...state.stored,
        links: state.stored.links.map((item) => (item.id === id ? { ...item, name, nameEdited: true } : item)),
      };
      refreshLayout();
      pushUndo({ kind: 'rename', id, name: link.name, nameEdited: link.nameEdited }, `Renamed “${name}”`);
      send('updateLink', { id, patch: { name, nameEdited: true } }).catch((error) => {
        showToast(error.message);
        resync();
      });
    }
    state.focusId = id;
    render();
    if (refocus) iconEl(id)?.focus();
  };
  // The input sits inside the link: keep clicks from following it.
  input.addEventListener('click', (event) => event.preventDefault());
  input.addEventListener('pointerdown', (event) => event.stopPropagation());
  input.addEventListener('keydown', (event) => {
    event.stopPropagation();
    if (event.key === 'Enter') {
      event.preventDefault();
      finish(true, true);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      finish(false, true);
    }
  });
  input.addEventListener('blur', () => finish(true, false));
  input.focus();
  input.select();
}

// ---- moving with the pointer -----------------------------------------------

function showDots(origin) {
  const { w, h, tile: size } = metrics();
  const rows = Math.max(Math.ceil((gridEl.offsetHeight - PAD) / h), Math.ceil((desktop.clientHeight - PAD) / h));
  const taken = grid.occupiedSet(state.display);
  const nodes = [];
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < state.cols; col += 1) {
      if (taken.has(grid.cellKey({ col, row }))) continue;
      const dot = el('span', { class: 'dot' });
      dot.style.left = `${PAD + col * w + w / 2}px`;
      dot.style.top = `${PAD + row * h + 8 + size / 2}px`;
      nodes.push(dot);
    }
  }
  const outline = el('span', { class: 'ghost-origin' });
  const pos = cellPos(origin);
  outline.style.left = `${pos.left + (w - size) / 2}px`;
  outline.style.top = `${pos.top + 8}px`;
  nodes.push(outline);
  dotsEl.replaceChildren(...nodes);
}

function showDropTarget(cell, movingId = null) {
  if (!cell) {
    dropEl.hidden = true;
    return;
  }
  const { left, top } = cellPos(cell);
  const other = grid.idAt(state.display, cell);
  dropEl.style.left = `${left}px`;
  dropEl.style.top = `${top}px`;
  // Only moving an icon swaps; a link dropped from outside goes to the next free cell.
  dropEl.classList.toggle('swap', Boolean(movingId && other && other !== movingId));
  dropEl.hidden = false;
}

function startDrag(event) {
  const node = iconEl(press.id);
  if (!node) {
    press = null;
    return;
  }
  const ghost = node.querySelector('.tile').cloneNode(true);
  ghost.classList.add('drag-ghost');
  ghost.style.setProperty('--tile', `${metrics().tile}px`);
  document.body.append(ghost);
  node.classList.add('origin');
  // Capture, so releasing outside the window still ends (and cancels) the move.
  gridEl.setPointerCapture(event.pointerId);
  drag = { id: press.id, ghost, node, origin: state.display.get(press.id), target: null, x: 0, y: 0, scroller: 0 };
  press = null;
  showDots(drag.origin);
  updateDrag(event);
}

// Scrolls while the pointer rests near the top or bottom edge during a move.
function autoScroll() {
  if (!drag) return;
  const rect = desktop.getBoundingClientRect();
  let delta = 0;
  if (drag.y < rect.top + SCROLL_EDGE) delta = -12;
  else if (drag.y > rect.bottom - SCROLL_EDGE && drag.y < rect.bottom) delta = 12;
  const before = desktop.scrollTop;
  if (delta) desktop.scrollTop += delta;
  if (desktop.scrollTop !== before) {
    drag.target = cellAt(drag.x, drag.y);
    showDropTarget(drag.target, drag.id);
    drag.scroller = requestAnimationFrame(autoScroll);
  } else {
    drag.scroller = 0; // at the edge already, or not near one: stop until the pointer moves
  }
}

function updateDrag(event) {
  drag.x = event.clientX;
  drag.y = event.clientY;
  drag.ghost.style.left = `${event.clientX}px`;
  drag.ghost.style.top = `${event.clientY}px`;
  drag.target = cellAt(event.clientX, event.clientY);
  showDropTarget(drag.target, drag.id);
  if (!drag.scroller) drag.scroller = requestAnimationFrame(autoScroll);
}

function swallowNextClick() {
  const stop = (event) => {
    event.preventDefault();
    event.stopPropagation();
  };
  window.addEventListener('click', stop, { capture: true, once: true });
  setTimeout(() => window.removeEventListener('click', stop, { capture: true }), 0);
}

function endDrag(commit) {
  const { id, ghost, node, target, scroller } = drag;
  cancelAnimationFrame(scroller);
  ghost.remove();
  node.classList.remove('origin');
  dotsEl.replaceChildren();
  dropEl.hidden = true;
  drag = null;
  if (commit && target) commitMove(id, target);
  // Storage updates that arrived during the move were held back; paint them now.
  if (renderQueued) render();
}

// ---- selection rectangle ---------------------------------------------------

function updateBand(event) {
  const dx = event.clientX - band.x;
  const dy = event.clientY - band.y;
  if (!band.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
  band.moved = true;
  const rect = desktop.getBoundingClientRect();
  const left = Math.min(band.x, event.clientX);
  const top = Math.min(band.y, event.clientY);
  const right = Math.max(band.x, event.clientX);
  const bottom = Math.max(band.y, event.clientY);
  Object.assign(bandEl.style, {
    left: `${left - rect.left}px`,
    top: `${top - rect.top + desktop.scrollTop}px`,
    width: `${right - left}px`,
    height: `${bottom - top}px`,
  });
  bandEl.hidden = false;
  const hits = [];
  for (const node of gridEl.children) {
    const r = node.getBoundingClientRect();
    if (r.right > left && r.left < right && r.bottom > top && r.top < bottom) hits.push(node.dataset.id);
  }
  setSelection(hits);
}

function endBand() {
  if (!band.moved) setSelection([]);
  else announce(selectionCount());
  bandEl.hidden = true;
  band = null;
}

gridEl.addEventListener('pointerdown', (event) => {
  const icon = event.target.closest('.icon');
  if (!icon || event.button !== 0 || renaming) return;
  press = { id: icon.dataset.id, x: event.clientX, y: event.clientY };
});

desktop.addEventListener('pointerdown', (event) => {
  if (event.button !== 0 || event.target.closest('.icon, #empty')) return;
  desktop.focus({ preventScroll: true });
  band = { x: event.clientX, y: event.clientY, moved: false };
  event.preventDefault();
});

window.addEventListener('pointermove', (event) => {
  if (press && Math.hypot(event.clientX - press.x, event.clientY - press.y) > DRAG_THRESHOLD) startDrag(event);
  else if (drag) updateDrag(event);
  else if (band) updateBand(event);
});

window.addEventListener('pointerup', () => {
  press = null;
  if (drag) {
    swallowNextClick();
    endDrag(true);
  } else if (swallowRelease) {
    swallowNextClick();
  }
  swallowRelease = false;
  if (band) endBand();
});

window.addEventListener('pointercancel', () => {
  press = null;
  swallowRelease = false;
  if (drag) endDrag(false);
  if (band) endBand();
});

gridEl.addEventListener('focusin', (event) => {
  const id = event.target.closest('.icon')?.dataset.id;
  if (!id) return;
  state.focusId = id;
  updateTabStops();
});

// ---- keyboard --------------------------------------------------------------

function focusIcon(id) {
  if (!id) return;
  state.focusId = id;
  updateTabStops();
  iconEl(id)?.focus();
}

function moveByKey(id, dir) {
  const name = linkById(id).name;
  const target = grid.step(state.display.get(id), dir, state.cols);
  if (!target) {
    announce(`${name} can’t move further ${dir}`);
    return;
  }
  if (commitMove(id, target, `${name} moved to row ${target.row + 1}, column ${target.col + 1}`)) focusIcon(id);
}

// Desktop shortcuts apply only while the desktop itself (or nothing) has focus.
function desktopHasFocus() {
  const active = document.activeElement;
  if (!active || active === document.body) return true;
  return desktop.contains(active) && !$('empty').contains(active);
}

document.addEventListener('keydown', (event) => {
  if (drag && event.key === 'Escape') {
    event.preventDefault();
    swallowRelease = true;
    endDrag(false);
    return;
  }
  if (document.querySelector('dialog[open]') || event.target.closest?.('input, textarea, select') || !desktopHasFocus()) return;
  const focusId = document.activeElement?.closest?.('.icon')?.dataset.id ?? null;
  const ctrl = event.ctrlKey || event.metaKey;

  if (ctrl && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 'z') {
    event.preventDefault();
    undo();
    return;
  }
  const dir = DIRECTIONS[event.key];
  if (dir) {
    event.preventDefault();
    if (!focusId) {
      focusIcon(readingOrder()[0]);
    } else if (ctrl) {
      moveByKey(focusId, dir);
    } else {
      const next = grid.neighbour(state.display, focusId, dir);
      if (event.shiftKey) {
        setSelection([...state.selected, focusId, ...(next ? [next] : [])]);
        announce(selectionCount());
      }
      focusIcon(next);
    }
    return;
  }
  if (event.key === ' ' && focusId) {
    event.preventDefault();
    const next = new Set(state.selected);
    const picked = !next.has(focusId);
    if (picked) next.add(focusId);
    else next.delete(focusId);
    setSelection(next);
    announce(`${linkById(focusId).name} ${picked ? 'selected' : 'not selected'}, ${selectionCount()}`);
  } else if (event.key === 'Delete') {
    const ids = state.selected.size ? [...state.selected] : focusId ? [focusId] : [];
    if (ids.length) {
      event.preventDefault();
      deleteIds(ids);
    }
  } else if (event.key === 'F2' && focusId) {
    event.preventDefault();
    startRename(focusId);
  } else if (event.key === 'Escape' && state.selected.size) {
    setSelection([]);
    announce('Selection cleared');
  }
});

// ---- paste and drop ---------------------------------------------------------

document.addEventListener('paste', (event) => {
  if (document.querySelector('dialog[open]') || event.target.closest?.('input, textarea') || !desktopHasFocus()) return;
  const text = event.clipboardData?.getData('text/plain');
  if (!text) return;
  event.preventDefault();
  addFromText(text, null);
});

const DROP_TYPES = ['text/x-moz-url', 'text/uri-list', 'text/plain'];

desktop.addEventListener('dragover', (event) => {
  if (!event.dataTransfer || ![...event.dataTransfer.types].some((type) => DROP_TYPES.includes(type))) return;
  event.preventDefault();
  showDropTarget(cellAt(event.clientX, event.clientY));
});

desktop.addEventListener('dragleave', (event) => {
  if (!desktop.contains(event.relatedTarget)) dropEl.hidden = true;
});

desktop.addEventListener('drop', (event) => {
  event.preventDefault();
  dropEl.hidden = true;
  const data = event.dataTransfer;
  let url = '';
  let title = '';
  const moz = data.getData('text/x-moz-url');
  if (moz) {
    [url, title = ''] = moz.split(/\r?\n/);
  } else {
    url = data.getData('text/uri-list').split(/\r?\n/).find((line) => line && !line.startsWith('#')) || data.getData('text/plain');
  }
  // Firefox puts the URL itself in the title slot when there is no better one.
  if (title === url) title = '';
  addFromText(url, cellAt(event.clientX, event.clientY), title.trim());
});

// ---- context menus (Firefox's own) ------------------------------------------

// Which right-click the open menu belongs to: our own (desktop/icon) or Firefox's default.
let menuIsOurs = false;

document.addEventListener('contextmenu', (event) => {
  state.menuTarget = null;
  state.menuCell = null;
  menuIsOurs = false;
  if (event.target.closest('input, textarea, dialog, #empty, #taskbar, #toast')) return;
  const icon = event.target.closest('.icon');
  state.menuTarget = icon?.dataset.id ?? null;
  state.menuCell = icon ? null : cellAt(event.clientX, event.clientY);
  if (icon) focusIcon(icon.dataset.id);
  menuIsOurs = true;
  browser.menus.overrideContext({ showDefaults: false });
});

const canPaste = browser.runtime.getBrowserInfo().then(({ version }) => parseInt(version, 10) >= MIN_PASTE_VERSION);

// The items are created hidden; show them only for right-clicks handled above, so
// Firefox's default menus (dialogs, taskbar, fields) never get desktop items.
browser.menus.onShown.addListener(async (info, tab) => {
  if (!menuIsOurs || (tab ? tab.id !== state.tabId : !document.hasFocus())) return;
  const paste = await canPaste;
  for (const id of DESKTOP_IDS) browser.menus.update(id, { visible: id !== PASTE_ID || paste });
  browser.menus.refresh();
});

function runMenuCommand(command) {
  const link = linkById(state.menuTarget);
  switch (command) {
    case 'open':
      if (link) location.assign(link.url);
      break;
    case 'open-tab':
      if (link) browser.tabs.create({ url: link.url, active: false });
      break;
    case 'open-window':
      if (link) browser.windows.create({ url: link.url });
      break;
    case 'edit':
      if (link) openLinkEditor(link);
      break;
    case 'rename':
      if (link) startRename(link.id);
      break;
    case 'copy':
      if (link) {
        navigator.clipboard.writeText(link.url).then(
          () => showToast('Link copied'),
          () => showToast('Couldn’t copy the link'),
        );
      }
      break;
    case 'delete':
      if (link) deleteIds(state.selected.has(link.id) ? [...state.selected] : [link.id]);
      break;
    case 'new-link':
      openLinkEditor(null, state.menuCell);
      break;
    case 'paste-link': {
      const cell = state.menuCell;
      navigator.clipboard.readText().then(
        (text) => addFromText(text, cell),
        () => showToast('Press Ctrl+V to paste a link'),
      );
      break;
    }
    case 'pack':
      packGrid();
      break;
    case 'wallpaper':
      openSettings('wallpaper');
      break;
    case 'settings':
      openSettings();
      break;
    default:
  }
}

browser.menus.onClicked.addListener((info, tab) => {
  const id = String(info.menuItemId);
  if (!id.startsWith('desk:')) return;
  if (tab ? tab.id !== state.tabId : !document.hasFocus()) return;
  runMenuCommand(id.slice('desk:'.length));
});

// ---- empty desktop card ------------------------------------------------------

$('empty').addEventListener('click', (event) => {
  const action = event.target.closest('[data-action]')?.dataset.action;
  if (action === 'add') openLinkEditor(null);
  else if (action === 'import-file') $('import-file').click();
  else if (action === 'import-top' || action === 'import-bookmarks') {
    requestImport(action === 'import-top' ? 'topSites' : 'bookmarks').then(
      (count) => count !== null && showToast(importedMessage(count)),
      (error) => showToast(error.message),
    );
  }
});

$('import-file').addEventListener('change', async (event) => {
  const file = event.target.files[0];
  event.target.value = '';
  if (!file) return;
  try {
    const data = await readExportFile(file);
    // This button only shows on an empty desktop, so restoring the file's settings and
    // wallpaper loses nothing; Settings asks Merge or Replace when there are links.
    const mode = state.layout.links.length ? 'merge' : 'replace';
    const { added } = await send('importData', { data, mode });
    showToast(importedMessage(added));
  } catch (error) {
    showToast(error.message);
  }
});

bindSiteAccess($('empty-site-access'));

// ---- taskbar -----------------------------------------------------------------

$('settings-button').addEventListener('click', () => openSettings());

const timeFormat = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
const dateFormat = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' });
function tick() {
  const now = new Date();
  $('time').textContent = timeFormat.format(now);
  $('date').textContent = dateFormat.format(now);
  $('clock').title = now.toLocaleDateString(undefined, { dateStyle: 'full' });
  setTimeout(tick, 60_000 - (now.getSeconds() * 1000 + now.getMilliseconds()) + 50);
}

// ---- storage sync and start-up ---------------------------------------------

function applyStored({ layout, settings, wallpaperImage, icons }) {
  if (layout) state.stored = layout;
  if (settings) state.settings = settings;
  if (wallpaperImage !== undefined) state.wallpaperImage = wallpaperImage;
  if (icons) state.icons = icons;
  refreshLayout();
}

browser.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (!ready) {
    changedBeforeReady = true;
    return;
  }
  applyStored({
    layout: changes.layout ? migrate(changes.layout.newValue) : null,
    settings: changes.settings ? normalizeSettings(changes.settings.newValue) : null,
    wallpaperImage: changes.wallpaperImage ? changes.wallpaperImage.newValue ?? null : undefined,
  });
  for (const [key, change] of Object.entries(changes)) {
    if (!key.startsWith('icon:')) continue;
    const id = key.slice('icon:'.length);
    if (change.newValue) state.icons.set(id, change.newValue);
    else state.icons.delete(id);
  }
  scheduleRender();
});

window.addEventListener('resize', () => {
  scheduleRender();
  reportColsSoon();
});
window.addEventListener('focus', reportColsSoon);

async function init() {
  performance.mark('linkdesk-script');
  const [loaded, tab] = await Promise.all([loadState(window.linkdeskStorage), browser.tabs.getCurrent()]);
  performance.mark('linkdesk-loaded');
  applyStored(loaded);
  state.tabId = tab?.id ?? null;
  render();
  performance.mark('linkdesk-rendered');
  ready = true;
  // A write that landed between the early read and now would otherwise be lost.
  if (changedBeforeReady) {
    applyStored(await loadState());
    render();
  }
  followFirefoxTheme();
  tick();
  reportColsSoon();
  if (navigator.onLine) send('retryIcons').catch(() => {});
}

init();
