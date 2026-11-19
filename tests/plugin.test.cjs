const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.join(__dirname, '..');
const code = readFileSync(path.join(root, 'plugin.js'), 'utf8');
let nextFixtureId = 0;
const fixtureId = prefix => `${prefix}-${++nextFixtureId}`;
const text = (name, characters = 'Original') => ({ id: fixtureId('shape'), name, characters });
function withPluginData(shape) {
  const data = new Map();
  shape.getPluginData = key => data.get(key) || '';
  shape.setPluginData = (key, value) => data.set(key, value);
  return shape;
}

function rtlText(name = 'i18n.login.title', characters = 'Original', align = 'left') {
  return withPluginData({ id: fixtureId('shape'), name, characters,
    direction: 'ltr', align });
}
const page = (...layers) => {
  for (const layer of layers) {
    if (!layer.id) layer.id = fixtureId('shape');
  }
  return { id: fixtureId('page'), findShapes(criteria) {
    if (criteria) assert.equal(criteria.type, 'text');
    return layers;
  }, getShapeById(id) { return layers.find(layer => layer.id === id) || null; } };
};

function preparePage(candidate) {
  if (!candidate.id) candidate.id = fixtureId('page');
  if (!candidate.getShapeById) {
    let knownLayers = [];
    const findShapes = candidate.findShapes.bind(candidate);
    candidate.findShapes = criteria => {
      knownLayers = findShapes(criteria);
      if (Array.isArray(knownLayers)) {
        for (const layer of knownLayers) {
          if (!layer.id) layer.id = fixtureId('shape');
        }
      }
      return knownLayers;
    };
    candidate.getShapeById = id => knownLayers.find(layer => layer.id === id) || null;
  }
  return candidate;
}

function runtime(pages = [page()], overrides = {}) {
  pages = pages.map(preparePage);
  let receive;
  const messages = [];
  const opened = [];
  const errors = [];
  const history = [];
  const penpot = {
    currentPage: pages[0], currentFile: { id: 'file-a', pages },
    history: {
      undoBlockBegin() { const id = Symbol('history'); history.push(['begin', id]); return id; },
      undoBlockFinish(id) { history.push(['finish', id]); }
    },
    ui: { open: (...args) => opened.push(args), onMessage: fn => { receive = fn; },
      sendMessage: msg => messages.push(JSON.parse(JSON.stringify(msg))) },
    ...overrides
  };
  vm.runInNewContext(code, { penpot, TextEncoder, console: { error: (...args) => errors.push(args) } });
  return { opened, messages, errors, history, penpot, send: receive, apply(extra = {}) {
    receive({ type: 'apply-language', requestId: 1, fileId: 'file-a', language: 'ES', scope: 'page',
      updateRtlLayout: true, mirrorRtlLayout: false,
      translations: { ES: { 'login.title': 'Hola' } }, ...extra });
    return messages.at(-1);
  }, restore(extra = {}) {
    receive({ type: 'restore-localization', requestId: 2, fileId: 'file-a', scope: 'page', ...extra });
    return messages.at(-1);
  } };
}

test('manifest uses v2 and existing runtime entry; UI targets the shipped HTML', () => {
  const manifest = JSON.parse(readFileSync(path.join(root, 'manifest.json')));
  assert.equal(manifest.version, 2);
  assert.equal(manifest.code, 'plugin.js');
  assert.deepEqual(manifest.permissions, ['content:read', 'content:write', 'allow:localstorage']);
  assert.equal(runtime().opened[0][1], 'index.html');
});

test('current-page scope changes only tagged keys and updates repeated keys', () => {
  const a = text('i18n.login.title'), b = text('i18n.login.title');
  const plain = text('login.title'), emptyKey = text('i18n.');
  const other = text('i18n.login.title');
  const result = runtime([page(a, b, plain, emptyKey), page(other)]).apply();
  assert.equal(a.characters, 'Hola');
  assert.equal(b.characters, 'Hola');
  assert.equal(plain.characters, 'Original');
  assert.equal(emptyKey.characters, 'Original');
  assert.equal(other.characters, 'Original');
  assert.equal(result.changed, 2);
  assert.equal(result.tagged, 2);
  assert.equal(result.pageCount, 1);
});

test('file scope visits every page and repeated application is idempotent', () => {
  const a = text('i18n.login.title'), b = text('i18n.login.title');
  const app = runtime([page(a), page(b)]);
  assert.equal(app.apply({ scope: 'file' }).changed, 2);
  const second = app.apply({ scope: 'file' });
  assert.equal(second.changed, 0);
  assert.equal(second.alreadyCorrect, 2);
  assert.equal(second.pageCount, 2);
});

test('missing and invalid values remain unchanged with sorted unique warnings', () => {
  const layers = ['z', 'a', 'z', 'toString'].map(k => text(`i18n.${k}`));
  const result = runtime([page(...layers)]).apply({ translations: { ES: {} } });
  assert.deepEqual(result.missing, ['a', 'toString', 'z']);
  assert.ok(layers.every(layer => layer.characters === 'Original'));
});

test('empty translations and Unicode are literal string replacements', () => {
  const a = text('i18n.a'), b = text('i18n.b');
  runtime([page(a, b)]).apply({ language: 'ZH', translations: { ZH: { a: '', b: '你好\n世界 <b>' } } });
  assert.equal(a.characters, '');
  assert.equal(b.characters, '你好\n世界 <b>');
});

test('mixed-style layers are skipped without writes while uniform layers update', () => {
  const properties = ['fontId', 'fontFamily', 'fontVariantId', 'fontSize', 'fontWeight',
    'fontStyle', 'lineHeight', 'letterSpacing', 'textTransform', 'textDecoration',
    'direction', 'align', 'fills'];
  let writes = 0;
  const mixed = properties.map(property => {
    const layer = { name: 'i18n.login.title', characters: 'Original' };
    Object.defineProperty(layer, property, { value: 'mixed' });
    Object.defineProperty(layer, 'characters', {
      get() { return 'Original'; },
      set() { writes++; }
    });
    return layer;
  });
  const uniform = text('i18n.login.title');
  const result = runtime([page(...mixed, uniform)]).apply();
  assert.equal(writes, 0);
  assert.ok(mixed.every(layer => layer.characters === 'Original'));
  assert.equal(uniform.characters, 'Hola');
  assert.equal(result.changed, 1);
  assert.equal(result.skipped, properties.length);
  assert.equal(result.failed, 0);
});

test('already-correct mixed text needs no style inspection or write', () => {
  let writes = 0;
  const layer = { name: 'i18n.login.title',
    get characters() { return 'Hola'; },
    set characters(value) { writes++; },
    get fontFamily() { throw new Error('must not inspect'); } };
  const result = runtime([page(layer)]).apply();
  assert.equal(writes, 0);
  assert.equal(result.alreadyCorrect, 1);
  assert.equal(result.skipped, 0);
  assert.equal(result.failed, 0);
});

test('style inspection failures perform no write and do not stop later layers', () => {
  let writes = 0;
  const unreadable = { name: 'i18n.login.title',
    get characters() { return 'Original'; },
    get fontFamily() { throw new Error('unavailable'); },
    set characters(value) { writes++; } };
  const uniform = text('i18n.login.title');
  const result = runtime([page(unreadable, uniform)]).apply();
  assert.equal(writes, 0);
  assert.equal(uniform.characters, 'Hola');
  assert.equal(result.changed, 1);
  assert.equal(result.skipped, 0);
  assert.equal(result.failed, 1);
});

test('invalid requests and absent file context never write', () => {
  const layer = text('i18n.login.title');
  const app = runtime([page(layer)]);
  for (const request of [{ language: 'DE' }, { scope: 'selection' },
    { translations: null }, { translations: { ES: [] } }, { translations: { ES: 'bad' } },
    { pageId: 42 }, { updateRtlLayout: undefined }, { mirrorRtlLayout: null }]) {
    assert.equal(app.apply(request).ok, false);
    assert.equal(layer.characters, 'Original');
  }
  for (const overrides of [{ currentPage: null }, { currentFile: null }]) {
    assert.equal(runtime([page(layer)], overrides).apply().ok, false);
  }
  app.send(null);
  app.send({ type: 'unrelated' });
  assert.equal(app.messages.length, 8);
});

test('setter failure is counted and remaining layers still update', () => {
  const broken = { name: 'i18n.login.title', get characters() { return 'Old'; },
    set characters(value) { throw new Error('read only'); } };
  const good = text('i18n.login.title');
  const result = runtime([page(broken, good)]).apply();
  assert.equal(result.failed, 1);
  assert.equal(result.changed, 1);
  assert.equal(good.characters, 'Hola');
});

test('apply plans every page before writing and groups successful writes in one history block', () => {
  let inspectedSecondPage = false;
  let characters = 'Original';
  const layer = { id: fixtureId('shape'), name: 'i18n.login.title',
    get characters() { return characters; },
    set characters(value) {
      assert.equal(inspectedSecondPage, true, 'all traversal finishes before the first write');
      characters = value;
    } };
  const first = page(layer);
  const second = preparePage({ findShapes() {
    inspectedSecondPage = true;
    throw new Error('Unavailable page');
  } });
  const app = runtime([first, second]);
  const result = app.apply({ scope: 'file' });
  assert.equal(result.changed, 1);
  assert.equal(result.failedPages, 1);
  assert.equal(characters, 'Hola');
  assert.equal(app.history.length, 2);
  assert.equal(app.history[0][0], 'begin');
  assert.equal(app.history[1][0], 'finish');
  assert.equal(app.history[1][1], app.history[0][1]);
});

test('history always closes after setter failures and reports finish failures without hiding writes', () => {
  const broken = { name: 'i18n.login.title', get characters() { return 'Original'; },
    set characters(value) { throw new Error('read only'); } };
  const good = text('i18n.login.title');
  const app = runtime([page(broken, good)]);
  const result = app.apply();
  assert.equal(result.changed, 1);
  assert.equal(result.failed, 1);
  assert.deepEqual(app.history.map(event => event[0]), ['begin', 'finish']);

  const finishFailure = runtime([page(text('i18n.login.title'))], { history: {
    undoBlockBegin() { return Symbol('history'); },
    undoBlockFinish() { throw new Error('history unavailable'); }
  } });
  const failedResult = finishFailure.apply();
  assert.equal(failedResult.changed, 1);
  assert.equal(failedResult.historyFailed, true);
});

test('restore closes history after setter failure and reports a finish failure with partial results', () => {
  let characters = 'Original';
  let failRestore = false;
  const layer = { name: 'i18n.login.title', get characters() { return characters; },
    set characters(value) {
      if (failRestore && value === 'Original') throw new Error('restore unavailable');
      characters = value;
    } };
  const app = runtime([page(layer)]);
  app.apply();
  failRestore = true;
  const failed = app.restore();
  assert.equal(failed.restored, 0);
  assert.equal(failed.failed, 1);
  assert.equal(failed.restoreAvailable, true);
  assert.deepEqual(app.history.map(event => event[0]),
    ['begin', 'finish', 'begin', 'finish']);

  let failFinish = false;
  const finishLayer = text('i18n.login.title');
  const finishApp = runtime([page(finishLayer)], { history: {
    undoBlockBegin() { return Symbol('history'); },
    undoBlockFinish() { if (failFinish) throw new Error('history unavailable'); }
  } });
  finishApp.apply();
  failFinish = true;
  const finishResult = finishApp.restore();
  assert.equal(finishResult.restored, 1);
  assert.equal(finishResult.historyFailed, true);
  assert.equal(finishLayer.characters, 'Original');
});

test('repeated language switches restore the first original text in one grouped operation', () => {
  const layer = text('i18n.login.title', 'Original');
  const app = runtime([page(layer)]);
  const spanish = app.apply();
  assert.equal(spanish.restoreAvailable, true);
  const french = app.apply({ requestId: 2, language: 'FR',
    translations: { FR: { 'login.title': 'Bonjour' } } });
  assert.equal(french.changed, 1);
  assert.equal(layer.characters, 'Bonjour');
  const restored = app.restore({ requestId: 3 });
  assert.equal(restored.restored, 1);
  assert.equal(restored.targeted, 1);
  assert.equal(restored.restoreAvailable, false);
  assert.equal(layer.characters, 'Original');
  assert.deepEqual(app.history.map(event => event[0]),
    ['begin', 'finish', 'begin', 'finish', 'begin', 'finish']);
});

test('restore never overwrites external edits and reports layers deleted outside the plugin', () => {
  const layers = [text('i18n.login.title', 'Original'), text('i18n.login.title', 'Other')];
  const currentPage = { id: fixtureId('page'),
    findShapes: () => layers,
    getShapeById: id => layers.find(layer => layer.id === id) || null };
  const app = runtime([currentPage]);
  assert.equal(app.apply().changed, 2);
  layers[0].characters = 'External edit';
  layers.splice(1, 1);
  const historyEvents = app.history.length;
  const result = app.restore();
  assert.equal(result.restored, 0);
  assert.equal(result.conflicts, 1);
  assert.equal(result.missingTargets, 1);
  assert.equal(result.restoreAvailable, true);
  assert.equal(layers[0].characters, 'External edit');
  assert.equal(app.history.length, historyEvents, 'a non-mutating restore adds no history block');
});

test('restore rejects another design file without touching either file', () => {
  const original = text('i18n.login.title', 'Original');
  const originalPage = page(original);
  const currentFile = { id: 'file-a', pages: [originalPage] };
  const app = runtime([originalPage], { currentFile });
  app.apply();
  const other = text('i18n.login.title', 'Other file');
  currentFile.id = 'file-b';
  currentFile.pages = [page(other)];
  const result = app.restore();
  assert.equal(result.ok, false);
  assert.equal(original.characters, 'Hola');
  assert.equal(other.characters, 'Other file');
});

test('an explicit apply after divergence rebases recovery to the external text', () => {
  const layer = text('i18n.login.title', 'Original');
  const app = runtime([page(layer)]);
  app.apply();
  layer.characters = 'External edit';
  app.apply({ requestId: 2, language: 'FR',
    translations: { FR: { 'login.title': 'Bonjour' } } });
  assert.equal(layer.characters, 'Bonjour');
  const result = app.restore({ requestId: 3 });
  assert.equal(result.restored, 1);
  assert.equal(layer.characters, 'External edit');
});

test('history start failures prevent writes and keep recovery unavailable', () => {
  const layer = text('i18n.login.title');
  const app = runtime([page(layer)], { history: {
    undoBlockBegin() { throw new Error('history unavailable'); },
    undoBlockFinish() { throw new Error('must not finish'); }
  } });
  const result = app.apply();
  assert.equal(result.changed, 0);
  assert.equal(result.failed, 1);
  assert.equal(result.historyFailed, true);
  assert.equal(result.restoreAvailable, false);
  assert.equal(layer.characters, 'Original');
});

test('unexpected setter readback is failed but remains recoverable', () => {
  let characters = 'Original';
  let normalize = true;
  const layer = { name: 'i18n.login.title', get characters() { return characters; },
    set characters(value) { characters = normalize ? 'Host-normalized text' : value; } };
  const app = runtime([page(layer)]);
  const applied = app.apply();
  assert.equal(applied.changed, 0);
  assert.equal(applied.failed, 1);
  assert.equal(applied.restoreAvailable, true);
  normalize = false;
  const restored = app.restore();
  assert.equal(restored.restored, 1);
  assert.equal(characters, 'Original');
  assert.equal(restored.restoreAvailable, false);
});

test('page traversal errors remain visible without concealing partial results', () => {
  const result = runtime([{ findShapes() { throw new Error('Unavailable page'); } }]).apply();
  assert.equal(result.ok, true);
  assert.equal(result.changed, 0);
  assert.equal(result.failedPages, 1);
});

test('baseline apply and Restore report unfiltered page traversal failures', () => {
  const layer = rtlText();
  const brokenPage = { id: 'baseline-traversal-page',
    findShapes(criteria) {
      if (criteria && criteria.type === 'text') return [layer];
      throw new Error('Unavailable layout scan');
    },
    getShapeById(id) { return id === layer.id ? layer : null; } };
  const app = runtime([brokenPage]);

  const applied = app.apply({ language: 'EN',
    translations: { EN: { 'login.title': 'Hello' } } });
  assert.equal(applied.changed, 1);
  assert.equal(applied.failedPages, 1);
  assert.equal(layer.characters, 'Hello');

  const restored = app.restore();
  assert.equal(restored.restored, 1);
  assert.equal(restored.failedPages, 1);
  assert.equal(restored.restoreAvailable, true, 'the failed scan remains retryable');
  assert.equal(layer.characters, 'Original');
});

test('failure logs exclude imported keys, design text and raw host exceptions', () => {
  const key = 'SANITIZED_KEY';
  const replacement = 'SANITIZED_REPLACEMENT';
  const broken = { name: `i18n.${key}`, get characters() { return 'SANITIZED_ORIGINAL'; },
    set characters(value) { throw new Error(`SANITIZED_HOST_ERROR: ${value}`); } };
  const good = text(`i18n.${key}`);
  const setterApp = runtime([page(broken, good)]);
  const result = setterApp.apply({ translations: { ES: { [key]: replacement } } });
  assert.equal(result.failed, 1);
  assert.equal(result.changed, 1);
  assert.equal(good.characters, replacement);
  const traversalApp = runtime([{ findShapes() { throw new Error('SANITIZED_TRAVERSAL_ERROR'); } }]);
  assert.equal(traversalApp.apply().failedPages, 1);
  for (const app of [setterApp, traversalApp]) {
    const logged = app.errors.flat();
    assert.ok(logged.every(value => typeof value === 'string'), 'never log raw exceptions');
    assert.doesNotMatch(logged.join(' '), /SANITIZED_/);
  }
});

test('imported custom languages work and malformed selected maps fail before any writes', () => {
  const layer = text('i18n.login.title');
  const app = runtime([page(layer)]);
  assert.equal(app.apply({ language: 'de-DE', translations: { 'de-DE': { 'login.title': 'Hallo' } } }).changed, 1);
  for (const strings of [{ 'login.title': 'New', invalid: 5 },
    { 'login.title': 'x'.repeat(20001) }, { ' padded ': 'x' }]) {
    assert.equal(app.apply({ translations: { ES: strings } }).ok, false);
    assert.equal(layer.characters, 'Hallo');
  }
  const inherited = Object.create({ ES: { 'login.title': 'Inherited' } });
  assert.equal(app.apply({ translations: inherited }).ok, false);
  assert.equal(layer.characters, 'Hallo');

  assert.equal(app.apply({ translations: {
    ES: { 'login.title': 'Selected map is valid' },
    FR: { invalid: 42 }
  } }).ok, false, 'validate every map in the request envelope');
  const oversized = Object.fromEntries(Array.from({ length: 6000 }, (_, index) => [
    `key-${index}`, 'x'.repeat(200)
  ]));
  assert.equal(app.apply({ translations: { ES: oversized } }).ok, false);
  assert.equal(layer.characters, 'Hallo');
});

function savedImport(extra = {}) {
  return { version: 1, name: 'translations.json', text: '{"EN":{"title":"Hello"}}', language: 'EN', ...extra };
}

test('saved imports use distinct file keys and never write design text', () => {
  let writes = 0;
  const layer = { name: 'i18n.title', get characters() { return 'Original'; },
    set characters(value) { writes++; } };
  const storage = new Map();
  const localStorage = {
    getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value),
    removeItem: key => storage.delete(key)
  };
  const appA = runtime([page(layer)], { localStorage });
  const appB = runtime([page(layer)], { localStorage, currentFile: { id: 'file-b', pages: [] } });
  const request = { type: 'saved-import-request', requestId: 1, action: 'save', fileId: 'file-a', record: savedImport() };
  appA.send(request);
  assert.equal(appA.messages.at(-1).ok, true);
  appB.send({ ...request, fileId: 'file-b', record: savedImport({ language: '' }) });
  assert.equal(storage.size, 2);
  appA.send({ ...request, action: 'load' });
  assert.deepEqual(appA.messages.at(-1).record, savedImport());
  appB.send({ ...request, action: 'load' });
  assert.equal(appB.messages.at(-1).record.language, '');
  appA.send({ ...request, action: 'forget' });
  assert.equal(appA.messages.at(-1).ok, true);
  appA.send({ ...request, action: 'load' });
  assert.equal(appA.messages.at(-1).record, null);
  appB.send({ ...request, action: 'load' });
  assert.equal(appB.messages.at(-1).record.language, '');
  assert.equal(writes, 0);
});

test('storage requests validate records and context before accessing storage', () => {
  let storageWrites = 0;
  const app = runtime(undefined, { localStorage: {
    setItem() { storageWrites++; }, removeItem() { storageWrites++; }
  } });
  const request = { type: 'saved-import-request', requestId: 1, action: 'save', fileId: 'file-a' };
  const invalid = [null, [], {}, savedImport({ version: 2 }), savedImport({ name: '' }),
    savedImport({ name: 'x'.repeat(1025) }), savedImport({ text: '[]' }),
    savedImport({ text: '{}', language: '' }), savedImport({ language: 'FR' }),
    savedImport({ text: '{"EN":[]}' }), savedImport({ text: '{"EN":{"title":1}}' }),
    savedImport({ text: '{"EN":{" padded ":"x"}}' }),
    savedImport({ text: '{"invalid code":{}}' }),
    savedImport({ text: JSON.stringify({ EN: { title: 'x'.repeat(20001) } }) }),
    savedImport({ text: JSON.stringify({ EN: { ['x'.repeat(201)]: 'x' } }) }),
    savedImport({ text: JSON.stringify(Object.fromEntries(Array.from({ length: 65 }, (_, i) => [`en-${i}`, {}]))) }),
    savedImport({ text: JSON.stringify({ EN: Object.fromEntries(Array.from({ length: 10001 }, (_, i) => [`k${i}`, ''])) }) }),
    savedImport({ text: ' '.repeat(1024 * 1024 + 1) }),
    savedImport({ text: JSON.stringify({ EN: Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`k${i}`, '語'.repeat(20000)])) }) })];
  for (const record of invalid) {
    app.send({ ...request, record });
    assert.equal(app.messages.at(-1).ok, false);
  }
  for (const action of ['save', 'forget']) {
    app.send({ ...request, action, fileId: 'file-b', record: savedImport() });
    assert.equal(app.messages.at(-1).ok, false);
  }
  const count = app.messages.length;
  for (const extra of [{ requestId: 0 }, { requestId: '1' }, { action: 'other' }]) {
    app.send({ ...request, ...extra });
  }
  assert.equal(app.messages.length, count);
  assert.equal(storageWrites, 0);
});

test('corrupt saved data and storage exceptions fail without exposing storage contents', () => {
  const request = { type: 'saved-import-request', requestId: 1, action: 'load', fileId: 'file-a', record: savedImport() };
  for (const stored of ['{', JSON.stringify(savedImport({ text: 'null' })), 'x'.repeat(6 * 1024 * 1024 + 8193)]) {
    const app = runtime(undefined, { localStorage: { getItem: () => stored } });
    app.send(request);
    assert.equal(app.messages.at(-1).ok, false);
    assert.equal(app.messages.at(-1).record, undefined);
  }
  const fail = () => { throw new Error('sensitive storage error'); };
  const app = runtime(undefined, { localStorage: { getItem: fail, setItem: fail, removeItem: fail } });
  for (const action of ['load', 'save', 'forget']) {
    app.send({ ...request, action });
    assert.equal(app.messages.at(-1).ok, false);
    assert.doesNotMatch(app.messages.at(-1).error, /sensitive/);
  }
});

test('storage accepts BOM, byte boundary and literal prototype keys', () => {
  let stored;
  const app = runtime(undefined, { localStorage: {
    getItem: () => stored, setItem: (key, value) => { stored = value; }
  } });
  const text = '\uFEFF{"EN":{"__proto__":"literal","toString":"also literal"}}';
  const record = savedImport({ text: text + ' '.repeat(1024 * 1024 - Buffer.byteLength(text)) });
  app.send({ type: 'saved-import-request', requestId: 1, action: 'save', fileId: 'file-a', record });
  assert.equal(app.messages.at(-1).ok, true);
  app.send({ type: 'saved-import-request', requestId: 2, action: 'load' });
  assert.deepEqual(app.messages.at(-1).record, record);
});

test('applying translations for another design file performs no writes', () => {
  let writes = 0;
  const layer = { name: 'i18n.login.title', get characters() { return 'Original'; },
    set characters(value) { writes++; } };
  const app = runtime([page(layer)]);
  assert.equal(app.apply({ fileId: 'file-b' }).ok, false);
  assert.equal(app.apply({ fileId: undefined }).ok, false);
  assert.equal(writes, 0);
});

test('apply results echo request IDs on success and every error path', () => {
  const app = runtime();
  assert.equal(app.apply({ requestId: 41 }).requestId, 41);
  for (const extra of [{ language: 'bad code' }, { scope: 'bad' },
    { translations: null }, { translations: { ES: { title: 1 } } }, { fileId: 'other' }]) {
    const result = app.apply({ requestId: 42, ...extra });
    assert.equal(result.ok, false);
    assert.equal(result.requestId, 42);
  }
  assert.equal(runtime(undefined, { currentFile: null }).apply({ requestId: 43 }).requestId, 43);
  assert.equal(runtime([{ findShapes() { throw new Error('Failed'); } }]).apply({ requestId: 44 }).requestId, 44);
});

test('design context snapshots expose only validated file and page IDs', () => {
  const currentPage = page();
  const app = runtime([currentPage]);
  app.send({ type: 'design-context-request', requestId: 9 });
  assert.deepEqual(app.messages.at(-1), {
    type: 'design-context-result', requestId: 9, ok: true,
    fileId: 'file-a', pageId: currentPage.id
  });
  const count = app.messages.length;
  for (const requestId of [undefined, 0, '9']) {
    app.send({ type: 'design-context-request', requestId });
  }
  assert.equal(app.messages.length, count);

  app.penpot.currentPage = null;
  app.send({ type: 'design-context-request', requestId: 10 });
  assert.equal(app.messages.at(-1).ok, false);
  assert.equal(app.messages.at(-1).fileId, undefined);
  assert.equal(app.messages.at(-1).pageId, undefined);
});

test('page-scoped apply rejects a stale captured page while file scope remains stable', () => {
  const firstLayer = text('i18n.login.title');
  const secondLayer = text('i18n.login.title');
  const firstPage = page(firstLayer);
  const secondPage = page(secondLayer);
  const app = runtime([firstPage, secondPage]);
  app.penpot.currentPage = secondPage;
  const rejected = app.apply({ pageId: firstPage.id });
  assert.equal(rejected.ok, false);
  assert.match(rejected.error, /Page changed while reading translations/);
  assert.equal(firstLayer.characters, 'Original');
  assert.equal(secondLayer.characters, 'Original');
  assert.equal(app.history.length, 0);

  const applied = app.apply({ requestId: 2, scope: 'file', pageId: firstPage.id });
  assert.equal(applied.changed, 2);
  assert.equal(firstLayer.characters, 'Hola');
  assert.equal(secondLayer.characters, 'Hola');
});

test('missing or malformed apply request IDs cause no writes or replies', () => {
  let writes = 0;
  const layer = { name: 'i18n.login.title', get characters() { return 'Original'; },
    set characters(value) { writes++; } };
  const app = runtime([page(layer)]);
  for (const requestId of [undefined, null, '1', 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    app.apply({ requestId });
  }
  assert.equal(writes, 0);
  assert.equal(app.messages.length, 0);
});

test('RTL language and script codes apply direction and smart alignment, then LTR restores it', () => {
  for (const language of ['ar', 'AR-EG', 'ckb', 'dv', 'fa', 'he', 'ps', 'sd', 'ug', 'ur', 'yi',
    'az-Arab', 'aa-Hebr', 'aa-Thaa', 'aa-Nkoo', 'aa-Adlm', 'aa-Rohg', 'aa-Syrc', 'aa-Mand']) {
    const layer = rtlText();
    const app = runtime([page(layer)]);
    const result = app.apply({ language, translations: { [language]: { 'login.title': 'RTL' } } });
    assert.equal(result.rtl, true, language);
    assert.equal(result.styled, 1, language);
    assert.equal(layer.direction, 'rtl', language);
    assert.equal(layer.align, 'right', language);
  }

  const layer = rtlText('i18n.login.title', 'Original', 'center');
  const app = runtime([page(layer)]);
  app.apply({ language: 'ar', translations: { ar: { 'login.title': 'مرحبا' } } });
  assert.equal(layer.align, 'center');
  const repeated = app.apply({ requestId: 2, language: 'ar',
    translations: { ar: { 'login.title': 'مرحبا' } } });
  assert.equal(repeated.styled, 0);
  const ltr = app.apply({ requestId: 3, language: 'EN',
    translations: { EN: { 'login.title': 'Hello' } } });
  assert.equal(ltr.rtl, false);
  assert.equal(ltr.styled, 1);
  assert.equal(layer.direction, 'ltr');
  assert.equal(layer.align, 'center');
});

test('RTL style conflicts and mixed styles never overwrite external style changes', () => {
  const layer = rtlText();
  const app = runtime([page(layer)]);
  app.apply({ language: 'ar', translations: { ar: { 'login.title': 'مرحبا' } } });
  layer.align = 'center';
  const conflict = app.apply({ requestId: 2, language: 'ar',
    translations: { ar: { 'login.title': 'أهلا' } } });
  assert.equal(conflict.changed, 1);
  assert.equal(conflict.styleConflicts, 1);
  assert.equal(layer.align, 'center');

  const mixed = rtlText('i18n.login.title', 'مرحبا');
  mixed.direction = 'mixed';
  const skipped = runtime([page(mixed)]).apply({ language: 'ar',
    translations: { ar: { 'login.title': 'مرحبا' } } });
  assert.equal(skipped.skipped, 1);
  assert.equal(skipped.styled, 0);
});

test('RTL metadata failures prevent style writes', () => {
  let direction = 'ltr';
  let styleWrites = 0;
  const layer = { id: 'metadata-failure', name: 'i18n.login.title', characters: 'Original',
    get direction() { return direction; },
    set direction(value) { styleWrites++; direction = value; },
    align: 'left', getPluginData: () => '',
    setPluginData() { throw new Error('metadata unavailable'); } };
  const result = runtime([page(layer)]).apply({ language: 'ar',
    translations: { ar: { 'login.title': 'مرحبا' } } });
  assert.equal(result.changed, 1);
  assert.equal(result.styled, 0);
  assert.equal(result.failed, 1);
  assert.equal(styleWrites, 0);
  assert.equal(direction, 'ltr');
});

test('metadata-first pending state safely retries a partial RTL style write', () => {
  const data = new Map();
  let direction = 'ltr';
  let align = 'left';
  let failAlign = true;
  const layer = { id: 'partial-style', name: 'i18n.login.title', characters: 'Original',
    get direction() { return direction; }, set direction(value) { direction = value; },
    get align() { return align; }, set align(value) {
      if (failAlign) throw new Error('alignment unavailable');
      align = value;
    },
    getPluginData: key => data.get(key) || '',
    setPluginData: (key, value) => data.set(key, value) };
  const app = runtime([page(layer)]);
  const partial = app.apply({ language: 'ar',
    translations: { ar: { 'login.title': 'مرحبا' } } });
  assert.equal(partial.failed, 1);
  assert.equal(direction, 'rtl');
  assert.equal(align, 'left');
  assert.match(data.get('localization.rtl.v1'), /pending-rtl/);

  failAlign = false;
  const retried = app.apply({ requestId: 2, language: 'ar',
    translations: { ar: { 'login.title': 'مرحبا' } } });
  assert.equal(retried.styleConflicts, 0);
  assert.equal(retried.styled, 1);
  assert.equal(align, 'right');
  assert.doesNotMatch(data.get('localization.rtl.v1'), /pending-/);
});

test('unsupported optional flex values are skipped instead of written', () => {
  let paddingWrites = 0;
  const rootShape = { id: 'root' };
  const flex = { dir: 'column', alignItems: undefined,
    get leftPadding() { return undefined; },
    set leftPadding(value) { paddingWrites++; throw new Error(`invalid ${value}`); },
    get rightPadding() { return undefined; },
    set rightPadding(value) { paddingWrites++; throw new Error(`invalid ${value}`); } };
  const board = withPluginData({ id: 'optional-flex', x: 0, width: 100,
    parent: rootShape, children: [], flex, isComponentInstance: () => false });
  const layoutPage = { id: 'optional-flex-page', root: rootShape,
    findShapes(criteria) {
      if (!criteria) return [board];
      if (criteria.type === 'text') return [];
      if (criteria.type === 'board') return [board];
      return [];
    },
    getShapeById(id) { return id === board.id ? board : null; } };

  const app = runtime([layoutPage]);
  const result = app.apply({ language: 'ar', mirrorRtlLayout: true,
    translations: { ar: {} } });

  assert.equal(result.failed, 0);
  assert.equal(result.mirrored, 0);
  assert.equal(result.layoutSkipped, 1);
  assert.equal(result.layoutUnsupported, 1);
  assert.equal(result.layoutSubtreesSkipped, 0);
  assert.equal(paddingWrites, 0);
  assert.equal(app.errors.length, 0);
});

test('unsupported flex fields are reported alongside supported updates', () => {
  const rootShape = { id: 'root' };
  const flex = { dir: 'row', alignItems: 'start', leftPadding: undefined,
    rightPadding: undefined };
  const board = withPluginData({ id: 'partial-flex', x: 0, width: 100,
    parent: rootShape, children: [], flex, isComponentInstance: () => false });
  const layoutPage = { id: 'partial-flex-page', root: rootShape,
    findShapes(criteria) {
      if (!criteria) return [board];
      if (criteria.type === 'text') return [];
      if (criteria.type === 'board') return [board];
      return [];
    },
    getShapeById(id) { return id === board.id ? board : null; } };

  const result = runtime([layoutPage]).apply({ language: 'ar', mirrorRtlLayout: true,
    translations: { ar: {} } });

  assert.equal(result.mirrored, 1);
  assert.equal(flex.dir, 'row-reverse');
  assert.equal(result.layoutSkipped, 1);
  assert.equal(result.layoutUnsupported, 1);
});

test('one rejected layout property does not block supported properties on the same shape', () => {
  const data = new Map();
  let dir = 'row';
  let leftPadding = 4;
  let rightPadding = 12;
  const flex = {
    get dir() { return dir; },
    set dir(value) { throw new Error(`unsupported ${value}`); },
    get leftPadding() { return leftPadding; },
    set leftPadding(value) { leftPadding = value; },
    get rightPadding() { return rightPadding; },
    set rightPadding(value) { rightPadding = value; }
  };
  const rootShape = { id: 'root' };
  const board = { id: 'partial-layout', x: 0, width: 100, parent: rootShape,
    children: [], flex, isComponentInstance: () => false,
    getPluginData: key => data.get(key) || '',
    setPluginData: (key, value) => data.set(key, value) };
  const layoutPage = { id: 'partial-layout-page', root: rootShape,
    findShapes(criteria) {
      if (!criteria) return [board];
      if (criteria.type === 'text') return [];
      if (criteria.type === 'board') return [board];
      return [];
    },
    getShapeById(id) { return id === board.id ? board : null; } };

  const app = runtime([layoutPage]);
  const result = app.apply({ language: 'ar', mirrorRtlLayout: true,
    translations: { ar: {} } });

  assert.equal(result.failed, 1);
  assert.equal(result.layoutFailed, 1);
  assert.equal(result.styleFailed, 0);
  assert.deepEqual(result.layoutFailureReasons, {
    alignment: 0, constraints: 0, flexDirection: 1, margins: 0,
    metadata: 0, padding: 0, position: 0, target: 0
  });
  assert.equal(result.mirrored, 1);
  assert.equal(result.layoutStateComplete, false);
  assert.equal(dir, 'row');
  assert.equal(leftPadding, 12);
  assert.equal(rightPadding, 4);
  assert.match(data.get('localization.rtl.v1'), /pending-rtl/);
  assert.deepEqual(app.errors,
    [['Some RTL layout updates were skipped (flexDirection: 1).']]);
});

test('invalid or unreadable RTL metadata does not block text updates or spam recovery scans', () => {
  const layer = rtlText();
  layer.getPluginData = () => '{invalid';
  const unreadable = rtlText();
  unreadable.getPluginData = () => { throw new Error('metadata unavailable'); };
  const app = runtime([page(layer, unreadable)]);

  const result = app.apply({ language: 'ar',
    translations: { ar: { 'login.title': 'مرحبا' } } });
  assert.equal(result.changed, 2);
  assert.equal(result.styled, 0);
  assert.equal(result.styleConflicts, 2);
  assert.equal(result.styleMetadataConflicts, 2);
  assert.equal(layer.characters, 'مرحبا');
  assert.equal(unreadable.characters, 'مرحبا');

  app.send({ type: 'recovery-status-request', requestId: 9,
    fileId: 'file-a', scope: 'page' });
  assert.equal(app.messages.at(-1).ok, true);
  assert.equal(app.messages.at(-1).restoreAvailable, true,
    'session text recovery remains available');

  const restored = app.restore({ requestId: 10 });
  assert.equal(restored.restored, 2);
  assert.equal(restored.metadataConflicts, 2);
  assert.equal(restored.failed, 0);
  assert.equal(app.errors.length, 0);
});

test('managed RTL layout mirrors supported board contents and reverses idempotently', () => {
  const rootShape = { id: 'root' };
  const marginChild = withPluginData({ id: 'margin-child', x: 0, width: 20,
    constraintsHorizontal: 'left', layoutChild: { absolute: false, marginType: 'multiple',
      leftMargin: 4, rightMargin: 12, alignSelf: 'start' }, children: [], flipX: false,
    isComponentInstance: () => false });
  const flexBoard = withPluginData({ id: 'flex-board', x: 120, width: 100,
    constraintsHorizontal: 'right', parent: null, children: [marginChild],
    flex: { dir: 'column', alignItems: 'start', leftPadding: 8, rightPadding: 16 },
    isComponentInstance: () => false });
  marginChild.parent = flexBoard;
  const plainChild = withPluginData({ id: 'plain-child', x: 240, width: 40,
    constraintsHorizontal: 'left', children: [], flipX: false,
    isComponentInstance: () => false });
  const grid = withPluginData({ id: 'grid', x: 0, width: 20, constraintsHorizontal: 'left',
    grid: { dir: 'row' }, children: [], isComponentInstance: () => false });
  const component = withPluginData({ id: 'component', x: 0, width: 20,
    constraintsHorizontal: 'left', children: [], isComponentInstance: () => true });
  const board = withPluginData({ id: 'board', x: 100, width: 300, parent: rootShape,
    children: [flexBoard, plainChild, grid, component], isComponentInstance: () => false });
  flexBoard.parent = board;
  plainChild.parent = board;
  grid.parent = board;
  component.parent = board;
  const label = rtlText('i18n.login.title');
  label.parent = board;
  const shapes = [board, flexBoard, marginChild, plainChild, grid, component, label];
  const layoutPage = {
    id: 'layout-page', root: rootShape,
    findShapes(criteria) {
      if (!criteria) return shapes;
      if (criteria.type === 'text') return [label];
      if (criteria.type === 'board') return [board, flexBoard, grid];
      return [];
    },
    getShapeById(id) { return shapes.find(shape => shape.id === id) || null; }
  };
  const app = runtime([layoutPage]);
  const rtl = app.apply({ language: 'ar', mirrorRtlLayout: true,
    translations: { ar: { 'login.title': 'مرحبا' } } });
  assert.equal(rtl.layoutSkipped, 2);
  assert.equal(rtl.layoutSubtreesSkipped, 2);
  assert.equal(rtl.layoutUnsupported, 0);
  assert.ok(rtl.mirrored >= 3);
  assert.equal(board.x, 100, 'the top-level board stays fixed');
  assert.equal(flexBoard.x, 280);
  assert.equal(flexBoard.constraintsHorizontal, 'left');
  assert.equal(flexBoard.flex.dir, 'column');
  assert.equal(flexBoard.flex.alignItems, 'end');
  assert.equal(flexBoard.flex.leftPadding, 16);
  assert.equal(flexBoard.flex.rightPadding, 8);
  assert.equal(marginChild.layoutChild.leftMargin, 12);
  assert.equal(marginChild.layoutChild.rightMargin, 4);
  assert.equal(marginChild.layoutChild.alignSelf, 'end');
  assert.equal(plainChild.x, 220);
  assert.equal(plainChild.flipX, false);
  assert.equal(grid.x, 0);
  assert.equal(component.x, 0);

  const repeated = app.apply({ requestId: 2, language: 'ar', mirrorRtlLayout: true,
    translations: { ar: { 'login.title': 'مرحبا' } } });
  assert.equal(repeated.mirrored, 0);
  const reversed = app.apply({ requestId: 3, language: 'ar', mirrorRtlLayout: false,
    translations: { ar: { 'login.title': 'مرحبا' } } });
  assert.ok(reversed.mirrored >= 3);
  assert.equal(flexBoard.x, 120);
  assert.equal(flexBoard.flex.alignItems, 'start');
  assert.equal(plainChild.x, 240);
  assert.equal(label.direction, 'rtl');
});

test('reapplying mirrored layout refreshes targets after baseline geometry changes', () => {
  const rootShape = { id: 'root' };
  const child = withPluginData({ id: 'resized-child', x: 20, width: 30,
    constraintsHorizontal: 'left', children: [], isComponentInstance: () => false });
  const board = withPluginData({ id: 'resized-board', x: 0, width: 200,
    parent: rootShape, children: [child], isComponentInstance: () => false });
  child.parent = board;
  const shapes = [board, child];
  const layoutPage = { id: 'resized-page', root: rootShape,
    findShapes(criteria) {
      if (!criteria) return shapes;
      if (criteria.type === 'text') return [];
      if (criteria.type === 'board') return [board];
      return [];
    },
    getShapeById(id) { return shapes.find(shape => shape.id === id) || null; } };
  const app = runtime([layoutPage]);

  app.apply({ language: 'ar', mirrorRtlLayout: true, translations: { ar: {} } });
  app.apply({ requestId: 2, language: 'ar', mirrorRtlLayout: false,
    translations: { ar: {} } });
  child.width = 50;
  board.width = 300;
  const reapplied = app.apply({ requestId: 3, language: 'ar', mirrorRtlLayout: true,
    translations: { ar: {} } });

  assert.equal(reapplied.layoutConflicts, 0);
  assert.equal(child.x, 230);
});

test('reapplying mirrored layout refreshes targets after mirrored geometry changes', () => {
  const rootShape = { id: 'root' };
  const child = withPluginData({ id: 'mirrored-resized-child', x: 20, width: 30,
    constraintsHorizontal: 'left', children: [], isComponentInstance: () => false });
  const board = withPluginData({ id: 'mirrored-resized-board', x: 0, width: 200,
    parent: rootShape, children: [child], isComponentInstance: () => false });
  child.parent = board;
  const shapes = [board, child];
  const layoutPage = { id: 'mirrored-resized-page', root: rootShape,
    findShapes(criteria) {
      if (!criteria) return shapes;
      if (criteria.type === 'text') return [];
      if (criteria.type === 'board') return [board];
      return [];
    },
    getShapeById(id) { return shapes.find(shape => shape.id === id) || null; } };
  const app = runtime([layoutPage]);

  app.apply({ language: 'ar', mirrorRtlLayout: true, translations: { ar: {} } });
  board.width = 300;
  child.width = 50;
  const reapplied = app.apply({ requestId: 2, language: 'ar', mirrorRtlLayout: true,
    translations: { ar: {} } });

  assert.equal(reapplied.layoutConflicts, 0);
  assert.equal(child.x, 230);
});

test('durable RTL metadata is discoverable after reopening and Restore returns baselines', () => {
  const layer = rtlText();
  const first = runtime([page(layer)]);
  first.apply({ language: 'ar', translations: { ar: { 'login.title': 'مرحبا' } } });
  const reopened = runtime([page(layer)]);
  reopened.send({ type: 'recovery-status-request', requestId: 9,
    fileId: 'file-a', scope: 'page' });
  assert.equal(reopened.messages.at(-1).restoreAvailable, true);
  const restored = reopened.restore();
  assert.equal(restored.stylesRestored, 1);
  assert.equal(restored.restored, 0, 'text recovery remains session-only');
  assert.equal(layer.characters, 'مرحبا');
  assert.equal(layer.direction, 'ltr');
  assert.equal(layer.align, 'left');
});

test('externally changed mirrored geometry is reported and never overwritten', () => {
  const rootShape = { id: 'root' };
  const child = withPluginData({ id: 'child', x: 20, width: 30,
    constraintsHorizontal: 'left', children: [], isComponentInstance: () => false });
  const board = withPluginData({ id: 'board', x: 0, width: 200, parent: rootShape,
    children: [child], isComponentInstance: () => false });
  child.parent = board;
  const layoutPage = { id: 'layout-conflict-page', root: rootShape,
    findShapes(criteria) {
      if (!criteria) return [board, child];
      if (criteria.type === 'text') return [];
      if (criteria.type === 'board') return [board];
      return [];
    },
    getShapeById(id) { return [board, child].find(shape => shape.id === id) || null; } };
  const app = runtime([layoutPage]);
  app.apply({ language: 'ar', mirrorRtlLayout: true, translations: { ar: {} } });
  assert.equal(child.x, 150);
  child.x = 140;
  const result = app.apply({ requestId: 2, language: 'EN', mirrorRtlLayout: false,
    translations: { EN: {} } });
  assert.equal(result.layoutConflicts, 1);
  assert.equal(child.x, 140);
});
