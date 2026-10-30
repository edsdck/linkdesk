// Renders extension/icons/linkdesk.svg to PNGs (48, 96, 128) using Firefox itself.
// Run: node scripts/render-icons.mjs

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Firefox } from '../tests/e2e/bidi.js';

const SIZES = [48, 96, 128];
const svg = readFileSync(resolve('extension/icons/linkdesk.svg'), 'utf8');

const ff = await Firefox.launch({ headless: true, port: 9360 });
try {
  const page = await ff.newTab('about:blank');
  const pngs = await ff.eval(page, async (source, sizes) => {
    const img = new Image();
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(source)}`;
    await img.decode();
    return sizes.map((size) => {
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      canvas.getContext('2d').drawImage(img, 0, 0, size, size);
      return canvas.toDataURL('image/png');
    });
  }, svg, SIZES);
  SIZES.forEach((size, i) => {
    const file = resolve(`extension/icons/linkdesk-${size}.png`);
    writeFileSync(file, Buffer.from(pngs[i].split(',')[1], 'base64'));
    console.log(`wrote ${file}`);
  });
} finally {
  await ff.close();
}
