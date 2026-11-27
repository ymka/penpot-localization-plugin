// Translation and saved-import rules work on plain data independently of Penpot storage.
const translationValidation = (() => {
  const MAX_BYTES = 1024 * 1024;

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

  function decodeSavedImport(stored) {
    // JSON escaping can expand a 1 MiB source up to sixfold.
    const empty = stored === null || stored === undefined || stored === "";
    if (!empty && (typeof stored !== "string"
        || stored.length > 6 * MAX_BYTES + 8192)) throw new Error("Invalid saved import.");
    return empty ? null : validateSavedImport(JSON.parse(stored));
  }

  return { decodeSavedImport, validateSavedImport, validateTranslations };
})();
