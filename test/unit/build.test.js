import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import {
  buildSite,
  buildRun,
  validateSiteManifest,
  writeSiteFiles,
} from "../../src/build.js";

function safeManifest() {
  return {
    indexHtml: `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="default-src 'self'; style-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'">
  <title>Juniper Oven</title>
  <link rel="stylesheet" href="styles.css">
</head>
<body>
  <a class="skip-link" href="#main">Skip to content</a>
  <header><nav aria-label="Primary"><a href="#offerings">Offerings</a></nav></header>
  <main id="main"><h1>Bread for the day ahead</h1><section id="offerings"><h2>From the oven</h2><p>Fresh loaves made with care.</p></section></main>
  <footer><p>Juniper Oven</p></footer>
</body>
</html>`,
    stylesCss: `:root { color-scheme: light; --ink: #252820; --paper: #f3ebdd; }
* { box-sizing: border-box; }
body { margin: 0; color: var(--ink); background: var(--paper); font-family: Georgia, serif; }
a:focus-visible { outline: 3px solid currentColor; outline-offset: 4px; }
@media (prefers-reduced-motion: reduce) { *, *::before, *::after { scroll-behavior: auto !important; } }`,
    designNotes: {
      aesthetic: "High desert bakehouse",
      signatureMove: "A botanical line connects each section",
      rationale: "The visual language feels local and tactile",
    },
  };
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
  const unsafe = safeManifest();
  unsafe.indexHtml = unsafe.indexHtml.replace("</body>", "<script>alert(1)</script></body>");

  const result = await buildSite({
    brief: brief(),
    structuredRequester: async () => {
      calls += 1;
      return calls === 1 ? unsafe : safeManifest();
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
  assert.doesNotMatch(result.indexHtml, /<script/i);
  validateSiteManifest(result);
});

test("writeSiteFiles writes the fixed public file set without overwrite", async () => {
  const siteDir = path.join(process.cwd(), "tmp", randomUUID(), "site");
  await writeSiteFiles(siteDir, safeManifest());

  assert.match(await readFile(path.join(siteDir, "index.html"), "utf8"), /<!doctype html>/i);
  assert.match(await readFile(path.join(siteDir, "styles.css"), "utf8"), /color-scheme/);
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
