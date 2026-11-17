import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HINT_KEYS, hintCodes } from '../extension/lib/hints.js';

const prefixFree = (codes) => codes.every((a) => codes.every((b) => a === b || !b.startsWith(a)));

test('hintCodes gives single home-row letters while they last', () => {
  assert.deepEqual(hintCodes(4), ['a', 's', 'd', 'f']);
  assert.deepEqual(hintCodes(0), []);
  assert.equal(new Set(hintCodes(HINT_KEYS.length)).size, HINT_KEYS.length);
});

test('hintCodes switches to longer codes past the alphabet, prefix-free and unique', () => {
  for (const n of [27, 60, 700, 800]) {
    const codes = hintCodes(n);
    assert.equal(codes.length, n);
    assert.equal(new Set(codes).size, n);
    assert.ok(prefixFree(codes), `prefix-free for ${n}`);
    assert.ok(codes.every((code, i) => i === 0 || codes[i - 1].length <= code.length), 'shorter codes first');
  }
  assert.equal(hintCodes(27).filter((code) => code.length === 1).length, 25, 'one letter gives way to a prefix');
});
