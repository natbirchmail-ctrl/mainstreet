import assert from "node:assert/strict";
import test from "node:test";

function inferredBrief() {
  return {
    business: {
      name: "Paper Petal",
      city: "Flagstaff, AZ",
      category: "Flower studio",
      summary: "A flower studio concept.",
    },
    offerings: [
      {
        name: "Event Florals",
        description: "Custom flowers for weddings and gatherings.",
        confidence: "inferred",
      },
    ],
    contact: { phone: null, email: null, address: null, hours: null },
    facts: {
      confirmed: [
        { label: "Business name", value: "Paper Petal", source: "user" },
        { label: "City", value: "Flagstaff, AZ", source: "user" },
      ],
      inferred: [],
      needed: ["Services", "Availability"],
    },
  };
}

async function claimPolicyModule() {
  try {
    return await import("../../src/claim-policy.js");
  } catch {
    return {};
  }
}

test("claim policy makes an inferred only brief guidance only", async () => {
  const { deriveClaimPolicy } = await claimPolicyModule();
  assert.equal(typeof deriveClaimPolicy, "function");

  const policy = deriveClaimPolicy(inferredBrief());
  assert.equal(policy.mode, "guidance-only");
  assert.deepEqual(policy.confirmedOfferings, []);
  assert.deepEqual(policy.inferredOfferingHints, [
    {
      name: "Event Florals",
      description: "Custom flowers for weddings and gatherings.",
    },
  ]);
  assert.deepEqual(policy.forbiddenTransactionalTopics.sort(), [
    "booking",
    "delivery",
    "eventServices",
    "hours",
    "ordering",
    "pickup",
    "prices",
  ]);
});

test("claim guard rejects inferred services and qualifier laundering", async () => {
  const { validateBriefClaims } = await claimPolicyModule();
  assert.equal(typeof validateBriefClaims, "function");

  const html = `<main>
    <section id="services" data-section="services">
      <h2>Our Services</h2>
      <h3>Event Florals</h3>
      <p>Custom flowers for weddings and gatherings may be available.</p>
      <p>We create arrangements for every occasion.</p>
    </section>
  </main>`;

  assert.throws(
    () => validateBriefClaims(html, inferredBrief()),
    /inferred offering|unsupported claim|transactional/i,
  );
});

test("claim guard accepts useful category guidance with a local anchor", async () => {
  const { validateBriefClaims } = await claimPolicyModule();
  assert.equal(typeof validateBriefClaims, "function");

  const html = `<main>
    <section id="ideas" data-section="ideas">
      <h2>Floral Directions</h2>
      <h3>Event Setting</h3>
      <p>For a gathering, consider the setting, timing, and colors.</p>
      <a href="#details">Explore Ideas</a>
    </section>
    <section id="details" data-section="details">
      <h2>Confirm Details</h2>
      <p>Service and availability details are not confirmed.</p>
    </section>
  </main>`;

  assert.doesNotThrow(() => validateBriefClaims(html, inferredBrief()));
});

test("claim guard permits matching confirmed service language", async () => {
  const { deriveClaimPolicy, validateBriefClaims } = await claimPolicyModule();
  assert.equal(typeof deriveClaimPolicy, "function");
  assert.equal(typeof validateBriefClaims, "function");

  const brief = inferredBrief();
  brief.business.name = "Canyon Cycles";
  brief.business.category = "Bicycle repair";
  brief.offerings = [
    {
      name: "Bicycle Repair",
      description: "Neighborhood bicycle repair for commuters.",
      confidence: "confirmed",
    },
  ];
  brief.facts.confirmed.push({
    label: "Owner details",
    value: "Neighborhood bicycle repair for commuters. Walk in service is welcome.",
    source: "user",
  });

  const policy = deriveClaimPolicy(brief);
  assert.equal(policy.mode, "confirmed-offerings");
  assert.deepEqual(policy.confirmedOfferings, [
    {
      name: "Bicycle Repair",
      description: "Neighborhood bicycle repair for commuters.",
    },
  ]);
  assert.doesNotThrow(() =>
    validateBriefClaims(
      "<main><h1>Canyon Cycles</h1><p>We provide neighborhood bicycle repair for commuters.</p></main>",
      brief,
    ),
  );
});

test("transactional claims require matching confirmed facts", async () => {
  const { validateBriefClaims } = await claimPolicyModule();
  assert.equal(typeof validateBriefClaims, "function");

  assert.throws(
    () => validateBriefClaims("<main><a href=\"#ideas\">Order Flowers</a></main>", inferredBrief()),
    /ordering.*not confirmed|transactional/i,
  );

  const confirmed = inferredBrief();
  confirmed.facts.confirmed.push({
    label: "Ordering",
    value: "Online ordering is available.",
    source: "user",
  });
  assert.doesNotThrow(() =>
    validateBriefClaims("<main><a href=\"#details\">Order Online</a></main>", confirmed),
  );
});
