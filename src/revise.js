import { readFile } from "node:fs/promises";

import {
  createOwnedMotionStyles,
  hydrateSiteManifest,
  validateSiteManifest,
  writeSiteFiles,
} from "./build.js";
import { materializeAssets } from "./assets.js";
import { requestImage, requestStructured } from "./lib/openai.js";
import { resolveInside, writeJsonNew } from "./lib/runs.js";

const projectRoot = new URL("../", import.meta.url);
const promptUrl = new URL("prompts/revise-system.md", projectRoot);
const schemaUrl = new URL("prompts/schemas/site.schema.json", projectRoot);

export async function reviseSite({
  brief,
  currentManifest,
  critique,
  mechanical,
  availableAssets,
  model = process.env.OPENAI_MODEL || "gpt-5.6",
  client,
  structuredRequester = requestStructured,
}) {
  if (!brief?.business?.name || !currentManifest?.indexHtml || !critique?.issues) {
    throw new TypeError("Brief, current site, and critique are required for revision.");
  }
  validateSiteManifest(currentManifest);

  const [systemPrompt, schema] = await Promise.all([
    readFile(promptUrl, "utf8"),
    readFile(schemaUrl, "utf8").then(JSON.parse),
  ]);
  let lastValidationError;

  for (let revisionAttempt = 1; revisionAttempt <= 2; revisionAttempt += 1) {
    const candidate = await structuredRequester({
      client,
      model,
      schema,
      schemaName: "mainstreet_revision",
      systemPrompt,
      userPayload: {
        brief,
        currentSite: {
          indexHtml: currentManifest.indexHtml,
          stylesCss: stripOwnedMotionStyles(currentManifest),
          scriptJs: currentManifest.scriptJs,
          imagePlan: currentManifest.imagePlan,
          designNotes: currentManifest.designNotes,
          availableAssets: sanitizeAvailableAssets(availableAssets),
        },
        critique,
        mechanical,
        revisionAttempt,
        repairInstruction:
          revisionAttempt === 2
            ? "The first revision failed a deterministic safety or completeness check. Replace it with a clean revision that obeys every constraint."
            : null,
      },
      maxOutputTokens: 24_000,
    });

    try {
      const hydrated = hydrateSiteManifest(candidate);
      return { ...hydrated, source: "openai-revision" };
    } catch (error) {
      lastValidationError = error;
    }
  }

  throw lastValidationError || new Error("No valid revision was produced.");
}

export async function reviseRun({
  runDir,
  fromCycle,
  reviseSiteFn = reviseSite,
  assetMaterializerFn = materializeAssets,
  imageRequesterFn = requestImage,
  client,
  model = process.env.OPENAI_IMAGE_MODEL || "gpt-image-1",
  now = () => new Date(),
}) {
  if (!Number.isInteger(fromCycle) || fromCycle < 1) {
    throw new TypeError("fromCycle must be a positive integer.");
  }
  if (fromCycle >= 3) {
    throw new Error("Cycle three is terminal and cannot be revised.");
  }

  const fromCycleDir = resolveInside(
    runDir,
    `cycle-${String(fromCycle).padStart(2, "0")}`,
  );
  const toCycle = fromCycle + 1;
  const toCycleDir = resolveInside(
    runDir,
    `cycle-${String(toCycle).padStart(2, "0")}`,
  );
  const currentSiteDir = resolveInside(fromCycleDir, "site");

  const [brief, critique, mechanical, buildRecord, priorAssets, indexHtml, stylesCss, scriptJs] =
    await Promise.all([
      readJson(resolveInside(runDir, "brief.json")),
      readJson(resolveInside(fromCycleDir, "critique.json")),
      readJson(resolveInside(fromCycleDir, "mechanical.json")),
      readJson(resolveInside(fromCycleDir, "build.json")),
      readPriorAssets(resolveInside(fromCycleDir, "assets.json")),
      readFile(resolveInside(currentSiteDir, "index.html"), "utf8"),
      readFile(resolveInside(currentSiteDir, "styles.css"), "utf8"),
      readFile(resolveInside(currentSiteDir, "script.js"), "utf8"),
    ]);

  const currentManifest = {
    indexHtml,
    stylesCss,
    scriptJs,
    imagePlan: buildRecord.imagePlan,
    designNotes: buildRecord.designNotes,
  };
  const revisedManifest = await reviseSiteFn({
    brief,
    currentManifest,
    critique,
    mechanical,
    availableAssets: priorAssets,
  });

  const handoff = {
    schemaVersion: "1.0",
    fromCycle,
    toCycle,
    createdAt: now().toISOString(),
    targetScore: 85,
    mustKeep: [
      "Confirmed business facts and explicit unknowns",
      "Single page semantic structure",
      "Owned local assets and owned motion with visible source without JavaScript",
      "No emoji or visible dash characters",
      "Every current accessibility safeguard",
    ],
    mustFix: critique.revisionBrief?.mustFix ?? critique.issues.map((issue) => issue.fix),
    preserve: critique.revisionBrief?.preserve ?? critique.strengths ?? [],
    mechanicalFailures: mechanical.failures ?? [],
  };

  const siteDir = resolveInside(toCycleDir, "site");
  await writeSiteFiles(siteDir, revisedManifest);
  const assets = await assetMaterializerFn({
    cycleDir: toCycleDir,
    siteDir,
    plan: revisedManifest.imagePlan,
    shootDirection: revisedManifest.designNotes.shootDirection,
    requestImage: imageRequesterFn,
    client,
    model,
    priorAssets,
    priorSiteDir: currentSiteDir,
  });
  await Promise.all([
    writeJsonNew(resolveInside(fromCycleDir, "revise.json"), handoff),
    writeJsonNew(resolveInside(toCycleDir, "build.json"), {
      cycle: toCycle,
      fromCycle,
      createdAt: now().toISOString(),
      source: revisedManifest.source,
      fallbackReason: null,
      designNotes: revisedManifest.designNotes,
      imagePlan: revisedManifest.imagePlan,
      assetSummary: sanitizeAssetSummary(assets),
    }),
  ]);

  return { fromCycle, toCycle, toCycleDir, siteDir, manifest: revisedManifest };
}

function stripOwnedMotionStyles(manifest) {
  const ownedStyles = createOwnedMotionStyles(manifest.designNotes.motionMoves);
  if (!manifest.stylesCss.endsWith(ownedStyles)) {
    throw new Error("Current site is missing the exact owned motion styles suffix.");
  }
  return manifest.stylesCss.slice(0, -ownedStyles.length);
}

async function readJson(target) {
  return JSON.parse(await readFile(target, "utf8"));
}

async function readPriorAssets(target) {
  try {
    return await readJson(target);
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new Error("Prior asset evidence assets.json is required for revision.");
    }
    throw error;
  }
}

function sanitizeAvailableAssets(assets) {
  if (assets === undefined) return [];
  if (!assets || !Array.isArray(assets.files)) {
    throw new TypeError("Prior asset evidence is required for revision.");
  }
  return assets.files.map((file) => ({
    filename: file.filename,
    path: `assets/${file.filename}`,
    role: file.role,
    alt: file.alt,
    focalPoint: file.focalPoint,
    mediaType: file.mediaType,
    bytes: file.bytes,
    sha256: file.sha256,
    source: file.source,
    resolved: file.resolved,
    errorCode: file.errorCode,
  }));
}

function sanitizeAssetSummary(assets) {
  if (!assets || typeof assets !== "object") {
    throw new TypeError("Asset materialization did not return evidence.");
  }
  const summary = {
    allResolved: assets.allResolved,
    requestCount: assets.requestCount,
    successCount: assets.successCount,
    fallbackCount: assets.fallbackCount,
  };
  if (
    typeof summary.allResolved !== "boolean" ||
    Object.values(summary).slice(1).some((value) => !Number.isInteger(value) || value < 0)
  ) {
    throw new TypeError("Asset materialization returned invalid summary evidence.");
  }
  return summary;
}
