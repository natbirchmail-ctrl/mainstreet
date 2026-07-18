import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import {
  executePipeline,
  finalizeExistingRun,
  selectBestCycle,
} from "../../src/pipeline.js";

test("selectBestCycle prefers the highest scoring fully eligible cycle", () => {
  assert.equal(
    selectBestCycle([
      { cycle: 1, score: 95, mechanicalPassed: true, shipEligible: false },
      { cycle: 2, score: 82, mechanicalPassed: true, shipEligible: true },
      { cycle: 3, score: 84, mechanicalPassed: false, shipEligible: false },
    ]).cycle,
    2,
  );
});

test("selectBestCycle falls back to exact mechanical passes and treats null as unsafe", () => {
  assert.equal(
    selectBestCycle([
      { cycle: 1, score: 99, mechanicalPassed: null, shipEligible: false },
      { cycle: 2, score: 81, mechanicalPassed: true, shipEligible: false },
      { cycle: 3, score: 84, mechanicalPassed: true, shipEligible: false },
    ]).cycle,
    3,
  );
});

test("selectBestCycle uses the highest numeric score when no cycle is mechanically safe", () => {
  assert.equal(
    selectBestCycle([
      { cycle: 1, score: 91, mechanicalPassed: false, shipEligible: false },
      { cycle: 2, score: 93, mechanicalPassed: null, shipEligible: false },
      { cycle: 3, score: null, mechanicalPassed: null, shipEligible: false },
    ]).cycle,
    2,
  );
});

test("selectBestCycle resolves score ties deterministically in favor of the later cycle", () => {
  assert.equal(
    selectBestCycle([
      { cycle: 1, score: 82, mechanicalPassed: true, shipEligible: false },
      { cycle: 2, score: 82, mechanicalPassed: true, shipEligible: false },
    ]).cycle,
    2,
  );
});

test("run report measures improvement using the selected best cycle", async () => {
  const root = path.join(process.cwd(), "tmp", randomUUID());
  const scores = [70, 90, 65];
  const result = await executePipeline({
    businessName: "Best Cycle Proof",
    fast: true,
    maxCycles: 3,
    runsRoot: path.join(root, "runs"),
    trashRoot: path.join(root, "trash"),
    createBriefFn: async () => ({ business: { name: "Best Cycle Proof" } }),
    buildRunFn: async ({ runDir }) => {
      await mkdir(path.join(runDir, "cycle-01", "site"), { recursive: true });
    },
    criticFn: async ({ cycle }) => critiqueArtifact({
      cycle,
      score: scores[cycle - 1],
      verdict: "revise",
    }),
    reviseRunFn: async ({ runDir, fromCycle }) => {
      await mkdir(
        path.join(runDir, `cycle-${String(fromCycle + 1).padStart(2, "0")}`, "site"),
        { recursive: true },
      );
    },
  });

  assert.equal(result.report.selectedCycle, 2);
  assert.equal(result.report.scoresImproved, true);
});

test("executePipeline runs bounded revisions and stops at the ship threshold", async () => {
  const root = path.join(process.cwd(), "tmp", randomUUID());
  const scores = [64, 81, 88];
  const revisions = [];
  const events = [];

  const result = await executePipeline({
    businessName: "Juniper Oven",
    city: "Flagstaff, AZ",
    fast: true,
    maxCycles: 3,
    runsRoot: path.join(root, "runs"),
    trashRoot: path.join(root, "trash"),
    createBriefFn: async () => ({ business: { name: "Juniper Oven" } }),
    buildRunFn: async ({ runDir }) => {
      await mkdir(path.join(runDir, "cycle-01", "site"), { recursive: true });
    },
    criticFn: async ({ cycle }) => critiqueArtifact({
      cycle,
      score: scores[cycle - 1],
      verdict: scores[cycle - 1] >= 85 ? "ship" : "revise",
      shipEligible: scores[cycle - 1] >= 85,
    }),
    reviseRunFn: async ({ runDir, fromCycle }) => {
      revisions.push(fromCycle);
      await mkdir(
        path.join(runDir, `cycle-${String(fromCycle + 1).padStart(2, "0")}`, "site"),
        { recursive: true },
      );
    },
    onProgress: (event) => events.push(event.type),
    now: sequenceClock(),
  });

  assert.deepEqual(revisions, [1, 2]);
  assert.equal(result.report.stopReason, "threshold_reached");
  assert.equal(result.report.selectedCycle, 3);
  assert.deepEqual(result.report.cycles.map((cycle) => cycle.score), scores);
  assert.equal(result.report.cycles[2].assetsResolved, true);
  assert.equal(result.report.cycles[2].lawGatePassed, true);
  assert.equal(result.report.cycles[2].shipEligible, true);
  assert.deepEqual(result.report.cycles[2].hardGateFailures, []);
  assert.deepEqual(result.report.cycles[2].laws, { headlineDiscipline: { status: "pass" } });
  assert.deepEqual(result.report.cycles[2].lawCoverage, {
    headlineDiscipline: { complete: true },
  });
  assert.deepEqual(events, [
    "run_started",
    "intake_complete",
    "build_complete",
    "critique_complete",
    "revision_complete",
    "critique_complete",
    "revision_complete",
    "critique_complete",
    "run_complete",
  ]);
  assert.match(await readFile(path.join(result.runDir, "RUN-REPORT.md"), "utf8"), /64.*81.*88/s);
});

test("executePipeline stops after one cycle when the initial site ships", async () => {
  const root = path.join(process.cwd(), "tmp", randomUUID());
  let revised = false;
  const result = await executePipeline({
    businessName: "Good Site",
    fast: true,
    runsRoot: path.join(root, "runs"),
    trashRoot: path.join(root, "trash"),
    createBriefFn: async () => ({ business: { name: "Good Site" } }),
    buildRunFn: async ({ runDir }) => {
      await mkdir(path.join(runDir, "cycle-01", "site"), { recursive: true });
    },
    criticFn: async () => critiqueArtifact({
      cycle: 1,
      score: 91,
      verdict: "ship",
      shipEligible: true,
    }),
    reviseRunFn: async () => {
      revised = true;
    },
  });

  assert.equal(revised, false);
  assert.equal(result.report.cycles.length, 1);
  assert.equal(result.report.selectedCycle, 1);
});

test("executePipeline ignores a forged ship verdict and stops only on derived eligibility", async () => {
  const root = path.join(process.cwd(), "tmp", randomUUID());
  const revisions = [];
  const result = await executePipeline({
    businessName: "Derived Gate",
    fast: true,
    maxCycles: 3,
    runsRoot: path.join(root, "runs"),
    trashRoot: path.join(root, "trash"),
    createBriefFn: async () => ({ business: { name: "Derived Gate" } }),
    buildRunFn: async ({ runDir }) => {
      await mkdir(path.join(runDir, "cycle-01", "site"), { recursive: true });
    },
    criticFn: async ({ cycle }) =>
      cycle === 1
        ? critiqueArtifact({
            cycle,
            score: 97,
            verdict: "ship",
            shipEligible: false,
            lawGatePassed: false,
            lawGateFailures: ["law:foldComposition:unverified"],
            hardGateFailures: ["law:foldComposition:unverified"],
          })
        : critiqueArtifact({
            cycle,
            score: 89,
            verdict: "ship",
            shipEligible: true,
          }),
    reviseRunFn: async ({ runDir, fromCycle }) => {
      revisions.push(fromCycle);
      await mkdir(
        path.join(runDir, `cycle-${String(fromCycle + 1).padStart(2, "0")}`, "site"),
        { recursive: true },
      );
    },
  });

  assert.deepEqual(revisions, [1]);
  assert.equal(result.report.cycles.length, 2);
  assert.equal(result.report.stopReason, "threshold_reached");
  assert.equal(result.report.selectedCycle, 2);
});

test("executePipeline records delivery after selecting the best cycle", async () => {
  const root = path.join(process.cwd(), "tmp", randomUUID());
  let deliveryInput;
  const result = await executePipeline({
    businessName: "Delivered Site",
    fast: true,
    runsRoot: path.join(root, "runs"),
    trashRoot: path.join(root, "trash"),
    createBriefFn: async () => ({ business: { name: "Delivered Site" } }),
    buildRunFn: async ({ runDir }) => {
      await mkdir(path.join(runDir, "cycle-01", "site"), { recursive: true });
    },
    criticFn: async () => critiqueArtifact({
      cycle: 1,
      score: 90,
      verdict: "ship",
      shipEligible: true,
    }),
    deliveryFn: async (value) => {
      deliveryInput = value;
      return { mode: "cloudflare", url: "https://mainstreet-hackathon.pages.dev/", verified: true };
    },
  });

  assert.equal(deliveryInput.selectedCycle, 1);
  assert.equal(result.report.delivery.verified, true);
  assert.equal(result.delivery.url, "https://mainstreet-hackathon.pages.dev/");
});

test("finalizeExistingRun selects from preserved critique artifacts", async () => {
  const runDir = path.join(process.cwd(), "tmp", randomUUID(), "run");
  await mkdir(runDir, { recursive: true });
  await writeFile(path.join(runDir, "brief.json"), JSON.stringify({ business: { name: "Juniper Oven" } }), "utf8");
  for (const [cycle, score, mechanicalPassed] of [
    [1, 60, false],
    [2, 78, true],
    [3, 79, true],
  ]) {
    const cycleDir = path.join(runDir, `cycle-${String(cycle).padStart(2, "0")}`);
    await mkdir(path.join(cycleDir, "site"), { recursive: true });
    await writeFile(
      path.join(cycleDir, "critique.json"),
      JSON.stringify(critiqueArtifact({
        cycle,
        score,
        verdict: "revise",
        mechanicalPassed,
        shipEligible: false,
        hardGateFailures: mechanicalPassed ? ["score:below-threshold"] : ["mechanical:not-passed"],
      })),
      "utf8",
    );
  }

  const report = await finalizeExistingRun({
    runDir,
    slug: "juniper-oven",
    now: () => new Date("2026-07-17T16:00:00.000Z"),
  });
  assert.equal(report.selectedCycle, 3);
  assert.equal(report.stopReason, "max_cycles_reached");
  assert.equal(report.cycles[2].assetsResolved, true);
  assert.equal(report.cycles[2].lawGatePassed, true);
  assert.equal(report.cycles[2].shipEligible, false);
  assert.deepEqual(report.cycles[2].hardGateFailures, ["score:below-threshold"]);
});

function critiqueArtifact(overrides = {}) {
  const artifact = {
    cycle: 1,
    score: 90,
    visionScore: null,
    verdict: "revise",
    mode: "vision",
    mechanicalPassed: true,
    assetsResolved: true,
    lawGatePassed: true,
    lawGateFailures: [],
    shipEligible: false,
    hardGateFailures: ["score:below-threshold"],
    laws: { headlineDiscipline: { status: "pass" } },
    lawCoverage: { headlineDiscipline: { complete: true } },
    ...overrides,
  };
  if (!Object.hasOwn(overrides, "hardGateFailures") && artifact.shipEligible) {
    artifact.hardGateFailures = [];
  }
  return artifact;
}

function sequenceClock() {
  let tick = 0;
  return () => new Date(Date.UTC(2026, 6, 17, 12, 0, tick++));
}
