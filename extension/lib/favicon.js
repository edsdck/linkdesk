// Picks which icon URLs to try, best first. Pure; the fetching lives in fetcher.js.

// rel tokens that name a usable icon ("shortcut icon" contains "icon"; "mask-icon" is monochrome, so skipped).
const ICON_RELS = ['icon', 'apple-touch-icon', 'apple-touch-icon-precomposed'];

function largestSize(sizes) {
  const value = String(sizes ?? '').toLowerCase();
  if (value.includes('any')) return 512;
  let best = 0;
  for (const match of value.matchAll(/(\d+)x(\d+)/g)) best = Math.max(best, Number(match[1]));
  return best;
}

// At most this many <link> candidates are tried per page (plus /favicon.ico).
export const MAX_CANDIDATES = 5;

// candidates: [{ href, rel, sizes, type }] as read from <link> tags.
export function rankIcons(candidates, baseUrl) {
  const scored = [];
  const seen = new Set();
  for (const candidate of candidates) {
    const rel = String(candidate.rel ?? '').toLowerCase().trim();
    if (!rel.split(/\s+/).some((token) => ICON_RELS.includes(token))) continue;
    let href;
    try {
      href = new URL(candidate.href, baseUrl).href;
    } catch {
      continue;
    }
    if (!/^(https?:|data:image\/)/.test(href) || seen.has(href)) continue;
    seen.add(href);
    const touch = rel.includes('apple-touch-icon');
    const isSvg = /svg/.test(candidate.type ?? '') || /\.svg(\?|#|$)/i.test(href);
    // Unsized icons are usually 16-32 px; touch icons are usually 180 px.
    const size = largestSize(candidate.sizes) || (isSvg ? 512 : touch ? 180 : 32);
    const score = (size >= 48 ? 10_000 : 0) + (touch ? 1_000 : 0) + size;
    scored.push({ href, score });
  }
  scored.sort((a, b) => b.score - a.score);
  const ranked = scored.slice(0, MAX_CANDIDATES).map((item) => item.href);
  try {
    const fallback = new URL('/favicon.ico', baseUrl).href;
    if (!ranked.includes(fallback)) ranked.push(fallback);
  } catch {
    // baseUrl not absolute: nothing to fall back to
  }
  return ranked;
}

// Reads candidate <link> tags and the title from a parsed Document.
export function readDocument(doc) {
  const candidates = [...doc.querySelectorAll('link[rel][href]')].map((el) => ({
    href: el.getAttribute('href'),
    rel: el.getAttribute('rel'),
    sizes: el.getAttribute('sizes') ?? '',
    type: el.getAttribute('type') ?? '',
  }));
  const title = (doc.querySelector('title')?.textContent ?? '').replace(/\s+/g, ' ').trim();
  const base = doc.querySelector('base[href]')?.getAttribute('href') ?? null;
  return { candidates, title, base };
}
