const POLICY_LIMITS = Object.freeze({
  facts: 8,
  offeringHints: 6,
  offeringName: 120,
  offeringDescription: 240,
  ownerDetails: 2_000,
  clause: 400,
  clauses: 8,
  clauseCharacters: 1_800,
});

const TRUSTED_FACT_LABELS = new Map([
  ["business name", "identity"],
  ["city", "city"],
  ["owner details", "details"],
]);

const INTERACTIVE_TAGS = new Set(["a", "button", "summary"]);
const HUMAN_ATTRIBUTE_NAMES = new Set([
  "alt",
  "aria-description",
  "aria-label",
  "label",
  "placeholder",
  "title",
]);
const BLOCK_TAGS = new Set([
  "address",
  "article",
  "aside",
  "blockquote",
  "body",
  "caption",
  "dd",
  "details",
  "dialog",
  "div",
  "dt",
  "fieldset",
  "figcaption",
  "figure",
  "footer",
  "form",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "header",
  "legend",
  "li",
  "main",
  "nav",
  "ol",
  "option",
  "p",
  "pre",
  "section",
  "summary",
  "table",
  "tbody",
  "td",
  "tfoot",
  "th",
  "thead",
  "tr",
  "ul",
]);
const BROAD_CONTAINER_TAGS = new Set([
  "article",
  "aside",
  "body",
  "details",
  "dialog",
  "div",
  "fieldset",
  "figure",
  "footer",
  "form",
  "header",
  "main",
  "nav",
  "ol",
  "section",
  "table",
  "tbody",
  "tfoot",
  "thead",
  "tr",
  "ul",
]);
const CAPTURE_TAGS = new Set([
  ...BLOCK_TAGS,
  "a",
  "button",
  "label",
  "output",
  "small",
  "text",
  "title",
]);

const OPERATION_TOKENS = new Set([
  "bake",
  "book",
  "build",
  "buy",
  "carry",
  "cater",
  "clean",
  "create",
  "deliver",
  "design",
  "estimate",
  "groom",
  "host",
  "install",
  "make",
  "offer",
  "order",
  "pickup",
  "plan",
  "provide",
  "quote",
  "repair",
  "reserve",
  "schedule",
  "sell",
  "serve",
  "ship",
  "shop",
  "stock",
]);

const CLAIM_NOUNS = new Set([
  "appointment",
  "arrangement",
  "booking",
  "bouquet",
  "bread",
  "cake",
  "catering",
  "cleaning",
  "coffee",
  "delivery",
  "estimate",
  "floral",
  "flower",
  "grooming",
  "hour",
  "installation",
  "lesson",
  "loaf",
  "meal",
  "menu",
  "order",
  "pickup",
  "price",
  "product",
  "quote",
  "repair",
  "reservation",
  "sale",
  "service",
  "shipping",
  "tuneup",
]);

const NEGATIVE_PATTERN = /\b(?:are not|aren t|cannot|can t|cant|does not|doesn t|do not|don t|is not|isn t|never|no longer|not|unavailable|without|won t|wont)\b/;
const STRUCTURAL_COPY_PATTERN = /^(?:confirmed details|confirm details|known services|our services|service details|services|offerings|products|menu|planning notes|planning context|useful directions|useful questions|explore ideas|explore services|read guidance|local context)$/;

export function deriveClaimPolicy(brief) {
  const provenance = readTrustedProvenance(brief);
  const offeringHints = sanitizeOfferingHints(brief?.offerings);
  const positiveClauses = provenance.status === "valid"
    ? provenance.clauses.filter((clause) => clause.polarity === "positive")
    : [];
  const confirmedOfferings = [];
  const inferredOfferingHints = [];

  for (const offering of offeringHints) {
    const namePhrase = normalizeClaimText(offering.name);
    const descriptionPhrase = normalizeClaimText(offering.description);
    const sharedEvidence = positiveClauses.find((clause) =>
      detectModality(clause.normalized) === "asserted" &&
      containsWholePhrase(clause.normalized, namePhrase) &&
      containsWholePhrase(clause.normalized, descriptionPhrase),
    );
    if (sharedEvidence) {
      confirmedOfferings.push(offering);
    } else {
      inferredOfferingHints.push(offering);
    }
  }

  return {
    schemaVersion: "2.0",
    mode: confirmedOfferings.length > 0 ? "confirmed-offerings" : "guidance-only",
    provenanceStatus: provenance.status,
    confirmedOfferings,
    inferredOfferingHints,
    confirmedUserClauses: provenance.status === "valid"
      ? provenance.clauses.map((clause) => clause.text)
      : [],
    guidanceNote: "Service and availability details are not confirmed.",
    rules: {
      onlyUserConfirmedClausesAuthorizeClaims: true,
      offeringConfidenceDoesNotConfirmClaims: true,
      sameClausePredicatePolarityAndScopeRequired: true,
      contactFieldsDoNotAuthorizeClaims: true,
      revisionsMustReauditHumanFacingCopy: true,
    },
  };
}

/**
 * Conservative publication defense in depth. Prompt and critic review remain
 * required because deterministic text checks are not a natural language proof.
 */
export function validateBriefClaims(input, brief) {
  const policy = deriveClaimPolicy(brief);
  const surfaces = typeof input === "string"
    ? extractClaimSurfaces(input)
    : normalizeExternalSurfaces(input);
  const identityPhrases = identityClaims(brief);
  const trustedClauses = policy.confirmedUserClauses.map(toClauseRecord);
  const offeringHints = [...policy.confirmedOfferings, ...policy.inferredOfferingHints];
  const confirmedOfferingPhrases = policy.confirmedOfferings
    .flatMap((offering) => [offering.name, offering.description])
    .map(normalizeClaimText)
    .filter(Boolean);

  for (const surface of surfaces) {
    if (containsUndecodedNamedEntity(surface.text)) {
      throw new Error("Unauditable named HTML entity is not allowed on a human facing surface.");
    }
    for (const text of splitRenderableClauses(surface.text)) {
      const normalized = normalizeClaimText(text);
      if (!normalized || isExactSafeIdentity(normalized, identityPhrases)) continue;
      if (isIdentityUtilityLabel(normalized, identityPhrases) || isIdentityCarrierCopy(normalized, identityPhrases)) continue;
      if (confirmedOfferingPhrases.includes(normalized)) continue;
      if (hasMixedScriptAfterCanonicalization(text)) {
        throw new Error("Unauditable mixed script text is not allowed on a human facing surface.");
      }

      const claim = analyzeClaim({ ...surface, text, normalized }, brief, offeringHints);
      if (!claim) continue;
      if (!isSupportedByOneClause(claim, trustedClauses, brief?.business?.name)) {
        throw new Error(`Unsupported claim is not proven by one user confirmed clause: ${claim.reason}: "${claim.text.slice(0, 180)}".`);
      }
    }
  }

  return input;
}

function readTrustedProvenance(brief) {
  const facts = brief?.facts;
  if (!isPlainObject(facts) || !Object.hasOwn(facts, "confirmed")) {
    return { status: "missing", clauses: [] };
  }
  if (!Array.isArray(facts.confirmed) || facts.confirmed.length > POLICY_LIMITS.facts) {
    return { status: "invalid", clauses: [] };
  }

  const ownerValues = [];
  for (const fact of facts.confirmed) {
    if (!isPlainObject(fact)) return { status: "invalid", clauses: [] };
    const label = boundedString(fact.label, 80);
    const value = boundedString(fact.value, POLICY_LIMITS.ownerDetails);
    if (!label || !value || fact.source !== "user") return { status: "invalid", clauses: [] };
    const kind = TRUSTED_FACT_LABELS.get(normalizeClaimText(label));
    if (!kind) return { status: "invalid", clauses: [] };

    if (kind === "identity") {
      if (normalizeClaimText(value) !== normalizeClaimText(brief?.business?.name)) {
        return { status: "invalid", clauses: [] };
      }
      continue;
    }
    if (kind === "city") {
      if (normalizeClaimText(value) !== normalizeClaimText(brief?.business?.city)) {
        return { status: "invalid", clauses: [] };
      }
      continue;
    }
    ownerValues.push(value);
  }

  if (ownerValues.join(" ").length > POLICY_LIMITS.ownerDetails) {
    return { status: "invalid", clauses: [] };
  }

  const clauses = [];
  let characterCount = 0;
  for (const value of ownerValues) {
    for (const text of splitTrustedClauses(value)) {
      if (
        clauses.length >= POLICY_LIMITS.clauses ||
        text.length > POLICY_LIMITS.clause ||
        characterCount + text.length > POLICY_LIMITS.clauseCharacters
      ) continue;
      const clause = toClauseRecord(text);
      if (!clause.normalized) continue;
      clauses.push(clause);
      characterCount += text.length;
    }
  }
  return { status: "valid", clauses };
}

function sanitizeOfferingHints(value) {
  if (!Array.isArray(value)) return [];
  const hints = [];
  for (const offering of value) {
    if (hints.length >= POLICY_LIMITS.offeringHints) break;
    if (!isPlainObject(offering)) continue;
    const name = boundedString(offering.name, POLICY_LIMITS.offeringName);
    const description = boundedString(offering.description, POLICY_LIMITS.offeringDescription);
    if (!name || !description) continue;
    hints.push({ name, description });
  }
  return hints;
}

function containsWholePhrase(value, phrase) {
  if (!phrase) return false;
  return value === phrase ||
    value.startsWith(`${phrase} `) ||
    value.endsWith(` ${phrase}`) ||
    value.includes(` ${phrase} `);
}

function analyzeClaim(surface, brief, offeringHints) {
  const { normalized } = surface;
  if (STRUCTURAL_COPY_PATTERN.test(normalized)) return null;

  const intent = detectIntent(normalized, surface.action);
  if (intent) return claimRecord(surface.text, normalized, `transactional intent ${intent}`);

  if (isContactClaim(surface.text, normalized)) return claimRecord(surface.text, normalized, "contact detail");
  if (isReputationHistoryOrCredentialClaim(normalized)) {
    return claimRecord(surface.text, normalized, "reputation history or credential");
  }
  if (isHoursClaim(normalized)) return claimRecord(surface.text, normalized, "business hours");
  if (isPriceClaim(normalized)) return claimRecord(surface.text, normalized, "price");
  if (isHonestImageDescription(surface, normalized)) return null;
  if (isAvailabilityOrScopeClaim(normalized)) {
    return claimRecord(surface.text, normalized, "availability or scope");
  }
  if (isInformationalCopy(normalized)) return null;

  for (const offering of offeringHints) {
    for (const value of [offering.name, offering.description]) {
      const phrase = normalizeClaimText(value);
      if (phrase && (normalized === phrase || normalized.includes(phrase))) {
        return claimRecord(surface.text, normalized, "offering statement");
      }
    }
  }

  if (isAttributedOperation(normalized, brief?.business?.name)) {
    return claimRecord(surface.text, normalized, "business operation");
  }

  if (isCommercialNounPhrase(surface, normalized)) {
    return claimRecord(surface.text, normalized, "commercial offering");
  }
  return null;
}

function claimRecord(text, normalized, reason) {
  return {
    text,
    normalized,
    polarity: detectPolarity(normalized),
    reason,
  };
}

function detectIntent(value, actionSurface) {
  const normalized = canonicalPhrases(value)
    .replace(/^please\s+/, "")
    .replace(/^(?:click|tap)(?:\s+here)?\s+to\s+/, "")
    .replace(/\bin order to\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (/^(?:compare|consider|explore|gather|learn|note|plan|read|think|use)\b/.test(normalized)) {
    return null;
  }
  const wordCount = normalized.split(" ").filter(Boolean).length;
  const commandLike = actionSurface || wordCount <= 7;
  if (!commandLike) return null;
  if (/^(?:buy|purchase|add to cart|checkout)(?:\b| )/.test(normalized)) return "purchase";
  if (/^shop(?:\b| )/.test(normalized) && !/^shop (?:class|floor|local|owner|talk|tool)\b/.test(normalized)) {
    return "shop";
  }
  if (/^order(?:\b| )/.test(normalized) && !/^order (?:of|to)\b/.test(normalized)) return "order";
  if (/^(?:book|reserve|schedule)(?:\b| )/.test(normalized) && !/^book (?:club|shop|store|talk)\b/.test(normalized)) {
    return "reservation";
  }
  if (/^appointment(?:\b| )/.test(normalized)) return "reservation";
  if (/^quote(?:\b| )/.test(normalized)) return "quote";
  if (/^(?:(?:get|request) )?(?:same day )?(?:delivery|shipping|pickup|pick up)(?:\b| )/.test(normalized)) {
    return "fulfillment";
  }
  return null;
}

function isHoursClaim(value) {
  return (
    value === "hours" ||
    /\b(?:business hours|hours of operation|opening hours)\b/.test(value) ||
    /\b(?:open|closed)\b[^.!?]{0,40}\b(?:daily|today|monday|tuesday|wednesday|thursday|friday|saturday|sunday|every day|from|until|am|pm)\b/.test(value) ||
    /\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|weekdays?|weekends?)\b[^.!?]{0,30}\b(?:open|closed|am|pm|[0-9]{1,2}(?: [0-9]{2})? (?:to|until) [0-9]{1,2})\b/.test(value)
  );
}

function isPriceClaim(value) {
  return /(?:^| )\$ ?[0-9]|\b(?:cost|costs|price|priced|prices|pricing)\b/.test(value);
}

function isAttributedOperation(value, businessName) {
  const tokens = tokensFor(value);
  if (["our", "we"].includes(tokens[0])) return true;
  if (["the", "this"].includes(tokens[0]) && tokens[1] === "business") return true;

  const nameTokens = tokensFor(businessName);
  if (nameTokens.length === 0) return false;
  for (let index = 0; index <= tokens.length - nameTokens.length; index += 1) {
    if (!nameTokens.every((token, offset) => tokens[index + offset] === token)) continue;
    if (tokens.length > nameTokens.length && (index === 0 || tokens[index - 1] === "by")) return true;
  }
  return false;
}

function isContactClaim(raw, normalized) {
  const source = canonicalUnicode(raw).toLowerCase();
  const hasPhone = [...source.matchAll(/\+?[0-9][0-9\s().-]{5,}[0-9]/g)].some((match) => {
    const digits = match[0].replace(/\D/g, "");
    return digits.length >= 7 && digits.length <= 15 && (
      match[0].startsWith("+") ||
      /[().-]/.test(match[0]) ||
      /\b(?:call|fax|mobile|phone|tel|text|whatsapp)\b/.test(source)
    );
  });
  return (
    /\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/i.test(source) ||
    hasPhone ||
    /\b(?:1 )?[2-9][0-9]{2} [0-9]{3} [0-9]{4}\b/.test(normalized) ||
    /\b[2-9][0-9]{9}\b/.test(normalized) ||
    /\b[0-9]{1,6} [a-z0-9 ]{1,50} (?:avenue|ave|boulevard|blvd|drive|dr|highway|hwy|lane|ln|road|rd|street|st|way)\b/.test(normalized)
  );
}

function isReputationHistoryOrCredentialClaim(value) {
  return (
    /\b(?:award winning|award winner|certified|family owned|founded|insured|licensed|locally owned|veteran owned)\b/.test(value) ||
    /\b(?:five|[1-5]) stars?\b/.test(value) ||
    /\b(?:rated|rating)\b[^.!?]{0,40}\b(?:stars?|customers?|clients?|reviews?)\b/.test(value) ||
    /\b(?:customers?|clients?|neighbors?)\b[^.!?]{0,30}\b(?:love|rate|recommend|say)\b/.test(value) ||
    /\b(?:established|serving|since)\b[^.!?]{0,20}\b(?:18|19|20)[0-9]{2}\b/.test(value) ||
    /\b[0-9]+ years? (?:in business|of experience)\b/.test(value)
  );
}

function isHonestImageDescription(surface, value) {
  if (surface.kind !== "attribute:alt") return false;
  if (/\b(?:available|daily|every day|free|nationwide|same day|today|unavailable)\b/.test(value)) return false;
  if (/^(?:our|we)\b/.test(value)) return false;
  return /\b(?:arranged|beside|close detail|contemporary|displayed|exterior|image|in natural|interior|materials|photograph|portrait|scene|shaping|shelf|still life|view|work surface)\b/.test(value) ||
    (tokensFor(value).length >= 4 && /\b(?:a|an|and|at|beside|in|near|on|with)\b/.test(value));
}

function isInformationalCopy(value) {
  if (/^(?:compare|consider|explore|gather|learn|note|plan|read|think)\b/.test(value)) return true;
  return /^use\b/.test(value) &&
    /\b(?:checklist|guide|ideas|information|management|notes|questions|reference|tips|worksheet)\b/.test(value);
}

function isAvailabilityOrScopeClaim(value) {
  if (/\b(?:available|in stock|nationwide|unavailable)\b/.test(value)) return true;
  const words = new Set(tokensFor(value));
  const hasClaimNoun = [...words].some((word) => CLAIM_NOUNS.has(word) || OPERATION_TOKENS.has(word));
  if (!hasClaimNoun) return false;
  return /\b(?:available|daily|every day|fresh|free|in stock|nationwide|same day|today|unavailable)\b/.test(value);
}

function isCommercialNounPhrase(surface, value) {
  if (/\bin order to\b/.test(value)) return false;
  if (/^h[3-6]$/.test(surface.tagName ?? "")) {
    return !/\b(?:context|direction|fit|guide|ideas|moment|mood|pattern|priorities|priority|questions|setting|size|style)$/.test(value);
  }
  if (surface.kind === "attribute:alt") return true;
  const words = new Set(tokensFor(value));
  const hasCommercialNoun = [...words].some((word) => CLAIM_NOUNS.has(word));
  if (!hasCommercialNoun) return false;
  if ([...words].some((word) => OPERATION_TOKENS.has(word))) return true;
  return /\b(?:custom|fresh|handmade|same day)\b/.test(value);
}

function isSupportedByOneClause(claim, clauses, businessName) {
  if (clauses.length === 0) return false;
  const proposition = propositionTokens(claim.normalized, businessName);
  if (proposition.length === 0) return false;
  return clauses.some((clause) => {
    if (clause.polarity !== claim.polarity) return false;
    if (detectModality(clause.normalized) !== detectModality(claim.normalized)) return false;
    const claimRestrictions = new Set(restrictionSignatures(claim.normalized));
    if (restrictionSignatures(clause.normalized).some((restriction) => !claimRestrictions.has(restriction))) {
      return false;
    }
    const evidence = propositionTokens(clause.normalized, businessName);
    return sameSequence(proposition, evidence) || supportsTransactionalIntent(claim, evidence);
  });
}

function sameSequence(left, right) {
  return left.length === right.length && left.every((token, index) => token === right[index]);
}

function supportsTransactionalIntent(claim, evidenceTokens) {
  if (!claim.reason.startsWith("transactional intent ")) return false;
  const intent = claim.reason.slice("transactional intent ".length);
  const family = intent === "shop" ? "purchase" : intent;
  const evidence = new Set(evidenceTokens);
  const requiredOperation = {
    fulfillment: "deliver",
    order: "order",
    purchase: "buy",
    quote: "quote",
    reservation: "reserve",
  }[family];
  if (!requiredOperation || !evidence.has(requiredOperation)) return false;

  const permittedEvidence = new Set([
    requiredOperation,
    "a",
    "an",
    "are",
    "available",
    "can",
    "currently",
    "day",
    "free",
    "is",
    "local",
    "nationwide",
    "now",
    "online",
    "same",
  ]);
  if (evidenceTokens.some((token) => !permittedEvidence.has(token))) return false;

  const claimQualifiers = tokensFor(claim.normalized)
    .filter((token) => ["day", "free", "local", "nationwide", "online", "same"].includes(token));
  return claimQualifiers.every((token) => evidence.has(token));
}

function detectModality(value) {
  return /\b(?:could|may|might|perhaps|possibly|potentially)\b/.test(value) ? "tentative" : "asserted";
}

function restrictionSignatures(value) {
  const normalized = canonicalPhrases(value);
  const restrictions = [];
  if (/\bonly\b/.test(normalized)) restrictions.push("only");
  if (/\bby (?:appointment|reservation)\b/.test(normalized)) restrictions.push("by-reservation");
  if (/\bupon request\b/.test(normalized)) restrictions.push("upon-request");
  if (/\bwith (?:a )?purchase\b/.test(normalized)) restrictions.push("with-purchase");
  for (const token of ["limited", "seasonal", "seasonally", "select"]) {
    if (new RegExp(`\\b${token}\\b`).test(normalized)) restrictions.push(normalizeToken(token));
  }
  return [...new Set(restrictions)].sort();
}

function propositionTokens(value, businessName) {
  const tokens = tokensFor(canonicalPhrases(value));
  const nameTokens = tokensFor(businessName);
  let cursor = 0;
  if (tokens[0] === "we") {
    cursor = 1;
    if (["offer", "provide"].includes(tokens[cursor])) cursor += 1;
  } else if (
    nameTokens.length > 0 &&
    nameTokens.every((token, index) => tokens[index] === token)
  ) {
    cursor = nameTokens.length;
    if (["offer", "provide"].includes(tokens[cursor])) cursor += 1;
  }
  return tokens.slice(cursor);
}

function extractClaimSurfaces(html) {
  const source = String(html);
  const surfaces = [];
  const stack = [{
    action: false,
    capture: true,
    directText: "",
    hasBlockChild: false,
    parts: [],
    tagName: "#document",
  }];
  for (const token of tokenizeHtml(source)) {
    const rawTextFrame = [...stack].reverse()
      .find((frame) => ["script", "style", "template"].includes(frame.tagName));
    if (rawTextFrame) {
      if (token.type === "tag" && token.closing && token.tagName === rawTextFrame.tagName) {
        closeThroughTag(stack, token.tagName, surfaces);
      }
      continue;
    }

    if (token.type === "text") {
      const text = decodeHtmlEntities(token.value);
      if (!text) continue;
      for (const frame of stack) {
        if (frame.capture) frame.parts.push(text);
      }
      const directFrame = [...stack].reverse().find((frame) => frame.capture);
      if (directFrame) directFrame.directText += text;
      continue;
    }

    const { raw, tagName } = token;
    if (token.closing) {
      closeThroughTag(stack, tagName, surfaces);
      continue;
    }

    const attributes = parseAttributes(token.attributeSource);
    const role = normalizeClaimText(attributes.role);
    const action = INTERACTIVE_TAGS.has(tagName) || ["button", "link", "menuitem"].includes(role) ||
      (tagName === "input" && /^(?:button|reset|submit)$/.test(normalizeClaimText(attributes.type)));
    for (const frame of stack) {
      if (BLOCK_TAGS.has(tagName) && frame.capture) {
        frame.parts.push(" ");
        frame.hasBlockChild = true;
      }
    }
    collectAttributeSurfaces(surfaces, tagName, attributes, action);

    const frame = {
      action,
      capture: CAPTURE_TAGS.has(tagName),
      directText: "",
      hasBlockChild: false,
      parts: [],
      tagName,
    };
    stack.push(frame);
    if (/\/\s*>$/.test(raw) || ["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"].includes(tagName)) {
      closeThroughTag(stack, tagName, surfaces);
    }
  }
  while (stack.length > 0) finalizeFrame(stack.pop(), surfaces);
  return deduplicateSurfaces(surfaces);
}

function tokenizeHtml(source) {
  const tokens = [];
  let cursor = 0;
  while (cursor < source.length) {
    const open = source.indexOf("<", cursor);
    if (open < 0) {
      tokens.push({ type: "text", value: source.slice(cursor) });
      break;
    }
    if (open > cursor) tokens.push({ type: "text", value: source.slice(cursor, open) });
    if (source.startsWith("<!--", open)) {
      const commentEnd = source.indexOf("-->", open + 4);
      cursor = commentEnd < 0 ? source.length : commentEnd + 3;
      continue;
    }

    const end = findQuotedTagEnd(source, open + 1);
    if (end < 0) {
      tokens.push({ type: "text", value: source.slice(open) });
      break;
    }
    const raw = source.slice(open, end + 1);
    const parsed = raw.match(/^<\s*(\/?)\s*([a-z][a-z0-9:-]*)\b([\s\S]*?)>$/i);
    if (parsed) {
      tokens.push({
        type: "tag",
        raw,
        closing: parsed[1] === "/",
        tagName: parsed[2].toLowerCase(),
        attributeSource: parsed[3] ?? "",
      });
    }
    cursor = end + 1;
  }
  return tokens;
}

function findQuotedTagEnd(source, start) {
  let quote = null;
  for (let index = start; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
    } else if (character === ">") {
      return index;
    }
  }
  return -1;
}

function closeThroughTag(stack, tagName, surfaces) {
  const index = stack.map((frame) => frame.tagName).lastIndexOf(tagName);
  if (index < 0) return;
  while (stack.length > index) finalizeFrame(stack.pop(), surfaces);
  for (const frame of stack) {
    if (BLOCK_TAGS.has(tagName) && frame.capture) frame.parts.push(" ");
  }
}

function finalizeFrame(frame, surfaces) {
  if (!frame?.capture) return;
  const text = collapseHumanText(frame.parts.join(""));
  const directText = collapseHumanText(frame.directText);
  if (!text) return;
  const broadContainer = BROAD_CONTAINER_TAGS.has(frame.tagName) || frame.tagName === "#document";
  if (broadContainer && frame.hasBlockChild && !directText) return;
  const auditedText = broadContainer && frame.hasBlockChild
    ? directText
    : text;
  if (!auditedText) return;
  surfaces.push({
    action: frame.action,
    kind: "text",
    tagName: frame.tagName,
    text: auditedText,
  });
}

function collectAttributeSurfaces(surfaces, tagName, attributes, action) {
  for (const [name, value] of Object.entries(attributes)) {
    if (!value) continue;
    if (HUMAN_ATTRIBUTE_NAMES.has(name)) {
      surfaces.push({ action, kind: `attribute:${name}`, tagName, text: value });
    }
    if (name === "value" && tagName === "input" && normalizeClaimText(attributes.type) !== "hidden") {
      surfaces.push({ action, kind: "attribute:value", tagName, text: value });
    }
  }

  if (tagName === "meta" && attributes.content && !normalizeClaimText(attributes["http-equiv"])) {
    const metadataName = normalizeClaimText(attributes.name || attributes.property);
    surfaces.push({ action: false, kind: `metadata:${metadataName || "unnamed"}`, tagName, text: attributes.content });
  }
}

function parseAttributes(source) {
  const attributes = {};
  const pattern = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  for (const match of String(source).matchAll(pattern)) {
    attributes[match[1].toLowerCase()] = decodeHtmlEntities(match[2] ?? match[3] ?? match[4] ?? "");
  }
  return attributes;
}

function normalizeExternalSurfaces(value) {
  if (!Array.isArray(value)) {
    throw new TypeError("HTML or collected human facing surfaces are required for claim validation.");
  }
  return value.flatMap((surface) => {
    if (typeof surface === "string" && surface.trim()) {
      return [{ action: false, kind: "rendered", tagName: null, text: surface }];
    }
    if (!isPlainObject(surface) || typeof surface.text !== "string" || !surface.text.trim()) return [];
    return [{
      action: surface.action === true,
      kind: boundedString(surface.kind, 80) ?? "rendered",
      tagName: boundedString(surface.tagName, 24)?.toLowerCase() ?? null,
      text: surface.text,
    }];
  });
}

function deduplicateSurfaces(surfaces) {
  const seen = new Set();
  return surfaces.filter((surface) => {
    const key = `${surface.kind}|${surface.action}|${surface.tagName}|${surface.text}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function identityClaims(brief) {
  return [brief?.business?.name, brief?.business?.category, brief?.business?.city]
    .map(normalizeClaimText)
    .filter(Boolean);
}

function isExactSafeIdentity(value, identities) {
  return identities.includes(value);
}

function isIdentityUtilityLabel(value, identities) {
  return identities.some((identity) =>
    value === `${identity} home` ||
    value === `${identity} homepage` ||
    value === `${identity} logo` ||
    value === `${identity} menu`,
  );
}

function isIdentityCarrierCopy(value, identities) {
  const carrierWords = new Set(["a", "about", "an", "by", "for", "guide", "inspired", "planning", "the", "to", "visual", "welcome"]);
  return identities.some((identity) => {
    const index = value.indexOf(identity);
    if (index < 0) return false;
    const remainder = `${value.slice(0, index)} ${value.slice(index + identity.length)}`
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    return remainder.length > 0 && remainder.every((word) => carrierWords.has(word));
  });
}

function splitTrustedClauses(value) {
  return collapseHumanText(value)
    .split(/[.!?;]+|\r?\n+|\s+(?:but|however)\s+/i)
    .map(collapseHumanText)
    .filter(Boolean);
}

function splitRenderableClauses(value) {
  const text = collapseHumanText(value);
  if (!text) return [];
  return text
    .split(/[.!?;]+|\r?\n+/)
    .map(collapseHumanText)
    .filter(Boolean);
}

function toClauseRecord(text) {
  const clean = collapseHumanText(text);
  const normalized = normalizeClaimText(clean);
  return { text: clean, normalized, polarity: detectPolarity(normalized) };
}

function detectPolarity(value) {
  return NEGATIVE_PATTERN.test(value) ? "negative" : "positive";
}

function containsUndecodedNamedEntity(value) {
  return /&[a-z][a-z0-9]{1,40};/i.test(String(value));
}

function canonicalPhrases(value) {
  return normalizeClaimText(value)
    .replace(/\bpick up\b/g, "pickup")
    .replace(/\bevery day\b/g, "daily")
    .replace(/\bget a quote\b/g, "quote")
    .replace(/\bget quote\b/g, "quote")
    .replace(/\brequest a quote\b/g, "quote")
    .replace(/\brequest quote\b/g, "quote");
}

function tokensFor(value) {
  return canonicalPhrases(value)
    .split(" ")
    .filter(Boolean)
    .map(normalizeToken);
}

function normalizeToken(token) {
  const value = String(token).toLowerCase();
  const aliases = {
    appointments: "reserve",
    appointment: "reserve",
    arrangements: "arrangement",
    bicycles: "bicycle",
    bike: "bicycle",
    bikes: "bicycle",
    booked: "reserve",
    booking: "reserve",
    bookings: "reserve",
    book: "reserve",
    bought: "buy",
    buys: "buy",
    bouquets: "bouquet",
    delivered: "deliver",
    deliveries: "deliver",
    delivery: "deliver",
    delivering: "deliver",
    estimates: "quote",
    estimate: "quote",
    flowers: "flower",
    floral: "flower",
    florals: "flower",
    loaves: "loaf",
    nationwide: "nationwide",
    national: "nationwide",
    ordered: "order",
    ordering: "order",
    orders: "order",
    purchased: "buy",
    purchases: "buy",
    purchase: "buy",
    repaired: "repair",
    repairing: "repair",
    repairs: "repair",
    reservations: "reserve",
    reservation: "reserve",
    reserve: "reserve",
    reserved: "reserve",
    schedule: "reserve",
    scheduled: "reserve",
    scheduling: "reserve",
    sales: "sell",
    sale: "sell",
    selling: "sell",
    sells: "sell",
    shipped: "deliver",
    shipping: "deliver",
    ships: "deliver",
    ship: "deliver",
    shopping: "buy",
    shops: "buy",
    shop: "buy",
    unavailable: "available",
  };
  if (aliases[value]) return aliases[value];
  if (value.length > 5 && value.endsWith("ies")) return `${value.slice(0, -3)}y`;
  if (value.length > 5 && value.endsWith("ing")) return value.slice(0, -3);
  if (value.length > 4 && value.endsWith("ed")) return value.slice(0, -2);
  if (value.length > 4 && value.endsWith("s")) return value.slice(0, -1);
  return value;
}

function normalizeClaimText(value) {
  return canonicalUnicode(value)
    .toLocaleLowerCase("en-US")
    .replace(/[^\p{L}\p{N}$%]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function canonicalUnicode(value) {
  return decodeHtmlEntities(String(value ?? ""))
    .normalize("NFKC")
    .replace(/[\u00ad\p{Cf}]/gu, "")
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "");
}

function hasMixedScriptAfterCanonicalization(value) {
  const canonical = canonicalUnicode(value);
  return /[a-z]/i.test(canonical) && /[^\x00-\x7f]/u.test(canonical.replace(/[^\p{L}]/gu, ""));
}

function decodeHtmlEntities(value) {
  const named = {
    amp: "&",
    apos: "'",
    copy: "©",
    gt: ">",
    hellip: "…",
    laquo: "«",
    ldquo: "“",
    lsquo: "‘",
    lt: "<",
    middot: "·",
    nbsp: " ",
    quot: '"',
    raquo: "»",
    rdquo: "”",
    reg: "®",
    rsquo: "’",
    shy: "\u00ad",
    trade: "™",
  };
  return String(value ?? "")
    .replace(/&#(x[0-9a-f]+|[0-9]+);?/gi, (match, encoded) => {
      const codePoint = encoded[0].toLowerCase() === "x"
        ? Number.parseInt(encoded.slice(1), 16)
        : Number.parseInt(encoded, 10);
      return Number.isSafeInteger(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff
        ? String.fromCodePoint(codePoint)
        : match;
    })
    .replace(/&([a-z][a-z0-9]+);/gi, (match, name) => named[name.toLowerCase()] ?? match);
}

function collapseHumanText(value) {
  return canonicalUnicode(value).replace(/\s+/g, " ").trim();
}

function boundedString(value, maxLength) {
  if (typeof value !== "string") return null;
  const text = collapseHumanText(value);
  return text && text.length <= maxLength ? text : null;
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
