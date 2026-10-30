# Firefox add-on store (AMO) listing

Copy these into the AMO submission form. Field limits are AMO's.

## Name

Linkdesk

## Add-on URL (slug)

linkdesk

## Summary (max 250 characters)

Replaces the new tab page with a simple desktop of your favourite sites. Pin links as icons, place them anywhere on a grid, and open them with a click. No account, no tracking: your links stay in your browser.

## Description

Linkdesk turns Firefox's new tab page into a tidy desktop for the sites you use most.

**Note:** installing Linkdesk replaces your new tab page. Firefox asks whether to keep the change, and you can switch back at any time by disabling the add-on.

What you can do:

- Pin a site from the toolbar button in one click, or right-click any page or link and choose "Add page to Linkdesk".
- Paste a link (Ctrl+V) or drop one from a web page onto the desktop.
- Drag icons to any spot on the grid. Drop one on another to swap them, or tidy everything with "Pack to top-left".
- Use the site's own icon, upload an image, or pick a letter tile and colour.
- Rename, edit and delete with Firefox's own right-click menus. Every change can be undone (Ctrl+Z).
- Keyboard friendly: arrow keys to move between icons, Ctrl+Arrow to move one, F2 to rename, Delete to remove.
- Choose from six wallpapers or use your own image. Light and dark follow Firefox.
- Import your most visited sites or bookmarks, and export everything to a file.

**Privacy**

Linkdesk has no account, no analytics and no servers. Your links, icons and settings are stored only in your browser.
If you turn on "Fetch site icons and titles", Linkdesk loads only the sites you add, to read their title and icon. It never contacts any other service.

**Permissions**

- Access your data for all websites (optional, off until you turn on "Fetch site icons and titles"): to load the title and icon of sites you add.
- Read and modify bookmarks (optional, asked when you import bookmarks).
- Access browsing history's top sites (optional, asked when you import most visited sites).

## Categories

- Tabs
- Appearance

## Tags

new tab, speed dial, bookmarks, start page, shortcuts, desktop

## Support

- Support website: <https://github.com/edsdck/linkdesk/issues> (works once the repo is public; until then leave empty or use an email)
- Support email: optional

## Licence

MIT License

## Privacy policy

Not required: Linkdesk collects no data. Leave empty, or paste the Privacy paragraph above.

## Screenshots (in `store/screenshots/`, 1280×800)

| File | Caption |
|---|---|
| `1-desktop.png` | Your favourite sites as icons on the new tab page |
| `2-move.png` | Drag icons anywhere on the grid; drop on another to swap |
| `3-editor.png` | Pick the site's icon, your own image, or a letter tile |
| `4-midnight.png` | Six wallpapers, or your own image |
| `5-settings.png` | Settings: icon size, wallpaper, site icons, import and export |

## Notes to reviewer

Linkdesk overrides the new tab page (chrome_url_overrides.newtab); the page is bundled in the add-on.
No remote code, no minified or generated code, no build step: the uploaded files are the source.

Permissions:
- storage: links and settings in storage.local.
- menus + menus.overrideContext: Firefox-native right-click menus on the desktop page, and "Add page/link to Linkdesk" on web pages.
- activeTab + scripting: when the user adds the current page from the toolbar button or page menu, a small script reads that page's own <link rel=icon> tags and fetches the same-site icon. Nothing else is read.
- theme: to match the active Firefox theme's colours.
- Optional <all_urls>: only after the user ticks "Fetch site icons and titles", to fetch the title and icon of sites the user added. Icon URLs pointing at private-network hosts are refused, and icon requests don't follow redirects.
- Optional bookmarks / topSites: only for the import buttons, requested on click.

data_collection_permissions is "none": nothing is sent to the developer or any third party. The only network
requests go to the sites the user added (or the page they are on), to read that site's title and icon.

To test: install, open a new tab (keep the change), click "Add a link", add any site. Toolbar button →
"Add to desktop" adds the current page. Right-click the desktop or an icon for the menus. Settings: gear in the taskbar.
