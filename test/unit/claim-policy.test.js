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

function repairBrief(ownerDetails = "Neighborhood bicycle repair for commuters. Walk in service is welcome.") {
  const brief = inferredBrief();
  brief.business = {
    name: "Canyon Cycles",
    city: "Tucson, AZ",
    category: "Bicycle repair",
    summary: "A bicycle repair concept.",
  };
  brief.offerings = [
    {
      name: "Bicycle Repair",
      description: "Neighborhood bicycle repair for commuters.",
      confidence: "confirmed",
    },
  ];
  brief.facts.confirmed = [
    { label: "Business name", value: "Canyon Cycles", source: "user" },
    { label: "City", value: "Tucson, AZ", source: "user" },
    { label: "Owner details", value: ownerDetails, source: "user" },
  ];
  return brief;
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
  assert.equal(policy.provenanceStatus, "valid");
  assert.equal(Object.hasOwn(policy, "allowedTransactionalTopics"), false);
  assert.equal(Object.hasOwn(policy, "forbiddenTransactionalTopics"), false);
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
  brief.facts.confirmed[0].value = "Canyon Cycles";
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
    label: "Owner details",
    value: "Online ordering is available.",
    source: "user",
  });
  assert.doesNotThrow(() =>
    validateBriefClaims("<main><a href=\"#details\">Order Online</a></main>", confirmed),
  );
});

test("model confidence never creates user confirmation", async () => {
  const { deriveClaimPolicy, validateBriefClaims } = await claimPolicyModule();
  const brief = inferredBrief();
  brief.offerings[0].confidence = "confirmed";

  const policy = deriveClaimPolicy(brief);
  assert.equal(policy.mode, "guidance-only");
  assert.deepEqual(policy.confirmedOfferings, []);
  assert.throws(
    () => validateBriefClaims("<main><p>We provide event florals.</p></main>", brief),
    /unsupported/i,
  );
});

test("supported mode still rejects a different operation and broader scope", async () => {
  const { validateBriefClaims } = await claimPolicyModule();
  const brief = repairBrief("Local bicycle repair for commuters.");

  assert.throws(
    () => validateBriefClaims("<main><p>We sell bicycles.</p></main>", brief),
    /unsupported/i,
  );
  assert.throws(
    () => validateBriefClaims("<main><p>Nationwide bicycle repair for commuters.</p></main>", brief),
    /unsupported/i,
  );
});

test("missing and malformed provenance fail closed", async () => {
  const { deriveClaimPolicy, validateBriefClaims } = await claimPolicyModule();
  for (const facts of [undefined, {}, { confirmed: "user said yes" }, { confirmed: [null] }]) {
    const brief = inferredBrief();
    brief.facts = facts;
    const policy = deriveClaimPolicy(brief);
    assert.equal(policy.mode, "guidance-only");
    assert.notEqual(policy.provenanceStatus, "valid");
    assert.throws(
      () => validateBriefClaims("<main><button>Buy Now</button></main>", brief),
      /unsupported|provenance/i,
    );
  }
});

test("claim policy payload is compact and excludes unbounded raw inputs", async () => {
  const { deriveClaimPolicy } = await claimPolicyModule();
  const brief = inferredBrief();
  const marker = "private-marker-".repeat(900);
  brief.facts.confirmed.push({ label: "Owner details", value: marker, source: "user" });
  brief.offerings = Array.from({ length: 50 }, (_, index) => ({
    name: `Offering ${index} ${marker}`,
    description: marker,
    confidence: "confirmed",
  }));

  const serialized = JSON.stringify(deriveClaimPolicy(brief));
  assert.ok(serialized.length <= 6_000, serialized.length);
  assert.equal(serialized.includes(marker), false);
});

test("scanner joins nested text and removes format characters before auditing", async (t) => {
  const { validateBriefClaims } = await claimPolicyModule();
  const attacks = [
    ["split span", "<button>Or<span>der</span> Flowers</button>"],
    ["zero width", "<button>Or\u200Bder Flowers</button>"],
    ["soft hyphen entity", "<button>Or&shy;der Flowers</button>"],
    ["numeric entity", "<button>&#x4f;rder Flowers</button>"],
    ["fullwidth", "<button>Ｏｒｄｅｒ Flowers</button>"],
    ["homograph", "<button>Оrder Flowers</button>"],
    ["unknown nested element", "<div><p>Ideas</p><x-cta><span>Bu</span>y Now</x-cta></div>"],
  ];
  for (const [name, authored] of attacks) {
    await t.test(name, () => {
      assert.throws(
        () => validateBriefClaims(`<main>${authored}</main>`, inferredBrief()),
        /unsupported|unauditable/i,
      );
    });
  }
});

test("scanner audits div text and unsupported noun assertions", async () => {
  const { validateBriefClaims } = await claimPolicyModule();
  assert.throws(
    () => validateBriefClaims("<main><div>Fresh floral arrangements every day.</div></main>", inferredBrief()),
    /unsupported/i,
  );
});

test("scanner audits metadata and human facing attributes", async (t) => {
  const { validateBriefClaims } = await claimPolicyModule();
  const attacks = [
    ["title", "<title>Buy Flowers</title><main>Ideas</main>"],
    ["description", '<meta name="description" content="Shop for flowers"><main>Ideas</main>'],
    ["aria label", '<main><a href="#ideas" aria-label="Reserve Flowers">Ideas</a></main>'],
    ["alt", '<main><img alt="Same Day Shipping" src="assets/example.png"></main>'],
    ["value", '<main><input type="submit" value="Get a Quote"></main>'],
  ];
  for (const [name, html] of attacks) {
    await t.test(name, () => {
      assert.throws(() => validateBriefClaims(html, inferredBrief()), /unsupported/i);
    });
  }
});

test("unsupported action vocabulary is rejected contextually", async (t) => {
  const { validateBriefClaims } = await claimPolicyModule();
  for (const action of [
    "Buy Now",
    "Shop",
    "Reserve",
    "Get a Quote",
    "Purchase",
    "Same Day Shipping",
  ]) {
    await t.test(action, () => {
      assert.throws(
        () => validateBriefClaims(`<main><a href="#details">${action}</a></main>`, inferredBrief()),
        /unsupported/i,
      );
    });
  }
});

test("matching user clauses authorize bounded transactional synonyms", async (t) => {
  const { validateBriefClaims } = await claimPolicyModule();
  const cases = [
    ["Buy Now", "Online purchases are available."],
    ["Shop", "Online purchases are available."],
    ["Purchase", "Online purchases are available."],
    ["Reserve", "Appointments are available."],
    ["Get a Quote", "Quotes are available."],
    ["Same Day Shipping", "Same day delivery is available."],
  ];
  for (const [action, evidence] of cases) {
    await t.test(action, () => {
      const brief = inferredBrief();
      brief.facts.confirmed.push({ label: "Owner details", value: evidence, source: "user" });
      assert.doesNotThrow(() =>
        validateBriefClaims(`<main><a href="#details">${action}</a></main>`, brief),
      );
    });
  }
});

test("exact same clause evidence supports a scoped noun phrase", async () => {
  const { validateBriefClaims } = await claimPolicyModule();
  const brief = inferredBrief();
  brief.facts.confirmed.push({
    label: "Owner details",
    value: "Fresh floral arrangements every day.",
    source: "user",
  });
  assert.doesNotThrow(() =>
    validateBriefClaims("<main><div><span>Fresh floral arrangements</span> every day.</div></main>", brief),
  );
});

test("transactional synonyms cannot discard unmatched evidence semantics", async () => {
  const { validateBriefClaims } = await claimPolicyModule();
  const brief = inferredBrief();
  brief.facts.confirmed.push({
    label: "Owner details",
    value: "Emergency quotes are available.",
    source: "user",
  });
  assert.throws(
    () => validateBriefClaims('<main><a href="#details">Get a Quote</a></main>', brief),
    /unsupported/i,
  );
  assert.doesNotThrow(() =>
    validateBriefClaims("<main><p>Emergency quotes are available.</p></main>", brief),
  );
});

test("contact fields and negative facts cannot authorize positive claims", async () => {
  const { validateBriefClaims } = await claimPolicyModule();
  const injected = inferredBrief();
  injected.contact.hours = "Open every day";
  assert.throws(
    () => validateBriefClaims("<main><p>Open every day.</p></main>", injected),
    /unsupported/i,
  );

  const negative = inferredBrief();
  negative.facts.confirmed.push({
    label: "Owner details",
    value: "Delivery is not available.",
    source: "user",
  });
  assert.throws(
    () => validateBriefClaims("<main><p>Delivery is available.</p></main>", negative),
    /unsupported/i,
  );
  assert.doesNotThrow(() =>
    validateBriefClaims("<main><p>Delivery is not available.</p></main>", negative),
  );
});

test("contractions modality and restrictive evidence cannot authorize broader claims", async () => {
  const { validateBriefClaims } = await claimPolicyModule();

  const contraction = inferredBrief();
  contraction.facts.confirmed.push({
    label: "Owner details",
    value: "We don't deliver flowers.",
    source: "user",
  });
  assert.throws(
    () => validateBriefClaims("<main><p>We deliver flowers.</p></main>", contraction),
    /unsupported/i,
  );
  assert.doesNotThrow(() =>
    validateBriefClaims("<main><p>We don't deliver flowers.</p></main>", contraction),
  );

  for (const [evidence, claim] of [
    ["We may repair bicycles.", "We repair bicycles."],
    ["Bicycle repair by appointment only.", "Bicycle repair."],
  ]) {
    const brief = repairBrief(evidence);
    brief.business.category = "Cycle studio";
    assert.throws(() => validateBriefClaims(`<main><p>${claim}</p></main>`, brief), /unsupported/i);
    assert.doesNotThrow(() => validateBriefClaims(`<main><p>${evidence}</p></main>`, brief));
  }
});

test("qualifiers remain attached to the same predicate", async () => {
  const { validateBriefClaims } = await claimPolicyModule();
  const brief = repairBrief("Free estimates with paid bicycle repair.");
  assert.throws(
    () => validateBriefClaims("<main><p>Free bicycle repair with paid estimates.</p></main>", brief),
    /unsupported/i,
  );
  assert.doesNotThrow(() =>
    validateBriefClaims("<main><p>Free estimates with paid bicycle repair.</p></main>", brief),
  );
});

test("scanner audits all rendered values labels trailing text and embedded action intent", async (t) => {
  const { validateBriefClaims } = await claimPolicyModule();
  const attacks = [
    ["text value", '<main><input type="text" value="Buy Now"></main>'],
    ["option label", '<main><select><option label="Reserve Now"></option></select></main>'],
    ["trailing text", "<html><body><main>Ideas</main></body></html>Buy Now"],
    ["embedded action", '<main><button>Click to Buy Now</button></main>'],
    ["named format entity", '<main><button>Or&NegativeThinSpace;der Flowers</button></main>'],
  ];
  for (const [name, html] of attacks) {
    await t.test(name, () => {
      assert.throws(() => validateBriefClaims(html, inferredBrief()), /unsupported|unauditable/i);
    });
  }
});

test("unsupported offering contact reputation and history claims are audited", async (t) => {
  const { validateBriefClaims } = await claimPolicyModule();
  const claims = [
    ["offering heading", '<section data-section="offerings"><h3>Wedding bouquets</h3></section>'],
    ["offering alt", '<img src="assets/example.png" alt="Wedding bouquets">'],
    ["phone", "<p>Call 928 774 1234</p>"],
    ["address", "<p>Visit 123 Main Street</p>"],
    ["award history", "<p>Award winning since 1985</p>"],
    ["rating", "<p>Rated five stars by local customers</p>"],
  ];
  for (const [name, authored] of claims) {
    await t.test(name, () => {
      assert.throws(
        () => validateBriefClaims(`<main>${authored}</main>`, inferredBrief()),
        /unsupported/i,
      );
    });
  }
});

test("verbatim user evidence can support precise contact and reputation copy", async () => {
  const { validateBriefClaims } = await claimPolicyModule();
  const brief = inferredBrief();
  brief.facts.confirmed.push({
    label: "Owner details",
    value: "Call 928 774 1234. Award winning since 1985.",
    source: "user",
  });
  assert.doesNotThrow(() =>
    validateBriefClaims(
      "<main><p>Call 928 774 1234.</p><p>Award winning since 1985.</p></main>",
      brief,
    ),
  );
});

test("exact identity and ambiguous informational prose avoid intent false positives", async () => {
  const { validateBriefClaims } = await claimPolicyModule();
  for (const [name, category] of [
    ["Book Nook", "Book store"],
    ["Order House", "Order management guide"],
    ["Delivery Co", "Delivery driver guide"],
    ["Pickup Place", "Pickup truck shop"],
  ]) {
    const brief = inferredBrief();
    brief.business.name = name;
    brief.business.category = category;
    brief.facts.confirmed[0].value = name;
    assert.doesNotThrow(() =>
      validateBriefClaims(
        `<main><h1>${name}</h1><p>Read the guide in order to compare ideas.</p><p>Monday planning can help.</p><p>Planning for an event begins with the setting.</p></main>`,
        brief,
      ),
    );
  }
  assert.doesNotThrow(() =>
    validateBriefClaims("<main><p>Read our order management guide.</p></main>", inferredBrief()),
  );
});

test("one trusted clause must contain every essential claim token with matching polarity", async () => {
  const { validateBriefClaims } = await claimPolicyModule();
  const brief = repairBrief();
  assert.doesNotThrow(() =>
    validateBriefClaims(
      "<main><p>We provide neighborhood bicycle repair for commuters.</p><p>Walk in service is welcome.</p></main>",
      brief,
    ),
  );
  assert.throws(
    () => validateBriefClaims("<main><p>Free neighborhood bicycle repair for commuters.</p></main>", brief),
    /unsupported/i,
  );
});

test("claim classification is structural across local business categories", async (t) => {
  const { validateBriefClaims } = await claimPolicyModule();
  for (const [name, authored] of [
    ["photography heading", '<section data-section="offerings"><h3>Wedding Photography</h3></section>'],
    ["plumbing heading", '<section data-section="services"><h3>Emergency Plumbing</h3></section>'],
    ["possessive offering", "<p>Our wedding bouquets</p>"],
    ["first person offering", "<p>We have wedding bouquets</p>"],
    ["first person scope", "<p>We are available nationwide</p>"],
  ]) {
    await t.test(name, () => {
      assert.throws(
        () => validateBriefClaims(`<main>${authored}</main>`, inferredBrief()),
        /unsupported/i,
      );
    });
  }
});

test("same clause support preserves proposition and qualifier order", async (t) => {
  const { validateBriefClaims } = await claimPolicyModule();
  for (const [name, evidence, claim] of [
    [
      "argument reversal",
      "We repair bicycles for commuters.",
      "We repair commuters for bicycles.",
    ],
    [
      "unlisted qualifier reassignment",
      "Emergency estimates with routine bicycle repair.",
      "Emergency bicycle repair with routine estimates.",
    ],
  ]) {
    await t.test(name, () => {
      const brief = repairBrief(evidence);
      brief.business.category = "Cycle studio";
      assert.throws(
        () => validateBriefClaims(`<main><p>${claim}</p></main>`, brief),
        /unsupported/i,
      );
      assert.doesNotThrow(() =>
        validateBriefClaims(`<main><p>${evidence}</p></main>`, brief),
      );
    });
  }
});

test("scanner follows quoted tag boundaries and audits all public metadata", async (t) => {
  const { validateBriefClaims } = await claimPolicyModule();
  for (const [name, html] of [
    ["quoted greater than", '<main><input type="text" value="Buy > Now"></main>'],
    ["application metadata", '<meta name="application-name" content="Buy Now"><main>Ideas</main>'],
  ]) {
    await t.test(name, () => {
      assert.throws(() => validateBriefClaims(html, inferredBrief()), /unsupported/i);
    });
  }
});

test("international contact hours ratings and geographic scope fail closed", async (t) => {
  const { validateBriefClaims } = await claimPolicyModule();
  for (const [name, authored] of [
    ["international phone", "<p>Call +44 20 7946 0958</p>"],
    ["split hours", "<h2>Hours</h2><p>Weekdays 9 to 5</p>"],
    ["star rating", "<p>★★★★★ Five stars</p>"],
    ["nationwide scope", "<p>We are available nationwide</p>"],
  ]) {
    await t.test(name, () => {
      assert.throws(
        () => validateBriefClaims(`<main>${authored}</main>`, inferredBrief()),
        /unsupported/i,
      );
    });
  }
});

test("informational command heads remain useful without authorizing claims", async () => {
  const { validateBriefClaims } = await claimPolicyModule();
  for (const authored of [
    "Use our order management guide.",
    "Learn about delivery drivers.",
    "Compare pickup trucks.",
  ]) {
    assert.doesNotThrow(() =>
      validateBriefClaims(`<main><a href="#guidance">${authored}</a></main>`, inferredBrief()),
      authored,
    );
  }
});

test("standalone no is negative evidence and cannot confirm a positive offering", async () => {
  const { deriveClaimPolicy, validateBriefClaims } = await claimPolicyModule();
  const brief = repairBrief("No neighborhood bicycle repair for commuters.");

  assert.equal(deriveClaimPolicy(brief).mode, "guidance-only");
  assert.throws(
    () => validateBriefClaims("<main><p>Neighborhood bicycle repair for commuters.</p></main>", brief),
    /unsupported/i,
  );
  assert.doesNotThrow(() =>
    validateBriefClaims("<main><p>No neighborhood bicycle repair for commuters.</p></main>", brief),
  );
});

test("guidance-only mode rejects service framing while preserving neutral guidance", async (t) => {
  const { validateBriefClaims } = await claimPolicyModule();
  for (const framing of [
    "Our Services",
    "Services",
    "Offerings",
    "Products",
    "Menu",
    "Explore Services",
  ]) {
    await t.test(framing, () => {
      assert.throws(
        () => validateBriefClaims(`<main><h2>${framing}</h2></main>`, inferredBrief()),
        /unsupported/i,
      );
    });
  }

  for (const copy of [
    "Explore our wedding bouquets",
    "Learn about our flower delivery",
    "Plan your wedding photography",
  ]) {
    await t.test(copy, () => {
      assert.throws(
        () => validateBriefClaims(`<main><a href="#ideas">${copy}</a></main>`, inferredBrief()),
        /unsupported/i,
      );
    });
  }

  assert.throws(
    () => validateBriefClaims(
      '<main><img src="assets/example.png" alt="Wedding bouquets prepared for delivery on a work surface"></main>',
      inferredBrief(),
    ),
    /unsupported/i,
  );

  for (const copy of ["Explore color ideas", "Learn about delivery drivers", "Plan for an event"]) {
    assert.doesNotThrow(() =>
      validateBriefClaims(`<main><a href="#ideas">${copy}</a></main>`, inferredBrief()),
      copy,
    );
  }
});

test("model inferred category is not identity evidence", async () => {
  const { validateBriefClaims } = await claimPolicyModule();
  const brief = inferredBrief();
  brief.business.category = "Same Day Delivery";

  assert.throws(
    () => validateBriefClaims("<main><button>Same Day Delivery</button></main>", brief),
    /unsupported/i,
  );
  assert.doesNotThrow(() =>
    validateBriefClaims(
      "<main><p>A visual planning guide inspired by Same Day Delivery.</p></main>",
      brief,
    ),
  );
});

test("transactional intent retains its claimed object", async () => {
  const { validateBriefClaims } = await claimPolicyModule();
  const generic = inferredBrief();
  generic.facts.confirmed.push({
    label: "Owner details",
    value: "Online ordering is available.",
    source: "user",
  });
  assert.doesNotThrow(() =>
    validateBriefClaims('<main><a href="#details">Order Online</a></main>', generic),
  );
  assert.throws(
    () => validateBriefClaims('<main><a href="#details">Order Wedding Bouquets</a></main>', generic),
    /unsupported/i,
  );

  const explicit = inferredBrief();
  explicit.facts.confirmed.push({
    label: "Owner details",
    value: "Online ordering for wedding bouquets is available.",
    source: "user",
  });
  assert.doesNotThrow(() =>
    validateBriefClaims('<main><a href="#details">Order Wedding Bouquets</a></main>', explicit),
  );
});

test("pickup intent requires pickup evidence and never borrows delivery support", async () => {
  const { validateBriefClaims } = await claimPolicyModule();
  const brief = inferredBrief();
  brief.facts.confirmed.push({
    label: "Owner details",
    value: "Pickup is available.",
    source: "user",
  });
  assert.doesNotThrow(() =>
    validateBriefClaims('<main><a href="#details">Pickup</a></main>', brief),
  );
  assert.throws(
    () => validateBriefClaims('<main><a href="#details">Delivery</a></main>', brief),
    /unsupported/i,
  );
});

test("social handles and post office boxes require exact user evidence", async (t) => {
  const { validateBriefClaims } = await claimPolicyModule();
  for (const copy of ["Instagram: @canyoncycles", "Follow @canyoncycles", "P.O. Box 123", "PO Box 42"]) {
    await t.test(copy, () => {
      assert.throws(
        () => validateBriefClaims(`<main><p>${copy}</p></main>`, inferredBrief()),
        /unsupported/i,
      );
    });
  }
  for (const copy of ["Plan social media ideas", "A box of materials on a work surface"]) {
    assert.doesNotThrow(() =>
      validateBriefClaims(`<main><p>${copy}</p></main>`, inferredBrief()),
      copy,
    );
  }

  const confirmed = inferredBrief();
  confirmed.facts.confirmed.push({
    label: "Owner details",
    value: "Instagram: @canyoncycles. P.O. Box 123.",
    source: "user",
  });
  assert.doesNotThrow(() =>
    validateBriefClaims(
      "<main><p>Instagram: @canyoncycles.</p><p>P.O. Box 123.</p></main>",
      confirmed,
    ),
  );
});

test("editorial headings are neutral outside explicit offering framing", async () => {
  const { validateBriefClaims } = await claimPolicyModule();
  assert.doesNotThrow(() =>
    validateBriefClaims(
      '<main><section class="offerings-section"><div class="editorial-grid"><h3>Color Story</h3></div></section></main>',
      inferredBrief(),
    ),
  );
  assert.throws(
    () => validateBriefClaims(
      '<main><section class="services-section"><div class="card-grid"><h3>Emergency Plumbing</h3></div></section></main>',
      inferredBrief(),
    ),
    /unsupported/i,
  );
});
