// Desktop context menu items, shared by the background (creates them) and the
// desktop page (shows them only for right-clicks it handles).

export const ICON_ITEMS = [
  ['open', '&Open'],
  ['open-tab', 'Open in new &tab'],
  ['open-window', 'Open in new &window'],
  ['sep-1'],
  ['edit', '&Edit…'],
  ['rename', 'Re&name'],
  ['copy', '&Copy link'],
  ['sep-2'],
  ['delete', '&Delete'],
];

export const PAGE_ITEMS = [
  ['new-link', '&New link…'],
  ['paste-link', '&Paste link'],
  ['sep-3'],
  ['pack', 'Pac&k to top-left'],
  ['sep-4'],
  ['wallpaper', '&Wallpaper…'],
  ['settings', '&Settings…'],
];

export const menuId = (name) => `desk:${name}`;
export const DESKTOP_IDS = [...ICON_ITEMS, ...PAGE_ITEMS].map(([name]) => menuId(name));
export const PASTE_ID = menuId('paste-link');

// readText() without the clipboardRead permission needs Firefox 147+.
export const MIN_PASTE_VERSION = 147;
