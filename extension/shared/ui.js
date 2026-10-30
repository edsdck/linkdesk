// Helpers shared by the desktop, popup and settings pages.

import { iconKey, migrate, normalizeSettings } from '../lib/model.js';
import { LETTER_COLORS, colorFor, letterFor } from '../lib/url.js';

// Every write goes through the background script.
export async function send(type, payload = {}) {
  const reply = await browser.runtime.sendMessage({ type, ...payload });
  if (!reply?.ok) throw new Error(reply?.error ?? 'Something went wrong.');
  return reply.result;
}

// One storage read for everything the desktop needs. `pending` is a read started earlier.
export async function loadState(pending = browser.storage.local.get(null)) {
  const all = await pending;
  const layout = migrate(all.layout);
  const icons = new Map();
  for (const link of layout.links) if (all[iconKey(link.id)]) icons.set(link.id, all[iconKey(link.id)]);
  return { layout, settings: normalizeSettings(all.settings), icons, wallpaperImage: all.wallpaperImage ?? null };
}

export function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else if (value === true) node.setAttribute(key, '');
    else if (value !== false && value != null) node.setAttribute(key, value);
  }
  for (const child of [].concat(children)) if (child != null) node.append(child);
  return node;
}

// The square icon: stored image, or a letter on a colour.
export function tile(link, iconData) {
  if (iconData && link.icon.kind !== 'letter') {
    return el('span', { class: 'tile', 'aria-hidden': 'true' }, el('img', { src: iconData, alt: '', draggable: 'false' }));
  }
  const text = link.icon.kind === 'letter' ? link.icon.text : letterFor(link.name, link.url);
  const color = link.icon.kind === 'letter' ? link.icon.color : colorFor(link.url);
  const node = el('span', { class: 'tile letter', 'aria-hidden': 'true', text });
  node.style.background = color;
  return node;
}

const COLOR_NAMES = ['Blue', 'Teal', 'Red', 'Purple', 'Green', 'Orange', 'Violet', 'Light blue'];

// Shows the settings page, optionally at a section such as "wallpaper": switches to an
// open settings tab, or opens one next to this tab. Not runtime.openOptionsPage(): Firefox
// loads that into the current tab when it is a new tab page, which would replace the desktop.
export async function openSettings(section = null) {
  const shown = await browser.runtime.sendMessage({ type: 'settings:show', section }).catch(() => null);
  if (shown === 'shown') return;
  const current = await browser.tabs.getCurrent();
  await browser.tabs.create({
    url: browser.runtime.getURL(`options/options.html${section ? `#${section}` : ''}`),
    ...(current ? { index: current.index + 1, openerTabId: current.id, windowId: current.windowId } : {}),
  });
}

// Colour picker made of radio buttons.
export function swatches(name, selected, onChange) {
  return el(
    'div',
    { class: 'swatches', role: 'radiogroup', 'aria-label': 'Tile colour' },
    LETTER_COLORS.map((color, index) => {
      const label = COLOR_NAMES[index];
      const input = el('input', { type: 'radio', name, value: color, 'aria-label': label, title: label, checked: color === selected });
      input.addEventListener('change', () => onChange(color));
      const dot = el('span');
      dot.style.background = color;
      return el('label', {}, [input, dot]);
    }),
  );
}

export const WALLPAPERS = {
  plain: { label: 'Plain', css: 'var(--page-bg)' },
  dawn: { label: 'Dawn', css: 'linear-gradient(160deg, #ffb4db, #ffd567)' },
  ocean: { label: 'Ocean', css: 'linear-gradient(160deg, #0061e0, #00cadb)' },
  forest: { label: 'Forest', css: 'linear-gradient(160deg, #005e5e, #3fe1b0)' },
  dusk: { label: 'Dusk', css: 'linear-gradient(160deg, #2b2a33, #592acb)' },
  // Near-black, top-down fade from a panel tone into the frame tone, settling by mid-screen
  // (the subtle dark style of apps like Linear). Its taskbar styling is in newtab.css.
  midnight: { label: 'Midnight', css: 'linear-gradient(180deg, #121213 0%, #09090a 55%) #09090a' },
};

export function applyWallpaper(node, settings, image) {
  const { kind, value } = settings.wallpaper;
  if (kind === 'image' && image) {
    node.style.background = `center / cover no-repeat url("${image}")`;
    node.dataset.wallpaper = 'image';
  } else {
    node.style.background = (WALLPAPERS[value] ?? WALLPAPERS.plain).css;
    node.dataset.wallpaper = value in WALLPAPERS ? value : 'plain';
  }
}

// Theme colours may be CSS strings or [r, g, b] arrays.
function cssColor(value) {
  if (Array.isArray(value) && value.length >= 3 && value.every(Number.isFinite)) return `rgb(${value.slice(0, 3).join(' ')})`;
  return typeof value === 'string' && CSS.supports('color', value) ? value : null;
}

// Relative luminance above the point where dark text reads better than white.
function isLight(color) {
  const probe = document.createElement('span');
  probe.style.color = color;
  document.body.append(probe);
  const [r, g, b] = getComputedStyle(probe).color.match(/[\d.]+/g).map(Number);
  probe.remove();
  const lin = (c) => ((c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b) > 0.179;
}

// Uses the active Firefox theme's colours when an extension theme supplies them.
export function followFirefoxTheme(root = document.documentElement) {
  const apply = (theme) => {
    const colors = theme?.colors ?? {};
    const vars = {
      '--taskbar-bg': cssColor(colors.toolbar ?? colors.frame),
      '--taskbar-text': cssColor(colors.toolbar_text ?? colors.tab_background_text),
      '--accent': cssColor(colors.tab_line ?? colors.icons_attention),
    };
    const usable = vars['--taskbar-bg'] && vars['--taskbar-text'];
    // A theme accent brings its own hover/pressed shades and a readable text colour.
    const accent = vars['--accent'];
    vars['--accent-hover'] = accent && `color-mix(in srgb, ${accent} 85%, black)`;
    vars['--accent-active'] = accent && `color-mix(in srgb, ${accent} 70%, black)`;
    vars['--on-accent'] = accent && (isLight(accent) ? '#15141a' : '#ffffff');
    for (const [name, value] of Object.entries(vars)) {
      if (usable && value) root.style.setProperty(name, value);
      else root.style.removeProperty(name);
    }
  };
  browser.theme.getCurrent().then(apply, () => {});
  browser.theme.onUpdated.addListener(({ theme }) => apply(theme));
}
