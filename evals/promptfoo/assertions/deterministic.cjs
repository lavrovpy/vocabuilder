const SCRIPT_REGEX = {
  Latin: /^[\p{Script=Latin}\p{N}\p{P}\p{Z}\p{M}\p{S}]+$/u,
  Cyrillic: /^[\p{Script=Cyrillic}\p{N}\p{P}\p{Z}\p{M}\p{S}]+$/u,
  Hangul: /^[\p{Script=Hangul}\p{N}\p{P}\p{Z}\p{M}\p{S}]+$/u,
  Japanese: /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{N}\p{P}\p{Z}\p{M}\p{S}]+$/u,
};

function parseOutput(output) {
  if (typeof output === "object" && output !== null) return output;
  if (typeof output !== "string") {
    throw new Error(`Expected provider output to be a JSON string, got ${typeof output}`);
  }
  return JSON.parse(output);
}

function normalize(s) {
  return String(s).normalize("NFKC").trim().toLocaleLowerCase();
}

function hasLetter(s) {
  return /\p{L}/u.test(s);
}

function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function stringArray(value) {
  if (typeof value === "string" && value.trim()) return [value.trim()];
  if (!Array.isArray(value)) return [];
  return value.filter((item) => typeof item === "string" && item.trim()).map((item) => item.trim());
}

function targetTexts(projection) {
  if (!Array.isArray(projection.senses)) return [];
  return projection.senses.flatMap((sense, index) => [
    { name: `senses[${index}].translation`, value: sense.translation },
    { name: `senses[${index}].example`, value: sense.example },
  ]);
}

function sourceTexts(projection) {
  if (!Array.isArray(projection.senses)) return [];
  return projection.senses.map((sense, index) => ({
    name: `senses[${index}].exampleTranslation`,
    value: sense.exampleTranslation,
  }));
}

function isInScript(s, script) {
  const re = SCRIPT_REGEX[script];
  if (!re) return true;
  return hasLetter(s) && re.test(s);
}

function scriptMismatches(fields, script) {
  if (SCRIPT_REGEX[script] === undefined) return [];
  return fields
    .filter((field) => typeof field.value !== "string" || !isInScript(field.value, script))
    .map((field) => `${field.name}=${JSON.stringify(field.value)}`);
}

function senseIdentityKey(sense) {
  return [normalize(sense.translation), normalize(sense.partOfSpeech)].join("\u0001");
}

function configuredSourceItem(projection, vars, expect) {
  return (
    (typeof expect.correctedWord === "string" && expect.correctedWord.trim()) ||
    (typeof projection.correctedWord === "string" && projection.correctedWord.trim()) ||
    (typeof vars?.input === "string" && vars.input.trim()) ||
    (typeof projection.input === "string" && projection.input.trim()) ||
    ""
  );
}

function languagePairMismatches(projection, vars) {
  const expected = [
    ["sourceLanguageCode", "languagePair.source.code"],
    ["sourceLanguageName", "languagePair.source.name"],
    ["targetLanguageCode", "languagePair.target.code"],
    ["targetLanguageName", "languagePair.target.name"],
  ];
  const mismatches = [];

  for (const [varKey, path] of expected) {
    if (!nonEmptyString(vars?.[varKey])) continue;
    const actual = path.split(".").reduce((value, key) => value?.[key], projection);
    if (actual !== vars[varKey]) {
      mismatches.push(`${path}: expected ${JSON.stringify(vars[varKey])}, got ${JSON.stringify(actual)}`);
    }
  }

  return mismatches;
}

function check(name, pass, reason) {
  return {
    pass,
    score: pass ? 1 : 0,
    reason: pass ? `${name}: pass` : `${name}: ${reason}`,
  };
}

function aggregate(componentResults) {
  const failures = componentResults.filter((result) => !result.pass);
  return {
    pass: failures.length === 0,
    score:
      componentResults.length === 0
        ? 1
        : componentResults.reduce((sum, result) => sum + result.score, 0) / componentResults.length,
    reason:
      failures.length === 0 ? "Deterministic checks passed" : failures.map((failure) => failure.reason).join("; "),
    componentResults,
  };
}

module.exports = (output, context) => {
  const vars = context?.vars ?? {};
  const expect = context?.vars?.expect ?? {};
  const expectedStatus = expect.status ?? "ok";
  const componentResults = [];

  let projection;
  try {
    projection = parseOutput(output);
    componentResults.push(check("json", true));
  } catch (err) {
    componentResults.push(check("json", false, err instanceof Error ? err.message : String(err)));
    return aggregate(componentResults);
  }

  componentResults.push(
    check(
      "status",
      projection.status === expectedStatus,
      `expected status ${expectedStatus}, got ${String(projection.status)}`,
    ),
  );

  const hasLanguageExpectations = [
    "sourceLanguageCode",
    "sourceLanguageName",
    "targetLanguageCode",
    "targetLanguageName",
  ].some((key) => nonEmptyString(vars[key]));
  const languageMismatches = languagePairMismatches(projection, vars);
  if (hasLanguageExpectations) {
    componentResults.push(
      check(
        "languagePair",
        languageMismatches.length === 0,
        `language pair mismatch: ${languageMismatches.join("; ")}`,
      ),
    );
  }

  if (expectedStatus === "error") {
    if (expect.error) {
      componentResults.push(
        check(
          "error",
          projection.error === expect.error,
          `expected error ${expect.error}, got ${String(projection.error)}`,
        ),
      );
    }
    componentResults.push(
      check(
        "no senses on expected error",
        !Array.isArray(projection.senses) || projection.senses.length === 0,
        "expected error output not to include senses",
      ),
    );
    return aggregate(componentResults);
  }

  const senses = Array.isArray(projection.senses) ? projection.senses : [];
  componentResults.push(check("senses present", senses.length > 0, "expected at least one sense"));
  const minSenses = Number.isInteger(expect.minSenses) ? expect.minSenses : 1;
  const maxSenses = Number.isInteger(expect.maxSenses) ? expect.maxSenses : 5;
  componentResults.push(
    check(
      "sense count",
      senses.length >= minSenses && senses.length <= maxSenses,
      `expected ${minSenses}-${maxSenses} senses, got ${senses.length}`,
    ),
  );

  const missingSenseFields = [];
  for (const [index, sense] of senses.entries()) {
    for (const field of ["translation", "partOfSpeech", "example", "exampleTranslation"]) {
      if (!nonEmptyString(sense?.[field])) missingSenseFields.push(`senses[${index}].${field}`);
    }
  }
  componentResults.push(
    check("sense fields", missingSenseFields.length === 0, `missing or empty fields: ${missingSenseFields.join(", ")}`),
  );

  const duplicateKeys = new Set();
  const seenKeys = new Set();
  for (const sense of senses) {
    if (!nonEmptyString(sense?.translation) || !nonEmptyString(sense?.partOfSpeech)) continue;
    const key = senseIdentityKey(sense);
    if (seenKeys.has(key)) duplicateKeys.add(`${sense.translation} / ${sense.partOfSpeech}`);
    seenKeys.add(key);
  }
  componentResults.push(
    check(
      "duplicate senses",
      duplicateKeys.size === 0,
      `duplicate translation+partOfSpeech pairs: ${JSON.stringify([...duplicateKeys])}`,
    ),
  );

  if (expect.correctedWord) {
    componentResults.push(
      check(
        "correctedWord",
        normalize(projection.correctedWord) === normalize(expect.correctedWord),
        `expected ${expect.correctedWord}, got ${String(projection.correctedWord)}`,
      ),
    );
  } else if (expect.allowCorrection !== true) {
    componentResults.push(
      check(
        "correctedWord absent",
        projection.correctedWord == null || normalize(projection.correctedWord) === "",
        `unexpected correction ${String(projection.correctedWord)}`,
      ),
    );
  }

  const sourceItem = configuredSourceItem(projection, vars, expect);
  if (sourceItem) {
    const normalizedSourceItem = normalize(sourceItem);
    const badExamples = senses
      .filter((sense) => !normalize(sense?.exampleTranslation).includes(normalizedSourceItem))
      .map((sense) => sense.exampleTranslation);
    componentResults.push(
      check(
        "exampleTranslation source item",
        badExamples.length === 0,
        `expected each exampleTranslation to contain ${JSON.stringify(sourceItem)}, mismatches: ${JSON.stringify(badExamples)}`,
      ),
    );
  }

  if (expect.targetScript) {
    const bad = scriptMismatches(targetTexts(projection), expect.targetScript);
    componentResults.push(
      check("targetScript", bad.length === 0, `expected ${expect.targetScript}, mismatches: ${JSON.stringify(bad)}`),
    );
  }

  if (expect.sourceScript) {
    const bad = scriptMismatches(sourceTexts(projection), expect.sourceScript);
    componentResults.push(
      check("sourceScript", bad.length === 0, `expected ${expect.sourceScript}, mismatches: ${JSON.stringify(bad)}`),
    );
  }

  if (expect.disallowSourceLeakage === true && sourceItem) {
    const allowed = stringArray(expect.allowedSourceLeakage).map(normalize);
    const normalizedSourceItem = normalize(sourceItem);
    const hits = targetTexts(projection)
      .filter((field) => {
        const value = normalize(field.value);
        return value.includes(normalizedSourceItem) && !allowed.some((allowedItem) => value.includes(allowedItem));
      })
      .map((field) => `${field.name}=${JSON.stringify(field.value)}`);
    componentResults.push(
      check(
        "source leakage",
        hits.length === 0,
        `source item ${JSON.stringify(sourceItem)} appeared in target fields: ${JSON.stringify(hits)}`,
      ),
    );
  }

  const expectedPartsOfSpeech = stringArray(expect.partOfSpeechAny).map(normalize);
  if (expectedPartsOfSpeech.length > 0) {
    const actualPartsOfSpeech = senses.map((sense) => normalize(sense?.partOfSpeech));
    componentResults.push(
      check(
        "partOfSpeechAny",
        actualPartsOfSpeech.some((partOfSpeech) => expectedPartsOfSpeech.includes(partOfSpeech)),
        `expected one of ${JSON.stringify(expectedPartsOfSpeech)}, got ${JSON.stringify(actualPartsOfSpeech)}`,
      ),
    );
  }

  return aggregate(componentResults);
};
