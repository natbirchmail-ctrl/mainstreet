import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { createOwnedMotionRuntime, createOwnedMotionStyles, validateSiteManifest } from "../../src/build.js";
import { reviseRun, reviseSite } from "../../src/revise.js";

const revisePromptUrl = new URL("../../prompts/revise-system.md", import.meta.url);

function manifest(headline = "Bread for the day ahead", { modelOutput = false } = {}) {
  const motionMoves = ["staged hero entrance"];
  const modelStyles = "body { margin: 0; color: #252820; background: #f3ebdd; font-family: Georgia, serif; } a:focus-visible { outline: 3px solid currentColor; }";
  return {
    indexHtml: `<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'"><title>Juniper Oven</title><link rel="stylesheet" href="styles.css"></head><body data-motion-moves="staged-hero-entrance"><a href="#main">Skip to content</a><main id="main"><section data-section="hero" data-motion-root="staged-hero-entrance"><div data-first-beat data-motion-target><h1>${headline}</h1><img src="assets/bread-hero.png" alt="Baker shaping a loaf on a work surface"></div></section><section data-section="offerings"><div data-first-beat><h2>Fresh from the oven</h2><p>Made with care.</p><img src="assets/bread-shelf.png" alt="Fresh loaves on a bakery shelf"></div></section><section data-section="story"><div data-first-beat><h2>The bakery story</h2><img src="assets/flour-detail.png" alt="Flour grain and a ceramic bowl"></div></section></main><script src="script.js" defer></script></body></html>`,
    stylesCss: modelOutput ? modelStyles : `${modelStyles}${createOwnedMotionStyles(motionMoves)}`,
    scriptJs: modelOutput ? "" : createOwnedMotionRuntime(motionMoves),
    imagePlan: [
      {
        filename: "bread-hero.png",
        role: "hero",
        alt: "Baker shaping a loaf on a work surface",
        prompt: "Baker shaping a loaf in warm natural light",
        focalPoint: { x: 0.55, y: 0.45 },
      },
      {
        filename: "bread-shelf.png",
        role: "offerings",
        alt: "Fresh loaves on a bakery shelf",
        prompt: "Fresh loaves arranged on a simple bakery shelf",
        focalPoint: { x: 0.5, y: 0.5 },
      },
      {
        filename: "flour-detail.png",
        role: "story",
        alt: "Flour grain and a ceramic bowl",
        prompt: "Flour grain and a ceramic bowl in the same warm light",
        focalPoint: { x: 0.45, y: 0.55 },
      },
    ],
    designNotes: {
      aesthetic: "High desert bakehouse",
      signatureMove: "A botanical line connects each section",
      rationale: "The visual language feels local and tactile",
      shootDirection: "Warm natural light tactile materials and quiet human craft",
      motionMoves,
    },
  };
}

function critique() {
  return {
    score: 76,
    verdict: "revise",
    summary: "Strong direction with small type and an awkward mobile header.",
    issues: [
      {
        priority: 1,
        severity: "major",
        dimension: "typography",
        evidence: "Body copy is too small.",
        impact: "Important information is hard to read.",
        fix: "Raise body text size and line height.",
      },
    ],
    revisionBrief: {
      mustFix: ["Raise body text size", "Keep the mobile wordmark on one line"],
      preserve: ["Preserve the oven illustration"],
    },
  };
}

test("reviseSite supplies current files and fresh critique to the model", async () => {
  let request;
  const revised = await reviseSite({
    brief: { business: { name: "Juniper Oven" } },
    currentManifest: manifest(),
    critique: critique(),
    mechanical: { passed: true, failures: [] },
    structuredRequester: async (value) => {
      request = value;
      return manifest("Bread made easier to love", { modelOutput: true });
    },
  });

  assert.equal(revised.source, "openai-revision");
  assert.match(revised.indexHtml, /Bread made easier to love/);
  assert.equal(revised.scriptJs, createOwnedMotionRuntime(revised.designNotes.motionMoves));
  validateSiteManifest(revised);
  assert.equal(request.schemaName, "mainstreet_revision");
  assert.equal(request.userPayload.currentSite.indexHtml, manifest().indexHtml);
  assert.equal(request.userPayload.currentSite.stylesCss, manifest(undefined, { modelOutput: true }).stylesCss);
  assert.equal(request.userPayload.currentSite.scriptJs, manifest().scriptJs);
  assert.deepEqual(request.userPayload.currentSite.imagePlan, manifest().imagePlan);
  assert.equal(request.userPayload.critique.score, 76);
});

test("reviseSite retries one unsafe replacement before accepting it", async () => {
  let calls = 0;
  const unsafe = manifest(undefined, { modelOutput: true });
  unsafe.indexHtml = unsafe.indexHtml.replace("</body>", "<script>alert(1)</script></body>");

  const revised = await reviseSite({
    brief: { business: { name: "Juniper Oven" } },
    currentManifest: manifest(),
    critique: critique(),
    mechanical: { passed: true, failures: [] },
    structuredRequester: async () => {
      calls += 1;
      return calls === 1 ? unsafe : manifest("A safer revision", { modelOutput: true });
    },
  });

  assert.equal(calls, 2);
  assert.match(revised.indexHtml, /A safer revision/);
});

test("reviseRun writes a new immutable cycle and a revision handoff", async () => {
  const runDir = path.join(process.cwd(), "tmp", randomUUID(), "run");
  const firstCycle = path.join(runDir, "cycle-01");
  await mkdir(path.join(firstCycle, "site"), { recursive: true });
  await Promise.all([
    writeFile(path.join(runDir, "brief.json"), JSON.stringify({ business: { name: "Juniper Oven" } }), "utf8"),
    writeFile(path.join(firstCycle, "site", "index.html"), manifest().indexHtml, "utf8"),
    writeFile(path.join(firstCycle, "site", "styles.css"), manifest().stylesCss, "utf8"),
    writeFile(path.join(firstCycle, "site", "script.js"), manifest().scriptJs, "utf8"),
    writeFile(path.join(firstCycle, "build.json"), JSON.stringify({ designNotes: manifest().designNotes, imagePlan: manifest().imagePlan }), "utf8"),
    writeFile(path.join(firstCycle, "critique.json"), JSON.stringify(critique()), "utf8"),
    writeFile(path.join(firstCycle, "mechanical.json"), JSON.stringify({ passed: true, failures: [] }), "utf8"),
  ]);

  const result = await reviseRun({
    runDir,
    fromCycle: 1,
    reviseSiteFn: async () => ({ ...manifest("A clearer second cycle"), source: "openai-revision" }),
    now: () => new Date("2026-07-17T15:00:00.000Z"),
  });

  assert.equal(result.toCycle, 2);
  assert.match(
    await readFile(path.join(runDir, "cycle-02", "site", "index.html"), "utf8"),
    /A clearer second cycle/,
  );
  assert.equal(
    await readFile(path.join(runDir, "cycle-02", "site", "script.js"), "utf8"),
    manifest().scriptJs,
  );
  const handoff = JSON.parse(await readFile(path.join(firstCycle, "revise.json"), "utf8"));
  assert.deepEqual(handoff.mustFix, critique().revisionBrief.mustFix);
  assert.ok(handoff.mustKeep.includes("Owned script and planned local PNG assets only"));
  assert.equal(handoff.toCycle, 2);
  assert.match(await readFile(path.join(firstCycle, "site", "index.html"), "utf8"), /Bread for the day ahead/);
});

test("revision prompt requests the expanded model sentinel contract", async () => {
  const prompt = await readFile(revisePromptUrl, "utf8");
  for (const field of ["indexHtml", "stylesCss", "scriptJs", "imagePlan", "designNotes"]) {
    assert.match(prompt, new RegExp(`\\b${field}\\b`));
  }
  assert.match(prompt, /empty `scriptJs` sentinel/i);
  assert.match(prompt, /appends the exact owned motion CSS/i);
  assert.match(prompt, /planned local PNG/i);
  assert.match(prompt, /data-motion-moves/i);
  for (const [move, slug] of [
    ["pinned chapter passage", "pinned-chapter-passage"],
    ["horizontal click reel", "horizontal-click-reel"],
    ["numbered story stepper", "numbered-story-stepper"],
    ["staged hero entrance", "staged-hero-entrance"],
    ["gentle one direction scroll reveals", "gentle-scroll-reveals"],
  ]) {
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

test("reviseRun rejects a fourth cycle", async () => {
  await assert.rejects(
    reviseRun({ runDir: process.cwd(), fromCycle: 3 }),
    /cycle three is terminal/i,
  );
});
