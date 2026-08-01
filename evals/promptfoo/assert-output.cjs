function normalized(value) {
  return String(value).normalize("NFKC").trim().toLowerCase();
}

function component(pass, reason) {
  return { pass, score: pass ? 1 : 0, reason };
}

function checkOutput(rawOutput, context) {
  const results = [];
  let output;

  try {
    output = JSON.parse(rawOutput);
  } catch {
    return {
      pass: false,
      score: 0,
      reason: "Provider output is not valid JSON.",
      componentResults: [component(false, "Provider output is not valid JSON.")],
    };
  }

  const vars = context?.vars ?? {};
  const expect = vars.expect && typeof vars.expect === "object" ? vars.expect : {};
  const expectedStatus = expect.status ?? "ok";
  const add = (pass, reason) => results.push(component(pass, reason));

  add(output && typeof output === "object", "Provider output must be an object.");
  add(output.input === vars.input, "Provider output must preserve the exact evaluated input.");
  add(
    output.languagePair?.source?.code === vars.sourceLanguageCode &&
      output.languagePair?.target?.code === vars.targetLanguageCode,
    "Provider output must preserve the evaluated language-pair codes.",
  );
  add(output.status === expectedStatus, `Expected status ${expectedStatus}.`);

  if (expectedStatus === "error") {
    add(output.error === expect.error, `Expected application error ${expect.error}.`);
  } else {
    const senses = Array.isArray(output.senses) ? output.senses : [];
    add(senses.length >= 1 && senses.length <= 5, "Successful output must contain one to five senses.");

    const completeSenses = senses.every(
      (sense) =>
        sense &&
        typeof sense.translation === "string" &&
        sense.translation.trim() &&
        typeof sense.partOfSpeech === "string" &&
        sense.partOfSpeech.trim() &&
        typeof sense.example === "string" &&
        sense.example.trim() &&
        typeof sense.exampleTranslation === "string" &&
        sense.exampleTranslation.trim(),
    );
    add(completeSenses, "Every sense must contain non-empty translation, part of speech, and both examples.");

    const identities = senses.map(
      (sense) => `${normalized(sense.translation)}\u0001${normalized(sense.partOfSpeech)}`,
    );
    add(new Set(identities).size === identities.length, "Translation and part-of-speech sense pairs must be unique.");

    const expectedCorrection = expect.correctedWord;
    if (expectedCorrection) {
      add(output.correctedWord === expectedCorrection, `Expected correctedWord ${expectedCorrection}.`);
    } else {
      add(output.correctedWord === null, "Correctly spelled input must not be reported as corrected.");
    }

    const sourceForm = expectedCorrection ?? vars.input;
    add(
      senses.every((sense) => normalized(sense.exampleTranslation).includes(normalized(sourceForm))),
      `Every source-language example must contain the exact source form ${sourceForm}.`,
    );

    const renderedTranslations = normalized(senses.map((sense) => sense.translation).join("\n"));
    for (const forbidden of expect.forbiddenTranslations ?? []) {
      add(
        !renderedTranslations.includes(normalized(forbidden)),
        `Translations must not contain the known-wrong form ${forbidden}.`,
      );
    }
  }

  const failed = results.filter((result) => !result.pass);
  return {
    pass: failed.length === 0,
    score: results.length === 0 ? 0 : results.reduce((sum, result) => sum + result.score, 0) / results.length,
    reason: failed.length === 0 ? "Application output contract satisfied." : failed.map((result) => result.reason).join(" "),
    componentResults: results,
  };
}

module.exports = checkOutput;
