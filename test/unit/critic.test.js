import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import {
  captureCycle,
  critiqueCycle,
  runCriticCycle,
} from "../../src/critic.js";
import { captureRenderedEvidence } from "../../src/critic-evidence.js";
import {
  QUALITY_LAWS,
  VISUAL_LAWS,
  normalizeModelCritique,
} from "../../src/critic-policy.js";

const COMPLETE_VIEWPORTS = ["desktop", "tablet", "phone"];

function rawCritique({ issues = [], laws = {} } = {}) {
  return {
    rubricVersion: "1.0",
    summary: "The page is distinctive but needs one more mobile pass.",
    dimensions: {
      layout: dimension(17),
      hierarchy: dimension(14),
      color: dimension(11),
      typography: dimension(14),
      mobile: dimension(14),
      specificity: dimension(9),
      accessibility: dimension(9),
      polish: dimension(4),
    },
    strengths: ["A memorable illustrated hero", "Honest treatment of missing facts"],
    issues,
    laws: Object.fromEntries(
      QUALITY_LAWS.map((name) => [name, laws[name] || law("pass")]),
    ),
    revisionBrief: {
      mustFix: [],
      preserve: ["Preserve the oven illustration and earth palette"],
    },
  };
}

test("captureCycle delegates to the rendered evidence implementation", () => {
  assert.equal(captureCycle, captureRenderedEvidence);
});

test("critiqueCycle sends text desktop tablet and phone in exact order", async () => {
  const cycleDir = path.join(process.cwd(), "tmp", randomUUID(), "cycle-01");
  const screenshotsDir = path.join(cycleDir, "screenshots");
  await mkdir(screenshotsDir, { recursive: true });
  const screenshots = {
    desktop: Buffer.from("desktop"),
    tablet: Buffer.from("tablet"),
    phone: Buffer.from("phone"),
  };
  await Promise.all([
    writeFile(path.join(screenshotsDir, "desktop-home.png"), screenshots.desktop),
    writeFile(path.join(screenshotsDir, "tablet-home.png"), screenshots.tablet),
    writeFile(path.join(screenshotsDir, "mobile-home.png"), screenshots.phone),
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

  assert.equal(result.score, 92);
  assert.equal(request.schemaName, "mainstreet_critique");
  assert.deepEqual(request.inputContent.map((item) => item.type), [
    "input_text",
    "input_image",
    "input_image",
    "input_image",
  ]);
  assert.deepEqual(
    request.inputContent.slice(1).map((item) =>
      Buffer.from(item.image_url.split(",")[1], "base64").toString("utf8"),
    ),
    ["desktop", "tablet", "phone"],
  );
  assert.deepEqual(
    request.inputContent.slice(1).map((item) => item.detail),
    ["high", "high", "high"],
  );
  const packet = JSON.parse(request.inputContent[0].text);
  assert.equal(packet.visibleText, "Fresh from the oven");
  assert.equal(packet.brief.business.name, "Juniper Oven");
  assert.deepEqual(Object.keys(packet.viewports), ["desktop", "tablet", "phone"]);
  assert.equal("priorCritique" in packet, false);
  assert.equal("sourceCode" in packet, false);
});

test("runCriticCycle derives an uncapped vision outcome from explicit gates", async () => {
  const runDir = path.join(process.cwd(), "tmp", randomUUID(), "run");
  const cycleDir = path.join(runDir, "cycle-01");
  await mkdir(path.join(cycleDir, "site"), { recursive: true });
  await writeFile(path.join(runDir, "brief.json"), JSON.stringify({ business: { name: "Juniper Oven" } }), "utf8");

  const result = await runCriticCycle({
    runDir,
    cycle: 1,
    captureCycleFn: async () => ({
      mechanical: { passed: true, assetsResolved: false, failures: [] },
      assetsResolved: true,
    }),
    critiqueCycleFn: async () => normalizeModelCritique(rawCritique()),
    now: () => new Date("2026-07-17T14:00:00.000Z"),
  });

  assert.equal(result.mode, "vision");
  assert.equal(result.score, 92);
  assert.equal(result.assetsResolved, true);
  assert.equal(result.shipEligible, true);
  assert.equal(result.verdict, "ship");
  assert.equal("visionScore" in result, false);
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
      throw Object.assign(new Error("browser unavailable at C:\\example\\site"), {
        code: "CAPTURE_UNAVAILABLE",
      });
    },
    critiqueSourceFn: async () => normalizeModelCritique(rawCritique()),
  });

  assert.equal(result.mode, "source-fallback");
  assert.equal(result.score, 92);
  assert.equal(result.mechanicalPassed, null);
  assert.equal(result.assetsResolved, null);
  assert.equal(result.shipEligible, false);
  assert.equal(result.verdict, "revise");
  for (const name of VISUAL_LAWS) {
    assert.equal(result.laws[name].status, "unverified");
  }
  const failure = JSON.parse(await readFile(path.join(cycleDir, "capture-error.json"), "utf8"));
  assert.equal(failure.message, "Playwright capture failed. Source review was used.");
  assert.doesNotMatch(JSON.stringify(failure), /private/i);
});

test("runCriticCycle propagates integrity filesystem and programming faults", async (t) => {
  for (const [name, captureError] of [
    ["integrity", Object.assign(new Error("Completed evidence packet is invalid."), { code: "EVIDENCE_PACKET_INVALID" })],
    ["filesystem", Object.assign(new Error("Evidence file already exists."), { code: "EEXIST" })],
    ["programming", new TypeError("Cannot read properties of undefined")],
  ]) {
    await t.test(name, async () => {
      const runDir = path.join(process.cwd(), "tmp", randomUUID(), "run");
      const cycleDir = path.join(runDir, "cycle-01");
      await mkdir(path.join(cycleDir, "site"), { recursive: true });
      await writeFile(
        path.join(runDir, "brief.json"),
        JSON.stringify({ business: { name: "Juniper Oven" } }),
        "utf8",
      );
      let sourceCalls = 0;

      await assert.rejects(
        runCriticCycle({
          runDir,
          cycle: 1,
          captureCycleFn: async () => {
            throw captureError;
          },
          critiqueSourceFn: async () => {
            sourceCalls += 1;
            return normalizeModelCritique(rawCritique());
          },
        }),
        (error) => error === captureError,
      );
      assert.equal(sourceCalls, 0);
      await assert.rejects(
        readFile(path.join(cycleDir, "capture-error.json"), "utf8"),
        (error) => error?.code === "ENOENT",
      );
    });
  }
});

test("a later vision failure propagates without poisoning reusable capture state", async () => {
  const runDir = path.join(process.cwd(), "tmp", randomUUID(), "run");
  const cycleDir = path.join(runDir, "cycle-01");
  await mkdir(path.join(cycleDir, "site"), { recursive: true });
  await writeFile(
    path.join(runDir, "brief.json"),
    JSON.stringify({ business: { name: "Juniper Oven" } }),
    "utf8",
  );
  const visionError = new Error("vision request failed");
  let sourceCalls = 0;

  await assert.rejects(
    runCriticCycle({
      runDir,
      cycle: 1,
      captureCycleFn: async () => ({
        mechanical: { passed: true, failures: [] },
        assetsResolved: true,
      }),
      critiqueCycleFn: async () => {
        throw visionError;
      },
      critiqueSourceFn: async () => {
        sourceCalls += 1;
        return normalizeModelCritique(rawCritique());
      },
    }),
    (error) => error === visionError,
  );
  assert.equal(sourceCalls, 0);
  await assert.rejects(
    readFile(path.join(cycleDir, "capture-error.json"), "utf8"),
    (error) => error?.code === "ENOENT",
  );
});

function dimension(score) {
  return {
    score,
    evidence: "The rendered evidence supports this score.",
    fix: "Preserve the working choice and refine only if a gate requires it.",
  };
}

function law(status) {
  return {
    status,
    evidence: COMPLETE_VIEWPORTS.map((viewport) => ({
      viewport,
      observation: `${viewport} provides concrete evidence for this law.`,
    })),
    fix: "Make the smallest concrete revision needed to satisfy this law.",
  };
}
