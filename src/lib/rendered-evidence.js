import { createHash } from "node:crypto";

export const MAX_CRITIC_FULL_PAGE_HEIGHT = 12_000;
export const MAX_CRITIC_IMAGE_BYTES = 12 * 1024 * 1024;
export const MAX_CRITIC_TOTAL_IMAGE_BYTES = 36 * 1024 * 1024;
export const MAX_CRITIC_DECODED_IMAGE_BYTES = 96 * 1024 * 1024;
export const MAX_CRITIC_RENDERED_WIDTH = 4096;

const VIEWPORTS = Object.freeze(["desktop", "tablet", "phone"]);
const MODES = Object.freeze(["normal", "reducedMotion", "javascriptDisabled"]);
const SHA256_HEX = /^[a-f0-9]{64}$/;

export class CriticEvidenceLimitError extends Error {
  constructor() {
    super("Critic image evidence exceeds safe limits.");
    this.name = "CriticEvidenceLimitError";
    this.code = "CRITIC_EVIDENCE_LIMIT_EXCEEDED";
  }
}

export function assertCriticEvidenceLimits({ canonical, fullPage }) {
  try {
    const records = [];
    for (const [groupName, group] of [
      ["canonical", canonical],
      ["fullPage", fullPage],
    ]) {
      if (!isPlainObject(group) || !hasExactKeys(group, VIEWPORTS)) throw new Error();
      for (const viewport of VIEWPORTS) {
        const record = group[viewport];
        if (
          !isPlainObject(record) ||
          !Number.isSafeInteger(record.bytes) ||
          record.bytes < 1 ||
          record.bytes > MAX_CRITIC_IMAGE_BYTES ||
          !Number.isSafeInteger(record.width) ||
          record.width < 1 ||
          record.width > MAX_CRITIC_RENDERED_WIDTH ||
          !Number.isSafeInteger(record.height) ||
          record.height < 1 ||
          (groupName === "fullPage" && record.height > MAX_CRITIC_FULL_PAGE_HEIGHT)
        ) {
          throw new Error();
        }
        records.push(record);
      }
    }
    const totalBytes = records.reduce((total, record) => total + record.bytes, 0);
    if (!Number.isSafeInteger(totalBytes) || totalBytes > MAX_CRITIC_TOTAL_IMAGE_BYTES) {
      throw new Error();
    }
    return Object.freeze({ totalBytes });
  } catch (error) {
    if (error instanceof CriticEvidenceLimitError) throw error;
    throw new CriticEvidenceLimitError();
  }
}

export function summarizeRenderedMechanics(mechanical) {
  if (
    !isPlainObject(mechanical) ||
    !Array.isArray(mechanical.motionMoveSlugs) ||
    !Array.isArray(mechanical.failures) ||
    !isPlainObject(mechanical.contexts)
  ) {
    throw new TypeError("Rendered mechanical evidence is incomplete.");
  }
  return {
    motionMoveSlugs: [...mechanical.motionMoveSlugs],
    failures: mechanical.failures.map((failure) =>
      pickExisting(failure, [
        "code",
        "viewport",
        "mode",
        "count",
        "subjectIndex",
      ]),
    ),
    viewports: Object.fromEntries(
      VIEWPORTS.map((viewport) => {
        const contexts = mechanical.contexts[viewport];
        if (!isPlainObject(contexts)) {
          throw new TypeError("Rendered mechanical viewport evidence is incomplete.");
        }
        return [
          viewport,
          Object.fromEntries(
            MODES.map((mode) => {
              const context = contexts[mode];
              if (!isPlainObject(context)) {
                throw new TypeError("Rendered mechanical mode evidence is incomplete.");
              }
              return [
                mode,
                {
                  firstBeats: pickExisting(context.firstBeats, [
                    "sectionCount",
                    "exactFirstBeatCount",
                    "visibleFirstBeatCount",
                  ]),
                  touchTargets: pickExisting(context.touchTargets, [
                    "checkedCount",
                    "passingCount",
                  ]),
                  controls: pickExisting(context.controls, [
                    "controlCount",
                    "ariaLinkedCount",
                    "enterPassed",
                    "spacePassed",
                    "tapChecked",
                    "tapPassed",
                  ]),
                  motion: pickExisting(context.motion, [
                    "declaredRootCount",
                    "foundRootCount",
                    "activeRootCount",
                    "disabledRootCount",
                    "targetCount",
                    "visibleTargetCount",
                    "panelCount",
                    "visiblePanelCount",
                    "maxDurationMs",
                    "progressChangedCount",
                    "selectionChangedCount",
                    "contractPassed",
                    "reducedFallbackPassed",
                    "noJavaScriptFallbackPassed",
                  ]),
                },
              ];
            }),
          ),
        ];
      }),
    ),
  };
}

export function createRenderedEvidencePacketSha256({
  canonicalManifestBytes,
  canonicalBuffers,
  criticManifestBytes,
  fullPageBuffers,
  mechanical,
}) {
  const packet = {
    schemaVersion: "1.0",
    canonical: fileRecords(
      "screenshots/manifest.json",
      canonicalManifestBytes,
      canonicalBuffers,
      (viewport) =>
        `screenshots/${viewport === "phone" ? "mobile" : viewport}-home.png`,
    ),
    critic: fileRecords(
      "screenshots/critic/manifest.json",
      criticManifestBytes,
      fullPageBuffers,
      (viewport) =>
        `screenshots/critic/${viewport === "phone" ? "mobile" : viewport}-full-page.png`,
    ),
    mechanical: summarizeRenderedMechanics(mechanical),
  };
  return sha256(Buffer.from(JSON.stringify(packet), "utf8"));
}

export function isEvidencePacketSha256(value) {
  return typeof value === "string" && SHA256_HEX.test(value);
}

function fileRecords(manifestPath, manifestBytes, buffers, imagePath) {
  if (!Buffer.isBuffer(manifestBytes) || !isPlainObject(buffers)) {
    throw new TypeError("Rendered evidence packet bytes are incomplete.");
  }
  return [
    fileRecord(manifestPath, manifestBytes),
    ...VIEWPORTS.map((viewport) =>
      fileRecord(imagePath(viewport), buffers[viewport]),
    ),
  ];
}

function fileRecord(relativePath, value) {
  if (!Buffer.isBuffer(value) || value.length === 0) {
    throw new TypeError("Rendered evidence packet bytes are incomplete.");
  }
  return {
    path: relativePath,
    bytes: value.length,
    sha256: sha256(value),
  };
}

function pickExisting(value, fields) {
  if (!isPlainObject(value)) {
    throw new TypeError("Rendered mechanical evidence field is incomplete.");
  }
  return Object.fromEntries(
    fields
      .filter((field) => Object.hasOwn(value, field))
      .map((field) => [field, value[field]]),
  );
}

function hasExactKeys(value, expected) {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}
