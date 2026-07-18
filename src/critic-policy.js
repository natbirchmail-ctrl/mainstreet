export const QUALITY_LAWS = Object.freeze([
  "headlineDiscipline",
  "foldComposition",
  "completeLayouts",
  "firstBeatVisibility",
  "imageContrast",
  "motionRestraint",
  "imageryCoherence",
  "factualRestraint",
]);

export const VISUAL_LAWS = Object.freeze([
  "foldComposition",
  "firstBeatVisibility",
  "imageContrast",
  "motionRestraint",
  "imageryCoherence",
]);

const VIEWPORT_COVERAGE_LAWS = Object.freeze([
  "foldComposition",
  "firstBeatVisibility",
  "imageContrast",
  "imageryCoherence",
]);
const VIEWPORTS = Object.freeze(["desktop", "tablet", "phone"]);
const EVIDENCE_VIEWPORTS = new Set([...VIEWPORTS, "source"]);
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
const DIMENSIONS = Object.freeze(Object.keys(DIMENSION_MAXIMUMS));
const TOP_LEVEL_FIELDS = Object.freeze([
  "rubricVersion",
  "summary",
  "dimensions",
  "strengths",
  "issues",
  "laws",
  "revisionBrief",
]);

export function normalizeModelCritique(candidate) {
  assertPlainObject(candidate, "Critique");
  assertExactKeys(candidate, TOP_LEVEL_FIELDS, "Critique");
  if (candidate.rubricVersion !== "1.0") {
    throw new TypeError("Critique has an invalid rubric version.");
  }
  assertNonemptyString(candidate.summary, "Critique summary");

  const dimensions = normalizeDimensions(candidate.dimensions);
  const issues = normalizeIssues(candidate.issues);
  const strengths = normalizeStringArray(candidate.strengths, {
    label: "Critique strengths",
    minimum: 1,
    maximum: 5,
  });
  const revisionBrief = normalizeRevisionBrief(candidate.revisionBrief);
  const { laws, lawCoverage } = normalizeLaws(candidate.laws);
  const lawGateFailures = collectLawGateFailures(laws);

  return {
    rubricVersion: "1.0",
    summary: candidate.summary.trim(),
    dimensions,
    strengths,
    issues,
    laws,
    revisionBrief,
    score: DIMENSIONS.reduce(
      (total, name) => total + dimensions[name].score,
      0,
    ),
    lawCoverage,
    lawGatePassed: lawGateFailures.length === 0,
    lawGateFailures,
  };
}

export function deriveCritiqueOutcome(
  normalized,
  { mechanicalPassed, assetsResolved, mode } = {},
) {
  assertNormalizedCritique(normalized);

  const resolvedMode = typeof mode === "string" && mode.trim() ? mode : "unavailable";
  const laws = cloneRecord(normalized.laws);
  const lawCoverage = cloneRecord(normalized.lawCoverage);
  if (resolvedMode !== "vision") {
    for (const name of VISUAL_LAWS) {
      laws[name] = { ...laws[name], status: "unverified" };
      lawCoverage[name] = {
        ...lawCoverage[name],
        observedViewports: [],
        missingViewports: [...VIEWPORTS],
        complete: false,
        reason: "vision-evidence-unavailable",
      };
    }
  }

  const lawGateFailures = collectLawGateFailures(laws);
  const mechanicalState = booleanOrNull(mechanicalPassed);
  const assetState = booleanOrNull(assetsResolved);
  const hasMajorIssue = normalized.issues.some((issue) => issue.severity === "major");
  const hardGateFailures = [];

  if (normalized.score < 85) hardGateFailures.push("score:below-threshold");
  if (hasMajorIssue) hardGateFailures.push("issues:major");
  if (mechanicalState !== true) hardGateFailures.push("mechanical:not-passed");
  if (assetState !== true) hardGateFailures.push("assets:not-resolved");
  if (resolvedMode !== "vision") hardGateFailures.push("mode:not-vision");
  hardGateFailures.push(...lawGateFailures);

  const shipEligible = hardGateFailures.length === 0;
  return {
    ...normalized,
    laws,
    lawCoverage,
    lawGatePassed: lawGateFailures.length === 0,
    lawGateFailures,
    mechanicalPassed: mechanicalState,
    assetsResolved: assetState,
    mode: resolvedMode,
    hasMajorIssue,
    hardGateFailures,
    shipEligible,
    verdict: shipEligible ? "ship" : "revise",
  };
}

function normalizeDimensions(candidate) {
  assertPlainObject(candidate, "Critique dimensions");
  assertExactKeys(candidate, DIMENSIONS, "Critique dimensions");
  const dimensions = {};
  for (const [name, maximum] of Object.entries(DIMENSION_MAXIMUMS)) {
    const dimension = candidate[name];
    assertPlainObject(dimension, `Critique ${name} dimension`);
    assertExactKeys(dimension, ["score", "evidence", "fix"], `Critique ${name} dimension`);
    if (
      !Number.isInteger(dimension.score) ||
      dimension.score < 0 ||
      dimension.score > maximum
    ) {
      throw new TypeError(`Critique has an invalid ${name} score.`);
    }
    assertNonemptyString(dimension.evidence, `Critique ${name} evidence`);
    assertNonemptyString(dimension.fix, `Critique ${name} fix`);
    dimensions[name] = {
      score: dimension.score,
      evidence: dimension.evidence.trim(),
      fix: dimension.fix.trim(),
    };
  }
  return dimensions;
}

function normalizeIssues(candidate) {
  if (!Array.isArray(candidate) || candidate.length > 10) {
    throw new TypeError("Critique issues must be an array with no more than ten entries.");
  }
  const issues = candidate.map((issue, index) => {
    assertPlainObject(issue, `Critique issue ${index + 1}`);
    assertExactKeys(
      issue,
      ["priority", "severity", "dimension", "evidence", "impact", "fix"],
      `Critique issue ${index + 1}`,
    );
    if (!Number.isInteger(issue.priority) || issue.priority < 1 || issue.priority > 10) {
      throw new TypeError(`Critique issue ${index + 1} has an invalid priority.`);
    }
    if (!["major", "medium", "minor"].includes(issue.severity)) {
      throw new TypeError(`Critique issue ${index + 1} has an invalid severity.`);
    }
    if (!DIMENSIONS.includes(issue.dimension)) {
      throw new TypeError(`Critique issue ${index + 1} has an invalid dimension.`);
    }
    for (const field of ["evidence", "impact", "fix"]) {
      assertNonemptyString(issue[field], `Critique issue ${index + 1} ${field}`);
    }
    return {
      priority: issue.priority,
      severity: issue.severity,
      dimension: issue.dimension,
      evidence: issue.evidence.trim(),
      impact: issue.impact.trim(),
      fix: issue.fix.trim(),
      sourceIndex: index,
    };
  });

  return issues
    .sort(
      (left, right) =>
        left.priority - right.priority || left.sourceIndex - right.sourceIndex,
    )
    .map(({ sourceIndex, ...issue }) => issue);
}

function normalizeRevisionBrief(candidate) {
  assertPlainObject(candidate, "Critique revision brief");
  assertExactKeys(candidate, ["mustFix", "preserve"], "Critique revision brief");
  return {
    mustFix: normalizeStringArray(candidate.mustFix, {
      label: "Critique must fix list",
      maximum: 6,
    }),
    preserve: normalizeStringArray(candidate.preserve, {
      label: "Critique preserve list",
      maximum: 6,
    }),
  };
}

function normalizeLaws(candidate) {
  assertPlainObject(candidate, "Critique laws");
  assertExactKeys(candidate, QUALITY_LAWS, "Critique laws");
  const laws = {};
  const lawCoverage = {};

  for (const name of QUALITY_LAWS) {
    const law = candidate[name];
    assertPlainObject(law, `Critique ${name} law`);
    assertExactKeys(law, ["status", "evidence", "fix"], `Critique ${name} law`);
    if (!["pass", "fail", "unverified"].includes(law.status)) {
      throw new TypeError(`Critique ${name} has an invalid status.`);
    }
    if (!Array.isArray(law.evidence) || law.evidence.length === 0) {
      throw new TypeError(`Critique ${name} evidence must be a nonempty array.`);
    }
    assertNonemptyString(law.fix, `Critique ${name} fix`);

    const evidence = law.evidence.map((entry, index) => {
      assertPlainObject(entry, `Critique ${name} evidence ${index + 1}`);
      assertExactKeys(
        entry,
        ["viewport", "observation"],
        `Critique ${name} evidence ${index + 1}`,
      );
      if (!EVIDENCE_VIEWPORTS.has(entry.viewport)) {
        throw new TypeError(`Critique ${name} evidence has an invalid viewport.`);
      }
      assertNonemptyString(
        entry.observation,
        `Critique ${name} evidence observation`,
      );
      return {
        viewport: entry.viewport,
        observation: entry.observation.trim(),
      };
    });

    const observedViewports = VIEWPORTS.filter((viewport) =>
      evidence.some((entry) => entry.viewport === viewport),
    );
    const requiredViewports = VIEWPORT_COVERAGE_LAWS.includes(name)
      ? [...VIEWPORTS]
      : [];
    const missingViewports = requiredViewports.filter(
      (viewport) => !observedViewports.includes(viewport),
    );
    const complete = missingViewports.length === 0;
    laws[name] = {
      status: complete ? law.status : "unverified",
      evidence,
      fix: law.fix.trim(),
    };
    lawCoverage[name] = {
      requiredViewports,
      observedViewports,
      missingViewports,
      complete,
    };
  }

  return { laws, lawCoverage };
}

function collectLawGateFailures(laws) {
  return QUALITY_LAWS.flatMap((name) =>
    laws[name].status === "pass" ? [] : [`law:${name}:${laws[name].status}`],
  );
}

function normalizeStringArray(candidate, { label, minimum = 0, maximum }) {
  if (
    !Array.isArray(candidate) ||
    candidate.length < minimum ||
    candidate.length > maximum
  ) {
    throw new TypeError(`${label} has an invalid number of entries.`);
  }
  return candidate.map((entry, index) => {
    assertNonemptyString(entry, `${label} entry ${index + 1}`);
    return entry.trim();
  });
}

function assertNormalizedCritique(candidate) {
  assertPlainObject(candidate, "Normalized critique");
  if (!Number.isInteger(candidate.score) || candidate.score < 0 || candidate.score > 100) {
    throw new TypeError("Normalized critique has an invalid score.");
  }
  if (!Array.isArray(candidate.issues)) {
    throw new TypeError("Normalized critique is missing issues.");
  }
  assertPlainObject(candidate.laws, "Normalized critique laws");
  assertPlainObject(candidate.lawCoverage, "Normalized critique law coverage");
  for (const name of QUALITY_LAWS) {
    if (!candidate.laws[name] || !candidate.lawCoverage[name]) {
      throw new TypeError(`Normalized critique is missing ${name}.`);
    }
  }
}

function assertPlainObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
}

function assertExactKeys(value, expected, label) {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (
    actual.length !== wanted.length ||
    actual.some((key, index) => key !== wanted[index])
  ) {
    throw new TypeError(`${label} has missing or unknown fields.`);
  }
}

function assertNonemptyString(value, label) {
  if (typeof value !== "string" || !value.trim()) {
    throw new TypeError(`${label} must be a nonempty string.`);
  }
}

function booleanOrNull(value) {
  if (value === true) return true;
  if (value === false) return false;
  return null;
}

function cloneRecord(value) {
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      {
        ...entry,
        ...(Array.isArray(entry.evidence)
          ? { evidence: entry.evidence.map((item) => ({ ...item })) }
          : {}),
        ...(Array.isArray(entry.requiredViewports)
          ? { requiredViewports: [...entry.requiredViewports] }
          : {}),
        ...(Array.isArray(entry.observedViewports)
          ? { observedViewports: [...entry.observedViewports] }
          : {}),
        ...(Array.isArray(entry.missingViewports)
          ? { missingViewports: [...entry.missingViewports] }
          : {}),
      },
    ]),
  );
}
