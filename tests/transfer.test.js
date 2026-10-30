import assert from 'node:assert/strict';
import { test } from 'node:test';
import { addLinks, emptyLayout } from '../extension/lib/model.js';
import { buildExport, ImportError, validateImport } from '../extension/lib/transfer.js';

const PNG = 'data:image/png;base64,iVBORw0KGgo=';

function sampleExport() {
  const { layout } = addLinks(
    emptyLayout(),
    [
      { url: 'https://a.com/', name: 'A', icon: { kind: 'site' } },
      { url: 'https://b.com/', icon: { kind: 'letter', text: 'B', color: '#0061e0' } },
    ],
    { now: 1, newId: () => Math.random().toString(36).slice(2) },
  );
  const icons = { [layout.links[0].id]: PNG };
  return buildExport({ layout, settings: { iconSize: 'l', wallpaper: { kind: 'preset', value: 'dusk' } }, icons }, 0);
}

test('export round-trips through validateImport', () => {
  const { items, settings } = validateImport(JSON.parse(JSON.stringify(sampleExport())));
  assert.equal(items.length, 2);
  assert.equal(items[0].iconData, PNG);
  assert.equal(items[0].icon.status, 'ok');
  assert.equal(items[1].icon.kind, 'letter');
  assert.equal(settings.iconSize, 'l');
});

test('validateImport rejects files that are not exports', () => {
  assert.throws(() => validateImport({}), ImportError);
  assert.throws(() => validateImport({ format: 'linkdesk', version: 99, links: [] }), /newer version/);
  assert.throws(() => validateImport({ format: 'linkdesk', version: 1 }), ImportError);
});

test('validateImport drops unsafe URLs and image data', () => {
  const data = sampleExport();
  data.links.push({ id: 'x', url: 'javascript:alert(1)' }, { id: 'y', url: 'https://y.com/', icon: { kind: 'upload' } });
  data.icons.y = 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=';
  data.icons[data.links[0].id] = 'data:text/html;base64,PGgxPg==';
  const { items } = validateImport(data);
  assert.equal(items.length, 3);
  assert.equal(items[0].iconData, undefined);
  assert.equal(items[0].icon.status, 'failed');
  assert.equal(items[2].icon.kind, 'letter');
});

test('validateImport rejects oversized icons and missing wallpaper images', () => {
  const data = sampleExport();
  data.icons[data.links[0].id] = `data:image/png;base64,${'A'.repeat(400_000)}`;
  data.settings.wallpaper = { kind: 'image' };
  const { items, settings, wallpaperImage } = validateImport(data);
  assert.equal(items[0].iconData, undefined);
  assert.equal(wallpaperImage, null);
  assert.deepEqual(settings.wallpaper, { kind: 'preset', value: 'plain' });
});
