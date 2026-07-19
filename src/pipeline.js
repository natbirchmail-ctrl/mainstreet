import { readFile, readdir } from "node:fs/promises";

import { buildRun } from "./build.js";
import { runCriticCycle } from "./critic.js";
import { createBrief } from "./intake.js";
import {
  initializeRun,
  resolveInside,
  writeJsonNew,
  writeTextNew,
} from "./lib/runs.js";
import { slugify } from "./lib/slug.js";
import { reviseRun } from "./revise.js";
import {
  createPlaywrightRecovery,
  installPlaywrightChromium,
  isPlaywrightChromiumExecutableMissing,
} from "./playwright-recovery.js";

export {
  createPlaywrightRecovery,
  installPlaywrightChromium,
  isPlaywrightChromiumExecutableMissing,
};

export async function executePipeline({
  businessName,
  city = null,
  details = null,
  fast = false,
  maxCycles = 3,
  runsRoot,
  trashRoot,
  createBriefFn = createBrief,
  buildRunFn = buildRun,
  criticFn = runCriticCycle,
  reviseRunFn = reviseRun,
  deliveryFn = null,
  onProgress = () => {},
  now = () => new Date(),
  browserRecovery = null,
  playwrightInstallerFn = installPlaywrightChromium,
}) {
  if (!Number.isInteger(maxCycles) || maxCycles < 1 || maxCycles > 3) {
    throw new TypeError("maxCycles must be an integer from 1 through 3.");
  }
  const invocationBrowserRecovery =
    browserRecovery ?? createPlaywrightRecovery({ installer: playwrightInstallerFn });

  const startedAt = now().toISOString();
  const slug = slugify(businessName);
  const { runDir } = await initializeRun({ slug, runsRoot, trashRoot, now });
  onProgress({ type: "run_started", slug });
  const brief = await createBriefFn({ businessName, city, details, fast });
  await writeJsonNew(resolveInside(runDir, "brief.json"), brief);
  onProgress({ type: "intake_complete", slug });
  await buildRunFn({ runDir, browserRecovery: invocationBrowserRecovery });
  onProgress({ type: "build_complete", cycle: 1 });

  const cycles = [];
  let stopReason = "max_cycles_reached";
  for (let cycle = 1; cycle <= maxCycles; cycle += 1) {
    let critique;
    try {
      critique = await criticFn({
        runDir,
        cycle,
        browserRecovery: invocationBrowserRecovery,
      });
    } catch (error) {
      if (!isPipelineStageUnavailable(error)) throw error;
      stopReason = "critic_unavailable";
      await writeJsonNew(resolveInside(runDir, `cycle-${pad(cycle)}`, "critic-error.json"), {
        schemaVersion: "1.0",
        cycle,
        createdAt: now().toISOString(),
        errorCode: error?.code || error?.name || "CRITIC_ERROR",
        message: "The critic was unavailable. The best completed build was preserved.",
      });
      break;
    }

    cycles.push(toCycleSummary(critique));
    onProgress({
      type: "critique_complete",
      cycle,
      score: critique.score,
      verdict: critique.verdict,
    });
    if (critique.mode === "source-fallback") {
      stopReason = "source_fallback";
      break;
    }
    if (critique.shipEligible === true) {
      stopReason = "threshold_reached";
      break;
    }
    if (cycle >= maxCycles) {
      break;
    }

    try {
      await reviseRunFn({
        runDir,
        fromCycle: cycle,
        browserRecovery: invocationBrowserRecovery,
      });
      onProgress({ type: "revision_complete", fromCycle: cycle, toCycle: cycle + 1 });
    } catch (error) {
      if (!isPipelineStageUnavailable(error)) throw error;
      stopReason = "revision_unavailable";
      await writeJsonNew(resolveInside(runDir, `cycle-${pad(cycle)}`, "revision-error.json"), {
        schemaVersion: "1.0",
        cycle,
        createdAt: now().toISOString(),
        errorCode: error?.code || error?.name || "REVISION_ERROR",
        message: "The revision was unavailable. The best completed build was preserved.",
      });
      break;
    }
  }

  if (cycles.length === 0) {
    cycles.push({
      cycle: 1,
      score: null,
      verdict: "unscored",
      mode: "unavailable",
      evidencePacketSha256: null,
      mechanicalPassed: null,
      assetsResolved: null,
      lawGatePassed: false,
      lawGateFailures: ["critique:unavailable"],
      shipEligible: false,
      hardGateFailures: ["critique:unavailable"],
      laws: null,
      lawCoverage: null,
    });
  }

  const selected = selectBestCycle(cycles);
  const selectedSiteDir = resolveInside(runDir, `cycle-${pad(selected.cycle)}`, "site");
  const recoveryEvidence = invocationBrowserRecovery.snapshot();
  if (recoveryEvidence.installAttempted) {
    await writeJsonNew(
      resolveInside(runDir, "playwright-recovery.json"),
      recoveryEvidence,
    );
  }
  const delivery = deliveryFn
    ? await deliveryFn({ runDir, slug, selectedCycle: selected.cycle, siteDir: selectedSiteDir })
    : null;
  if (delivery) {
    onProgress({ type: "delivery_complete", delivery });
  }
  const report = await writeRunReport({
    runDir,
    slug,
    businessName,
    startedAt,
    completedAt: now().toISOString(),
    cycles,
    selectedCycle: selected.cycle,
    stopReason,
    delivery,
  });
  onProgress({ type: "run_complete", report });

  return { slug, runDir, selectedSiteDir, report, delivery };
}

export function selectBestCycle(cycles) {
  if (!Array.isArray(cycles) || cycles.length === 0) {
    throw new TypeError("At least one cycle is required.");
  }
  const scored = cycles.filter((cycle) => Number.isFinite(cycle.score));
  const eligible = scored.filter((cycle) => cycle.shipEligible === true);
  const mechanicallySafe = scored.filter((cycle) => cycle.mechanicalPassed === true);
  const candidates =
    eligible.length > 0
      ? eligible
      : mechanicallySafe.length > 0
        ? mechanicallySafe
        : scored.length > 0
          ? scored
          : cycles;

  return [...candidates].sort((left, right) => {
    const scoreDifference = (right.score ?? -1) - (left.score ?? -1);
    return scoreDifference || right.cycle - left.cycle;
  })[0];
}

export async function finalizeExistingRun({
  runDir,
  slug,
  stopReason,
  delivery = null,
  now = () => new Date(),
}) {
  const brief = JSON.parse(await readFile(resolveInside(runDir, "brief.json"), "utf8"));
  const cycles = await loadCycleSummaries(runDir);
  if (cycles.length === 0) {
    throw new Error("No completed critique cycles were found.");
  }
  const selected = selectBestCycle(cycles);
  const resolvedStopReason =
    stopReason ||
    (cycles.at(-1).shipEligible === true
      ? "threshold_reached"
      : "max_cycles_reached");

  return writeRunReport({
    runDir,
    slug,
    businessName: brief.business.name,
    startedAt: null,
    completedAt: now().toISOString(),
    cycles,
    selectedCycle: selected.cycle,
    stopReason: resolvedStopReason,
    delivery,
  });
}

async function loadCycleSummaries(runDir) {
  const entries = await readdir(runDir, { withFileTypes: true });
  const cycles = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (!entry.isDirectory() || !/^cycle-\d{2}$/.test(entry.name)) continue;
    try {
      const critique = JSON.parse(
        await readFile(resolveInside(runDir, entry.name, "critique.json"), "utf8"),
      );
      cycles.push(toCycleSummary(critique));
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
  return cycles;
}

async function writeRunReport({
  runDir,
  slug,
  businessName,
  startedAt,
  completedAt,
  cycles,
  selectedCycle,
  stopReason,
  delivery,
}) {
  const numericScores = cycles.map((cycle) => cycle.score).filter(Number.isFinite);
  const firstScore = numericScores[0];
  const selectedScore = cycles.find((cycle) => cycle.cycle === selectedCycle)?.score;
  const report = {
    schemaVersion: "1.0",
    slug,
    businessName,
    startedAt,
    completedAt,
    status: "completed",
    stopReason,
    selectedCycle,
    scoresImproved:
      numericScores.length >= 2 &&
      Number.isFinite(selectedScore) &&
      selectedScore > firstScore,
    cycles,
    delivery,
  };
  await Promise.all([
    writeJsonNew(resolveInside(runDir, "run-report.json"), report),
    writeTextNew(resolveInside(runDir, "RUN-REPORT.md"), renderMarkdownReport(report)),
  ]);
  return report;
}

function renderMarkdownReport(report) {
  const rows = report.cycles
    .map(
      (cycle) =>
        `| ${cycle.cycle} | ${cycle.score ?? "Unavailable"} | ${cycle.mechanicalPassed ?? "Unavailable"} | ${cycle.assetsResolved ?? "Unavailable"} | ${cycle.lawGatePassed ?? "Unavailable"} | ${cycle.shipEligible} | ${cycle.verdict} |`,
    )
    .join("\n");
  return `# ${report.businessName} run report

Status: ${report.status}

Stop reason: ${report.stopReason}

Selected cycle: ${report.selectedCycle}

| Cycle | Score | Mechanical pass | Assets resolved | Laws pass | Ship eligible | Verdict |
| ---: | ---: | :---: | :---: | :---: | :---: | :--- |
${rows}
`;
}

function toCycleSummary(critique) {
  const shipEligible = critique.mode === "vision" && critique.shipEligible === true;
  return {
    cycle: critique.cycle,
    score: Number.isFinite(critique.score) ? critique.score : null,
    visionScore: Number.isFinite(critique.visionScore) ? critique.visionScore : null,
    verdict: shipEligible ? "ship" : "revise",
    mode: critique.mode,
    evidencePacketSha256:
      typeof critique.evidencePacketSha256 === "string"
        ? critique.evidencePacketSha256
        : null,
    mechanicalPassed: booleanOrNull(critique.mechanicalPassed),
    assetsResolved: booleanOrNull(critique.assetsResolved),
    lawGatePassed: critique.lawGatePassed === true,
    lawGateFailures: cloneArray(critique.lawGateFailures),
    shipEligible,
    hardGateFailures: cloneArray(critique.hardGateFailures),
    laws: cloneObjectOrNull(critique.laws),
    lawCoverage: cloneObjectOrNull(critique.lawCoverage),
  };
}

function pad(cycle) {
  return String(cycle).padStart(2, "0");
}

function booleanOrNull(value) {
  if (value === true) return true;
  if (value === false) return false;
  return null;
}

function cloneArray(value) {
  return Array.isArray(value) ? [...value] : [];
}

function cloneObjectOrNull(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? structuredClone(value)
    : null;
}

function isPipelineStageUnavailable(error) {
  const codes = new Set([
    "CAPTURE_UNAVAILABLE",
    "CONTENT_FILTER",
    "EMPTY_RESPONSE",
    "INCOMPLETE_RESPONSE",
    "INVALID_JSON",
    "MODEL_REFUSAL",
    "MODEL_RESPONSE_ERROR",
  ]);
  const names = new Set([
    "APIConnectionError",
    "APIConnectionTimeoutError",
    "APIError",
    "InternalServerError",
    "ModelResponseError",
    "RateLimitError",
  ]);
  return (
    codes.has(error?.code) ||
    names.has(error?.name) ||
    (Number.isInteger(error?.status) && error.status >= 400)
  );
}
