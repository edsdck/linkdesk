import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  addLinks, emptyLayout, findDuplicate, migrate, normalizeSettings, removeLinks, restoreLinks, setCells, updateLink,
} from '../extension/lib/model.js';

let counter = 0;
const opts = () => ({ now: 1000, newId: () => `id${(counter += 1)}` });

test('migrate returns an empty layout for missing or broken data', () => {
  assert.deepEqual(migrate(undefined), emptyLayout());
  assert.deepEqual(migrate({ links: 'nope' }), emptyLayout());
});

test('migrate drops invalid links and fixes clashing cells', () => {
  const layout = migrate({
    cols: 4,
    links: [
      { id: 'a', url: 'https://a.com/', name: 'A', cell: { col: 0, row: 0 } },
      { id: 'b', url: 'javascript:alert(1)', cell: { col: 1, row: 0 } },
      { id: 'c', url: 'https://c.com/', cell: { col: 0, row: 0 } },
      { id: 'a', url: 'https://dupe.com/' },
      { id: 'd', url: 'https://d.com/', cell: { col: -1, row: 'x' } },
    ],
  });
  assert.deepEqual(layout.links.map((l) => l.id), ['a', 'c', 'd']);
  assert.deepEqual(layout.links[1].cell, { col: 1, row: 0 });
  assert.equal(layout.links[2].name, 'd.com');
  assert.equal(layout.links[0].icon.kind, 'site');
});

test('addLinks uses the wanted cell when free, else the next free one after it', () => {
  let { layout } = addLinks(emptyLayout(), [{ url: 'https://a.com/', cell: { col: 2, row: 1 } }], opts());
  assert.deepEqual(layout.links[0].cell, { col: 2, row: 1 });
  ({ layout } = addLinks(layout, [{ url: 'https://b.com/', cell: { col: 2, row: 1 } }, { url: 'https://c.com/' }], opts()));
  assert.deepEqual(layout.links[1].cell, { col: 3, row: 1 }, 'dropped on a taken cell: lands next to it');
  assert.deepEqual(layout.links[2].cell, { col: 0, row: 0 }, 'no wanted cell: first free cell');
});

test('cells far outside the grid are not accepted (hostile imports)', () => {
  const layout = migrate({ links: [{ id: 'a', url: 'https://a.com/', cell: { col: 0, row: 1e9 } }] });
  assert.deepEqual(layout.links[0].cell, { col: 0, row: 0 });
  const { added } = addLinks(emptyLayout(), [{ url: 'https://b.com/', cell: { col: 5000, row: 0 } }], opts());
  assert.deepEqual(added[0].cell, { col: 0, row: 0 });
});

test('addLinks keeps free cells beyond the current width (narrow windows reflow for display only)', () => {
  const { layout } = addLinks({ ...emptyLayout(), cols: 4 }, [{ url: 'https://a.com/', cell: { col: 11, row: 0 } }], opts());
  assert.deepEqual(layout.links[0].cell, { col: 11, row: 0 });
});

test('icon sources are web URLs only, never image data', () => {
  const { added } = addLinks(
    emptyLayout(),
    [
      { url: 'https://a.com/', icon: { kind: 'site', source: 'data:image/png;base64,AAAA' } },
      { url: 'https://b.com/', icon: { kind: 'site', source: 'https://b.com/favicon.ico' } },
      { url: `https://c.com/${'x'.repeat(3000)}` },
    ],
    opts(),
  );
  assert.equal(added.length, 2, 'over-long URLs are skipped');
  assert.equal(added[0].icon.source, undefined);
  assert.equal(added[1].icon.source, 'https://b.com/favicon.ico');
});

test('setCells moves only the patched links; others that now clash step aside', () => {
  const { layout } = addLinks(emptyLayout(), [{ url: 'https://a.com/' }, { url: 'https://b.com/' }], opts());
  const [a, b] = layout.links;
  // Another tab put b at (3,0) while this tab moved a there.
  const other = setCells(layout, { [b.id]: { col: 3, row: 0 } });
  const next = setCells(other, { [a.id]: { col: 3, row: 0 } });
  assert.deepEqual(next.links.find((l) => l.id === a.id).cell, { col: 3, row: 0 });
  assert.notDeepEqual(next.links.find((l) => l.id === b.id).cell, { col: 3, row: 0 });
});

test('addLinks skips non-web URLs and names links after the host', () => {
  const { added } = addLinks(emptyLayout(), [{ url: 'about:blank' }, { url: 'https://www.x.org/', name: '  ' }], opts());
  assert.equal(added.length, 1);
  assert.equal(added[0].name, 'x.org');
  assert.equal(added[0].nameEdited, false);
  assert.equal(added[0].icon.status, 'pending');
});

test('addLinks keeps letter icons valid', () => {
  const { added } = addLinks(emptyLayout(), [{ url: 'https://a.com/', icon: { kind: 'letter', text: 'abc', color: 'red' } }], opts());
  assert.equal(added[0].icon.text, 'ab');
  assert.match(added[0].icon.color, /^#[0-9a-f]{6}$/);
});

test('updateLink renames, marks the name as edited, and ignores bad URLs', () => {
  const { layout } = addLinks(emptyLayout(), [{ url: 'https://a.com/' }], opts());
  const id = layout.links[0].id;
  const { link } = updateLink(layout, id, { name: 'Alpha', url: 'javascript:x' }, 2000);
  assert.equal(link.name, 'Alpha');
  assert.equal(link.nameEdited, true);
  assert.equal(link.url, 'https://a.com/');
  assert.equal(link.updatedAt, 2000);
  const cleared = updateLink(layout, id, { name: '' }, 3000).link;
  assert.equal(cleared.name, 'a.com');
  assert.equal(cleared.nameEdited, false);
});

test('removeLinks then restoreLinks brings links back, moving them if their cell was taken', () => {
  let { layout } = addLinks(emptyLayout(), [{ url: 'https://a.com/' }, { url: 'https://b.com/' }], opts());
  const [a] = layout.links;
  const removed = removeLinks(layout, [a.id]);
  assert.equal(removed.layout.links.length, 1);
  ({ layout } = addLinks(removed.layout, [{ url: 'https://c.com/' }], opts()));
  const restored = restoreLinks(layout, removed.removed);
  const back = restored.layout.links.find((l) => l.id === a.id);
  assert.ok(back);
  assert.notDeepEqual(back.cell, layout.links.find((l) => l.url === 'https://c.com/').cell);
});

test('restoreLinks does not duplicate links that still exist', () => {
  const { layout } = addLinks(emptyLayout(), [{ url: 'https://a.com/' }], opts());
  assert.equal(restoreLinks(layout, layout.links).layout.links.length, 1);
});

test('setCells ignores invalid cells and unknown ids', () => {
  const { layout } = addLinks(emptyLayout(), [{ url: 'https://a.com/' }], opts());
  const id = layout.links[0].id;
  const next = setCells(layout, { [id]: { col: 5, row: 2 }, ghost: { col: 1, row: 1 } });
  assert.deepEqual(next.links[0].cell, { col: 5, row: 2 });
  assert.deepEqual(setCells(layout, { [id]: { col: -1, row: 0 } }).links[0].cell, layout.links[0].cell);
});

test('findDuplicate ignores the link being edited', () => {
  const { layout } = addLinks(emptyLayout(), [{ url: 'https://a.com/' }], opts());
  assert.ok(findDuplicate(layout, 'https://a.com/'));
  assert.equal(findDuplicate(layout, 'https://a.com/', layout.links[0].id), null);
});

test('normalizeSettings falls back to defaults', () => {
  assert.deepEqual(normalizeSettings(null), { iconSize: 'm', wallpaper: { kind: 'preset', value: 'plain' } });
  assert.deepEqual(normalizeSettings({ iconSize: 'xl', wallpaper: { kind: 'preset', value: 'mars' } }).wallpaper.value, 'plain');
  assert.equal(normalizeSettings({ iconSize: 'l' }).iconSize, 'l');
  assert.equal(normalizeSettings({ wallpaper: { kind: 'preset', value: 'midnight' } }).wallpaper.value, 'midnight');
});
