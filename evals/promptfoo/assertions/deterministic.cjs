const SCRIPT_REGEX = {
  Latin: /^[\p{Script=Latin}\p{N}\p{P}\p{Z}\p{M}\p{S}]+$/u,
  Cyrillic: /^[\p{Script=Cyrillic}\p{N}\p{P}\p{Z}\p{M}\p{S}]+$/u,
};

function parseOutput(output) {
  if (typeof output === "object" && output !== null) return output;
  if (typeof output !== "string") {
    throw new Error(`Expected provider output to be a JSON string, got ${typeof output}`);
  }
  return JSON.parse(output);
}

function normalize(s) {
  return String(s).trim().toLocaleLowerCase();
}

function hasLetter(s) {
  return /\p{L}/u.test(s);
}

function translationTexts(projection) {
  if (!Array.isArray(projection.senses)) return [];
  return projection.senses
    .map((sense) => (typeof sense.translation === "string" ? sense.translation : ""))
    .filter(Boolean);
}

function isInScript(s, script) {
  const re = SCRIPT_REGEX[script];
  if (!re) return true;
  return hasLetter(s) && re.test(s);
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
      failures.length === 0
        ? "Deterministic checks passed"
        : failures.map((failure) => failure.reason).join("; "),
    componentResults,
  };
}

module.exports = (output, context) => {
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
  componentResults.push(check("sense limit", senses.length <= 5, `expected at most 5 senses, got ${senses.length}`));

  if (expect.correctedWord) {
    componentResults.push(
      check(
        "correctedWord",
        normalize(projection.correctedWord) === normalize(expect.correctedWord),
        `expected ${expect.correctedWord}, got ${String(projection.correctedWord)}`,
      ),
    );
  }

  const translations = translationTexts(projection);
  if (Array.isArray(expect.forbiddenTranslations) && expect.forbiddenTranslations.length > 0) {
    for (const forbidden of expect.forbiddenTranslations) {
      const hit = translations.some((translation) => normalize(translation).includes(normalize(forbidden)));
      componentResults.push(
        check(
          `forbidden: ${forbidden}`,
          !hit,
          `forbidden translation appeared in ${JSON.stringify(translations)}`,
        ),
      );
    }
  }

  if (expect.targetScript) {
    const unsupported = SCRIPT_REGEX[expect.targetScript] === undefined;
    const bad = unsupported ? [] : translations.filter((translation) => !isInScript(translation, expect.targetScript));
    componentResults.push(
      check(
        "targetScript",
        unsupported || bad.length === 0,
        `expected ${expect.targetScript}, mismatches: ${JSON.stringify(bad)}`,
      ),
    );
  }

  return aggregate(componentResults);
};
