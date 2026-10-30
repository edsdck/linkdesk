# Linkdesk — Spec (v0.2, draft)

A Firefox extension that replaces the new tab page with a minimal PC desktop, where you pin links as icons and open them.

Status: spec only, not implemented. v0.2 applies two independent reviews (UX and Firefox engineering).

---

## 1. Goals

- New tab shows a simple, flat PC desktop filling the whole tab: wallpaper, icons, taskbar.
- Links live on the desktop as icons with a label, placed anywhere on a grid.
- Adding a link takes one or two actions: from the desktop, the toolbar, or a right-click on any page or link.
- Editing a link (name, URL, icon) is quick.
- Icons come from the site's favicon automatically, or the user picks their own.
- Everything looks native to current Firefox.

## 2. Non-goals (v1)

- Chrome, Edge, Safari. Firefox only; keep code WebExtension-standard so a port stays cheap later.
- Folders, multiple desktops, widgets, windows or "apps".
- Cloud sync between devices (export/import JSON covers moving data).
- Any device drawing (laptop, monitor frame) or detailed skeuomorphic rendering.
- Overriding the Firefox homepage. Only the new tab page is replaced.

Cut from v1 after review (candidates for later):

- Double-click-to-open mode. v1 is single click only.
- Dragging a selected group of icons.
- Taskbar search (the address bar already does this) and the start menu.
- "Image URL" icon source (upload and paste cover it).
- Third-party favicon services (Google, DuckDuckGo).
- Forcing light or dark separately from Firefox.
- "Arrange by name" (only "Pack to top-left" stays).

## 3. Platform

| Item | Choice |
|---|---|
| Browser | Firefox desktop 140+ (the first version with built-in data consent). Pin `strict_min_version` to the current ESR at build time, never lower than 140 |
| Manifest | V3, with `browser_specific_settings.gecko.id` and `gecko.data_collection_permissions: { "required": ["none"] }` (required for new AMO add-ons since 3 Nov 2025) |
| Background | Event page (`background.scripts`), not a service worker. Registers menus and owns all storage writes |
| Entry points | New tab override (`chrome_url_overrides.newtab`), toolbar button (popup), context menus |
| Storage | `browser.storage.local`, split into small keys (section 11) |
| Build | Plain HTML/CSS/JS or a light bundler. No framework required |

Permissions:

- Required: `storage`, `menus`, `menus.overrideContext` (not allowed as optional), `activeTab`, `scripting`, `theme` (for `theme.getCurrent()`).
- Optional (`optional_host_permissions` for hosts, `optional_permissions` for the rest), each asked once from an explicit button on a full page (the first-run card or Settings), synchronously in the click handler, never from the popup (origin requests from popups are unreliable, see Firefox bug 1432083) and never after an `await`:
  - `<all_urls>`: "Fetch site icons and titles". Without it, new links get a letter tile and the hostname as name, except links added from the toolbar popup or the page context menu (section 8 explains how `activeTab` covers those).
  - `bookmarks`: "Import from bookmarks".
  - `topSites`: "Import your most visited sites".
- No `notifications` permission: confirmations use the toolbar badge (section 6).

Firefox behaviour to account for:

- On every new tab, focus is in the address bar and an extension cannot take it. Desktop keyboard shortcuts work only after the user clicks or tabs into the desktop.
- Firefox shows its own "An extension changed your new tab" notice on install. If the user picks Restore, the extension is disabled; nothing to handle beyond that.
- Private windows: the extension runs there only if the user allows it in Firefox. If allowed, it works the same way and links added there are saved like any other.

## 4. Look

Sketch 1: the desktop (whole new tab)

```
┌──────────────────────────────────────────────────────────────┐
│                                                              │
│   ┌────┐    ┌────┐    ┌────┐    ┌────┐                       │
│   │ M  │    │ N  │    │ D  │    │ GH │                       │  ← icon tile (favicon)
│   └────┘    └────┘    └────┘    └────┘                       │
│    Mail      News      Docs     GitHub                       │  ← label, max 2 lines
│                                                              │
│   ┌────┐                                                     │
│   │ R  │                                ← wallpaper          │
│   └────┘                                                     │
│    Repo                                                      │
│                                                              │
├──────────────────────────────────────────────────────────────┤
│ [⚙]                                            12:41  30 Oct │  ← taskbar
└──────────────────────────────────────────────────────────────┘
  └ settings                                        time and date ┘
```

- The desktop fills the whole tab, edge to edge. No device frame.
- Flat shapes, light shadows, rounded icon tiles. Minimal, not a copy of any real OS.

**Native Firefox look (required).** Every piece of UI should look like it belongs in current Firefox:

- Copy the colour, type, radius, spacing and focus-ring values from Firefox's current design system, Acorn (acorn.firefox.com, which MDN points to), into our own CSS variables. `browser_style` stopped working in MV3 in Firefox 118.
- Light and dark follow `prefers-color-scheme` (via CSS `light-dark()` on the Acorn values), as Firefox's own in-content pages do. There is no separate setting. In forced-colours (High Contrast) mode, selection and drop targets switch to system colours (`Highlight`).
- If `browser.theme.getCurrent()` returns colours (a theme from an extension), use them for the taskbar and accent colour and listen to `theme.onUpdated`. Without such a theme it returns an empty object, which is the common case.
- Use the system UI font (`font: message-box` / `system-ui`).
- Right-click menus on the desktop and on icons are **Firefox's own context menus** (`browser.menus` with `menus.overrideContext({ showDefaults: false })`). The sketches show their items, not their styling.
- Dialogs are native `<dialog>` elements styled like Firefox in-content dialogs (no fake window title bars). One primary button per view.
- Wallpaper is the one place that may break from the browser look.

## 5. Desktop

### 5.1 Grid and icons

- Each icon is a real link (`<a href>`) with a 48 px image and a label (max two lines, ellipsis after). Hovering shows a tooltip with the full name; Firefox shows the URL in its status bar.
- Icons sit on a grid. Column count comes from the window width and icon size; rows extend downward and the desktop scrolls vertically if they don't fit.
- Positions are stored as grid cells (`col`, `row`), so they survive window resizing.
- If the window is too narrow for a stored column, the icon is shown in the next free cell for display only; its saved cell is kept. If the user moves anything while icons are displaced, the displayed positions are saved.
- New icons go to the first free cell, left to right, top to bottom, or to the drop cell when dragged in.

### 5.2 Opening a link

Icons are plain links, so Firefox handles opening:

| Action | Result |
|---|---|
| Click | Open in the current tab |
| Middle-click / Ctrl+click | Open in a new tab (Firefox's background-tab preference applies) |
| Shift+click | Open in a new window |
| Enter on a focused icon | Open in the current tab |
| Drag an icon to the tab strip | Not supported (icons use pointer events for moving; `draggable=false`) |

### 5.3 Moving links in the grid

Links can be placed in any cell, not just packed at the top-left. Gaps are allowed and kept.

**With the mouse**

- Press on an icon and drag more than 4 px to start moving it. A shorter press is a click, so moving never opens the link by accident and a click never moves it.
- While dragging:
  - a faded copy of the icon follows the pointer,
  - the original cell shows an empty dashed outline,
  - every free cell shows a faint dot,
  - the cell under the pointer gets an accent outline. If it holds another icon, that icon shows a swap arrow.
- Drop on an **empty cell**: the icon moves there.
- Drop on an **occupied cell**: the two icons swap places.
- Drop on the taskbar, outside the window, or press **Esc**: the move is cancelled and the icon returns.

Sketch 2: dragging "Repo" to a new cell

```
┌──────────────────────────────────────────────────────────────┐
│                                                              │
│   ┌────┐    ┌────┐    ┌────┐    ┌────┐    ╔════╗      ·      │
│   │ M  │    │ N  │    │ D  │    │ GH │    ║    ║             │  ← drop target outlined
│   └────┘    └────┘    └────┘    └────┘    ╚════╝             │
│    Mail      News      Docs     GitHub        ↖ ┌┄┄┄┄┐       │
│                                                 ┆ R  ┆       │  ← faded copy follows pointer
│   ┌┄┄┄┄┐      ·         ·         ·            └┄┄┄┄┘       │
│   ┆    ┆                                                     │  ← original cell, dashed
│   └┄┄┄┄┘                                                     │
│                                                              │
│     ·         ·         ·         ·         ·         ·      │  ← every free cell shows a dot
│                                                              │
├──────────────────────────────────────────────────────────────┤
│ [⚙]                                            12:41  30 Oct │
└──────────────────────────────────────────────────────────────┘
```

Sketch 3: drop rules

```
  Drop on empty cell → move           Drop on occupied cell → swap

  [M] [N] [ ] [ ]                     [M] [N] [D]⇄
   └──────►                            └───────►
  [ ] [N] [M] [ ]                     [D] [N] [M]
```

**With the keyboard** (once the desktop has focus)

- Arrow keys move focus between icons.
- **Ctrl+Arrow** moves the focused icon one cell, with the same move/swap rules.
- Each keyboard move is announced through a live region, e.g. "GitHub moved to row 2, column 3".

**Tidy up**

- Desktop right-click → **Pack to top-left** removes all gaps, keeping the current order. Can be undone.

**Saving and undo**

- Moves are saved immediately on drop.
- Every move, swap and pack can be undone (section 5.5).

### 5.4 Selection

Selection exists only to delete several icons at once.

- Drag a rectangle on empty desktop space to select icons. Space toggles selection on the focused icon; Shift+Arrow extends it.
- Selected icons get a highlight (outline plus tint, not colour alone).
- Delete removes the selection. Esc or a click on empty space clears it.
- Ctrl/Shift+click do **not** select; they keep their link meanings (section 5.2).

### 5.5 Menus, shortcuts and undo

Right-click menus are native Firefox menus. Native menus cannot show shortcut hints on the right, so the sketches show none.

Sketch 4: icon menu and desktop menu

```
   ┌────┐                            ┌──────────────────────────┐
   │ GH │                            │ New link…                │
   └────┘┌──────────────────────┐    │ Paste link               │
   GitHub│ Open                 │    │──────────────────────────│
         │ Open in new tab      │    │ Pack to top-left         │
         │ Open in new window   │    │──────────────────────────│
         │──────────────────────│    │ Wallpaper…               │
         │ Edit…                │    │ Settings…                │
         │ Rename               │    └──────────────────────────┘
         │ Copy link            │     right-click on empty desktop
         │──────────────────────│
         │ Delete               │
         └──────────────────────┘
          right-click on an icon
```

- "Wallpaper…" opens Settings scrolled to the wallpaper row. The same name is used everywhere.
- "Paste link" calls `navigator.clipboard.readText()`. Without the `clipboardRead` permission, Firefox 147+ shows its own small "Paste" prompt first, which is fine. On Firefox below 147 the item is hidden. Ctrl+V needs no permission: it reads the native `paste` event's `clipboardData`.
- "Edit…" opens the link editor; "Rename" edits the label in place.

Keyboard shortcuts, active only while the desktop has focus:

| Key | Action |
|---|---|
| Arrows / Ctrl+Arrows | Move focus / move icon |
| Enter | Open |
| F2 | Rename in place |
| Delete | Delete focused or selected icons |
| Ctrl+V | Paste a link (section 6) |
| Ctrl+Z | Undo |
| Shift+F10 / Menu key | Open the context menu for the focused icon |

No shortcut uses a Firefox-reserved combination (Ctrl+N, Ctrl+T, Ctrl+W…).

Undo:

- Delete, move, swap, pack and rename can be undone with Ctrl+Z or the toast button, e.g. `Moved "Repo" · Undo`.
- The toast stays 6 s, or longer while hovered or focused.
- Undo history lives only in the current tab and is lost when the tab closes.

### 5.6 First run and empty desktop

When there are no links, the desktop shows a centred card instead of an empty wallpaper.

Sketch 5: empty desktop

```
┌──────────────────────────────────────────────────────────────┐
│                                                              │
│              ┌──────────────────────────────────┐            │
│              │  Your desktop is empty           │            │
│              │  Pin the sites you open most.    │            │
│              │                                  │            │
│              │  [ Add a link ]                  │            │  ← primary
│              │  [ Import most visited sites ]   │            │
│              │  [ Import bookmarks… ]           │            │
│              │  [ Import file… ]                │            │
│              │  ──────────────────────────────  │            │
│              │  ☐ Fetch site icons and titles   │            │  ← asks for host access
│              │  Right-click the desktop or paste│            │
│              │  a link here at any time.        │            │
│              └──────────────────────────────────┘            │
│                                                              │
├──────────────────────────────────────────────────────────────┤
│ [⚙]                                            12:41  30 Oct │
└──────────────────────────────────────────────────────────────┘
```

- Each import button asks for its optional permission on click, then imports.
- "Import bookmarks…" opens a picker with the bookmarks toolbar preselected.
- The card disappears once there is at least one link. The same actions stay in the desktop menu and Settings.

## 6. Adding links

1. **Desktop right-click → New link…** Opens the link editor, cursor in the URL field.
2. **Paste**: right-click → "Paste link", or Ctrl+V while the desktop has focus. Adds the icon directly, no dialog. If the clipboard is not a link, a toast says "That's not a link".
3. **Drag and drop**: drop a link or URL text from a page onto the desktop. The icon is created at the drop cell, no dialog. Dropping a tab from the tab strip is a stretch goal: prototype it first, and ship only if Firefox gives the page a usable `text/uri-list` or `text/x-moz-url`.
4. **Toolbar button**: popup shows the current page's title, URL and favicon with one **Add to desktop** button. "Edit first" expands a compact editor (name, and site icon or letter tile) inside the popup. No image upload there: opening a file picker closes a toolbar popup.
5. **Context menu on any page**: "Add page to Linkdesk" and, on a link, "Add link to Linkdesk". Adds directly. The toolbar button badge shows ✓ for 2 s as confirmation.

For paths 2, 3 and 5 the icon appears at once as a letter tile with the hostname as name, then the real title and favicon replace them when fetched (section 8). A name the user has edited is never replaced.

Duplicate URLs are allowed; the editor and popup show "Already on your desktop".

Sketch 6: toolbar popup

```
┌──────────────────────────────┐
│  ┌────┐  GitHub              │
│  │ GH │  github.com          │
│  └────┘                      │
│  ⓘ Already on your desktop   │
│                              │
│  [      Add to desktop     ] │  ← primary
│   Edit first ⌄               │
├──────────────────────────────┤
│  Name  [ GitHub            ] │  ← compact editor, shown after "Edit first"
│  Icon  (•) Site icon         │
│        ( ) Letter  [G] ■■■■  │
└──────────────────────────────┘
```

Sketch 7: page context menu (Firefox's own menu, two items added)

```
  ┌────────────────────────────┐
  │ Open Link in New Tab       │
  │ ...                        │
  │────────────────────────────│
  │ ■ Add link to Linkdesk     │   ← on a link
  │ ■ Add page to Linkdesk     │   ← anywhere on the page
  └────────────────────────────┘
```

## 7. Link editor

A native `<dialog>` styled like a Firefox in-content dialog.

- **URL** (required). If the text has no `scheme://`, `https://` is added (so `github.com` and `localhost:3000` both work). Only http and https are accepted; anything else shows an inline error.
- **Name**. Filled from the page title when fetched; the user's edit always wins.
- **Icon**, with a live preview and three sources:
  - **Site icon** (default): fetched from the URL (section 8). **Refresh** re-fetches from the stored source. If fetching fails, the preview shows the letter tile and a short "Couldn't get the site icon" note.
  - **Upload**: choose a PNG, JPEG, WebP, SVG or ICO file, or paste an image. Converted to a 128×128 PNG.
  - **Letter tile**: up to two characters or one emoji on a coloured square, colour from a small preset palette.

Buttons: **Save** (primary), **Cancel**, and **Delete** when editing an existing link. Enter saves, Esc cancels.

Sketch 8: link editor

```
┌─────────────────────────────────────────────────────────┐
│  Edit link                                              │
│                                                         │
│  URL    [ https://github.com                         ]  │
│  Name   [ GitHub                                     ]  │
│                                                         │
│  Icon   ┌──────┐   (•) Site icon          [ Refresh ]   │
│         │  GH  │   ( ) Upload…            [ Choose… ]   │
│         │      │   ( ) Letter      [ G ]  ■ ■ ■ ■ ■ ■   │
│         └──────┘                                        │
│                                                         │
│  ⓘ Already on your desktop                              │
│                                                         │
│  [ Delete ]                        [ Cancel ] [ Save ]  │
└─────────────────────────────────────────────────────────┘
```

## 8. Fetching titles and favicons

Runs in the background script after the icon is already shown as a letter tile.

Sources, in order; stop at the first usable image:

1. The tab's `favIconUrl`, when the link came from an open tab, fetched by the extension (not drawn from an `<img>`, which would taint the canvas).
2. The page HTML: read `<title>` and `<link rel="icon">`, `rel="apple-touch-icon"`, `rel="shortcut icon"`. Prefer the largest size ≥ 48 px; prefer apple-touch-icon.
3. `https://<host>/favicon.ico`.
4. Keep the letter tile, colour derived from the hostname.

Steps 2 and 3 need host access (`<all_urls>`). Without it:

- Links added from the toolbar popup or the page context menu: `activeTab` gives the tab's title, URL and `favIconUrl`, but in Firefox it does **not** let extension scripts `fetch` that site. Instead the extension injects a small script into the tab (`scripting.executeScript`, allowed by `activeTab`). It reads the icon `<link>` tags and fetches the icon from the page itself, which works for icons on the same site. Icons on another host (a CDN) fall back to the letter tile.
- Every other path: letter tile, hostname as name.

Rules:

- `fetch` with `credentials: 'omit'`; follow redirects and resolve relative icon URLs against the final URL and any `<base href>`.
- Timeout 5 s per request. Size caps: 1 MB for HTML, 512 KB for images. Icons must be `image/*`, or have no or a generic type (`application/octet-stream`, common for `.ico` files) and still decode as an image; anything else is rejected.
- At most 4 sites are fetched at a time; a link already being fetched isn't fetched twice.
- Icon URLs named by a page may not point at loopback, private-network, link-local or single-label/intranet hosts (unless the link itself is on one), and icon requests don't follow redirects. Known limit: a public name that resolves to a private address (DNS rebinding) isn't caught; that would need the `dns` permission.
- Only web URLs are stored as an icon's `source`, never image data, so the layout key stays small.
- Parse HTML with `DOMParser`; never insert fetched content with `innerHTML`.
- Decode with `createImageBitmap` and draw to a canvas; SVGs without a size are drawn at 128 px. Store the result as a 128×128 PNG.
- Store the source URL with the link so Refresh and a later retry know what to fetch. Failed fetches are retried once the next time the desktop opens while online.

## 9. Taskbar

- **Settings** button (left).
- **Clock** (right): time and date always shown, format from the locale.
- No start menu or search in v1.

## 10. Settings

A full extension page (also opened from `about:addons`), styled like Firefox settings. It always opens in its own tab next to the desktop, or switches to an already open settings tab. It never replaces the desktop tab, which `runtime.openOptionsPage()` would do from a new tab page.

Sketch 9: settings

```
┌───────────────────────────────────────────────────────────┐
│  Linkdesk settings                                        │
│                                                           │
│  Icon size           ( ) Small   (•) Medium ( ) Large     │
│                                                           │
│  Wallpaper           [▓▓] [░░] [▒▒] [██]  [ Upload… ]     │
│                                                           │
│  Site icons          ☑ Fetch site icons and titles        │
│                        (allows access to websites)        │
│                                                           │
│  Import              [ Most visited ] [ Bookmarks… ]      │
│  Data                [ Export… ] [ Import file… ]         │
│                      [ Reset desktop ]                    │
└───────────────────────────────────────────────────────────┘
```

- Turning "Fetch site icons and titles" on asks for `<all_urls>`; turning it off removes the permission.
- Wallpaper upload is resized to at most 2560 px wide and stored as WebP or JPEG, max 1 MB.
- Import file asks "Merge" or "Replace" (Replace is marked as destructive). On an empty desktop, the first-run card's "Import file…" restores the file as is, settings included. Reset and Replace ask for confirmation; they are the only actions without undo.

## 11. Data model

Small keys, so a move never rewrites image data.

```jsonc
// browser.storage.local
{
  "layout": {
    "version": 1,
    "links": [
      {
        "id": "uuid",
        "url": "https://github.com",
        "name": "GitHub",
        "nameEdited": false,                 // true once the user renames it
        "icon": {
          "kind": "site" | "upload" | "letter",
          "source": "https://github.com/favicon.ico", // site only, for Refresh / retry
          "text": "G", "color": "#3b82f6"             // letter only
        },
        "cell": { "col": 0, "row": 0 },
        "createdAt": 1767225600000,
        "updatedAt": 1767225600000
      }
    ]
  },
  "icon:<id>": "data:image/png;base64,...",  // one key per link, site and upload kinds
  "wallpaperImage": "data:image/webp;base64,...",
  "settings": {
    "iconSize": "s" | "m" | "l",
    "wallpaper": { "kind": "preset" | "image", "value": "gradient-1" }
  }
}
```

- All writes go through the background script (via `runtime.sendMessage`), so several open new tabs and the popup can't overwrite each other. Open desktops update from `storage.onChanged`.
- Migrations run lazily in a shared loader on first read, so a new tab that opens before `onInstalled` finishes still works.
- Size budget: about 20 KB per icon and 1 MB for the wallpaper, so `unlimitedStorage` isn't needed.

Export / import:

- Export writes `layout`, `settings` and icon data into one JSON file.
- Import validates the schema and accepts only http(s) URLs and PNG/JPEG/WebP data URLs, which are re-decoded and re-encoded. Size caps as above. Ids are regenerated. On merge, links that clash on a cell go to the next free cell.

## 12. Implementation notes

- Desktop menus: the new tab page's `contextmenu` handler records which icon (if any) was clicked, then calls `menus.overrideContext({ showDefaults: false })`. Icon items and desktop items are shown or hidden in `menus.onShown`, followed by `menus.refresh()`. The page itself listens to `menus.onClicked` and uses the recorded icon id. (`menus.getTargetElement` would also work, but only in the page that holds the element, never in the background.)
- Menu items are limited to our page with `viewTypes: ["tab"]` plus `documentUrlPatterns` set to the new tab page URL (confirmed in Firefox 158: patterns match `moz-extension://` URLs). They are also created hidden and only shown from `menus.onShown` on the desktop.
- Page context menu items ("Add page/link to Linkdesk") are registered in the background script.
- Icons use pointer events for moving, with `draggable=false` on the link and image.
- New tab first paint: the page's CSS sets the background colour inline so there is no white flash. The page reads `layout`, `settings` and all `icon:*` keys in one `storage.local.get` call.

## 13. Accessibility

- Icons are links in a grid with the link name as accessible label; arrow keys move focus.
- All menu actions are reachable by keyboard (Shift+F10 / Menu key).
- Keyboard moves and deletes are announced in a live region.
- Selection and drop targets use outline as well as colour.
- Dialogs trap focus and restore it on close.
- Respect `prefers-reduced-motion`.

## 14. Acceptance criteria (v1)

- Opening a new tab shows the saved desktop with icons within 100 ms of navigation start (measured with `performance.mark`, mid-range laptop, 50 links), with no white flash.
- A first-time user sees the empty-desktop card and can add, import from most visited sites, or import a file from it.
- A user can add the current page from the toolbar in one click, and the icon shows its favicon.
- A user can paste a URL onto the desktop and get an icon at once, with title and favicon filled in shortly after when site access is granted.
- A user can rename, change the icon, change the URL and delete a link, and undo a delete.
- A user can drag a link to any empty cell (gaps are kept), swap two links by dropping one on the other, move a link with Ctrl+Arrow, pack the grid, and undo any of these. Positions survive a restart and a window resize.
- Middle-click and Ctrl/Shift-click on an icon behave like on any web link.
- Links and icons survive browser restart and work offline.
- Export then import on a fresh profile restores the same desktop.
- The add-on passes `web-ext lint` and AMO review with no warnings about `innerHTML` or undeclared data collection.

## 15. Open questions

1. Dropping a tab from the tab strip: ship it or not, depending on the prototype (section 6).
