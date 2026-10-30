// Minimal WebDriver BiDi driver for Firefox: launches a throwaway profile,
// installs the extension and drives its pages with real input events.

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

export const EXTENSION_ID = 'linkdesk@linkdesk.extension';
export const EXTENSION_UUID = 'a6b5c4d3-1111-4222-8333-944455556666';
export const BASE = `moz-extension://${EXTENSION_UUID}/`;

const DEFAULT_FIREFOX = 'C:\\Program Files\\Mozilla Firefox\\firefox.exe';

const PREFS = {
  // Fixed internal UUID, so the test knows the extension's URLs.
  'extensions.webextensions.uuids': JSON.stringify({ [EXTENSION_ID]: EXTENSION_UUID }),
  // Grant optional permissions without the doorhanger (Firefox test pref).
  'extensions.webextOptionalPermissionPrompts': false,
  'browser.shell.checkDefaultBrowser': false,
  'browser.aboutwelcome.enabled': false,
  'datareporting.policy.dataSubmissionEnabled': false,
  'toolkit.telemetry.reportingpolicy.firstRun': false,
  'browser.startup.homepage_override.mstone': 'ignore',
};

export class Firefox {
  static async launch({ headless = true, port = 9333 } = {}) {
    const profile = mkdtempSync(join(tmpdir(), 'linkdesk-e2e-'));
    writeFileSync(
      join(profile, 'user.js'),
      Object.entries(PREFS).map(([k, v]) => `user_pref(${JSON.stringify(k)}, ${JSON.stringify(v)});`).join('\n'),
    );
    const args = ['--remote-debugging-port', String(port), '-remote-allow-system-access', '--profile', profile, '--no-remote', '--new-instance'];
    if (headless) args.push('--headless');
    const proc = spawn(process.env.FIREFOX ?? DEFAULT_FIREFOX, args, {
      stdio: 'ignore',
      // Newer Firefox wants the env var as well as the flag to expose extension pages and browser UI.
      env: { ...process.env, MOZ_REMOTE_ALLOW_SYSTEM_ACCESS: '1' },
    });
    const ff = new Firefox(proc, profile);
    await ff.connect(`ws://127.0.0.1:${port}/session`);
    return ff;
  }

  constructor(proc, profile) {
    this.proc = proc;
    this.profile = profile;
    this.nextId = 1;
    this.pending = new Map();
    this.logs = [];
  }

  async connect(url) {
    const deadline = Date.now() + 30_000;
    for (;;) {
      try {
        this.ws = await new Promise((resolve, reject) => {
          const ws = new WebSocket(url);
          ws.onopen = () => resolve(ws);
          ws.onerror = () => reject(new Error('connect failed'));
        });
        break;
      } catch (error) {
        if (Date.now() > deadline) throw error;
        await sleep(300);
      }
    }
    this.ws.onmessage = ({ data }) => {
      const message = JSON.parse(data);
      if (message.id && this.pending.has(message.id)) {
        const { resolve, reject } = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.type === 'error') reject(new Error(`${message.error}: ${message.message}`));
        else resolve(message.result);
      } else if (message.method === 'log.entryAdded') {
        this.logs.push(message.params);
      }
    };
    await this.send('session.new', { capabilities: {} });
    await this.send('session.subscribe', { events: ['log.entryAdded'] });
  }

  send(method, params = {}) {
    const id = this.nextId++;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }

  async installExtension(path) {
    return this.send('webExtension.install', { extensionData: { type: 'path', path } });
  }

  // BiDi refuses to navigate content to moz-extension:// URLs, so the tab is
  // opened from the browser window instead. Resolves to the new tab's context id.
  async openTab(url) {
    const before = new Set((await this.send('browsingContext.getTree', {})).contexts.map((c) => c.context));
    const chrome = await this.chromeWindow();
    await this.eval(chrome, (target) => {
      const principal = Services.scriptSecurityManager.getSystemPrincipal();
      gBrowser.selectedTab = gBrowser.addTab(target, { triggeringPrincipal: principal });
      return true;
    }, url);
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      const { contexts } = await this.send('browsingContext.getTree', {});
      const found = contexts.find((c) => c.url === url && !before.has(c.context));
      if (found) {
        await this.waitFor(found.context, () => document.readyState === 'complete');
        return found.context;
      }
      await sleep(100);
    }
    throw new Error(`Tab did not open: ${url}`);
  }

  async newTab(url) {
    const { context } = await this.send('browsingContext.create', { type: 'tab' });
    if (url) await this.send('browsingContext.navigate', { context, url, wait: 'complete' });
    return context;
  }

  async closeTab(context) {
    await this.send('browsingContext.close', { context });
  }

  // Runs fn(...args) in the page; the function's return value must be JSON-serialisable.
  async eval(context, fn, ...args) {
    const result = await this.send('script.callFunction', {
      functionDeclaration: `async (...a) => JSON.stringify(await (${fn})(...a.map((x) => JSON.parse(x))))`,
      arguments: args.map((arg) => ({ type: 'string', value: JSON.stringify(arg) })),
      target: { context },
      awaitPromise: true,
    });
    if (result.type === 'exception') throw new Error(`Page error: ${result.exceptionDetails.text}`);
    const value = result.result.value;
    return value === undefined ? undefined : JSON.parse(value);
  }

  async waitFor(context, fn, { timeout = 5000, args = [] } = {}) {
    const deadline = Date.now() + timeout;
    let last;
    while (Date.now() < deadline) {
      last = await this.eval(context, fn, ...args);
      if (last) return last;
      await sleep(100);
    }
    throw new Error(`Timed out waiting for ${fn}`);
  }

  pointer(context, actions) {
    return this.send('input.performActions', {
      context,
      actions: [{ type: 'pointer', id: 'mouse', parameters: { pointerType: 'mouse' }, actions }],
    });
  }

  click(context, x, y, button = 0) {
    return this.pointer(context, [
      { type: 'pointerMove', x: Math.round(x), y: Math.round(y) },
      { type: 'pointerDown', button },
      { type: 'pointerUp', button },
    ]);
  }

  drag(context, from, to, steps = 8) {
    const moves = [];
    for (let i = 1; i <= steps; i += 1) {
      moves.push({
        type: 'pointerMove',
        x: Math.round(from.x + ((to.x - from.x) * i) / steps),
        y: Math.round(from.y + ((to.y - from.y) * i) / steps),
        duration: 16,
      });
    }
    return this.pointer(context, [
      { type: 'pointerMove', x: Math.round(from.x), y: Math.round(from.y) },
      { type: 'pointerDown', button: 0 },
      ...moves,
      { type: 'pointerUp', button: 0 },
    ]);
  }

  // keys: e.g. ['Control', 'z'] pressed together, released in reverse.
  keys(context, keys) {
    const map = { Control: '\uE009', Shift: '\uE008', Alt: '\uE00A', Enter: '\uE007', Escape: '\uE00C', Delete: '\uE017', F2: '\uE032', ArrowLeft: '\uE012', ArrowUp: '\uE013', ArrowRight: '\uE014', ArrowDown: '\uE015', Space: ' ', Tab: '\uE004' };
    const values = keys.map((key) => map[key] ?? key);
    return this.send('input.performActions', {
      context,
      actions: [{
        type: 'key',
        id: 'keyboard',
        actions: [...values.map((value) => ({ type: 'keyDown', value })), ...values.reverse().map((value) => ({ type: 'keyUp', value }))],
      }],
    });
  }

  async type(context, text) {
    for (const ch of text) await this.keys(context, [ch]);
  }

  async screenshot(context, file) {
    const { data } = await this.send('browsingContext.captureScreenshot', { context });
    writeFileSync(file, Buffer.from(data, 'base64'));
  }

  // Chrome (browser UI) contexts, available with -remote-allow-system-access.
  async chromeWindow() {
    const { contexts } = await this.send('browsingContext.getTree', { 'moz:scope': 'chrome' });
    return contexts[0].context;
  }

  errors() {
    return this.logs.filter((entry) => entry.level === 'error');
  }

  async close() {
    try {
      await this.send('session.end');
    } catch {
      // already gone
    }
    this.ws?.close();
    this.proc.kill();
    await sleep(1000);
    try {
      rmSync(this.profile, { recursive: true, force: true });
    } catch {
      // Firefox may still hold files on Windows
    }
  }
}
