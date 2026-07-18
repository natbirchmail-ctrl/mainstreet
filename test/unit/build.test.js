import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import * as buildModule from "../../src/build.js";

const {
  buildSite,
  buildRun,
  validateSiteManifest,
  writeSiteFiles,
} = buildModule;

const siteSchemaUrl = new URL("../../prompts/schemas/site.schema.json", import.meta.url);
const buildPromptUrl = new URL("../../prompts/build-system.md", import.meta.url);

const MOTION_MOVES = [
  "pinned chapter passage",
  "horizontal click reel",
  "numbered story stepper",
  "staged hero entrance",
  "gentle one direction scroll reveals",
];

const MOTION_SLUGS = {
  "pinned chapter passage": "pinned-chapter-passage",
  "horizontal click reel": "horizontal-click-reel",
  "numbered story stepper": "numbered-story-stepper",
  "staged hero entrance": "staged-hero-entrance",
  "gentle one direction scroll reveals": "gentle-scroll-reveals",
};

function safeManifest() {
  const motionMoves = ["staged hero entrance"];
  return {
    indexHtml: `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'">
  <title>Juniper Oven</title>
  <link rel="stylesheet" href="styles.css">
</head>
<body data-motion-moves="staged-hero-entrance">
  <a class="skip-link" href="#main">Skip to content</a>
  <header><nav aria-label="Primary"><a href="#offerings">Offerings</a></nav></header>
  <main id="main">
    <section id="hero" data-section="hero" data-motion-root="staged-hero-entrance">
      <div data-first-beat data-motion-target>
        <h1>Bread for the day ahead</h1>
        <img src="assets/bread-hero.png" alt="Baker shaping a loaf on a wooden work surface">
      </div>
    </section>
    <section id="offerings" data-section="offerings">
      <div data-first-beat>
        <h2>From the oven</h2><p>Fresh loaves made with care.</p>
        <img src="assets/bread-shelf.png" alt="Fresh bread arranged on a bakery shelf">
      </div>
    </section>
    <section id="story" data-section="story">
      <div data-first-beat>
        <h2>Care in every batch</h2>
        <img src="assets/flour-detail.png" alt="Flour and grain beside a mixing bowl">
        <a href="#offerings" data-primary-action>See today&apos;s selection</a>
      </div>
    </section>
  </main>
  <footer><p>Juniper Oven</p></footer>
  <script src="script.js" defer></script>
</body>
</html>`,
    stylesCss: `:root { color-scheme: light; --ink: #252820; --paper: #f3ebdd; }
* { box-sizing: border-box; }
body { margin: 0; color: var(--ink); background: var(--paper); font-family: Georgia, serif; }
a:focus-visible { outline: 3px solid currentColor; outline-offset: 4px; }
@media (prefers-reduced-motion: reduce) { *, *::before, *::after { scroll-behavior: auto !important; } }`,
    scriptJs:
      typeof buildModule.createOwnedMotionRuntime === "function"
        ? buildModule.createOwnedMotionRuntime(motionMoves)
        : "",
    imagePlan: [
      {
        filename: "bread-hero.png",
        role: "hero",
        alt: "Baker shaping a loaf on a wooden work surface",
        prompt: "Warm bakery workbench with a baker shaping a fresh loaf",
        focalPoint: { x: 0.56, y: 0.42 },
      },
      {
        filename: "bread-shelf.png",
        role: "offerings",
        alt: "Fresh bread arranged on a bakery shelf",
        prompt: "Fresh artisan loaves arranged on a simple bakery shelf",
        focalPoint: { x: 0.5, y: 0.5 },
      },
      {
        filename: "flour-detail.png",
        role: "story",
        alt: "Flour and grain beside a mixing bowl",
        prompt: "Quiet still life of flour grain and a ceramic mixing bowl",
        focalPoint: { x: 0.42, y: 0.58 },
      },
    ],
    designNotes: {
      aesthetic: "High desert bakehouse",
      signatureMove: "A botanical line connects each section",
      rationale: "The visual language feels local and tactile",
      shootDirection: "Warm morning light natural textures and close human craft",
      motionMoves,
    },
  };
}

function modelManifest() {
  return { ...safeManifest(), scriptJs: "" };
}

function setMotionMoves(manifest, moves) {
  const slugs = moves.map((move) => MOTION_SLUGS[move] ?? move);
  manifest.designNotes.motionMoves = moves;
  manifest.scriptJs =
    typeof buildModule.createOwnedMotionRuntime === "function"
      ? buildModule.createOwnedMotionRuntime(moves)
      : "";
  manifest.indexHtml = manifest.indexHtml.replace(
    /data-motion-moves="[^"]*"/,
    `data-motion-moves="${slugs.join(" ")}"`,
  );
  return manifest;
}

function brief() {
  return {
    business: {
      name: "Juniper Oven",
      city: "Flagstaff, AZ",
      category: "Neighborhood bakery",
      summary: "A warm bakery concept.",
    },
    audience: { primary: "Neighbors", needs: ["Fresh bread", "Clear details"] },
    offerings: [
      { name: "Daily bread", description: "Fresh loaves", confidence: "inferred" },
    ],
    brand: {
      personality: ["Warm", "Grounded", "Craft focused"],
      voice: "Neighborly",
      aesthetic: "High desert bakehouse",
      signatureMove: {
        name: "Juniper trail",
        description: "A fine line connects the story",
        touchFallback: "The line stays visible",
        reducedMotion: "The line does not animate",
      },
      palette: {
        background: "#F3EBDD",
        surface: "#D8C5A5",
        text: "#252820",
        accent: "#315748",
      },
    },
    content: {
      eyebrow: "Neighborhood baking",
      headline: "Bread for the day ahead",
      subheadline: "Fresh food made with care.",
      about: "A warm bakery concept.",
      primaryAction: "Explore the menu",
      secondaryAction: "Learn the story",
      contactPrompt: "Ask about the daily selection.",
    },
    contact: { phone: null, email: null, address: null, hours: null },
    facts: { confirmed: [], inferred: [], needed: ["Hours"] },
  };
}

test("validateSiteManifest accepts a semantic, self contained site", () => {
  assert.deepEqual(validateSiteManifest(safeManifest()), safeManifest());
});

test("site schema exposes exactly the strict five field model contract", async () => {
  const schema = JSON.parse(await readFile(siteSchemaUrl, "utf8"));
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(Object.keys(schema.properties).sort(), [
    "designNotes",
    "imagePlan",
    "indexHtml",
    "scriptJs",
    "stylesCss",
  ]);
  assert.deepEqual([...schema.required].sort(), Object.keys(schema.properties).sort());
  assert.equal(schema.properties.scriptJs.const, "");

  const imagePlan = schema.properties.imagePlan;
  assert.equal(imagePlan.minItems, 3);
  assert.equal(imagePlan.maxItems, 5);
  assert.equal(imagePlan.items.additionalProperties, false);
  assert.deepEqual([...imagePlan.items.required].sort(), [
    "alt",
    "filename",
    "focalPoint",
    "prompt",
    "role",
  ]);
  assert.equal(new RegExp(imagePlan.items.properties.filename.pattern).test("bread-hero.png"), true);
  assert.equal(new RegExp(imagePlan.items.properties.filename.pattern).test("Bread.png"), false);
  assert.equal(imagePlan.items.properties.focalPoint.additionalProperties, false);
  assert.equal(imagePlan.items.properties.focalPoint.properties.x.minimum, 0);
  assert.equal(imagePlan.items.properties.focalPoint.properties.x.maximum, 1);
  assert.equal(imagePlan.items.properties.focalPoint.properties.y.minimum, 0);
  assert.equal(imagePlan.items.properties.focalPoint.properties.y.maximum, 1);

  const designNotes = schema.properties.designNotes;
  assert.equal(designNotes.additionalProperties, false);
  assert.deepEqual([...designNotes.required].sort(), [
    "aesthetic",
    "motionMoves",
    "rationale",
    "shootDirection",
    "signatureMove",
  ]);
  assert.equal(designNotes.properties.motionMoves.minItems, 1);
  assert.equal(designNotes.properties.motionMoves.maxItems, 2);
  assert.equal(designNotes.properties.motionMoves.uniqueItems, true);
  assert.deepEqual(designNotes.properties.motionMoves.items.enum, MOTION_MOVES);
});

test("builder prompt states the minimum expanded response and safety contract", async () => {
  const prompt = await readFile(buildPromptUrl, "utf8");
  for (const field of ["indexHtml", "stylesCss", "scriptJs", "imagePlan", "designNotes"]) {
    assert.match(prompt, new RegExp(`\\b${field}\\b`));
  }
  assert.match(prompt, /empty `scriptJs` sentinel/i);
  assert.match(prompt, /assets\/<planned lowercase filename>\.png/i);
  assert.match(
    prompt,
    /default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'/,
  );
  assert.match(prompt, /data-motion-moves/i);
  assert.match(prompt, /data-section/i);
  assert.match(prompt, /data-first-beat/i);
});

test("owned motion runtime is deterministic, selected move only, and byte exact", async () => {
  assert.equal(typeof buildModule.createOwnedMotionRuntime, "function");
  const staged = buildModule.createOwnedMotionRuntime(["staged hero entrance"]);
  assert.equal(staged, buildModule.createOwnedMotionRuntime(["staged hero entrance"]));
  assert.match(staged, /staged-hero-entrance/);
  assert.doesNotMatch(staged, /horizontal-click-reel/);

  const result = await buildSite({
    brief: brief(),
    structuredRequester: async () => modelManifest(),
  });
  assert.equal(result.source, "openai");
  assert.equal(result.scriptJs, staged);
  validateSiteManifest(result);

  const tampered = { ...result, scriptJs: `${result.scriptJs}\n` };
  assert.throws(() => validateSiteManifest(tampered), /owned motion runtime/i);
});

test("buildSite never accepts model supplied JavaScript bytes", async () => {
  let calls = 0;
  const result = await buildSite({
    brief: brief(),
    structuredRequester: async () => {
      calls += 1;
      return { ...modelManifest(), scriptJs: "globalThis.modelCodeRan = true;" };
    },
  });

  assert.equal(calls, 2);
  assert.equal(result.source, "deterministic-fallback");
  assert.doesNotMatch(result.scriptJs, /modelCodeRan/);
  validateSiteManifest(result);
});

test("validateSiteManifest rejects extra manifest fields and malformed nested values", () => {
  const extra = { ...safeManifest(), extra: true };
  assert.throws(() => validateSiteManifest(extra), /exact manifest fields/i);

  const shortPlan = safeManifest();
  shortPlan.imagePlan = shortPlan.imagePlan.slice(0, 2);
  assert.throws(() => validateSiteManifest(shortPlan), /three to five/i);

  const badFocalPoint = safeManifest();
  badFocalPoint.imagePlan[0].focalPoint.x = 1.01;
  assert.throws(() => validateSiteManifest(badFocalPoint), /focal point/i);

  const extraImageField = safeManifest();
  extraImageField.imagePlan[0].credit = "Unknown";
  assert.throws(() => validateSiteManifest(extraImageField), /image plan fields/i);

  const missingShootDirection = safeManifest();
  delete missingShootDirection.designNotes.shootDirection;
  assert.throws(() => validateSiteManifest(missingShootDirection), /design note fields/i);
});

test("validateSiteManifest accepts only one or two distinct published motion moves", () => {
  for (const motionMoves of [
    [],
    ["staged hero entrance", "staged hero entrance"],
    ["staged hero entrance", "unknown move"],
    ["staged hero entrance", "gentle one direction scroll reveals", "pinned chapter passage"],
  ]) {
    const manifest = safeManifest();
    manifest.designNotes.motionMoves = motionMoves;
    manifest.scriptJs = "";
    assert.throws(() => validateSiteManifest(manifest), /motion moves/i);
  }
});

test("validateSiteManifest requires exact CSP once", () => {
  const variants = [
    ["Content-Security-Policy", "Content-Security-Policy-Report-Only"],
    ["form-action 'none'", "form-action 'none'; default-src *"],
    ["img-src 'self'", "img-src 'self' data:"],
    ["img-src 'self'", "img-src 'self' blob:"],
  ];

  const missing = safeManifest();
  missing.indexHtml = missing.indexHtml.replace(/\s*<meta http-equiv="Content-Security-Policy"[^>]*>/, "");
  assert.throws(() => validateSiteManifest(missing), /content security policy/i);

  const duplicate = safeManifest();
  const csp = duplicate.indexHtml.match(/<meta http-equiv="Content-Security-Policy"[^>]*>/)[0];
  duplicate.indexHtml = duplicate.indexHtml.replace(csp, `${csp}\n  ${csp}`);
  assert.throws(() => validateSiteManifest(duplicate), /content security policy/i);

  const outsideHead = safeManifest();
  const outsideHeadCsp = outsideHead.indexHtml.match(/<meta http-equiv="Content-Security-Policy"[^>]*>/)[0];
  outsideHead.indexHtml = outsideHead.indexHtml
    .replace(outsideHeadCsp, "")
    .replace("</head>", `</head>${outsideHeadCsp}`);
  assert.throws(() => validateSiteManifest(outsideHead), /content security policy/i);

  for (const [from, to] of variants) {
    const manifest = safeManifest();
    manifest.indexHtml = manifest.indexHtml.replace(from, to);
    assert.throws(() => validateSiteManifest(manifest), /content security policy/i);
  }
});

test("validateSiteManifest rejects asset path attacks and non PNG references", () => {
  const attacks = [
    "assets/unplanned.png",
    "../bread-hero.png",
    "/assets/bread-hero.png",
    "assets\\bread-hero.png",
    "assets/%62read-hero.png",
    "assets/bread-hero&#46;png",
    "assets/bread-hero.png?size=2",
    "assets/bread-hero.png#crop",
    "assets/bread-hero.jpg",
    "data:image/png;base64,AAAA",
    "https://example.invalid/bread-hero.png",
  ];
  for (const src of attacks) {
    const manifest = safeManifest();
    manifest.indexHtml = manifest.indexHtml.replace("assets/bread-hero.png", src);
    assert.throws(() => validateSiteManifest(manifest), /image|asset|url/i, src);
  }

  const srcset = safeManifest();
  srcset.indexHtml = srcset.indexHtml.replace(
    'src="assets/bread-hero.png"',
    'src="assets/bread-hero.png" srcset="assets/bread-hero.png 2x"',
  );
  assert.throws(() => validateSiteManifest(srcset), /srcset/i);
});

test("validateSiteManifest enforces planned image names, references, and exact alt text", () => {
  const unused = safeManifest();
  unused.indexHtml = unused.indexHtml.replace(/\s*<img src="assets\/flour-detail\.png"[^>]*>/, "");
  assert.throws(() => validateSiteManifest(unused), /planned image.*referenced/i);

  const missingAlt = safeManifest();
  missingAlt.indexHtml = missingAlt.indexHtml.replace(
    ' alt="Fresh bread arranged on a bakery shelf"',
    "",
  );
  assert.throws(() => validateSiteManifest(missingAlt), /alt text/i);

  const mismatchedAlt = safeManifest();
  mismatchedAlt.indexHtml = mismatchedAlt.indexHtml.replace(
    "Fresh bread arranged on a bakery shelf",
    "Bread on a shelf",
  );
  assert.throws(() => validateSiteManifest(mismatchedAlt), /alt text/i);

  const duplicate = safeManifest();
  duplicate.imagePlan[1].filename = duplicate.imagePlan[0].filename;
  assert.throws(() => validateSiteManifest(duplicate), /duplicate|collision/i);

  const caseCollision = safeManifest();
  caseCollision.imagePlan[1].filename = "Bread-Hero.png";
  assert.throws(() => validateSiteManifest(caseCollision), /lowercase|collision/i);

  for (const reserved of ["con.png", "PRN.png", "aux.png", "nul.png", "com1.png", "lpt9.png"]) {
    const manifest = safeManifest();
    manifest.imagePlan[0].filename = reserved;
    manifest.indexHtml = manifest.indexHtml.replace("bread-hero.png", reserved);
    assert.throws(() => validateSiteManifest(manifest), /reserved|lowercase/i, reserved);
  }
});

test("validateSiteManifest enforces section first beat and declared root hooks", () => {
  const noSectionHook = safeManifest();
  noSectionHook.indexHtml = noSectionHook.indexHtml.replace(' data-section="story"', "");
  assert.throws(() => validateSiteManifest(noSectionHook), /data-section/i);

  const noFirstBeat = safeManifest();
  noFirstBeat.indexHtml = noFirstBeat.indexHtml.replace(" data-first-beat", "");
  assert.throws(() => validateSiteManifest(noFirstBeat), /data-first-beat/i);

  const duplicateFirstBeat = safeManifest();
  duplicateFirstBeat.indexHtml = duplicateFirstBeat.indexHtml.replace(
    "<h1>Bread for the day ahead</h1>",
    "<h1 data-first-beat>Bread for the day ahead</h1>",
  );
  assert.throws(() => validateSiteManifest(duplicateFirstBeat), /data-first-beat/i);

  const hiddenFirstBeat = safeManifest();
  hiddenFirstBeat.indexHtml = hiddenFirstBeat.indexHtml.replace(
    "<div data-first-beat data-motion-target>",
    "<div data-first-beat data-motion-target hidden>",
  );
  assert.throws(() => validateSiteManifest(hiddenFirstBeat), /visible data-first-beat/i);

  const hiddenSection = safeManifest();
  hiddenSection.indexHtml = hiddenSection.indexHtml.replace(
    '<section id="offerings" data-section="offerings">',
    '<section id="offerings" data-section="offerings" hidden>',
  );
  assert.throws(() => validateSiteManifest(hiddenSection), /visible data-first-beat/i);

  const wrongDeclaration = safeManifest();
  wrongDeclaration.indexHtml = wrongDeclaration.indexHtml.replace(
    'data-motion-moves="staged-hero-entrance"',
    'data-motion-moves="gentle-scroll-reveals"',
  );
  assert.throws(() => validateSiteManifest(wrongDeclaration), /declared motion/i);

  const duplicateRoot = safeManifest();
  duplicateRoot.indexHtml = duplicateRoot.indexHtml.replace(
    'data-section="offerings"',
    'data-section="offerings" data-motion-root="staged-hero-entrance"',
  );
  assert.throws(() => validateSiteManifest(duplicateRoot), /motion root/i);
});

test("interactive motion roots require button controls with matching panels", () => {
  for (const [move, slug] of [
    ["horizontal click reel", "horizontal-click-reel"],
    ["numbered story stepper", "numbered-story-stepper"],
  ]) {
    const manifest = setMotionMoves(safeManifest(), [move]);
    manifest.indexHtml = manifest.indexHtml
      .replace('data-motion-root="staged-hero-entrance"', `data-motion-root="${slug}"`)
      .replace(
        "<h1>Bread for the day ahead</h1>",
        `<h1>Bread for the day ahead</h1>
        <button type="button" data-motion-control="first">First view</button>
        <button type="button" data-motion-control="second">Second view</button>
        <div data-motion-panel="first"><p>First selection</p></div>
        <div data-motion-panel="second"><p>Second selection</p></div>`,
      );
    validateSiteManifest(manifest);

    const wrongElement = structuredClone(manifest);
    wrongElement.indexHtml = wrongElement.indexHtml.replace(
      '<button type="button" data-motion-control="first">',
      '<a href="#story" data-motion-control="first">',
    ).replace("</button>", "</a>");
    assert.throws(() => validateSiteManifest(wrongElement), /button.*data-motion-control/i);

    const missingPanel = structuredClone(manifest);
    missingPanel.indexHtml = missingPanel.indexHtml.replace('data-motion-panel="second"', 'data-motion-panel="other"');
    assert.throws(() => validateSiteManifest(missingPanel), /matching.*data-motion-panel/i);
  }
});

test("validateSiteManifest rejects active or remote content", () => {
  const scripted = safeManifest();
  scripted.indexHtml = scripted.indexHtml.replace("</body>", "<script>alert(1)</script></body>");
  assert.throws(() => validateSiteManifest(scripted), /forbidden html/i);

  const remote = safeManifest();
  remote.stylesCss += "\n.hero { background-image: url(https://example.com/image.jpg); }";
  assert.throws(() => validateSiteManifest(remote), /remote or embedded css assets/i);

  const unsupportedPolicy = safeManifest();
  unsupportedPolicy.indexHtml = unsupportedPolicy.indexHtml.replace(
    "form-action 'none'",
    "form-action 'none'; frame-ancestors 'none'",
  );
  assert.throws(() => validateSiteManifest(unsupportedPolicy), /frame-ancestors/i);
});

test("validateSiteManifest rejects encoded active links and altered script sources", () => {
  const encodedActiveLink = safeManifest();
  encodedActiveLink.indexHtml = encodedActiveLink.indexHtml.replace(
    'href="#offerings" data-primary-action',
    'href="jav&#x61;script:alert(1)" data-primary-action',
  );
  assert.throws(() => validateSiteManifest(encodedActiveLink), /local fragment link/i);

  for (const alteredTag of [
    '<script src="script.js"></script>',
    '<script src="script.js?cache=1" defer></script>',
    '<script src="script.js#run" defer></script>',
    '<script src="script\\.js" defer></script>',
    '<script src="%73cript.js" defer></script>',
    '<script src="https://example.invalid/script.js" defer></script>',
    '<script defer>void 0</script>',
  ]) {
    const manifest = safeManifest();
    manifest.indexHtml = manifest.indexHtml.replace(
      '<script src="script.js" defer></script>',
      alteredTag,
    );
    assert.throws(() => validateSiteManifest(manifest), /forbidden html|active content/i, alteredTag);
  }
});

test("validateSiteManifest rejects undeclared resource loaders and inline styles", () => {
  for (const injection of [
    '<video src="assets/local.mp4"></video>',
    '<audio><source src="assets/local.mp3"></audio>',
    '<svg><use href="assets/icons.svg#mark"></use></svg>',
    '<meta http-equiv="refresh" content="0;url=jav&#x61;script:alert(1)">',
    '<div style="background-image: url(assets/unplanned.png)">Visual</div>',
  ]) {
    const manifest = safeManifest();
    manifest.indexHtml = manifest.indexHtml.replace("</main>", `${injection}</main>`);
    assert.throws(
      () => validateSiteManifest(manifest),
      /forbidden html|resource loader|inline style/i,
      injection,
    );
  }
});

test("validateSiteManifest rejects dashes, emojis, and placeholders in visible copy", () => {
  const dashed = safeManifest();
  dashed.indexHtml = dashed.indexHtml.replace("Fresh loaves", "Fresh loaves — every day");
  assert.throws(() => validateSiteManifest(dashed), /dash characters/i);

  const emoji = safeManifest();
  emoji.indexHtml = emoji.indexHtml.replace("From the oven", "From the oven 🍞");
  assert.throws(() => validateSiteManifest(emoji), /emoji/i);

  const placeholder = safeManifest();
  placeholder.indexHtml = placeholder.indexHtml.replace("made with care", "lorem ipsum");
  assert.throws(() => validateSiteManifest(placeholder), /placeholder/i);
});

test("buildSite regenerates one unsafe model page before accepting output", async () => {
  let calls = 0;
  const unsafe = modelManifest();
  unsafe.indexHtml = unsafe.indexHtml.replace("</body>", "<script>alert(1)</script></body>");

  const result = await buildSite({
    brief: brief(),
    structuredRequester: async () => {
      calls += 1;
      return calls === 1 ? unsafe : modelManifest();
    },
  });

  assert.equal(calls, 2);
  assert.equal(result.source, "openai");
  assert.equal(result.indexHtml, safeManifest().indexHtml);
});

test("buildSite ships a deterministic baseline when the model is unavailable", async () => {
  const result = await buildSite({
    brief: brief(),
    structuredRequester: async () => {
      throw new Error("network unavailable");
    },
  });

  assert.equal(result.source, "deterministic-fallback");
  assert.match(result.indexHtml, /Juniper Oven/);
  assert.match(result.indexHtml, /<script src="script\.js" defer><\/script>/i);
  assert.equal(result.scriptJs, buildModule.createOwnedMotionRuntime(result.designNotes.motionMoves));
  validateSiteManifest(result);
});

test("deterministic fallback remains valid for an HTML significant business name", async () => {
  const specialBrief = brief();
  specialBrief.business.name = "Juniper & Oven";
  const result = await buildSite({
    brief: specialBrief,
    structuredRequester: async () => {
      throw new Error("network unavailable");
    },
  });
  assert.equal(result.source, "deterministic-fallback");
  validateSiteManifest(result);
});

test("writeSiteFiles writes the fixed public file set without overwrite", async () => {
  const siteDir = path.join(process.cwd(), "tmp", randomUUID(), "site");
  await writeSiteFiles(siteDir, safeManifest());

  assert.match(await readFile(path.join(siteDir, "index.html"), "utf8"), /<!doctype html>/i);
  assert.match(await readFile(path.join(siteDir, "styles.css"), "utf8"), /color-scheme/);
  assert.equal(await readFile(path.join(siteDir, "script.js"), "utf8"), safeManifest().scriptJs);
  await assert.rejects(writeSiteFiles(siteDir, safeManifest()), /already exists/i);
});

test("buildRun turns a saved brief into the first immutable cycle", async () => {
  const runDir = path.join(process.cwd(), "tmp", randomUUID(), "runs", "juniper-oven");
  await mkdir(runDir, { recursive: true });
  await writeFile(path.join(runDir, "brief.json"), JSON.stringify(brief()), "utf8");

  const result = await buildRun({
    runDir,
    buildSiteFn: async () => ({ ...safeManifest(), source: "openai" }),
    now: () => new Date("2026-07-17T13:00:00.000Z"),
  });

  assert.equal(result.cycle, 1);
  assert.match(await readFile(path.join(result.siteDir, "index.html"), "utf8"), /Juniper Oven/);
  const buildRecord = JSON.parse(
    await readFile(path.join(runDir, "cycle-01", "build.json"), "utf8"),
  );
  assert.equal(buildRecord.source, "openai");
  assert.equal(buildRecord.createdAt, "2026-07-17T13:00:00.000Z");
});
