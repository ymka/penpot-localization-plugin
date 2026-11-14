/*
 * Penpot-side plugin entry point.
 * Only this script accesses the Penpot API.
 * Text layers to localize must be named i18n.<translation-key>.
 */

penpot.ui.open("Penpot Localization", "index.html", { width: 360, height: 620 });

const MAX_BYTES = 1024 * 1024;
const STORAGE_PREFIX = "localization.saved-import.v1:";
const MIXED_TEXT_STYLE_PROPERTIES = [
  "fontId",
  "fontFamily",
  "fontVariantId",
  "fontSize",
  "fontWeight",
  "fontStyle",
  "lineHeight",
  "letterSpacing",
  "textTransform",
  "textDecoration",
  "direction",
  "align",
  "fills"
];
const recoveryJournal = new Map();

function hasMixedTextStyle(layer) {
  return MIXED_TEXT_STYLE_PROPERTIES.some(property => layer[property] === "mixed");
}

function isValidId(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 200;
}

function validateSavedImport(record) {
  if (!record || typeof record !== "object" || Array.isArray(record)
      || Object.keys(record).length !== 4 || record.version !== 1
      || typeof record.name !== "string" || !record.name.length || record.name.length > 1024
      || typeof record.text !== "string" || record.text.length > MAX_BYTES
      || new TextEncoder().encode(record.text).length > MAX_BYTES
      || typeof record.language !== "string" || record.language.length > 35) {
    throw new Error("Invalid saved import.");
  }
  const data = JSON.parse(record.text.replace(/^\uFEFF/, ""));
  validateTranslations(data, record.language, true);
  return { version: 1, name: record.name, text: record.text, language: record.language };
}

function validateTranslations(translations, selectedLanguage, allowEmptySelection = false) {
  if (!translations || typeof translations !== "object" || Array.isArray(translations)) {
    throw new Error("Invalid translation dictionary.");
  }
  const languages = Object.keys(translations);
  if (!languages.length || languages.length > 64) throw new Error("Invalid language count.");
  let entries = 0;
  for (const language of languages) {
    if (language.length > 35 || !/^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/.test(language)) {
      throw new Error("Invalid language code.");
    }
    const strings = translations[language];
    if (!strings || typeof strings !== "object" || Array.isArray(strings)) {
      throw new Error("Invalid translation map.");
    }
    const keys = Object.keys(strings);
    entries += keys.length;
    if (entries > 10000 || keys.some(key => !key.trim() || key !== key.trim()
        || key.length > 200 || typeof strings[key] !== "string"
        || strings[key].length > 20000)) {
      throw new Error("Invalid translation entries.");
    }
  }
  let serialized;
  try {
    serialized = JSON.stringify(translations);
  } catch (error) {
    throw new Error("Invalid translation dictionary.");
  }
  if (typeof serialized !== "string"
      || new TextEncoder().encode(serialized).length > MAX_BYTES) {
    throw new Error("Translation dictionary exceeds the 1 MiB limit.");
  }
  if (allowEmptySelection && selectedLanguage === "") return null;
  if (typeof selectedLanguage !== "string" || selectedLanguage.length > 35
      || !/^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/.test(selectedLanguage)
      || !Object.prototype.hasOwnProperty.call(translations, selectedLanguage)) {
    throw new Error("Missing translations for the selected language.");
  }
  return translations[selectedLanguage];
}

function handleSavedImport(message) {
  if (!Number.isSafeInteger(message.requestId) || message.requestId < 1
      || !["load", "save", "forget"].includes(message.action)) return;
  const reply = {
    type: "saved-import-result", requestId: message.requestId, action: message.action
  };
  try {
    const fileId = penpot.currentFile && penpot.currentFile.id;
    if (!isValidId(fileId)) throw new Error("Open a design file, then reopen the plugin.");
    reply.fileId = fileId;
    if (message.action !== "load" && message.fileId !== fileId) {
      throw new Error("Design file changed. Reopen the plugin before continuing.");
    }
    const key = STORAGE_PREFIX + fileId;
    if (message.action === "load") {
      const stored = penpot.localStorage.getItem(key);
      // JSON escaping can expand a 1 MiB source up to sixfold.
      const empty = stored === null || stored === undefined || stored === "";
      if (!empty && (typeof stored !== "string"
          || stored.length > 6 * MAX_BYTES + 8192)) throw new Error("Invalid saved import.");
      reply.record = empty ? null : validateSavedImport(JSON.parse(stored));
    } else if (message.action === "save") {
      const record = validateSavedImport(message.record);
      penpot.localStorage.setItem(key, JSON.stringify(record));
    } else {
      penpot.localStorage.removeItem(key);
    }
    reply.ok = true;
  } catch (error) {
    reply.ok = false;
    // Storage errors can contain user data; keep responses generic.
    reply.error = reply.fileId && (message.action === "load" || message.fileId === reply.fileId)
      ? "Saved file storage is unavailable or contains invalid data."
      : "Open the intended design file and reopen the plugin.";
  }
  penpot.ui.sendMessage(reply);
}

function sendOperationError(type, message, requestId) {
  penpot.ui.sendMessage({ type, requestId, ok: false, error: message });
}

function handleDesignContext(message) {
  const reply = { type: "design-context-result", requestId: message.requestId };
  try {
    const currentFile = penpot.currentFile;
    const currentPage = penpot.currentPage;
    if (!currentFile || !currentPage || !isValidId(currentFile.id) || !isValidId(currentPage.id)) {
      throw new Error("Open a design file and a page before importing translations.");
    }
    reply.ok = true;
    reply.fileId = currentFile.id;
    reply.pageId = currentPage.id;
  } catch (error) {
    reply.ok = false;
    reply.error = "Open a design file and a page before importing translations.";
  }
  penpot.ui.sendMessage(reply);
}

function captureContext(message) {
  if (message.scope !== "page" && message.scope !== "file") {
    throw new Error("Unsupported scope.");
  }
  const currentPage = penpot.currentPage;
  const currentFile = penpot.currentFile;
  if (!currentPage || !currentFile) {
    throw new Error("Open a design file and a page before using the plugin.");
  }
  if (!isValidId(currentFile.id) || message.fileId !== currentFile.id) {
    throw new Error("Design file changed. Reopen the plugin before continuing.");
  }
  if (message.pageId !== undefined && !isValidId(message.pageId)) {
    throw new Error("Invalid page context.");
  }
  if (message.scope === "page" && message.pageId !== undefined
      && message.pageId !== currentPage.id) {
    throw new Error("Page changed while reading translations. Review the scope and apply again.");
  }
  const pages = message.scope === "file" ? currentFile.pages : [currentPage];
  if (!Array.isArray(pages) || !pages.length) throw new Error("No pages are available.");
  const pageIds = new Set();
  for (const page of pages) {
    if (!page || !isValidId(page.id) || pageIds.has(page.id)) {
      throw new Error("Invalid page context.");
    }
    pageIds.add(page.id);
  }
  return {
    fileId: currentFile.id,
    scope: message.scope,
    currentPageId: currentPage.id,
    pages: pages.map(page => ({ id: page.id, proxy: page }))
  };
}

function contextStillMatches(context) {
  const currentFile = penpot.currentFile;
  const currentPage = penpot.currentPage;
  if (!currentFile || currentFile.id !== context.fileId) return false;
  if (context.scope === "page" && (!currentPage || currentPage.id !== context.currentPageId)) {
    return false;
  }
  if (!Array.isArray(currentFile.pages)) return false;
  const currentPageIds = new Set(currentFile.pages.map(page => page && page.id));
  return context.pages.every(page => currentPageIds.has(page.id));
}

function getFileJournal(fileId, create = false) {
  let fileJournal = recoveryJournal.get(fileId);
  if (!fileJournal && create) {
    fileJournal = new Map();
    recoveryJournal.set(fileId, fileJournal);
  }
  return fileJournal || null;
}

function getPageJournal(fileId, pageId, create = false) {
  const fileJournal = getFileJournal(fileId, create);
  if (!fileJournal) return null;
  let pageJournal = fileJournal.get(pageId);
  if (!pageJournal && create) {
    pageJournal = new Map();
    fileJournal.set(pageId, pageJournal);
  }
  return pageJournal || null;
}

function hasRecovery(fileId) {
  const fileJournal = getFileJournal(fileId);
  if (!fileJournal) return false;
  return [...fileJournal.values()].some(pageJournal => pageJournal.size > 0);
}

function recordRecovery(operation, actualText) {
  const pageJournal = getPageJournal(operation.fileId, operation.pageId, true);
  const previous = pageJournal.get(operation.shapeId);
  pageJournal.set(operation.shapeId, {
    originalText: previous && previous.lastWrittenText === operation.before
      ? previous.originalText : operation.before,
    lastWrittenText: actualText
  });
}

function removeRecovery(fileId, pageId, shapeId) {
  const fileJournal = getFileJournal(fileId);
  const pageJournal = fileJournal && fileJournal.get(pageId);
  if (!pageJournal) return;
  pageJournal.delete(shapeId);
  if (!pageJournal.size) fileJournal.delete(pageId);
  if (!fileJournal.size) recoveryJournal.delete(fileId);
}

function planApply(context, strings) {
  const result = {
    pageCount: context.pages.length,
    tagged: 0,
    alreadyCorrect: 0,
    skipped: 0,
    failed: 0,
    failedPages: 0,
    missing: new Set(),
    operations: []
  };
  for (const page of context.pages) {
    let textLayers;
    try {
      textLayers = page.proxy.findShapes({ type: "text" });
      if (!Array.isArray(textLayers)) throw new Error("Invalid shape result.");
    } catch (error) {
      result.failedPages += 1;
      console.error("Cannot inspect a page.");
      continue;
    }
    for (const layer of textLayers) {
      let name;
      try {
        name = layer.name;
      } catch (error) {
        result.failed += 1;
        console.error("Cannot inspect a text layer.");
        continue;
      }
      if (typeof name !== "string" || !name.startsWith("i18n.")) continue;
      const key = name.slice("i18n.".length).trim();
      if (!key) continue;
      result.tagged += 1;
      if (!Object.prototype.hasOwnProperty.call(strings, key)) {
        result.missing.add(key);
        continue;
      }
      try {
        const before = layer.characters;
        const after = strings[key];
        if (before === after) {
          result.alreadyCorrect += 1;
        } else if (!isValidId(layer.id)) {
          result.failed += 1;
        } else if (hasMixedTextStyle(layer)) {
          result.skipped += 1;
        } else {
          result.operations.push({
            fileId: context.fileId,
            pageId: page.id,
            shapeId: layer.id,
            before,
            after
          });
        }
      } catch (error) {
        result.failed += 1;
        console.error("Cannot inspect a text layer.");
      }
    }
  }
  return result;
}

function executeApply(context, plan) {
  let changed = 0;
  let conflicts = 0;
  let historyFailed = false;
  if (!plan.operations.length) return { changed, conflicts, historyFailed };
  if (!contextStillMatches(context)) {
    plan.failed += plan.operations.length;
    return { changed, conflicts, historyFailed };
  }
  let historyId;
  try {
    historyId = penpot.history.undoBlockBegin();
  } catch (error) {
    plan.failed += plan.operations.length;
    console.error("Cannot start localization history.");
    return { changed, conflicts, historyFailed: true };
  }
  try {
    const pages = new Map(context.pages.map(page => [page.id, page.proxy]));
    for (const operation of plan.operations) {
      try {
        const page = pages.get(operation.pageId);
        const layer = page && page.getShapeById(operation.shapeId);
        if (!layer) {
          plan.failed += 1;
          continue;
        }
        if (layer.characters !== operation.before) {
          conflicts += 1;
          continue;
        }
        layer.characters = operation.after;
        let actualText;
        let readbackFailed = false;
        try {
          actualText = layer.characters;
        } catch (error) {
          actualText = operation.after;
          readbackFailed = true;
        }
        recordRecovery(operation, actualText);
        if (!readbackFailed && actualText === operation.after) changed += 1;
        else plan.failed += 1;
      } catch (error) {
        plan.failed += 1;
        console.error("Cannot update a text layer.");
      }
    }
  } finally {
    try {
      penpot.history.undoBlockFinish(historyId);
    } catch (error) {
      historyFailed = true;
      console.error("Cannot finish localization history.");
    }
  }
  return { changed, conflicts, historyFailed };
}

function handleApply(message) {
  const replyType = "localization-result";
  try {
    const strings = validateTranslations(message.translations, message.language);
    const context = captureContext(message);
    const plan = planApply(context, strings);
    const execution = executeApply(context, plan);
    penpot.ui.sendMessage({
      type: replyType,
      requestId: message.requestId,
      ok: true,
      language: message.language,
      pageCount: plan.pageCount,
      tagged: plan.tagged,
      changed: execution.changed,
      alreadyCorrect: plan.alreadyCorrect,
      skipped: plan.skipped,
      failed: plan.failed,
      failedPages: plan.failedPages,
      conflicts: execution.conflicts,
      historyFailed: execution.historyFailed,
      restoreAvailable: hasRecovery(context.fileId),
      missing: [...plan.missing].sort()
    });
  } catch (error) {
    console.error("Localization failed.");
    sendOperationError(replyType, error instanceof Error ? error.message : "Localization failed.", message.requestId);
  }
}

function planRestore(context) {
  const fileJournal = getFileJournal(context.fileId);
  const pages = new Map(context.pages.map(page => [page.id, page.proxy]));
  const result = {
    pageCount: context.pages.length,
    targeted: 0,
    skipped: 0,
    conflicts: 0,
    missingTargets: 0,
    failed: 0,
    operations: []
  };
  if (!fileJournal) return result;
  const journalPages = context.scope === "file"
    ? [...fileJournal.entries()]
    : [[context.currentPageId, fileJournal.get(context.currentPageId)]];
  for (const [pageId, pageJournal] of journalPages) {
    if (!pageJournal) continue;
    const page = pages.get(pageId);
    if (!page) {
      result.targeted += pageJournal.size;
      result.missingTargets += pageJournal.size;
      continue;
    }
    for (const [shapeId, entry] of pageJournal.entries()) {
      result.targeted += 1;
      try {
        const layer = page.getShapeById(shapeId);
        if (!layer) {
          result.missingTargets += 1;
          continue;
        }
        const currentText = layer.characters;
        if (currentText !== entry.lastWrittenText) {
          result.conflicts += 1;
        } else if (hasMixedTextStyle(layer)) {
          result.skipped += 1;
        } else {
          result.operations.push({
            fileId: context.fileId,
            pageId,
            shapeId,
            before: currentText,
            after: entry.originalText
          });
        }
      } catch (error) {
        result.failed += 1;
        console.error("Cannot inspect a recovery target.");
      }
    }
  }
  return result;
}

function executeRestore(context, plan) {
  let restored = 0;
  let historyFailed = false;
  if (!plan.operations.length) return { restored, historyFailed };
  if (!contextStillMatches(context)) {
    plan.failed += plan.operations.length;
    return { restored, historyFailed };
  }
  let historyId;
  try {
    historyId = penpot.history.undoBlockBegin();
  } catch (error) {
    plan.failed += plan.operations.length;
    console.error("Cannot start recovery history.");
    return { restored, historyFailed: true };
  }
  try {
    const pages = new Map(context.pages.map(page => [page.id, page.proxy]));
    for (const operation of plan.operations) {
      try {
        const page = pages.get(operation.pageId);
        const layer = page && page.getShapeById(operation.shapeId);
        if (!layer) {
          plan.missingTargets += 1;
          continue;
        }
        if (layer.characters !== operation.before) {
          plan.conflicts += 1;
          continue;
        }
        if (hasMixedTextStyle(layer)) {
          plan.skipped += 1;
          continue;
        }
        layer.characters = operation.after;
        if (layer.characters === operation.after) {
          restored += 1;
          removeRecovery(operation.fileId, operation.pageId, operation.shapeId);
        } else {
          plan.failed += 1;
        }
      } catch (error) {
        plan.failed += 1;
        console.error("Cannot restore a text layer.");
      }
    }
  } finally {
    try {
      penpot.history.undoBlockFinish(historyId);
    } catch (error) {
      historyFailed = true;
      console.error("Cannot finish recovery history.");
    }
  }
  return { restored, historyFailed };
}

function handleRestore(message) {
  const replyType = "restore-result";
  try {
    const context = captureContext(message);
    const plan = planRestore(context);
    const execution = executeRestore(context, plan);
    penpot.ui.sendMessage({
      type: replyType,
      requestId: message.requestId,
      ok: true,
      pageCount: plan.pageCount,
      targeted: plan.targeted,
      restored: execution.restored,
      skipped: plan.skipped,
      conflicts: plan.conflicts,
      missingTargets: plan.missingTargets,
      failed: plan.failed,
      historyFailed: execution.historyFailed,
      restoreAvailable: hasRecovery(context.fileId)
    });
  } catch (error) {
    console.error("Recovery failed.");
    sendOperationError(replyType, error instanceof Error ? error.message : "Recovery failed.", message.requestId);
  }
}

penpot.ui.onMessage((message) => {
  if (message && message.type === "saved-import-request") {
    handleSavedImport(message);
    return;
  }
  if (!message || !Number.isSafeInteger(message.requestId) || message.requestId < 1) return;
  if (message.type === "design-context-request") {
    handleDesignContext(message);
  } else if (message.type === "apply-language") {
    handleApply(message);
  } else if (message.type === "restore-localization") {
    handleRestore(message);
  }
});
