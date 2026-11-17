// Jump-mode key catcher. On a new tab the address bar keeps keyboard focus and the page
// can't take it, but this toolbar panel gets it: Alt+J opens it there, and it passes each
// key to the desktop tab, which shows and handles the letters. It closes when the desktop
// is done (link opened or jump cancelled), and closing it ends jump mode.

const tabId = Number(new URLSearchParams(location.search).get('tab'));
const port = browser.runtime.connect({ name: `jump:${tabId}` });
let answered = false;

port.onMessage.addListener((message) => {
  answered = true;
  if (message.typed !== undefined) document.getElementById('typed').textContent = message.typed;
  if (message.done) window.close();
});
port.onDisconnect.addListener(() => window.close()); // the desktop navigated away or closed

// No desktop answered (not loaded yet, or gone): say so instead of sitting there.
setTimeout(() => {
  if (answered) return;
  document.getElementById('status').textContent = 'Open the Linkdesk desktop first.';
  setTimeout(() => window.close(), 1500);
}, 1000);

document.addEventListener('keydown', (event) => {
  if (['Shift', 'CapsLock', 'Control', 'Alt', 'Meta'].includes(event.key)) return;
  event.preventDefault();
  port.postMessage({ key: event.key, shiftKey: event.shiftKey, ctrlKey: event.ctrlKey, altKey: event.altKey, metaKey: event.metaKey });
});
