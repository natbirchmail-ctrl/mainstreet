import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  QUALITY_LAWS,
  VISUAL_LAWS,
  deriveCritiqueOutcome,
  normalizeModelCritique,
} from "../../src/critic-policy.js";

const completeViewports = ["desktop", "tablet", "phone"];

test("normalization preserves dimension scoring and derives a fully eligible ship outcome", () => {
  const normalized = normalizeModelCritique(modelCritique());
  assert.equal(normalized.score, 92);
  assert.equal(normalized.lawGatePassed, true);
  assert.deepEqual(normalized.lawGateFailures, []);

  const outcome = deriveCritiqueOutcome(normalized, {
    mechanicalPassed: true,
    assetsResolved: true,
    mode: "vision",
  });

  assert.equal(outcome.score, 92);
  assert.equal(outcome.shipEligible, true);
  assert.equal(outcome.verdict, "ship");
  assert.deepEqual(outcome.hardGateFailures, []);
});

test("a high score stays revise when a law fails, a law is unverified, or a major issue exists", () => {
  const normalized = normalizeModelCritique(
    modelCritique({
      issues: [majorIssue()],
      laws: {
        headlineDiscipline: law("fail"),
        foldComposition: law("unverified"),
      },
    }),
  );
  const outcome = deriveCritiqueOutcome(normalized, {
    mechanicalPassed: true,
    assetsResolved: true,
    mode: "vision",
  });

  assert.equal(outcome.score, 92);
  assert.equal(outcome.lawGatePassed, false);
  assert.deepEqual(outcome.lawGateFailures, [
    "law:headlineDiscipline:fail",
    "law:foldComposition:unverified",
  ]);
  assert.equal(outcome.shipEligible, false);
  assert.equal(outcome.verdict, "revise");
  assert.deepEqual(outcome.hardGateFailures, [
    "issues:major",
    "law:headlineDiscipline:fail",
    "law:foldComposition:unverified",
  ]);
});

test("a high score with complete passing laws still revises for a major issue", () => {
  const outcome = deriveCritiqueOutcome(
    normalizeModelCritique(modelCritique({ issues: [majorIssue()] })),
    {
      mechanicalPassed: true,
      assetsResolved: true,
      mode: "vision",
    },
  );

  assert.equal(outcome.score, 92);
  assert.equal(outcome.lawGatePassed, true);
  assert.equal(outcome.shipEligible, false);
  assert.equal(outcome.verdict, "revise");
  assert.deepEqual(outcome.hardGateFailures, ["issues:major"]);
});

test("visual laws without desktop tablet and phone coverage normalize to unverified", () => {
  const normalized = normalizeModelCritique(
    modelCritique({
      laws: {
        foldComposition: law("pass", ["desktop", "tablet"]),
      },
    }),
  );

  assert.equal(normalized.laws.foldComposition.status, "unverified");
  assert.deepEqual(normalized.lawCoverage.foldComposition.observedViewports, [
    "desktop",
    "tablet",
  ]);
  assert.deepEqual(normalized.lawCoverage.foldComposition.missingViewports, ["phone"]);
  assert.equal(normalized.lawCoverage.foldComposition.complete, false);
  assert.deepEqual(normalized.lawGateFailures, ["law:foldComposition:unverified"]);
});

test("source fallback forces visual laws unverified and can never ship", () => {
  const outcome = deriveCritiqueOutcome(normalizeModelCritique(modelCritique()), {
    mechanicalPassed: true,
    assetsResolved: true,
    mode: "source-fallback",
  });

  for (const name of VISUAL_LAWS) {
    assert.equal(outcome.laws[name].status, "unverified");
    assert.ok(outcome.lawGateFailures.includes(`law:${name}:unverified`));
    assert.deepEqual(outcome.lawCoverage[name].observedViewports, []);
    assert.deepEqual(outcome.lawCoverage[name].missingViewports, completeViewports);
  }
  assert.equal(outcome.shipEligible, false);
  assert.equal(outcome.verdict, "revise");
  assert.ok(outcome.hardGateFailures.includes("mode:not-vision"));
});

test("omitted or null law evidence is unsafe", () => {
  const omitted = modelCritique();
  delete omitted.laws.imageContrast.evidence;
  assert.throws(
    () => normalizeModelCritique(omitted),
    /imageContrast law/i,
  );

  const nullable = modelCritique();
  nullable.laws.motionRestraint.evidence = null;
  assert.throws(
    () => normalizeModelCritique(nullable),
    /motionRestraint evidence/i,
  );
});

test("null mechanical and asset evidence fail closed while preserving the visual score", () => {
  const outcome = deriveCritiqueOutcome(normalizeModelCritique(modelCritique()), {
    mechanicalPassed: null,
    assetsResolved: null,
    mode: "vision",
  });

  assert.equal(outcome.score, 92);
  assert.equal(outcome.mechanicalPassed, null);
  assert.equal(outcome.assetsResolved, null);
  assert.equal(outcome.shipEligible, false);
  assert.deepEqual(outcome.hardGateFailures, [
    "mechanical:not-passed",
    "assets:not-resolved",
  ]);
});

test("strict critique schema requires all eight laws and viewport tagged evidence", async () => {
  const schema = JSON.parse(
    await readFile(
      new URL("../../prompts/schemas/critique.schema.json", import.meta.url),
      "utf8",
    ),
  );

  assert.ok(schema.required.includes("laws"));
  assert.deepEqual(schema.properties.laws.required, QUALITY_LAWS);
  assert.deepEqual(schema.$defs.law.required, ["status", "evidence", "fix"]);
  assert.deepEqual(schema.$defs.lawEvidence.required, ["viewport", "observation"]);
  assert.equal(schema.$defs.law.additionalProperties, false);
  assert.equal(schema.$defs.lawEvidence.additionalProperties, false);
});

function modelCritique({ issues = [], laws = {} } = {}) {
  return {
    rubricVersion: "1.0",
    summary: "A composed page with clear hierarchy and grounded details.",
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
    strengths: ["The composition gives the business a distinct point of view."],
    issues,
    laws: Object.fromEntries(
      QUALITY_LAWS.map((name) => [name, laws[name] || law("pass")]),
    ),
    revisionBrief: {
      mustFix: [],
      preserve: ["Preserve the strongest compositional decision."],
    },
  };
}

function dimension(score) {
  return {
    score,
    evidence: "The rendered evidence supports this score.",
    fix: "Preserve the working choice and refine only if another gate requires it.",
  };
}

function law(status, viewports = completeViewports) {
  return {
    status,
    evidence: viewports.map((viewport) => ({
      viewport,
      observation: `${viewport} provides concrete evidence for this law.`,
    })),
    fix: "Make the smallest concrete revision needed to satisfy this law.",
  };
}

function majorIssue() {
  return {
    priority: 1,
    severity: "major",
    dimension: "layout",
    evidence: "The primary composition loses its subject.",
    impact: "The first impression is unclear.",
    fix: "Recompose the first fold around one dominant subject.",
  };
}
