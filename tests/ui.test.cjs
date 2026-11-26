const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const pluginDirectory = path.join(__dirname, '..', 'plugin');
const html = readFileSync(path.join(pluginDirectory, 'index.html'), 'utf8');
const scriptSource = html.match(/<script src="([^"]+)"><\/script>\s*<\/body>/)?.[1];
const pluginScript = readFileSync(path.join(pluginDirectory, 'plugin.js'), 'utf8');
const scopeHtml = html.match(/<select id="scope">([\s\S]*?)<\/select>/)[1];
const defaultScope = scopeHtml.match(/<option value="([^"]+)" selected>/)[1];
let nextFixtureId = 0;

test('HTML loads its UI script from the same directory at the root and under a static subpath', () => {
  assert.ok(scriptSource, 'Expected a classic external script at the end of the body');
  for (const directory of ['/', '/penpot-localization-plugin/plugin/']) {
    const htmlUrl = new URL(`${directory}index.html`, 'https://example.test');
    assert.equal(new URL(scriptSource, htmlUrl).href,
      `https://example.test${directory}ui.js`);
  }
});

async function ui(data, options = {}) {
  const elements = new Map();
  for (const id of ['language', 'scope', 'status', 'translation-file', 'choose-file', 'source',
    'apply', 'restore', 'forget', 'remember-status', 'switch-direction',
    'target-direction', 'direction-choice', 'direction-status']) {
    const classes = new Set();
    elements.set(id, { value: id === 'scope' ? defaultScope : '', disabled: false,
      hidden: new RegExp(`<[^>]+id="${id}"[^>]*\\bhidden\\b`).test(html),
      clicks: 0, click() { this.clicks++; },
      textContent: id === 'source' ? 'Source: no file selected' : '', files: [], children: [], replaceChildren(...options) { this.children = options; },
      classList: {
        toggle(name, enabled) { if (enabled) classes.add(name); else classes.delete(name); },
        contains(name) { return classes.has(name); }
      }, listeners: {},
      addEventListener(name, fn) { this.listeners[name] = fn; } });
  }
  const fileInput = elements.get('translation-file');
  let fileValue = '';
  Object.defineProperty(fileInput, 'value', {
    get() { return fileValue; },
    set(value) {
      fileValue = value;
      if (value === '') this.files = [];
    }
  });
  const messages = [];
  const storageRequests = [];
  const contextRequests = [];
  const recoveryRequests = [];
  let receive;
  const parent = { postMessage(msg) {
    const message = JSON.parse(JSON.stringify(msg));
    if (['apply-language', 'restore-localization', 'switch-direction'].includes(message.type)) {
      if (options.failApplySend) throw new Error('Cannot post message');
      messages.push(message);
    }
    else if (message.type === 'design-context-request') {
      if (options.failContextSend) throw new Error('Cannot post message');
      contextRequests.push(message);
    }
    else if (message.type === 'recovery-status-request') recoveryRequests.push(message);
    else {
      if (options.failStorageSend === message.action) throw new Error('SANITIZED transport details');
      storageRequests.push(message);
    }
    receive(message);
  } };
  const events = {};
  const storage = options.storage || new Map();
  const normalizedPages = new WeakSet();
  function normalizePage(candidate) {
    if (!candidate || typeof candidate !== 'object') return candidate;
    if (!candidate.id) candidate.id = `page-${++nextFixtureId}`;
    if (normalizedPages.has(candidate)) return candidate;
    normalizedPages.add(candidate);
    if (!candidate.getPluginData) {
      const pageData = new Map();
      candidate.getPluginData = key => pageData.get(key) || '';
      candidate.setPluginData = (key, value) => pageData.set(key, value);
    }
    let knownLayers = [];
    const findShapes = candidate.findShapes.bind(candidate);
    candidate.findShapes = criteria => {
      knownLayers = findShapes(criteria);
      if (Array.isArray(knownLayers)) {
        for (const layer of knownLayers) {
          if (!layer.id) layer.id = `shape-${++nextFixtureId}`;
        }
      }
      return knownLayers;
    };
    if (!candidate.getShapeById) {
      candidate.getShapeById = id => knownLayers.find(layer => layer.id === id) || null;
    }
    return candidate;
  }
  function normalizeFile(candidate) {
    if (!candidate || typeof candidate !== 'object') return candidate;
    if (Array.isArray(candidate.pages)) candidate.pages = candidate.pages.map(normalizePage);
    return candidate;
  }
  let currentPage = normalizePage(options.currentPage || { findShapes: () => [] });
  let currentFile = normalizeFile({ id: options.fileId || 'file-a',
    pages: options.pages === undefined ? [currentPage] : options.pages });
  const historyEvents = [];
  const penpotEvents = {};
  const penpot = {
    on(type, callback) { penpotEvents[type] = callback; },
    async openPage(id) { this.currentPage = this.currentFile.pages.find(page => page.id === id); },
    history: {
      undoBlockBegin() { const id = Symbol('history'); historyEvents.push(['begin', id]); return id; },
      undoBlockFinish(id) { historyEvents.push(['finish', id]); }
    },
    localStorage: options.localStorage || {
      getItem: key => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
      removeItem: key => storage.delete(key)
    },
    ui: { open() {}, onMessage(fn) { receive = fn; }, sendMessage(data) {
      if (options.holdReplies && data.type === 'saved-import-result') options.holdReplies.push(data);
      else if (options.holdDirectionReplies && data.type === 'direction-result') options.holdDirectionReplies.push(data);
      else if (options.holdApplyReplies && data.type === 'localization-result') options.holdApplyReplies.push(data);
      else if (options.holdRestoreReplies && data.type === 'restore-result') options.holdRestoreReplies.push(data);
      else if (options.holdContextReplies && data.type === 'design-context-result') options.holdContextReplies.push(data);
      else if (options.holdRecoveryReplies && data.type === 'recovery-status-result') options.holdRecoveryReplies.push(data);
      else queueMicrotask(() => events.message({ source: parent, data: JSON.parse(JSON.stringify(data)) }));
    } }
  };
  Object.defineProperties(penpot, {
    currentPage: {
      get() { return normalizePage(currentPage); },
      set(value) { currentPage = normalizePage(value); penpotEvents.pagechange?.(currentPage); }
    },
    currentFile: {
      get() { return normalizeFile(currentFile); },
      set(value) { currentFile = normalizeFile(value); }
    }
  });
  vm.runInNewContext(pluginScript, { penpot, TextEncoder, setTimeout, clearTimeout, console: { error() {} } });
  const document = { activeElement: null, getElementById: id => elements.get(id) };
  for (const element of elements.values()) {
    element.focus = () => { document.activeElement = element; };
  }
  const context = vm.createContext({
    document, parent,
    window: { parent, addEventListener: (name, fn) => { events[name] = fn; } },
    Option: function(text, value) { this.text = text; this.value = value; this.disabled = false; }, TextEncoder, TextDecoder,
    fetch: () => { throw new Error("Unexpected network request"); }
  });
  const scriptPath = path.join(pluginDirectory, scriptSource);
  vm.runInContext(readFileSync(scriptPath, 'utf8'), context, { filename: scriptPath });
  await new Promise(resolve => setImmediate(resolve));
  const app = { elements, events, parent, messages, storageRequests, contextRequests,
    recoveryRequests, storage,
    penpot, document, historyEvents };
  if (data !== undefined) await importFile(app, JSON.stringify(data));
  return app;
}

const dictionary = { EN: {}, ES: {}, FR: {}, ZH: {} };
test('loaded dictionary enables selection and sends selected scope and language', async () => {
  assert.ok(html.indexOf('id="language"') < html.indexOf('id="apply"'));
  const app = await ui(dictionary);
  const select = app.elements.get('language');
  assert.equal(select.disabled, false);
  select.value = 'ES';
  select.listeners.change();
  assert.equal(app.messages.length, 1);
  assert.deepEqual(app.messages[0], {
    type: 'apply-language', requestId: 1, fileId: 'file-a', language: 'ES', scope: 'page',
    translations: dictionary
  });
});

test('startup and canceled first import keep language disabled without loading defaults', async () => {
  const app = await ui();
  assert.equal(app.elements.get('language').disabled, true);
  assert.equal(app.elements.get('translation-file').disabled, false);
  assert.equal(app.elements.get('source').textContent, 'Source: no file selected');
  assert.doesNotMatch(html, /id="reload"|Use bundled translations|fetch\(/);
  await app.elements.get('translation-file').listeners.change();
  app.elements.get('language').value = 'ES';
  app.elements.get('language').listeners.change();
  assert.equal(app.messages.length, 0);
  await importFile(app, '{"EN":[]}');
  assert.equal(app.elements.get('language').disabled, true);
  assert.match(app.elements.get('status').textContent, /Cannot import translations/);
  assert.equal(app.elements.get('source').textContent, 'Source: no file selected');
});

test('status ignores foreign windows and displays parent warnings as text', async () => {
  const replies = [];
  const app = await ui(dictionary, { holdApplyReplies: replies });
  app.elements.get('language').value = 'ES';
  app.elements.get('language').listeners.change();
  const status = app.elements.get('status');
  const initial = status.textContent;
  const result = { type: 'localization-result', requestId: replies[0].requestId, ok: true, language: 'ES',
    changed: 1, pageCount: 1, alreadyCorrect: 0, tagged: 2,
    missing: ['<img src=x onerror=alert(1)>'], skipped: 0, failed: 2, failedPages: 0,
    conflicts: 0, styled: 0, mirrored: 0, layoutSkipped: 3, layoutUnsupported: 2,
    layoutSubtreesSkipped: 1, styleConflicts: 0, styleMetadataConflicts: 0,
    layoutConflicts: 2, layoutMetadataConflicts: 1, styleFailed: 0, styleUnsupported: 0, layoutFailed: 2,
    layoutFailureReasons: { alignment: 0, constraints: 1, flexDirection: 0, margins: 0,
      metadata: 0, padding: 0, position: 1, target: 0 },
    rtl: false, layoutMirrored: false, layoutStateComplete: true,
    historyFailed: false, restoreAvailable: true };
  app.events.message({ source: {}, data: result });
  assert.equal(status.textContent, initial);
  app.events.message({ source: app.parent, data: result });
  assert.match(status.textContent, /Missing translation keys: <img/);
  assert.match(status.textContent, /1 component\/grid layout subtree/);
  assert.match(status.textContent, /2 unsupported layout target/);
  assert.match(status.textContent, /2 layout property update\(s\) failed: constraints: 1; position: 1/);
  assert.match(status.textContent, /1 unreadable RTL layout metadata record/);
  assert.match(status.textContent, /1 externally changed layout shape/);
  assert.doesNotMatch(status.textContent, /2 layer\(s\) could not be updated/);
  assert.equal(status.classList.contains('warning'), true);
  assert.equal(status.classList.contains('error'), false);
  assert.equal(app.elements.get('apply').textContent, 'Apply to current page');
  app.elements.get('language').value = 'EN';
  app.elements.get('language').listeners.change();
  app.events.message({ source: app.parent, data: { type: 'localization-result', requestId: replies[1].requestId, ok: false, error: 'Failed' } });
  assert.equal(status.textContent, 'Failed');
});

async function importFile(app, contents, extra = {}) {
  const input = app.elements.get('translation-file');
  const blob = new Blob([contents]);
  input.files = [{ name: 'my-translations.json', size: blob.size,
    text: () => blob.text(), arrayBuffer: () => blob.arrayBuffer(), ...extra }];
  input.value = `C:\\fakepath\\${input.files[0].name}`;
  await input.listeners.change();
}

test('successful import keeps the selected filename in the native file control', async () => {
  const app = await ui();
  await importFile(app, '{"EN":{}}');
  const input = app.elements.get('translation-file');
  assert.equal(input.value, 'C:\\fakepath\\my-translations.json');
  assert.equal(input.files[0].name, 'my-translations.json');
  assert.equal(app.messages.length, 0);
});

test('local import replaces language options without applying; custom language and empty values work', async () => {
  const app = await ui(dictionary);
  const data = { de: { 'login.title': 'Hallo' }, 'zh-Hans': { 'login.title': '' } };
  await importFile(app, '\uFEFF' + JSON.stringify(data));
  assert.equal(app.messages.length, 0);
  const select = app.elements.get('language');
  assert.deepEqual(select.children.map(option => option.value), ['', 'de', 'zh-Hans']);
  assert.equal(select.value, '');
  assert.equal(app.elements.get('source').textContent, 'Source: my-translations.json');
  assert.equal(app.elements.get('translation-file').value, 'C:\\fakepath\\my-translations.json');
  select.value = 'de';
  select.listeners.change();
  assert.deepEqual(app.messages[0].translations, data);
  assert.equal(app.messages[0].language, 'de');
});

test('English language labels name common codes and variants while preserving exact selection and saved codes', async () => {
  let writes = 0;
  const layer = { name: 'i18n.title', get characters() { return this.value; },
    set characters(value) { writes++; this.value = value; }, value: 'Original' };
  const expected = [
    ['EN', 'English (EN)'], ['ES', 'Spanish (ES)'], ['FR', 'French (FR)'], ['ZH', 'Chinese (ZH)'],
    ['AR', 'Arabic (AR)'], ['ar', 'Arabic (ar)'], ['ar-SA', 'Arabic (ar-SA)'],
    ['PT', 'Portuguese (PT)'], ['pt-BR', 'Portuguese (pt-BR)'], ['pt-PT', 'Portuguese (pt-PT)'],
    ['HI', 'Hindi (HI)'], ['hi-IN', 'Hindi (hi-IN)'], ['de', 'German (de)'],
    ['JA', 'Japanese (JA)'], ['KO', 'Korean (KO)'], ['UK', 'Ukrainian (UK)'],
    ['zh-Hans', 'Chinese (zh-Hans)'], ['qaa', 'qaa'], ['toString', 'toString']
  ];
  const data = Object.fromEntries(expected.map(([code]) => [code, { title: `Text for ${code}` }]));
  const currentPage = { findShapes: () => [layer] };
  const app = await ui(data, { currentPage });
  const select = app.elements.get('language');
  assert.deepEqual(select.children.slice(1).map(option => [option.value, option.text]), expected);
  assert.equal(writes, 0);
  for (const [code] of expected) {
    select.value = code;
    select.listeners.change();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(layer.characters, data[code].title);
    assert.equal(app.messages.at(-1).language, code);
    assert.deepEqual(app.messages.at(-1).translations, data);
  }
  assert.equal(writes, expected.length);
  const reopened = await ui(undefined, { storage: app.storage, currentPage });
  assert.deepEqual(reopened.elements.get('language').children.slice(1)
    .map(option => [option.value, option.text]), expected);
  assert.equal(reopened.elements.get('language').value, 'toString');
  assert.equal(writes, expected.length);
});

test('bad imports retain the previous dictionary and selection without design writes', async () => {
  const app = await ui(dictionary);
  const select = app.elements.get('language');
  select.value = 'ES';
  const invalid = ['{', 'null', '[]', '{}', '{"EN":[]}', '{"EN":{"a":42}}',
    '{"EN":{"a":{"nested":"value"}}}', '{"invalid code":{}}',
    '{"EN":{" padded ":"x"}}', '{"EN":{"":"x"}}',
    JSON.stringify({ EN: { a: 'x'.repeat(20001) } }),
    JSON.stringify({ EN: { ['x'.repeat(201)]: 'x' } }),
    JSON.stringify(Object.fromEntries(Array.from({ length: 65 }, (_, i) => [`en-${i}`, {}]))),
    JSON.stringify({ EN: Object.fromEntries(Array.from({ length: 10001 }, (_, i) => [`k${i}`, 'x'])) })];
  for (const contents of invalid) {
    await importFile(app, contents);
    assert.match(app.elements.get('status').textContent, /Cannot import translations/);
    assert.equal(select.disabled, false);
    assert.equal(select.value, 'ES');
    assert.equal(app.elements.get('source').textContent, 'Source: my-translations.json');
  }
  assert.equal(app.messages.length, 0);
  select.listeners.change();
  assert.deepEqual(app.messages[0].translations, dictionary);
});

test('oversize files are rejected before reading and failed reads leave import available', async () => {
  const app = await ui();
  await importFile(app, '{}', { size: 1024 * 1024 + 1,
    arrayBuffer: () => { throw new Error('must not read'); } });
  assert.match(app.elements.get('status').textContent, /1 MiB/);
  await importFile(app, '{}', { arrayBuffer: async () => { throw new Error('Cannot read file'); } });
  assert.match(app.elements.get('status').textContent, /Cannot read file/);
  assert.equal(app.elements.get('translation-file').disabled, false);
  assert.equal(app.elements.get('translation-file').value, '');
  assert.deepEqual(app.elements.get('translation-file').files, []);
  await importFile(app, '{"JA":{"title":"こんにちは"}}');
  assert.equal(app.elements.get('language').disabled, false);
  assert.equal(app.messages.length, 0);
});

test('canceling picker and scope changes preserve the selection without applying', async () => {
  const app = await ui(dictionary);
  app.elements.get('language').value = 'ES';
  app.elements.get('translation-file').value = '';
  await app.elements.get('translation-file').listeners.change();
  assert.equal(app.elements.get('language').value, 'ES');
  assert.equal(app.elements.get('source').textContent, 'Source: my-translations.json');
  app.elements.get('scope').listeners.change();
  assert.equal(app.elements.get('language').value, 'ES');
  assert.equal(app.messages.length, 0);
});

test('reselecting an edited file refreshes translations and keeps its filename', async () => {
  const app = await ui({ EN: { title: 'Before' } });
  const updated = { EN: { title: 'After' } };
  await importFile(app, JSON.stringify(updated));
  assert.equal(app.elements.get('translation-file').value, 'C:\\fakepath\\my-translations.json');
  assert.equal(app.messages.length, 0);
  const select = app.elements.get('language');
  select.value = 'EN';
  select.listeners.change();
  assert.deepEqual(app.messages[0].translations, updated);
});

test('import locks loading controls and a second import cannot race the first', async () => {
  const app = await ui(dictionary);
  let finish;
  const pending = importFile(app, '{}', { arrayBuffer: () => new Promise(resolve => { finish = resolve; }) });
  assert.equal(app.elements.get('translation-file').disabled, true);
  assert.equal(app.elements.get('choose-file').disabled, true);
  app.elements.get('choose-file').listeners.click();
  assert.equal(app.elements.get('translation-file').clicks, 0);
  assert.equal(app.elements.get('language').disabled, true);
  await importFile(app, '{"FR":{}}');
  finish(new TextEncoder().encode('{"DE":{}}').buffer);
  await pending;
  assert.deepEqual(app.elements.get('language').children.map(option => option.value), ['', 'DE']);
  assert.equal(app.elements.get('translation-file').disabled, false);
  assert.equal(app.elements.get('choose-file').disabled, false);
});

test('byte limit accepts exactly 1 MiB and checks UTF-8 bytes rather than only character count', async () => {
  const app = await ui(dictionary);
  const json = '{"DE":{}}';
  await importFile(app, json + ' '.repeat(1024 * 1024 - json.length));
  assert.equal(app.elements.get('source').textContent, 'Source: my-translations.json');
  assert.match(app.elements.get('status').textContent, /Translations loaded/);
  const large = JSON.stringify({ JA: Object.fromEntries(
    Array.from({ length: 30 }, (_, i) => [`k${i}`, '語'.repeat(20000)])) });
  assert.ok(large.length < 1024 * 1024);
  await importFile(app, large, { size: 1 }); // Recheck actual text even if metadata is unreliable.
  assert.match(app.elements.get('status').textContent, /1 MiB/);
  assert.deepEqual(app.elements.get('language').children.map(option => option.value), ['', 'DE']);
});

test('malformed UTF-8 reimports preserve the active and saved dictionary without writes', async () => {
  let writes = 0;
  let characters = 'Original';
  const layer = { name: 'i18n.title', get characters() { return characters; },
    set characters(value) { characters = value; writes++; } };
  const app = await ui({ EN: { title: 'Hello' } }, { currentPage: { findShapes: () => [layer] } });
  app.elements.get('language').value = 'EN';
  app.elements.get('language').listeners.change();
  await new Promise(resolve => setImmediate(resolve));
  const saved = Array.from(app.storage.entries());
  const invalidSequences = [[0xff], [0xc0, 0xaf], [0xed, 0xa0, 0x80], [0xe2, 0x82]];
  for (const sequence of invalidSequences) {
    const bytes = Buffer.concat([Buffer.from('{"EN":{"title":"'), Buffer.from(sequence), Buffer.from('"}}')]);
    await importFile(app, bytes, { name: 'invalid-encoding.json' });
    assert.match(app.elements.get('status').textContent, /UTF-8/);
    assert.equal(app.elements.get('source').textContent, 'Source: my-translations.json');
    assert.equal(app.elements.get('language').value, 'EN');
    assert.equal(app.elements.get('choose-file').disabled, false);
    assert.equal(app.elements.get('apply').disabled, false);
    assert.deepEqual(Array.from(app.storage.entries()), saved);
    assert.equal(writes, 1);
    assert.equal(app.messages.length, 1);
    assert.equal(characters, 'Hello');
  }
  // U+FFFD is valid data when explicitly encoded, rather than a decoder substitution.
  await importFile(app, '\uFEFF{"EN":{"title":"你好 \ufffd 😀"}}');
  assert.equal(characters, '你好 \ufffd 😀');
  assert.equal(writes, 2);
  assert.equal(app.messages.length, 2);
});

test('failed startup storage sends release controls and require file context before applying', async () => {
  const options = { failStorageSend: 'load' };
  const app = await ui(undefined, options);
  for (const id of ['translation-file', 'choose-file', 'scope']) {
    assert.equal(app.elements.get(id).disabled, false);
  }
  assert.match(app.elements.get('remember-status').textContent, /reopen/i);
  assert.doesNotMatch(app.elements.get('remember-status').textContent, /SANITIZED/);
  await importFile(app, '{"EN":{"title":"Hello"}}');
  app.elements.get('language').value = 'EN';
  app.elements.get('language').listeners.change();
  assert.equal(app.messages.length, 0, 'never apply without a captured design-file identity');
  assert.equal(app.elements.get('apply').disabled, true);
});

test('failed storage saves do not block language changes or valid reimport application', async () => {
  const layer = { name: 'i18n.title', characters: 'Original' };
  const options = { currentPage: { findShapes: () => [layer] } };
  const app = await ui({ EN: { title: 'Hello' } }, options);
  const saved = Array.from(app.storage.entries());
  options.failStorageSend = 'save';
  app.elements.get('language').value = 'EN';
  assert.doesNotThrow(() => app.elements.get('language').listeners.change());
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(layer.characters, 'Hello');
  assert.equal(app.messages.length, 1);
  await importFile(app, '{"EN":{"title":"Updated"}}', { name: 'updated.json' });
  assert.equal(layer.characters, 'Updated');
  assert.equal(app.messages.length, 2);
  assert.equal(app.elements.get('source').textContent, 'Source: updated.json');
  assert.equal(app.elements.get('translation-file').files[0].name, 'updated.json');
  assert.match(app.elements.get('remember-status').textContent, /older saved copy may remain/);
  assert.doesNotMatch(app.elements.get('remember-status').textContent, /SANITIZED/);
  assert.doesNotMatch(app.elements.get('status').textContent, /Cannot import/);
  assert.deepEqual(Array.from(app.storage.entries()), saved);
  assert.equal(app.elements.get('apply').disabled, false);
  options.failStorageSend = null;
  await importFile(app, '{"EN":{"title":"Saved again"}}');
  assert.equal(layer.characters, 'Saved again');
  assert.equal(JSON.parse(Array.from(app.storage.values())[0]).language, 'EN');
});

test('failed forget sends retain the import, release every control and allow retrying', async () => {
  const layer = { name: 'i18n.title', characters: 'Original' };
  const options = { currentPage: { findShapes: () => [layer] } };
  const app = await ui({ EN: { title: 'Hello' } }, options);
  app.elements.get('language').value = 'EN';
  app.elements.get('language').listeners.change();
  await new Promise(resolve => setImmediate(resolve));
  const saved = Array.from(app.storage.entries());
  options.failStorageSend = 'forget';
  assert.doesNotThrow(() => app.elements.get('forget').listeners.click());
  for (const id of ['translation-file', 'choose-file', 'language', 'scope', 'apply', 'forget']) {
    assert.equal(app.elements.get(id).disabled, false);
  }
  assert.equal(app.elements.get('language').value, 'EN');
  assert.equal(app.elements.get('source').textContent, 'Source: my-translations.json');
  assert.match(app.elements.get('remember-status').textContent, /not cleared/);
  assert.doesNotMatch(app.elements.get('remember-status').textContent, /SANITIZED/);
  assert.deepEqual(Array.from(app.storage.entries()), saved);
  assert.equal(app.messages.length, 1);
  assert.equal(layer.characters, 'Hello');
  options.failStorageSend = null;
  app.elements.get('forget').listeners.click();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(app.storage.size, 0);
  assert.equal(app.elements.get('language').disabled, true);
  assert.equal(app.messages.length, 1);
});

test('entry limits count all language maps and accept boundary lengths and literal prototype keys', async () => {
  const app = await ui(dictionary);
  const keys = Object.fromEntries(Array.from({ length: 10000 }, (_, i) => [`k${i}`, '']));
  await importFile(app, JSON.stringify({ EN: keys }));
  assert.match(app.elements.get('status').textContent, /Translations loaded/);
  await importFile(app, JSON.stringify({ EN: keys, FR: { extra: '' } }));
  assert.match(app.elements.get('status').textContent, /10,000/);
  await importFile(app, JSON.stringify({ EN: { ['k'.repeat(200)]: 'x'.repeat(20000) } }));
  assert.match(app.elements.get('status').textContent, /Translations loaded/);
  await importFile(app, '{"EN":{"__proto__":"literal","toString":"also literal"}}');
  app.elements.get('language').value = 'EN';
  app.elements.get('language').listeners.change();
  assert.equal(app.messages[0].translations.EN.__proto__, 'literal');
});

test('reopening restores the file and language per design file without applying', async () => {
  const storage = new Map();
  const first = await ui({ EN: { title: 'Hello' }, ES: { title: 'Hola' } }, { storage });
  first.elements.get('language').value = 'ES';
  first.elements.get('language').listeners.change();
  const reopened = await ui(undefined, { storage });
  assert.equal(reopened.elements.get('language').value, 'ES');
  assert.equal(reopened.elements.get('apply').disabled, false);
  assert.equal(reopened.elements.get('source').textContent, 'Source: my-translations.json (saved copy)');
  assert.equal(reopened.elements.get('translation-file').value, '');
  assert.equal(reopened.messages.length, 0);
  const other = await ui(undefined, { storage, fileId: 'file-b' });
  assert.equal(other.elements.get('language').disabled, true);
  assert.equal(other.elements.get('apply').disabled, true);
  await importFile(other, '{"JA":{"title":"こんにちは"}}');
  other.elements.get('language').value = 'JA';
  other.elements.get('language').listeners.change();
  const again = await ui(undefined, { storage });
  assert.equal(again.elements.get('language').value, 'ES');
  assert.equal(storage.size, 2);
});

test('language changes write text; first import, scope changes and forgetting do not', async () => {
  const app = await ui();
  let writes = 0;
  const layer = { name: 'i18n.title', characters: 'Original' };
  Object.defineProperty(layer, 'characters', {
    get() { return this.value; },
    set(value) { assert.equal(value, 'Hello'); writes++; this.value = value; }
  });
  layer.value = 'Original';
  app.penpot.currentFile.pages = [{ findShapes: () => [layer] }];
  app.penpot.currentPage = app.penpot.currentFile.pages[0];
  await importFile(app, '{"EN":{"title":"Hello"}}');
  assert.equal(writes, 0);
  app.elements.get('language').value = 'EN';
  app.elements.get('language').listeners.change();
  assert.equal(writes, 1);
  await new Promise(resolve => setImmediate(resolve));
  app.elements.get('scope').value = 'file';
  app.elements.get('scope').listeners.change();
  assert.equal(writes, 1);
  app.elements.get('apply').listeners.click();
  assert.equal(writes, 1);
  await new Promise(resolve => setImmediate(resolve));
  app.elements.get('forget').listeners.click();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(writes, 1);
  assert.equal(app.storage.size, 0);
  assert.equal(app.elements.get('language').disabled, true);
  assert.equal(app.elements.get('apply').disabled, true);
  assert.equal(app.elements.get('translation-file').value, '');
  assert.equal(app.elements.get('source').textContent, 'Source: no file selected');
});

test('reimport retains an available language, clears a missing one and preserves storage on invalid input', async () => {
  const app = await ui(dictionary);
  app.elements.get('language').value = 'ES';
  app.elements.get('language').listeners.change();
  await new Promise(resolve => setImmediate(resolve));
  await importFile(app, '{"ES":{"title":"New"}}');
  assert.equal(app.elements.get('language').value, 'ES');
  const saved = Array.from(app.storage.values());
  await importFile(app, '{');
  assert.deepEqual(Array.from(app.storage.values()), saved);
  assert.equal(app.elements.get('language').value, 'ES');
  await importFile(app, '{"FR":{}}');
  assert.equal(app.elements.get('language').value, '');
  assert.equal(app.elements.get('apply').disabled, true);
  assert.equal(app.messages.length, 2);
  assert.equal(app.messages[1].translations.ES.title, 'New');
});

test('forgetting one file keeps other files and survives a restart', async () => {
  const storage = new Map();
  const appA = await ui(dictionary, { storage });
  await ui({ JA: {} }, { storage, fileId: 'file-b' });
  appA.elements.get('forget').listeners.click();
  assert.equal(appA.elements.get('translation-file').disabled, true);
  await new Promise(resolve => setImmediate(resolve));
  const reopened = await ui(undefined, { storage });
  const other = await ui(undefined, { storage, fileId: 'file-b' });
  assert.equal(reopened.elements.get('language').disabled, true);
  assert.equal(other.elements.get('language').disabled, false);
  assert.equal(storage.size, 1);
});

test('storage failures leave session imports usable and failed forgetting preserves the import', async () => {
  const fail = () => { throw new Error('private error details'); };
  const app = await ui(undefined, { localStorage: { getItem: fail, setItem: fail, removeItem: fail } });
  assert.equal(app.elements.get('translation-file').disabled, false);
  assert.match(app.elements.get('remember-status').textContent, /unavailable/);
  await importFile(app, '{"EN":{}}');
  app.elements.get('language').value = 'EN';
  app.elements.get('language').listeners.change();
  await new Promise(resolve => setImmediate(resolve));
  assert.match(app.elements.get('remember-status').textContent, /older saved copy may remain/);
  assert.doesNotMatch(app.elements.get('remember-status').textContent, /private/);
  assert.equal(app.elements.get('apply').disabled, false);
  assert.equal(app.elements.get('apply').hidden, false);
  app.elements.get('forget').listeners.click();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(app.elements.get('language').value, 'EN');
  assert.equal(app.elements.get('apply').disabled, false);
  assert.equal(app.elements.get('translation-file').disabled, false);
  assert.match(app.elements.get('remember-status').textContent, /not cleared/);
});

test('startup locks controls and ignores foreign or stale storage replies', async () => {
  const replies = [];
  const app = await ui(undefined, { holdReplies: replies });
  assert.equal(app.elements.get('translation-file').disabled, true);
  assert.equal(app.elements.get('scope').disabled, true);
  assert.equal(app.elements.get('forget').disabled, true);
  await importFile(app, '{"EN":{}}');
  assert.equal(app.storageRequests.length, 1);
  app.events.message({ source: {}, data: replies[0] });
  app.events.message({ source: app.parent, data: { ...replies[0], requestId: 99 } });
  assert.equal(app.elements.get('translation-file').disabled, true);
  app.events.message({ source: app.parent, data: replies[0] });
  assert.equal(app.elements.get('translation-file').disabled, false);
  await importFile(app, '{"EN":{}}');
  app.elements.get('language').value = 'EN';
  app.elements.get('language').listeners.change();
  app.events.message({ source: app.parent, data: { ...replies[1], ok: false } });
  assert.match(app.elements.get('remember-status').textContent, /Saving/);
  app.events.message({ source: app.parent, data: replies[2] });
  assert.match(app.elements.get('remember-status').textContent, /Saved for this design/);
  app.events.message({ source: app.parent, data: replies[0] });
  assert.equal(app.elements.get('language').value, 'EN');
  assert.equal(app.messages.length, 1);
});

test('invalid stored data and malformed load replies restore controls without using the dictionary', async () => {
  for (const record of [null, { version: 1, name: 'x', text: '{"EN":{}}', language: 'FR' },
    { version: 1, name: 'x', text: ' '.repeat(1024 * 1024 + 1), language: '' }]) {
    const replies = [];
    const app = await ui(undefined, { holdReplies: replies });
    app.events.message({ source: app.parent, data: { ...replies[0], record, ok: record === null ? 'yes' : true } });
    assert.equal(app.elements.get('language').disabled, true);
    assert.equal(app.elements.get('translation-file').disabled, false);
    assert.equal(app.elements.get('apply').disabled, true);
    assert.equal(app.messages.length, 0);
  }
  const storage = new Map([['localization.saved-import.v1:file-a', '{']]);
  const app = await ui(undefined, { storage });
  assert.match(app.elements.get('remember-status').textContent, /invalid data/);
  assert.equal(app.elements.get('forget').disabled, false);
  app.elements.get('forget').listeners.click();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(storage.size, 0);
});

test('a file switch rejects saving, forgetting and applying the old dictionary', async () => {
  const app = await ui({ EN: { title: 'Hello' } });
  const saved = Array.from(app.storage.entries());
  let writes = 0;
  app.penpot.currentFile = { id: 'file-b', pages: [{ findShapes: () => [{
    name: 'i18n.title', get characters() { return 'Original'; }, set characters(value) { writes++; }
  }] }] };
  app.elements.get('language').value = 'EN';
  app.elements.get('language').listeners.change();
  await new Promise(resolve => setImmediate(resolve));
  assert.match(app.elements.get('status').textContent, /Design file changed/);
  app.elements.get('forget').listeners.click();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(Array.from(app.storage.entries()), saved);
  assert.equal(writes, 0);
  assert.equal(app.elements.get('translation-file').disabled, false);
});

test('saved filenames and literal prototype keys survive reopening as text', async () => {
  const app = await ui();
  const name = '<img src=x onerror=alert(1)>.json';
  await importFile(app, '{"EN":{"__proto__":"literal","toString":"also literal"}}', { name });
  app.elements.get('language').value = 'EN';
  app.elements.get('language').listeners.change();
  const reopened = await ui(undefined, { storage: app.storage });
  assert.equal(reopened.elements.get('source').textContent, `Source: ${name} (saved copy)`);
  assert.equal(reopened.elements.get('language').value, 'EN');
  assert.equal(reopened.messages.length, 0);
  reopened.elements.get('apply').listeners.click();
  assert.deepEqual(reopened.messages[0].translations, JSON.parse('{"EN":{"__proto__":"literal","toString":"also literal"}}'));
});

test('saved copy shows its filename without an empty native picker and can be replaced', async () => {
  const first = await ui(dictionary);
  const app = await ui(undefined, { storage: first.storage });
  const input = app.elements.get('translation-file');
  const choose = app.elements.get('choose-file');
  assert.equal(input.value, '');
  assert.match(app.elements.get('source').textContent, /my-translations.json \(saved copy\)/);
  assert.equal(input.hidden, true, 'hide the native no-file-chosen label when using a saved copy');
  assert.equal(choose.textContent, 'Replace or reload JSON…');
  choose.listeners.click();
  assert.equal(input.clicks, 1);
  await input.listeners.change(); // Canceling leaves the active saved copy in place.
  assert.match(app.elements.get('source').textContent, /my-translations.json \(saved copy\)/);
  await importFile(app, '{');
  assert.match(app.elements.get('source').textContent, /my-translations.json \(saved copy\)/);
  assert.equal(choose.textContent, 'Replace or reload JSON…');
  await importFile(app, '{"JA":{}}', { name: 'replacement.json' });
  assert.equal(app.elements.get('source').textContent, 'Source: replacement.json');
  assert.equal(input.hidden, true);
  choose.listeners.click();
  assert.equal(input.value, ''); // Reimporting the same file must produce a fresh change.
  await input.listeners.change();
  assert.equal(app.elements.get('source').textContent, 'Source: replacement.json');
  app.elements.get('forget').listeners.click();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(choose.textContent, 'Choose JSON file…');
  assert.equal(input.hidden, true);
  assert.equal(app.messages.length, 0);
});

test('default scope applies only to the current page and resets on reopening', async () => {
  const app = await ui({ EN: { title: 'Hello' } });
  const current = { name: 'i18n.title', characters: 'Current original' };
  const other = { name: 'i18n.title', characters: 'Other original' };
  app.penpot.currentPage = { findShapes: () => [current] };
  app.penpot.currentFile.pages = [app.penpot.currentPage, { findShapes: () => [other] }];
  assert.equal(app.elements.get('scope').value, 'page');
  app.elements.get('language').value = 'EN';
  app.elements.get('language').listeners.change();
  assert.equal(current.characters, 'Hello');
  assert.equal(other.characters, 'Other original');
  await new Promise(resolve => setImmediate(resolve));
  app.elements.get('scope').value = 'file';
  app.elements.get('scope').listeners.change();
  assert.equal(other.characters, 'Other original');
  app.elements.get('apply').listeners.click();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(other.characters, 'Hello');
  const reopened = await ui(undefined, { storage: app.storage });
  assert.equal(reopened.elements.get('language').value, 'EN');
  assert.equal(reopened.elements.get('scope').value, 'page');
  assert.equal(reopened.messages.length, 0);
});

test('a valid reimport automatically reapplies the selected language once using fresh strings and chosen scope', async () => {
  const writes = [];
  function layer(name) {
    let characters = 'Original';
    return { name: 'i18n.title', get characters() { return characters; },
      set characters(value) { characters = value; writes.push([name, value]); } };
  }
  const current = layer('current'), other = layer('other');
  const currentPage = { findShapes: () => [current] };
  const app = await ui({ ES: { title: 'Before' } }, {
    currentPage, pages: [currentPage, { findShapes: () => [other] }]
  });
  assert.deepEqual(writes, []);
  app.elements.get('language').value = 'ES';
  app.elements.get('language').listeners.change();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(writes, [['current', 'Before']]);
  app.elements.get('scope').value = 'file';
  app.elements.get('scope').listeners.change();
  assert.equal(writes.length, 1);
  await importFile(app, '{"ES":{"title":"After"}}');
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(writes, [['current', 'Before'], ['current', 'After'], ['other', 'After']]);
  assert.equal(app.messages.length, 2);
  assert.equal(app.messages[1].requestId, 2);
  assert.equal(app.messages[1].language, 'ES');
  assert.equal(app.messages[1].scope, 'file');
  assert.match(app.elements.get('status').textContent, /updated 2 text layer/);
  assert.equal(app.elements.get('language').disabled, false);
});

test('mixed-style layers remain unchanged and the status explains the skip', async () => {
  let writes = 0;
  const layer = { name: 'i18n.title', fontWeight: 'mixed',
    get characters() { return 'Original'; },
    set characters(value) { writes++; } };
  const app = await ui({ EN: { title: 'Hello' } }, {
    currentPage: { findShapes: () => [layer] }
  });
  app.elements.get('language').value = 'EN';
  app.elements.get('language').listeners.change();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(writes, 0);
  assert.equal(layer.characters, 'Original');
  assert.match(app.elements.get('status').textContent, /1 mixed-style layer\(s\) skipped to preserve formatting/);
  assert.equal(app.elements.get('apply').textContent, 'Apply to current page');
});

test('failed, canceled and missing-language reimports cause no design writes', async () => {
  let writes = 0;
  const layer = { name: 'i18n.title', value: 'Original', get characters() { return this.value; },
    set characters(value) { this.value = value; writes++; } };
  const app = await ui({ EN: { title: 'Hello' } }, { currentPage: { findShapes: () => [layer] } });
  app.elements.get('language').value = 'EN';
  app.elements.get('language').listeners.change();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(writes, 1);
  const saved = Array.from(app.storage.entries());
  app.elements.get('choose-file').listeners.click();
  await app.elements.get('translation-file').listeners.change();
  await importFile(app, '{');
  await importFile(app, '{}', { size: 1024 * 1024 + 1 });
  await importFile(app, '{}', { arrayBuffer: async () => { throw new Error('Read failed'); } });
  await importFile(app, '{"EN":{"title":"New"},"ES":{"title":1}}');
  assert.equal(writes, 1);
  assert.equal(app.messages.length, 1);
  assert.deepEqual(Array.from(app.storage.entries()), saved);
  assert.equal(app.elements.get('language').value, 'EN');
  await importFile(app, '{"ES":{"title":"Hola"}}');
  assert.equal(app.elements.get('language').value, '');
  assert.equal(app.elements.get('apply').disabled, true);
  assert.equal(writes, 1);
  assert.equal(app.messages.length, 1);
});

test('restoring a saved language causes no writes but reimporting it applies', async () => {
  const first = await ui({ EN: { title: 'Hello' } });
  first.elements.get('language').value = 'EN';
  first.elements.get('language').listeners.change();
  let writes = 0;
  const layer = { name: 'i18n.title', value: 'Original', get characters() { return this.value; },
    set characters(value) { assert.equal(value, 'Updated'); this.value = value; writes++; } };
  const app = await ui(undefined, { storage: first.storage, currentPage: { findShapes: () => [layer] } });
  assert.equal(writes, 0);
  assert.equal(app.elements.get('language').value, 'EN');
  assert.equal(app.messages.length, 0);
  await importFile(app, '{"EN":{"title":"Updated"}}');
  assert.equal(writes, 1);
  assert.equal(app.messages.length, 1);
});

test('applying locks all conflicting actions and only the matching parent result releases them', async () => {
  const replies = [];
  let writes = 0;
  const layer = { name: 'i18n.title', value: 'Original', get characters() { return this.value; },
    set characters(value) { this.value = value; writes++; } };
  const app = await ui({ EN: { title: 'Hello' }, ES: { title: 'Hola' } }, {
    currentPage: { findShapes: () => [layer] }, holdApplyReplies: replies
  });
  app.elements.get('language').value = 'EN';
  app.elements.get('language').listeners.change();
  const controlIds = ['translation-file', 'choose-file', 'language', 'scope', 'apply', 'restore', 'forget'];
  for (const id of controlIds) assert.equal(app.elements.get(id).disabled, true);
  const saved = Array.from(app.storage.entries());
  app.elements.get('apply').listeners.click();
  app.elements.get('choose-file').listeners.click();
  app.elements.get('forget').listeners.click();
  app.elements.get('language').listeners.change();
  await importFile(app, '{"EN":{"title":"Ignored"}}');
  assert.equal(app.messages.length, 1);
  assert.equal(app.elements.get('translation-file').clicks, 0);
  assert.equal(writes, 1);
  assert.deepEqual(Array.from(app.storage.entries()), saved);
  app.events.message({ source: {}, data: replies[0] });
  app.events.message({ source: app.parent, data: { ...replies[0], requestId: 99 } });
  assert.equal(app.elements.get('language').disabled, true);
  app.events.message({ source: app.parent, data: replies[0] });
  for (const id of controlIds) assert.equal(app.elements.get(id).disabled, false);
  assert.equal(app.elements.get('apply').hidden, false);
  app.elements.get('language').value = 'ES';
  app.elements.get('language').listeners.change();
  const status = app.elements.get('status').textContent;
  app.events.message({ source: app.parent, data: replies[0] });
  assert.equal(app.elements.get('language').disabled, true);
  assert.equal(app.elements.get('status').textContent, status);
  app.events.message({ source: app.parent, data: replies[1] });
  assert.equal(app.elements.get('language').disabled, false);
  assert.equal(writes, 2);
});

test('restore returns plugin-written text to its session baseline and updates its availability', async () => {
  const layer = { name: 'i18n.title', characters: 'Original' };
  const currentPage = { findShapes: () => [layer] };
  const app = await ui({ EN: { title: 'Hello' } }, { currentPage });
  const restore = app.elements.get('restore');
  assert.equal(restore.disabled, true);
  assert.match(html, /Closing the plugin clears only text recovery/);

  app.elements.get('language').value = 'EN';
  app.elements.get('language').listeners.change();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(layer.characters, 'Hello');
  assert.equal(restore.disabled, false);
  assert.equal(restore.textContent, 'Restore current page');

  restore.listeners.click();
  assert.equal(restore.disabled, true);
  assert.equal(restore.textContent, 'Restoring…');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(layer.characters, 'Original');
  assert.equal(restore.disabled, true);
  assert.match(app.elements.get('status').textContent, /Restored 1 text layer/);
  assert.deepEqual(app.messages.map(message => message.type),
    ['apply-language', 'restore-localization']);
  assert.deepEqual(app.historyEvents.map(event => event[0]),
    ['begin', 'finish', 'begin', 'finish']);
});

test('restore leaves external edits and layers deleted outside the plugin unchanged with visible conflict details', async () => {
  const layers = [
    { name: 'i18n.title', characters: 'First original' },
    { name: 'i18n.title', characters: 'Second original' }
  ];
  const currentPage = { findShapes: () => layers };
  const app = await ui({ EN: { title: 'Hello' } }, { currentPage });
  app.elements.get('language').value = 'EN';
  app.elements.get('language').listeners.change();
  await new Promise(resolve => setImmediate(resolve));
  layers[0].characters = 'External edit';
  layers.splice(1, 1);

  app.elements.get('restore').listeners.click();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(layers[0].characters, 'External edit');
  assert.match(app.elements.get('status').textContent, /1 externally changed layer/);
  assert.match(app.elements.get('status').textContent,
    /1 recovery target\(s\) could not be restored.*deleted outside the plugin/);
  assert.equal(app.elements.get('restore').disabled, false);
});

test('restore follows page and file scope while a reopened plugin has no recovery journal', async () => {
  const current = { name: 'i18n.title', characters: 'Current original' };
  const other = { name: 'i18n.title', characters: 'Other original' };
  const currentPage = { findShapes: () => [current] };
  const otherPage = { findShapes: () => [other] };
  const app = await ui({ EN: { title: 'Hello' } }, {
    currentPage, pages: [currentPage, otherPage]
  });
  app.elements.get('scope').value = 'file';
  app.elements.get('scope').listeners.change();
  app.elements.get('language').value = 'EN';
  app.elements.get('language').listeners.change();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(current.characters, 'Hello');
  assert.equal(other.characters, 'Hello');

  app.elements.get('scope').value = 'page';
  app.elements.get('scope').listeners.change();
  app.elements.get('restore').listeners.click();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(current.characters, 'Current original');
  assert.equal(other.characters, 'Hello');
  assert.equal(app.elements.get('restore').disabled, false);

  app.elements.get('scope').value = 'file';
  app.elements.get('scope').listeners.change();
  app.elements.get('restore').listeners.click();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(other.characters, 'Other original');
  assert.equal(app.elements.get('restore').disabled, true);

  app.elements.get('language').listeners.change();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(app.elements.get('restore').disabled, false);
  const reopened = await ui(undefined, {
    storage: app.storage, currentPage, pages: [currentPage, otherPage]
  });
  assert.equal(reopened.elements.get('restore').disabled, true);
});

test('scope changes supersede pending recovery-status checks', async () => {
  const replies = [];
  const app = await ui(undefined, { holdRecoveryReplies: replies });
  assert.equal(app.recoveryRequests.length, 1);
  const firstRequestId = app.recoveryRequests[0].requestId;

  app.elements.get('scope').value = 'file';
  app.elements.get('scope').listeners.change();
  assert.equal(app.recoveryRequests.length, 2);
  const secondRequestId = app.recoveryRequests[1].requestId;
  assert.ok(secondRequestId > firstRequestId);

  app.events.message({ source: app.parent,
    data: { ...replies[0], requestId: firstRequestId, restoreAvailable: false } });
  assert.equal(app.elements.get('restore').disabled, true, 'the stale page reply is ignored');
  app.events.message({ source: app.parent,
    data: { ...replies[1], requestId: secondRequestId, restoreAvailable: true } });
  assert.equal(app.elements.get('restore').disabled, false,
    'the current file-scope reply controls availability');
});

test('restore reports page traversal and unreadable metadata without hiding text recovery', async () => {
  const pluginData = new Map([['localization.rtl.v1', '{invalid']]);
  const layer = { id: 'restore-warning-layer', name: 'i18n.title', characters: 'Original',
    direction: 'ltr', align: 'left',
    getPluginData: key => pluginData.get(key) || '', setPluginData() {} };
  let failUnfilteredTraversal = false;
  const currentPage = { findShapes(criteria) {
    if (!criteria && failUnfilteredTraversal) throw new Error('Page unavailable');
    return [layer];
  } };
  const app = await ui({ EN: { title: 'Hello' } }, { currentPage });
  app.elements.get('language').value = 'EN';
  app.elements.get('language').listeners.change();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(layer.characters, 'Hello');

  failUnfilteredTraversal = true;
  app.elements.get('restore').listeners.click();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(layer.characters, 'Original');
  assert.match(app.elements.get('status').textContent, /1 page\(s\) could not be processed/);
  assert.equal(app.elements.get('status').classList.contains('error'), true);

  failUnfilteredTraversal = false;
  app.elements.get('language').listeners.change();
  await new Promise(resolve => setImmediate(resolve));
  app.elements.get('restore').listeners.click();
  await new Promise(resolve => setImmediate(resolve));
  assert.match(app.elements.get('status').textContent,
    /1 unreadable RTL recovery metadata record/);
  assert.equal(app.elements.get('status').classList.contains('warning'), true);
  assert.equal(app.elements.get('status').classList.contains('error'), false);
});

test('restore locks controls and ignores malformed, stale and foreign replies', async () => {
  const replies = [];
  const layer = { name: 'i18n.title', characters: 'Original' };
  const app = await ui({ EN: { title: 'Hello' } }, {
    currentPage: { findShapes: () => [layer] }, holdRestoreReplies: replies
  });
  app.elements.get('language').value = 'EN';
  app.elements.get('language').listeners.change();
  await new Promise(resolve => setImmediate(resolve));
  app.elements.get('restore').listeners.click();
  for (const id of ['translation-file', 'choose-file', 'language', 'scope', 'apply', 'restore', 'forget']) {
    assert.equal(app.elements.get(id).disabled, true);
  }
  app.events.message({ source: {}, data: replies[0] });
  app.events.message({ source: app.parent, data: { ...replies[0], requestId: 99 } });
  assert.equal(app.elements.get('scope').disabled, true);
  app.events.message({ source: app.parent, data: { ...replies[0], conflicts: -1 } });
  assert.match(app.elements.get('status').textContent, /Invalid restore result/);
  assert.equal(app.elements.get('scope').disabled, false);
  assert.equal(app.elements.get('restore').disabled, false);
});

test('malformed matching results release controls with an error instead of showing false success', async () => {
  for (const malformed of [{ ok: 'true' }, { changed: -1 }, { skipped: -1 }, { missing: null },
    { missing: [42] }, { language: 'FR' }]) {
    const replies = [];
    const app = await ui({ EN: {} }, { holdApplyReplies: replies });
    app.elements.get('language').value = 'EN';
    app.elements.get('language').listeners.change();
    app.events.message({ source: app.parent, data: { ...replies[0], ...malformed } });
    assert.match(app.elements.get('status').textContent, /Invalid localization result/);
    assert.equal(app.elements.get('language').disabled, false);
    assert.equal(app.elements.get('choose-file').disabled, false);
    assert.equal(app.elements.get('apply').disabled, false);
  }
});

test('failed automatic applies and transport errors release controls and allow retrying', async () => {
  const options = { failApplySend: true };
  const app = await ui({ EN: { title: 'Hello' } }, options);
  let writes = 0;
  const layer = { name: 'i18n.title', value: 'Original', get characters() { return this.value; },
    set characters(value) { this.value = value; writes++; } };
  app.penpot.currentPage = { findShapes: () => [layer] };
  app.penpot.currentFile.pages = [app.penpot.currentPage];
  app.elements.get('language').value = 'EN';
  app.elements.get('language').listeners.change();
  assert.equal(writes, 0);
  assert.match(app.elements.get('status').textContent, /Cannot send/);
  assert.equal(app.elements.get('apply').disabled, false);
  options.failApplySend = false;
  app.penpot.currentPage = { findShapes() { throw new Error('Page unavailable'); } };
  app.penpot.currentFile.pages = [app.penpot.currentPage];
  app.elements.get('apply').listeners.click();
  await new Promise(resolve => setImmediate(resolve));
  assert.match(app.elements.get('status').textContent, /page\(s\) could not be processed/);
  assert.equal(app.elements.get('choose-file').disabled, false);
  app.penpot.currentPage = { findShapes: () => [layer] };
  app.penpot.currentFile.pages = [app.penpot.currentPage];
  await importFile(app, '{"EN":{"title":"Updated"}}');
  assert.equal(writes, 1);
  assert.equal(app.elements.get('language').disabled, false);
});

test('switching design files during a reimport rejects automatic saving and applying', async () => {
  let writes = 0;
  const layer = { name: 'i18n.title', value: 'Original', get characters() { return this.value; },
    set characters(value) { this.value = value; writes++; } };
  const app = await ui({ EN: { title: 'Hello' } }, { currentPage: { findShapes: () => [layer] } });
  app.elements.get('language').value = 'EN';
  app.elements.get('language').listeners.change();
  await new Promise(resolve => setImmediate(resolve));
  const saved = Array.from(app.storage.entries());
  let finish;
  const pending = importFile(app, '{}', { arrayBuffer: () => new Promise(resolve => { finish = resolve; }) });
  await new Promise(resolve => setImmediate(resolve));
  app.penpot.currentFile = { id: 'file-b', pages: [] };
  finish(new TextEncoder().encode('{"EN":{"title":"Updated"}}').buffer);
  await pending;
  assert.equal(writes, 1);
  assert.deepEqual(Array.from(app.storage.entries()), saved);
  assert.match(app.elements.get('status').textContent, /Design file changed/);
  assert.equal(app.elements.get('language').disabled, false);
  assert.equal(app.elements.get('choose-file').disabled, false);
});

test('page-scoped reimport captures context before reading and rejects navigation changes', async () => {
  const current = { name: 'i18n.title', characters: 'Current original' };
  const other = { name: 'i18n.title', characters: 'Other original' };
  const currentPage = { findShapes: () => [current] };
  const otherPage = { findShapes: () => [other] };
  const app = await ui({ EN: { title: 'Before' } }, {
    currentPage, pages: [currentPage, otherPage]
  });
  app.elements.get('language').value = 'EN';
  app.elements.get('language').listeners.change();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(current.characters, 'Before');
  let finish;
  const pending = importFile(app, '{}', {
    arrayBuffer: () => new Promise(resolve => { finish = resolve; })
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(typeof finish, 'function', 'the context reply arrives before file reading starts');
  const capturedPageId = app.contextRequests.at(-1).requestId;
  assert.ok(Number.isSafeInteger(capturedPageId));
  app.penpot.currentPage = otherPage;
  finish(new TextEncoder().encode('{"EN":{"title":"After"}}').buffer);
  await pending;
  assert.equal(current.characters, 'Before');
  assert.equal(other.characters, 'Other original');
  assert.match(app.elements.get('status').textContent, /Page changed while reading translations/);
  assert.equal(app.elements.get('apply').disabled, false);
  assert.equal(app.messages.at(-1).pageId, currentPage.id);
});

test('file-scoped reimport remains valid when the active page changes during reading', async () => {
  const current = { name: 'i18n.title', characters: 'Current original' };
  const other = { name: 'i18n.title', characters: 'Other original' };
  const currentPage = { findShapes: () => [current] };
  const otherPage = { findShapes: () => [other] };
  const app = await ui({ EN: { title: 'Before' } }, {
    currentPage, pages: [currentPage, otherPage]
  });
  app.elements.get('scope').value = 'file';
  app.elements.get('scope').listeners.change();
  app.elements.get('language').value = 'EN';
  app.elements.get('language').listeners.change();
  await new Promise(resolve => setImmediate(resolve));
  let finish;
  const pending = importFile(app, '{}', {
    arrayBuffer: () => new Promise(resolve => { finish = resolve; })
  });
  await new Promise(resolve => setImmediate(resolve));
  app.penpot.currentPage = otherPage;
  finish(new TextEncoder().encode('{"EN":{"title":"After"}}').buffer);
  await pending;
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(current.characters, 'After');
  assert.equal(other.characters, 'After');
  assert.equal(app.messages.at(-1).scope, 'file');
  assert.equal(app.messages.at(-1).pageId, currentPage.id);
});

test('context transport and malformed replies stop imports before file reads and release controls', async () => {
  let reads = 0;
  const failed = await ui(undefined, { failContextSend: true });
  await importFile(failed, '{"EN":{}}', { arrayBuffer() { reads++; return new ArrayBuffer(); } });
  assert.equal(reads, 0);
  assert.match(failed.elements.get('status').textContent, /Cannot capture the current design page/);
  assert.equal(failed.elements.get('choose-file').disabled, false);

  const replies = [];
  const app = await ui(undefined, { holdContextReplies: replies });
  const pending = importFile(app, '{"EN":{}}');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(app.elements.get('scope').disabled, true);
  app.events.message({ source: {}, data: replies[0] });
  app.events.message({ source: app.parent, data: { ...replies[0], requestId: 99 } });
  assert.equal(app.elements.get('scope').disabled, true);
  app.events.message({ source: app.parent, data: { ...replies[0], pageId: 42 } });
  await pending;
  assert.match(app.elements.get('status').textContent, /Cannot capture the current design page/);
  assert.equal(app.elements.get('scope').disabled, false);
  assert.equal(app.messages.length, 0);
});

test('apply button stays visible and can translate newly added text without switching language or reimporting', async () => {
  const current = { name: 'i18n.title', characters: 'Current original' };
  const other = { name: 'i18n.title', characters: 'Other original' };
  const currentLayers = [current];
  const currentPage = { findShapes: () => currentLayers };
  const app = await ui(undefined, { currentPage, pages: [currentPage, { findShapes: () => [other] }] });
  const button = app.elements.get('apply');
  assert.equal(button.hidden, false);
  assert.equal(button.disabled, true);
  app.elements.get('scope').value = 'file';
  app.elements.get('scope').listeners.change();
  assert.equal(button.textContent, 'Apply to all pages');
  button.listeners.click();
  assert.equal(app.messages.length, 0);
  app.elements.get('scope').value = 'page';
  app.elements.get('scope').listeners.change();
  await importFile(app, '{"EN":{"title":"Hello"}}');
  assert.equal(button.hidden, false);
  assert.equal(button.disabled, true);
  app.elements.get('language').value = 'EN';
  app.elements.get('language').listeners.change();
  assert.equal(button.hidden, false);
  assert.equal(button.disabled, true);
  assert.equal(button.textContent, 'Applying…');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(button.hidden, false);
  assert.equal(button.disabled, false);
  assert.equal(button.textContent, 'Apply to current page');
  assert.equal(app.messages.length, 1);
  const added = { name: 'i18n.title', characters: 'Newly added original' };
  currentLayers.push(added);
  button.listeners.click();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(added.characters, 'Hello');
  assert.equal(app.messages.length, 2);
  app.elements.get('scope').value = 'file';
  app.elements.get('scope').listeners.change();
  assert.equal(button.hidden, false);
  assert.equal(button.disabled, false);
  assert.equal(button.textContent, 'Apply to all pages');
  assert.equal(other.characters, 'Other original');
  assert.equal(app.messages.length, 2);
  assert.match(app.elements.get('status').textContent, /Scope changed. Apply the selected language/);
  app.elements.get('scope').value = 'page';
  app.elements.get('scope').listeners.change();
  assert.equal(button.hidden, false);
  assert.equal(button.textContent, 'Apply to current page');
  assert.equal(app.messages.length, 2);
  app.elements.get('scope').value = 'file';
  app.elements.get('scope').listeners.change();
  button.listeners.click();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(other.characters, 'Hello');
  assert.equal(button.hidden, false);
  assert.equal(app.messages.length, 3);
  app.elements.get('scope').value = 'page';
  app.elements.get('scope').listeners.change();
  assert.equal(button.hidden, false);
  assert.equal(button.textContent, 'Apply to current page');
  await importFile(app, '{"EN":{"title":"Updated"}}');
  assert.equal(current.characters, 'Updated');
  assert.equal(other.characters, 'Hello');
  assert.equal(button.hidden, false);
  assert.equal(app.messages.length, 4);
});

test('saved selections can be applied immediately and forgetting disables the visible button', async () => {
  const first = await ui({ EN: { title: 'Hello' } });
  first.elements.get('language').value = 'EN';
  first.elements.get('language').listeners.change();
  const current = { name: 'i18n.title', characters: 'Original' };
  const app = await ui(undefined, { storage: first.storage, currentPage: { findShapes: () => [current] } });
  const button = app.elements.get('apply');
  assert.equal(button.hidden, false);
  assert.equal(button.textContent, 'Apply to current page');
  assert.equal(current.characters, 'Original');
  assert.equal(app.messages.length, 0);
  await importFile(app, '{');
  assert.equal(button.hidden, false);
  assert.equal(button.textContent, 'Apply to current page');
  button.listeners.click();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(current.characters, 'Hello');
  assert.equal(button.hidden, false);
  assert.equal(button.disabled, false);
  app.elements.get('scope').value = 'file';
  app.elements.get('scope').listeners.change();
  assert.equal(button.hidden, false);
  app.elements.get('forget').listeners.click();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(button.hidden, false);
  assert.equal(button.disabled, true);
  assert.equal(app.messages.length, 1);
});

test('partial layer failures show Try again and a successful retry restores the scope label', async () => {
  let fail = true;
  let characters = 'Original';
  let writes = 0;
  const layer = { name: 'i18n.title', get characters() { return characters; },
    set characters(value) {
      if (fail) throw new Error('Layer unavailable');
      characters = value;
      writes++;
    } };
  const app = await ui({ EN: { title: 'Hello' } }, { currentPage: { findShapes: () => [layer] } });
  app.elements.get('language').value = 'EN';
  app.elements.get('language').listeners.change();
  await new Promise(resolve => setImmediate(resolve));
  const button = app.elements.get('apply');
  assert.equal(button.hidden, false);
  assert.equal(button.textContent, 'Try again');
  assert.equal(writes, 0);
  fail = false;
  button.listeners.click();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(writes, 1);
  assert.equal(button.hidden, false);
  assert.equal(button.textContent, 'Apply to current page');
  assert.equal(button.disabled, false);
});

test('a focused apply button retains focus after success and failure', async () => {
  const first = await ui(dictionary);
  first.elements.get('language').value = 'EN';
  first.elements.get('language').listeners.change();
  const options = { storage: first.storage };
  const app = await ui(undefined, options);
  const button = app.elements.get('apply');
  button.focus();
  button.listeners.click();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(button.hidden, false);
  assert.equal(app.document.activeElement, button);
  app.elements.get('scope').value = 'file';
  app.elements.get('scope').listeners.change();
  options.failApplySend = true;
  button.focus();
  button.listeners.click();
  assert.equal(button.hidden, false);
  assert.equal(button.textContent, 'Try again');
  assert.equal(app.document.activeElement, button);
});

test('Choose a language is a disabled placeholder after imports and reset', async () => {
  assert.match(html, /<option value="" disabled selected>Choose a language<\/option>/);
  const app = await ui(dictionary);
  const select = app.elements.get('language');
  assert.equal(select.value, '');
  assert.equal(select.children[0].disabled, true);
  assert.ok(select.children.slice(1).every(option => option.disabled === false));
  select.value = 'EN';
  select.listeners.change();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(select.value, 'EN');
  assert.equal(select.children[0].disabled, true);
  await importFile(app, '{"JA":{}}');
  assert.equal(select.value, '');
  assert.equal(select.children[0].disabled, true);
  assert.equal(select.children[1].disabled, false);
  assert.equal(app.messages.length, 1);
  app.elements.get('forget').listeners.click();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(select.children[0].disabled, true);
  assert.equal(select.disabled, true);
  assert.equal(app.messages.length, 1);
});

function directionalPage(direction) {
  const root = { id: 'root' };
  const makeShape = (shape) => {
    const data = new Map();
    return { ...shape, getPluginData: key => data.get(key) || '',
      setPluginData: (key, value) => data.set(key, value) };
  };
  const board = makeShape({ id: 'board', x: 0, width: 200, parent: root });
  const title = makeShape({ id: 'title', name: 'i18n.title', characters: 'Original',
    direction, align: direction === 'rtl' ? 'right' : 'left', x: direction === 'rtl' ? 150 : 20,
    width: 30, constraintsHorizontal: direction === 'rtl' ? 'right' : 'left', parent: board });
  const plain = makeShape({ id: 'plain', name: 'Untagged', characters: 'Brand',
    direction, align: 'center' });
  board.children = [title];
  const page = { root, findShapes(criteria) {
    if (!criteria) return [board, title, plain];
    return criteria.type === 'board' ? [board] : [title, plain];
  }, getShapeById(id) { return [board, title, plain].find(shape => shape.id === id) || null; } };
  return { page, title, plain };
}

test('direction switches both text and layout without a dictionary and survives reopening', async () => {
  const { page, title, plain } = directionalPage('ltr');
  const app = await ui(undefined, { currentPage: page });
  const button = app.elements.get('switch-direction');
  assert.equal(button.hidden, false);
  assert.equal(button.disabled, false);
  assert.equal(button.textContent, 'Switch to RTL');
  assert.equal(app.elements.get('direction-choice').hidden, true);
  assert.equal(app.elements.get('apply').disabled, true);
  button.focus();
  button.listeners.click();
  await new Promise(resolve => setImmediate(resolve));

  assert.deepEqual(app.messages[0], { type: 'switch-direction', requestId: 1,
    fileId: 'file-a', scope: 'page', pageId: page.id, direction: 'rtl' });
  assert.deepEqual([title.characters, title.direction, title.align, title.x],
    ['Original', 'rtl', 'right', 150]);
  assert.deepEqual([plain.characters, plain.direction, plain.align], ['Brand', 'rtl', 'center']);
  assert.equal(app.historyEvents.length, 2);
  assert.equal(app.document.activeElement, button);
  assert.equal(button.textContent, 'Switch to LTR');
  assert.equal(app.elements.get('direction-choice').hidden, true);

  const reopened = await ui({ EN: { title: 'Hello' } }, { currentPage: page });
  const select = reopened.elements.get('language');
  assert.equal(reopened.elements.get('switch-direction').textContent, 'Switch to LTR');
  select.value = 'EN';
  select.listeners.change();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual([title.characters, title.direction, title.x], ['Hello', 'rtl', 150]);
  reopened.elements.get('switch-direction').listeners.click();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual([title.characters, title.direction, title.align, title.x],
    ['Hello', 'ltr', 'left', 20]);
  assert.equal(select.value, 'EN');
});

test('navigation refreshes the switch and mixed or unknown scopes require an explicit target', async () => {
  const first = directionalPage('ltr');
  const other = directionalPage('rtl');
  const unknown = directionalPage(null);
  const app = await ui(undefined, { currentPage: first.page,
    pages: [first.page, other.page, unknown.page] });
  const button = app.elements.get('switch-direction');
  const choice = app.elements.get('direction-choice');
  const target = app.elements.get('target-direction');
  app.penpot.currentPage = other.page;
  // A click based on the previous page's reply is rejected even before the page event arrives.
  button.listeners.click();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual([first.title.direction, other.title.direction], ['ltr', 'rtl']);
  assert.match(app.elements.get('status').textContent, /Page changed/);
  assert.equal(button.textContent, 'Switch to LTR');
  assert.equal(choice.hidden, true);

  app.penpot.currentPage = unknown.page;
  await new Promise(resolve => setImmediate(resolve));
  assert.match(app.elements.get('direction-status').textContent, /Unknown/);
  assert.equal(choice.hidden, false);
  assert.equal(button.disabled, true);
  button.listeners.click();
  assert.equal(app.messages.length, 1, 'the switch requires a target');
  target.value = 'rtl';
  target.listeners.change();
  assert.equal(button.disabled, false);
  assert.equal(button.textContent, 'Switch to RTL');
  assert.equal(app.messages.length, 1, 'choosing a target does not write');

  const scope = app.elements.get('scope');
  scope.value = 'file';
  scope.listeners.change();
  await new Promise(resolve => setImmediate(resolve));
  assert.match(app.elements.get('direction-status').textContent, /Mixed/);
  assert.equal(choice.hidden, false);
  assert.equal(target.value, '');
  assert.equal(button.disabled, true);
  target.value = 'ltr';
  target.listeners.change();
  button.listeners.click();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(app.messages.at(-1).scope, 'file');
  assert.equal(other.title.x, 20, 'an initially RTL page mirrors into LTR');
  assert.equal(unknown.title.direction, null);
  assert.match(app.elements.get('status').textContent, /kept their unset direction/);
  assert.equal(button.textContent, 'Switch to RTL');
  assert.equal(choice.hidden, true);
});

test('a partial direction switch reports skipped layers and ignores unrelated replies while busy', async () => {
  const { page, title, plain } = directionalPage('ltr');
  plain.direction = 'mixed';
  const replies = [];
  const app = await ui(undefined, { currentPage: page, holdDirectionReplies: replies });
  const button = app.elements.get('switch-direction');
  const target = app.elements.get('target-direction');
  assert.equal(app.elements.get('direction-choice').hidden, false);
  target.value = 'rtl';
  target.listeners.change();
  button.listeners.click();
  assert.equal(app.elements.get('translation-file').disabled, true);
  assert.equal(target.disabled, true);
  assert.equal(button.disabled, true);
  app.events.message({ source: {}, data: replies[0] });
  app.events.message({ source: app.parent, data: { ...replies[0], type: 'localization-result' } });
  assert.equal(button.disabled, true);

  app.events.message({ source: app.parent, data: replies[0] });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(app.elements.get('translation-file').disabled, false);
  assert.equal(plain.direction, 'mixed');
  assert.equal(title.direction, 'rtl');
  assert.match(app.elements.get('status').textContent, /mixed direction or alignment/);
  assert.equal(app.elements.get('status').classList.contains('warning'), true);
  assert.equal(button.textContent, 'Switch to LTR');
  assert.equal(app.elements.get('direction-choice').hidden, true);
});

test('Arabic application updates text direction and reports RTL styling without changing JSON', async () => {
  const pluginData = new Map();
  const layer = { id: 'rtl-layer', name: 'i18n.title', characters: 'Original',
    direction: 'ltr', align: 'left',
    getPluginData: key => pluginData.get(key) || '',
    setPluginData: (key, value) => pluginData.set(key, value) };
  const app = await ui({ ar: { title: 'مرحبا' } }, {
    currentPage: { findShapes: () => [layer] }
  });
  app.elements.get('language').value = 'ar';
  app.elements.get('language').listeners.change();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(layer.characters, 'مرحبا');
  assert.equal(layer.direction, 'rtl');
  assert.equal(layer.align, 'right');
  assert.match(app.elements.get('status').textContent, /RTL direction or alignment updated/);
  assert.deepEqual(app.messages[0].translations, { ar: { title: 'مرحبا' } });
});

test('durable RTL style recovery is available after reopening while text stays session-only', async () => {
  const pluginData = new Map();
  const layer = { id: 'rtl-reopen-layer', name: 'i18n.title', characters: 'Original',
    direction: 'ltr', align: 'left',
    getPluginData: key => pluginData.get(key) || '',
    setPluginData: (key, value) => pluginData.set(key, value) };
  const currentPage = { findShapes: () => [layer] };
  const first = await ui({ ar: { title: 'مرحبا' } }, { currentPage });
  first.elements.get('language').value = 'ar';
  first.elements.get('language').listeners.change();
  await new Promise(resolve => setImmediate(resolve));

  const reopened = await ui(undefined, { currentPage });
  assert.equal(reopened.elements.get('restore').disabled, false);
  reopened.elements.get('restore').listeners.click();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(layer.characters, 'مرحبا');
  assert.equal(layer.direction, 'ltr');
  assert.equal(layer.align, 'left');
  assert.match(reopened.elements.get('status').textContent, /Restored RTL styling/);
});

test('RTL text previously applied by language can still switch its LTR layout to RTL', async () => {
  const { page, title, plain } = directionalPage('ltr');
  const findShapes = page.findShapes.bind(page);
  page.findShapes = criteria => findShapes(criteria).filter(shape => shape !== plain);
  const app = await ui({ ar: { title: 'مرحبا' } }, { currentPage: page });
  app.elements.get('language').value = 'ar';
  app.elements.get('language').listeners.change();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual([title.characters, title.direction, title.x], ['مرحبا', 'rtl', 20]);
  assert.match(app.elements.get('direction-status').textContent, /Mixed/);
  const target = app.elements.get('target-direction');
  target.value = 'rtl';
  target.listeners.change();
  app.elements.get('switch-direction').listeners.click();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual([title.characters, title.direction, title.x], ['مرحبا', 'rtl', 150]);
  assert.equal(app.elements.get('switch-direction').textContent, 'Switch to LTR');
});

test('a layout confirmation failure reports partial success and can be recovered after reopening', async () => {
  const { page, title } = directionalPage('ltr');
  let rejectConfirmation = true;
  const setPluginData = title.setPluginData;
  title.setPluginData = (key, value) => {
    if (rejectConfirmation && JSON.parse(value).layout?.active === 'baseline') {
      rejectConfirmation = false;
      throw new Error('SANITIZED final layout metadata failure');
    }
    setPluginData(key, value);
  };
  const app = await ui(undefined, { currentPage: page });
  app.elements.get('switch-direction').listeners.click();
  await new Promise(resolve => setImmediate(resolve));
  app.elements.get('switch-direction').listeners.click();
  await new Promise(resolve => setImmediate(resolve));

  assert.deepEqual([title.direction, title.x, title.constraintsHorizontal], ['ltr', 20, 'left']);
  assert.match(app.elements.get('status').textContent, /recovery metadata: 1/);
  assert.equal(app.elements.get('status').classList.contains('warning'), true);
  assert.equal(app.elements.get('direction-choice').hidden, false);
  assert.match(title.getPluginData('localization.rtl.v1'), /pending-baseline/);

  const reopened = await ui(undefined, { currentPage: page });
  reopened.elements.get('restore').listeners.click();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual([title.direction, title.x, title.characters], ['ltr', 20, 'Original']);
  assert.equal(reopened.elements.get('restore').disabled, true);
});

test('an incomplete direction switch exposes its retry and completes after metadata is writable', async () => {
  const { page, title } = directionalPage('ltr');
  const setData = title.setPluginData;
  title.setPluginData = () => {};
  const app = await ui(undefined, { currentPage: page });
  const button = app.elements.get('switch-direction');
  const choice = app.elements.get('direction-choice');
  const target = app.elements.get('target-direction');
  button.listeners.click();
  await new Promise(resolve => setImmediate(resolve));
  assert.match(app.elements.get('direction-status').textContent, /Conversion incomplete/);
  assert.equal(choice.hidden, false);
  assert.equal(target.value, 'rtl', 'the failed target stays selected for retry');
  assert.equal(button.textContent, 'Switch to RTL');
  assert.equal(button.disabled, false);
  assert.deepEqual([title.direction, title.x], ['ltr', 20]);

  title.setPluginData = setData;
  button.listeners.click();
  await new Promise(resolve => setImmediate(resolve));
  assert.match(app.elements.get('direction-status').textContent, /Direction: RTL/);
  assert.equal(choice.hidden, true);
  assert.equal(button.textContent, 'Switch to LTR');
  assert.equal(button.disabled, false);
  assert.deepEqual([title.direction, title.x], ['rtl', 150]);
});
