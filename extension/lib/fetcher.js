// Fetches page titles and icons (section 8 of the spec). Background script only.

import { rankIcons, readDocument } from './favicon.js';
import { toIconPng } from './image.js';
import { isPrivateHost } from './url.js';

export const TIMEOUT_MS = 5000;
export const LINK_DEADLINE_MS = 15_000;
export const MAX_HTML_BYTES = 1_000_000;
export const MAX_IMAGE_BYTES = 512_000;

// fetch with a timeout and a hard size cap. Returns { blob, url, type } or null.
// redirect: 'follow' for the page the user chose; 'error' for URLs a page named,
// so a redirect can't send the request somewhere the host check never saw.
export async function fetchLimited(url, { maxBytes, accept, redirect = 'follow' }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      credentials: 'omit',
      redirect,
      signal: controller.signal,
      headers: accept ? { Accept: accept } : {},
    });
    if (!response.ok || !response.body) return null;
    const declared = Number(response.headers.get('content-length'));
    if (declared > maxBytes) return null;
    const reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        controller.abort();
        return null;
      }
      chunks.push(value);
    }
    const type = response.headers.get('content-type') ?? '';
    return { blob: new Blob(chunks, { type: type.split(';')[0] }), url: response.url || url, type };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// Title and ranked icon URLs for a page. Never throws.
export async function fetchPageMeta(pageUrl) {
  const page = await fetchLimited(pageUrl, { maxBytes: MAX_HTML_BYTES, accept: 'text/html' });
  if (!page || !/html/i.test(page.type)) return { title: '', iconUrls: rankIcons([], pageUrl) };
  // A public link that redirected into a private network: don't use what came back.
  if (allowedIconUrls([page.url], pageUrl).length === 0) return { title: '', iconUrls: [] };
  const doc = new DOMParser().parseFromString(await page.blob.text(), 'text/html');
  const { candidates, title, base } = readDocument(doc);
  let baseUrl = page.url;
  try {
    if (base) baseUrl = new URL(base, page.url).href;
  } catch {
    // keep the response URL
  }
  return { title, iconUrls: rankIcons(candidates, baseUrl) };
}

// Icon URLs come from untrusted pages: never let a public page point us at a
// private-network or loopback host (a link that is itself on one may use it).
export function allowedIconUrls(iconUrls, pageUrl) {
  let pagePrivate = false;
  try {
    pagePrivate = isPrivateHost(new URL(pageUrl).hostname);
  } catch {
    // keep the default
  }
  return iconUrls.filter((url) => {
    if (url.startsWith('data:image/')) return true;
    try {
      return pagePrivate || !isPrivateHost(new URL(url).hostname);
    } catch {
      return false;
    }
  });
}

// Content type plus file extension; the rest of the URL says nothing about the format.
export function typeHint(type, url) {
  try {
    return `${type} ${new URL(url).pathname.split('.').pop()}`;
  } catch {
    return type;
  }
}

// Tries each URL in order, within one overall deadline; returns { data, source } for the first that decodes.
export async function fetchFirstIcon(iconUrls) {
  const deadline = Date.now() + LINK_DEADLINE_MS;
  for (const url of iconUrls) {
    if (Date.now() > deadline) break;
    const image = await fetchLimited(url, { maxBytes: MAX_IMAGE_BYTES, accept: 'image/*', redirect: 'error' });
    if (!image) continue;
    if (image.type && !/^image\//i.test(image.type) && !/octet-stream/i.test(image.type)) continue;
    try {
      return { data: await toIconPng(image.blob, typeHint(image.type, url)), source: url };
    } catch {
      // not decodable, try the next one
    }
  }
  return null;
}
