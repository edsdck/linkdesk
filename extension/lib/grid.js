// Grid maths. Cells are { col, row }; layouts are Map<id, cell>.

export const cellKey = ({ col, row }) => `${col},${row}`;

export function columnsFor(width, cellWidth, padding) {
  return Math.max(1, Math.floor((width - padding * 2) / cellWidth));
}

export function occupiedSet(cells, exceptId) {
  const set = new Set();
  for (const [id, cell] of cells) if (id !== exceptId) set.add(cellKey(cell));
  return set;
}

// First free cell in reading order, starting at `from`.
export function firstFreeCell(occupied, cols, from = { col: 0, row: 0 }) {
  let { col, row } = from;
  if (col >= cols) {
    col = 0;
    row += 1;
  }
  for (;;) {
    if (!occupied.has(cellKey({ col, row }))) return { col, row };
    col += 1;
    if (col >= cols) {
      col = 0;
      row += 1;
    }
  }
}

const readingOrder = (a, b) => a.cell.row - b.cell.row || a.cell.col - b.cell.col || (a.createdAt ?? 0) - (b.createdAt ?? 0);

// Where each link is drawn for the current column count. Links whose saved cell
// is off-grid (or clashes) go to the next free cell; their saved cell is untouched.
export function displayCells(links, cols) {
  const result = new Map();
  const occupied = new Set();
  const sorted = [...links].sort(readingOrder);
  const deferred = [];
  for (const link of sorted) {
    const key = cellKey(link.cell);
    if (link.cell.col < cols && !occupied.has(key)) {
      result.set(link.id, { ...link.cell });
      occupied.add(key);
    } else {
      deferred.push(link);
    }
  }
  for (const link of deferred) {
    const cell = firstFreeCell(occupied, cols, { col: 0, row: link.cell.row });
    result.set(link.id, cell);
    occupied.add(cellKey(cell));
  }
  return result;
}

export function idAt(cells, target) {
  const key = cellKey(target);
  for (const [id, cell] of cells) if (cellKey(cell) === key) return id;
  return null;
}

// Moves `id` to `target`; swaps with whatever was there. Returns a new map.
export function moveTo(cells, id, target) {
  const next = new Map(cells);
  const from = cells.get(id);
  if (!from) return next;
  const other = idAt(cells, target);
  if (other === id) return next;
  next.set(id, { ...target });
  if (other) next.set(other, { ...from });
  return next;
}

// Removes gaps, keeping reading order.
export function pack(cells, cols) {
  const order = [...cells].sort(([, a], [, b]) => a.row - b.row || a.col - b.col);
  const next = new Map();
  order.forEach(([id], index) => next.set(id, { col: index % cols, row: Math.floor(index / cols) }));
  return next;
}

const DELTAS = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] };

// One cell in a direction, or null at the grid edge.
export function step(cell, dir, cols) {
  const [dc, dr] = DELTAS[dir];
  const col = cell.col + dc;
  const row = cell.row + dr;
  if (col < 0 || col >= cols || row < 0) return null;
  return { col, row };
}

// Icon that keyboard focus moves to. Left/right follow reading order;
// up/down pick the nearest icon in the closest row above or below.
export function neighbour(cells, id, dir) {
  const from = cells.get(id);
  if (!from) return null;
  const entries = [...cells].filter(([other]) => other !== id);
  if (dir === 'left' || dir === 'right') {
    const ordered = [...cells].sort(([, a], [, b]) => a.row - b.row || a.col - b.col);
    const index = ordered.findIndex(([other]) => other === id);
    const next = ordered[index + (dir === 'right' ? 1 : -1)];
    return next ? next[0] : null;
  }
  const sign = dir === 'down' ? 1 : -1;
  let best = null;
  for (const [other, cell] of entries) {
    const rowGap = (cell.row - from.row) * sign;
    if (rowGap <= 0) continue;
    const score = rowGap * 1000 + Math.abs(cell.col - from.col);
    if (!best || score < best.score) best = { id: other, score };
  }
  return best ? best.id : null;
}

export function cellsToObject(cells) {
  return Object.fromEntries([...cells].map(([id, cell]) => [id, { ...cell }]));
}
