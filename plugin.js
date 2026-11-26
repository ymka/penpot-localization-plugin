/*
 * Penpot-side plugin entry point.
 * Only this script accesses the Penpot API.
 * Text layers to localize must be named i18n.<translation-key>.
 */

penpot.ui.open("Penpot Localization", "index.html", { width: 360, height: 700 });

const MAX_BYTES = 1024 * 1024;
const STORAGE_PREFIX = "localization.saved-import.v1:";
const RTL_METADATA_KEY = "localization.rtl.v1";
const PAGE_DIRECTION_KEY = "localization.page-direction.v1";
const RTL_BASE_LANGUAGES = new Set([
  "ar", "ckb", "dv", "fa", "he", "ps", "sd", "ug", "ur", "yi"
]);
const RTL_SCRIPT_SUBTAGS = new Set([
  "adlm", "arab", "hebr", "mand", "nkoo", "rohg", "syrc", "thaa"
]);
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
const LAYOUT_FAILURE_REASONS = [
  "alignment", "constraints", "flexDirection", "margins",
  "metadata", "padding", "position", "target"
];
const recoveryJournal = new Map();

function isDirection(value) {
  return value === "ltr" || value === "rtl";
}

function oppositeDirection(direction) {
  return direction === "rtl" ? "ltr" : "rtl";
}

function isRtlLanguage(language) {
  const subtags = language.toLowerCase().split("-");
  return RTL_BASE_LANGUAGES.has(subtags[0])
    || subtags.slice(1).some(subtag => RTL_SCRIPT_SUBTAGS.has(subtag));
}

function swapHorizontal(value) {
  if (value === "left") return "right";
  if (value === "right") return "left";
  if (value === "start") return "end";
  if (value === "end") return "start";
  if (value === "row") return "row-reverse";
  if (value === "row-reverse") return "row";
  return value;
}

function sameRecord(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function isPlainRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function validManagedValue(field, value) {
  if (field === "x" || ["leftMargin", "rightMargin"].includes(field)) {
    return Number.isFinite(value);
  }
  if (["flexLeftPadding", "flexRightPadding"].includes(field)) {
    return Number.isFinite(value) && value >= 0;
  }
  if (field === "direction") return [null, "ltr", "rtl"].includes(value);
  if (field === "align") {
    return [null, "left", "right", "center", "justify"].includes(value);
  }
  if (field === "constraintsHorizontal") {
    return ["center", "left", "right", "leftright", "scale"].includes(value);
  }
  if (field === "flexDir") {
    return ["row", "row-reverse", "column", "column-reverse"].includes(value);
  }
  if (field === "flexAlignItems") {
    return ["start", "end", "center", "stretch"].includes(value);
  }
  if (field === "alignSelf") {
    return ["start", "end", "center", "auto", "stretch"].includes(value);
  }
  return false;
}

function validateMetadataSection(section, name) {
  if (!isPlainRecord(section)
      || !["baseline", "rtl", "ltr", "pending-baseline", "pending-rtl", "pending-ltr"].includes(section.active)
      || !isPlainRecord(section.baseline) || !isPlainRecord(section.rtlTarget)
      || !isPlainRecord(section.lastWritten)
      || Object.keys(section).some(key => !["active", "baseline", "rtlTarget", "lastWritten",
        ...(name === "layout" ? ["baselineDirection"] : ["ltrTarget"])].includes(key))
      || (section.baselineDirection !== undefined && !isDirection(section.baselineDirection))
      || (section.ltrTarget !== undefined && !isPlainRecord(section.ltrTarget))
      || (["ltr", "pending-ltr"].includes(section.active) && !section.ltrTarget)) {
    throw new Error("Invalid RTL metadata.");
  }
  const allowed = name === "textStyle" ? ["align", "direction"] : [
    "alignSelf", "constraintsHorizontal", "flexAlignItems", "flexDir",
    "flexLeftPadding", "flexRightPadding", "leftMargin", "rightMargin", "x"
  ];
  const baselineKeys = Object.keys(section.baseline).sort();
  if (!baselineKeys.length || baselineKeys.some(key => !allowed.includes(key))) {
    throw new Error("Invalid RTL metadata.");
  }
  for (const values of [section.baseline, section.rtlTarget, section.lastWritten,
    ...(section.ltrTarget ? [section.ltrTarget] : [])]) {
    const keys = Object.keys(values).sort();
    if (!sameRecord(keys, baselineKeys)
        || keys.some(key => !validManagedValue(key, values[key]))) {
      throw new Error("Invalid RTL metadata.");
    }
  }
}

function readRtlMetadata(shape) {
  if (!shape || typeof shape.getPluginData !== "function") return null;
  const value = shape.getPluginData(RTL_METADATA_KEY);
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string" || value.length > 8192) {
    throw new Error("Invalid RTL metadata.");
  }
  const record = JSON.parse(value);
  if (!isPlainRecord(record) || record.version !== 1
      || Object.keys(record).some(key => !["version", "textStyle", "layout"].includes(key))) {
    throw new Error("Invalid RTL metadata.");
  }
  if (Object.prototype.hasOwnProperty.call(record, "textStyle")) {
    validateMetadataSection(record.textStyle, "textStyle");
  }
  if (Object.prototype.hasOwnProperty.call(record, "layout")) {
    validateMetadataSection(record.layout, "layout");
  }
  return record;
}

function inspectRtlMetadata(shape) {
  try {
    return { metadata: readRtlMetadata(shape), invalid: false };
  } catch (error) {
    return { metadata: null, invalid: true };
  }
}

function writeRtlMetadata(shape, section, value) {
  if (!shape || typeof shape.getPluginData !== "function"
      || typeof shape.setPluginData !== "function") {
    throw new Error("RTL metadata is unavailable.");
  }
  validateMetadataSection(value, section);
  const current = readRtlMetadata(shape) || { version: 1 };
  current[section] = value;
  shape.setPluginData(RTL_METADATA_KEY, JSON.stringify(current));
}

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
    throw new Error(message.type === "switch-direction"
      ? "Page changed. Review the scope and try again."
      : "Page changed while reading translations. Review the scope and apply again.");
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

function planManagedSection(shape, sectionName, current, rtlTarget, active, baselineDirection) {
  const metadata = readRtlMetadata(shape);
  let section = metadata && metadata[sectionName];
  if (!section || !sameRecord(current, section.baseline)
      && !sameRecord(current, section.lastWritten)) {
    if (!section && active === "baseline") return { operation: null, conflict: false };
    const pendingTransition = section && section.active.startsWith("pending-")
      && Object.keys(section.baseline).every(key => current[key] === section.baseline[key]
        || current[key] === section.rtlTarget[key]
        || (section.ltrTarget && current[key] === section.ltrTarget[key]));
    if (section && section.active !== "baseline" && !pendingTransition) {
      return { operation: null, conflict: true };
    }
    if (!pendingTransition) {
      baselineDirection = section ? section.baselineDirection : baselineDirection;
      section = { active: "baseline", baseline: current, rtlTarget, lastWritten: current };
      if (baselineDirection) section.baselineDirection = baselineDirection;
    }
  }
  // Layout records keep the original rtlTarget key for the mirrored geometry in either direction.
  let refreshedRtlTarget = section.rtlTarget;
  if (sectionName === "layout" && active === "rtl" && sameRecord(current, section.baseline)) {
    refreshedRtlTarget = rtlTarget;
  } else if (sectionName === "layout" && active === "rtl" && section.active === "rtl"
      && sameRecord(current, section.lastWritten)
      && Object.prototype.hasOwnProperty.call(current, "x")
      && Object.prototype.hasOwnProperty.call(rtlTarget, "x")) {
    refreshedRtlTarget = {
      ...section.rtlTarget,
      x: rtlTarget.x + current.x - section.baseline.x
    };
  }
  let ltrTarget = section.ltrTarget;
  if (sectionName === "textStyle" && active === "ltr" && !ltrTarget) {
    const { direction, align } = section.baseline;
    ltrTarget = { direction: "ltr", align: direction === "rtl" ? swapHorizontal(align) : align };
  }
  const target = active === "rtl" ? refreshedRtlTarget
    : active === "ltr" ? ltrTarget : section.baseline;
  const nextSection = {
    ...section,
    ...(ltrTarget ? { ltrTarget } : {}),
    active,
    baseline: section.baseline,
    rtlTarget: refreshedRtlTarget,
    lastWritten: target
  };
  const metadataChanged = !sameRecord(section, nextSection);
  if (!metadataChanged && sameRecord(current, target)) {
    return { operation: null, conflict: false };
  }
  return {
    operation: { current, target, metadata: nextSection },
    conflict: false
  };
}

function textStyleValues(layer) {
  if (![null, "ltr", "rtl"].includes(layer.direction)
      || ![null, "left", "right", "center", "justify"].includes(layer.align)) {
    throw new Error("Unsupported text direction or alignment.");
  }
  return { direction: layer.direction, align: layer.align };
}

function rtlTextStyle(values, explicit = false) {
  return { direction: "rtl", align: explicit && values.direction === "rtl"
    ? values.align : swapHorizontal(values.align) };
}

function addLayoutCandidate(candidates, pageId, shape, current, rtlTarget) {
  if (!isValidId(shape && shape.id)) return;
  let candidate = candidates.get(shape.id);
  if (!candidate) {
    candidate = { pageId, shape, current: {}, rtlTarget: {} };
    candidates.set(shape.id, candidate);
  }
  Object.assign(candidate.current, current);
  Object.assign(candidate.rtlTarget, rtlTarget);
}

function addManagedLayoutValue(current, rtlTarget, field, before, after) {
  if (!validManagedValue(field, before) || !validManagedValue(field, after)) return false;
  if (before !== after) {
    current[field] = before;
    rtlTarget[field] = after;
  }
  return true;
}

function recordLayoutSkip(result, type) {
  result.layoutSkipped += 1;
  if (type === "subtree") result.layoutSubtreesSkipped += 1;
  else result.layoutUnsupported += 1;
}

function recordPageFailure(result, pageId) {
  if (result.failedPageIds.has(pageId)) return;
  result.failedPageIds.add(pageId);
  result.failedPages += 1;
}

function layoutFailureReason(field) {
  if (["flexAlignItems", "alignSelf"].includes(field)) return "alignment";
  if (field === "constraintsHorizontal") return "constraints";
  if (field === "flexDir") return "flexDirection";
  if (["leftMargin", "rightMargin"].includes(field)) return "margins";
  if (["flexLeftPadding", "flexRightPadding"].includes(field)) return "padding";
  if (field === "x") return "position";
  if (field === "metadata") return "metadata";
  return "target";
}

function recordManagedFailure(plan, kind, field) {
  plan.failed += 1;
  if (kind === "style") {
    plan.styleFailed += 1;
    return;
  }
  plan.layoutFailed += 1;
  plan.layoutFailureReasons[layoutFailureReason(field)] += 1;
}

function isComponentManaged(shape) {
  return typeof shape.isComponentInstance === "function" && shape.isComponentInstance();
}

function collectMirroredLayout(pageId, shape, candidates, result) {
  if (!shape || isComponentManaged(shape)) {
    recordLayoutSkip(result, "subtree");
    return;
  }
  if (shape.grid) {
    recordLayoutSkip(result, "subtree");
    return;
  }
  const flex = shape.flex;
  if (flex) {
    const current = {};
    const rtlTarget = {};
    let unsupported = false;
    unsupported = !addManagedLayoutValue(current, rtlTarget, "flexDir",
      flex.dir, swapHorizontal(flex.dir)) || unsupported;
    const validPadding = validManagedValue("flexLeftPadding", flex.leftPadding)
      && validManagedValue("flexRightPadding", flex.rightPadding);
    if (validPadding) {
      addManagedLayoutValue(current, rtlTarget, "flexLeftPadding",
        flex.leftPadding, flex.rightPadding);
      addManagedLayoutValue(current, rtlTarget, "flexRightPadding",
        flex.rightPadding, flex.leftPadding);
    } else {
      unsupported = true;
    }
    if (flex.dir === "column" || flex.dir === "column-reverse") {
      unsupported = !addManagedLayoutValue(current, rtlTarget, "flexAlignItems",
        flex.alignItems, swapHorizontal(flex.alignItems)) || unsupported;
    }
    if (Object.keys(current).length) {
      addLayoutCandidate(candidates, pageId, shape, current, rtlTarget);
    }
    if (unsupported) {
      recordLayoutSkip(result, "unsupported");
    }
  }
  if (!Array.isArray(shape.children)) return;
  for (const child of shape.children) {
    if (!child || isComponentManaged(child)) {
      recordLayoutSkip(result, "subtree");
      continue;
    }
    if (child.grid) {
      recordLayoutSkip(result, "subtree");
      continue;
    }
    const current = {};
    const rtlTarget = {};
    const layoutChild = child.layoutChild;
    if (layoutChild && layoutChild.marginType === "multiple") {
      const validMargins = validManagedValue("leftMargin", layoutChild.leftMargin)
        && validManagedValue("rightMargin", layoutChild.rightMargin);
      if (validMargins) {
        addManagedLayoutValue(current, rtlTarget, "leftMargin",
          layoutChild.leftMargin, layoutChild.rightMargin);
        addManagedLayoutValue(current, rtlTarget, "rightMargin",
          layoutChild.rightMargin, layoutChild.leftMargin);
      } else {
        recordLayoutSkip(result, "unsupported");
      }
    }
    if (layoutChild && flex && (flex.dir === "column" || flex.dir === "column-reverse")) {
      if (!addManagedLayoutValue(current, rtlTarget, "alignSelf",
        layoutChild.alignSelf, swapHorizontal(layoutChild.alignSelf))) {
        recordLayoutSkip(result, "unsupported");
      }
    }
    const reflectPosition = !flex || (layoutChild && layoutChild.absolute === true);
    if (reflectPosition) {
      if (![child.x, child.width, shape.x, shape.width].every(Number.isFinite)) {
        throw new Error("Invalid layout geometry.");
      }
      addManagedLayoutValue(current, rtlTarget, "x", child.x,
        shape.x + shape.width - (child.x - shape.x) - child.width);
      if (!addManagedLayoutValue(current, rtlTarget, "constraintsHorizontal",
        child.constraintsHorizontal, swapHorizontal(child.constraintsHorizontal))) {
        recordLayoutSkip(result, "unsupported");
      }
    }
    if (Object.keys(current).length) {
      addLayoutCandidate(candidates, pageId, child, current, rtlTarget);
    }
    collectMirroredLayout(pageId, child, candidates, result);
  }
}

function allPageShapes(page) {
  const shapes = page.findShapes();
  if (!Array.isArray(shapes)) throw new Error("Invalid shape result.");
  return shapes;
}

function readPageDirection(page) {
  if (typeof page.getPluginData !== "function") return "";
  const value = page.getPluginData(PAGE_DIRECTION_KEY);
  if (value === null || value === undefined || value === "" || value === "auto") return "";
  if (!isDirection(value)) throw new Error("Invalid saved page direction.");
  return value;
}

function inferDirection(values) {
  const directions = new Set(values);
  if (directions.has("mixed") || directions.has("ltr") && directions.has("rtl")) return "mixed";
  if (directions.size === 1) {
    const [direction] = directions;
    if (isDirection(direction)) return direction;
  }
  return "unknown";
}

function inferLayoutDirection(layers, shapes) {
  const managedDirections = new Set();
  for (const shape of shapes) {
    const section = inspectRtlMetadata(shape).metadata?.layout;
    if (section?.active === "rtl") {
      managedDirections.add(oppositeDirection(section.baselineDirection || "ltr"));
    }
  }
  if (managedDirections.size) return inferDirection(managedDirections);
  return inferDirection(layers.map(layer => {
    try {
      const direction = layer.direction;
      const previous = inspectRtlMetadata(layer).metadata?.textStyle;
      // Language Apply can change the text on a page without mirroring its layout.
      return previous?.active === "rtl" && direction === previous.lastWritten.direction
        ? previous.baseline.direction : direction;
    } catch (error) {
      return "unknown";
    }
  }));
}

function inspectActiveRtlMetadata(context, includeDirection = false) {
  let restoreAvailable = false;
  let layoutMirrored = false;
  let complete = true;
  const directions = [];
  for (const page of context.pages) {
    let shapes;
    let remembered;
    try {
      remembered = readPageDirection(page.proxy);
      if (remembered) restoreAvailable = true;
    } catch (error) {
      complete = false;
    }
    try {
      shapes = allPageShapes(page.proxy);
    } catch (error) {
      complete = false;
      directions.push(remembered || "unknown");
      continue;
    }
    if (includeDirection) {
      let direction = remembered || "unknown";
      if (remembered === "") {
        try {
          const layers = page.proxy.findShapes({ type: "text" });
          const text = inferDirection(layers.map(layer => layer.direction));
          direction = inferDirection([text, inferLayoutDirection(layers, shapes)]);
        } catch (error) {
          // Keep the direction unknown when the host cannot inspect the page.
        }
      }
      directions.push(direction);
    }
    for (const shape of shapes) {
      const { metadata } = inspectRtlMetadata(shape);
      if (!metadata) continue;
      if (metadata.textStyle && metadata.textStyle.active !== "baseline") {
        restoreAvailable = true;
      }
      if (metadata.layout && metadata.layout.active !== "baseline") {
        restoreAvailable = true;
        if (metadata.layout.active === "rtl") layoutMirrored = true;
        if (metadata.layout.active.startsWith("pending-")) complete = false;
      }
    }
  }
  return { restoreAvailable, layoutMirrored, complete, direction: inferDirection(directions) };
}

function handleRecoveryStatus(message) {
  const replyType = "recovery-status-result";
  try {
    const context = captureContext(message);
    const state = inspectActiveRtlMetadata(context, true);
    penpot.ui.sendMessage({
      type: replyType,
      requestId: message.requestId,
      ok: true,
      restoreAvailable: hasRecovery(context.fileId) || state.restoreAvailable,
      layoutMirrored: state.layoutMirrored,
      layoutStateComplete: state.complete,
      direction: state.direction,
      pageId: context.currentPageId
    });
  } catch (error) {
    sendOperationError(replyType,
      error instanceof Error ? error.message : "Cannot inspect recovery state.",
      message.requestId);
  }
}

function planLayout(page, direction, sourceDirection, result) {
  const candidates = new Map();
  try {
    const boards = page.proxy.findShapes({ type: "board" });
    if (!Array.isArray(boards)) throw new Error("Invalid shape result.");
    for (const board of boards) {
      if (board && board.parent && page.proxy.root
          && board.parent.id === page.proxy.root.id) {
        collectMirroredLayout(page.id, board, candidates, result);
      }
    }
  } catch (error) {
    recordPageFailure(result, page.id);
    console.error("Cannot inspect page layout.");
  }
  for (const candidate of candidates.values()) {
    try {
      const { metadata, invalid } = inspectRtlMetadata(candidate.shape);
      if (invalid) {
        result.layoutConflicts += 1;
        result.layoutMetadataConflicts += 1;
        continue;
      }
      const section = metadata?.layout;
      const baselineDirection = section ? section.baselineDirection || "ltr" : sourceDirection;
      const active = direction === baselineDirection ? "baseline" : "rtl";
      const current = section && active === "baseline"
        ? managedValues(candidate.shape, section.lastWritten, "layout") : candidate.current;
      const planned = planManagedSection(candidate.shape, "layout", current,
        candidate.rtlTarget, active, baselineDirection === "rtl" ? baselineDirection : undefined);
      if (planned.conflict) {
        result.layoutConflicts += 1;
      } else if (planned.operation) {
        result.layoutOperations.push({
          pageId: page.id,
          shapeId: candidate.shape.id,
          ...planned.operation
        });
      }
    } catch (error) {
      result.failed += 1;
      console.error("Cannot plan directional layout.");
    }
  }
}

function planPageDirection(page, layers, direction, result) {
  const previous = readPageDirection(page.proxy);
  if (typeof page.proxy.getPluginData !== "function"
      || typeof page.proxy.setPluginData !== "function") {
    throw new Error("Page direction storage is unavailable.");
  }
  const inferred = previous || inferLayoutDirection(layers, allPageShapes(page.proxy));
  const source = isDirection(inferred) ? inferred : oppositeDirection(direction);
  if (previous !== direction) result.pageOperations.push({ pageId: page.id, previous, direction });
  planLayout(page, direction, source, result);
}

function planApply(context, strings, language, direction = null) {
  const rtl = direction ? direction === "rtl" : isRtlLanguage(language);
  const result = {
    pageCount: context.pages.length,
    rtl,
    tagged: 0,
    alreadyCorrect: 0,
    skipped: 0,
    failed: 0,
    failedPages: 0,
    failedPageIds: new Set(),
    styleConflicts: 0,
    styleMetadataConflicts: 0,
    layoutConflicts: 0,
    layoutMetadataConflicts: 0,
    layoutSkipped: 0,
    layoutUnsupported: 0,
    layoutSubtreesSkipped: 0,
    styleFailed: 0,
    layoutFailed: 0,
    layoutFailureReasons: Object.fromEntries(LAYOUT_FAILURE_REASONS.map(reason => [reason, 0])),
    missing: new Set(),
    operations: [],
    styleOperations: [],
    layoutOperations: [],
    pageOperations: []
  };
  for (const page of context.pages) {
    let textLayers;
    let keepPageDirection;
    try {
      textLayers = page.proxy.findShapes({ type: "text" });
      if (!Array.isArray(textLayers)) throw new Error("Invalid shape result.");
      if (direction) {
        planPageDirection(page, textLayers, direction, result);
      } else {
        try {
          keepPageDirection = Boolean(readPageDirection(page.proxy));
        } catch (error) {
          keepPageDirection = true;
          result.styleConflicts += 1;
          result.styleMetadataConflicts += 1;
        }
      }
    } catch (error) {
      recordPageFailure(result, page.id);
      console.error("Cannot inspect a page.");
      continue;
    }
    for (const layer of textLayers) {
      if (direction) {
        planTextDirection(page.id, layer, direction, result);
        continue;
      }
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
        const inspected = inspectRtlMetadata(layer);
        const metadata = inspected.metadata;
        const managesStyle = !keepPageDirection && (rtl || Boolean(metadata && metadata.textStyle
          && metadata.textStyle.active !== "baseline"));
        if (!isValidId(layer.id)) {
          result.failed += 1;
        } else if ((before !== after || managesStyle) && hasMixedTextStyle(layer)) {
          result.skipped += 1;
        } else {
          if (before === after) result.alreadyCorrect += 1;
          else result.operations.push({
            fileId: context.fileId, pageId: page.id, shapeId: layer.id, before, after
          });
          if (inspected.invalid) {
            result.styleConflicts += 1;
            result.styleMetadataConflicts += 1;
          } else if (managesStyle) {
            const current = textStyleValues(layer);
            const planned = planManagedSection(layer, "textStyle", current,
              rtlTextStyle(current), rtl ? "rtl" : "baseline");
            if (planned.conflict) result.styleConflicts += 1;
            else if (planned.operation) result.styleOperations.push({
              pageId: page.id, shapeId: layer.id, ...planned.operation
            });
          }
        }
      } catch (error) {
        result.failed += 1;
        console.error("Cannot inspect a text layer.");
      }
    }
  }
  return result;
}

function planTextDirection(pageId, layer, direction, result) {
  try {
    if (!isValidId(layer.id)) {
      result.failed += 1;
    } else if (layer.direction === "mixed" || layer.align === "mixed") {
      result.skipped += 1;
    } else {
      const { metadata, invalid } = inspectRtlMetadata(layer);
      if (invalid) {
        result.styleConflicts += 1;
        result.styleMetadataConflicts += 1;
        return;
      }
      const current = textStyleValues(layer);
      if (current.direction === direction
          && (!metadata?.textStyle || metadata.textStyle.active === "baseline")) return;
      const planned = planManagedSection(layer, "textStyle", current,
        rtlTextStyle(current, true), direction);
      if (planned.conflict) result.styleConflicts += 1;
      else if (planned.operation) result.styleOperations.push({
        pageId, shapeId: layer.id, ...planned.operation
      });
    }
  } catch (error) {
    recordManagedFailure(result, "style", "target");
    console.error("Cannot plan text direction.");
  }
}

function managedValues(shape, fields, kind) {
  const result = {};
  for (const field of Object.keys(fields)) {
    if (kind === "style") result[field] = shape[field];
    else if (field === "flexDir") result[field] = shape.flex && shape.flex.dir;
    else if (field === "flexAlignItems") result[field] = shape.flex && shape.flex.alignItems;
    else if (field === "flexLeftPadding") result[field] = shape.flex && shape.flex.leftPadding;
    else if (field === "flexRightPadding") result[field] = shape.flex && shape.flex.rightPadding;
    else if (["leftMargin", "rightMargin", "alignSelf"].includes(field)) {
      result[field] = shape.layoutChild && shape.layoutChild[field];
    } else result[field] = shape[field];
  }
  return result;
}

function setManagedValues(shape, values, kind) {
  for (const [field, value] of Object.entries(values)) {
    if (kind === "style") shape[field] = value;
    else if (field === "flexDir") shape.flex.dir = value;
    else if (field === "flexAlignItems") shape.flex.alignItems = value;
    else if (field === "flexLeftPadding") shape.flex.leftPadding = value;
    else if (field === "flexRightPadding") shape.flex.rightPadding = value;
    else if (["leftMargin", "rightMargin", "alignSelf"].includes(field)) {
      shape.layoutChild[field] = value;
    } else shape[field] = value;
  }
}

function executeManagedOperations(context, operations, kind, plan) {
  let changed = 0;
  let encounteredFailure = false;
  const pages = new Map(context.pages.map(page => [page.id, page.proxy]));
  for (const operation of operations) {
    try {
      const page = pages.get(operation.pageId);
      const shape = page && page.getShapeById(operation.shapeId);
      if (!shape) {
        plan.failed += 1;
        continue;
      }
      const current = managedValues(shape, operation.current, kind);
      if (!sameRecord(current, operation.current)) {
        if (kind === "style") plan.styleConflicts += 1;
        else plan.layoutConflicts += 1;
        continue;
      }
      const sectionName = kind === "style" ? "textStyle" : "layout";
      const pendingMetadata = {
        ...operation.metadata,
        active: `pending-${operation.metadata.active}`
      };
      try {
        writeRtlMetadata(shape, sectionName, pendingMetadata);
      } catch (error) {
        recordManagedFailure(plan, kind, "metadata");
        encounteredFailure = true;
        continue;
      }
      let changedAny = false;
      if (!sameRecord(current, operation.target)) {
        for (const [field, value] of Object.entries(operation.target)) {
          try {
            const fieldTarget = { [field]: value };
            const fieldCurrent = managedValues(shape, fieldTarget, kind);
            if (sameRecord(fieldCurrent, fieldTarget)) continue;
            setManagedValues(shape, fieldTarget, kind);
            if (!sameRecord(managedValues(shape, fieldTarget, kind), fieldTarget)) {
              throw new Error("Managed property readback failed.");
            }
            changedAny = true;
          } catch (error) {
            recordManagedFailure(plan, kind, field);
            encounteredFailure = true;
          }
        }
        if (changedAny) changed += 1;
        if (!sameRecord(managedValues(shape, operation.target, kind), operation.target)) {
          continue;
        }
      }
      try {
        writeRtlMetadata(shape, sectionName, operation.metadata);
      } catch (error) {
        recordManagedFailure(plan, kind, "metadata");
        encounteredFailure = true;
      }
    } catch (error) {
      recordManagedFailure(plan, kind, "target");
      encounteredFailure = true;
    }
  }
  if (encounteredFailure) {
    if (kind === "style") {
      console.error(`Some RTL text style updates were skipped (${plan.styleFailed}).`);
    } else {
      const details = LAYOUT_FAILURE_REASONS
        .filter(reason => plan.layoutFailureReasons[reason] > 0)
        .map(reason => `${reason}: ${plan.layoutFailureReasons[reason]}`)
        .join(", ");
      console.error(`Some RTL layout updates were skipped (${details}).`);
    }
  }
  return changed;
}

function executeApply(context, plan) {
  let changed = 0;
  let styled = 0;
  let mirrored = 0;
  let conflicts = 0;
  let historyFailed = false;
  const operationCount = plan.operations.length + plan.styleOperations.length
    + plan.layoutOperations.length + plan.pageOperations.length;
  if (!operationCount) return { changed, styled, mirrored, conflicts, historyFailed };
  if (!contextStillMatches(context)) {
    plan.failed += operationCount;
    return { changed, styled, mirrored, conflicts, historyFailed };
  }
  let historyId;
  try {
    historyId = penpot.history.undoBlockBegin();
  } catch (error) {
    plan.failed += operationCount;
    console.error("Cannot start localization history.");
    return { changed, styled, mirrored, conflicts, historyFailed: true };
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
    const rejectedPages = new Set();
    for (const operation of plan.pageOperations) {
      const page = pages.get(operation.pageId);
      try {
        if (readPageDirection(page) !== operation.previous) {
          throw new Error("Page direction changed.");
        }
        page.setPluginData(PAGE_DIRECTION_KEY, operation.direction);
        if (readPageDirection(page) !== operation.direction) {
          throw new Error("Page direction readback failed.");
        }
      } catch (error) {
        rejectedPages.add(operation.pageId);
        recordPageFailure(plan, operation.pageId);
      }
    }
    styled = executeManagedOperations(context,
      plan.styleOperations.filter(operation => !rejectedPages.has(operation.pageId)), "style", plan);
    mirrored = executeManagedOperations(context,
      plan.layoutOperations.filter(operation => !rejectedPages.has(operation.pageId)), "layout", plan);
  } finally {
    try {
      penpot.history.undoBlockFinish(historyId);
    } catch (error) {
      historyFailed = true;
      console.error("Cannot finish localization history.");
    }
  }
  return { changed, styled, mirrored, conflicts, historyFailed };
}

function handleApply(message) {
  const switching = message.type === "switch-direction";
  const replyType = switching ? "direction-result" : "localization-result";
  try {
    if (switching && (!isDirection(message.direction)
        || message.scope === "page" && !isValidId(message.pageId))) {
      throw new Error("Invalid direction or page context.");
    }
    const strings = switching ? null : validateTranslations(message.translations, message.language);
    const context = captureContext(message);
    const plan = planApply(context, strings, message.language, switching ? message.direction : null);
    const execution = executeApply(context, plan);
    const state = inspectActiveRtlMetadata(context);
    penpot.ui.sendMessage({
      type: replyType,
      requestId: message.requestId,
      ok: true,
      ...(switching ? { direction: message.direction } : { language: message.language }),
      rtl: plan.rtl,
      layoutMirrored: state.layoutMirrored,
      layoutStateComplete: state.complete,
      pageCount: plan.pageCount,
      tagged: plan.tagged,
      changed: execution.changed,
      alreadyCorrect: plan.alreadyCorrect,
      skipped: plan.skipped,
      failed: plan.failed,
      failedPages: plan.failedPages,
      conflicts: execution.conflicts,
      styled: execution.styled,
      mirrored: execution.mirrored,
      layoutSkipped: plan.layoutSkipped,
      layoutUnsupported: plan.layoutUnsupported,
      layoutSubtreesSkipped: plan.layoutSubtreesSkipped,
      styleConflicts: plan.styleConflicts,
      styleMetadataConflicts: plan.styleMetadataConflicts,
      layoutConflicts: plan.layoutConflicts,
      layoutMetadataConflicts: plan.layoutMetadataConflicts,
      styleFailed: plan.styleFailed,
      layoutFailed: plan.layoutFailed,
      layoutFailureReasons: plan.layoutFailureReasons,
      historyFailed: execution.historyFailed,
      restoreAvailable: hasRecovery(context.fileId) || state.restoreAvailable,
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
    styleConflicts: 0,
    styleMetadataConflicts: 0,
    layoutConflicts: 0,
    layoutMetadataConflicts: 0,
    metadataConflicts: 0,
    layoutSkipped: 0,
    layoutUnsupported: 0,
    layoutSubtreesSkipped: 0,
    styleFailed: 0,
    layoutFailed: 0,
    layoutFailureReasons: Object.fromEntries(LAYOUT_FAILURE_REASONS.map(reason => [reason, 0])),
    missingTargets: 0,
    failed: 0,
    failedPages: 0,
    failedPageIds: new Set(),
    operations: [],
    styleOperations: [],
    layoutOperations: [],
    pageOperations: []
  };
  if (fileJournal) {
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
  }
  for (const page of context.pages) {
    let shapes;
    try {
      shapes = allPageShapes(page.proxy);
      const previous = readPageDirection(page.proxy);
      if (previous) result.pageOperations.push({ pageId: page.id, previous });
    } catch (error) {
      recordPageFailure(result, page.id);
      continue;
    }
    for (const shape of shapes) {
      const inspected = inspectRtlMetadata(shape);
      if (inspected.invalid) {
        result.metadataConflicts += 1;
        continue;
      }
      try {
        const metadata = inspected.metadata;
        for (const [sectionName, kind, destination] of [
          ["textStyle", "style", result.styleOperations],
          ["layout", "layout", result.layoutOperations]
        ]) {
          const section = metadata && metadata[sectionName];
          if (!section || section.active === "baseline") continue;
          const current = managedValues(shape, section.lastWritten, kind);
          const planned = planManagedSection(shape, sectionName, current,
            section.rtlTarget, "baseline");
          if (planned.conflict) {
            if (kind === "style") result.styleConflicts += 1;
            else result.layoutConflicts += 1;
          } else if (planned.operation) {
            destination.push({ pageId: page.id, shapeId: shape.id, ...planned.operation });
          }
        }
      } catch (error) {
        result.failed += 1;
        console.error("Cannot plan RTL recovery metadata.");
      }
    }
  }
  return result;
}

function executeRestore(context, plan) {
  let restored = 0;
  let stylesRestored = 0;
  let layoutsRestored = 0;
  let historyFailed = false;
  const operationCount = plan.operations.length + plan.styleOperations.length
    + plan.layoutOperations.length + plan.pageOperations.length;
  if (!operationCount) return { restored, stylesRestored, layoutsRestored, historyFailed };
  if (!contextStillMatches(context)) {
    plan.failed += operationCount;
    return { restored, stylesRestored, layoutsRestored, historyFailed };
  }
  let historyId;
  try {
    historyId = penpot.history.undoBlockBegin();
  } catch (error) {
    plan.failed += operationCount;
    console.error("Cannot start recovery history.");
    return { restored, stylesRestored, layoutsRestored, historyFailed: true };
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
    stylesRestored = executeManagedOperations(context, plan.styleOperations, "style", plan);
    layoutsRestored = executeManagedOperations(context, plan.layoutOperations, "layout", plan);
    if (!plan.failedPages && !plan.styleConflicts && !plan.layoutConflicts
        && !plan.metadataConflicts && !plan.failed) {
      for (const operation of plan.pageOperations) {
        const page = pages.get(operation.pageId);
        try {
          if (readPageDirection(page) !== operation.previous) {
            throw new Error("Page direction changed.");
          }
          page.setPluginData(PAGE_DIRECTION_KEY, "auto");
          if (readPageDirection(page)) throw new Error("Page direction readback failed.");
        } catch (error) {
          recordPageFailure(plan, operation.pageId);
        }
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
  return { restored, stylesRestored, layoutsRestored, historyFailed };
}

function handleRestore(message) {
  const replyType = "restore-result";
  try {
    const context = captureContext(message);
    const plan = planRestore(context);
    const execution = executeRestore(context, plan);
    const state = inspectActiveRtlMetadata(context);
    penpot.ui.sendMessage({
      type: replyType,
      requestId: message.requestId,
      ok: true,
      pageCount: plan.pageCount,
      failedPages: plan.failedPages,
      targeted: plan.targeted,
      restored: execution.restored,
      stylesRestored: execution.stylesRestored,
      layoutsRestored: execution.layoutsRestored,
      layoutMirrored: state.layoutMirrored,
      layoutStateComplete: state.complete,
      skipped: plan.skipped,
      conflicts: plan.conflicts,
      styleConflicts: plan.styleConflicts,
      styleMetadataConflicts: plan.styleMetadataConflicts,
      layoutConflicts: plan.layoutConflicts,
      layoutMetadataConflicts: plan.layoutMetadataConflicts,
      metadataConflicts: plan.metadataConflicts,
      layoutSkipped: plan.layoutSkipped,
      layoutUnsupported: plan.layoutUnsupported,
      layoutSubtreesSkipped: plan.layoutSubtreesSkipped,
      styleFailed: plan.styleFailed,
      layoutFailed: plan.layoutFailed,
      layoutFailureReasons: plan.layoutFailureReasons,
      missingTargets: plan.missingTargets,
      failed: plan.failed,
      historyFailed: execution.historyFailed,
      restoreAvailable: plan.failedPages > 0
        || hasRecovery(context.fileId) || state.restoreAvailable
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
  } else if (message.type === "apply-language" || message.type === "switch-direction") {
    handleApply(message);
  } else if (message.type === "restore-localization") {
    handleRestore(message);
  } else if (message.type === "recovery-status-request") {
    handleRecoveryStatus(message);
  }
});

// The UI refreshes scope status without sending host proxies across the bridge.
if (typeof penpot.on === "function") {
  const refreshContext = () => penpot.ui.sendMessage({ type: "design-context-changed" });
  penpot.on("pagechange", refreshContext);
  penpot.on("filechange", refreshContext);
  penpot.on("contentsave", refreshContext);
}
