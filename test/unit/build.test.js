import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { chromium } from "playwright";

import * as buildModule from "../../src/build.js";
import {
  createDeterministicPng,
  materializeAssets,
  validatePngBuffer,
} from "../../src/assets.js";

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

const API_SUPPORTED_SCHEMA_KEYWORDS = new Set([
  "$schema",
  "type",
  "properties",
  "required",
  "additionalProperties",
  "enum",
  "minLength",
  "maxLength",
  "pattern",
  "minItems",
  "maxItems",
  "items",
  "minimum",
  "maximum",
]);

function assertApiCompatibleSchema(schema, path = "$") {
  for (const [keyword, value] of Object.entries(schema)) {
    assert.ok(
      API_SUPPORTED_SCHEMA_KEYWORDS.has(keyword),
      `Unsupported strict schema keyword ${keyword} at ${path}`,
    );
    if (keyword === "properties") {
      for (const [propertyName, propertySchema] of Object.entries(value)) {
        assertApiCompatibleSchema(propertySchema, `${path}.properties.${propertyName}`);
      }
    } else if (keyword === "items" && value && typeof value === "object") {
      assertApiCompatibleSchema(value, `${path}.items`);
    }
  }
}

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
@media (prefers-reduced-motion: reduce) { *, *::before, *::after { scroll-behavior: auto !important; } }${
      typeof buildModule.createOwnedMotionStyles === "function"
        ? buildModule.createOwnedMotionStyles(motionMoves)
        : ""
    }`,
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
  const manifest = safeManifest();
  const ownedStyles = typeof buildModule.createOwnedMotionStyles === "function"
    ? buildModule.createOwnedMotionStyles(manifest.designNotes.motionMoves)
    : "";
  return { ...manifest, stylesCss: manifest.stylesCss.slice(0, -ownedStyles.length), scriptJs: "" };
}

function setMotionMoves(manifest, moves) {
  const slugs = moves.map((move) => MOTION_SLUGS[move] ?? move);
  const previousMoves = manifest.designNotes.motionMoves;
  const previousStyles = typeof buildModule.createOwnedMotionStyles === "function"
    ? buildModule.createOwnedMotionStyles(previousMoves)
    : "";
  manifest.designNotes.motionMoves = moves;
  manifest.scriptJs =
    typeof buildModule.createOwnedMotionRuntime === "function"
      ? buildModule.createOwnedMotionRuntime(moves)
      : "";
  if (previousStyles) {
    manifest.stylesCss = `${manifest.stylesCss.slice(0, -previousStyles.length)}${buildModule.createOwnedMotionStyles(moves)}`;
  }
  manifest.indexHtml = manifest.indexHtml.replace(
    /data-motion-moves="[^"]*"/,
    `data-motion-moves="${slugs.join(" ")}"`,
  );
  return manifest;
}

function appendModelCss(manifest, css) {
  const ownedStyles = buildModule.createOwnedMotionStyles(manifest.designNotes.motionMoves);
  manifest.stylesCss = `${manifest.stylesCss.slice(0, -ownedStyles.length)}\n${css}${ownedStyles}`;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
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
  assert.deepEqual(schema.properties.scriptJs.enum, [""]);
  assert.equal(Object.hasOwn(schema.properties.scriptJs, "const"), false);

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
  assert.equal(Object.hasOwn(designNotes.properties.motionMoves, "uniqueItems"), false);
  assert.deepEqual(designNotes.properties.motionMoves.items.enum, MOTION_MOVES);
  assertApiCompatibleSchema(schema);
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
  for (const [move, slug] of Object.entries(MOTION_SLUGS)) {
    assert.ok(prompt.includes(`\`${move}\` maps to \`${slug}\``));
  }
  assert.ok(
    prompt.includes(
      "Staged hero entrance and gentle one direction scroll reveals roots require at least one `[data-motion-target]`.",
    ),
  );
  assert.ok(
    prompt.includes(
      "Horizontal click reel and numbered story stepper roots require at least two button `[data-motion-control]` elements and at least two matching `[data-motion-panel]` elements.",
    ),
  );
});

test("owned motion runtime is deterministic, selected move only, and byte exact", async () => {
  assert.equal(typeof buildModule.createOwnedMotionRuntime, "function");
  const staged = buildModule.createOwnedMotionRuntime(["staged hero entrance"]);
  assert.equal(sha256(staged), "8338c7eca7f263025e8db69bc5b8892d974ddca5d1915ca652de1ded12989de6");
  assert.match(staged, /staged-hero-entrance/);
  assert.doesNotMatch(staged, /horizontal-click-reel/);

  const result = await buildSite({
    brief: brief(),
    structuredRequester: async () => modelManifest(),
  });
  assert.equal(result.source, "openai");
  assert.equal(sha256(result.scriptJs), "8338c7eca7f263025e8db69bc5b8892d974ddca5d1915ca652de1ded12989de6");
  validateSiteManifest(result);

  const tampered = { ...result, scriptJs: `${result.scriptJs}\n` };
  assert.throws(() => validateSiteManifest(tampered), /owned motion runtime/i);
});

test("owned motion CSS is a deterministic final suffix and cannot be altered", async () => {
  assert.equal(typeof buildModule.createOwnedMotionStyles, "function");
  const ownedStyles = buildModule.createOwnedMotionStyles(["staged hero entrance"]);
  assert.equal(sha256(ownedStyles), "70c6490e51b4fd83e65da84f465638393c12318e3088bc4cedae24fd749232b2");
  assert.match(ownedStyles, /prefers-reduced-motion/);

  const result = await buildSite({
    brief: brief(),
    structuredRequester: async () => modelManifest(),
  });
  assert.ok(result.stylesCss.endsWith(ownedStyles));
  validateSiteManifest(result);

  const missingByte = { ...result, stylesCss: result.stylesCss.slice(0, -1) };
  assert.throws(() => validateSiteManifest(missingByte), /owned motion styles/i);
  const extraByte = { ...result, stylesCss: `${result.stylesCss}\n.model-override { opacity: 0; }` };
  assert.throws(() => validateSiteManifest(extraByte), /owned motion styles/i);
});

test("buildSite rejects model CSS that targets Mainstreet owned motion hooks", async () => {
  const candidate = modelManifest();
  candidate.stylesCss += "\n[data-motion-target] { opacity: 0.123 !important; }";
  const result = await buildSite({
    brief: brief(),
    structuredRequester: async () => candidate,
  });
  assert.equal(result.source, "deterministic-fallback");
  assert.doesNotMatch(result.stylesCss, /opacity: 0.123 !important/);
});

test("buildSite rejects indirect CSS that can hide or override hooked source DOM", async (t) => {
  const attacks = [
    ["target class opacity", ".motion-copy { opacity: 0 !important; }"],
    ["first beat class visibility", ".offerings-copy { visibility: hidden; }"],
    ["root ancestor transform", ".hero-shell { transform: none !important; }"],
    ["first beat attribute", "[data-first-beat] { display: none; }"],
    ["owned custom property", ":root { --motion-progress: 1; }"],
  ];
  for (const [name, attack] of attacks) {
    await t.test(name, async () => {
      const candidate = modelManifest();
      candidate.indexHtml = candidate.indexHtml
        .replace("<div data-first-beat data-motion-target>", '<div class="motion-copy" data-first-beat data-motion-target>')
        .replace('<section id="hero"', '<section class="hero-shell" id="hero"')
        .replace('<div data-first-beat>\n        <h2>From the oven</h2>', '<div class="offerings-copy" data-first-beat>\n        <h2>From the oven</h2>');
      candidate.stylesCss += `\n${attack}`;
      const result = await buildSite({ brief: brief(), structuredRequester: async () => candidate });
      assert.equal(result.source, "deterministic-fallback");
      assert.equal(result.stylesCss.includes(attack), false);
    });
  }
});

test("owned styles keep every hooked element visibly rendered when JavaScript is disabled", async () => {
  const manifest = setMotionMoves(safeManifest(), ["horizontal click reel"]);
  manifest.indexHtml = manifest.indexHtml
    .replace('data-motion-root="staged-hero-entrance"', 'data-motion-root="horizontal-click-reel"')
    .replace(
      "<h1>Bread for the day ahead</h1>",
      `<h1>Bread for the day ahead</h1>
        <button type="button" data-motion-control="first">First view</button>
        <button type="button" data-motion-control="second">Second view</button>
        <div data-motion-panel="first"><p>First selection</p></div>
        <div data-motion-panel="second"><p>Second selection</p></div>`,
    );
  validateSiteManifest(manifest);
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    const browserHtml = manifest.indexHtml
      .replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/i, "")
      .replace('<link rel="stylesheet" href="styles.css">', `<style>${manifest.stylesCss}</style>`)
      .replace('<script src="script.js" defer></script>', "");
    await page.setContent(browserHtml);
    const states = await page.locator("[data-first-beat], [data-motion-target], [data-motion-panel]").evaluateAll((elements) =>
      elements.map((element) => {
        const style = getComputedStyle(element);
        const bounds = element.getBoundingClientRect();
        return { display: style.display, visibility: style.visibility, opacity: Number(style.opacity), width: bounds.width, height: bounds.height };
      }),
    );
    assert.ok(states.length >= 5);
    assert.ok(states.every((state) => state.display !== "none" && state.visibility === "visible" && state.opacity >= 0.95 && state.width > 0 && state.height > 0), JSON.stringify(states));
    await context.close();
  } finally {
    await browser.close();
  }
});

test("owned motion contract includes ready gating, rAF refresh, and reduced motion disable state", () => {
  const styles = buildModule.createOwnedMotionStyles(["pinned chapter passage", "gentle one direction scroll reveals"]);
  const runtime = buildModule.createOwnedMotionRuntime(["pinned chapter passage", "gentle one direction scroll reveals"]);
  assert.equal(sha256(styles), "202aeecd9909f8f0bb06ce4f2a939c90c92ba13c3ba31fd61c531e14999d2e82");
  assert.equal(sha256(runtime), "4000a8b1c3acf92e40401bbf75c1b883e7292045b550dd929b36148380bfa394");
  assert.match(styles, /data-motion-ready/);
  assert.match(styles, /motion-progress/);
  assert.match(styles, /prefers-reduced-motion/);
  assert.match(runtime, /dataset\.motionState = "idle"/);
  assert.match(runtime, /dataset\.motionState = "disabled"/);
  assert.match(runtime, /requestAnimationFrame/);
  assert.match(runtime, /addEventListener\("resize"/);
  assert.match(runtime, /IntersectionObserver/);
  assert.match(runtime, /body\.dataset\.motionReady/);
});

test("staged owned motion paints the active hidden state before revealing targets", () => {
  const frames = [];
  const target = { dataset: {} };
  const root = {
    dataset: {},
    querySelectorAll: () => [target],
  };
  const body = { dataset: {} };
  const windowStub = {
    matchMedia: () => ({ matches: false }),
    requestAnimationFrame: (callback) => frames.push(callback),
  };
  const documentStub = {
    body,
    querySelector: () => root,
  };

  new Function("window", "document", buildModule.createOwnedMotionRuntime(["staged hero entrance"]))(
    windowStub,
    documentStub,
  );
  assert.equal(root.dataset.motionState, "idle");
  assert.equal(target.dataset.motionVisible, undefined);
  assert.equal(body.dataset.motionReady, "true");

  frames.shift()();
  assert.equal(root.dataset.motionState, "active");
  assert.equal(target.dataset.motionVisible, undefined);

  frames.shift()();
  assert.equal(target.dataset.motionVisible, "true");
});

test("source motion targets and panels must remain visible without JavaScript", () => {
  for (const hiddenState of [
    "hidden",
    'aria-hidden="true"',
    'style="display: none"',
  ]) {
    const manifest = safeManifest();
    manifest.indexHtml = manifest.indexHtml.replace(
      "<h1>Bread for the day ahead</h1>",
      `<h1>Bread for the day ahead</h1><p data-motion-target ${hiddenState}>Later target</p>`,
    );
    assert.throws(() => validateSiteManifest(manifest), /(?:visible.*motion|motion.*visible|inline style)/i);
  }

  const interactive = setMotionMoves(safeManifest(), ["horizontal click reel"]);
  interactive.indexHtml = interactive.indexHtml
    .replace('data-motion-root="staged-hero-entrance"', 'data-motion-root="horizontal-click-reel"')
    .replace(
      "<h1>Bread for the day ahead</h1>",
      `<h1>Bread for the day ahead</h1>
        <button type="button" data-motion-control="first">First view</button>
        <button type="button" data-motion-control="second">Second view</button>
        <div data-motion-panel="first" hidden><p>First selection</p></div>
        <div data-motion-panel="second"><p>Second selection</p></div>`,
    );
  assert.throws(() => validateSiteManifest(interactive), /(?:visible.*motion.*panel|motion.*panel.*visible)/i);
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

  const commented = safeManifest();
  const commentedCsp = commented.indexHtml.match(/<meta http-equiv="Content-Security-Policy"[^>]*>/)[0];
  commented.indexHtml = commented.indexHtml.replace(commentedCsp, `<!-- ${commentedCsp} -->`);
  assert.throws(() => validateSiteManifest(commented), /content security policy/i);

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

  const hiddenWrapper = safeManifest();
  hiddenWrapper.indexHtml = hiddenWrapper.indexHtml
    .replace(
      '<section id="story" data-section="story">\n      <div data-first-beat>',
      '<section id="story" data-section="story">\n      <div hidden>\n      <div data-first-beat>',
    )
    .replace(
      '      </div>\n    </section>\n  </main>',
      '      </div>\n      </div>\n    </section>\n  </main>',
    );
  assert.throws(() => validateSiteManifest(hiddenWrapper), /visible data-first-beat/i);

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
  appendModelCss(remote, ".hero { background-image: url(https://example.com/image.jpg); }");
  assert.throws(() => validateSiteManifest(remote), /remote or embedded css assets/i);

  const unsupportedPolicy = safeManifest();
  unsupportedPolicy.indexHtml = unsupportedPolicy.indexHtml.replace(
    "form-action 'none'",
    "form-action 'none'; frame-ancestors 'none'",
  );
  assert.throws(() => validateSiteManifest(unsupportedPolicy), /frame-ancestors/i);
});

test("validateSiteManifest rejects inert containers around required source", () => {
  const policyInTemplate = safeManifest();
  const csp = policyInTemplate.indexHtml.match(/<meta http-equiv="Content-Security-Policy"[^>]*>/)[0];
  policyInTemplate.indexHtml = policyInTemplate.indexHtml.replace(csp, `<template>${csp}</template>`);
  assert.throws(() => validateSiteManifest(policyInTemplate), /forbidden html|inert container/i);

  const scriptInNoscript = safeManifest();
  const script = '<script src="script.js" defer></script>';
  scriptInNoscript.indexHtml = scriptInNoscript.indexHtml.replace(script, `<noscript>${script}</noscript>`);
  assert.throws(() => validateSiteManifest(scriptInNoscript), /forbidden html|inert container/i);

  const firstBeatInTemplate = safeManifest();
  firstBeatInTemplate.indexHtml = firstBeatInTemplate.indexHtml
    .replace(
      '<section id="hero" data-section="hero" data-motion-root="staged-hero-entrance">\n      <div',
      '<section id="hero" data-section="hero" data-motion-root="staged-hero-entrance">\n      <template>\n      <div',
    )
    .replace(
      '      </div>\n    </section>\n    <section id="offerings"',
      '      </div>\n      </template>\n    </section>\n    <section id="offerings"',
    );
  assert.throws(() => validateSiteManifest(firstBeatInTemplate), /forbidden html|inert container/i);
});

test("validateSiteManifest rejects CSS escape sequences", () => {
  for (const escapedCss of [
    ".hero { background-image: \\75rl(assets/unplanned.png); }",
    '@\\69mport "assets/unplanned.css";',
  ]) {
    const manifest = safeManifest();
    appendModelCss(manifest, escapedCss);
    assert.throws(() => validateSiteManifest(manifest), /css.*(?:escape|backslash)/i, escapedCss);
  }
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

  for (const entity of ["&mdash;", "&ndash;", "&hyphen;"]) {
    const encodedDash = safeManifest();
    encodedDash.indexHtml = encodedDash.indexHtml.replace("Fresh loaves", `Fresh ${entity} loaves`);
    assert.throws(() => validateSiteManifest(encodedDash), /dash characters/i, entity);
  }

  for (const entity of ["&#x1f600;", "&#128512;"]) {
    const encodedEmoji = safeManifest();
    encodedEmoji.indexHtml = encodedEmoji.indexHtml.replace("From the oven", `From the oven ${entity}`);
    assert.throws(() => validateSiteManifest(encodedEmoji), /emoji/i, entity);
  }
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

test("buildRun materializes assets before immutable sanitized build provenance", async () => {
  const runDir = path.join(process.cwd(), "tmp", randomUUID(), "runs", "juniper-oven");
  await mkdir(runDir, { recursive: true });
  await writeFile(path.join(runDir, "brief.json"), JSON.stringify(brief()), "utf8");
  let materializerCalls = 0;

  const result = await buildRun({
    runDir,
    buildSiteFn: async () => ({ ...safeManifest(), source: "openai" }),
    client: { images: { generate: async () => { throw new Error("network must not run"); } } },
    model: "test-image-model",
    requestImage: async () => { throw new Error("network must not run"); },
    materializeAssetsFn: async ({ cycleDir, siteDir, plan, shootDirection, client, model, requestImage }) => {
      materializerCalls += 1;
      assert.equal(cycleDir, path.join(runDir, "cycle-01"));
      assert.equal(shootDirection, safeManifest().designNotes.shootDirection);
      assert.equal(client.images.generate instanceof Function, true);
      assert.equal(model, "test-image-model");
      assert.equal(typeof requestImage, "function");
      await mkdir(path.join(siteDir, "assets"), { recursive: true });
      const files = [];
      for (const item of plan) {
        const image = createDeterministicPng(item, { width: 8, height: 6 });
        await writeFile(path.join(siteDir, "assets", item.filename), image, { flag: "wx" });
        files.push({ filename: item.filename, resolved: false, promptHash: "a".repeat(64) });
      }
      const evidence = { schemaVersion: "1.0", allResolved: false, requestCount: 3, successCount: 0, fallbackCount: 3, files };
      await writeFile(path.join(cycleDir, "assets.json"), JSON.stringify(evidence), { flag: "wx" });
      return evidence;
    },
    now: () => new Date("2026-07-17T13:00:00.000Z"),
  });

  assert.equal(result.cycle, 1);
  assert.equal(materializerCalls, 1);
  assert.match(await readFile(path.join(result.siteDir, "index.html"), "utf8"), /Juniper Oven/);
  assert.match(await readFile(path.join(result.siteDir, "styles.css"), "utf8"), /motion-state/);
  assert.match(await readFile(path.join(result.siteDir, "script.js"), "utf8"), /requestAnimationFrame/);
  for (const item of safeManifest().imagePlan) {
    assert.equal((await readFile(path.join(result.siteDir, "assets", item.filename))).subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  }
  const buildRecord = JSON.parse(
    await readFile(path.join(runDir, "cycle-01", "build.json"), "utf8"),
  );
  assert.equal(buildRecord.source, "openai");
  assert.equal(buildRecord.createdAt, "2026-07-17T13:00:00.000Z");
  assert.deepEqual(buildRecord.assetSummary, {
    allResolved: false,
    requestCount: 3,
    successCount: 0,
    fallbackCount: 3,
  });
  assert.deepEqual(buildRecord.imagePlan, safeManifest().imagePlan);
  assert.equal(JSON.stringify(buildRecord).includes("network must not run"), false);
});

test("buildRun keeps a complete deterministic site when every real image request fails", async () => {
  const runDir = path.join(process.cwd(), "tmp", randomUUID(), "runs", "all-fallback");
  await mkdir(runDir, { recursive: true });
  await writeFile(path.join(runDir, "brief.json"), JSON.stringify(brief()), "utf8");
  let requests = 0;

  const result = await buildRun({
    runDir,
    buildSiteFn: async () => ({ ...safeManifest(), source: "openai" }),
    materializeAssetsFn: materializeAssets,
    requestImage: async () => {
      requests += 1;
      throw new Error("provider response must remain private");
    },
    now: () => new Date("2026-07-17T14:00:00.000Z"),
  });

  assert.equal(requests, safeManifest().imagePlan.length);
  for (const filename of ["index.html", "styles.css", "script.js"]) {
    assert.ok((await readFile(path.join(result.siteDir, filename))).length > 0, filename);
  }
  for (const item of safeManifest().imagePlan) {
    const image = await readFile(path.join(result.siteDir, "assets", item.filename));
    assert.equal(validatePngBuffer(image, { expectedWidth: 1536, expectedHeight: 1024 }), image);
  }

  const assets = JSON.parse(await readFile(path.join(result.cycleDir, "assets.json"), "utf8"));
  assert.equal(assets.allResolved, false);
  assert.deepEqual(assets.files.map((file) => file.resolved), [false, false, false]);
  assert.deepEqual(assets.files.map((file) => file.errorCode), ["IMAGE_REQUEST_FAILED", "IMAGE_REQUEST_FAILED", "IMAGE_REQUEST_FAILED"]);
  const buildRecord = JSON.parse(await readFile(path.join(result.cycleDir, "build.json"), "utf8"));
  assert.deepEqual(buildRecord.imagePlan, safeManifest().imagePlan);
  assert.deepEqual(buildRecord.assetSummary, {
    allResolved: false,
    requestCount: 3,
    successCount: 0,
    fallbackCount: 3,
  });
  assert.equal(JSON.stringify(buildRecord).includes("provider response"), false);
  assert.equal(Object.hasOwn(buildRecord, "files"), false);
});
