import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as grid from '../extension/lib/grid.js';

const cells = (entries) => new Map(Object.entries(entries));
const link = (id, col, row, createdAt = 0) => ({ id, cell: { col, row }, createdAt });

test('columnsFor never returns less than one column', () => {
  assert.equal(grid.columnsFor(1000, 100, 24), 9);
  assert.equal(grid.columnsFor(50, 100, 24), 1);
});

test('firstFreeCell scans in reading order and wraps', () => {
  const taken = new Set(['0,0', '1,0', '2,0']);
  assert.deepEqual(grid.firstFreeCell(taken, 3), { col: 0, row: 1 });
  assert.deepEqual(grid.firstFreeCell(taken, 4), { col: 3, row: 0 });
  assert.deepEqual(grid.firstFreeCell(new Set(), 3, { col: 5, row: 0 }), { col: 0, row: 1 });
});

test('displayCells keeps saved cells that fit and gaps between them', () => {
  const shown = grid.displayCells([link('a', 0, 0), link('b', 3, 2)], 5);
  assert.deepEqual(shown.get('a'), { col: 0, row: 0 });
  assert.deepEqual(shown.get('b'), { col: 3, row: 2 });
});

test('displayCells reflows icons beyond the column count without changing saved cells', () => {
  const links = [link('a', 0, 0), link('b', 6, 0), link('c', 1, 0)];
  const shown = grid.displayCells(links, 3);
  assert.deepEqual(shown.get('b'), { col: 2, row: 0 });
  assert.deepEqual(links[1].cell, { col: 6, row: 0 });
});

test('displayCells separates links that share a cell', () => {
  const shown = grid.displayCells([link('a', 1, 1, 1), link('b', 1, 1, 2)], 4);
  assert.deepEqual(shown.get('a'), { col: 1, row: 1 });
  assert.deepEqual(shown.get('b'), { col: 0, row: 1 });
});

test('moveTo moves into an empty cell', () => {
  const next = grid.moveTo(cells({ a: { col: 0, row: 0 }, b: { col: 1, row: 0 } }), 'a', { col: 4, row: 3 });
  assert.deepEqual(next.get('a'), { col: 4, row: 3 });
  assert.deepEqual(next.get('b'), { col: 1, row: 0 });
});

test('moveTo swaps with an occupied cell', () => {
  const next = grid.moveTo(cells({ a: { col: 0, row: 0 }, b: { col: 1, row: 0 } }), 'a', { col: 1, row: 0 });
  assert.deepEqual(next.get('a'), { col: 1, row: 0 });
  assert.deepEqual(next.get('b'), { col: 0, row: 0 });
});

test('moveTo onto itself changes nothing and does not mutate input', () => {
  const start = cells({ a: { col: 2, row: 2 } });
  const next = grid.moveTo(start, 'a', { col: 2, row: 2 });
  assert.deepEqual(next.get('a'), { col: 2, row: 2 });
  assert.notEqual(next, start);
});

test('pack removes gaps and keeps reading order', () => {
  const packed = grid.pack(cells({ c: { col: 1, row: 3 }, a: { col: 4, row: 0 }, b: { col: 0, row: 2 } }), 2);
  assert.deepEqual(packed.get('a'), { col: 0, row: 0 });
  assert.deepEqual(packed.get('b'), { col: 1, row: 0 });
  assert.deepEqual(packed.get('c'), { col: 0, row: 1 });
});

test('step stops at grid edges but rows extend downward', () => {
  assert.equal(grid.step({ col: 0, row: 0 }, 'left', 4), null);
  assert.equal(grid.step({ col: 0, row: 0 }, 'up', 4), null);
  assert.equal(grid.step({ col: 3, row: 0 }, 'right', 4), null);
  assert.deepEqual(grid.step({ col: 3, row: 9 }, 'down', 4), { col: 3, row: 10 });
});

test('neighbour follows reading order left/right and nearest column up/down', () => {
  const map = cells({ a: { col: 0, row: 0 }, b: { col: 3, row: 0 }, c: { col: 1, row: 2 }, d: { col: 3, row: 2 } });
  assert.equal(grid.neighbour(map, 'a', 'right'), 'b');
  assert.equal(grid.neighbour(map, 'b', 'right'), 'c');
  assert.equal(grid.neighbour(map, 'a', 'left'), null);
  assert.equal(grid.neighbour(map, 'b', 'down'), 'd');
  assert.equal(grid.neighbour(map, 'c', 'up'), 'a');
  assert.equal(grid.neighbour(map, 'a', 'up'), null);
});

test('idAt and cellsToObject', () => {
  const map = cells({ a: { col: 1, row: 1 } });
  assert.equal(grid.idAt(map, { col: 1, row: 1 }), 'a');
  assert.equal(grid.idAt(map, { col: 0, row: 0 }), null);
  assert.deepEqual(grid.cellsToObject(map), { a: { col: 1, row: 1 } });
});
