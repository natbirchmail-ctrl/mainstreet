import assert from "node:assert/strict";
import test from "node:test";

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
