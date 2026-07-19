const TRANSACTIONAL_TOPICS = Object.freeze([
  {
    name: "booking",
    pattern: /\b(?:book(?:ed|ing|s)?|appointment(?:s)?|reservation(?:s)?|schedul(?:e|ed|es|ing))\b/i,
  },
  {
    name: "delivery",
    pattern: /\b(?:deliver(?:ed|ies|ing|s|y)|delivery)\b/i,
  },
  {
    name: "eventServices",
    pattern:
      /\b(?:event|events|wedding|weddings)\s+(?:floral|florals|flowers?|service|services|package|packages|planning)\b|\b(?:floral|florals|flowers?|service|services|package|packages|planning)\s+(?:for\s+)?(?:an?\s+)?(?:event|events|wedding|weddings)\b/i,
  },
  {
    name: "hours",
    pattern:
      /\b(?:business hours?|opening hours?|hours of operation|open (?:daily|today|from|until)|(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)s?)\b/i,
  },
  {
    name: "ordering",
    pattern: /\b(?:order|ordered|ordering|orders)\b/i,
  },
  {
    name: "pickup",
    pattern: /\b(?:pickup|pick up)\b/i,
  },
  {
    name: "prices",
    pattern: /(?:\$\s*\d)|\b(?:cost|costs|price|priced|prices|pricing)\b/i,
  },
]);

const OPERATIONAL_VERBS = Object.freeze([
  "bake",
  "bakes",
  "baking",
  "build",
  "builds",
  "carry",
  "carries",
  "create",
  "creates",
  "deliver",
  "delivers",
  "design",
  "designs",
  "host",
  "hosts",
  "make",
  "makes",
  "offer",
  "offers",
  "plan",
  "plans",
  "provide",
  "provides",
  "repair",
  "repairs",
  "sell",
  "sells",
  "serve",
  "serves",
  "stock",
  "stocks",
]);

const OPERATIONAL_VERB_PATTERN = new RegExp(`\\b(?:${OPERATIONAL_VERBS.join("|")})\\b`, "i");
const GENERIC_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "at",
  "by",
  "for",
  "from",
  "in",
  "is",
  "it",
  "of",
  "on",
  "our",
  "the",
  "to",
  "us",
  "we",
  "with",
  ...OPERATIONAL_VERBS.map(normalizeToken),
]);

export function deriveClaimPolicy(brief) {
  const offerings = Array.isArray(brief?.offerings) ? brief.offerings : [];
  const confirmedOfferings = offerings
    .filter((offering) => offering?.confidence === "confirmed")
    .map(publicOffering);
  const inferredOfferingHints = offerings
    .filter((offering) => offering?.confidence !== "confirmed")
    .map(publicOffering);
  const confirmedFactStatements = Array.isArray(brief?.facts?.confirmed)
    ? brief.facts.confirmed
        .filter((fact) => nonempty(fact?.label) && nonempty(fact?.value))
        .map((fact) => ({ label: String(fact.label).trim(), value: String(fact.value).trim() }))
    : [];
  const supportEvidence = collectSupportEvidence(brief, confirmedOfferings, confirmedFactStatements);
  const allowedTransactionalTopics = TRANSACTIONAL_TOPICS
    .filter((topic) => supportEvidence.some((value) => topic.pattern.test(value)))
    .map((topic) => topic.name);
  const allowed = new Set(allowedTransactionalTopics);

  return {
    schemaVersion: "1.0",
    mode: confirmedOfferings.length > 0 ? "confirmed-offerings" : "guidance-only",
    provenanceAvailable:
      Array.isArray(brief?.offerings) && Array.isArray(brief?.facts?.confirmed),
    confirmedOfferings,
    inferredOfferingHints,
    confirmedFactStatements,
    allowedTransactionalTopics,
    forbiddenTransactionalTopics: TRANSACTIONAL_TOPICS
      .map((topic) => topic.name)
      .filter((name) => !allowed.has(name)),
    guidanceNote: "Service and availability details are not confirmed.",
    rules: {
      inferredOfferingsArePrivateHypotheses: true,
      qualifiersDoNotAuthorizeUnknownClaims: true,
      localAnchorActionsOnlyWhenGuidanceOnly: true,
      revisionsMustReauditVisibleClaims: true,
    },
  };
}

export function validateBriefClaims(indexHtml, brief, policy = deriveClaimPolicy(brief)) {
  if (typeof indexHtml !== "string") {
    throw new TypeError("HTML is required for brief aware claim validation.");
  }
  if (!policy?.provenanceAvailable) return indexHtml;

  const visible = normalizeClaimText(extractVisibleText(indexHtml));
  const forbidden = new Set(policy.forbiddenTransactionalTopics ?? []);
  for (const topic of TRANSACTIONAL_TOPICS) {
    if (forbidden.has(topic.name) && topic.pattern.test(visible)) {
      throw new Error(`Unsupported transactional claim: ${topic.name} is not confirmed.`);
    }
  }

  const supportEvidence = collectSupportEvidence(
    brief,
    policy.confirmedOfferings ?? [],
    policy.confirmedFactStatements ?? [],
  );
  const framedText = normalizeClaimText(extractServiceFraming(indexHtml));
  for (const offering of policy.inferredOfferingHints ?? []) {
    const name = normalizeClaimText(offering.name);
    const description = normalizeClaimText(offering.description);
    if (
      description.length >= 8 &&
      visible.includes(description) &&
      !isPhraseSupported(description, supportEvidence)
    ) {
      throw new Error("Unsupported claim directly reuses an inferred offering description.");
    }
    if (
      name.length >= 3 &&
      framedText.includes(name) &&
      !isPhraseSupported(name, supportEvidence)
    ) {
      throw new Error("Unsupported claim presents an inferred offering as a public service.");
    }
  }

  if (policy.mode === "guidance-only") {
    for (const chunk of extractVisibleChunks(indexHtml)) {
      if (
        isBusinessAttributedAssertion(chunk, brief?.business?.name) &&
        !isAssertionSupported(chunk, brief?.business?.name, supportEvidence)
      ) {
        throw new Error("Unsupported claim attributes an unconfirmed operation to the business.");
      }
    }
  }

  return indexHtml;
}

function publicOffering(offering) {
  return {
    name: String(offering?.name ?? "").trim(),
    description: String(offering?.description ?? "").trim(),
  };
}

function collectSupportEvidence(brief, confirmedOfferings, confirmedFacts) {
  const businessName = normalizeClaimText(brief?.business?.name);
  const city = normalizeClaimText(brief?.business?.city);
  const facts = confirmedFacts
    .filter((fact) => {
      const label = normalizeClaimText(fact.label);
      const value = normalizeClaimText(fact.value);
      return !["business name", "city"].includes(label) && value !== businessName && value !== city;
    })
    .flatMap((fact) => [fact.label, fact.value]);
  const contact = Object.entries(brief?.contact ?? {})
    .filter(([, value]) => nonempty(value))
    .map(([label, value]) => `${label} ${value}`);
  return [
    ...confirmedOfferings.flatMap((offering) => [offering.name, offering.description]),
    ...facts,
    ...contact,
  ]
    .map(normalizeClaimText)
    .filter(Boolean);
}

function isBusinessAttributedAssertion(text, businessName) {
  const normalized = normalizeClaimText(text);
  if (!OPERATIONAL_VERB_PATTERN.test(normalized)) return false;
  if (/\b(?:we|our)\b/i.test(normalized)) return true;

  const name = normalizeClaimText(businessName);
  if (!name) return false;
  const escaped = escapeRegExp(name);
  return (
    new RegExp(`\\b${escaped}\\b(?:\\s+\\w+){0,6}\\s+${OPERATIONAL_VERB_PATTERN.source}`, "i").test(normalized) ||
    new RegExp(`${OPERATIONAL_VERB_PATTERN.source}(?:\\s+\\w+){0,6}\\s+by\\s+\\b${escaped}\\b`, "i").test(normalized)
  );
}

function isAssertionSupported(text, businessName, supportEvidence) {
  if (supportEvidence.length === 0) return false;
  const nameTokens = new Set(tokensFor(businessName));
  const claimTokens = [...new Set(tokensFor(text))].filter(
    (token) => !nameTokens.has(token) && !GENERIC_WORDS.has(token),
  );
  if (claimTokens.length === 0) return false;
  const evidenceTokens = new Set(supportEvidence.flatMap(tokensFor));
  const overlap = claimTokens.filter((token) => evidenceTokens.has(token));
  return overlap.length >= Math.min(2, claimTokens.length);
}

function isPhraseSupported(phrase, supportEvidence) {
  const normalized = normalizeClaimText(phrase);
  if (supportEvidence.some((value) => value.includes(normalized))) return true;
  const phraseTokens = [...new Set(tokensFor(normalized))].filter((token) => !GENERIC_WORDS.has(token));
  if (phraseTokens.length === 0) return false;
  const evidenceTokens = new Set(supportEvidence.flatMap(tokensFor));
  const overlap = phraseTokens.filter((token) => evidenceTokens.has(token));
  return overlap.length >= Math.min(2, phraseTokens.length);
}

function extractVisibleChunks(html) {
  const chunks = [];
  for (const match of html.matchAll(/<(?:h[1-6]|p|li|a|button)\b[^>]*>([^]*?)<\/(?:h[1-6]|p|li|a|button)>/gi)) {
    const text = extractVisibleText(match[1]);
    if (text) chunks.push(text);
  }
  return chunks;
}

function extractServiceFraming(html) {
  const framed = [];
  for (const match of html.matchAll(/<(?:h[1-6]|a|button)\b[^>]*>([^]*?)<\/(?:h[1-6]|a|button)>/gi)) {
    framed.push(extractVisibleText(match[1]));
  }
  for (const match of html.matchAll(/<section\b([^>]*)>([^]*?)<\/section>/gi)) {
    if (/(?:id|class|data-section)\s*=\s*["'][^"']*(?:offer|service|menu|product)[^"']*["']/i.test(match[1])) {
      framed.push(extractVisibleText(match[2]));
    }
  }
  return framed.join(" ");
}

function extractVisibleText(html) {
  return String(html)
    .replace(/<!--[^]*?-->/g, " ")
    .replace(/<style\b[^>]*>[^]*?<\/style>/gi, " ")
    .replace(/<script\b[^>]*>[^]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(?:nbsp|#160);/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;|&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(x[0-9a-f]+|\d+);/gi, (_, value) => {
      const codePoint = value[0].toLowerCase() === "x"
        ? Number.parseInt(value.slice(1), 16)
        : Number.parseInt(value, 10);
      return Number.isSafeInteger(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff
        ? String.fromCodePoint(codePoint)
        : " ";
    })
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeClaimText(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9$]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokensFor(value) {
  return normalizeClaimText(value)
    .split(" ")
    .filter(Boolean)
    .map(normalizeToken);
}

function normalizeToken(token) {
  const value = String(token).toLocaleLowerCase("en-US");
  const aliases = {
    appointments: "appointment",
    bicycles: "bicycle",
    bike: "bicycle",
    bikes: "bicycle",
    bookings: "book",
    booked: "book",
    booking: "book",
    delivered: "deliver",
    deliveries: "deliver",
    delivery: "deliver",
    delivering: "deliver",
    flowers: "flower",
    floral: "flower",
    florals: "flower",
    loaves: "loaf",
    ordering: "order",
    ordered: "order",
    orders: "order",
    repairs: "repair",
    repaired: "repair",
    repairing: "repair",
    reservations: "reservation",
  };
  if (aliases[value]) return aliases[value];
  if (value.length > 4 && value.endsWith("s")) return value.slice(0, -1);
  return value;
}

function nonempty(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
