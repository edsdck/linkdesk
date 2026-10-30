// Captures the AMO store screenshots (1280×800) into store/screenshots/.
// Uses generic letter-tile links, so no third-party logos appear. Run: npm run screenshots

import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { BASE, Firefox } from '../tests/e2e/bidi.js';

const OUT = resolve('store/screenshots');
const WIDTH = 1280;
const HEIGHT = 800;

const LINKS = [
  ['Mail', 'M', '#0061e0', 0, 0], ['Calendar', 'C', '#008787', 1, 0], ['News', 'N', '#d7264c', 2, 0],
  ['Docs', 'D', '#058b00', 3, 0], ['Photos', 'P', '#c45a27', 4, 0], ['Music', '♪', '#8000d7', 0, 1],
  ['Maps', 'Ma', '#0090ed', 1, 1], ['Recipes', 'R', '#c45a27', 0, 2], ['Travel', 'T', '#592acb', 1, 2],
  ['Weather', 'W', '#0061e0', 9, 0], ['Banking', 'B', '#058b00', 9, 1], ['Learning', 'L', '#d7264c', 9, 2],
];

mkdirSync(OUT, { recursive: true });
const ff = await Firefox.launch({ headless: process.env.HEADED !== '1', port: 9361 });

async function sizeContent(context) {
  const chrome = await ff.chromeWindow();
  for (let i = 0; i < 3; i += 1) {
    await ff.eval(chrome, (w, h) => {
      const browser = gBrowser.selectedBrowser;
      window.resizeBy(w - browser.clientWidth, h - browser.clientHeight);
      return true;
    }, WIDTH, HEIGHT);
    await sleep(300);
  }
  return ff.eval(context, () => [innerWidth, innerHeight]);
}

const hideToast = (context) => ff.eval(context, () => {
  document.getElementById('toast').hidden = true;
  document.activeElement?.blur();
  return true;
});

const shot = async (context, name) => {
  await sleep(250);
  await ff.screenshot(context, join(OUT, `${name}.png`));
  console.log(`wrote ${name}.png`);
};

try {
  await ff.installExtension(resolve('extension'));
  const page = await ff.openTab(`${BASE}newtab/newtab.html`);
  const size = await sizeContent(page);
  if (size[0] !== WIDTH || size[1] !== HEIGHT) console.warn(`content is ${size.join('×')}, not ${WIDTH}×${HEIGHT}`);

  await ff.eval(page, (links) => browser.runtime.sendMessage({
    type: 'addLinks',
    items: links.map(([name, text, color, col, row]) => ({
      url: `https://${name.toLowerCase()}.example.com/`,
      name,
      nameEdited: true,
      icon: { kind: 'letter', text, color },
      cell: { col, row },
    })),
  }), LINKS);
  await ff.waitFor(page, (n) => document.querySelectorAll('.icon').length === n, { args: [LINKS.length] });
  await hideToast(page);
  await shot(page, '1-desktop');

  // Mid-drag: press on "News", move to an empty cell, screenshot before releasing.
  const from = await ff.eval(page, () => {
    const r = [...document.querySelectorAll('.icon')].find((n) => n.textContent.includes('News')).getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + 30) };
  });
  const to = { x: 24 + 5 * 100 + 50, y: 24 + 2 * 108 + 40 };
  await ff.pointer(page, [
    { type: 'pointerMove', x: from.x, y: from.y },
    { type: 'pointerDown', button: 0 },
    { type: 'pointerMove', x: from.x + 20, y: from.y + 10, duration: 50 },
    { type: 'pointerMove', x: to.x, y: to.y, duration: 200 },
  ]);
  await shot(page, '2-move');
  await ff.pointer(page, [{ type: 'pointerUp', button: 0 }]);
  await ff.eval(page, () => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
    return true;
  });
  await sleep(300);

  // Editor: open through Firefox's own context menu, like a user would.
  await ff.pointer(page, [{ type: 'pointerMove', x: 700, y: 500 }, { type: 'pointerDown', button: 2 }, { type: 'pointerUp', button: 2 }]);
  const chrome = await ff.chromeWindow();
  await ff.waitFor(chrome, () => document.getElementById('contentAreaContextMenu').state === 'open');
  await ff.eval(chrome, () => {
    const menu = document.getElementById('contentAreaContextMenu');
    menu.activateItem([...menu.children].find((n) => n.getAttribute('label') === 'New link…'));
    return true;
  });
  await ff.waitFor(page, () => document.getElementById('editor').open);
  await ff.type(page, 'gardening.example.com');
  await ff.keys(page, ['Tab']);
  await ff.type(page, 'Garden');
  await ff.eval(page, () => {
    document.querySelector('input[name="icon-kind"][value="letter"]').click();
    document.querySelector('input[name="editor-color"][value="#058b00"]').click();
    return true;
  });
  await hideToast(page);
  await shot(page, '3-editor');
  await ff.keys(page, ['Escape']);

  await ff.eval(page, () => browser.runtime.sendMessage({ type: 'setSettings', patch: { wallpaper: { kind: 'preset', value: 'midnight' } } }));
  await ff.waitFor(page, () => document.getElementById('desktop').dataset.wallpaper === 'midnight');
  await hideToast(page);
  await shot(page, '4-midnight');

  const options = await ff.openTab(`${BASE}options/options.html`);
  await sizeContent(options);
  await shot(options, '5-settings');

  const errors = ff.errors();
  if (errors.length) console.warn('console errors:', errors.map((e) => e.text));
} finally {
  await ff.close();
}
