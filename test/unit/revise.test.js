import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { reviseRun, reviseSite } from "../../src/revise.js";

function manifest(headline = "Bread for the day ahead") {
  return {
    indexHtml: `<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'self'; style-src 'self'; base-uri 'none'; form-action 'none'"><title>Juniper Oven</title><link rel="stylesheet" href="styles.css"></head><body><a href="#main">Skip to content</a><main id="main"><h1>${headline}</h1><section><h2>Fresh from the oven</h2><p>Made with care.</p></section></main></body></html>`,
    stylesCss: "body { margin: 0; color: #252820; background: #f3ebdd; font-family: Georgia, serif; } a:focus-visible { outline: 3px solid currentColor; }",
    designNotes: {
      aesthetic: "High desert bakehouse",
      signatureMove: "A botanical line connects each section",
      rationale: "The visual language feels local and tactile",
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
      return manifest("Bread made easier to love");
    },
  });

  assert.equal(revised.source, "openai-revision");
  assert.match(revised.indexHtml, /Bread made easier to love/);
  assert.equal(request.schemaName, "mainstreet_revision");
  assert.equal(request.userPayload.currentSite.indexHtml, manifest().indexHtml);
  assert.equal(request.userPayload.critique.score, 76);
});

test("reviseSite retries one unsafe replacement before accepting it", async () => {
  let calls = 0;
  const unsafe = manifest();
  unsafe.indexHtml = unsafe.indexHtml.replace("</body>", "<script>alert(1)</script></body>");

  const revised = await reviseSite({
    brief: { business: { name: "Juniper Oven" } },
    currentManifest: manifest(),
    critique: critique(),
    mechanical: { passed: true, failures: [] },
    structuredRequester: async () => {
      calls += 1;
      return calls === 1 ? unsafe : manifest("A safer revision");
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
    writeFile(path.join(firstCycle, "build.json"), JSON.stringify({ designNotes: manifest().designNotes }), "utf8"),
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
  const handoff = JSON.parse(await readFile(path.join(firstCycle, "revise.json"), "utf8"));
  assert.deepEqual(handoff.mustFix, critique().revisionBrief.mustFix);
  assert.equal(handoff.toCycle, 2);
  assert.match(await readFile(path.join(firstCycle, "site", "index.html"), "utf8"), /Bread for the day ahead/);
});

test("reviseRun rejects a fourth cycle", async () => {
  await assert.rejects(
    reviseRun({ runDir: process.cwd(), fromCycle: 3 }),
    /cycle three is terminal/i,
  );
});
