import assert from 'node:assert/strict';
import { test } from 'node:test';
import { rankIcons } from '../extension/lib/favicon.js';

const base = 'https://example.com/docs/page';

test('rankIcons prefers apple-touch, then large icons, ending with /favicon.ico', () => {
  const ranked = rankIcons(
    [
      { href: '/small.png', rel: 'icon', sizes: '16x16' },
      { href: '/touch.png', rel: 'apple-touch-icon', sizes: '' },
      { href: '/big.png', rel: 'icon', sizes: '32x32 192x192' },
      { href: '/mask.svg', rel: 'mask-icon' },
      { href: '/style.css', rel: 'stylesheet' },
    ],
    base,
  );
  assert.deepEqual(ranked, [
    'https://example.com/touch.png',
    'https://example.com/big.png',
    'https://example.com/small.png',
    'https://example.com/favicon.ico',
  ]);
});

test('rankIcons resolves relative URLs, accepts "shortcut icon" and skips non-web schemes', () => {
  const ranked = rankIcons(
    [
      { href: 'img/fav.ico', rel: 'Shortcut Icon' },
      { href: 'javascript:alert(1)', rel: 'icon' },
      { href: 'data:image/png;base64,AAAA', rel: 'icon', sizes: '64x64' },
    ],
    base,
  );
  assert.deepEqual(ranked, ['data:image/png;base64,AAAA', 'https://example.com/docs/img/fav.ico', 'https://example.com/favicon.ico']);
});

test('rankIcons keeps at most 5 candidates plus /favicon.ico', () => {
  const many = Array.from({ length: 60 }, (_, i) => ({ href: `https://slow.example/${i}.png`, rel: 'icon', sizes: `${i + 1}x${i + 1}` }));
  const ranked = rankIcons(many, base);
  assert.equal(ranked.length, 6);
  assert.equal(ranked[0], 'https://slow.example/59.png');
  assert.equal(ranked.at(-1), 'https://example.com/favicon.ico');
});

test('rankIcons treats unsized SVG as large and de-duplicates', () => {
  const ranked = rankIcons(
    [
      { href: '/a.svg', rel: 'icon', type: 'image/svg+xml' },
      { href: '/a.svg', rel: 'icon' },
      { href: '/favicon.ico', rel: 'icon' },
    ],
    base,
  );
  assert.deepEqual(ranked, ['https://example.com/a.svg', 'https://example.com/favicon.ico']);
});
