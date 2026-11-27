function isDirection(value) {
  return value === "ltr" || value === "rtl";
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

// RTL records and transitions work on plain data. The adapter owns shape I/O and readback.
function createRtlMetadata(isValidId) {
  function isPlainRecord(value) {
    return value && typeof value === "object" && !Array.isArray(value);
  }

  function validManagedValue(field, value) {
    if (["x", "parentOffsetX", "leftMargin", "rightMargin"].includes(field)) {
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

  function validateSection(section, name) {
    if (!isPlainRecord(section)
        || !["baseline", "rtl", "ltr", "pending-baseline", "pending-rtl", "pending-ltr"].includes(section.active)
        || !isPlainRecord(section.baseline) || !isPlainRecord(section.rtlTarget)
        || !isPlainRecord(section.lastWritten)
        || Object.keys(section).some(key => !["active", "baseline", "rtlTarget", "lastWritten",
          ...(name === "layout" ? ["baselineDirection", "parentId"] : ["ltrTarget"])].includes(key))
        || (section.baselineDirection !== undefined && !isDirection(section.baselineDirection))
        || (Object.hasOwn(section.baseline, "parentOffsetX")
          ? !isValidId(section.parentId) || Object.hasOwn(section.baseline, "x")
          : Object.hasOwn(section, "parentId"))
        || (section.ltrTarget !== undefined && !isPlainRecord(section.ltrTarget))
        || (["ltr", "pending-ltr"].includes(section.active) && !section.ltrTarget)) {
      throw new Error("Invalid RTL metadata.");
    }
    const allowed = name === "textStyle" ? ["align", "direction"] : [
      "alignSelf", "constraintsHorizontal", "flexAlignItems", "flexDir",
      "flexLeftPadding", "flexRightPadding", "leftMargin", "rightMargin", "x", "parentOffsetX"
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

  function decode(value) {
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
      validateSection(record.textStyle, "textStyle");
    }
    if (Object.prototype.hasOwnProperty.call(record, "layout")) {
      validateSection(record.layout, "layout");
    }
    return record;
  }

  function planTransition(section, sectionName, current, rtlTarget, active, baselineDirection, parentId) {
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
        if (parentId) section.parentId = parentId;
      }
    }
    // Layout records keep the original rtlTarget key for the mirrored geometry in either direction.
    let refreshedRtlTarget = section.rtlTarget;
    const position = Object.hasOwn(current, "parentOffsetX") ? "parentOffsetX" : "x";
    if (sectionName === "layout" && active === "rtl" && !section.active.startsWith("pending-")
        && sameRecord(current, section.baseline)) {
      refreshedRtlTarget = rtlTarget;
    } else if (sectionName === "layout" && active === "rtl" && section.active === "rtl"
        && sameRecord(current, section.lastWritten)
        && Object.hasOwn(current, position) && Object.hasOwn(rtlTarget, position)) {
      refreshedRtlTarget = {
        ...section.rtlTarget,
        [position]: rtlTarget[position] + current[position] - section.baseline[position]
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

  return { decode, validateSection, validManagedValue, planTransition };
}
