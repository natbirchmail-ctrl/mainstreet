import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import {
  captureCycle,
  critiqueCycle,
  normalizeCritique,
  runCriticCycle,
} from "../../src/critic.js";

function rawCritique(overrides = {}) {
  return {
    rubricVersion: "1.0",
    score: 99,
    verdict: "ship",
    summary: "The page is distinctive but needs one more mobile pass.",
    dimensions: {
      layout: { score: 14, evidence: "Clear section rhythm", fix: "Tighten the long middle gap" },
      hierarchy: { score: 12, evidence: "Strong hero scale", fix: "Clarify the final action" },
      color: { score: 9, evidence: "Coherent earth palette", fix: "Increase muted text contrast" },
      typography: { score: 12, evidence: "Editorial pairing", fix: "Open small labels" },
      mobile: { score: 11, evidence: "Single column holds", fix: "Give the header more room" },
      specificity: { score: 8, evidence: "Bakery details feel grounded", fix: "Remove one generic phrase" },
      accessibility: { score: 8, evidence: "Visible focus and landmarks", fix: "Increase small text size" },
      polish: { score: 3, evidence: "Consistent rules", fix: "Resolve two tight alignments" },
    },
    strengths: ["A memorable illustrated hero", "Honest treatment of missing facts"],
    issues: [
      {
        priority: 1,
        severity: "major",
        dimension: "mobile",
        evidence: "The wordmark wraps into two cramped lines on the narrow view.",
        impact: "The first brand impression looks accidental.",
        fix: "Keep the wordmark on one line and reduce the navigation label spacing.",
      },
    ],
    revisionBrief: {
      mustFix: ["Keep the mobile wordmark on one line"],
      preserve: ["Preserve the oven illustration and earth palette"],
    },
    ...overrides,
  };
}

test("normalizeCritique computes the weighted score and prevents a false ship verdict", () => {
  const critique = normalizeCritique(rawCritique());
  assert.equal(critique.score, 77);
  assert.equal(critique.verdict, "revise");
});

test("normalizeCritique allows ship only at the threshold with no major finding", () => {
  const candidate = rawCritique({
    issues: [],
    dimensions: {
      layout: { score: 17, evidence: "Strong", fix: "None" },
      hierarchy: { score: 14, evidence: "Strong", fix: "None" },
      color: { score: 11, evidence: "Strong", fix: "None" },
      typography: { score: 14, evidence: "Strong", fix: "None" },
      mobile: { score: 14, evidence: "Strong", fix: "None" },
      specificity: { score: 9, evidence: "Strong", fix: "None" },
      accessibility: { score: 9, evidence: "Strong", fix: "None" },
      polish: { score: 4, evidence: "Strong", fix: "None" },
    },
  });
  const critique = normalizeCritique(candidate);
  assert.equal(critique.score, 92);
  assert.equal(critique.verdict, "ship");
});

test("critiqueCycle sends only the fresh evidence packet with two images", async () => {
  const cycleDir = path.join(process.cwd(), "tmp", randomUUID(), "cycle-01");
  const screenshotsDir = path.join(cycleDir, "screenshots");
  await mkdir(screenshotsDir, { recursive: true });
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
  await Promise.all([
    writeFile(path.join(screenshotsDir, "desktop-home.png"), png),
    writeFile(path.join(screenshotsDir, "mobile-home.png"), png),
    writeFile(path.join(cycleDir, "visible-text.txt"), "Fresh from the oven", "utf8"),
  ]);

  let request;
  const result = await critiqueCycle({
    brief: { business: { name: "Juniper Oven", category: "Bakery" } },
    cycleDir,
    structuredRequester: async (value) => {
      request = value;
      return rawCritique();
    },
  });

  assert.equal(result.score, 77);
  assert.equal(request.schemaName, "mainstreet_critique");
  assert.deepEqual(request.inputContent.map((item) => item.type), [
    "input_text",
    "input_image",
    "input_image",
  ]);
  assert.equal(request.inputContent[1].detail, "high");
  assert.match(request.inputContent[1].image_url, /^data:image\/png;base64,/);
  const packet = JSON.parse(request.inputContent[0].text);
  assert.equal(packet.visibleText, "Fresh from the oven");
  assert.equal(packet.brief.business.name, "Juniper Oven");
  assert.equal("priorCritique" in packet, false);
  assert.equal("sourceCode" in packet, false);
});

test("captureCycle creates deterministic desktop and mobile evidence", async () => {
  const root = path.join(process.cwd(), "tmp", randomUUID());
  const siteDir = path.join(root, "site");
  const cycleDir = path.join(root, "cycle-01");
  await mkdir(siteDir, { recursive: true });
  await writeFile(
    path.join(siteDir, "index.html"),
    `<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>Proof</title><link rel="stylesheet" href="styles.css"></head><body><main><h1>Proof page</h1><a href="#details">Read details</a><section id="details"><h2>Details</h2><p>Visible evidence.</p></section></main></body></html>`,
    "utf8",
  );
  await writeFile(
    path.join(siteDir, "styles.css"),
    "body { margin: 0; font-family: Georgia, serif; } main { padding: 2rem; } a { display: inline-block; padding: 1rem; }",
    "utf8",
  );

  const evidence = await captureCycle({ siteDir, cycleDir, port: 4600 });
  assert.equal(evidence.mechanical.metrics.desktop.viewportWidth, 1440);
  assert.equal(evidence.mechanical.metrics.mobile.viewportWidth, 390);
  assert.equal(evidence.mechanical.metrics.desktop.horizontalOverflow, false);
  assert.equal(evidence.mechanical.metrics.mobile.horizontalOverflow, false);
  assert.equal(evidence.mechanical.passed, true);
  assert.match(await readFile(path.join(cycleDir, "visible-text.txt"), "utf8"), /Proof page/);
  assert.deepEqual(
    [...(await readFile(path.join(cycleDir, "screenshots", "desktop-home.png"))).subarray(0, 8)],
    [137, 80, 78, 71, 13, 10, 26, 10],
  );
});

test("runCriticCycle preserves a scored vision verdict in the cycle", async () => {
  const runDir = path.join(process.cwd(), "tmp", randomUUID(), "run");
  const cycleDir = path.join(runDir, "cycle-01");
  await mkdir(path.join(cycleDir, "site"), { recursive: true });
  await writeFile(path.join(runDir, "brief.json"), JSON.stringify({ business: { name: "Juniper Oven" } }), "utf8");

  const result = await runCriticCycle({
    runDir,
    cycle: 1,
    captureCycleFn: async () => ({ mechanical: { passed: true, failures: [] } }),
    critiqueCycleFn: async () => normalizeCritique(rawCritique()),
    now: () => new Date("2026-07-17T14:00:00.000Z"),
  });

  assert.equal(result.mode, "vision");
  assert.equal(result.score, 77);
  const saved = JSON.parse(await readFile(path.join(cycleDir, "critique.json"), "utf8"));
  assert.equal(saved.createdAt, "2026-07-17T14:00:00.000Z");
  assert.equal(saved.mechanicalPassed, true);
});

test("runCriticCycle uses source review when screenshot capture fails", async () => {
  const runDir = path.join(process.cwd(), "tmp", randomUUID(), "run");
  const cycleDir = path.join(runDir, "cycle-01");
  await mkdir(path.join(cycleDir, "site"), { recursive: true });
  await writeFile(path.join(runDir, "brief.json"), JSON.stringify({ business: { name: "Juniper Oven" } }), "utf8");
  await writeFile(path.join(cycleDir, "site", "index.html"), "<!doctype html><main><h1>Proof</h1></main>", "utf8");
  await writeFile(path.join(cycleDir, "site", "styles.css"), "body { color: #111111; }", "utf8");

  const result = await runCriticCycle({
    runDir,
    cycle: 1,
    captureCycleFn: async () => {
      throw new Error("browser unavailable at C:\\private\\path");
    },
    critiqueSourceFn: async () => normalizeCritique(rawCritique()),
  });

  assert.equal(result.mode, "source-fallback");
  const failure = JSON.parse(await readFile(path.join(cycleDir, "capture-error.json"), "utf8"));
  assert.equal(failure.message, "Playwright capture failed. Source review was used.");
  assert.doesNotMatch(JSON.stringify(failure), /private/i);
});
