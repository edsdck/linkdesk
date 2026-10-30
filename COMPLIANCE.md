# Linkdesk — compliance notes

What applies to Linkdesk, how it complies, and what is still open. Checked 30 Oct 2026 against the
sources linked below. This is an engineering review, not legal advice.

## Mozilla Add-on Policies (AMO review)

Source: <https://extensionworkshop.com/documentation/publish/add-on-policies/>

| Rule | Linkdesk |
|---|---|
| 1.1 Unexpected features (changing the new tab page, homepage, search) must be opt-in and described | Replacing the new tab page is Linkdesk's primary function, not an unexpected side feature. Firefox's own "an extension changed your new tab" prompt (Keep / Restore) also counts, since 1.1 exempts changes Firefox prompts for after install. The listing must say plainly that it replaces the new tab page (draft below). The homepage and search engine are not touched. |
| 3.1 No obfuscated code; minified code needs reviewable source | Plain, unminified JavaScript. No build step. |
| 4.1 Only the permissions needed | Required: `storage`, `menus`, `menus.overrideContext`, `activeTab`, `scripting`, `theme`. Optional, asked from a button click: `<all_urls>` (site icons and titles), `bookmarks`, `topSites` (imports). Each is used, see SPEC.md §3. |
| 4.2 No remote code | None. All scripts ship in the package. |
| 4.3 New tab page must be in the add-on, not remote | `newtab/newtab.html` is bundled. |
| 4.4 Don't weaken page security (CSP) | Default MV3 CSP, nothing relaxed. |
| 4.5 Encrypt remote transport | Extension pages run under MV3's default `upgrade-insecure-requests`, so requests go over HTTPS. |
| 6 / 6.1 Data transmission only as needed; no ancillary data | No analytics, no developer server, no third-party services. Data stays in `storage.local`. |
| 6.2.1 Firefox 140+ built-in consent: declare practices accurately | Manifest declares `data_collection_permissions: { required: ["none"] }`. See the open question below. |

## Mozilla trademarks

Source: <https://www.mozilla.org/en-US/foundation/trademarks/policy/> (Firefox Add-on Guidelines section)

- The add-on's name, icon, description, graphics and screenshots must be free of Mozilla marks.
- **Fixed:** the new tab briefly used Firefox's own branding icon (`chrome://branding/...`) as its tab icon.
  That is a Mozilla mark in the add-on's UI, so the tab now shows Linkdesk's own icon. A browser test checks it.
- The icon uses colours from Firefox's brand palette (yellow, orange, pink, purple) on Linkdesk's own
  desktop shape. Colours alone aren't a Mozilla mark, but the icon must never borrow the logo's forms
  (flame, fox, globe), so it doesn't look like the Firefox logo or suggest Mozilla made it.
- The name "Linkdesk" contains no Mozilla mark. If a store listing wants to mention Firefox, the allowed
  pattern is "Linkdesk for Firefox", never "Firefox Linkdesk".
- Store screenshots must not feature the Firefox logo as if it were part of Linkdesk.

## Privacy law (GDPR and similar)

- Linkdesk's publisher receives no personal data: nothing is sent to us or to any third party.
- Requests go only to sites the user adds (to read their title and icon, after opting in to
  "Fetch site icons and titles"), and to the page the user is on when they add it from the toolbar
  or the page menu. These are the same requests a browser makes when visiting those sites.
- A privacy policy isn't required when no data is collected. A short privacy note in the listing
  is still good practice (draft below).

## Third-party material

- No third-party code ships in the extension. `web-ext` (MPL-2.0) is a dev tool only.
- Colour, size and radius values follow Firefox's Acorn design system. Only the values were reused in our
  own CSS; no Mozilla source files were copied.
- Site favicons and titles are stored locally for the user's own use, like a bookmark icon.
- `icons/linkdesk.svg` is original (drawn for Linkdesk; only the colour values come from Firefox's palette).

## Open items (decide before publishing)

1. **Name (decided 30 Oct 2026: keep "Linkdesk"):** Sennheiser ships desktop software called "LinkDesk"
   (for its Spectera wireless system: <https://docs.cloud.sennheiser.com/en-us/linkdesk/linkdesk/configuration.html>).
   No trademark record was found. Kept because Linkdesk is a free, non-profit add-on in a different field.
   Being free doesn't remove trademark risk on its own; if Sennheiser objects, rename then.
2. **`data_collection_permissions: none`:** the policy defines transmission as data handled "outside
   of the add-on or the local browser" and doesn't say whether fetching the user's own chosen sites counts.
   Our reading is that it doesn't (nothing leaves to us or to third parties, and it is opt-in). Confirm
   with AMO reviewers when submitting, or declare `websiteContent` as optional if they disagree.
3. **Licence and publisher (decided 30 Oct 2026):** MIT licence ([LICENSE](LICENSE)), published by "edsdck"
   from a personal repository. If this was ever built in connection with an employer, check ownership before publishing.
4. **Unverified paths:** dragging a tab from the tab strip is not shipped (SPEC.md §6, prototype pending).

## Draft listing text (AMO)

> Linkdesk replaces Firefox's new tab page with a simple desktop where you pin the sites you use most as
> icons. Add links from the toolbar button, the right-click menu, or by pasting, and drag them anywhere on
> the grid.
>
> **Privacy:** Linkdesk has no account, no analytics and no servers. Your links stay in your browser. If you
> turn on "Fetch site icons and titles", Linkdesk loads only the sites you add, to read their title and icon.
