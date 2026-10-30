// Classic script, runs before the module graph loads: starts the storage read early.
window.linkdeskStorage = browser.storage.local.get(null);
