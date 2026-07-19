import { readFile } from "node:fs/promises";

import { deriveClaimPolicy } from "./claim-policy.js";
import { requestStructured } from "./lib/openai.js";

const projectRoot = new URL("../", import.meta.url);
const promptUrl = new URL("prompts/intake-system.md", projectRoot);
const schemaUrl = new URL("prompts/schemas/brief.schema.json", projectRoot);

export async function createBrief({
  businessName,
  city = null,
  details = null,
  fast = false,
  model = process.env.OPENAI_MODEL || "gpt-5.6",
  client,
  structuredRequester = requestStructured,
}) {
  const cleanName = requireText(businessName, "Business name is required.");
  const cleanCity = optionalText(city);
  const cleanDetails = optionalText(details);

  const [systemPrompt, schema] = await Promise.all([
    readFile(promptUrl, "utf8"),
    readFile(schemaUrl, "utf8").then(JSON.parse),
  ]);

  const candidate = await structuredRequester({
    client,
    model,
    schema,
    schemaName: "mainstreet_brief",
    systemPrompt,
    userPayload: {
      mode: fast ? "fast" : "interview",
      businessName: cleanName,
      city: cleanCity,
      ownerDetails: cleanDetails,
      safety: {
        preciseUnknownFactsMustBeNull: true,
        visibleCopyMayUseEmoji: false,
        visibleCopyMayUseDashes: false,
      },
    },
    maxOutputTokens: 8_000,
  });

  const brief = normalizeBrief(candidate, {
    businessName: cleanName,
    city: cleanCity,
    details: cleanDetails,
    fast,
  });
  assertBriefShape(brief);
  return brief;
}

export function sanitizeVisibleCopy(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/[-\u2010-\u2015]/g, " ")
    .replace(/\p{Extended_Pictographic}/gu, "")
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .trim();
}

function normalizeBrief(candidate, input) {
  const brief = structuredClone(candidate);

  brief.schemaVersion = "1.0";
  brief.mode = input.fast ? "fast" : "interview";
  brief.business.name = input.businessName;
  brief.business.city = input.city;

  brief.business.category = sanitizeVisibleCopy(brief.business.category);
  brief.business.summary = sanitizeVisibleCopy(brief.business.summary);
  brief.audience = sanitizeObjectStrings(brief.audience);
  brief.offerings = sanitizeObjectStrings(brief.offerings);
  brief.brand.personality = brief.brand.personality.map(sanitizeVisibleCopy);
  brief.brand.voice = sanitizeVisibleCopy(brief.brand.voice);
  brief.brand.aesthetic = sanitizeVisibleCopy(brief.brand.aesthetic);
  brief.brand.signatureMove = sanitizeObjectStrings(brief.brand.signatureMove);
  brief.content = sanitizeObjectStrings(brief.content);

  brief.facts.confirmed = [
    { label: "Business name", value: input.businessName, source: "user" },
    ...(input.city
      ? [{ label: "City", value: input.city, source: "user" }]
      : []),
    ...(input.details
      ? [{ label: "Owner details", value: input.details, source: "user" }]
      : []),
  ];

  if (input.fast) {
    brief.contact = {
      phone: null,
      email: null,
      address: null,
      hours: null,
    };
  }

  if (input.fast && deriveClaimPolicy(brief).mode === "guidance-only") {
    applyGuidanceOnlyPublicCopy(brief);
  }

  return brief;
}

function applyGuidanceOnlyPublicCopy(brief) {
  const category = sanitizeVisibleCopy(brief.business.category) || "local business";
  const categoryLower = category.toLocaleLowerCase("en-US");
  brief.business.summary = `A planning guide inspired by ${categoryLower}. Service and availability details are not confirmed.`;
  brief.content = {
    eyebrow: "Local inspiration",
    headline: "Explore Ideas",
    subheadline: `A practical starting point for considering ${categoryLower} before confirming details with the business.`,
    about: "Use these notes to clarify priorities, setting, and personal preferences before confirming details.",
    primaryAction: "Explore Ideas",
    secondaryAction: "Read Guidance",
    contactPrompt: "Confirm Details",
  };
}

function sanitizeObjectStrings(value) {
  if (Array.isArray(value)) {
    return value.map(sanitizeObjectStrings);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [
        key,
        key === "confidence" ? child : sanitizeObjectStrings(child),
      ]),
    );
  }
  return typeof value === "string" ? sanitizeVisibleCopy(value) : value;
}

function assertBriefShape(brief) {
  const requiredObjects = [
    "business",
    "audience",
    "brand",
    "content",
    "contact",
    "facts",
  ];
  for (const key of requiredObjects) {
    if (!brief?.[key] || typeof brief[key] !== "object") {
      throw new TypeError(`Generated brief is missing ${key}.`);
    }
  }
  if (!Array.isArray(brief.offerings) || brief.offerings.length === 0) {
    throw new TypeError("Generated brief must include at least one offering.");
  }
}

function requireText(value, message) {
  const text = String(value ?? "").trim();
  if (!text) {
    throw new TypeError(message);
  }
  return text;
}

function optionalText(value) {
  const text = String(value ?? "").trim();
  return text || null;
}
