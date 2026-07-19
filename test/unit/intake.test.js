import assert from "node:assert/strict";
import test from "node:test";

import * as intakeModule from "../../src/intake.js";
import { createBrief, sanitizeVisibleCopy } from "../../src/intake.js";

function modelBrief(overrides = {}) {
  return {
    schemaVersion: "1.0",
    mode: "fast",
    business: {
      name: "Wrong model name",
      city: "Wrong model city",
      category: "Neighborhood bakery",
      summary: "A warm bakery focused on daily bread and simple hospitality.",
    },
    audience: {
      primary: "Neighbors who value careful baking",
      needs: ["Fresh bread", "A welcoming place"],
    },
    offerings: [
      {
        name: "Daily bread",
        description: "Small batches baked for the neighborhood.",
        confidence: "inferred",
      },
    ],
    brand: {
      personality: ["warm", "craft focused"],
      voice: "Direct, neighborly, and calm.",
      aesthetic: "Editorial warmth with tactile paper texture.",
      signatureMove: {
        name: "Bread window",
        description: "A framed product moment anchors each major section.",
        touchFallback: "The frame remains visible without hover.",
        reducedMotion: "All content appears without entrance motion.",
      },
      palette: {
        background: "#F4EBDD",
        surface: "#FFFDF8",
        text: "#241A12",
        accent: "#A34724",
      },
    },
    content: {
      eyebrow: "Neighborhood baking",
      headline: "Bread worth crossing town for",
      subheadline: "Slow methods — honest ingredients — a place to return to.",
      about: "A neighborhood bakery built around careful daily work.",
      primaryAction: "See what is baking",
      secondaryAction: "Plan a visit",
      contactPrompt: "Ask about today's selection.",
    },
    contact: {
      phone: "555-0100",
      email: "invented@example.com",
      address: "123 Made Up Street",
      hours: "Every day",
    },
    facts: {
      confirmed: [{ label: "fiction", value: "made up", source: "user" }],
      inferred: [
        {
          label: "category",
          value: "Neighborhood bakery",
          confidence: "medium",
        },
      ],
      needed: ["Verified hours", "Verified address", "Verified phone"],
    },
    ...overrides,
  };
}

function modelQuestions(overrides = {}) {
  return {
    services: "Which services are available today?",
    hours: "What hours should customers rely on?",
    vibe: "How should the business feel to a new customer?",
    photos: "What real photos are available for the site?",
    contact: "Which phone, address, or contact details may be published?",
    customerValue: "What do customers value most about the business?",
    ...overrides,
  };
}

function confirmedInterviewAnswers() {
  return [
    { label: "Available services", value: "Bread and pastries", source: "user" },
    { label: "Hours", value: "Tuesday through Saturday", source: "user" },
    { label: "Vibe", value: "Warm and practical", source: "user" },
    { label: "Photos", value: "Storefront and product photos", source: "user" },
    { label: "Contact facts", value: "Call 928 555 0100", source: "user" },
    { label: "Customer value", value: "Consistent quality", source: "user" },
  ];
}

function sensitiveAnswerCases() {
  return [
    ["API key", "OPENAI_API_KEY=example-credential-value"],
    ["CVV", "My CVV is 123"],
    ["PIN", "PIN 1234"],
    ["payment card", "4111 1111 1111 1111"],
    ["client secret", "client secret is not-a-real-secret"],
    ["recovery code", "recovery code 1234 5678"],
    ["password", "password is not-a-real-password"],
    ["terse password", "password hunter2"],
    ["terse client secret", "client secret examplevalue"],
    ["private key", "private key is not-a-real-private-key"],
    ["private account credentials", "private account credentials are example"],
  ];
}

test("interactive intake asks exactly six model generated questions", async () => {
  assert.equal(typeof intakeModule.conductOwnerInterview, "function");

  let request;
  const prompts = [];
  const answers = await intakeModule.conductOwnerInterview({
    businessName: "Juniper Oven",
    city: "Flagstaff, AZ",
    details: "Known for naturally leavened bread",
    structuredRequester: async (options) => {
      request = options;
      return modelQuestions();
    },
    promptInterface: {
      ask: async (prompt) => {
        prompts.push(prompt);
        return `Confirmed answer ${prompt.index}`;
      },
    },
  });

  assert.equal(request.model, "gpt-5.6");
  assert.equal(request.schemaName, "mainstreet_intake_questions");
  assert.deepEqual(request.userPayload, {
    businessName: "Juniper Oven",
    city: "Flagstaff, AZ",
    ownerDetails: "Known for naturally leavened bread",
    safety: {
      askOnlyBusinessFacts: true,
      neverRequestSecrets: true,
    },
  });
  assert.deepEqual(request.schema.required, [
    "services",
    "hours",
    "vibe",
    "photos",
    "contact",
    "customerValue",
  ]);
  assert.equal(prompts.length, 6);
  assert.deepEqual(
    prompts.map(({ index, total, label, question }) => ({ index, total, label, question })),
    [
      { index: 1, total: 6, label: "Available services", question: modelQuestions().services },
      { index: 2, total: 6, label: "Hours", question: modelQuestions().hours },
      { index: 3, total: 6, label: "Vibe", question: modelQuestions().vibe },
      { index: 4, total: 6, label: "Photos", question: modelQuestions().photos },
      { index: 5, total: 6, label: "Contact facts", question: modelQuestions().contact },
      { index: 6, total: 6, label: "Customer value", question: modelQuestions().customerValue },
    ],
  );
  assert.deepEqual(
    answers.map(({ label, value, source }) => ({ label, value, source })),
    [
      { label: "Available services", value: "Confirmed answer 1", source: "user" },
      { label: "Hours", value: "Confirmed answer 2", source: "user" },
      { label: "Vibe", value: "Confirmed answer 3", source: "user" },
      { label: "Photos", value: "Confirmed answer 4", source: "user" },
      { label: "Contact facts", value: "Confirmed answer 5", source: "user" },
      { label: "Customer value", value: "Confirmed answer 6", source: "user" },
    ],
  );
});

test("interactive intake fails closed on EOF or cancellation", async (t) => {
  for (const [name, ask] of [
    ["EOF", async () => null],
    ["cancel", async () => {
      throw new Error("terminal closed");
    }],
  ]) {
    await t.test(name, async () => {
      await assert.rejects(
        intakeModule.conductOwnerInterview({
          businessName: "Juniper Oven",
          structuredRequester: async () => modelQuestions(),
          promptInterface: { ask },
        }),
        /interview cancelled before all six answers were confirmed/i,
      );
    });
  }
});

test("interactive intake rejects oversized model questions and answers", async (t) => {
  for (const [name, questions, ask, pattern] of [
    ["oversized question", modelQuestions({ services: "Q".repeat(241) }), async () => "Answer", /question.*240/i],
    ["oversized answer", modelQuestions(), async () => "A".repeat(301), /answer.*300/i],
  ]) {
    await t.test(name, async () => {
      await assert.rejects(
        intakeModule.conductOwnerInterview({
          businessName: "Juniper Oven",
          structuredRequester: async () => questions,
          promptInterface: { ask },
        }),
        pattern,
      );
    });
  }
});

test("interactive intake rejects sensitive data requests before prompting", async (t) => {
  for (const [name, question] of [
    ["API key", "What is your API key?"],
    ["CVV", "What is the CVV for the business card?"],
    ["PIN", "What is the PIN for the business debit card?"],
    ["debit card number", "What is the debit card number?"],
    ["credit card number", "What is the credit card number?"],
    ["client secret", "What is the OAuth client secret?"],
    ["recovery code", "What is the account recovery code?"],
    ["password", "What is the private account password?"],
    ["private key", "Paste the private key used by the business account."],
    ["financial account details", "What financial account details should be published?"],
    ["private account data", "Share the private account data."],
    ["private account credential", "What is the private account credential?"],
    ["private account credentials", "What are the private account credentials?"],
  ]) {
    await t.test(name, async () => {
      let promptCalls = 0;
      await assert.rejects(
        intakeModule.conductOwnerInterview({
          businessName: "Juniper Oven",
          structuredRequester: async () => modelQuestions({ contact: question }),
          promptInterface: {
            ask: async () => {
              promptCalls += 1;
              return "Answer";
            },
          },
        }),
        (error) =>
          /unsafe interview question/i.test(error.message) &&
          !error.message.includes(question),
      );
      assert.equal(promptCalls, 0);
    });
  }
});

test("question generator explicitly forbids sensitive requests", async () => {
  let systemPrompt;
  await intakeModule.conductOwnerInterview({
    businessName: "Juniper Oven",
    structuredRequester: async (options) => {
      systemPrompt = options.systemPrompt;
      return modelQuestions();
    },
    promptInterface: { ask: async () => "Safe answer" },
  });

  for (const pattern of [
    /CVV/i,
    /PIN/i,
    /debit[^.]*card number/i,
    /credit[^.]*card number/i,
    /client secret/i,
    /recovery code/i,
    /password/i,
    /private key/i,
    /financial account details/i,
    /private account data/i,
    /private account credentials/i,
  ]) {
    assert.match(systemPrompt, pattern);
  }
});

test("interactive intake rejects sensitive answers without echoing them", async (t) => {
  for (const [name, sensitiveAnswer] of sensitiveAnswerCases()) {
    await t.test(name, async () => {
      await assert.rejects(
        intakeModule.conductOwnerInterview({
          businessName: "Juniper Oven",
          structuredRequester: async () => modelQuestions(),
          promptInterface: { ask: async () => sensitiveAnswer },
        }),
        (error) =>
          /sensitive data/i.test(error.message) &&
          !error.message.includes(sensitiveAnswer),
      );
    });
  }
});

test("strict brief rejects sensitive answers before its model request", async (t) => {
  for (const [name, sensitiveAnswer] of sensitiveAnswerCases()) {
    await t.test(name, async () => {
      const answers = confirmedInterviewAnswers();
      answers[4] = { ...answers[4], value: sensitiveAnswer };
      let modelCalls = 0;
      await assert.rejects(
        createBrief({
          businessName: "Juniper Oven",
          interviewAnswers: answers,
          structuredRequester: async () => {
            modelCalls += 1;
            return modelBrief({ mode: "interview" });
          },
        }),
        (error) =>
          /sensitive data/i.test(error.message) &&
          !error.message.includes(sensitiveAnswer),
      );
      assert.equal(modelCalls, 0);
    });
  }
});

test("ordinary sentences plus phone address and hours answers remain allowed", async () => {
  const safeAnswers = [
    "Password reset support for local offices",
    "Monday through Friday from 9 AM to 5 PM",
    "Warm and practical",
    "The phrase client secret appears only in staff training",
    "Call 928 555 0100 at 12 North Leroux Street",
    "Consistent quality",
  ];
  let answerIndex = 0;
  const answers = await intakeModule.conductOwnerInterview({
    businessName: "Juniper Oven",
    structuredRequester: async () => modelQuestions(),
    promptInterface: { ask: async () => safeAnswers[answerIndex++] },
  });

  assert.equal(answers[1].value, safeAnswers[1]);
  assert.equal(answers[4].value, safeAnswers[4]);

  let modelCalls = 0;
  await createBrief({
    businessName: "Juniper Oven",
    interviewAnswers: answers,
    structuredRequester: async () => {
      modelCalls += 1;
      return modelBrief({ mode: "interview" });
    },
  });
  assert.equal(modelCalls, 1);
});

test("strict brief generation records interview answers as confirmed owner facts", async () => {
  let request;
  const interviewAnswers = confirmedInterviewAnswers();
  const brief = await createBrief({
    businessName: "Juniper Oven",
    details: "Known for naturally leavened bread",
    interviewAnswers,
    structuredRequester: async (options) => {
      request = options;
      return modelBrief({ mode: "interview" });
    },
  });

  assert.deepEqual(request.userPayload.ownerInterview, interviewAnswers);
  assert.deepEqual(brief.facts.confirmed, [
    { label: "Business name", value: "Juniper Oven", source: "user" },
    { label: "Owner details", value: "Known for naturally leavened bread", source: "user" },
    ...interviewAnswers,
  ]);
});

test("fast intake preserves user facts and strips invented contact details", async () => {
  let request;
  const brief = await createBrief({
    businessName: "Juniper Oven",
    city: "Flagstaff, AZ",
    fast: true,
    structuredRequester: async (options) => {
      request = options;
      return modelBrief();
    },
  });

  assert.equal(request.model, "gpt-5.6");
  assert.equal(request.schemaName, "mainstreet_brief");
  assert.equal(brief.business.name, "Juniper Oven");
  assert.equal(brief.business.city, "Flagstaff, AZ");
  assert.equal(brief.mode, "fast");
  assert.deepEqual(brief.contact, {
    phone: null,
    email: null,
    address: null,
    hours: null,
  });
  assert.deepEqual(brief.facts.confirmed, [
    { label: "Business name", value: "Juniper Oven", source: "user" },
    { label: "City", value: "Flagstaff, AZ", source: "user" },
  ]);
});

test("fast intake records optional owner details as confirmed without exposing them as contact fields", async () => {
  const brief = await createBrief({
    businessName: "Juniper Oven",
    details: "Known for naturally leavened loaves",
    fast: true,
    structuredRequester: async () => modelBrief(),
  });

  assert.deepEqual(brief.facts.confirmed.at(-1), {
    label: "Owner details",
    value: "Known for naturally leavened loaves",
    source: "user",
  });
  assert.equal(brief.contact.phone, null);
});

test("name only fast intake replaces transactional public copy with guidance", async () => {
  const candidate = modelBrief();
  candidate.business.summary = "We deliver flowers for every event.";
  candidate.offerings = [
    {
      name: "Event Florals",
      description: "Custom flowers for weddings and gatherings.",
      confidence: "inferred",
    },
  ];
  candidate.content = {
    ...candidate.content,
    headline: "Flowers delivered with care",
    subheadline: "Pickup and delivery may be available.",
    primaryAction: "Order Flowers",
    secondaryAction: "Book Event Florals",
    contactPrompt: "Ask about pickup and delivery.",
  };

  const brief = await createBrief({
    businessName: "Paper Petal",
    fast: true,
    structuredRequester: async () => candidate,
  });
  const publicCopy = JSON.stringify({
    summary: brief.business.summary,
    content: brief.content,
  });

  assert.doesNotMatch(publicCopy, /\b(?:order|book|pickup|delivery|deliver|event florals)\b/i);
  assert.equal(brief.content.primaryAction, "Explore Ideas");
  assert.match(publicCopy, /service and availability details are not confirmed/i);
  assert.equal(brief.offerings[0].confidence, "inferred");
});

test("visible generated copy removes dash characters and emojis", () => {
  assert.equal(
    sanitizeVisibleCopy("Slow methods — honest ingredients - always. Fresh bread 🍞"),
    "Slow methods honest ingredients always. Fresh bread",
  );
});

test("intake rejects a blank business name before making an API call", async () => {
  let called = false;
  await assert.rejects(
    createBrief({
      businessName: "   ",
      fast: true,
      structuredRequester: async () => {
        called = true;
        return modelBrief();
      },
    }),
    /business name is required/i,
  );
  assert.equal(called, false);
});

test("intake bounds user supplied identity and owner details before the API", async (t) => {
  for (const [name, input] of [
    ["business name", { businessName: "N".repeat(121) }],
    ["city", { businessName: "Paper Petal", city: "C".repeat(121) }],
    ["owner details", { businessName: "Paper Petal", details: "D".repeat(2001) }],
  ]) {
    await t.test(name, async () => {
      let calls = 0;
      await assert.rejects(
        createBrief({
          ...input,
          fast: true,
          structuredRequester: async () => {
            calls += 1;
            return modelBrief();
          },
        }),
        /bounded|too long|characters/i,
      );
      assert.equal(calls, 0);
    });
  }
});
