# Linkdesk

A Firefox extension that replaces the new tab page with a simple desktop: pin the sites you use most as
icons, place them anywhere on a grid, and open them with a click. It looks and behaves like part of Firefox.

- Add links from the toolbar button, the right-click menu on any page or link, by pasting, or by dropping a link.
- Drag icons to any cell; drop one on another to swap. Ctrl+Arrow moves with the keyboard. Everything can be undone.
- Site icons are fetched automatically (opt-in), or use your own image or a letter tile.
- Native Firefox context menus, light/dark from Firefox, six wallpapers or your own image.
- No account, no analytics, no servers. Your links stay in your browser.

Firefox 140 or later. See [SPEC.md](SPEC.md) for the full behaviour.

## Develop

```bash
npm install
npm start          # opens Firefox with Linkdesk installed temporarily; reloads on file changes
```

The extension is plain JavaScript in [`extension/`](extension/), with no build step.

| Command | What it does |
|---|---|
| `npm test` | Unit tests (grid, layout, URLs, import/export, favicon ranking) |
| `npm run test:e2e` | Drives a real Firefox with real mouse and keyboard input (needs Firefox installed; set `FIREFOX` to its path if it isn't in the default location) |
| `npm run lint` | `web-ext lint` |
| `npm run build` | Packs `dist/linkdesk-<version>.zip` for the Firefox add-on store |
| `npm run check` | All of the above, in order |
| `npm run icons` | Re-renders the PNG icons from `extension/icons/linkdesk.svg` |
| `npm run screenshots` | Re-captures the store screenshots in `store/screenshots/` |

## Publishing

See [PUBLISHING.md](PUBLISHING.md) for the step-by-step Firefox add-on store (AMO) submission, and
[COMPLIANCE.md](COMPLIANCE.md) for the policy, trademark and privacy review.

## Licence

[MIT](LICENSE)
