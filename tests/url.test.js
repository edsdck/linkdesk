import assert from 'node:assert/strict';
import { test } from 'node:test';
import { colorFor, graphemes, hostOf, isPrivateHost, LETTER_COLORS, letterFor, normalizeUrl, parseLinkText } from '../extension/lib/url.js';

test('normalizeUrl adds https to bare domains and hosts with ports', () => {
  assert.equal(normalizeUrl('github.com'), 'https://github.com/');
  assert.equal(normalizeUrl('localhost:3000'), 'https://localhost:3000/');
  assert.equal(normalizeUrl('  example.com/a?b=1 '), 'https://example.com/a?b=1');
  assert.equal(normalizeUrl('http://example.com'), 'http://example.com/');
});

test('normalizeUrl rejects other schemes and non-links', () => {
  for (const bad of ['', 'hello', 'hello world', 'javascript:alert(1)', 'about:config', 'file:///c:/x', 'ftp://x.com', 'mailto:a@b.com', 'data:text/html,hi']) {
    assert.equal(normalizeUrl(bad), null, bad);
  }
});

test('normalizeUrl rejects URLs over 2048 characters', () => {
  assert.equal(normalizeUrl(`https://a.com/${'x'.repeat(2100)}`), null);
});

test('isPrivateHost spots loopback, LAN and link-local hosts', () => {
  for (const host of ['router', 'nas.lan', 'wiki.internal', 'tv.home.arpa', 'localhost', 'localhost.', 'printer.local', '127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.1', '192.168.1.1', '169.254.1.1', '100.64.0.1', '0.1.2.3', '[::1]', '[::]', '[::ffff:7f00:1]', 'fd12:3456::1', '0.0.0.0']) {
    assert.equal(isPrivateHost(host), true, host);
  }
  for (const host of ['example.com', '8.8.8.8', '172.32.0.1', '192.169.0.1', '2001:db8::1']) {
    assert.equal(isPrivateHost(host), false, host);
  }
});

test('parseLinkText takes the first line only', () => {
  assert.equal(parseLinkText('https://a.com\nTitle'), 'https://a.com/');
  assert.equal(parseLinkText('just some words'), null);
});

test('hostOf strips www and survives bad input', () => {
  assert.equal(hostOf('https://www.mozilla.org/en-US/'), 'mozilla.org');
  assert.equal(hostOf('nope'), '');
});

test('letterFor uses the first letter or digit', () => {
  assert.equal(letterFor('github', ''), 'G');
  assert.equal(letterFor('', 'https://9gag.com'), '9');
  assert.equal(letterFor('  — news', ''), 'N');
});

test('colorFor is stable and from the palette', () => {
  assert.equal(colorFor('https://a.com/x'), colorFor('https://a.com/y'));
  assert.ok(LETTER_COLORS.includes(colorFor('https://b.org')));
});

test('graphemes keeps emoji whole', () => {
  assert.equal(graphemes('👨‍👩‍👧abc', 2), '👨‍👩‍👧a');
});
