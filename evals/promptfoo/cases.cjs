const LANGUAGES = Object.freeze({
  en: "English",
  uk: "Ukrainian",
  ru: "Russian",
  be: "Belarusian",
  pl: "Polish",
  de: "German",
  fr: "French",
  es: "Spanish",
  it: "Italian",
  pt: "Portuguese",
  nl: "Dutch",
  cs: "Czech",
  sv: "Swedish",
  ja: "Japanese",
  ko: "Korean",
  zh: "Chinese",
  tr: "Turkish",
});

// Each supported non-English language gets one common and one challenging case
// in both directions through English. Deeper English/Ukrainian cases follow.
// Tuple: source, target, input, category, difficulty, intent, tier?, expect?
const breadthCases = [
  ["en", "uk", "hello", "common", "easy", "Translate the common greeting naturally.", "smoke"],
  ["uk", "en", "дякую", "common", "easy", "Translate this everyday expression of thanks naturally.", "smoke"],
  ["en", "uk", "bank", "polysemy", "medium", "Include the common financial-institution and river-bank senses."],
  ["uk", "en", "накивати п'ятами", "idiom", "hard", "Translate the idiom as running away or fleeing, not as a literal action involving heels."],

  ["en", "pl", "water", "common", "easy", "Translate the everyday noun for water.", "smoke"],
  ["pl", "en", "dom", "common", "easy", "Translate the common noun, allowing both house and home where appropriate."],
  ["en", "pl", "eventually", "false-friend", "hard", "Translate the meaning 'in the end' or 'after some time', not 'possibly'.", undefined, { forbiddenTranslations: ["ewentualnie"] }],
  ["pl", "en", "załatwić", "lexical-gap", "hard", "Represent useful context-dependent senses such as arrange, handle, settle, obtain, or take care of."],

  ["en", "de", "book", "common", "easy", "Translate the common noun and useful verb sense.", "smoke"],
  ["de", "en", "Haus", "common", "easy", "Translate the common noun as house, with home accepted when contextually appropriate."],
  ["en", "de", "become", "false-friend", "hard", "Translate the change-of-state verb, not the German verb meaning 'receive'.", undefined, { forbiddenTranslations: ["bekommen"] }],
  ["de", "en", "Schadenfreude", "lexical-gap", "hard", "Translate the pleasure someone feels at another person's misfortune, using a natural English gloss or the established loanword."],

  ["en", "fr", "friend", "common", "easy", "Translate the everyday noun for a friend.", "smoke"],
  ["fr", "en", "merci", "common", "easy", "Translate this everyday expression of thanks."],
  ["en", "fr", "actually", "false-friend", "hard", "Translate the adverb meaning 'in fact', not 'currently'.", undefined, { forbiddenTranslations: ["actuellement"] }],
  ["fr", "en", "dépaysement", "lexical-gap", "hard", "Convey the feeling or experience of being away from one's familiar surroundings; accept positive or unsettling nuance when explained by distinct senses."],

  ["en", "es", "family", "common", "easy", "Translate the everyday noun for family.", "smoke"],
  ["es", "en", "gracias", "common", "easy", "Translate this everyday expression of thanks."],
  ["en", "es", "embarrassed", "false-friend", "hard", "Translate feeling ashamed or self-conscious, not being pregnant.", undefined, { forbiddenTranslations: ["embarazada"] }],
  ["es", "en", "sobremesa", "lexical-gap", "hard", "Translate the time and conversation shared at the table after a meal, not the literal tabletop."],

  ["en", "it", "morning", "common", "easy", "Translate the everyday noun for the morning."],
  ["it", "en", "casa", "common", "easy", "Translate the common noun, allowing house and home as useful senses."],
  ["en", "it", "library", "false-friend", "hard", "Translate the place or collection for borrowing and consulting books, not a bookshop.", undefined, { forbiddenTranslations: ["libreria"] }],
  ["it", "en", "magari", "particle", "hard", "Represent its context-dependent uses such as 'if only', 'I wish', 'maybe', or an enthusiastic 'sure'."],

  ["en", "pt", "bread", "common", "easy", "Translate the everyday noun for bread."],
  ["pt", "en", "obrigado", "common", "easy", "Translate this everyday expression of thanks."],
  ["en", "pt", "pretend", "false-friend", "hard", "Translate acting as if something were true, not intending or wanting to do something.", undefined, { forbiddenTranslations: ["pretender"] }],
  ["pt", "en", "saudade", "lexical-gap", "hard", "Convey a deep longing or nostalgic missing of someone or something absent."],

  ["en", "nl", "bicycle", "common", "easy", "Translate the everyday noun for a bicycle."],
  ["nl", "en", "huis", "common", "easy", "Translate the common noun as house, with home accepted when contextually appropriate."],
  ["en", "nl", "brave", "false-friend", "hard", "Translate courage or fearlessness, not merely being obedient or well-behaved.", undefined, { forbiddenTranslations: ["braaf"] }],
  ["nl", "en", "gezellig", "lexical-gap", "hard", "Convey the warm, pleasant, sociable, or cozy quality appropriate to the source word."],

  ["en", "cs", "city", "common", "easy", "Translate the everyday noun for a city."],
  ["cs", "en", "děkuji", "common", "easy", "Translate this everyday expression of thanks."],
  ["en", "cs", "actual", "false-friend", "hard", "Translate the adjective meaning real or factual, not current or up-to-date.", undefined, { forbiddenTranslations: ["aktuální"] }],
  ["cs", "en", "prozvonit", "lexical-gap", "hard", "Translate the act of briefly calling and hanging up so the other person sees a missed call."],

  ["en", "sv", "coffee", "common", "easy", "Translate the everyday noun for coffee."],
  ["sv", "en", "tack", "common", "easy", "Translate the common expression of thanks; include the noun sense only if it is genuinely useful."],
  ["en", "sv", "semester", "false-friend", "hard", "Translate an academic half-year term, not a vacation.", undefined, { forbiddenTranslations: ["semester"] }],
  ["sv", "en", "lagom", "lexical-gap", "hard", "Convey the idea of being just the right amount: neither too much nor too little."],

  ["en", "ja", "book", "common", "easy", "Translate the common noun for a book.", "smoke"],
  ["ja", "en", "水", "common", "easy", "Translate the everyday noun for water.", "smoke"],
  ["en", "ja", "wear", "polysemy", "hard", "Represent useful Japanese verbs that differ by what is worn, such as clothing, footwear, or headwear."],
  ["ja", "en", "もったいない", "lexical-gap", "hard", "Convey regret that something valuable is being wasted or used without due appreciation."],

  ["en", "ko", "friend", "common", "easy", "Translate the everyday noun for a friend."],
  ["ko", "en", "안녕하세요", "common", "easy", "Translate this polite everyday greeting naturally."],
  ["en", "ko", "wear", "polysemy", "hard", "Represent useful Korean verbs that differ by what is worn, such as clothing, footwear, or headwear."],
  ["ko", "en", "눈치", "lexical-gap", "hard", "Convey awareness of others' feelings and the ability to read a social situation."],

  ["en", "zh", "home", "common", "easy", "Translate the everyday sense of one's home.", "smoke"],
  ["zh", "en", "朋友", "common", "easy", "Translate the everyday noun for a friend.", "smoke"],
  ["en", "zh", "uncle", "kinship", "hard", "Represent useful Chinese kinship terms that distinguish the relevant maternal, paternal, older, and younger relations."],
  ["zh", "en", "加油", "expression", "hard", "Translate the encouragement naturally as 'come on', 'keep going', 'you can do it', or an equivalent, not literally as adding fuel."],

  ["en", "tr", "time", "common", "easy", "Translate the common noun senses of time.", "smoke"],
  ["tr", "en", "merhaba", "common", "easy", "Translate this everyday greeting.", "smoke"],
  ["en", "tr", "you", "register", "hard", "Represent the useful informal-singular and formal-or-plural second-person distinctions."],
  ["tr", "en", "geçmiş olsun", "expression", "hard", "Translate the conventional wish said after illness or misfortune, such as 'get well soon' or 'sorry to hear that'."],

  ["en", "ru", "bread", "common", "easy", "Translate the everyday noun for bread."],
  ["ru", "en", "спасибо", "common", "easy", "Translate this everyday expression of thanks."],
  ["en", "ru", "accurate", "false-friend", "hard", "Translate correctness or precision, not neatness or careful appearance.", undefined, { forbiddenTranslations: ["аккуратный"] }],
  ["ru", "en", "авось", "particle", "hard", "Convey the reliance on chance or hope that things may somehow work out."],

  ["en", "be", "mother", "common", "easy", "Translate the everyday noun for mother."],
  ["be", "en", "дзякуй", "common", "easy", "Translate this everyday expression of thanks."],
  ["en", "be", "carefully", "language-purity", "hard", "Use standard Belarusian wording and morphology, avoiding Russian substitution.", undefined, { forbiddenTranslations: ["аккуратно"] }],
  ["be", "en", "калі ласка", "expression", "medium", "Translate the polite expression according to its useful senses, including 'please' and 'you're welcome'."],
];

const englishUkrainianDepthCases = [
  ["en", "uk", "eat", "common", "easy", "Translate the high-frequency verb naturally.", "core"],
  ["en", "uk", "work", "common", "easy", "Translate common noun and verb senses of this high-frequency word.", "core"],
  ["en", "uk", "time", "common", "easy", "Translate common high-frequency senses such as time, occasion, or instance when useful.", "core"],
  ["en", "uk", "love", "common", "easy", "Translate the common noun and verb senses naturally.", "core"],
  ["en", "uk", "light", "polysemy", "hard", "Include useful illumination, not-heavy, and pale-color senses without conflating them."],
  ["en", "uk", "fair", "polysemy", "hard", "Represent useful senses such as just/equitable, moderately good, light-colored, and a public fair."],
  ["en", "uk", "charge", "polysemy", "hard", "Represent useful senses such as asking a price, accusing, electrical charge, and rushing forward."],
  ["en", "uk", "match", "polysemy", "hard", "Represent useful senses such as a contest, an equal counterpart, pairing, and a match used to light a fire."],
  ["en", "uk", "set", "polysemy", "hard", "Return a learner-useful selection of the most common noun, verb, or adjective senses rather than unrelated rare senses."],
  ["en", "uk", "mean", "polysemy", "hard", "Distinguish the verb 'signify/intend', the adjective 'unkind', and the mathematical noun when useful."],
  ["en", "uk", "red herring", "idiom", "hard", "Translate a misleading clue or distraction idiomatically, not as a fish.", undefined, { forbiddenTranslations: ["червоний оселедець"] }],
  ["en", "uk", "kick the bucket", "idiom", "hard", "Translate the idiom as dying; do not translate the bucket literally.", undefined, { forbiddenTranslations: ["кинути відро", "бити відро"] }],
  ["en", "uk", "beat around the bush", "idiom", "hard", "Translate avoiding the main point or a direct answer, not literal beating near vegetation."],
  ["en", "uk", "spill the beans", "idiom", "hard", "Translate revealing a secret idiomatically, not literally spilling legumes."],
  ["en", "uk", "once in a blue moon", "idiom", "hard", "Translate the meaning 'very rarely' idiomatically."],
  ["en", "uk", "the best of both worlds", "idiom", "hard", "Translate combining the advantages of two alternatives."],
  ["en", "uk", "give up", "phrasal-verb", "medium", "Translate common senses such as surrendering, quitting, or abandoning something."],
  ["en", "uk", "break down", "phrasal-verb", "hard", "Translate useful senses such as malfunctioning, decomposing, losing emotional control, or analyzing into parts."],
  ["en", "uk", "look up", "phrasal-verb", "hard", "Translate useful senses such as searching for information, visiting or contacting someone, and improving."],
  ["en", "uk", "make up", "phrasal-verb", "hard", "Translate useful senses such as inventing, reconciling, composing a whole, or applying cosmetics."],
  ["uk", "en", "таки", "particle", "hard", "Represent the emphatic particle naturally according to context, such as 'after all', 'indeed', or emphasis with 'did'."],
  ["uk", "en", "знічев'я", "lexical-gap", "hard", "Translate doing something from idleness, for no particular reason, or with nothing better to do."],
  ["uk", "en", "ні пуху ні пера", "idiom", "hard", "Translate the conventional wish of good luck idiomatically rather than mentioning feathers literally."],
  ["uk", "en", "бабине літо", "idiom", "medium", "Translate the warm spell in autumn as 'Indian summer' or a clear natural equivalent."],
];

const contractCases = [
  ["en", "uk", "red hering", "typo", "medium", "Correct the typo to 'red herring' and translate the idiom idiomatically.", "contract", { correctedWord: "red herring", forbiddenTranslations: ["червоний оселедець"] }],
  ["en", "uk", "kik the bucket", "typo", "medium", "Correct the typo to 'kick the bucket' and translate the idiom as dying.", "contract", { correctedWord: "kick the bucket", forbiddenTranslations: ["кинути відро"] }],
  ["en", "uk", "runing", "typo", "easy", "Correct the spelling to 'running' and translate the corrected word.", "contract", { correctedWord: "running" }],
  ["uk", "en", "превіт", "typo", "medium", "Correct the misspelling to 'привіт' and translate the greeting.", "contract", { correctedWord: "привіт" }],
  ["en", "uk", "xqfjvbn", "rejection", "hard", "Reject random letters as not a word instead of inventing a translation.", "contract", { status: "error", error: "word-not-found" }],
  ["en", "uk", "zzqpplx", "rejection", "hard", "Reject random letters as not a word instead of inventing a translation.", "contract", { status: "error", error: "word-not-found" }],
  ["uk", "en", "фждлрп", "rejection", "hard", "Reject random Cyrillic letters as not a word instead of inventing a translation.", "contract", { status: "error", error: "word-not-found" }],
  ["en", "uk", "fahj89sdf", "input-validation", "easy", "Reject a short alphanumeric token at the application's word-input boundary.", "contract", { status: "error", error: "invalid-word-input" }],
];

const allDefinitions = [...breadthCases, ...englishUkrainianDepthCases, ...contractCases];

const MATRIX_SOURCE_WORDS = Object.freeze({
  en: "water",
  uk: "вода",
  ru: "вода",
  be: "вада",
  pl: "woda",
  de: "Wasser",
  fr: "eau",
  es: "agua",
  it: "acqua",
  pt: "água",
  nl: "water",
  cs: "voda",
  sv: "vatten",
  ja: "水",
  ko: "물",
  zh: "水",
  tr: "su",
});

function makeTestCase(definition) {
  const [source, target, input, category, difficulty, intent, explicitTier, expect] = definition;
  const tier = explicitTier ?? (category === "common" ? "core" : "challenge");
  const pair = `${source}->${target}`;

  return {
    description: `${pair} | ${category} | ${input}`,
    metadata: {
      caseId: `${pair}:${input}`,
      pair,
      sourceLanguage: source,
      targetLanguage: target,
      category,
      difficulty,
      tier,
      suite: "standard",
      direction: source === "en" ? "from-English" : target === "en" ? "to-English" : "other",
    },
    vars: {
      input,
      sourceLanguageCode: source,
      sourceLanguageName: LANGUAGES[source],
      targetLanguageCode: target,
      targetLanguageName: LANGUAGES[target],
      intent,
      ...(expect ? { expect } : {}),
    },
  };
}

function makeMatrixCases() {
  return Object.entries(MATRIX_SOURCE_WORDS).flatMap(([source, input]) =>
    Object.keys(LANGUAGES)
      .filter((target) => target !== source)
      .map((target) => {
        const pair = `${source}->${target}`;
        return {
          description: `${pair} | common-matrix | ${input}`,
          metadata: {
            caseId: `matrix:${pair}:${input}`,
            pair,
            sourceLanguage: source,
            targetLanguage: target,
            category: "common-matrix",
            difficulty: "easy",
            tier: "matrix",
            suite: "matrix",
            direction: source === "en" ? "from-English" : target === "en" ? "to-English" : "cross-language",
          },
          vars: {
            input,
            sourceLanguageCode: source,
            sourceLanguageName: LANGUAGES[source],
            targetLanguageCode: target,
            targetLanguageName: LANGUAGES[target],
            intent: "Translate the everyday noun for water. Judge the requested source and target languages exactly.",
          },
        };
      }),
  );
}

async function generateCases() {
  return [...allDefinitions.map(makeTestCase), ...makeMatrixCases()];
}

module.exports = generateCases;
