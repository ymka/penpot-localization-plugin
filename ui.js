const languageSelect = document.getElementById("language");
const scopeSelect = document.getElementById("scope");
const status = document.getElementById("status");
const fileInput = document.getElementById("translation-file");
const chooseFileButton = document.getElementById("choose-file");
const source = document.getElementById("source");
const rememberStatus = document.getElementById("remember-status");
const applyButton = document.getElementById("apply");
const restoreButton = document.getElementById("restore");
const forgetButton = document.getElementById("forget");
const directionStatus = document.getElementById("direction-status");
const directionChoice = document.getElementById("direction-choice");
const directionSelect = document.getElementById("target-direction");
const directionButton = document.getElementById("switch-direction");
const MAX_BYTES = 1024 * 1024;
const languageNames = {
  AF: "Afrikaans",
  AR: "Arabic",
  BG: "Bulgarian",
  BN: "Bengali",
  CA: "Catalan",
  CS: "Czech",
  DA: "Danish",
  DE: "German",
  EL: "Greek",
  EN: "English",
  ES: "Spanish",
  ET: "Estonian",
  FA: "Persian",
  FI: "Finnish",
  FIL: "Filipino",
  FR: "French",
  GU: "Gujarati",
  HE: "Hebrew",
  HI: "Hindi",
  HR: "Croatian",
  HU: "Hungarian",
  ID: "Indonesian",
  IS: "Icelandic",
  IT: "Italian",
  JA: "Japanese",
  KN: "Kannada",
  KO: "Korean",
  LT: "Lithuanian",
  LV: "Latvian",
  ML: "Malayalam",
  MR: "Marathi",
  MS: "Malay",
  NB: "Norwegian Bokmål",
  NE: "Nepali",
  NL: "Dutch",
  NN: "Norwegian Nynorsk",
  NO: "Norwegian",
  PA: "Punjabi",
  PL: "Polish",
  PT: "Portuguese",
  RO: "Romanian",
  RU: "Russian",
  SK: "Slovak",
  SL: "Slovenian",
  SR: "Serbian",
  SV: "Swedish",
  SW: "Swahili",
  TA: "Tamil",
  TE: "Telugu",
  TH: "Thai",
  TR: "Turkish",
  UK: "Ukrainian",
  UR: "Urdu",
  VI: "Vietnamese",
  ZH: "Chinese"
};
let loading = false;
let translations = null;
let activeImport = null;
let fileId = null;
let storageRequestId = 0;
let pendingStorage = null;
let contextRequestId = 0;
let pendingContext = null;
let applyRequestId = 0;
let pendingApply = null;
let restoreRequestId = 0;
let pendingRestore = null;
let recoveryRequestId = 0;
let pendingRecovery = null;
let restoreAvailable = false;
let directionContext = null;
let restoreDirectionFocus = false;
let failedApply = null;
let restoreApplyFocus = false;
let restoreRestoreFocus = false;
const LAYOUT_FAILURE_LABELS = {
  alignment: "alignment",
  constraints: "constraints",
  flexDirection: "flex direction",
  margins: "margins",
  metadata: "recovery metadata",
  padding: "padding",
  position: "position",
  target: "shape access/readback"
};

function setStatus(text, tone = "normal") {
  status.textContent = text;
  status.classList.toggle("error", tone === true || tone === "error");
  status.classList.toggle("warning", tone === "warning");
}

function validLayoutFailureReasons(value, expectedTotal) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const expectedKeys = Object.keys(LAYOUT_FAILURE_LABELS);
  const keys = Object.keys(value);
  if (keys.length !== expectedKeys.length
      || keys.some(key => !Object.prototype.hasOwnProperty.call(LAYOUT_FAILURE_LABELS, key))) {
    return false;
  }
  const counts = expectedKeys.map(key => value[key]);
  return counts.every(count => Number.isSafeInteger(count) && count >= 0)
    && counts.reduce((sum, count) => sum + count, 0) === expectedTotal;
}

function formatLayoutFailureReasons(reasons) {
  return Object.keys(LAYOUT_FAILURE_LABELS)
    .filter(key => reasons[key] > 0)
    .map(key => `${LAYOUT_FAILURE_LABELS[key]}: ${reasons[key]}`)
    .join("; ");
}

function validateDictionary(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("Expected a JSON object of language maps.");
  }
  const languages = Object.keys(data);
  if (!languages.length || languages.length > 64) throw new Error("Use 1–64 languages.");
  let entries = 0;
  for (const language of languages) {
    if (language.length > 35 || !/^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/.test(language)) {
      throw new Error(`Invalid language code: ${language}. Use codes such as EN, de, or zh-Hans.`);
    }
    const strings = data[language];
    if (!strings || typeof strings !== "object" || Array.isArray(strings)) {
      throw new Error(`${language} must contain a flat object of translation strings.`);
    }
    const keys = Object.keys(strings);
    entries += keys.length;
    if (entries > 10000) throw new Error("Use at most 10,000 translation entries in total.");
    for (const key of keys) {
      if (!key.trim() || key !== key.trim() || key.length > 200) {
        throw new Error(`${language}: keys must be nonblank, unpadded, and at most 200 characters.`);
      }
      if (typeof strings[key] !== "string" || strings[key].length > 20000) {
        throw new Error(`${language}.${key} must be a string of at most 20,000 characters.`);
      }
    }
  }
  return data;
}

function setLoading(value) {
  loading = value;
  updateControls();
}

function reverseDirection() {
  if (!directionContext || directionContext.incomplete) return "";
  if (directionContext.direction === "ltr") return "rtl";
  if (directionContext.direction === "rtl") return "ltr";
  return "";
}

function updateControls() {
  const busy = loading || pendingContext !== null
    || pendingApply !== null || pendingRestore !== null;
  const hasSelection = translations && languageSelect.value && fileId;
  const needsRetry = matchesCurrentChoice(failedApply);
  fileInput.disabled = busy;
  chooseFileButton.disabled = busy;
  languageSelect.disabled = busy || !translations;
  scopeSelect.disabled = busy;
  const currentDirection = directionContext?.direction;
  const reverse = reverseDirection();
  const target = reverse || directionSelect.value;
  directionStatus.textContent = pendingRecovery ? "Checking direction…"
    : directionContext?.incomplete ? "Conversion incomplete. Choose a direction to retry or reverse."
    : currentDirection === "ltr" || currentDirection === "rtl"
      ? `Direction: ${currentDirection.toUpperCase()}`
      : currentDirection === "mixed" ? "Mixed direction."
      : currentDirection === "unknown" ? "Unknown direction."
      : "Direction is unavailable.";
  directionChoice.hidden = !directionContext || Boolean(reverse);
  directionSelect.disabled = busy || Boolean(pendingRecovery) || directionChoice.hidden;
  directionButton.hidden = !directionContext;
  directionButton.disabled = busy || Boolean(pendingRecovery) || directionButton.hidden || !target;
  directionButton.textContent = target ? `Switch to ${target.toUpperCase()}` : "Switch direction";
  if (!busy && !pendingRecovery && restoreDirectionFocus) {
    if (!directionButton.disabled) directionButton.focus();
    else if (!directionSelect.disabled) directionSelect.focus();
    restoreDirectionFocus = false;
  }
  applyButton.disabled = busy || !hasSelection;
  applyButton.textContent = pendingApply && !pendingApply.direction ? "Applying…" : needsRetry ? "Try again"
    : scopeSelect.value === "file" ? "Apply to all pages" : "Apply to current page";
  restoreButton.disabled = busy || !fileId || !restoreAvailable;
  restoreButton.textContent = pendingRestore ? "Restoring…"
    : scopeSelect.value === "file" ? "Restore all pages" : "Restore current page";
  forgetButton.disabled = busy || !fileId;
  if (!busy && restoreApplyFocus) {
    restoreApplyFocus = false;
    applyButton.focus();
  }
  if (!busy && restoreRestoreFocus) {
    restoreRestoreFocus = false;
    restoreButton.focus();
  }
}

function matchesCurrentChoice(choice) {
  return choice !== null && choice.language === languageSelect.value
    && choice.scope === scopeSelect.value && choice.translations === translations;
}

function parseDictionary(text) {
  if (typeof text !== "string") throw new Error("Invalid saved file.");
  if (text.length > MAX_BYTES || new TextEncoder().encode(text).length > MAX_BYTES) {
    throw new Error("Translation JSON exceeds the 1 MiB limit.");
  }
  return validateDictionary(JSON.parse(text.replace(/^\uFEFF/, "")));
}

function createLanguagePlaceholder() {
  const option = new Option("Choose a language", "");
  option.disabled = true;
  return option;
}

function useDictionary(text, name, language = "") {
  if (typeof name !== "string" || !name.length || name.length > 1024) {
    throw new Error("Invalid saved filename.");
  }
  const data = parseDictionary(text);
  const options = [createLanguagePlaceholder()];
  for (const language of Object.keys(data)) {
    const baseLanguage = language.split("-")[0].toUpperCase();
    const label = Object.prototype.hasOwnProperty.call(languageNames, baseLanguage)
      ? `${languageNames[baseLanguage]} (${language})` : language;
    options.push(new Option(label, language));
  }
  languageSelect.replaceChildren(...options);
  languageSelect.value = Object.prototype.hasOwnProperty.call(data, language) ? language : "";
  translations = data;
  activeImport = { version: 1, name, text, language: languageSelect.value };
  source.textContent = `Source: ${name}`;
  chooseFileButton.textContent = "Replace or reload JSON…";
  setStatus("Translations loaded. Choose the scope, then select a language to update the design.");
}

function showStorageError(action, message) {
  rememberStatus.textContent = `${message} ${action === "save"
    ? "Current translations remain usable; an older saved copy may remain."
    : action === "forget" ? "The saved copy was not cleared."
    : fileId ? "You can import a JSON file to continue."
    : "Reopen the plugin before applying translations."}`;
}

function requestDesignContext() {
  return new Promise((resolve, reject) => {
    const requestId = ++contextRequestId;
    pendingContext = { requestId, resolve, reject };
    try {
      parent.postMessage({ type: "design-context-request", requestId }, "*");
    } catch (error) {
      pendingContext = null;
      reject(new Error("Cannot capture the current design page."));
    }
  });
}

function receiveDesignContext(result) {
  if (!pendingContext || result.requestId !== pendingContext.requestId) return;
  const request = pendingContext;
  pendingContext = null;
  if (result.ok !== true || typeof result.fileId !== "string"
      || !result.fileId.length || result.fileId.length > 200
      || typeof result.pageId !== "string"
      || !result.pageId.length || result.pageId.length > 200) {
    request.reject(new Error("Cannot capture the current design page."));
    return;
  }
  request.resolve({ fileId: result.fileId, pageId: result.pageId });
}

function requestStorage(action) {
  const requestId = ++storageRequestId;
  pendingStorage = { requestId, action };
  rememberStatus.textContent = action === "save" ? "Saving for this design file…"
    : action === "forget" ? "Forgetting saved file…" : "Loading saved file…";
  let sent = false;
  try {
    parent.postMessage({
      type: "saved-import-request", requestId, action, fileId,
      ...(action === "save" ? { record: activeImport } : {})
    }, "*");
    sent = true;
  } catch (error) {
    pendingStorage = null;
    showStorageError(action, "Cannot send saved file request.");
  } finally {
    if (!sent && action !== "save") setLoading(false);
  }
}

function receiveSavedImport(result) {
  if (!pendingStorage || result.requestId !== pendingStorage.requestId
      || result.action !== pendingStorage.action) return;
  const action = pendingStorage.action;
  pendingStorage = null;
  try {
    if (typeof result.ok !== "boolean" || typeof result.fileId !== "string"
        || !result.fileId.length || result.fileId.length > 200
        || (action !== "load" && result.fileId !== fileId)) {
      throw new Error("Open the intended design file and reopen the plugin.");
    }
    if (action === "load") fileId = result.fileId;
    if (!result.ok) throw new Error("Saved file storage is unavailable or contains invalid data.");
    if (action === "load") {
      if (result.record !== null) {
        const record = result.record;
        if (!record || typeof record !== "object" || Array.isArray(record)
            || Object.keys(record).length !== 4 || record.version !== 1
            || typeof record.language !== "string" || record.language.length > 35) {
          throw new Error("Invalid saved file. Import a JSON file or forget the saved copy.");
        }
        // Validate every saved field before replacing the active import.
        const data = parseDictionary(record.text);
        if (record.language && !Object.prototype.hasOwnProperty.call(data, record.language)) {
          throw new Error("Saved language is missing. Reimport the JSON file.");
        }
        useDictionary(record.text, record.name, record.language);
        source.textContent = `Source: ${record.name} (saved copy)`;
        setStatus("Saved translations loaded without applying. Review the scope, then change language or use the apply button.");
      }
    } else if (action === "forget") {
      translations = null;
      activeImport = null;
      failedApply = null;
      fileInput.value = "";
      languageSelect.replaceChildren(createLanguagePlaceholder());
      languageSelect.value = "";
      source.textContent = "Source: no file selected";
      chooseFileButton.textContent = "Choose JSON file…";
      setStatus("Saved file forgotten. Choose a translation JSON file to get started. Design text is unchanged.");
    }
    rememberStatus.textContent = action === "forget" || (action === "load" && result.record === null)
      ? "No saved file for this design file." : "Saved for this design file in this browser. Never uploaded.";
  } catch (error) {
    showStorageError(action, error.message);
  } finally {
    if (action !== "save") setLoading(false);
    if (action === "load" && fileId) {
      requestRecoveryStatus();
    }
  }
}

function requestRecoveryStatus() {
  if (!fileId) return;
  pendingRecovery = { requestId: ++recoveryRequestId, scope: scopeSelect.value };
  updateControls();
  try {
    parent.postMessage({
      type: "recovery-status-request",
      requestId: pendingRecovery.requestId,
      fileId,
      scope: pendingRecovery.scope
    }, "*");
  } catch (error) {
    pendingRecovery = null;
    directionContext = null;
    directionSelect.value = "";
    updateControls();
  }
}

function receiveRecoveryStatus(result) {
  if (!pendingRecovery || result.requestId !== pendingRecovery.requestId) return;
  const request = pendingRecovery;
  pendingRecovery = null;
  if (request.scope === scopeSelect.value && result.ok === true
      && typeof result.restoreAvailable === "boolean"
      && typeof result.layoutStateComplete === "boolean"
      && ["ltr", "rtl", "mixed", "unknown"].includes(result.direction)
      && typeof result.pageId === "string"
      && result.pageId.length > 0 && result.pageId.length <= 200) {
    restoreAvailable = result.restoreAvailable;
    if (request.scope === "page" && directionContext?.pageId !== result.pageId) {
      directionSelect.value = "";
    }
    directionContext = { direction: result.direction, pageId: result.pageId,
      incomplete: !result.layoutStateComplete };
    if (reverseDirection()) directionSelect.value = "";
  } else {
    directionContext = null;
    directionSelect.value = "";
  }
  updateControls();
}

async function importTranslations() {
  const file = fileInput.files[0];
  if (!file || loading || pendingApply || pendingRestore) return;
  pendingStorage = null;
  setLoading(true);
  setStatus("Checking the current design page…");
  let imported = false;
  let importContext = null;
  try {
    if (file.size > MAX_BYTES) throw new Error("Translation JSON exceeds the 1 MiB limit.");
    importContext = await requestDesignContext();
    if (fileId && importContext.fileId !== fileId) {
      throw new Error("Design file changed. Reopen the plugin before importing translations.");
    }
    setStatus("Reading translation file…");
    const bytes = await file.arrayBuffer();
    if (bytes.byteLength > MAX_BYTES) throw new Error("Translation JSON exceeds the 1 MiB limit.");
    let text;
    try {
      // Preserve the initial BOM in the saved copy; parsing handles it.
      text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
    } catch (error) {
      throw new Error("Translation JSON must use valid UTF-8.");
    }
    useDictionary(text, file.name, languageSelect.value);
    requestStorage("save");
    imported = true;
  } catch (error) {
    // Allow retrying the same file after a failed import.
    fileInput.value = "";
    setStatus(`Cannot import translations: ${error.message}. ${translations ? "Previous translations are still available." : "Choose another JSON file to continue."}`, true);
  } finally {
    setLoading(false);
  }
  if (imported) applyLanguage(importContext && importContext.pageId);
}

function applyLanguage(pageId = null) {
  if (loading || pendingApply || pendingRestore
      || !translations || !languageSelect.value || !fileId) return;
  sendApply({ type: "apply-language", language: languageSelect.value,
    translations, ...(pageId ? { pageId } : {}) });
}

function switchDirection() {
  if (directionButton.disabled || !directionContext) return;
  const direction = reverseDirection() || directionSelect.value;
  if (direction !== "ltr" && direction !== "rtl") return;
  restoreDirectionFocus = document.activeElement === directionButton;
  directionSelect.value = direction;
  sendApply({ type: "switch-direction", direction,
    ...(scopeSelect.value === "page" ? { pageId: directionContext.pageId } : {}) });
}

function sendApply(request) {
  pendingRecovery = null;
  pendingApply = { ...request, requestId: ++applyRequestId, fileId, scope: scopeSelect.value };
  updateControls();
  setStatus(request.direction ? `Switching text and layout to ${request.direction.toUpperCase()}…`
    : `Applying ${request.language}…`);
  try {
    parent.postMessage(pendingApply, "*");
  } catch (error) {
    if (!request.direction) failedApply = pendingApply;
    setStatus(request.direction ? "Cannot send direction request. Try again."
      : "Cannot send localization request. Try again.", true);
    pendingApply = null;
    updateControls();
  }
}

function receiveLocalizationResult(result) {
  if (!pendingApply || result.requestId !== pendingApply.requestId) return;
  const direction = pendingApply.direction;
  if (result.type !== (direction ? "direction-result" : "localization-result")) return;
  try {
    if (typeof result.ok !== "boolean") throw new Error("Invalid localization result. Check the design before retrying.");
    if (!result.ok) {
      if (!direction) failedApply = pendingApply;
      setStatus(typeof result.error === "string" ? result.error : "Localization failed.", true);
      return;
    }
    const counts = [
      result.changed,
      result.pageCount,
      result.alreadyCorrect,
      result.tagged,
      result.skipped,
      result.failed,
      result.failedPages,
      result.conflicts,
      result.styled,
      result.mirrored,
      result.layoutSkipped,
      result.layoutUnsupported,
      result.layoutSubtreesSkipped,
      result.styleConflicts,
      result.styleMetadataConflicts,
      result.layoutConflicts,
      result.layoutMetadataConflicts,
      result.styleFailed,
      result.styleUnsupported,
      result.layoutFailed
    ];
    if ((direction ? result.direction !== direction : result.language !== pendingApply.language)
        || counts.some(count => !Number.isSafeInteger(count) || count < 0)
        || result.layoutUnsupported + result.layoutSubtreesSkipped !== result.layoutSkipped
        || result.styleMetadataConflicts > result.styleConflicts
        || result.layoutMetadataConflicts > result.layoutConflicts
        || result.styleFailed + result.layoutFailed > result.failed
        || !validLayoutFailureReasons(result.layoutFailureReasons, result.layoutFailed)
        || !Array.isArray(result.missing) || result.missing.some(key => typeof key !== "string")
        || typeof result.rtl !== "boolean"
        || typeof result.layoutMirrored !== "boolean"
        || typeof result.layoutStateComplete !== "boolean"
        || typeof result.historyFailed !== "boolean"
        || typeof result.restoreAvailable !== "boolean") {
      throw new Error("Invalid localization result. Check the design before retrying.");
    }
    restoreAvailable = result.restoreAvailable;
    const parts = direction ? [
      `${direction.toUpperCase()} requested across ${result.pageCount} page(s).`,
      `${result.styled} text layer(s) and ${result.mirrored} layout shape(s) updated.`
    ] : [
      `${result.language}: updated ${result.changed} text layer(s) across ${result.pageCount} page(s).`,
      `${result.alreadyCorrect} already matched; ${result.tagged} tagged layer(s) found.`
    ];
    if (result.missing.length) parts.push(`Missing translation keys: ${result.missing.join(", ")}`);
    if (result.skipped) parts.push(direction
      ? `${result.skipped} layer(s) with mixed direction or alignment were skipped.`
      : `${result.skipped} mixed-style layer(s) skipped to preserve formatting.`);
    if (!direction && result.styled) parts.push(`${result.styled} text layer(s) had RTL direction or alignment updated.`);
    if (result.styleUnsupported) parts.push(`${result.styleUnsupported} text layer(s) kept their unset direction so their original style can be preserved.`);
    if (result.layoutSubtreesSkipped) parts.push(`${result.layoutSubtreesSkipped} component/grid layout subtree(s) were left unchanged.`);
    if (result.layoutUnsupported) parts.push(`${result.layoutUnsupported} unsupported layout target(s) were left unchanged.`);
    if (result.styleMetadataConflicts) parts.push(`${result.styleMetadataConflicts} unreadable RTL text-style metadata record(s) were left unchanged.`);
    if (result.layoutMetadataConflicts) parts.push(`${result.layoutMetadataConflicts} unreadable RTL layout metadata record(s) were left unchanged.`);
    const externalStyleConflicts = result.styleConflicts - result.styleMetadataConflicts;
    const externalLayoutConflicts = result.layoutConflicts - result.layoutMetadataConflicts;
    if (externalStyleConflicts) parts.push(`${externalStyleConflicts} externally changed text style(s) were left unchanged.`);
    if (externalLayoutConflicts) parts.push(`${externalLayoutConflicts} externally changed layout shape(s) were left unchanged.`);
    if (result.styleFailed) parts.push(`${result.styleFailed} RTL text-style property update(s) failed.`);
    if (result.layoutFailed) parts.push(`${result.layoutFailed} layout property update(s) failed: ${formatLayoutFailureReasons(result.layoutFailureReasons)}.`);
    const otherFailed = result.failed - result.styleFailed - result.layoutFailed;
    if (otherFailed) parts.push(`${otherFailed} other layer or operation update(s) failed.`);
    if (result.failedPages) parts.push(`${result.failedPages} page(s) could not be processed.`);
    if (result.conflicts) parts.push(`${result.conflicts} layer(s) changed while the operation was being prepared and were left unchanged.`);
    if (result.historyFailed) parts.push("Penpot could not finish the grouped history block. Inspect undo history before continuing.");
    const blockingFailure = otherFailed > 0 || result.failedPages > 0
      || result.conflicts > 0 || result.historyFailed;
    const warning = result.skipped > 0 || result.layoutSkipped > 0
      || result.missing.length > 0 || result.styleConflicts > 0
      || result.layoutConflicts > 0 || result.styleFailed > 0 || result.styleUnsupported > 0
      || result.layoutFailed > 0;
    if (!direction) failedApply = blockingFailure ? pendingApply : null;
    setStatus(parts.join("\n"), blockingFailure ? "error" : warning ? "warning" : "normal");
  } catch (error) {
    if (!direction) failedApply = pendingApply;
    setStatus(error.message, true);
  } finally {
    pendingApply = null;
    requestRecoveryStatus();
  }
}

function restoreLocalization() {
  if (loading || pendingApply || pendingRestore || !fileId || !restoreAvailable) return;
  pendingRecovery = null;
  pendingRestore = { requestId: ++restoreRequestId, scope: scopeSelect.value };
  updateControls();
  setStatus("Restoring eligible text, RTL styles, and mirrored layout…");
  let sent = false;
  try {
    parent.postMessage({
      type: "restore-localization",
      requestId: pendingRestore.requestId,
      fileId,
      scope: pendingRestore.scope
    }, "*");
    sent = true;
  } catch (error) {
    setStatus("Cannot send restore request. Try again.", true);
  } finally {
    if (!sent) {
      pendingRestore = null;
      updateControls();
    }
  }
}

function receiveRestoreResult(result) {
  if (!pendingRestore || result.requestId !== pendingRestore.requestId) return;
  try {
    if (typeof result.ok !== "boolean") {
      throw new Error("Invalid restore result. Check the design before retrying.");
    }
    if (!result.ok) {
      setStatus(typeof result.error === "string" ? result.error : "Restore failed.", true);
      return;
    }
    const counts = [result.pageCount, result.failedPages, result.targeted,
      result.restored, result.skipped,
      result.conflicts, result.missingTargets, result.failed, result.stylesRestored,
      result.layoutsRestored, result.layoutSkipped, result.styleConflicts,
      result.layoutConflicts, result.layoutUnsupported, result.layoutSubtreesSkipped,
      result.styleMetadataConflicts, result.layoutMetadataConflicts,
      result.metadataConflicts, result.styleFailed, result.layoutFailed];
    if (counts.some(count => !Number.isSafeInteger(count) || count < 0)
        || result.layoutUnsupported + result.layoutSubtreesSkipped !== result.layoutSkipped
        || result.styleMetadataConflicts > result.styleConflicts
        || result.layoutMetadataConflicts > result.layoutConflicts
        || result.styleFailed + result.layoutFailed > result.failed
        || !validLayoutFailureReasons(result.layoutFailureReasons, result.layoutFailed)
        || typeof result.layoutMirrored !== "boolean"
        || typeof result.layoutStateComplete !== "boolean"
        || typeof result.historyFailed !== "boolean"
        || typeof result.restoreAvailable !== "boolean") {
      throw new Error("Invalid restore result. Check the design before retrying.");
    }
    restoreAvailable = result.restoreAvailable;
    const parts = [
      `Restored ${result.restored} text layer(s) across ${result.pageCount} page(s).`,
      `${result.targeted} session recovery target(s) found.`
    ];
    if (result.stylesRestored) parts.push(`Restored RTL styling on ${result.stylesRestored} text layer(s).`);
    if (result.layoutsRestored) parts.push(`Restored ${result.layoutsRestored} mirrored layout shape(s).`);
    if (result.failedPages) parts.push(`${result.failedPages} page(s) could not be processed.`);
    if (result.layoutSubtreesSkipped) parts.push(`${result.layoutSubtreesSkipped} component/grid layout subtree(s) were left unchanged.`);
    if (result.layoutUnsupported) parts.push(`${result.layoutUnsupported} unsupported layout target(s) were left unchanged.`);
    if (result.styleMetadataConflicts) parts.push(`${result.styleMetadataConflicts} unreadable RTL text-style metadata record(s) were left unchanged.`);
    if (result.layoutMetadataConflicts) parts.push(`${result.layoutMetadataConflicts} unreadable RTL layout metadata record(s) were left unchanged.`);
    if (result.metadataConflicts) parts.push(`${result.metadataConflicts} unreadable RTL recovery metadata record(s) were left unchanged.`);
    const externalStyleConflicts = result.styleConflicts - result.styleMetadataConflicts;
    const externalLayoutConflicts = result.layoutConflicts - result.layoutMetadataConflicts;
    if (externalStyleConflicts) parts.push(`${externalStyleConflicts} externally changed text style(s) left unchanged.`);
    if (externalLayoutConflicts) parts.push(`${externalLayoutConflicts} externally changed layout shape(s) left unchanged.`);
    if (result.conflicts) parts.push(`${result.conflicts} externally changed layer(s) left unchanged.`);
    if (result.missingTargets) parts.push(`${result.missingTargets} recovery target(s) could not be restored because the corresponding layer(s) were deleted outside the plugin or otherwise missing.`);
    if (result.skipped) parts.push(`${result.skipped} mixed-style layer(s) skipped to preserve formatting.`);
    if (result.styleFailed) parts.push(`${result.styleFailed} RTL text-style property restore(s) failed.`);
    if (result.layoutFailed) parts.push(`${result.layoutFailed} layout property restore(s) failed: ${formatLayoutFailureReasons(result.layoutFailureReasons)}.`);
    const otherFailed = result.failed - result.styleFailed - result.layoutFailed;
    if (otherFailed) parts.push(`${otherFailed} other layer or operation restore(s) failed.`);
    if (result.historyFailed) parts.push("Penpot could not finish the grouped history block. Inspect undo history before continuing.");
    const warning = result.conflicts > 0 || result.styleConflicts > 0
      || result.layoutConflicts > 0 || result.missingTargets > 0
      || result.skipped > 0 || result.layoutSkipped > 0
      || result.metadataConflicts > 0 || result.styleFailed > 0
      || result.layoutFailed > 0;
    const blockingFailure = otherFailed > 0 || result.failedPages > 0
      || result.historyFailed;
    setStatus(parts.join("\n"), blockingFailure ? "error" : warning ? "warning" : "normal");
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    pendingRestore = null;
    requestRecoveryStatus();
  }
}

languageSelect.addEventListener("change", () => {
  if (loading || pendingApply || pendingRestore || !activeImport) return;
  activeImport = { ...activeImport, language: languageSelect.value };
  updateControls();
  requestStorage("save");
  if (languageSelect.value) applyLanguage();
  else setStatus("Choose a language to update the design.");
});
applyButton.addEventListener("click", () => {
  if (applyButton.disabled) return;
  restoreApplyFocus = document.activeElement === applyButton;
  applyLanguage();
});
restoreButton.addEventListener("click", () => {
  if (restoreButton.disabled) return;
  restoreRestoreFocus = document.activeElement === restoreButton;
  restoreLocalization();
});
directionSelect.addEventListener("change", updateControls);
directionButton.addEventListener("click", switchDirection);
forgetButton.addEventListener("click", () => {
  if (loading || pendingApply || pendingRestore || !fileId) return;
  setLoading(true);
  requestStorage("forget");
});
scopeSelect.addEventListener("change", () => {
  if (loading || pendingApply || pendingRestore) return;
  directionContext = null;
  directionSelect.value = "";
  requestRecoveryStatus();
  if (!translations) return;
  if (!languageSelect.value) setStatus("Scope changed. Select a language to update the design.");
  else setStatus("Scope changed. Apply the selected language to this scope.");
});
chooseFileButton.addEventListener("click", () => {
  if (loading || pendingApply || pendingRestore) return;
  // The active filename is shown separately, so allow reselecting the same file.
  fileInput.value = "";
  fileInput.click();
});
fileInput.addEventListener("change", importTranslations);

window.addEventListener("message", (event) => {
  if (event.source !== window.parent) return;
  const result = event.data;
  if (result && result.type === "saved-import-result") {
    receiveSavedImport(result);
    return;
  }
  if (result && result.type === "design-context-result") {
    receiveDesignContext(result);
    return;
  }
  if (result && result.type === "recovery-status-result") {
    receiveRecoveryStatus(result);
    return;
  }
  if (result && result.type === "restore-result") {
    receiveRestoreResult(result);
    return;
  }
  if (result?.type === "design-context-changed") {
    requestRecoveryStatus();
  } else if (result?.type === "localization-result" || result?.type === "direction-result") {
    receiveLocalizationResult(result);
  }
});

setLoading(true);
requestStorage("load");
