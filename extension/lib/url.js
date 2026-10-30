// URL helpers shared by every page. No browser APIs, so they run under node:test too.

const SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;
export const MAX_URL = 2048;

// Colours from Firefox's Acorn palette, used for letter tiles.
export const LETTER_COLORS = [
  '#0061e0', '#008787', '#d7264c', '#8000d7',
  '#058b00', '#c45a27', '#592acb', '#0090ed',
];

function plausibleHost(hostname) {
  return hostname === 'localhost' || hostname.includes('.') || hostname.startsWith('[');
}

// Turns user input into an absolute http(s) URL, or null.
// "github.com" and "localhost:3000" get https:// added.
export function normalizeUrl(input) {
  const text = String(input ?? '').trim();
  if (!text || /\s/.test(text)) return null;
  // "mailto:x", "about:config"… name another scheme; "localhost:3000" is a host and port.
  const scheme = text.match(/^([a-z][a-z0-9+.-]*):(?!\d)/i)?.[1].toLowerCase();
  if (scheme && scheme !== 'http' && scheme !== 'https') return null;
  const withScheme = SCHEME.test(text) ? text : `https://${text}`;
  let url;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (!url.hostname || !plausibleHost(url.hostname)) return null;
  return url.href.length <= MAX_URL ? url.href : null;
}

// Loopback, private-network and link-local hosts. Pages may not point icon fetches at these.
export function isPrivateHost(hostname) {
  const host = String(hostname ?? '').toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (host === 'localhost' || /\.(localhost|local|lan|internal|intranet|corp|home\.arpa)$/.test(host)) return true;
  // Single-label names ("router", "intranet") only resolve on local networks.
  if (!host.includes('.') && !host.includes(':')) return true;
  const v4 = host.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168) || (a === 169 && b === 254);
  }
  if (!host.includes(':')) return false;
  // IPv6: loopback, unspecified, unique-local, link-local, and IPv4-mapped (::ffff:…).
  return host === '::1' || host === '::' || /^f[cd][0-9a-f]{0,2}:/.test(host) || host.startsWith('fe80:') || host.startsWith('::ffff:');
}

// Same as normalizeUrl, for pasted or dropped text: takes the first line only.
export function parseLinkText(text) {
  const first = String(text ?? '').trim().split(/\r?\n/)[0];
  return normalizeUrl(first);
}

export function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

export function isHttpUrl(url) {
  try {
    const { protocol } = new URL(url);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

// Up to `max` user-visible characters (keeps emoji intact).
export function graphemes(text, max) {
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  return Array.from(segmenter.segment(String(text ?? '')), (s) => s.segment).slice(0, max).join('');
}

export function letterFor(name, url) {
  const source = String(name || hostOf(url) || '?');
  const match = source.match(/[\p{L}\p{N}]/u);
  return (match ? match[0] : source[0] || '?').toUpperCase();
}

export function colorFor(url) {
  const host = hostOf(url);
  let hash = 0;
  for (const ch of host) hash = (hash * 31 + ch.codePointAt(0)) >>> 0;
  return LETTER_COLORS[hash % LETTER_COLORS.length];
}
