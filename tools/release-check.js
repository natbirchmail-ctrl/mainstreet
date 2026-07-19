import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, readFile, readlink } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";

const DEFAULT_EXPECTED_SLUGS = Object.freeze([
  "harborlight-flower-studio",
  "juniper-oven",
  "canyon-wheelworks",
]);
const QUALITY_LAWS = Object.freeze([
  "headlineDiscipline",
  "foldComposition",
  "completeLayouts",
  "firstBeatVisibility",
  "imageContrast",
  "motionRestraint",
  "imageryCoherence",
  "factualRestraint",
]);
const VIEWPORT_COVERAGE_LAWS = new Set([
  "foldComposition",
  "firstBeatVisibility",
  "imageContrast",
  "imageryCoherence",
]);
const VISUAL_LAWS = new Set([
  "foldComposition",
  "firstBeatVisibility",
  "imageContrast",
  "motionRestraint",
  "imageryCoherence",
]);
const EVIDENCE_VIEWPORTS = Object.freeze(["desktop", "tablet", "phone"]);
const DIMENSION_MAXIMUMS = Object.freeze({
  layout: 18,
  hierarchy: 15,
  color: 12,
  typography: 15,
  mobile: 15,
  specificity: 10,
  accessibility: 10,
  polish: 5,
});
const SCREENSHOTS = Object.freeze({
  desktop: "screenshots/desktop-home.png",
  tablet: "screenshots/tablet-home.png",
  phone: "screenshots/mobile-home.png",
});
const CRITIC_FULL_PAGE_SCREENSHOTS = Object.freeze({
  desktop: "screenshots/critic/desktop-full-page.png",
  tablet: "screenshots/critic/tablet-full-page.png",
  phone: "screenshots/critic/mobile-full-page.png",
});
const VIEWPORT_DIMENSIONS = Object.freeze({
  desktop: Object.freeze({ width: 1440, height: 900 }),
  tablet: Object.freeze({ width: 1024, height: 768 }),
  phone: Object.freeze({ width: 390, height: 844 }),
});
const ENV_FILE = [".", "env"].join("");
const ENV_EXAMPLE_FILE = [ENV_FILE, "example"].join(".");
const FORBIDDEN_SEGMENTS = new Set([
  [".", "trash"].join(""),
  [".", "wrangler"].join(""),
  ["node", "_modules"].join(""),
  "tmp",
  "coverage",
  "dist",
]);
const CONFIDENTIAL_TERMS = Object.freeze(
  [
    ["Claude", "Design"].join(""),
    ["BSC", "-Workspace"].join(""),
    ["repos", "/", "local", "-sites"].join(""),
    ["naz", "-site", "-factory"].join(""),
    ["Northern", " Arizona ", "Design"].join(""),
  ].map((value) => value.toLowerCase()),
);
const SECRET_NAME_PATTERN = [
  ["api", "key"].join("[_-]?"),
  ["api", "token"].join("[_-]?"),
  ["access", "token"].join("[_-]?"),
  ["auth", "token"].join("[_-]?"),
  ["client", "secret"].join("[_-]?"),
  ["secret", "key"].join("[_-]?"),
  ["private", "key"].join("[_-]?"),
  "password",
  "passwd",
].join("|");
const PREFIXED_SECRET_NAME_PATTERN =
  `(?:[a-z0-9]+[_-])*?(?:${SECRET_NAME_PATTERN})`;
const SECRET_ENV_NAME = new RegExp(`^(?:${PREFIXED_SECRET_NAME_PATTERN})$`, "i");
const QUOTED_SECRET_ASSIGNMENT = new RegExp(
  `["']?\\b${PREFIXED_SECRET_NAME_PATTERN}\\b["']?[^\\S\\r\\n]*(?:=|:)[^\\S\\r\\n]*(["'\\x60])([^"'\\x60\\r\\n]+)\\1`,
  "gi",
);
const UNQUOTED_SECRET_ASSIGNMENT = new RegExp(
  `(?:^|\\r?\\n)[^\\S\\r\\n]*(?:export[^\\S\\r\\n]+)?${PREFIXED_SECRET_NAME_PATTERN}[^\\S\\r\\n]*(?:=|:)[^\\S\\r\\n]*([^\\s#;\\r\\n]+)`,
  "gi",
);
const RAW_SECRET_PATTERNS = Object.freeze([
  new RegExp(`${["sk", "-"].join("")}[a-z0-9_-]{16,}`, "i"),
  new RegExp(`${["ghp", "_"].join("")}[a-z0-9]{20,}`, "i"),
  new RegExp(`${["AK", "IA"].join("")}[A-Z0-9]{16}`, "i"),
  new RegExp(
    `${["BEGIN", " ", "PRIVATE", " KEY"].join("")}`,
    "i",
  ),
]);
const WINDOWS_MACHINE_PATH = new RegExp(
  String.raw`(?:^|[\s"'\x60(=:[,])(?:file:\/\/\/)?[a-z]:(?:[\\/]+)[^\s"'\x60<>|]+`,
  "im",
);
const UNC_MACHINE_PATH = new RegExp(
  String.raw`(?:^|[\s"'\x60(=:[,])\\{2,}(?!x[0-9a-f]{2}[\\/])[a-z0-9._-]+[\\/]+[a-z0-9$._-]+(?:[\\/]|$)`,
  "im",
);
const POSIX_MACHINE_PATH = new RegExp(
  String.raw`(?:^|[\s"'\x60(=:[,])\/(?:Users|home|opt|var|tmp|etc|mnt|srv|workspace|workspaces|Volumes|private)\/[^\s"'\x60]+`,
  "im",
);
const HISTORICAL_ABSOLUTE_PATH_ATTESTATIONS = new Set([
  historicalAttestationKey(
    "test/unit/critic.test.js",
    "07e8c300359258bdfc760d0aa652ba31501700b4",
    "be91293e0347cacb0d53133ab3a16484cdd90c0b988e7bc48c8eedf8420b8e4d",
    9131,
  ),
  historicalAttestationKey(
    "test/unit/critic.test.js",
    "3b49ae9b1d85f823e11198af6c69322e9c79eda3",
    "255663823186a119e266443dedca6fa920f33638cacfc9c92d64a8a134f19c86",
    6504,
  ),
  historicalAttestationKey(
    "test/unit/critic.test.js",
    "ae51d4961f2701f938fcb103a76ab875638e5e4a",
    "38deef84dac7ce96ad2816c5776fa4c0555a3a89ae60622c595fb2d4a48745f8",
    8273,
  ),
  historicalAttestationKey(
    "test/unit/critic.test.js",
    "e72f4c0401073a2e9a47f2ad9679d063d233a01e",
    "4066a0aeee4d97b9c173fe803eb516242423b7a0daa81bbde7ffb7bb8bdae330",
    8202,
  ),
  historicalAttestationKey(
    "test/unit/revise.test.js",
    "3b3bf0e08845fde652856177fd67df33d6432443",
    "daa64020f72dda21a865f6acfc710e450e6b775ea6b0c540b6ebab9640daad07",
    19172,
  ),
  historicalAttestationKey(
    "test/unit/revise.test.js",
    "a932750ae48b89fdeed66ca194d2adfcbdc7a476",
    "1ed3178b80a8a30c4e0ec269a4258d1992af433332b2e18f8e59ab0784a96fe9",
    17910,
  ),
  historicalAttestationKey(
    "test/unit/revise.test.js",
    "759b61da342abac05150628fe9405554f53484ce",
    "70a2b65f2f757b0f8df2f01c37fd3ea18441482b5595d35b6073fdab5dcb2418",
    17823,
  ),
]);
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const MODULE_PATH = fileURLToPath(import.meta.url);

export async function checkRelease({
  repoRoot = process.cwd(),
  expectedSlugs = DEFAULT_EXPECTED_SLUGS,
  git,
} = {}) {
  const root = path.resolve(repoRoot);
  const slugs = normalizeExpectedSlugs(expectedSlugs);
  const runGit = createGitRunner({ root, adapter: git });
  const findings = new FindingCollector();

  const [trackedOutput, deletedOutput, untrackedOutput] = await Promise.all([
    runGit(["ls-files", "-z"]),
    runGit(["ls-files", "--deleted", "-z"]),
    runGit(["ls-files", "--others", "--exclude-standard", "-z"]),
  ]);
  const deletedPaths = new Set(parseNulPaths(deletedOutput));
  const trackedPaths = parseNulPaths(trackedOutput).filter(
    (relativePath) => !deletedPaths.has(relativePath),
  );
  const untrackedPaths = parseNulPaths(untrackedOutput);
  const currentPaths = new Set([...trackedPaths, ...untrackedPaths]);
  const currentBuffers = new Map();

  for (const relativePath of trackedPaths) {
    applyTrackedPathRules(findings, relativePath);
  }
  for (const relativePath of currentPaths) {
    const value = await readWorkingFile(root, relativePath);
    if (value === null) {
      currentPaths.delete(relativePath);
      continue;
    }
    currentBuffers.set(relativePath, value);
    scanContent(findings, relativePath, value);
    if (relativePath === ENV_EXAMPLE_FILE && invalidEnvironmentExample(value)) {
      findings.add("ENV_TRACKED", relativePath);
    }
  }

  await scanReachableHistory({ runGit, findings });
  await validateExamples({
    findings,
    expectedSlugs: slugs,
    currentPaths,
    currentBuffers,
  });
  validateDocumentation({
    findings,
    expectedSlugs: slugs,
    currentPaths,
    currentBuffers,
  });

  const result = findings.list();
  return { ok: result.length === 0, findings: result };
}

export function formatFindings(findings) {
  if (!Array.isArray(findings)) {
    throw new TypeError("Findings must be an array.");
  }
  const normalized = new Map();
  for (const finding of findings) {
    if (!finding || !/^[A-Z][A-Z0-9_]*$/.test(finding.rule)) {
      throw new TypeError("Finding rule is invalid.");
    }
    const relativePath = safeFindingPath(finding.path);
    normalized.set(`${finding.rule}\0${relativePath}`, {
      rule: finding.rule,
      path: relativePath,
    });
  }
  return [...normalized.values()]
    .sort(compareFindings)
    .map(({ rule, path: relativePath }) => `${rule} ${relativePath}`)
    .join("\n");
}

class FindingCollector {
  constructor() {
    this.findings = new Map();
  }

  add(rule, relativePath) {
    const cleanPath = safeFindingPath(relativePath);
    this.findings.set(`${rule}\0${cleanPath}`, { rule, path: cleanPath });
  }

  list() {
    return [...this.findings.values()].sort(compareFindings);
  }
}

async function scanReachableHistory({ runGit, findings }) {
  const commitOutput = await runGit(["rev-list", "--all"]);
  const commits = commitOutput
    .toString("utf8")
    .split(/\r?\n/)
    .map((value) => value.trim())
    .filter(Boolean);
  const historyEntries = new Map();
  const blobIds = new Set();

  for (const commit of commits) {
    const tree = await runGit(["ls-tree", "-rz", "--full-tree", commit]);
    for (const entry of parseTreeEntries(tree)) {
      applyTrackedPathRules(findings, entry.path);
      if (entry.type !== "blob") continue;
      historyEntries.set(`${entry.object}\0${entry.path}`, entry);
      blobIds.add(entry.object);
    }
  }

  const blobs = await readBlobs(runGit, [...blobIds]);
  for (const { object, path: relativePath } of historyEntries.values()) {
    const value = blobs.get(object);
    if (!value) throw new Error("History object unavailable.");
    scanContent(findings, relativePath, value, {
      suppressAbsoluteMachinePath: isAttestedHistoricalAbsolutePath({
        relativePath,
        object,
        value,
      }),
    });
    if (relativePath === ENV_EXAMPLE_FILE && invalidEnvironmentExample(value)) {
      findings.add("ENV_TRACKED", relativePath);
    }
  }
}

async function validateExamples({
  findings,
  expectedSlugs,
  currentPaths,
  currentBuffers,
}) {
  const actualSlugs = new Set();
  for (const relativePath of currentPaths) {
    const match = /^runs\/([^/]+)\//.exec(relativePath);
    if (match) actualSlugs.add(match[1]);
  }
  if (!sameStringSet(actualSlugs, new Set(expectedSlugs))) {
    findings.add("EXAMPLE_SET_INVALID", "runs");
  }

  for (const slug of expectedSlugs) {
    await validateExample({
      findings,
      slug,
      currentPaths,
      currentBuffers,
    });
  }
}

async function validateExample({
  findings,
  slug,
  currentPaths,
  currentBuffers,
}) {
  const runRoot = `runs/${slug}`;
  const reportPath = `${runRoot}/run-report.json`;
  const deploymentPath = `${runRoot}/deployment.json`;
  const brief = readJsonArtifact({
    findings,
    relativePath: `${runRoot}/brief.json`,
    currentPaths,
    currentBuffers,
  });
  requireNonemptyText({
    findings,
    relativePath: `${runRoot}/RUN-REPORT.md`,
    currentPaths,
    currentBuffers,
  });
  const report = readJsonArtifact({
    findings,
    relativePath: reportPath,
    currentPaths,
    currentBuffers,
  });
  const deployment = readJsonArtifact({
    findings,
    relativePath: deploymentPath,
    currentPaths,
    currentBuffers,
  });

  if (brief && (!isPlainObject(brief.business) || !isNonempty(brief.business.name))) {
    findings.add("ARTIFACT_INVALID", `${runRoot}/brief.json`);
  }

  const cycleNumbers = [...currentPaths]
    .map((relativePath) => {
      const match = new RegExp(`^${escapeRegExp(runRoot)}/cycle-(\\d{2})/`).exec(
        relativePath,
      );
      return match ? Number.parseInt(match[1], 10) : null;
    })
    .filter(Number.isInteger)
    .filter((value, index, values) => values.indexOf(value) === index)
    .sort((left, right) => left - right);
  const malformedCycleDirectory = [...currentPaths].some((relativePath) => {
    if (!relativePath.startsWith(`${runRoot}/`)) return false;
    const directory = relativePath.slice(runRoot.length + 1).split("/")[0];
    return directory.startsWith("cycle-") && !/^cycle-\d{2}$/.test(directory);
  });
  const expectedCycleNumbers = Array.from(
    { length: cycleNumbers.at(-1) || 0 },
    (_, index) => index + 1,
  );
  if (
    cycleNumbers.length === 0 ||
    cycleNumbers.length > 3 ||
    malformedCycleDirectory ||
    !sameNumberArray(cycleNumbers, expectedCycleNumbers)
  ) {
    findings.add("REFERENCE_MISMATCH", reportPath);
  }

  if (!isPlainObject(report)) return;
  if (report.slug !== slug || !Array.isArray(report.cycles)) {
    findings.add("REFERENCE_MISMATCH", reportPath);
  }
  const reportCycleNumbers = Array.isArray(report.cycles)
    ? report.cycles.map((cycle) => cycle?.cycle)
    : [];
  if (!sameNumberArray(reportCycleNumbers, cycleNumbers)) {
    findings.add("REFERENCE_MISMATCH", reportPath);
  }
  if (
    !Number.isInteger(report.selectedCycle) ||
    !cycleNumbers.includes(report.selectedCycle)
  ) {
    findings.add("REFERENCE_MISMATCH", reportPath);
  }

  const cycles = new Map();
  for (const cycle of cycleNumbers) {
    cycles.set(
      cycle,
      await validateCycle({
        findings,
        runRoot,
        cycle,
        maximumCycle: cycleNumbers.at(-1),
        currentPaths,
        currentBuffers,
      }),
    );
  }

  const selectionCandidates = cycleNumbers.map((cycle) => {
    const artifacts = cycles.get(cycle);
    return {
      cycle,
      score: artifacts?.critique?.score,
      shipEligible: artifacts?.critique?.shipEligible,
      mechanicalPassed: artifacts?.mechanical?.passed,
      assetsResolved: artifacts?.assets?.allResolved,
    };
  });
  const expectedSelectedCycle = selectExpectedCycle(selectionCandidates);
  const selectedScore = selectionCandidates.find(
    (candidate) => candidate.cycle === report.selectedCycle,
  )?.score;
  const initialScore = selectionCandidates[0]?.score;
  if (
    expectedSelectedCycle !== report.selectedCycle ||
    report.scoresImproved !==
      (Number.isFinite(initialScore) &&
        Number.isFinite(selectedScore) &&
        selectedScore > initialScore)
  ) {
    findings.add("REFERENCE_MISMATCH", reportPath);
  }

  for (const cycle of cycleNumbers) {
    const summary = report.cycles?.find((entry) => entry?.cycle === cycle);
    if (!cycleSummaryMatches(summary, cycles.get(cycle))) {
      findings.add("REFERENCE_MISMATCH", reportPath);
    }
  }

  const selected = cycles.get(report.selectedCycle);
  const summary = Array.isArray(report.cycles)
    ? report.cycles.find((cycle) => cycle?.cycle === report.selectedCycle)
    : null;
  if (!selected || !isPlainObject(summary)) return;

  validateSelectedEvidence({
    findings,
    slug,
    runRoot,
    report,
    reportPath,
    deployment,
    deploymentPath,
    selected,
    summary,
    currentPaths,
    currentBuffers,
  });
}

function cycleSummaryMatches(summary, artifacts) {
  const critique = artifacts?.critique;
  const mechanical = artifacts?.mechanical;
  const assets = artifacts?.assets;
  if (
    !isPlainObject(summary) ||
    !isPlainObject(critique) ||
    !isPlainObject(mechanical) ||
    !isPlainObject(assets)
  ) {
    return false;
  }
  return (
    summary.cycle === artifacts.cycle &&
    summary.score === critique.score &&
    summary.mode === critique.mode &&
    summary.verdict === critique.verdict &&
    summary.mechanicalPassed === mechanical.passed &&
    summary.mechanicalPassed === critique.mechanicalPassed &&
    summary.assetsResolved === assets.allResolved &&
    summary.assetsResolved === critique.assetsResolved &&
    summary.lawGatePassed === critique.lawGatePassed &&
    summary.shipEligible === critique.shipEligible &&
    sameJson(summary.lawGateFailures, critique.lawGateFailures) &&
    sameJson(summary.hardGateFailures, critique.hardGateFailures) &&
    sameJson(summary.laws, critique.laws) &&
    sameJson(summary.lawCoverage, critique.lawCoverage)
  );
}

async function validateCycle({
  findings,
  runRoot,
  cycle,
  maximumCycle,
  currentPaths,
  currentBuffers,
}) {
  const cycleRoot = `${runRoot}/cycle-${String(cycle).padStart(2, "0")}`;
  const buildPath = `${cycleRoot}/build.json`;
  const assetsPath = `${cycleRoot}/assets.json`;
  const mechanicalPath = `${cycleRoot}/mechanical.json`;
  const critiquePath = `${cycleRoot}/critique.json`;
  const screenshotManifestPath = `${cycleRoot}/screenshots/manifest.json`;
  const criticManifestPath = `${cycleRoot}/screenshots/critic/manifest.json`;
  const build = readJsonArtifact({
    findings,
    relativePath: buildPath,
    currentPaths,
    currentBuffers,
  });
  const assets = readJsonArtifact({
    findings,
    relativePath: assetsPath,
    currentPaths,
    currentBuffers,
  });
  const mechanical = readJsonArtifact({
    findings,
    relativePath: mechanicalPath,
    currentPaths,
    currentBuffers,
  });
  const critique = readJsonArtifact({
    findings,
    relativePath: critiquePath,
    currentPaths,
    currentBuffers,
  });
  const screenshotManifest = readJsonArtifact({
    findings,
    relativePath: screenshotManifestPath,
    currentPaths,
    currentBuffers,
  });
  const criticManifest = readJsonArtifact({
    findings,
    relativePath: criticManifestPath,
    currentPaths,
    currentBuffers,
  });

  for (const relativePath of [
    `${cycleRoot}/site/index.html`,
    `${cycleRoot}/site/styles.css`,
    `${cycleRoot}/site/script.js`,
    `${cycleRoot}/visible-text.txt`,
  ]) {
    requireNonemptyText({
      findings,
      relativePath,
      currentPaths,
      currentBuffers,
    });
  }

  if (isPlainObject(build)) {
    if (
      build.cycle !== cycle ||
      !Array.isArray(build.imagePlan) ||
      build.imagePlan.length < 3 ||
      build.imagePlan.length > 5 ||
      !isPlainObject(build.assetSummary)
    ) {
      findings.add("ARTIFACT_INVALID", buildPath);
    }
    if (cycle > 1 && build.fromCycle !== cycle - 1) {
      findings.add("REFERENCE_MISMATCH", buildPath);
    }
  }
  let mechanicalValid = false;
  if (isPlainObject(mechanical)) {
    mechanicalValid =
      mechanical.cycle === cycle &&
      typeof mechanical.passed === "boolean" &&
      Array.isArray(mechanical.failures) &&
      mechanical.passed === (mechanical.failures.length === 0);
    if (!mechanicalValid) {
      findings.add("ARTIFACT_INVALID", mechanicalPath);
    }
  }
  if (isPlainObject(critique)) {
    if (
      critique.cycle !== cycle ||
      !Number.isFinite(critique.score) ||
      typeof critique.mode !== "string" ||
      typeof critique.shipEligible !== "boolean"
    ) {
      findings.add("ARTIFACT_INVALID", critiquePath);
    }
  }

  const assetValidation = validateAssets({
    findings,
    cycleRoot,
    build,
    assets,
    assetsPath,
    currentPaths,
    currentBuffers,
  });
  validateScreenshots({
    findings,
    cycle,
    cycleRoot,
    manifest: screenshotManifest,
    manifestPath: screenshotManifestPath,
    currentPaths,
    currentBuffers,
  });
  validateCriticScreenshots({
    findings,
    cycle,
    cycleRoot,
    manifest: criticManifest,
    manifestPath: criticManifestPath,
    currentPaths,
    currentBuffers,
  });

  const critiqueAnalysis = analyzeCritique({ critique, mechanical, assets });
  if (isPlainObject(critique) && !critiqueAnalysis.valid) {
    findings.add("ARTIFACT_INVALID", critiquePath);
  }

  if (cycle < maximumCycle) {
    const revisePath = `${cycleRoot}/revise.json`;
    const revise = readJsonArtifact({
      findings,
      relativePath: revisePath,
      currentPaths,
      currentBuffers,
    });
    if (
      isPlainObject(revise) &&
      (revise.fromCycle !== cycle || revise.toCycle !== cycle + 1)
    ) {
      findings.add("REFERENCE_MISMATCH", revisePath);
    }
  }

  return {
    cycle,
    cycleRoot,
    build,
    buildPath,
    assets,
    assetsPath,
    mechanical,
    mechanicalPath,
    mechanicalValid,
    critique,
    critiquePath,
    critiqueAnalysis,
    assetValidation,
  };
}

function validateAssets({
  findings,
  cycleRoot,
  build,
  assets,
  assetsPath,
  currentPaths,
  currentBuffers,
}) {
  if (!isPlainObject(assets)) {
    return { valid: false, derivedAllResolved: null };
  }
  let invalid = false;
  if (
    typeof assets.allResolved !== "boolean" ||
    !Array.isArray(assets.files) ||
    assets.files.length < 3 ||
    assets.files.length > 5 ||
    !Number.isInteger(assets.requestCount) ||
    assets.requestCount !== assets.files.length ||
    !Number.isInteger(assets.successCount) ||
    !Number.isInteger(assets.fallbackCount) ||
    assets.successCount + assets.fallbackCount !== assets.requestCount
  ) {
    invalid = true;
  }

  const manifestFilenames = [];
  const resolutionStates = [];
  for (const file of Array.isArray(assets.files) ? assets.files : []) {
    const filename = file?.filename;
    const relativePath = `${cycleRoot}/site/assets/${filename || "invalid.png"}`;
    if (
      !isPlainObject(file) ||
      !/^[a-z0-9][a-z0-9-]*\.png$/.test(filename || "") ||
      file.path !== `assets/${filename}` ||
      file.mediaType !== "image/png" ||
      !Number.isInteger(file.bytes) ||
      file.bytes <= 0 ||
      !/^[a-f0-9]{64}$/.test(file.sha256 || "") ||
      !/^[a-f0-9]{64}$/.test(file.promptHash || "") ||
      typeof file.resolved !== "boolean" ||
      !isNonempty(file.source) ||
      (file.resolved ? file.errorCode !== null : !isNonempty(file.errorCode)) ||
      !isNonempty(file.role) ||
      !isNonempty(file.alt) ||
      !validFocalPoint(file.focalPoint)
    ) {
      invalid = true;
      continue;
    }
    manifestFilenames.push(filename);
    resolutionStates.push(file.resolved);
    const value = currentBuffers.get(relativePath);
    if (!currentPaths.has(relativePath)) {
      findings.add("ARTIFACT_MISSING", relativePath);
      continue;
    }
    if (
      !value ||
      !hasPngSignature(value) ||
      value.length !== file.bytes ||
      sha256(value) !== file.sha256
    ) {
      findings.add("ARTIFACT_INVALID", relativePath);
    }
  }


  const fileCount = Array.isArray(assets.files) ? assets.files.length : -1;
  const resolvedCount = resolutionStates.filter(Boolean).length;
  const derivedAllResolved =
    fileCount >= 0 &&
    resolutionStates.length === fileCount &&
    resolutionStates.every((value) => value === true);
  if (
    assets.successCount !== resolvedCount ||
    assets.fallbackCount !== fileCount - resolvedCount ||
    assets.allResolved !== derivedAllResolved
  ) {
    invalid = true;
  }

  const actualFilenames = [...currentPaths]
    .filter((relativePath) =>
      relativePath.startsWith(`${cycleRoot}/site/assets/`),
    )
    .map((relativePath) => relativePath.slice(`${cycleRoot}/site/assets/`.length))
    .filter((filename) => filename.endsWith(".png"))
    .sort();
  if (!sameStringArray([...manifestFilenames].sort(), actualFilenames)) {
    invalid = true;
  }

  if (isPlainObject(build)) {
    const planned = Array.isArray(build.imagePlan)
      ? build.imagePlan.map((entry) => entry?.filename).sort()
      : [];
    if (!sameStringArray(planned, [...manifestFilenames].sort())) invalid = true;
    const summary = build.assetSummary;
    if (
      !isPlainObject(summary) ||
      summary.allResolved !== assets.allResolved ||
      summary.requestCount !== assets.requestCount ||
      summary.successCount !== assets.successCount ||
      summary.fallbackCount !== assets.fallbackCount
    ) {
      invalid = true;
    }
  }
  if (invalid) findings.add("ARTIFACT_INVALID", assetsPath);
  return { valid: !invalid, derivedAllResolved };
}

function validateScreenshots({
  findings,
  cycle,
  cycleRoot,
  manifest,
  manifestPath,
  currentPaths,
  currentBuffers,
}) {
  if (!isPlainObject(manifest)) return;
  let invalid = manifest.cycle !== cycle || !isPlainObject(manifest.viewports);
  for (const [viewport, expectedPath] of Object.entries(SCREENSHOTS)) {
    const entry = manifest.viewports?.[viewport];
    if (
      !isPlainObject(entry) ||
      entry.path !== expectedPath ||
      !Number.isInteger(entry.width) ||
      entry.width <= 0 ||
      !Number.isInteger(entry.height) ||
      entry.height <= 0
    ) {
      invalid = true;
    }
    const relativePath = `${cycleRoot}/${expectedPath}`;
    if (!currentPaths.has(relativePath)) {
      findings.add("ARTIFACT_MISSING", relativePath);
    } else if (!hasPngSignature(currentBuffers.get(relativePath))) {
      findings.add("ARTIFACT_INVALID", relativePath);
    }
  }
  if (invalid) findings.add("ARTIFACT_INVALID", manifestPath);
}

function validateCriticScreenshots({
  findings,
  cycle,
  cycleRoot,
  manifest,
  manifestPath,
  currentPaths,
  currentBuffers,
}) {
  if (!isPlainObject(manifest)) return;
  let invalid =
    !sameStringArray(
      Object.keys(manifest).sort(),
      ["schemaVersion", "cycle", "capturedAt", "capture", "motionMode", "viewports"].sort(),
    ) ||
    manifest.schemaVersion !== "1.0" ||
    manifest.cycle !== cycle ||
    typeof manifest.capturedAt !== "string" ||
    !Number.isFinite(Date.parse(manifest.capturedAt)) ||
    manifest.capture !== "full-page" ||
    manifest.motionMode !== "reducedMotion" ||
    !isPlainObject(manifest.viewports) ||
    !sameStringArray(Object.keys(manifest.viewports || {}).sort(), [...EVIDENCE_VIEWPORTS].sort());

  for (const [viewport, expectedPath] of Object.entries(CRITIC_FULL_PAGE_SCREENSHOTS)) {
    const record = manifest.viewports?.[viewport];
    const dimensions = VIEWPORT_DIMENSIONS[viewport];
    if (
      !isPlainObject(record) ||
      !sameStringArray(
        Object.keys(record || {}).sort(),
        ["width", "renderedWidth", "height", "path", "bytes", "sha256"].sort(),
      ) ||
      record.width !== dimensions.width ||
      !Number.isSafeInteger(record.renderedWidth) ||
      record.renderedWidth < record.width ||
      !Number.isSafeInteger(record.height) ||
      record.height < dimensions.height ||
      record.path !== expectedPath ||
      !Number.isSafeInteger(record.bytes) ||
      record.bytes <= 0 ||
      !/^[a-f0-9]{64}$/.test(record.sha256 || "")
    ) {
      invalid = true;
    }
    const relativePath = `${cycleRoot}/${expectedPath}`;
    const value = currentBuffers.get(relativePath);
    if (!currentPaths.has(relativePath)) {
      findings.add("ARTIFACT_MISSING", relativePath);
    } else if (
      !value ||
      !hasPngSignature(value) ||
      value.length !== record?.bytes ||
      sha256(value) !== record?.sha256
    ) {
      findings.add("ARTIFACT_INVALID", relativePath);
      invalid = true;
    }
  }
  if (invalid) findings.add("ARTIFACT_INVALID", manifestPath);
}

function analyzeCritique({ critique, mechanical, assets }) {
  const lawAnalysis = analyzeLaws(critique);
  const dimensionAnalysis = analyzeDimensions(critique?.dimensions);
  const issuesValid =
    Array.isArray(critique?.issues) &&
    critique.issues.every(
      (issue) =>
        isPlainObject(issue) &&
        Number.isInteger(issue.priority) &&
        issue.priority >= 1 &&
        issue.priority <= 10 &&
        ["major", "medium", "minor"].includes(issue.severity) &&
        Object.hasOwn(DIMENSION_MAXIMUMS, issue.dimension) &&
        isNonempty(issue.evidence) &&
        isNonempty(issue.impact) &&
        isNonempty(issue.fix),
    );
  const hasMajorIssue =
    issuesValid && critique.issues.some((issue) => issue.severity === "major");
  const mechanicalPassed = isPlainObject(mechanical) ? mechanical.passed : null;
  const assetsResolved = isPlainObject(assets) ? assets.allResolved : null;
  const hardGateFailures = [];
  if (critique?.score < 85) hardGateFailures.push("score:below-threshold");
  if (hasMajorIssue) hardGateFailures.push("issues:major");
  if (mechanicalPassed !== true) hardGateFailures.push("mechanical:not-passed");
  if (assetsResolved !== true) hardGateFailures.push("assets:not-resolved");
  if (critique?.mode !== "vision") hardGateFailures.push("mode:not-vision");
  hardGateFailures.push(...lawAnalysis.failures);
  const shipEligible = hardGateFailures.length === 0;
  const valid =
    isPlainObject(critique) &&
    dimensionAnalysis.valid &&
    critique.score === dimensionAnalysis.score &&
    issuesValid &&
    lawAnalysis.valid &&
    critique.lawGatePassed === (lawAnalysis.failures.length === 0) &&
    sameStringArray(critique.lawGateFailures, lawAnalysis.failures) &&
    critique.mechanicalPassed === mechanicalPassed &&
    critique.assetsResolved === assetsResolved &&
    critique.hasMajorIssue === hasMajorIssue &&
    sameStringArray(critique.hardGateFailures, hardGateFailures) &&
    critique.shipEligible === shipEligible &&
    critique.verdict === (shipEligible ? "ship" : "revise");
  return {
    valid,
    dimensionValid:
      dimensionAnalysis.valid && critique?.score === dimensionAnalysis.score,
    lawsValid: lawAnalysis.valid,
    hardGateFailures,
    shipEligible,
  };
}

function analyzeDimensions(dimensions) {
  if (
    !isPlainObject(dimensions) ||
    !sameStringSet(
      new Set(Object.keys(dimensions)),
      new Set(Object.keys(DIMENSION_MAXIMUMS)),
    )
  ) {
    return { valid: false, score: null };
  }
  let score = 0;
  for (const [name, maximum] of Object.entries(DIMENSION_MAXIMUMS)) {
    const dimension = dimensions[name];
    if (
      !isPlainObject(dimension) ||
      !Number.isInteger(dimension.score) ||
      dimension.score < 0 ||
      dimension.score > maximum ||
      !isNonempty(dimension.evidence) ||
      !isNonempty(dimension.fix)
    ) {
      return { valid: false, score: null };
    }
    score += dimension.score;
  }
  return { valid: true, score };
}

function analyzeLaws(critique) {
  if (!isPlainObject(critique?.laws) || !isPlainObject(critique?.lawCoverage)) {
    return { valid: false, failures: [] };
  }
  let valid = true;
  const failures = [];
  for (const name of QUALITY_LAWS) {
    const law = critique.laws[name];
    const coverage = critique.lawCoverage[name];
    if (
      !isPlainObject(law) ||
      !["pass", "fail", "unverified"].includes(law.status) ||
      !Array.isArray(law.evidence) ||
      law.evidence.length === 0 ||
      !isNonempty(law.fix) ||
      !law.evidence.every(
        (entry) =>
          isPlainObject(entry) &&
          [...EVIDENCE_VIEWPORTS, "source"].includes(entry.viewport) &&
          isNonempty(entry.observation),
      ) ||
      !isPlainObject(coverage)
    ) {
      valid = false;
      continue;
    }
    const observed = EVIDENCE_VIEWPORTS.filter((viewport) =>
      law.evidence.some((entry) => entry.viewport === viewport),
    );
    const required = VIEWPORT_COVERAGE_LAWS.has(name)
      ? [...EVIDENCE_VIEWPORTS]
      : [];
    let missing = required.filter((viewport) => !observed.includes(viewport));
    let complete = missing.length === 0;
    if (critique.mode !== "vision" && VISUAL_LAWS.has(name)) {
      missing = [...EVIDENCE_VIEWPORTS];
      complete = false;
      if (
        law.status !== "unverified" ||
        coverage.reason !== "vision-evidence-unavailable"
      ) {
        valid = false;
      }
    } else if (!complete && law.status !== "unverified") {
      valid = false;
    }
    if (
      !sameStringArray(coverage.requiredViewports, required) ||
      !sameStringArray(coverage.observedViewports, observed) ||
      !sameStringArray(coverage.missingViewports, missing) ||
      coverage.complete !== complete
    ) {
      valid = false;
    }
    if (law.status !== "pass") failures.push(`law:${name}:${law.status}`);
  }
  return { valid, failures };
}

function validateSelectedEvidence({
  findings,
  slug,
  report,
  reportPath,
  deployment,
  deploymentPath,
  selected,
  summary,
  currentPaths,
  currentBuffers,
}) {
  const { mechanical, assets, build, critique } = selected;
  const mechanicalStates = [
    mechanical?.passed,
    critique?.mechanicalPassed,
    summary.mechanicalPassed,
  ];
  if (
    !mechanicalStates.every((value) => typeof value === "boolean") ||
    !allEqual(mechanicalStates) ||
    selected.mechanicalValid !== true
  ) {
    findings.add("SELECTED_MECHANICS_MISSING", selected.mechanicalPath);
  }

  const assetStates = [
    assets?.allResolved,
    build?.assetSummary?.allResolved,
    critique?.assetsResolved,
    summary.assetsResolved,
  ];
  if (Object.hasOwn(mechanical || {}, "assetsResolved")) {
    assetStates.push(mechanical.assetsResolved);
  }
  if (
    !assetStates.every((value) => typeof value === "boolean") ||
    !allEqual(assetStates) ||
    selected.assetValidation?.valid !== true ||
    selected.assetValidation?.derivedAllResolved !== assets?.allResolved
  ) {
    findings.add("SELECTED_ASSETS_MISSING", selected.assetsPath);
  }

  if (!validSelectedLaws(critique, summary)) {
    findings.add("SELECTED_LAWS_MISSING", selected.critiquePath);
  }

  if (
    !isPlainObject(critique) ||
    critique.mode !== "vision" ||
    !Number.isInteger(critique.score) ||
    critique.score < 0 ||
    critique.score > 100 ||
    selected.critiqueAnalysis?.dimensionValid !== true ||
    summary.mode !== critique.mode ||
    summary.score !== critique.score
  ) {
    findings.add("SELECTED_VISION_MISSING", selected.critiquePath);
  }

  const lawPassed =
    isPlainObject(critique?.laws) &&
    QUALITY_LAWS.every((name) => critique.laws[name]?.status === "pass");
  const expectedEligible = selected.critiqueAnalysis?.shipEligible === true;
  const expectedVerdict = expectedEligible ? "ship" : "revise";
  if (
    selected.critiqueAnalysis?.valid !== true ||
    typeof critique?.shipEligible !== "boolean" ||
    critique.shipEligible !== expectedEligible ||
    critique.verdict !== expectedVerdict ||
    summary.shipEligible !== critique.shipEligible ||
    summary.verdict !== critique.verdict ||
    !sameJson(summary.hardGateFailures, critique.hardGateFailures)
  ) {
    findings.add("REFERENCE_MISMATCH", reportPath);
  }

  const deploymentMatches = validateDeploymentEvidence({
    deployment,
    selected,
    critique,
    currentPaths,
    currentBuffers,
  });
  if (
    !isPlainObject(deployment) ||
    deployment.slug !== slug ||
    deployment.selectedCycle !== report.selectedCycle ||
    !deploymentMatches ||
    (deployment.mode !== "local" &&
      (critique?.shipEligible !== true || deployment.verified !== true)) ||
    (critique?.shipEligible !== true && deployment.mode !== "local")
  ) {
    findings.add("REFERENCE_MISMATCH", deploymentPath);
  }
  if (!sameJson(report.delivery, deployment)) {
    findings.add("REFERENCE_MISMATCH", reportPath);
  }
}

function validSelectedLaws(critique, summary) {
  const analysis = analyzeLaws(critique);
  return (
    analysis.valid &&
    critique.lawGatePassed === (analysis.failures.length === 0) &&
    sameStringArray(critique.lawGateFailures, analysis.failures) &&
    isPlainObject(summary?.laws) &&
    isPlainObject(summary?.lawCoverage) &&
    summary.lawGatePassed === critique.lawGatePassed &&
    sameJson(summary.laws, critique.laws) &&
    sameJson(summary.lawCoverage, critique.lawCoverage) &&
    sameJson(summary.lawGateFailures, critique.lawGateFailures)
  );
}

function validateDeploymentEvidence({
  deployment,
  selected,
  critique,
  currentPaths,
  currentBuffers,
}) {
  if (
    !isPlainObject(deployment) ||
    !["local", "cloudflare"].includes(deployment.mode) ||
    !Array.isArray(deployment.files)
  ) {
    return false;
  }
  const sitePrefix = `${selected.cycleRoot}/site/`;
  const expectedFiles = [...currentPaths]
    .filter((relativePath) => relativePath.startsWith(sitePrefix))
    .map((relativePath) => {
      const value = currentBuffers.get(relativePath);
      return {
        path: relativePath.slice(sitePrefix.length),
        bytes: value?.length,
        sha256: Buffer.isBuffer(value) ? sha256(value) : null,
      };
    })
    .sort((left, right) => compareText(left.path, right.path));
  if (
    expectedFiles.length === 0 ||
    deployment.files.length !== expectedFiles.length
  ) {
    return false;
  }
  for (let index = 0; index < expectedFiles.length; index += 1) {
    const expected = expectedFiles[index];
    const actual = deployment.files[index];
    if (
      !isPlainObject(actual) ||
      actual.path !== expected.path ||
      actual.bytes !== expected.bytes ||
      actual.sha256 !== expected.sha256 ||
      typeof actual.verified !== "boolean"
    ) {
      return false;
    }
  }
  if (deployment.aggregateSha256 !== aggregateSiteDigest(expectedFiles)) {
    return false;
  }
  if (deployment.mode === "cloudflare") {
    return (
      critique?.shipEligible === true &&
      deployment.verified === true &&
      isSuccessfulStatus(deployment.status) &&
      isPagesUrl(deployment.url) &&
      isPagesUrl(deployment.immutableUrl) &&
      deployment.files.every(
        (file) => file.verified === true && isSuccessfulStatus(file.status),
      )
    );
  }
  if (deployment.immutableUrl !== null || !isLocalUrlOrNull(deployment.url)) {
    return false;
  }
  if (deployment.verified === true) {
    return (
      isSuccessfulStatus(deployment.status) &&
      deployment.files.every(
        (file) => file.verified === true && isSuccessfulStatus(file.status),
      )
    );
  }
  return (
    deployment.verified === false &&
    deployment.status === null &&
    deployment.files.every(
      (file) => file.verified === false && file.status === null,
    )
  );
}

function aggregateSiteDigest(files) {
  const aggregate = createHash("sha256");
  for (const file of files) {
    aggregate.update(file.path, "utf8");
    aggregate.update("\0", "utf8");
    aggregate.update(String(file.bytes), "utf8");
    aggregate.update("\0", "utf8");
    aggregate.update(file.sha256, "utf8");
    aggregate.update("\n", "utf8");
  }
  return aggregate.digest("hex");
}

function isSuccessfulStatus(value) {
  return Number.isInteger(value) && value >= 200 && value < 400;
}

function isPagesUrl(value) {
  try {
    const target = new URL(value);
    return target.protocol === "https:" && target.hostname.endsWith(".pages.dev");
  } catch {
    return false;
  }
}

function isLocalUrlOrNull(value) {
  if (value === null) return true;
  try {
    const target = new URL(value);
    return (
      target.protocol === "http:" &&
      ["127.0.0.1", "localhost"].includes(target.hostname)
    );
  } catch {
    return false;
  }
}

function validateDocumentation({
  findings,
  expectedSlugs,
  currentPaths,
  currentBuffers,
}) {
  const referencedSlugs = new Set();
  const reports = new Map();
  for (const slug of expectedSlugs) {
    reports.set(
      slug,
      parseJsonBuffer(currentBuffers.get(`runs/${slug}/run-report.json`)),
    );
  }

  for (const documentPath of ["README.md", "DEMO.md"]) {
    if (!currentPaths.has(documentPath)) {
      findings.add("ARTIFACT_MISSING", documentPath);
      continue;
    }
    const text = decodeText(currentBuffers.get(documentPath));
    if (text === null) {
      findings.add("ARTIFACT_INVALID", documentPath);
      continue;
    }
    let invalid = false;
    const documentSlugs = new Set();
    for (const reference of extractRunReferences(text)) {
      const slug = reference.split("/")[1];
      referencedSlugs.add(slug);
      documentSlugs.add(slug);
      if (!expectedSlugs.includes(slug)) {
        invalid = true;
        continue;
      }
      const isDirectory = reference.endsWith("/");
      const exists = isDirectory
        ? [...currentPaths].some((relativePath) =>
            relativePath.startsWith(reference),
          )
        : currentPaths.has(reference);
      if (!exists) invalid = true;
    }
    if (documentPath === "README.md") {
      invalid = validateExampleTable(text, reports) === false || invalid;
    } else {
      invalid = validateDemoMetadata(text, reports) === false || invalid;
    }
    if (!expectedSlugs.every((slug) => documentSlugs.has(slug))) invalid = true;
    if (invalid) findings.add("DOC_REFERENCE_MISMATCH", documentPath);
  }
  if (!expectedSlugs.every((slug) => referencedSlugs.has(slug))) {
    findings.add("DOC_REFERENCE_MISMATCH", "README.md");
  }
}

function validateExampleTable(text, reports) {
  let valid = true;
  const seen = new Set();
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim().startsWith("|") || !line.includes("RUN-REPORT.md")) {
      continue;
    }
    const reference = extractRunReferences(line).find((value) =>
      value.endsWith("RUN-REPORT.md"),
    );
    if (!reference) continue;
    const slug = reference.split("/")[1];
    const report = reports.get(slug);
    seen.add(slug);
    const columns = line.split("|").map((value) => value.trim());
    if (!isPlainObject(report) || columns.length < 6) {
      valid = false;
      continue;
    }
    const scores = (columns[2].match(/\d+/g) || []).map(Number);
    const expectedScores = Array.isArray(report.cycles)
      ? report.cycles.map((cycle) => cycle?.score).filter(Number.isFinite)
      : [];
    const selectedCycle = Number.parseInt(columns[3], 10);
    const selected = report.cycles?.find(
      (cycle) => cycle?.cycle === report.selectedCycle,
    );
    if (
      !sameNumberArray(scores, expectedScores) ||
      selectedCycle !== report.selectedCycle ||
      columns[4].toLowerCase() !== String(selected?.verdict || "").toLowerCase()
    ) {
      valid = false;
    }
  }
  return valid && [...reports.keys()].every((slug) => seen.has(slug));
}

function validateDemoMetadata(text, reports) {
  const lines = text.split(/\r?\n/);
  for (const [slug, report] of reports) {
    if (!isPlainObject(report) || !Array.isArray(report.cycles)) return false;
    const line = lines.find((candidate) => candidate.includes(`runs/${slug}/`));
    if (!line) return false;
    const scoreMatch = /\bscores?\s*:\s*(\d+(?:\s+to\s+\d+)*)/i.exec(line);
    const selectedMatch = /\bselected\s+cycle\s*:\s*(\d+)/i.exec(line);
    const verdictMatch = /\bverdict\s*:\s*(ship|revise)\b/i.exec(line);
    const scores = scoreMatch
      ? scoreMatch[1].split(/\s+to\s+/i).map(Number)
      : [];
    const expectedScores = report.cycles
      .map((cycle) => cycle?.score)
      .filter(Number.isFinite);
    const selected = report.cycles.find(
      (cycle) => cycle?.cycle === report.selectedCycle,
    );
    if (
      !sameNumberArray(scores, expectedScores) ||
      Number.parseInt(selectedMatch?.[1], 10) !== report.selectedCycle ||
      verdictMatch?.[1].toLowerCase() !== String(selected?.verdict || "").toLowerCase()
    ) {
      return false;
    }
  }
  return true;
}

function readJsonArtifact({
  findings,
  relativePath,
  currentPaths,
  currentBuffers,
}) {
  if (!currentPaths.has(relativePath)) {
    findings.add("ARTIFACT_MISSING", relativePath);
    return null;
  }
  const value = parseJsonBuffer(currentBuffers.get(relativePath));
  if (!isPlainObject(value)) {
    findings.add("ARTIFACT_INVALID", relativePath);
    return null;
  }
  return value;
}

function requireNonemptyText({
  findings,
  relativePath,
  currentPaths,
  currentBuffers,
}) {
  if (!currentPaths.has(relativePath)) {
    findings.add("ARTIFACT_MISSING", relativePath);
    return;
  }
  const text = decodeText(currentBuffers.get(relativePath));
  if (text === null || text.trim().length === 0) {
    findings.add("ARTIFACT_INVALID", relativePath);
  }
}

function applyTrackedPathRules(findings, relativePath) {
  const normalized = normalizeRelativePath(relativePath);
  const basename = normalized.split("/").at(-1);
  if (
    (basename === ENV_FILE || basename.startsWith(`${ENV_FILE}.`)) &&
    basename !== ENV_EXAMPLE_FILE
  ) {
    findings.add("ENV_TRACKED", normalized);
  }
  if (isForbiddenTrackedPath(normalized)) {
    findings.add("FORBIDDEN_TRACKED_PATH", normalized);
  }
}

function scanContent(
  findings,
  relativePath,
  value,
  { suppressAbsoluteMachinePath = false } = {},
) {
  const text = decodeText(value);
  if (text === null) return;
  if (hasSecretAssignment(text)) {
    findings.add("SECRET_ASSIGNMENT", relativePath);
  }
  if (
    !suppressAbsoluteMachinePath &&
    (WINDOWS_MACHINE_PATH.test(text) ||
      UNC_MACHINE_PATH.test(text) ||
      POSIX_MACHINE_PATH.test(text))
  ) {
    findings.add("ABSOLUTE_MACHINE_PATH", relativePath);
  }
  const lower = text.toLowerCase();
  if (CONFIDENTIAL_TERMS.some((term) => lower.includes(term))) {
    findings.add("CONFIDENTIAL_SOURCE_TERM", relativePath);
  }
}

function isAttestedHistoricalAbsolutePath({ relativePath, object, value }) {
  if (!Buffer.isBuffer(value)) return false;
  const sha256 = createHash("sha256").update(value).digest("hex");
  return HISTORICAL_ABSOLUTE_PATH_ATTESTATIONS.has(
    historicalAttestationKey(relativePath, object, sha256, value.length),
  );
}

function historicalAttestationKey(relativePath, object, sha256, bytes) {
  return `${relativePath}\0${object}\0${sha256}\0${bytes}`;
}

function hasSecretAssignment(text) {
  QUOTED_SECRET_ASSIGNMENT.lastIndex = 0;
  for (const match of text.matchAll(QUOTED_SECRET_ASSIGNMENT)) {
    if (unsafeSecretValue(match[2])) return true;
  }
  UNQUOTED_SECRET_ASSIGNMENT.lastIndex = 0;
  for (const match of text.matchAll(UNQUOTED_SECRET_ASSIGNMENT)) {
    if (unsafeSecretValue(match[1])) return true;
  }
  return RAW_SECRET_PATTERNS.some((pattern) => pattern.test(text));
}

function unsafeSecretValue(candidate) {
  const value = String(candidate || "").trim();
  if (!value) return false;
  const lower = value.toLowerCase();
  if (
    lower === "null" ||
    lower === "undefined" ||
    lower.startsWith("process.env") ||
    lower.startsWith("import.meta.env") ||
    lower.startsWith("env.") ||
    lower.startsWith("${") ||
    lower.startsWith("<") ||
    lower.startsWith("test-") ||
    lower.startsWith("fake-") ||
    lower.startsWith("dummy-") ||
    lower.includes("not-real") ||
    lower.includes("placeholder") ||
    lower.startsWith("your-")
  ) {
    return false;
  }
  return value.length >= 8;
}

function invalidEnvironmentExample(value) {
  const text = decodeText(value);
  if (text === null) return true;
  return text.split(/\r?\n/).some((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return false;
    const assignment = /^(?:export[^\S\r\n]+)?([A-Za-z_][A-Za-z0-9_]*)[^\S\r\n]*=[^\S\r\n]*(.*)$/.exec(
      trimmed,
    );
    if (!assignment) return true;
    const [, name, candidate] = assignment;
    if (!SECRET_ENV_NAME.test(name)) return false;
    return candidate.trim().length > 0 && !candidate.trim().startsWith("#");
  });
}

function isForbiddenTrackedPath(relativePath) {
  const segments = relativePath.toLowerCase().split("/");
  if (segments.some((segment) => FORBIDDEN_SEGMENTS.has(segment))) return true;
  if (/^runs\/[^/]+\/current(?:\/|$)/.test(relativePath)) return true;
  if (/^runs\/[^/]+\/serve\.json$/.test(relativePath)) return true;
  return relativePath.toLowerCase().endsWith(".log");
}

function createGitRunner({ root, adapter }) {
  return async (args, options = {}) => {
    let result;
    try {
      if (typeof adapter === "function") {
        result = await adapter(args, { cwd: root, input: options.input });
      } else if (adapter && typeof adapter.run === "function") {
        result = await adapter.run(args, { cwd: root, input: options.input });
      } else if (adapter === undefined) {
        result = await spawnGit(args, { cwd: root, input: options.input });
      } else {
        throw new Error("Invalid Git adapter.");
      }
    } catch {
      throw new Error("Git operation failed.");
    }
    if (result && typeof result === "object" && !Buffer.isBuffer(result)) {
      if (
        (Number.isInteger(result.exitCode) && result.exitCode !== 0) ||
        (Number.isInteger(result.code) && result.code !== 0)
      ) {
        throw new Error("Git operation failed.");
      }
      result = result.stdout ?? Buffer.alloc(0);
    }
    if (Buffer.isBuffer(result)) return result;
    if (typeof result === "string") return Buffer.from(result, "utf8");
    throw new Error("Git operation failed.");
  };
}

function spawnGit(args, { cwd, input } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, {
      cwd,
      windowsHide: true,
      stdio: ["pipe", "pipe", "ignore"],
    });
    const stdout = [];
    let bytes = 0;
    let failed = false;
    child.stdout.on("data", (chunk) => {
      bytes += chunk.length;
      if (bytes > 128 * 1024 * 1024) {
        failed = true;
        child.kill();
        return;
      }
      stdout.push(chunk);
    });
    child.on("error", () => reject(new Error("Git operation failed.")));
    child.on("close", (code) => {
      if (failed || code !== 0) {
        reject(new Error("Git operation failed."));
        return;
      }
      resolve(Buffer.concat(stdout));
    });
    child.stdin.end(input);
  });
}

async function readBlobs(runGit, objectIds) {
  const blobs = new Map();
  if (objectIds.length === 0) return blobs;
  const output = await runGit(["cat-file", "--batch"], {
    input: `${objectIds.join("\n")}\n`,
  });
  let offset = 0;
  for (const object of objectIds) {
    const headerEnd = output.indexOf(10, offset);
    if (headerEnd < 0) throw new Error("History object unavailable.");
    const header = output.subarray(offset, headerEnd).toString("ascii");
    const parts = header.split(" ");
    const size = Number.parseInt(parts.at(-1), 10);
    if (parts[1] !== "blob" || !Number.isInteger(size) || size < 0) {
      throw new Error("History object unavailable.");
    }
    const start = headerEnd + 1;
    const end = start + size;
    if (end > output.length) throw new Error("History object unavailable.");
    blobs.set(object, output.subarray(start, end));
    offset = end + 1;
  }
  return blobs;
}

function parseTreeEntries(value) {
  return value
    .toString("utf8")
    .split("\0")
    .filter(Boolean)
    .map((entry) => {
      const match = /^(\d+) ([a-z]+) ([a-f0-9]+)\t([\s\S]+)$/.exec(entry);
      if (!match) throw new Error("History tree unavailable.");
      return {
        mode: match[1],
        type: match[2],
        object: match[3],
        path: normalizeRelativePath(match[4]),
      };
    });
}

function parseNulPaths(value) {
  return value
    .toString("utf8")
    .split("\0")
    .filter(Boolean)
    .map(normalizeRelativePath);
}

async function readWorkingFile(root, relativePath) {
  const fullPath = resolveOwnedPath(root, relativePath);
  let stat;
  try {
    stat = await lstat(fullPath);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
  if (stat.isSymbolicLink()) {
    return Buffer.from(await readlink(fullPath), "utf8");
  }
  if (!stat.isFile()) return Buffer.alloc(0);
  return readFile(fullPath);
}

function resolveOwnedPath(root, relativePath) {
  const resolved = path.resolve(root, ...relativePath.split("/"));
  const prefix = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
  if (resolved !== root && !resolved.startsWith(prefix)) {
    throw new Error("Path outside repository.");
  }
  return resolved;
}

function extractRunReferences(text) {
  const matches = text.match(/runs\/[a-z0-9][a-z0-9._-]*(?:\/[a-z0-9][a-z0-9._-]*)*\/?/gi) || [];
  return matches.map((value) => value.replace(/[.,;:]+$/, ""));
}

function parseJsonBuffer(value) {
  const text = decodeText(value);
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function decodeText(value) {
  if (!Buffer.isBuffer(value)) return null;
  if (hasPngSignature(value)) return null;
  if (value.length >= 2 && value[0] === 0xff && value[1] === 0xfe) {
    return value.subarray(2).toString("utf16le");
  }
  if (value.length >= 2 && value[0] === 0xfe && value[1] === 0xff) {
    const swapped = Buffer.from(value.subarray(2));
    swapped.swap16();
    return swapped.toString("utf16le");
  }
  if (value.includes(0)) return null;
  return value.toString("utf8").replace(/^\uFEFF/, "");
}

function normalizeExpectedSlugs(expectedSlugs) {
  if (
    !Array.isArray(expectedSlugs) ||
    expectedSlugs.length === 0 ||
    !expectedSlugs.every(
      (slug) => typeof slug === "string" && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug),
    ) ||
    new Set(expectedSlugs).size !== expectedSlugs.length
  ) {
    throw new TypeError("Expected slugs are invalid.");
  }
  return [...expectedSlugs];
}

function normalizeRelativePath(relativePath) {
  const value = String(relativePath || "")
    .replaceAll("\\", "/")
    .replace(/^\.\//, "");
  const normalized = path.posix.normalize(value);
  if (
    !normalized ||
    normalized === "." ||
    normalized === ".." ||
    normalized.startsWith("../") ||
    normalized.startsWith("/") ||
    /^[a-z]:\//i.test(normalized)
  ) {
    throw new Error("Repository path is invalid.");
  }
  return normalized;
}

function safeFindingPath(relativePath) {
  let value = String(relativePath || ".")
    .replace(/[\u0000-\u001f\u007f]/g, "_")
    .replaceAll("\\", "/")
    .replace(/^\.\//, "");
  if (value.startsWith("/") || /^[a-z]:\//i.test(value)) return ".";
  value = path.posix.normalize(value);
  if (!value || value === ".." || value.startsWith("../")) return ".";
  return value;
}

function compareFindings(left, right) {
  return compareText(left.rule, right.rule) || compareText(left.path, right.path);
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function selectExpectedCycle(cycles) {
  const scored = cycles.filter(
    (cycle) => Number.isInteger(cycle.cycle) && Number.isFinite(cycle.score),
  );
  const eligible = scored.filter((cycle) => cycle.shipEligible === true);
  const mechanicallySafe = scored.filter(
    (cycle) => cycle.mechanicalPassed === true,
  );
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
  })[0]?.cycle ?? null;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNonempty(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function validFocalPoint(value) {
  return (
    isPlainObject(value) &&
    Number.isFinite(value.x) &&
    value.x >= 0 &&
    value.x <= 1 &&
    Number.isFinite(value.y) &&
    value.y >= 0 &&
    value.y <= 1
  );
}

function hasPngSignature(value) {
  return (
    Buffer.isBuffer(value) &&
    value.length > PNG_SIGNATURE.length &&
    value.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)
  );
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function allEqual(values) {
  return values.every((value) => Object.is(value, values[0]));
}

function sameStringSet(left, right) {
  return left.size === right.size && [...left].every((value) => right.has(value));
}

function sameStringArray(left, right) {
  return (
    Array.isArray(left) &&
    Array.isArray(right) &&
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function sameNumberArray(left, right) {
  return (
    Array.isArray(left) &&
    Array.isArray(right) &&
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function sameJson(left, right) {
  return isDeepStrictEqual(left, right);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

if (process.argv[1] && path.resolve(process.argv[1]) === MODULE_PATH) {
  try {
    const result = await checkRelease();
    if (!result.ok) {
      process.stdout.write(`${formatFindings(result.findings)}\n`);
      process.exitCode = 1;
    }
  } catch {
    process.stderr.write("RELEASE_INTERNAL .\n");
    process.exitCode = 1;
  }
}
