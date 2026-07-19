import { readFile } from "node:fs/promises";

import { deriveClaimPolicy } from "./claim-policy.js";
import { requestStructured } from "./lib/openai.js";

const projectRoot = new URL("../", import.meta.url);
const promptUrl = new URL("prompts/intake-system.md", projectRoot);
const schemaUrl = new URL("prompts/schemas/brief.schema.json", projectRoot);
const questionPromptUrl = new URL("prompts/intake-questions-system.md", projectRoot);
const questionSchemaUrl = new URL("prompts/schemas/intake-questions.schema.json", projectRoot);
const interviewFields = Object.freeze([
  { key: "services", label: "Available services" },
  { key: "hours", label: "Hours" },
  { key: "vibe", label: "Vibe" },
  { key: "photos", label: "Photos" },
  { key: "contact", label: "Contact facts" },
  { key: "customerValue", label: "Customer value" },
]);
const maxInterviewQuestionLength = 240;
const maxInterviewAnswerLength = 300;
const sensitiveRequestPattern =
  /\b(?:api\s*key|access\s*token|authentication\s*token|password|passcode|client\s*secret|secret\s*key|private\s*key|recovery\s*code|cvv|cvc|pin|(?:credit|debit)\s*card\s*number|bank\s*account(?:\s*(?:number|credentials?))?|financial\s+account\s+details?|social\s*security(?:\s*number)?|private\s+account\s+(?:data|credentials?))\b/i;
const sensitiveValuePattern =
  /(?:^|[^A-Za-z0-9])(?:[A-Za-z0-9]+[_-])?(?:api[_\s-]*key|access[_\s-]*token|authentication[_\s-]*token|password|passcode|client[_\s-]*secret|secret[_\s-]*key|private[_\s-]*key|recovery[_\s-]*code|cvv|cvc|pin|private[_\s-]*account[_\s-]*credentials?)\s*(?:(?:=|:)\s*|(?:is|are)\s+)\S+/i;
const terseSensitiveValuePattern = /^(?:password\s+\S+|client\s+secret\s+\S+)$/i;
const sensitiveCodePattern =
  /\b(?:(?:cvv|cvc)\s*\d{3,4}|pin\s*\d{4,8}|recovery\s*code\s*[A-Za-z0-9]{4}(?:[ -]?[A-Za-z0-9]{4})+)\b/i;
const privateKeyBlockPattern = /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/i;
const credentialTokenPattern =
  /\b(?:sk-(?:proj-)?[A-Za-z0-9_-]{8,}|gh[pousr]_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16})\b/;

export async function conductOwnerInterview({
  businessName,
  city = null,
  details = null,
  model = "gpt-5.6",
  client,
  structuredRequester = requestStructured,
  promptInterface,
}) {
  const cleanName = requireText(businessName, "Business name is required.", 120, "Business name");
  const cleanCity = optionalText(city, 120, "City");
  const cleanDetails = optionalText(details, 2_000, "Owner details");
  if (!promptInterface || typeof promptInterface.ask !== "function") {
    throw new TypeError("Interactive intake requires a prompt interface.");
  }

  const [systemPrompt, schema] = await Promise.all([
    readFile(questionPromptUrl, "utf8"),
    readFile(questionSchemaUrl, "utf8").then(JSON.parse),
  ]);
  const candidate = await structuredRequester({
    client,
    model,
    schema,
    schemaName: "mainstreet_intake_questions",
    systemPrompt,
    userPayload: {
      businessName: cleanName,
      city: cleanCity,
      ownerDetails: cleanDetails,
      safety: {
        askOnlyBusinessFacts: true,
        neverRequestSecrets: true,
      },
    },
    maxOutputTokens: 1_200,
  });
  const questions = normalizeInterviewQuestions(candidate);
  const answers = [];

  for (let index = 0; index < questions.length; index += 1) {
    const item = questions[index];
    let answer;
    try {
      answer = await promptInterface.ask({
        index: index + 1,
        total: questions.length,
        label: item.label,
        question: item.question,
      });
    } catch {
      throw interviewCancelledError();
    }
    if (answer === null || answer === undefined) {
      throw interviewCancelledError();
    }
    const value = requireSafeInterviewText(answer, {
      mode: "answer",
      message: `Interview answer for ${item.label} is required.`,
      maxLength: maxInterviewAnswerLength,
      label: `Interview answer for ${item.label}`,
    });
    answers.push({
      label: item.label,
      value,
      source: "user",
    });
  }

  return answers;
}

export async function createBrief({
  businessName,
  city = null,
  details = null,
  interviewAnswers = null,
  fast = false,
  model = process.env.OPENAI_MODEL || "gpt-5.6",
  client,
  structuredRequester = requestStructured,
}) {
  const cleanName = requireText(businessName, "Business name is required.", 120, "Business name");
  const cleanCity = optionalText(city, 120, "City");
  const cleanDetails = optionalText(details, 2_000, "Owner details");
  const cleanInterviewAnswers = normalizeInterviewAnswers(interviewAnswers, {
    required: !fast,
  });

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
      ...(fast ? {} : { ownerInterview: cleanInterviewAnswers }),
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
    interviewAnswers: cleanInterviewAnswers,
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
    ...input.interviewAnswers,
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

function requireText(value, message, maxLength, label) {
  const text = String(value ?? "").trim();
  if (!text) {
    throw new TypeError(message);
  }
  if (text.length > maxLength) {
    throw new TypeError(`${label} must be bounded to ${maxLength} characters.`);
  }
  return text;
}

function optionalText(value, maxLength, label) {
  const text = String(value ?? "").trim();
  if (text.length > maxLength) {
    throw new TypeError(`${label} must be bounded to ${maxLength} characters.`);
  }
  return text || null;
}

function normalizeInterviewQuestions(candidate) {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    throw new TypeError("Generated interview questions are invalid.");
  }

  return interviewFields.map(({ key, label }) => {
    const rawQuestion = requireText(
      candidate[key],
      `Generated interview question for ${label} is required.`,
      maxInterviewQuestionLength,
      `Generated interview question for ${label}`,
    );
    const question = requireSafeInterviewText(sanitizeVisibleCopy(rawQuestion), {
      mode: "question",
      message: `Generated interview question for ${label} is required.`,
      maxLength: maxInterviewQuestionLength,
      label: `Generated interview question for ${label}`,
    });
    return { label, question };
  });
}

function normalizeInterviewAnswers(value, { required }) {
  if (value === null || value === undefined) {
    if (required) {
      throw new TypeError("Interactive intake requires exactly six confirmed answers.");
    }
    return [];
  }
  if (!Array.isArray(value) || value.length !== interviewFields.length) {
    throw new TypeError("Interactive intake requires exactly six confirmed answers.");
  }

  return value.map((answer, index) => {
    const expected = interviewFields[index];
    if (
      !answer ||
      typeof answer !== "object" ||
      answer.label !== expected.label ||
      answer.source !== "user"
    ) {
      throw new TypeError(`Interview answer ${index + 1} has invalid provenance.`);
    }
    return {
      label: expected.label,
      value: requireSafeInterviewText(answer.value, {
        mode: "answer",
        message: `Interview answer for ${expected.label} is required.`,
        maxLength: maxInterviewAnswerLength,
        label: `Interview answer for ${expected.label}`,
      }),
      source: "user",
    };
  });
}

function requireSafeInterviewText(value, {
  mode,
  message,
  maxLength,
  label,
}) {
  const text = requireText(value, message, maxLength, label);
  const normalized = text.normalize("NFKC");
  const unsafe = mode === "question"
    ? sensitiveRequestPattern.test(normalized)
    : sensitiveValuePattern.test(normalized) ||
      terseSensitiveValuePattern.test(normalized) ||
      sensitiveCodePattern.test(normalized) ||
      privateKeyBlockPattern.test(normalized) ||
      credentialTokenPattern.test(normalized) ||
      containsPaymentCardNumber(normalized);

  if (unsafe) {
    throw new TypeError(
      mode === "question"
        ? "Unsafe interview question generated."
        : "Interview answer contains sensitive data and cannot be used.",
    );
  }
  return text;
}

function containsPaymentCardNumber(value) {
  const candidates = value.match(/(?:\d[ -]?){13,19}/g) ?? [];
  return candidates.some((candidate) => {
    const digits = candidate.replace(/\D/g, "");
    return digits.length >= 13 && digits.length <= 19 && passesLuhn(digits);
  });
}

function passesLuhn(digits) {
  let sum = 0;
  let double = false;
  for (let index = digits.length - 1; index >= 0; index -= 1) {
    let value = Number(digits[index]);
    if (double) {
      value *= 2;
      if (value > 9) value -= 9;
    }
    sum += value;
    double = !double;
  }
  return sum % 10 === 0;
}

function interviewCancelledError() {
  return new Error("Interview cancelled before all six answers were confirmed.");
}
