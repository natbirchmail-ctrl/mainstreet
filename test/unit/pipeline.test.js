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

test("selectBestCycle prefers the highest mechanically clean score", () => {
  assert.equal(
    selectBestCycle([
      { cycle: 1, score: 95, mechanicalPassed: false },
      { cycle: 2, score: 82, mechanicalPassed: true },
      { cycle: 3, score: 84, mechanicalPassed: true },
    ]).cycle,
    3,
  );
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
    criticFn: async ({ cycle }) => ({
      cycle,
      score: scores[cycle - 1],
      verdict: scores[cycle - 1] >= 85 ? "ship" : "revise",
      mechanicalPassed: true,
      mode: "vision",
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
    criticFn: async () => ({ cycle: 1, score: 91, verdict: "ship", mechanicalPassed: true, mode: "vision" }),
    reviseRunFn: async () => {
      revised = true;
    },
  });

  assert.equal(revised, false);
  assert.equal(result.report.cycles.length, 1);
  assert.equal(result.report.selectedCycle, 1);
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
    criticFn: async () => ({ cycle: 1, score: 90, verdict: "ship", mechanicalPassed: true, mode: "vision" }),
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
      JSON.stringify({ cycle, score, verdict: "revise", mode: "vision", mechanicalPassed }),
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
});

function sequenceClock() {
  let tick = 0;
  return () => new Date(Date.UTC(2026, 6, 17, 12, 0, tick++));
}
