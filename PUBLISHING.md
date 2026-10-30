# Publishing Linkdesk to the Firefox add-on store

A checklist to pick up where we left off. Everything the form asks for is in [store/listing.md](store/listing.md).

## Before you start

1. Decide on the version. `extension/manifest.json` and `package.json` say `0.1.0`; use `1.0.0` for a first public release if you like (change both).
2. Run every check and build the package:

   ```bash
   npm run check
   ```

   This runs unit tests, lint, the real-Firefox tests, and writes `dist/linkdesk-<version>.zip`.

3. Optional: make the GitHub repo public, so the listing can link to it for support:

   ```bash
   gh repo edit edsdck/linkdesk --visibility public --accept-visibility-change-consequences
   ```

   Then add `"homepage_url": "https://github.com/edsdck/linkdesk"` to the manifest.

## Submit

1. Sign in at <https://addons.mozilla.org/developers/> with a Firefox account.
2. **Submit a New Add-on** → **On this site** (listed in the store).
3. Upload `dist/linkdesk-<version>.zip`. The automatic validation should pass with no errors (it is the same check as `npm run lint`).
4. "Do you need to submit source code?" → **No**. Nothing is minified, transpiled or generated; the zip is the source.
5. Fill in the listing from [store/listing.md](store/listing.md): name, summary, description, categories, tags, support, licence (MIT), privacy policy (leave empty).
6. Upload the five screenshots from `store/screenshots/` with their captions.
7. Paste **Notes to reviewer** from store/listing.md.
8. Submit. Listed add-ons are signed straight away and reviewed by Mozilla, which can take from minutes to a few weeks.

## After submitting

- If a reviewer asks about `data_collection_permissions: "none"` (see [COMPLIANCE.md](COMPLIANCE.md), open item 2), the fallback is
  declaring `websiteContent` as an optional data permission. That change needs a new version.
- To ship an update: bump the version in both files, `npm run check`, then upload the new zip under **Manage My Submissions → New Version**.

## Still not verified in a real browser

- Dragging a tab from the tab strip onto the desktop (not shipped; see SPEC.md §6).
- The bookmarks import picker, image upload in the editor, wallpaper upload, High Contrast mode, and the real toolbar popup (it was only tested as a page). Try these by hand once with `npm start` before submitting.
