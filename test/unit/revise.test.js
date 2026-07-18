import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { createDeterministicPng, materializeAssets } from "../../src/assets.js";
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

function assetSha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function writeFirstCycle(runDir, { assetEvidence, siteManifest = manifest() } = {}) {
  const firstCycle = path.join(runDir, "cycle-01");
  const siteDir = path.join(firstCycle, "site");
  await mkdir(siteDir, { recursive: true });
  await Promise.all([
    writeFile(path.join(runDir, "brief.json"), JSON.stringify({ business: { name: "Juniper Oven" } }), "utf8"),
    writeFile(path.join(siteDir, "index.html"), siteManifest.indexHtml, "utf8"),
    writeFile(path.join(siteDir, "styles.css"), siteManifest.stylesCss, "utf8"),
    writeFile(path.join(siteDir, "script.js"), siteManifest.scriptJs, "utf8"),
    writeFile(path.join(firstCycle, "build.json"), JSON.stringify({ designNotes: siteManifest.designNotes, imagePlan: siteManifest.imagePlan }), "utf8"),
    writeFile(path.join(firstCycle, "critique.json"), JSON.stringify(critique()), "utf8"),
    writeFile(path.join(firstCycle, "mechanical.json"), JSON.stringify({ passed: true, failures: [] }), "utf8"),
  ]);
  if (assetEvidence) {
    await writeFile(path.join(firstCycle, "assets.json"), JSON.stringify(assetEvidence), "utf8");
  }
  return { firstCycle, siteDir };
}

async function makeResolvedFirstCycle(runDir, siteManifest = manifest()) {
  const { firstCycle, siteDir } = await writeFirstCycle(runDir, { siteManifest });
  const assets = await materializeAssets({
    cycleDir: firstCycle,
    siteDir,
    plan: siteManifest.imagePlan,
    shootDirection: siteManifest.designNotes.shootDirection,
    requestImage: async ({ prompt }) => createDeterministicPng({ ...siteManifest.imagePlan.find((item) => prompt.endsWith(item.prompt)), prompt }),
  });
  return { firstCycle, siteDir, assets };
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

test("reviseSite exposes only sanitized available asset descriptors while retaining the authored image plan", async () => {
  let request;
  const currentManifest = manifest();
  await reviseSite({
    brief: { business: { name: "Juniper Oven" } },
    currentManifest,
    critique: critique(),
    mechanical: { passed: true, failures: [] },
    availableAssets: {
      files: currentManifest.imagePlan.map((item, index) => ({
        ...item,
        path: `C:\\private\\${item.filename}`,
        promptHash: "a".repeat(64),
        mediaType: "image/png",
        bytes: index + 100,
        sha256: "b".repeat(64),
        source: "openai",
        resolved: true,
        errorCode: null,
        providerResponse: "do not expose",
      })),
    },
    structuredRequester: async (value) => {
      request = value;
      return manifest("Bread made easier to love", { modelOutput: true });
    },
  });

  assert.deepEqual(request.userPayload.currentSite.imagePlan, currentManifest.imagePlan);
  assert.deepEqual(request.userPayload.currentSite.availableAssets, currentManifest.imagePlan.map((item, index) => ({
    filename: item.filename,
    path: `assets/${item.filename}`,
    role: item.role,
    alt: item.alt,
    focalPoint: item.focalPoint,
    mediaType: "image/png",
    bytes: index + 100,
    sha256: "b".repeat(64),
    source: "openai",
    resolved: true,
    errorCode: null,
  })));
  assert.equal(JSON.stringify(request.userPayload.currentSite.availableAssets).includes("prompt"), false);
  assert.equal(JSON.stringify(request.userPayload.currentSite.availableAssets).includes("providerResponse"), false);
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
  const { firstCycle } = await makeResolvedFirstCycle(runDir);

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
  assert.ok(handoff.mustKeep.includes("Owned local assets and owned motion with visible source without JavaScript"));
  assert.equal(handoff.toCycle, 2);
  assert.match(await readFile(path.join(firstCycle, "site", "index.html"), "utf8"), /Bread for the day ahead/);
});

test("reviseRun carries verified unchanged assets byte for byte without requesting replacements", async () => {
  const runDir = path.join(process.cwd(), "tmp", randomUUID(), "run");
  const { siteDir: priorSiteDir } = await makeResolvedFirstCycle(runDir);
  const priorBytes = await Promise.all(manifest().imagePlan.map((item) => readFile(path.join(priorSiteDir, "assets", item.filename))));
  let requests = 0;

  const result = await reviseRun({
    runDir,
    fromCycle: 1,
    reviseSiteFn: async () => ({ ...manifest("A clearer second cycle"), source: "openai-revision" }),
    requestImage: async () => { requests += 1; throw new Error("must not request"); },
  });

  assert.equal(requests, 0);
  for (const [index, item] of manifest().imagePlan.entries()) {
    const nextBytes = await readFile(path.join(result.siteDir, "assets", item.filename));
    assert.deepEqual(nextBytes, priorBytes[index]);
    assert.equal(assetSha256(await readFile(path.join(priorSiteDir, "assets", item.filename))), assetSha256(priorBytes[index]));
  }
  assert.deepEqual(JSON.parse(await readFile(path.join(runDir, "cycle-02", "assets.json"), "utf8")).files.map((file) => file.source), ["carried-forward", "carried-forward", "carried-forward"]);
});

test("reviseRun requests only intentionally changed image plan items and retries unresolved ones", async () => {
  const runDir = path.join(process.cwd(), "tmp", randomUUID(), "run");
  const { firstCycle, assets } = await makeResolvedFirstCycle(runDir);
  const revised = manifest("A clearer second cycle");
  revised.imagePlan[1] = { ...revised.imagePlan[1], prompt: "Fresh loaves in a revised market display" };
  assets.files[2] = { ...assets.files[2], resolved: false, source: "deterministic-fallback", errorCode: "IMAGE_REQUEST_FAILED" };
  assets.allResolved = false;
  assets.successCount -= 1;
  assets.fallbackCount += 1;
  await writeFile(path.join(firstCycle, "assets.json"), JSON.stringify(assets), "utf8");
  let requests = 0;

  const result = await reviseRun({
    runDir,
    fromCycle: 1,
    reviseSiteFn: async () => ({ ...revised, source: "openai-revision" }),
    imageRequesterFn: async ({ prompt }) => {
      requests += 1;
      return createDeterministicPng({ ...revised.imagePlan.find((item) => prompt.endsWith(item.prompt)), prompt });
    },
  });

  assert.equal(requests, 2);
  const nextAssets = JSON.parse(await readFile(path.join(result.toCycleDir, "assets.json"), "utf8"));
  assert.equal(nextAssets.files[0].source, "carried-forward");
  assert.equal(nextAssets.files[1].source, "openai");
  assert.equal(nextAssets.files[2].source, "openai");
});

test("reviseRun regenerates assets when shoot direction changes", async () => {
  const runDir = path.join(process.cwd(), "tmp", randomUUID(), "run");
  await makeResolvedFirstCycle(runDir);
  const revised = manifest("A clearer second cycle");
  revised.designNotes = { ...revised.designNotes, shootDirection: "Cool editorial light and precise overhead composition" };
  let requests = 0;

  await reviseRun({
    runDir,
    fromCycle: 1,
    reviseSiteFn: async () => ({ ...revised, source: "openai-revision" }),
    imageRequesterFn: async ({ prompt }) => {
      requests += 1;
      return createDeterministicPng({ ...revised.imagePlan.find((item) => prompt.endsWith(item.prompt)), prompt });
    },
  });

  assert.equal(requests, 3);
});

test("reviseRun fails closed for missing or mismatched prior asset evidence", async () => {
  const missingRunDir = path.join(process.cwd(), "tmp", randomUUID(), "run");
  await writeFirstCycle(missingRunDir);
  await assert.rejects(
    reviseRun({ runDir: missingRunDir, fromCycle: 1, reviseSiteFn: async () => ({ ...manifest(), source: "openai-revision" }) }),
    /prior asset evidence.*assets\.json/i,
  );

  const mismatchRunDir = path.join(process.cwd(), "tmp", randomUUID(), "run");
  const { siteDir } = await makeResolvedFirstCycle(mismatchRunDir);
  await writeFile(path.join(siteDir, "assets", manifest().imagePlan[0].filename), Buffer.from("changed"));
  await assert.rejects(
    reviseRun({ runDir: mismatchRunDir, fromCycle: 1, reviseSiteFn: async () => ({ ...manifest(), source: "openai-revision" }), requestImage: async () => { throw new Error("must not request"); } }),
    /prior asset digest/i,
  );
  await assert.rejects(readFile(path.join(mismatchRunDir, "cycle-02", "assets.json")));
});

test("reviseRun records sanitized next cycle asset evidence and preserves the prior cycle", async () => {
  const runDir = path.join(process.cwd(), "tmp", randomUUID(), "run");
  const { firstCycle, siteDir } = await makeResolvedFirstCycle(runDir);
  const priorSource = await Promise.all(["index.html", "styles.css", "script.js"].map((filename) => readFile(path.join(siteDir, filename), "utf8")));
  const priorAssets = await Promise.all(manifest().imagePlan.map((item) => readFile(path.join(siteDir, "assets", item.filename))));

  const result = await reviseRun({
    runDir,
    fromCycle: 1,
    reviseSiteFn: async () => ({ ...manifest("A clearer second cycle"), source: "openai-revision" }),
    requestImage: async () => { throw new Error("must not request"); },
  });

  const buildRecord = JSON.parse(await readFile(path.join(result.toCycleDir, "build.json"), "utf8"));
  assert.deepEqual(buildRecord.imagePlan, manifest().imagePlan);
  assert.deepEqual(buildRecord.designNotes, manifest().designNotes);
  assert.deepEqual(buildRecord.assetSummary, { allResolved: true, requestCount: 0, successCount: 0, fallbackCount: 0 });
  assert.equal(JSON.stringify(buildRecord).includes("must not request"), false);
  assert.deepEqual(
    await Promise.all(["index.html", "styles.css", "script.js"].map((filename) => readFile(path.join(firstCycle, "site", filename), "utf8"))),
    priorSource,
  );
  assert.deepEqual(
    await Promise.all(manifest().imagePlan.map((item) => readFile(path.join(firstCycle, "site", "assets", item.filename))),),
    priorAssets,
  );
});

test("revision prompt requests the expanded model sentinel contract", async () => {
  const prompt = await readFile(revisePromptUrl, "utf8");
  for (const field of ["indexHtml", "stylesCss", "scriptJs", "imagePlan", "designNotes"]) {
    assert.match(prompt, new RegExp(`\\b${field}\\b`));
  }
  assert.match(prompt, /empty `scriptJs` sentinel/i);
  assert.match(prompt, /appends the exact owned motion CSS/i);
  assert.match(prompt, /planned local PNG/i);
  assert.match(prompt, /preserve existing image plan and assets/i);
  assert.match(prompt, /reuse filenames and prompts for unchanged assets/i);
  assert.match(prompt, /new filename or changed prompt only for an intentional replacement/i);
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
