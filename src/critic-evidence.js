import { lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { chromium } from "playwright";

import {
  MAX_IMAGE_REQUESTS_PER_CYCLE,
  createDeterministicPng,
  sha256Hex,
  validatePngBuffer,
} from "./assets.js";
import { MOTION_MOVE_SLUGS } from "./motion.js";
import { PngValidationError, inspectPngBuffer } from "./lib/png.js";
import {
  CriticEvidenceLimitError,
  MAX_CRITIC_DECODED_IMAGE_BYTES,
  MAX_CRITIC_FULL_PAGE_HEIGHT,
  MAX_CRITIC_IMAGE_BYTES,
  MAX_CRITIC_RENDERED_WIDTH,
  assertCriticEvidenceLimits,
  createRenderedEvidencePacketSha256,
} from "./lib/rendered-evidence.js";
import { resolveInside } from "./lib/runs.js";
import { startStaticServer } from "./serve.js";
import { EVIDENCE_VIEWPORTS } from "./viewports.js";
import {
  createPlaywrightRecovery,
  isPlaywrightBrowserUnavailable,
} from "./playwright-recovery.js";

export { EVIDENCE_VIEWPORTS };

const VISUAL_VIEWPORTS = Object.freeze(["desktop", "tablet", "phone"]);
const VISUAL_MODES = Object.freeze(["normal", "reducedMotion", "javascriptDisabled"]);
export const CRITIC_FULL_PAGE_FILES = Object.freeze({
  desktop: "desktop-full-page.png",
  tablet: "tablet-full-page.png",
  phone: "mobile-full-page.png",
});
const INTERACTIVE_SLUGS = new Set(["horizontal-click-reel", "numbered-story-stepper"]);
const FAILURE_VIEWPORT_ORDER = Object.freeze({
  none: 0,
  desktop: 1,
  tablet: 2,
  phone: 3,
  narrow: 4,
});
const FAILURE_MODE_ORDER = Object.freeze({
  none: 0,
  normal: 1,
  reducedMotion: 2,
  javascriptDisabled: 3,
});
const MAX_REDUCED_DURATION_MS = 0.01;
const INTERACTION_TIMEOUT_MS = 750;
const SAFE_ASSET_FILENAME = /^[a-z0-9]+(?:-[a-z0-9]+)*\.png$/;
const SHA256_HEX = /^[a-f0-9]{64}$/;
const ASSET_EVIDENCE_FIELDS = Object.freeze([
  "schemaVersion",
  "allResolved",
  "requestCount",
  "successCount",
  "fallbackCount",
  "files",
]);
const ASSET_FILE_FIELDS = Object.freeze([
  "filename",
  "path",
  "role",
  "alt",
  "focalPoint",
  "promptHash",
  "mediaType",
  "bytes",
  "sha256",
  "source",
  "resolved",
  "errorCode",
]);
const IMAGE_PLAN_FIELDS = Object.freeze([
  "filename",
  "role",
  "alt",
  "prompt",
  "focalPoint",
]);
const ASSET_SUMMARY_FIELDS = Object.freeze([
  "allResolved",
  "requestCount",
  "successCount",
  "fallbackCount",
]);
const EVIDENCE_PACKET_ERROR = "EVIDENCE_PACKET_INVALID";
const UNTRUSTED_PATH_ERROR = "EVIDENCE_PATH_UNTRUSTED";
const REQUIRED_CONTEXT_MODES = Object.freeze({
  desktop: VISUAL_MODES,
  tablet: VISUAL_MODES,
  phone: VISUAL_MODES,
  narrow: Object.freeze(["normal"]),
});
const CONTEXT_EVIDENCE_FIELDS = Object.freeze([
  "viewport",
  "mode",
  "base",
  "firstBeats",
  "touchTargets",
  "controls",
  "motion",
  "network",
  "passed",
  "failures",
  "totals",
]);
const BASE_EVIDENCE_FIELDS = Object.freeze([
  "viewportWidth",
  "viewportHeight",
  "scrollWidth",
  "horizontalOverflow",
  "h1Count",
  "mainCount",
  "internalAnchorCount",
  "brokenAnchorCount",
  "imageCount",
  "missingAltCount",
  "brokenImageCount",
  "visibleTextLength",
]);
const FIRST_BEAT_EVIDENCE_FIELDS = Object.freeze([
  "sectionCount",
  "exactFirstBeatCount",
  "visibleFirstBeatCount",
]);
const TOUCH_EVIDENCE_FIELDS = Object.freeze(["checkedCount", "passingCount"]);
const CONTROL_EVIDENCE_FIELDS = Object.freeze([
  "controlCount",
  "ariaLinkedCount",
  "roots",
  "enterPassed",
  "spacePassed",
  "tapChecked",
  "tapPassed",
]);
const CONTROL_ROOT_FIELDS = Object.freeze([
  "slug",
  "subjectIndex",
  "rootCount",
  "controlCount",
  "enterPassed",
  "spacePassed",
  "tapChecked",
  "tapPassed",
  "ariaLinkedCount",
]);
const NORMAL_MOTION_FIELDS = Object.freeze([
  "declaredRootCount",
  "foundRootCount",
  "activeRootCount",
  "progressChangedCount",
  "selectionChangedCount",
  "targetCount",
  "visibleTargetCount",
  "contractPassed",
]);
const REDUCED_MOTION_FIELDS = Object.freeze([
  "declaredRootCount",
  "foundRootCount",
  "disabledRootCount",
  "targetCount",
  "visibleTargetCount",
  "panelCount",
  "visiblePanelCount",
  "maxDurationMs",
  "reducedFallbackPassed",
  "contractPassed",
]);
const NO_JAVASCRIPT_MOTION_FIELDS = Object.freeze([
  "declaredRootCount",
  "foundRootCount",
  "firstBeatCount",
  "visibleFirstBeatCount",
  "targetCount",
  "visibleTargetCount",
  "panelCount",
  "visiblePanelCount",
  "noJavaScriptFallbackPassed",
  "contractPassed",
]);
const EMPTY_MOTION_FIELDS = Object.freeze([
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
]);
const NETWORK_EVIDENCE_FIELDS = Object.freeze([
  "consoleErrorCount",
  "pageErrorCount",
  "externalRequestCount",
  "requestFailureCount",
]);
const CONTEXT_TOTAL_FIELDS = Object.freeze([
  "contextCount",
  "externalRequestCount",
  "requestFailureCount",
  "consoleErrorCount",
  "pageErrorCount",
  "brokenImageCount",
]);
const CONTEXT_FAILURE_CODES = new Set([
  "horizontal-overflow",
  "h1-count",
  "main-count",
  "broken-internal-anchor",
  "image-alt-missing",
  "broken-image",
  "visible-text-empty",
  "section-first-beat-count",
  "first-beat-zero-box",
  "first-beat-hidden",
  "first-beat-opacity",
  "first-beat-outside-upper-fold",
  "touch-target-too-small",
  "motion-root-count",
  "motion-root-not-active",
  "motion-progress-static",
  "motion-panel-selection-static",
  "motion-target-not-visible",
  "reduced-motion-root-not-disabled",
  "reduced-motion-target-hidden",
  "reduced-motion-panel-hidden",
  "reduced-motion-duration",
  "no-js-first-beat-hidden",
  "no-js-motion-target-hidden",
  "no-js-motion-panel-hidden",
  "motion-control-root-missing",
  "motion-control-root-count",
  "motion-control-count",
  "motion-control-aria-link",
  "motion-control-click",
  "motion-control-state",
  "motion-control-focus",
  "motion-control-enter",
  "motion-control-space",
  "motion-control-tap",
  "console-error",
  "page-error",
  "external-request",
  "request-failed",
]);

export class CaptureUnavailableError extends Error {
  constructor(message, { cause } = {}) {
    super(message);
    this.name = "CaptureUnavailableError";
    this.code = "CAPTURE_UNAVAILABLE";
    if (cause !== undefined) this.cause = cause;
  }
}

function classifyCaptureUnavailable(error, stage) {
  if (error?.code === "CAPTURE_UNAVAILABLE") return error;
  const serverCodes = new Set(["EADDRINUSE", "EADDRNOTAVAIL", "EACCES"]);
  const explicitlyUnavailable =
    (stage === "server" && serverCodes.has(error?.code)) ||
    (stage === "browser" && isPlaywrightBrowserUnavailable(error));
  if (!explicitlyUnavailable) return null;
  if (stage === "browser") return error;
  return new CaptureUnavailableError(
    stage === "server"
      ? "Preview server is unavailable."
      : "Browser capture is unavailable.",
    { cause: error },
  );
}

// The argument shape intentionally matches the original critic capture function
// so this module can be substituted without changing pipeline stage order.
export async function captureRenderedEvidence({
  siteDir,
  cycleDir,
  port = 4601,
  browserType = chromium,
  browserRecovery = createPlaywrightRecovery(),
  now = () => new Date(),
  startServer = startStaticServer,
}) {
  const paths = validateEvidencePaths({ siteDir, cycleDir });
  const {
    runRoot,
    cycleDir: trustedCycleDir,
    siteDir: trustedSiteDir,
    screenshotsDir,
  } = paths;
  const criticScreenshotsDir = resolveInside(screenshotsDir, "critic");
  const cycle = cycleNumberFromPath(trustedCycleDir);
  const desktopPath = resolveInside(
    screenshotsDir,
    EVIDENCE_VIEWPORTS.desktop.filename,
  );
  const tabletPath = resolveInside(
    screenshotsDir,
    EVIDENCE_VIEWPORTS.tablet.filename,
  );
  const mobilePath = resolveInside(
    screenshotsDir,
    EVIDENCE_VIEWPORTS.phone.filename,
  );
  const visibleTextPath = resolveInside(trustedCycleDir, "visible-text.txt");
  const mechanicalPath = resolveInside(trustedCycleDir, "mechanical.json");
  const screenshotManifestPath = resolveInside(screenshotsDir, "manifest.json");
  const fullPagePaths = Object.fromEntries(
    VISUAL_VIEWPORTS.map((viewportName) => [
      viewportName,
      resolveInside(criticScreenshotsDir, CRITIC_FULL_PAGE_FILES[viewportName]),
    ]),
  );
  const criticManifestPath = resolveInside(criticScreenshotsDir, "manifest.json");
  const outputPaths = [
    desktopPath,
    tabletPath,
    mobilePath,
    visibleTextPath,
    mechanicalPath,
    screenshotManifestPath,
    ...Object.values(fullPagePaths),
    criticManifestPath,
  ];

  await assertNoLinkedPath(runRoot, trustedCycleDir);
  await assertNoLinkedPath(runRoot, trustedSiteDir);
  await assertNoLinkedPath(runRoot, screenshotsDir);
  await assertNoLinkedPath(runRoot, criticScreenshotsDir);
  const buildGate = await readBuildGate(resolveInside(trustedCycleDir, "build.json"));
  const assetGate = await readAssetGate({
    target: resolveInside(trustedCycleDir, "assets.json"),
    siteDir: trustedSiteDir,
    runRoot,
    build: buildGate.build,
  });
  const reusable = await readReusableEvidencePacket({
    cycle,
    runRoot,
    outputPaths,
    desktopPath,
    tabletPath,
    mobilePath,
    visibleTextPath,
    mechanicalPath,
    screenshotManifestPath,
    fullPagePaths,
    criticManifestPath,
    assetGate,
    buildGate,
  });
  if (reusable) return reusable;

  await Promise.all(outputPaths.map(assertAbsent));
  await assertNoLinkedPath(runRoot, screenshotsDir);
  await mkdir(screenshotsDir, { recursive: true });
  await mkdir(criticScreenshotsDir, { recursive: true });
  await assertNoLinkedPath(runRoot, trustedCycleDir);
  await assertNoLinkedPath(runRoot, screenshotsDir);
  await assertNoLinkedPath(runRoot, criticScreenshotsDir);

  let preview;
  try {
    preview = await startServer({ root: trustedSiteDir, port });
  } catch (error) {
    const unavailable = classifyCaptureUnavailable(error, "server");
    if (unavailable) throw unavailable;
    throw error;
  }
  let browser;
  try {
    try {
      browser = await browserRecovery.run(
        () => browserType.launch({ headless: true }),
        { stage: "critic" },
      );
    } catch (error) {
      const unavailable = classifyCaptureUnavailable(error, "browser");
      if (unavailable) throw unavailable;
      throw error;
    }
    const contexts = {};
    const screenshotBuffers = {};
    const fullPageBuffers = {};
    let visibleText = "";
    const contextFailures = [];

    for (const viewportName of VISUAL_VIEWPORTS) {
      contexts[viewportName] = {};
      for (const mode of VISUAL_MODES) {
        const result = await captureContext({
          browser,
          previewUrl: preview.url,
          viewportName,
          mode,
          motionMoveSlugs: buildGate.motionMoveSlugs,
          captureScreenshot: mode === "normal",
          captureFullPage: mode === "reducedMotion",
        });
        contexts[viewportName][mode] = result.evidence;
        contextFailures.push(...result.failures);
        if (result.screenshot) {
          screenshotBuffers[viewportName] = result.screenshot;
        }
        if (result.fullPageScreenshot) {
          fullPageBuffers[viewportName] = result.fullPageScreenshot;
        }
        if (viewportName === "desktop" && mode === "normal") {
          visibleText = result.visibleText;
        }
      }
    }

    const narrowResult = await captureContext({
      browser,
      previewUrl: preview.url,
      viewportName: "narrow",
      mode: "normal",
      motionMoveSlugs: buildGate.motionMoveSlugs,
      captureScreenshot: false,
      captureFullPage: false,
      narrowOnly: true,
    });
    contexts.narrow = { normal: narrowResult.evidence };
    contextFailures.push(...narrowResult.failures);

    const failures = sortFailures([
      ...assetGate.failures,
      ...buildGate.failures,
      ...contextFailures,
    ]);
    const mechanical = {
      schemaVersion: "2.0",
      cycle,
      passed: failures.length === 0,
      assetsResolved: assetGate.assetsResolved,
      assetManifestPresent: assetGate.manifestPresent,
      motionMoveSlugs: buildGate.motionMoveSlugs,
      contexts,
      failures,
      totals: summarizeContexts(contexts),
    };
    let imageMetadata;
    try {
      imageMetadata = inspectCriticImagePayload({
        canonicalBuffers: screenshotBuffers,
        fullPageBuffers,
      });
    } catch (error) {
      if (
        error instanceof PngValidationError ||
        error instanceof CriticEvidenceLimitError
      ) {
        throw new CaptureUnavailableError(
          "Rendered image evidence exceeds safe capture limits.",
          { cause: error },
        );
      }
      throw error;
    }
    const capturedAt = now().toISOString();
    const screenshotManifest = {
      schemaVersion: "2.0",
      cycle,
      capturedAt,
      viewports: Object.fromEntries(
        VISUAL_VIEWPORTS.map((viewportName) => {
          const viewport = EVIDENCE_VIEWPORTS[viewportName];
          return [
            viewportName,
            {
              width: viewport.width,
              height: viewport.height,
              path: `screenshots/${viewport.filename}`,
            },
          ];
        }),
      ),
      network: {
        externalRequestCount: mechanical.totals.externalRequestCount,
        requestFailureCount: mechanical.totals.requestFailureCount,
        consoleErrorCount: mechanical.totals.consoleErrorCount,
        pageErrorCount: mechanical.totals.pageErrorCount,
      },
    };
    const screenshotManifestBytes = Buffer.from(
      serializeJson(screenshotManifest),
      "utf8",
    );
    const canonicalCaptureSha256 = createCanonicalCaptureSha256({
      manifestBytes: screenshotManifestBytes,
      buffers: screenshotBuffers,
    });
    const criticManifest = createCriticManifest({
      cycle,
      capturedAt,
      buffers: fullPageBuffers,
      metadata: imageMetadata.fullPage,
      canonicalCaptureSha256,
    });
    const criticManifestBytes = Buffer.from(serializeJson(criticManifest), "utf8");
    const evidencePacketSha256 = createRenderedEvidencePacketSha256({
      canonicalManifestBytes: screenshotManifestBytes,
      canonicalBuffers: screenshotBuffers,
      criticManifestBytes,
      fullPageBuffers,
      mechanical,
    });

    await Promise.all([
      writeBinaryNew(desktopPath, screenshotBuffers.desktop, runRoot),
      writeBinaryNew(tabletPath, screenshotBuffers.tablet, runRoot),
      writeBinaryNew(mobilePath, screenshotBuffers.phone, runRoot),
      writeTextNew(visibleTextPath, visibleText, runRoot),
      writeJsonNew(mechanicalPath, mechanical, runRoot),
      writeJsonNew(screenshotManifestPath, screenshotManifest, runRoot),
      ...VISUAL_VIEWPORTS.map((viewportName) =>
        writeBinaryNew(fullPagePaths[viewportName], fullPageBuffers[viewportName], runRoot),
      ),
      writeJsonNew(criticManifestPath, criticManifest, runRoot),
    ]);

    return {
      cycle,
      desktopPath,
      tabletPath,
      mobilePath,
      phonePath: mobilePath,
      fullPagePaths,
      visibleTextPath,
      mechanical,
      assetsResolved: assetGate.assetsResolved,
      screenshotManifest,
      criticManifest,
      evidencePacketSha256,
    };
  } finally {
    await browser?.close().catch(() => {});
    await preview?.close().catch(() => {});
  }
}

export const captureCycleEvidence = captureRenderedEvidence;

export async function readCriticVisualEvidence({ cycleDir, mechanical }) {
  const normalizedCycleDir = path.resolve(cycleDir);
  const paths = validateEvidencePaths({
    cycleDir: normalizedCycleDir,
    siteDir: path.join(normalizedCycleDir, "site"),
  });
  const { runRoot, screenshotsDir } = paths;
  const criticScreenshotsDir = resolveInside(screenshotsDir, "critic");
  const cycle = cycleNumberFromPath(normalizedCycleDir);
  const initialPaths = Object.fromEntries(
    VISUAL_VIEWPORTS.map((viewportName) => [
      viewportName,
      resolveInside(screenshotsDir, EVIDENCE_VIEWPORTS[viewportName].filename),
    ]),
  );
  const fullPagePaths = Object.fromEntries(
    VISUAL_VIEWPORTS.map((viewportName) => [
      viewportName,
      resolveInside(criticScreenshotsDir, CRITIC_FULL_PAGE_FILES[viewportName]),
    ]),
  );
  const screenshotManifestPath = resolveInside(screenshotsDir, "manifest.json");
  const criticManifestPath = resolveInside(criticScreenshotsDir, "manifest.json");

  await assertNoLinkedPath(runRoot, normalizedCycleDir);
  await assertNoLinkedPath(runRoot, screenshotsDir);
  await assertNoLinkedPath(runRoot, criticScreenshotsDir);
  await Promise.all(
    [
      ...Object.values(initialPaths),
      ...Object.values(fullPagePaths),
      screenshotManifestPath,
      criticManifestPath,
    ].map((target) => assertNoLinkedPath(runRoot, target)),
  );
  try {
    const [initialEntries, fullPageEntries, screenshotManifestText, criticManifestText] =
      await Promise.all([
        Promise.all(
          VISUAL_VIEWPORTS.map(async (viewportName) => [
            viewportName,
            await readFile(initialPaths[viewportName]),
          ]),
        ),
        Promise.all(
          VISUAL_VIEWPORTS.map(async (viewportName) => [
            viewportName,
            await readFile(fullPagePaths[viewportName]),
          ]),
        ),
        readFile(screenshotManifestPath, "utf8"),
        readFile(criticManifestPath, "utf8"),
      ]);
    const initial = Object.fromEntries(initialEntries);
    const fullPage = Object.fromEntries(fullPageEntries);
    const screenshotManifest = JSON.parse(screenshotManifestText);
    const criticManifest = JSON.parse(criticManifestText);
    const imageMetadata = inspectCriticImagePayload({
      canonicalBuffers: initial,
      fullPageBuffers: fullPage,
    });
    if (
      !VISUAL_VIEWPORTS.every((viewportName) =>
        isReusableScreenshot(
          imageMetadata.canonical[viewportName],
          EVIDENCE_VIEWPORTS[viewportName],
        ),
      ) ||
      !isReusableScreenshotManifest(screenshotManifest, { cycle, mechanical }) ||
      !isReusableCriticManifest(criticManifest, {
        cycle,
        buffers: fullPage,
        metadata: imageMetadata.fullPage,
        canonicalManifestBytes: Buffer.from(screenshotManifestText, "utf8"),
        canonicalBuffers: initial,
      })
    ) {
      throw invalidEvidencePacket();
    }
    return {
      viewports: Object.fromEntries(
        VISUAL_VIEWPORTS.map((viewportName) => [
          viewportName,
          {
            initial: initial[viewportName],
            fullPage: fullPage[viewportName],
          },
        ]),
      ),
      criticManifest,
      evidencePacketSha256: createRenderedEvidencePacketSha256({
        canonicalManifestBytes: Buffer.from(screenshotManifestText, "utf8"),
        canonicalBuffers: initial,
        criticManifestBytes: Buffer.from(criticManifestText, "utf8"),
        fullPageBuffers: fullPage,
        mechanical,
      }),
    };
  } catch (error) {
    if (error?.code === UNTRUSTED_PATH_ERROR || error?.code === EVIDENCE_PACKET_ERROR) {
      throw error;
    }
    throw invalidEvidencePacket(error);
  }
}

async function captureContext({
  browser,
  previewUrl,
  viewportName,
  mode,
  motionMoveSlugs,
  captureScreenshot,
  captureFullPage,
  narrowOnly = false,
}) {
  const viewport = EVIDENCE_VIEWPORTS[viewportName];
  if (!viewport || !["normal", "reducedMotion", "javascriptDisabled"].includes(mode)) {
    throw new TypeError("Unknown rendered evidence context.");
  }

  const counters = {
    consoleErrorCount: 0,
    pageErrorCount: 0,
    externalRequestCount: 0,
    requestFailureCount: 0,
  };
  const exactOrigin = new URL(previewUrl).origin;
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    colorScheme: "light",
    reducedMotion: mode === "reducedMotion" ? "reduce" : "no-preference",
    javaScriptEnabled: mode !== "javascriptDisabled",
    hasTouch: viewport.touch,
  });

  await context.route(new RegExp(".*"), async (route) => {
    if (!isExactOrigin(route.request().url(), exactOrigin)) {
      counters.externalRequestCount += 1;
      await route.abort("blockedbyclient").catch(() => {});
      return;
    }
    await route.continue().catch(() => {});
  });

  const page = await context.newPage();
  page.on("console", (message) => {
    if (message.type() === "error") {
      counters.consoleErrorCount += 1;
    }
  });
  page.on("pageerror", () => {
    counters.pageErrorCount += 1;
  });
  page.on("requestfailed", (request) => {
    if (isExactOrigin(request.url(), exactOrigin)) {
      counters.requestFailureCount += 1;
    }
  });

  try {
    await navigateAndSettle(page, previewUrl, {
      javascriptEnabled: mode !== "javascriptDisabled",
    });
    if (captureScreenshot || captureFullPage) {
      await page.waitForTimeout(450);
    }
    const screenshot = captureScreenshot
      ? await page.screenshot({ fullPage: false, type: "png" })
      : null;
    const fullPageScreenshot = captureFullPage
      ? await page.screenshot({ fullPage: true, type: "png" })
      : null;
    const visibleText =
      captureScreenshot && viewportName === "desktop"
        ? await page.locator("body").innerText()
        : "";
    const base = await collectBaseEvidence(page);
    const failures = baseFailures(base, viewportName, mode);

    await addMechanicsSpacer(page);
    let firstBeats = emptyFirstBeatEvidence();
    let touchTargets = emptyTouchEvidence();
    let motion = emptyMotionEvidence(motionMoveSlugs.length);
    let controls = emptyControlEvidence();

    if (!narrowOnly) {
      const firstBeatResult = await probeFirstBeats(page, {
        animationFrames: mode !== "javascriptDisabled",
      });
      firstBeats = firstBeatResult.evidence;
      failures.push(
        ...tagFailures(firstBeatResult.failures, viewportName, mode),
      );

      if (mode === "normal") {
        const motionResult = await probeNormalMotion(page, motionMoveSlugs);
        motion = motionResult.evidence;
        failures.push(...tagFailures(motionResult.failures, viewportName, mode));

        const controlResult = await probeControls({
          page,
          previewUrl,
          viewportName,
          motionMoveSlugs,
        });
        controls = controlResult.evidence;
        failures.push(...tagFailures(controlResult.failures, viewportName, mode));
        motion = {
          ...motion,
          contractPassed:
            motion.contractPassed && controlResult.failures.length === 0,
        };

        if (viewportName === "tablet" || viewportName === "phone") {
          const touchResult = await probeTouchTargets(page);
          touchTargets = touchResult.evidence;
          failures.push(...tagFailures(touchResult.failures, viewportName, mode));
        }
      } else if (mode === "reducedMotion") {
        const motionResult = await probeReducedMotion(page, motionMoveSlugs);
        motion = motionResult.evidence;
        failures.push(...tagFailures(motionResult.failures, viewportName, mode));
      } else {
        const motionResult = await probeNoJavaScript(page, motionMoveSlugs);
        motion = motionResult.evidence;
        failures.push(...tagFailures(motionResult.failures, viewportName, mode));
      }
    }

    failures.push(...counterFailures(counters, viewportName, mode));
    const sortedFailures = sortFailures(failures);
    const coreEvidence = {
      viewport: { width: viewport.width, height: viewport.height },
      mode,
      base,
      firstBeats,
      touchTargets,
      controls,
      motion,
      network: { ...counters },
    };
    return {
      screenshot,
      fullPageScreenshot,
      visibleText,
      evidence: {
        ...coreEvidence,
        passed: sortedFailures.length === 0,
        failures: sortedFailures,
        totals: summarizeContext(coreEvidence),
      },
      failures: sortedFailures,
    };
  } finally {
    await context.close();
  }
}

async function navigateAndSettle(
  page,
  previewUrl,
  { javascriptEnabled = true } = {},
) {
  await page.goto(previewUrl, {
    waitUntil: "load",
    timeout: 10_000,
  });
  if (!javascriptEnabled) {
    await page.waitForTimeout(50);
    return;
  }
  await page.evaluate(async () => {
    await document.fonts?.ready;
    await Promise.all(
      [...document.images].map((image) => {
        if (image.complete) return undefined;
        return new Promise((resolve) => {
          image.addEventListener("load", resolve, { once: true });
          image.addEventListener("error", resolve, { once: true });
        });
      }),
    );
    await new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve)),
    );
  });
}

async function collectBaseEvidence(page) {
  return page.evaluate(async () => {
    const anchors = [...document.querySelectorAll('a[href^="#"]')];
    let brokenAnchorCount = 0;
    for (const anchor of anchors) {
      const href = anchor.getAttribute("href");
      if (!href || href === "#") {
        continue;
      }
      try {
        if (!document.querySelector(href)) brokenAnchorCount += 1;
      } catch {
        brokenAnchorCount += 1;
      }
    }

    let brokenImageCount = 0;
    for (const image of document.images) {
      let decoded = true;
      try {
        await image.decode();
      } catch {
        decoded = false;
      }
      if (
        !decoded ||
        !image.complete ||
        image.naturalWidth <= 0 ||
        image.naturalHeight <= 0
      ) {
        brokenImageCount += 1;
      }
    }

    return {
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      scrollWidth: document.documentElement.scrollWidth,
      horizontalOverflow:
        document.documentElement.scrollWidth > window.innerWidth + 1,
      h1Count: document.querySelectorAll("h1").length,
      mainCount: document.querySelectorAll("main").length,
      internalAnchorCount: anchors.length,
      brokenAnchorCount,
      imageCount: document.images.length,
      missingAltCount: document.querySelectorAll("img:not([alt])").length,
      brokenImageCount,
      visibleTextLength: document.body.innerText.trim().length,
    };
  });
}

function baseFailures(base, viewport, mode) {
  const failures = [];
  if (base.horizontalOverflow) {
    failures.push({ code: "horizontal-overflow", viewport, mode });
  }
  if (base.h1Count !== 1) {
    failures.push({ code: "h1-count", viewport, mode, count: base.h1Count });
  }
  if (base.mainCount !== 1) {
    failures.push({ code: "main-count", viewport, mode, count: base.mainCount });
  }
  if (base.brokenAnchorCount > 0) {
    failures.push({
      code: "broken-internal-anchor",
      viewport,
      mode,
      count: base.brokenAnchorCount,
    });
  }
  if (base.missingAltCount > 0) {
    failures.push({
      code: "image-alt-missing",
      viewport,
      mode,
      count: base.missingAltCount,
    });
  }
  if (base.brokenImageCount > 0) {
    failures.push({
      code: "broken-image",
      viewport,
      mode,
      count: base.brokenImageCount,
    });
  }
  if (base.visibleTextLength === 0) {
    failures.push({ code: "visible-text-empty", viewport, mode });
  }
  return failures;
}

async function addMechanicsSpacer(page) {
  await page.evaluate(() => {
    const prior = document.querySelector("[data-mainstreet-mechanics-spacer]");
    if (prior) return;
    const spacer = document.createElement("div");
    spacer.setAttribute("data-mainstreet-mechanics-spacer", "");
    spacer.setAttribute("aria-hidden", "true");
    spacer.inert = true;
    spacer.style.cssText = [
      `height:${window.innerHeight}px`,
      "width:1px",
      "opacity:0",
      "visibility:hidden",
      "pointer-events:none",
      "overflow:hidden",
    ].join(";");
    document.body.append(spacer);
  });
}

async function withInstantDocumentScrolling(page, operation) {
  const previous = await page.evaluate(() => {
    const root = document.documentElement;
    const present = root.hasAttribute("style");
    const value = root.getAttribute("style");
    root.style.setProperty("scroll-behavior", "auto", "important");
    return { present, value };
  });

  try {
    return await operation();
  } finally {
    await page.evaluate(({ present, value }) => {
      const root = document.documentElement;
      if (present) {
        root.setAttribute("style", value ?? "");
      } else {
        root.removeAttribute("style");
      }
    }, previous);
  }
}

async function probeFirstBeats(page, { animationFrames = true } = {}) {
  const results = await withInstantDocumentScrolling(page, () =>
    animationFrames
      ? page.evaluate(async () => {
          const waitTwoFrames = () =>
            new Promise((resolve) =>
              requestAnimationFrame(() => requestAnimationFrame(resolve)),
            );
          const sections = [...document.querySelectorAll("[data-section]")];
          const probes = [];
          for (let subjectIndex = 0; subjectIndex < sections.length; subjectIndex += 1) {
            const section = sections[subjectIndex];
            const beats = [...section.querySelectorAll("[data-first-beat]")];
            if (beats.length !== 1) {
              probes.push({
                subjectIndex,
                beatCount: beats.length,
                nonzeroBox: false,
                ancestorsVisible: false,
                effectiveOpacity: 0,
                intersectsUpperTwoThirds: false,
              });
              continue;
            }
            const sectionTop = section.getBoundingClientRect().top + window.scrollY;
            window.scrollTo({ top: sectionTop, left: 0, behavior: "auto" });
            await waitTwoFrames();
            const beat = beats[0];
            const rect = beat.getBoundingClientRect();
            let ancestorsVisible = true;
            let effectiveOpacity = 1;
            for (let current = beat; current; current = current.parentElement) {
              const style = getComputedStyle(current);
              if (
                style.display === "none" ||
                style.visibility === "hidden" ||
                style.visibility === "collapse"
              ) {
                ancestorsVisible = false;
              }
              const opacity = Number.parseFloat(style.opacity);
              if (Number.isFinite(opacity)) effectiveOpacity *= opacity;
            }
            probes.push({
              subjectIndex,
              beatCount: 1,
              nonzeroBox: rect.width > 0 && rect.height > 0,
              ancestorsVisible,
              effectiveOpacity,
              intersectsUpperTwoThirds:
                rect.bottom > 0 && rect.top < window.innerHeight * (2 / 3),
            });
          }
          return probes;
        })
      : probeFirstBeatsWithoutFrames(page),
  );

  const failures = [];
  for (const result of results) {
    if (result.beatCount !== 1) {
      failures.push({
        code: "section-first-beat-count",
        subjectIndex: result.subjectIndex,
        count: result.beatCount,
      });
      continue;
    }
    if (!result.nonzeroBox) {
      failures.push({
        code: "first-beat-zero-box",
        subjectIndex: result.subjectIndex,
      });
    }
    if (!result.ancestorsVisible) {
      failures.push({
        code: "first-beat-hidden",
        subjectIndex: result.subjectIndex,
      });
    }
    if (result.effectiveOpacity < 0.95) {
      failures.push({
        code: "first-beat-opacity",
        subjectIndex: result.subjectIndex,
      });
    }
    if (!result.intersectsUpperTwoThirds) {
      failures.push({
        code: "first-beat-outside-upper-fold",
        subjectIndex: result.subjectIndex,
      });
    }
  }

  return {
    evidence: {
      sectionCount: results.length,
      exactFirstBeatCount: results.filter((result) => result.beatCount === 1).length,
      visibleFirstBeatCount: results.filter(
        (result) =>
          result.beatCount === 1 &&
          result.nonzeroBox &&
          result.ancestorsVisible &&
          result.effectiveOpacity >= 0.95 &&
          result.intersectsUpperTwoThirds,
      ).length,
    },
    failures,
  };
}

async function probeFirstBeatsWithoutFrames(page) {
  const sections = page.locator("[data-section]");
  const sectionCount = await sections.count();
  const results = [];
  for (let subjectIndex = 0; subjectIndex < sectionCount; subjectIndex += 1) {
    const section = sections.nth(subjectIndex);
    const beats = section.locator("[data-first-beat]");
    const beatCount = await beats.count();
    if (beatCount !== 1) {
      results.push({
        subjectIndex,
        beatCount,
        nonzeroBox: false,
        ancestorsVisible: false,
        effectiveOpacity: 0,
        intersectsUpperTwoThirds: false,
      });
      continue;
    }
    await section.evaluate((element) => {
      const top = element.getBoundingClientRect().top + window.scrollY;
      window.scrollTo({ top, left: 0, behavior: "auto" });
    });
    results.push(
      await beats.nth(0).evaluate((beat, index) => {
        const rect = beat.getBoundingClientRect();
        let ancestorsVisible = true;
        let effectiveOpacity = 1;
        for (let current = beat; current; current = current.parentElement) {
          const style = getComputedStyle(current);
          if (
            style.display === "none" ||
            style.visibility === "hidden" ||
            style.visibility === "collapse"
          ) {
            ancestorsVisible = false;
          }
          const opacity = Number.parseFloat(style.opacity);
          if (Number.isFinite(opacity)) effectiveOpacity *= opacity;
        }
        return {
          subjectIndex: index,
          beatCount: 1,
          nonzeroBox: rect.width > 0 && rect.height > 0,
          ancestorsVisible,
          effectiveOpacity,
          intersectsUpperTwoThirds:
            rect.bottom > 0 && rect.top < window.innerHeight * (2 / 3),
        };
      }, subjectIndex),
    );
  }
  return results;
}

async function probeTouchTargets(page) {
  const targets = await page.evaluate(() =>
    [...document.querySelectorAll("[data-primary-action], [data-motion-control]")].map(
      (element, subjectIndex) => {
        const rect = element.getBoundingClientRect();
        return {
          subjectIndex,
          width: rect.width,
          height: rect.height,
        };
      },
    ),
  );
  const failures = targets
    .filter((target) => target.width < 44 || target.height < 44)
    .map((target) => ({
      code: "touch-target-too-small",
      subjectIndex: target.subjectIndex,
    }));
  return {
    evidence: {
      checkedCount: targets.length,
      passingCount: targets.length - failures.length,
    },
    failures,
  };
}

async function probeNormalMotion(page, motionMoveSlugs) {
  const result = await page.evaluate(async (declaredSlugs) => {
    const waitTwoFrames = () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      );
    const elementVisible = (element) => {
      if (!element) return false;
      const rect = element.getBoundingClientRect();
      let opacity = 1;
      for (let current = element; current; current = current.parentElement) {
        const style = getComputedStyle(current);
        if (
          style.display === "none" ||
          style.visibility === "hidden" ||
          style.visibility === "collapse"
        ) {
          return false;
        }
        const value = Number.parseFloat(style.opacity);
        if (Number.isFinite(value)) opacity *= value;
      }
      return rect.width > 0 && rect.height > 0 && opacity >= 0.95;
    };

    const probes = [];
    for (let subjectIndex = 0; subjectIndex < declaredSlugs.length; subjectIndex += 1) {
      const slug = declaredSlugs[subjectIndex];
      const roots = [
        ...document.querySelectorAll(`[data-motion-root="${slug}"]`),
      ];
      const probe = {
        subjectIndex,
        rootCount: roots.length,
        active: false,
        progressChanged: null,
        selectionChanged: null,
        targetCount: 0,
        visibleTargetCount: 0,
      };
      if (roots.length !== 1) {
        probes.push(probe);
        continue;
      }

      const root = roots[0];
      const rootTop = root.getBoundingClientRect().top + window.scrollY;
      window.scrollTo({ top: rootTop, left: 0, behavior: "auto" });
      await waitTwoFrames();

      if (slug === "pinned-chapter-passage") {
        const before = Number.parseFloat(root.dataset.motionProgress ?? "");
        window.scrollTo({
          top: rootTop + Math.max(64, window.innerHeight / 2),
          left: 0,
          behavior: "auto",
        });
        await waitTwoFrames();
        const after = Number.parseFloat(root.dataset.motionProgress ?? "");
        probe.progressChanged =
          Number.isFinite(before) &&
          Number.isFinite(after) &&
          Math.abs(after - before) >= 0.001;
      } else if (
        slug === "horizontal-click-reel" ||
        slug === "numbered-story-stepper"
      ) {
        const controls = [...root.querySelectorAll("[data-motion-control]")];
        const before = root.dataset.motionSelected ?? "";
        if (controls.length > 1) {
          const alternate =
            controls.find(
              (control) => control.dataset.motionControl !== before,
            ) ?? controls[1];
          alternate.click();
          await waitTwoFrames();
        }
        const after = root.dataset.motionSelected ?? "";
        const selected = [
          ...root.querySelectorAll("[data-motion-panel]"),
        ].find((panel) => panel.dataset.motionPanel === after);
        probe.selectionChanged =
          before.length > 0 &&
          after.length > 0 &&
          before !== after &&
          elementVisible(selected);
      } else {
        const targets = [...root.querySelectorAll("[data-motion-target]")];
        for (const target of targets) {
          const targetTop = target.getBoundingClientRect().top + window.scrollY;
          window.scrollTo({ top: targetTop, left: 0, behavior: "auto" });
          await waitTwoFrames();
        }
        probe.targetCount = targets.length;
        probe.visibleTargetCount = targets.filter(
          (target) =>
            target.dataset.motionVisible === "true" && elementVisible(target),
        ).length;
      }
      probe.active = root.dataset.motionState === "active";
      probes.push(probe);
    }
    return probes;
  }, motionMoveSlugs);

  const failures = [];
  for (let index = 0; index < result.length; index += 1) {
    const probe = result[index];
    const slug = motionMoveSlugs[index];
    if (probe.rootCount !== 1) {
      failures.push({
        code: "motion-root-count",
        subjectIndex: probe.subjectIndex,
        count: probe.rootCount,
      });
      continue;
    }
    if (!probe.active) {
      failures.push({
        code: "motion-root-not-active",
        subjectIndex: probe.subjectIndex,
      });
    }
    if (slug === "pinned-chapter-passage" && !probe.progressChanged) {
      failures.push({
        code: "motion-progress-static",
        subjectIndex: probe.subjectIndex,
      });
    }
    if (INTERACTIVE_SLUGS.has(slug) && !probe.selectionChanged) {
      failures.push({
        code: "motion-panel-selection-static",
        subjectIndex: probe.subjectIndex,
      });
    }
    if (
      (slug === "staged-hero-entrance" ||
        slug === "gentle-scroll-reveals") &&
      (probe.targetCount === 0 ||
        probe.visibleTargetCount !== probe.targetCount)
    ) {
      failures.push({
        code: "motion-target-not-visible",
        subjectIndex: probe.subjectIndex,
        count: probe.targetCount - probe.visibleTargetCount,
      });
    }
  }

  return {
    evidence: {
      declaredRootCount: motionMoveSlugs.length,
      foundRootCount: result.filter((probe) => probe.rootCount === 1).length,
      activeRootCount: result.filter((probe) => probe.active).length,
      progressChangedCount: result.filter(
        (probe) => probe.progressChanged === true,
      ).length,
      selectionChangedCount: result.filter(
        (probe) => probe.selectionChanged === true,
      ).length,
      targetCount: result.reduce((sum, probe) => sum + probe.targetCount, 0),
      visibleTargetCount: result.reduce(
        (sum, probe) => sum + probe.visibleTargetCount,
        0,
      ),
      contractPassed: failures.length === 0,
    },
    failures,
  };
}

async function probeReducedMotion(page, motionMoveSlugs) {
  const result = await page.evaluate(
    ({ declaredSlugs, maximumDuration }) => {
      const elementVisible = (element) => {
        const rect = element.getBoundingClientRect();
        let opacity = 1;
        for (let current = element; current; current = current.parentElement) {
          const style = getComputedStyle(current);
          if (
            style.display === "none" ||
            style.visibility === "hidden" ||
            style.visibility === "collapse"
          ) {
            return false;
          }
          const value = Number.parseFloat(style.opacity);
          if (Number.isFinite(value)) opacity *= value;
        }
        return rect.width > 0 && rect.height > 0 && opacity >= 0.95;
      };
      const parseDuration = (value) =>
        value
          .split(",")
          .map((part) => part.trim())
          .map((part) => {
            if (part.endsWith("ms")) return Number.parseFloat(part);
            if (part.endsWith("s")) return Number.parseFloat(part) * 1000;
            return Number.parseFloat(part);
          })
          .filter(Number.isFinite);

      const roots = declaredSlugs.flatMap((slug, subjectIndex) =>
        [...document.querySelectorAll(`[data-motion-root="${slug}"]`)].map(
          (root) => ({ root, subjectIndex }),
        ),
      );
      const rootCounts = declaredSlugs.map(
        (slug) =>
          document.querySelectorAll(`[data-motion-root="${slug}"]`).length,
      );
      const targets = [...document.querySelectorAll("[data-motion-target]")];
      const panels = [...document.querySelectorAll("[data-motion-panel]")];
      let maxDurationMs = 0;
      for (const { root } of roots) {
        for (const element of [root, ...root.querySelectorAll("*")]) {
          const style = getComputedStyle(element);
          maxDurationMs = Math.max(
            maxDurationMs,
            ...parseDuration(style.animationDuration),
            ...parseDuration(style.transitionDuration),
          );
        }
      }
      return {
        rootCounts,
        disabledRootCount: roots.filter(
          ({ root }) => root.dataset.motionState === "disabled",
        ).length,
        targetCount: targets.length,
        visibleTargetCount: targets.filter(elementVisible).length,
        panelCount: panels.length,
        visiblePanelCount: panels.filter(elementVisible).length,
        maxDurationMs,
        durationPassed: maxDurationMs <= maximumDuration + 1e-9,
      };
    },
    {
      declaredSlugs: motionMoveSlugs,
      maximumDuration: MAX_REDUCED_DURATION_MS,
    },
  );

  const failures = [];
  for (let subjectIndex = 0; subjectIndex < result.rootCounts.length; subjectIndex += 1) {
    if (result.rootCounts[subjectIndex] !== 1) {
      failures.push({
        code: "motion-root-count",
        subjectIndex,
        count: result.rootCounts[subjectIndex],
      });
    }
  }
  if (result.disabledRootCount !== motionMoveSlugs.length) {
    failures.push({
      code: "reduced-motion-root-not-disabled",
      count: motionMoveSlugs.length - result.disabledRootCount,
    });
  }
  if (result.visibleTargetCount !== result.targetCount) {
    failures.push({
      code: "reduced-motion-target-hidden",
      count: result.targetCount - result.visibleTargetCount,
    });
  }
  if (result.visiblePanelCount !== result.panelCount) {
    failures.push({
      code: "reduced-motion-panel-hidden",
      count: result.panelCount - result.visiblePanelCount,
    });
  }
  if (!result.durationPassed) {
    failures.push({ code: "reduced-motion-duration" });
  }

  return {
    evidence: {
      declaredRootCount: motionMoveSlugs.length,
      foundRootCount: result.rootCounts.filter((count) => count === 1).length,
      disabledRootCount: result.disabledRootCount,
      targetCount: result.targetCount,
      visibleTargetCount: result.visibleTargetCount,
      panelCount: result.panelCount,
      visiblePanelCount: result.visiblePanelCount,
      maxDurationMs: roundDuration(result.maxDurationMs),
      reducedFallbackPassed: failures.length === 0,
      contractPassed: failures.length === 0,
    },
    failures,
  };
}

async function probeNoJavaScript(page, motionMoveSlugs) {
  const result = await page.evaluate((declaredSlugs) => {
    const elementVisible = (element) => {
      const rect = element.getBoundingClientRect();
      let opacity = 1;
      for (let current = element; current; current = current.parentElement) {
        const style = getComputedStyle(current);
        if (
          style.display === "none" ||
          style.visibility === "hidden" ||
          style.visibility === "collapse"
        ) {
          return false;
        }
        const value = Number.parseFloat(style.opacity);
        if (Number.isFinite(value)) opacity *= value;
      }
      return rect.width > 0 && rect.height > 0 && opacity >= 0.95;
    };
    const rootCounts = declaredSlugs.map(
      (slug) =>
        document.querySelectorAll(`[data-motion-root="${slug}"]`).length,
    );
    const firstBeats = [...document.querySelectorAll("[data-first-beat]")];
    const targets = [...document.querySelectorAll("[data-motion-target]")];
    const panels = [...document.querySelectorAll("[data-motion-panel]")];
    return {
      rootCounts,
      firstBeatCount: firstBeats.length,
      visibleFirstBeatCount: firstBeats.filter(elementVisible).length,
      targetCount: targets.length,
      visibleTargetCount: targets.filter(elementVisible).length,
      panelCount: panels.length,
      visiblePanelCount: panels.filter(elementVisible).length,
    };
  }, motionMoveSlugs);

  const failures = [];
  for (let subjectIndex = 0; subjectIndex < result.rootCounts.length; subjectIndex += 1) {
    if (result.rootCounts[subjectIndex] !== 1) {
      failures.push({
        code: "motion-root-count",
        subjectIndex,
        count: result.rootCounts[subjectIndex],
      });
    }
  }
  if (result.visibleFirstBeatCount !== result.firstBeatCount) {
    failures.push({
      code: "no-js-first-beat-hidden",
      count: result.firstBeatCount - result.visibleFirstBeatCount,
    });
  }
  if (result.visibleTargetCount !== result.targetCount) {
    failures.push({
      code: "no-js-motion-target-hidden",
      count: result.targetCount - result.visibleTargetCount,
    });
  }
  if (result.visiblePanelCount !== result.panelCount) {
    failures.push({
      code: "no-js-motion-panel-hidden",
      count: result.panelCount - result.visiblePanelCount,
    });
  }

  return {
    evidence: {
      declaredRootCount: motionMoveSlugs.length,
      foundRootCount: result.rootCounts.filter((count) => count === 1).length,
      firstBeatCount: result.firstBeatCount,
      visibleFirstBeatCount: result.visibleFirstBeatCount,
      targetCount: result.targetCount,
      visibleTargetCount: result.visibleTargetCount,
      panelCount: result.panelCount,
      visiblePanelCount: result.visiblePanelCount,
      noJavaScriptFallbackPassed: failures.length === 0,
      contractPassed: failures.length === 0,
    },
    failures,
  };
}

async function probeControls({
  page,
  previewUrl,
  viewportName,
  motionMoveSlugs,
}) {
  const interactiveSlugs = motionMoveSlugs.filter((slug) =>
    INTERACTIVE_SLUGS.has(slug),
  );
  if (interactiveSlugs.length === 0) {
    return { evidence: emptyControlEvidence(), failures: [] };
  }

  const linkage = await page.evaluate((slugs) => {
    const records = [];
    for (let subjectIndex = 0; subjectIndex < slugs.length; subjectIndex += 1) {
      const slug = slugs[subjectIndex];
      const roots = [...document.querySelectorAll(`[data-motion-root="${slug}"]`)];
      const root = roots.length === 1 ? roots[0] : null;
      const controls = root
        ? [...root.querySelectorAll("[data-motion-control]")]
        : [];
      records.push({
        slug,
        subjectIndex,
        rootCount: roots.length,
        controlCount: controls.length,
        linked: controls.map((control) => {
          const panelId = control.getAttribute("aria-controls");
          const panel = panelId ? document.getElementById(panelId) : null;
          return Boolean(
            panel &&
              root.contains(panel) &&
              panel.dataset.motionPanel === control.dataset.motionControl,
          );
        }),
        enterPassed: true,
        spacePassed: true,
        tapChecked: false,
        tapPassed: true,
      });
    }
    return records;
  }, interactiveSlugs);

  const failures = [];
  let controlCount = 0;
  let ariaLinkedCount = 0;
  for (const record of linkage) {
    record.ariaLinkedCount = record.linked.filter(Boolean).length;
    controlCount += record.controlCount;
    ariaLinkedCount += record.ariaLinkedCount;
    if (record.rootCount !== 1) {
      failures.push({
        code:
          record.rootCount === 0
            ? "motion-control-root-missing"
            : "motion-control-root-count",
        subjectIndex: record.subjectIndex,
        count: record.rootCount,
      });
      continue;
    }
    if (record.controlCount < 2) {
      failures.push({
        code: "motion-control-count",
        subjectIndex: record.subjectIndex,
        count: record.controlCount,
      });
    }
    const invalidLinkCount = record.linked.filter((linked) => !linked).length;
    if (invalidLinkCount > 0) {
        failures.push({
          code: "motion-control-aria-link",
          subjectIndex: record.subjectIndex,
          count: invalidLinkCount,
        });
    }
  }

  const actions = ["Enter", "Space"];
  if (viewportName === "tablet" || viewportName === "phone") {
    actions.push("tap");
  }
  const actionPassed = { Enter: true, Space: true, tap: true };

  for (let rootIndex = 0; rootIndex < interactiveSlugs.length; rootIndex += 1) {
    const record = linkage[rootIndex];
    const slug = record.slug;
    const totalControls = record.controlCount;
    if (record.rootCount !== 1 || totalControls < 2) continue;
    for (const action of actions) {
      if (action === "tap") record.tapChecked = true;
      for (let subjectIndex = 0; subjectIndex < totalControls; subjectIndex += 1) {
        await navigateAndSettle(page, previewUrl);
        const root = page.locator(`[data-motion-root="${slug}"]`);
        if ((await root.count()) !== 1) {
          actionPassed[action] = false;
          recordActionFailure(record, action);
          failures.push({
            code: "motion-control-root-count",
            subjectIndex: record.subjectIndex,
            count: await root.count(),
          });
          continue;
        }
        const controls = root.locator("[data-motion-control]");
        if ((await controls.count()) !== totalControls) {
          actionPassed[action] = false;
          recordActionFailure(record, action);
          failures.push({
            code: "motion-control-count",
            subjectIndex: record.subjectIndex,
            count: await controls.count(),
          });
          continue;
        }
        const target = controls.nth(subjectIndex);
        const baselineControl = controls.nth((subjectIndex + 1) % totalControls);
        try {
          await baselineControl.click({ timeout: INTERACTION_TIMEOUT_MS });
        } catch {
          actionPassed[action] = false;
          recordActionFailure(record, action);
          failures.push({
            code: "motion-control-click",
            subjectIndex: record.subjectIndex,
          });
          continue;
        }
        await waitTwoFrames(page);
        let before;
        try {
          before = await selectedPanelIndex(root);
        } catch {
          actionPassed[action] = false;
          recordActionFailure(record, action);
          failures.push({
            code: "motion-control-state",
            subjectIndex: record.subjectIndex,
          });
          continue;
        }

        if (action === "tap") {
          try {
            await target.tap({ timeout: INTERACTION_TIMEOUT_MS });
          } catch {
            actionPassed[action] = false;
            recordActionFailure(record, action);
            failures.push({
              code: "motion-control-tap",
              subjectIndex: record.subjectIndex,
            });
            continue;
          }
        } else {
          let focused = false;
          try {
            await target.focus({ timeout: INTERACTION_TIMEOUT_MS });
            focused = await target.evaluate(
              (element) => document.activeElement === element,
            );
          } catch {
            focused = false;
          }
          if (!focused) {
            actionPassed[action] = false;
            recordActionFailure(record, action);
            failures.push({
              code: "motion-control-focus",
              subjectIndex: record.subjectIndex,
            });
            failures.push({
              code:
                action === "Enter"
                  ? "motion-control-enter"
                  : "motion-control-space",
              subjectIndex: record.subjectIndex,
            });
            continue;
          }
          await page.keyboard.press(action);
        }
        await waitTwoFrames(page);
        let after;
        let expected;
        try {
          after = await selectedPanelIndex(root);
          expected = await targetPanelIndex(root, target);
        } catch {
          after = -1;
          expected = -1;
        }
        const passed = before >= 0 && after !== before && after === expected;
        if (!passed) {
          actionPassed[action] = false;
          recordActionFailure(record, action);
          failures.push({
            code:
              action === "tap"
                ? "motion-control-tap"
                : action === "Enter"
                  ? "motion-control-enter"
                  : "motion-control-space",
            subjectIndex,
          });
        }
      }
    }
  }

  return {
    evidence: {
      controlCount,
      ariaLinkedCount,
      roots: linkage.map(({ linked, ...record }) => record),
      enterPassed: actionPassed.Enter,
      spacePassed: actionPassed.Space,
      tapChecked: actions.includes("tap"),
      tapPassed: actionPassed.tap,
    },
    failures,
  };
}

async function selectedPanelIndex(root) {
  return root.evaluate((element) => {
    const selected = element.dataset.motionSelected;
    return [...element.querySelectorAll("[data-motion-panel]")].findIndex(
      (panel) =>
        panel.dataset.motionPanel === selected &&
        !panel.hidden &&
        panel.getAttribute("aria-hidden") !== "true",
    );
  });
}

async function targetPanelIndex(root, target) {
  const targetValue = await target.getAttribute("data-motion-control");
  return root.evaluate(
    (element, value) =>
      [...element.querySelectorAll("[data-motion-panel]")].findIndex(
        (panel) => panel.dataset.motionPanel === value,
      ),
    targetValue,
  );
}

async function waitTwoFrames(page) {
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
}

function counterFailures(counters, viewport, mode) {
  const failures = [];
  for (const [field, code] of [
    ["consoleErrorCount", "console-error"],
    ["pageErrorCount", "page-error"],
    ["externalRequestCount", "external-request"],
    ["requestFailureCount", "request-failed"],
  ]) {
    if (counters[field] > 0) {
      failures.push({ code, viewport, mode, count: counters[field] });
    }
  }
  return failures;
}

function tagFailures(failures, viewport, mode) {
  return failures.map((failure) => ({ ...failure, viewport, mode }));
}

async function readAssetGate({ target, siteDir, runRoot, build }) {
  let candidate;
  try {
    candidate = JSON.parse(await readFile(target, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") {
      return {
        manifestPresent: false,
        assetsResolved: false,
        failures: [{ code: "assets-manifest-missing" }],
      };
    }
    return {
      manifestPresent: true,
      assetsResolved: false,
      failures: [{ code: "assets-manifest-invalid" }],
    };
  }

  try {
    const integrity = await validateAssetIntegrity(candidate, {
      build,
      siteDir,
      runRoot,
    });
    if (!integrity.valid) {
      return {
        manifestPresent: true,
        assetsResolved: false,
        failures: [{ code: "assets-manifest-invalid" }],
      };
    }
    return {
      manifestPresent: true,
      assetsResolved: integrity.assetsResolved,
      failures: [],
    };
  } catch (error) {
    if (error?.code === UNTRUSTED_PATH_ERROR) throw error;
    return {
      manifestPresent: true,
      assetsResolved: false,
      failures: [{ code: "assets-manifest-invalid" }],
    };
  }
}

async function readBuildGate(target) {
  try {
    const candidate = JSON.parse(await readFile(target, "utf8"));
    const moves = candidate?.designNotes?.motionMoves;
    if (
      !Array.isArray(moves) ||
      moves.length < 1 ||
      moves.length > 2 ||
      new Set(moves).size !== moves.length ||
      moves.some((move) => !Object.hasOwn(MOTION_MOVE_SLUGS, move))
    ) {
      return {
        build: candidate,
        motionMoveSlugs: [],
        failures: [{ code: "build-motion-manifest-invalid" }],
      };
    }
    return {
      build: candidate,
      motionMoveSlugs: moves.map((move) => MOTION_MOVE_SLUGS[move]),
      failures: [],
    };
  } catch (error) {
    return {
      build: null,
      motionMoveSlugs: [],
      failures: [
        {
          code:
            error?.code === "ENOENT"
              ? "build-manifest-missing"
              : "build-motion-manifest-invalid",
        },
      ],
    };
  }
}

function summarizeContext(evidence) {
  return {
    contextCount: 1,
    externalRequestCount: evidence.network.externalRequestCount,
    requestFailureCount: evidence.network.requestFailureCount,
    consoleErrorCount: evidence.network.consoleErrorCount,
    pageErrorCount: evidence.network.pageErrorCount,
    brokenImageCount: evidence.base.brokenImageCount,
  };
}

function summarizeContexts(contexts) {
  const totals = {
    contextCount: 0,
    externalRequestCount: 0,
    requestFailureCount: 0,
    consoleErrorCount: 0,
    pageErrorCount: 0,
    brokenImageCount: 0,
  };
  for (const modes of Object.values(contexts)) {
    for (const evidence of Object.values(modes)) {
      const contextTotals = summarizeContext(evidence);
      for (const field of CONTEXT_TOTAL_FIELDS) {
        totals[field] += contextTotals[field];
      }
    }
  }
  return totals;
}

function sortFailures(failures) {
  return failures
    .map((failure) => ({ ...failure }))
    .sort(
      (left, right) =>
        (FAILURE_VIEWPORT_ORDER[left.viewport ?? "none"] ?? 99) -
          (FAILURE_VIEWPORT_ORDER[right.viewport ?? "none"] ?? 99) ||
        (FAILURE_MODE_ORDER[left.mode ?? "none"] ?? 99) -
          (FAILURE_MODE_ORDER[right.mode ?? "none"] ?? 99) ||
        left.code.localeCompare(right.code) ||
        (left.subjectIndex ?? -1) - (right.subjectIndex ?? -1) ||
        (left.count ?? -1) - (right.count ?? -1),
    );
}

function isExactOrigin(rawUrl, exactOrigin) {
  try {
    return new URL(rawUrl).origin === exactOrigin;
  } catch {
    return false;
  }
}

function emptyFirstBeatEvidence() {
  return {
    sectionCount: 0,
    exactFirstBeatCount: 0,
    visibleFirstBeatCount: 0,
  };
}

function emptyTouchEvidence() {
  return { checkedCount: 0, passingCount: 0 };
}

function emptyControlEvidence() {
  return {
    controlCount: 0,
    ariaLinkedCount: 0,
    roots: [],
    enterPassed: true,
    spacePassed: true,
    tapChecked: false,
    tapPassed: true,
  };
}

function recordActionFailure(record, action) {
  if (action === "Enter") record.enterPassed = false;
  if (action === "Space") record.spacePassed = false;
  if (action === "tap") record.tapPassed = false;
}

async function validateAssetIntegrity(candidate, { build, siteDir, runRoot }) {
  if (
    !isPlainObject(candidate) ||
    !hasExactKeys(candidate, ASSET_EVIDENCE_FIELDS) ||
    candidate.schemaVersion !== "1.0" ||
    typeof candidate.allResolved !== "boolean" ||
    !Array.isArray(candidate.files) ||
    candidate.files.length < 3 ||
    candidate.files.length > MAX_IMAGE_REQUESTS_PER_CYCLE ||
    !isPlainObject(build) ||
    !Array.isArray(build.imagePlan) ||
    build.imagePlan.length !== candidate.files.length ||
    !isPlainObject(build.assetSummary) ||
    !hasExactKeys(build.assetSummary, ASSET_SUMMARY_FIELDS) ||
    typeof build.designNotes?.shootDirection !== "string" ||
    !build.designNotes.shootDirection.trim()
  ) {
    return { valid: false, assetsResolved: false };
  }
  for (const count of [
    candidate.requestCount,
    candidate.successCount,
    candidate.fallbackCount,
  ]) {
    if (!Number.isInteger(count) || count < 0 || count > MAX_IMAGE_REQUESTS_PER_CYCLE) {
      return { valid: false, assetsResolved: false };
    }
  }

  const planByFilename = new Map();
  for (const item of build.imagePlan) {
    if (
      !isPlainObject(item) ||
      !hasExactKeys(item, IMAGE_PLAN_FIELDS) ||
      !SAFE_ASSET_FILENAME.test(item.filename ?? "") ||
      planByFilename.has(item.filename) ||
      typeof item.role !== "string" ||
      !item.role.trim() ||
      typeof item.alt !== "string" ||
      !item.alt.trim() ||
      typeof item.prompt !== "string" ||
      !item.prompt.trim() ||
      !isPlainObject(item.focalPoint) ||
      !hasExactKeys(item.focalPoint, ["x", "y"]) ||
      !isFocalPoint(item.focalPoint)
    ) {
      return { valid: false, assetsResolved: false };
    }
    planByFilename.set(item.filename, item);
  }

  const filenames = new Set();
  let openaiCount = 0;
  let fallbackCount = 0;
  let assetsResolved = true;
  for (const file of candidate.files) {
    if (
      !isPlainObject(file) ||
      !hasExactKeys(file, ASSET_FILE_FIELDS) ||
      !SAFE_ASSET_FILENAME.test(file.filename ?? "") ||
      filenames.has(file.filename) ||
      file.path !== `assets/${file.filename}` ||
      typeof file.role !== "string" ||
      !file.role.trim() ||
      typeof file.alt !== "string" ||
      !file.alt.trim() ||
      !isPlainObject(file.focalPoint) ||
      !hasExactKeys(file.focalPoint, ["x", "y"]) ||
      !isFocalPoint(file.focalPoint) ||
      !SHA256_HEX.test(file.promptHash ?? "") ||
      file.mediaType !== "image/png" ||
      !Number.isInteger(file.bytes) ||
      file.bytes < 1 ||
      !SHA256_HEX.test(file.sha256 ?? "")
    ) {
      return { valid: false, assetsResolved: false };
    }
    filenames.add(file.filename);
    const planned = planByFilename.get(file.filename);
    if (
      !planned ||
      file.role !== planned.role ||
      file.alt !== planned.alt ||
      file.focalPoint.x !== planned.focalPoint.x ||
      file.focalPoint.y !== planned.focalPoint.y ||
      file.promptHash !== sha256Hex(`${build.designNotes.shootDirection}\n\n${planned.prompt}`)
    ) {
      return { valid: false, assetsResolved: false };
    }

    const assetPath = resolveInside(siteDir, "assets", file.filename);
    await assertNoLinkedPath(runRoot, assetPath);
    const bytes = await readFile(assetPath);
    try {
      validatePngBuffer(bytes, { expectedWidth: 1536, expectedHeight: 1024 });
    } catch {
      return { valid: false, assetsResolved: false };
    }
    const actualDigest = sha256Hex(bytes);
    if (file.bytes !== bytes.length || file.sha256 !== actualDigest) {
      return { valid: false, assetsResolved: false };
    }
    const deterministicDigest = sha256Hex(
      createDeterministicPng({
        ...planned,
        shootDirection: build.designNotes.shootDirection,
      }),
    );
    const deterministicBytes = actualDigest === deterministicDigest;
    const generated =
      (file.source === "openai" || file.source === "carried-forward") &&
      file.resolved === true &&
      file.errorCode === null &&
      !deterministicBytes;
    const fallback =
      file.source === "deterministic-fallback" &&
      file.resolved === false &&
      file.errorCode === "IMAGE_REQUEST_FAILED" &&
      deterministicBytes;
    if (!generated && !fallback) return { valid: false, assetsResolved: false };
    if (file.source === "openai") openaiCount += 1;
    if (fallback) fallbackCount += 1;
    if (!file.resolved) assetsResolved = false;
  }

  if (filenames.size !== planByFilename.size) {
    return { valid: false, assetsResolved: false };
  }
  const derivedSummary = {
    allResolved: assetsResolved,
    requestCount: openaiCount + fallbackCount,
    successCount: openaiCount,
    fallbackCount,
  };
  const valid =
    candidate.successCount === openaiCount &&
    candidate.fallbackCount === fallbackCount &&
    candidate.requestCount === openaiCount + fallbackCount &&
    candidate.allResolved === assetsResolved &&
    ASSET_SUMMARY_FIELDS.every(
      (field) => build.assetSummary[field] === derivedSummary[field],
    );
  return { valid, assetsResolved: valid && assetsResolved };
}

async function readReusableEvidencePacket({
  cycle,
  runRoot,
  outputPaths,
  desktopPath,
  tabletPath,
  mobilePath,
  visibleTextPath,
  mechanicalPath,
  screenshotManifestPath,
  fullPagePaths,
  criticManifestPath,
  assetGate,
  buildGate,
}) {
  const present = await Promise.all(
    outputPaths.map((target) => evidenceFilePresent(target, runRoot)),
  );
  if (present.every((value) => !value)) return null;
  if (!present.every(Boolean)) throw invalidEvidencePacket();

  try {
    const [
      desktop,
      tablet,
      phone,
      fullPageDesktop,
      fullPageTablet,
      fullPagePhone,
      visibleText,
      mechanicalText,
      manifestText,
      criticManifestText,
    ] =
      await Promise.all([
        readFile(desktopPath),
        readFile(tabletPath),
        readFile(mobilePath),
        readFile(fullPagePaths.desktop),
        readFile(fullPagePaths.tablet),
        readFile(fullPagePaths.phone),
        readFile(visibleTextPath, "utf8"),
        readFile(mechanicalPath, "utf8"),
        readFile(screenshotManifestPath, "utf8"),
        readFile(criticManifestPath, "utf8"),
      ]);
    const mechanical = JSON.parse(mechanicalText);
    const screenshotManifest = JSON.parse(manifestText);
    const criticManifest = JSON.parse(criticManifestText);
    const fullPageBuffers = {
      desktop: fullPageDesktop,
      tablet: fullPageTablet,
      phone: fullPagePhone,
    };
    const canonicalBuffers = { desktop, tablet, phone };
    const imageMetadata = inspectCriticImagePayload({
      canonicalBuffers,
      fullPageBuffers,
    });
    if (
      !isReusableScreenshot(imageMetadata.canonical.desktop, EVIDENCE_VIEWPORTS.desktop) ||
      !isReusableScreenshot(imageMetadata.canonical.tablet, EVIDENCE_VIEWPORTS.tablet) ||
      !isReusableScreenshot(imageMetadata.canonical.phone, EVIDENCE_VIEWPORTS.phone) ||
      !visibleText.trim() ||
      !isReusableMechanical(mechanical, { cycle, assetGate, buildGate }) ||
      !isReusableScreenshotManifest(screenshotManifest, { cycle, mechanical }) ||
      !isReusableCriticManifest(criticManifest, {
        cycle,
        buffers: fullPageBuffers,
        metadata: imageMetadata.fullPage,
        canonicalManifestBytes: Buffer.from(manifestText, "utf8"),
        canonicalBuffers,
      })
    ) {
      throw invalidEvidencePacket();
    }
    return {
      cycle,
      desktopPath,
      tabletPath,
      mobilePath,
      phonePath: mobilePath,
      fullPagePaths,
      visibleTextPath,
      mechanical,
      assetsResolved: assetGate.assetsResolved,
      screenshotManifest,
      criticManifest,
      evidencePacketSha256: createRenderedEvidencePacketSha256({
        canonicalManifestBytes: Buffer.from(manifestText, "utf8"),
        canonicalBuffers,
        criticManifestBytes: Buffer.from(criticManifestText, "utf8"),
        fullPageBuffers,
        mechanical,
      }),
    };
  } catch (error) {
    if (error?.code === UNTRUSTED_PATH_ERROR || error?.code === EVIDENCE_PACKET_ERROR) {
      throw error;
    }
    throw invalidEvidencePacket(error);
  }
}

async function evidenceFilePresent(target, runRoot) {
  await assertNoLinkedPath(runRoot, target);
  try {
    const stats = await lstat(target);
    if (!stats.isFile()) throw invalidEvidencePacket();
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

function isReusableScreenshot(metadata, viewport) {
  return metadata?.width === viewport.width && metadata?.height === viewport.height;
}

function inspectCriticImagePayload({ canonicalBuffers, fullPageBuffers }) {
  const canonical = {};
  const fullPage = {};
  for (const viewportName of VISUAL_VIEWPORTS) {
    const viewport = EVIDENCE_VIEWPORTS[viewportName];
    canonical[viewportName] = inspectPngBuffer(canonicalBuffers?.[viewportName], {
      expectedWidth: viewport.width,
      expectedHeight: viewport.height,
      maxBytes: MAX_CRITIC_IMAGE_BYTES,
      maxWidth: viewport.width,
      maxHeight: viewport.height,
      maxDecodedBytes: MAX_CRITIC_DECODED_IMAGE_BYTES,
    });
    const fullPageMetadata = inspectPngBuffer(fullPageBuffers?.[viewportName], {
      maxBytes: MAX_CRITIC_IMAGE_BYTES,
      maxWidth: MAX_CRITIC_RENDERED_WIDTH,
      maxHeight: MAX_CRITIC_FULL_PAGE_HEIGHT,
      maxDecodedBytes: MAX_CRITIC_DECODED_IMAGE_BYTES,
    });
    if (
      fullPageMetadata.width < viewport.width ||
      fullPageMetadata.height < viewport.height
    ) {
      throw new PngValidationError();
    }
    fullPage[viewportName] = fullPageMetadata;
  }
  assertCriticEvidenceLimits({ canonical, fullPage });
  return { canonical, fullPage };
}

function isReusableMechanical(candidate, { cycle, assetGate, buildGate }) {
  const fields = [
    "schemaVersion",
    "cycle",
    "passed",
    "assetsResolved",
    "assetManifestPresent",
    "motionMoveSlugs",
    "contexts",
    "failures",
    "totals",
  ];
  if (
    !isPlainObject(candidate) ||
    !hasExactKeys(candidate, fields) ||
    candidate.schemaVersion !== "2.0" ||
    candidate.cycle !== cycle ||
    typeof candidate.passed !== "boolean" ||
    candidate.assetsResolved !== assetGate.assetsResolved ||
    candidate.assetManifestPresent !== assetGate.manifestPresent ||
    JSON.stringify(candidate.motionMoveSlugs) !== JSON.stringify(buildGate.motionMoveSlugs) ||
    !isReusableContexts(candidate.contexts, buildGate.motionMoveSlugs) ||
    !Array.isArray(candidate.failures) ||
    !isPlainObject(candidate.totals) ||
    !hasExactKeys(candidate.totals, CONTEXT_TOTAL_FIELDS)
  ) {
    return false;
  }

  const derivedTotals = summarizeContexts(candidate.contexts);
  if (
    !CONTEXT_TOTAL_FIELDS.every(
      (field) =>
        isNonnegativeInteger(candidate.totals[field]) &&
        candidate.totals[field] === derivedTotals[field],
    )
  ) {
    return false;
  }

  const contextFailures = Object.values(candidate.contexts).flatMap((modes) =>
    Object.values(modes).flatMap((context) => context.failures),
  );
  const derivedFailures = sortFailures([
    ...assetGate.failures,
    ...buildGate.failures,
    ...contextFailures,
  ]);
  return (
    JSON.stringify(candidate.failures) === JSON.stringify(derivedFailures) &&
    candidate.passed === (derivedFailures.length === 0)
  );
}

function isReusableContexts(contexts, motionMoveSlugs) {
  if (
    !isPlainObject(contexts) ||
    !hasExactKeys(contexts, Object.keys(REQUIRED_CONTEXT_MODES))
  ) {
    return false;
  }
  for (const [viewportName, requiredModes] of Object.entries(REQUIRED_CONTEXT_MODES)) {
    const modes = contexts[viewportName];
    if (!isPlainObject(modes) || !hasExactKeys(modes, requiredModes)) return false;
    for (const mode of requiredModes) {
      if (!isReusableContext(modes[mode], { viewportName, mode, motionMoveSlugs })) {
        return false;
      }
    }
  }
  return true;
}

function isReusableContext(candidate, { viewportName, mode, motionMoveSlugs }) {
  const viewport = EVIDENCE_VIEWPORTS[viewportName];
  if (
    !isPlainObject(candidate) ||
    !hasExactKeys(candidate, CONTEXT_EVIDENCE_FIELDS) ||
    !isPlainObject(candidate.viewport) ||
    !hasExactKeys(candidate.viewport, ["width", "height"]) ||
    candidate.viewport.width !== viewport.width ||
    candidate.viewport.height !== viewport.height ||
    candidate.mode !== mode ||
    !isReusableBaseEvidence(candidate.base, viewport) ||
    !isReusableFirstBeatEvidence(candidate.firstBeats) ||
    !isReusableTouchEvidence(candidate.touchTargets, { viewportName, mode }) ||
    !isReusableControlEvidence(candidate.controls, {
      viewportName,
      mode,
      motionMoveSlugs,
    }) ||
    !isReusableMotionEvidence(candidate.motion, {
      viewportName,
      mode,
      motionMoveSlugs,
    }) ||
    !isReusableNetworkEvidence(candidate.network) ||
    typeof candidate.passed !== "boolean" ||
    !isReusableContextFailures(candidate.failures, candidate, {
      viewportName,
      mode,
      motionMoveSlugs,
    }) ||
    !motionContractMatchesFailures(candidate, {
      viewportName,
      mode,
      motionMoveSlugs,
    }) ||
    !isPlainObject(candidate.totals) ||
    !hasExactKeys(candidate.totals, CONTEXT_TOTAL_FIELDS)
  ) {
    return false;
  }

  const derivedTotals = summarizeContext(candidate);
  if (
    !CONTEXT_TOTAL_FIELDS.every(
      (field) =>
        isNonnegativeInteger(candidate.totals[field]) &&
        candidate.totals[field] === derivedTotals[field],
    )
  ) {
    return false;
  }

  const passedFromFailures = candidate.failures.length === 0;
  return (
    candidate.passed === passedFromFailures &&
    candidate.passed === contextEvidencePasses(candidate, viewportName)
  );
}

function isReusableBaseEvidence(candidate, viewport) {
  if (
    !isPlainObject(candidate) ||
    !hasExactKeys(candidate, BASE_EVIDENCE_FIELDS) ||
    candidate.viewportWidth !== viewport.width ||
    candidate.viewportHeight !== viewport.height ||
    !isNonnegativeInteger(candidate.scrollWidth) ||
    candidate.scrollWidth < candidate.viewportWidth ||
    typeof candidate.horizontalOverflow !== "boolean" ||
    candidate.horizontalOverflow !== candidate.scrollWidth > candidate.viewportWidth + 1
  ) {
    return false;
  }
  for (const field of [
    "h1Count",
    "mainCount",
    "internalAnchorCount",
    "brokenAnchorCount",
    "imageCount",
    "missingAltCount",
    "brokenImageCount",
    "visibleTextLength",
  ]) {
    if (!isNonnegativeInteger(candidate[field])) return false;
  }
  return (
    candidate.brokenAnchorCount <= candidate.internalAnchorCount &&
    candidate.missingAltCount <= candidate.imageCount &&
    candidate.brokenImageCount <= candidate.imageCount
  );
}

function isReusableFirstBeatEvidence(candidate) {
  return (
    isPlainObject(candidate) &&
    hasExactKeys(candidate, FIRST_BEAT_EVIDENCE_FIELDS) &&
    FIRST_BEAT_EVIDENCE_FIELDS.every((field) => isNonnegativeInteger(candidate[field])) &&
    candidate.exactFirstBeatCount <= candidate.sectionCount &&
    candidate.visibleFirstBeatCount <= candidate.exactFirstBeatCount
  );
}

function isReusableTouchEvidence(candidate, { viewportName, mode }) {
  if (
    !isPlainObject(candidate) ||
    !hasExactKeys(candidate, TOUCH_EVIDENCE_FIELDS) ||
    !TOUCH_EVIDENCE_FIELDS.every((field) => isNonnegativeInteger(candidate[field])) ||
    candidate.passingCount > candidate.checkedCount
  ) {
    return false;
  }
  const probed = mode === "normal" && (viewportName === "tablet" || viewportName === "phone");
  return probed || recordsEqual(candidate, emptyTouchEvidence(), TOUCH_EVIDENCE_FIELDS);
}

function isReusableControlEvidence(candidate, { viewportName, mode, motionMoveSlugs }) {
  if (
    !isPlainObject(candidate) ||
    !hasExactKeys(candidate, CONTROL_EVIDENCE_FIELDS) ||
    !isNonnegativeInteger(candidate.controlCount) ||
    !isNonnegativeInteger(candidate.ariaLinkedCount) ||
    candidate.ariaLinkedCount > candidate.controlCount ||
    !Array.isArray(candidate.roots) ||
    !["enterPassed", "spacePassed", "tapChecked", "tapPassed"].every(
      (field) => typeof candidate[field] === "boolean",
    )
  ) {
    return false;
  }

  const interactiveSlugs = motionMoveSlugs.filter((slug) => INTERACTIVE_SLUGS.has(slug));
  if (mode !== "normal" || viewportName === "narrow" || interactiveSlugs.length === 0) {
    return recordsEqual(candidate, emptyControlEvidence(), CONTROL_EVIDENCE_FIELDS);
  }
  if (candidate.roots.length !== interactiveSlugs.length) return false;

  for (let index = 0; index < candidate.roots.length; index += 1) {
    const record = candidate.roots[index];
    if (
      !isPlainObject(record) ||
      !hasExactKeys(record, CONTROL_ROOT_FIELDS) ||
      record.slug !== interactiveSlugs[index] ||
      record.subjectIndex !== index ||
      !["rootCount", "controlCount", "ariaLinkedCount"].every((field) =>
        isNonnegativeInteger(record[field]),
      ) ||
      record.ariaLinkedCount > record.controlCount ||
      !["enterPassed", "spacePassed", "tapChecked", "tapPassed"].every(
        (field) => typeof record[field] === "boolean",
      )
    ) {
      return false;
    }
    const tapWasChecked =
      (viewportName === "tablet" || viewportName === "phone") &&
      record.rootCount === 1 &&
      record.controlCount >= 2;
    if (record.tapChecked !== tapWasChecked || (!record.tapChecked && !record.tapPassed)) {
      return false;
    }
  }

  const controlCount = candidate.roots.reduce((sum, root) => sum + root.controlCount, 0);
  const ariaLinkedCount = candidate.roots.reduce(
    (sum, root) => sum + root.ariaLinkedCount,
    0,
  );
  return (
    candidate.controlCount === controlCount &&
    candidate.ariaLinkedCount === ariaLinkedCount &&
    candidate.enterPassed === candidate.roots.every((root) => root.enterPassed) &&
    candidate.spacePassed === candidate.roots.every((root) => root.spacePassed) &&
    candidate.tapChecked === (viewportName === "tablet" || viewportName === "phone") &&
    candidate.tapPassed === candidate.roots.every((root) => root.tapPassed)
  );
}

function isReusableMotionEvidence(candidate, { viewportName, mode, motionMoveSlugs }) {
  if (!isPlainObject(candidate)) return false;
  if (viewportName === "narrow") {
    const expected = emptyMotionEvidence(motionMoveSlugs.length);
    return (
      hasExactKeys(candidate, EMPTY_MOTION_FIELDS) &&
      recordsEqual(candidate, expected, EMPTY_MOTION_FIELDS)
    );
  }

  const commonCountsValid =
    candidate.declaredRootCount === motionMoveSlugs.length &&
    isNonnegativeInteger(candidate.foundRootCount) &&
    candidate.foundRootCount <= candidate.declaredRootCount &&
    isNonnegativeInteger(candidate.targetCount) &&
    isNonnegativeInteger(candidate.visibleTargetCount) &&
    candidate.visibleTargetCount <= candidate.targetCount &&
    typeof candidate.contractPassed === "boolean";
  if (!commonCountsValid) return false;

  if (mode === "normal") {
    return (
      hasExactKeys(candidate, NORMAL_MOTION_FIELDS) &&
      isNonnegativeInteger(candidate.activeRootCount) &&
      candidate.activeRootCount <= candidate.foundRootCount &&
      isNonnegativeInteger(candidate.progressChangedCount) &&
      candidate.progressChangedCount <=
        motionMoveSlugs.filter((slug) => slug === "pinned-chapter-passage").length &&
      isNonnegativeInteger(candidate.selectionChangedCount) &&
      candidate.selectionChangedCount <=
        motionMoveSlugs.filter((slug) => INTERACTIVE_SLUGS.has(slug)).length
    );
  }
  if (mode === "reducedMotion") {
    if (
      !hasExactKeys(candidate, REDUCED_MOTION_FIELDS) ||
      !isNonnegativeInteger(candidate.disabledRootCount) ||
      candidate.disabledRootCount > candidate.foundRootCount ||
      !isNonnegativeInteger(candidate.panelCount) ||
      !isNonnegativeInteger(candidate.visiblePanelCount) ||
      candidate.visiblePanelCount > candidate.panelCount ||
      typeof candidate.maxDurationMs !== "number" ||
      !Number.isFinite(candidate.maxDurationMs) ||
      candidate.maxDurationMs < 0 ||
      typeof candidate.reducedFallbackPassed !== "boolean"
    ) {
      return false;
    }
    const derivedPassed =
      candidate.foundRootCount === candidate.declaredRootCount &&
      candidate.disabledRootCount === candidate.declaredRootCount &&
      candidate.visibleTargetCount === candidate.targetCount &&
      candidate.visiblePanelCount === candidate.panelCount &&
      candidate.maxDurationMs <= MAX_REDUCED_DURATION_MS;
    return (
      candidate.reducedFallbackPassed === derivedPassed &&
      candidate.contractPassed === derivedPassed
    );
  }
  if (mode === "javascriptDisabled") {
    if (
      !hasExactKeys(candidate, NO_JAVASCRIPT_MOTION_FIELDS) ||
      !isNonnegativeInteger(candidate.firstBeatCount) ||
      !isNonnegativeInteger(candidate.visibleFirstBeatCount) ||
      candidate.visibleFirstBeatCount > candidate.firstBeatCount ||
      !isNonnegativeInteger(candidate.panelCount) ||
      !isNonnegativeInteger(candidate.visiblePanelCount) ||
      candidate.visiblePanelCount > candidate.panelCount ||
      typeof candidate.noJavaScriptFallbackPassed !== "boolean"
    ) {
      return false;
    }
    const derivedPassed =
      candidate.foundRootCount === candidate.declaredRootCount &&
      candidate.visibleFirstBeatCount === candidate.firstBeatCount &&
      candidate.visibleTargetCount === candidate.targetCount &&
      candidate.visiblePanelCount === candidate.panelCount;
    return (
      candidate.noJavaScriptFallbackPassed === derivedPassed &&
      candidate.contractPassed === derivedPassed
    );
  }
  return false;
}

function isReusableNetworkEvidence(candidate) {
  return (
    isPlainObject(candidate) &&
    hasExactKeys(candidate, NETWORK_EVIDENCE_FIELDS) &&
    NETWORK_EVIDENCE_FIELDS.every((field) => isNonnegativeInteger(candidate[field]))
  );
}

function isReusableContextFailures(
  failures,
  context,
  { viewportName, mode, motionMoveSlugs },
) {
  if (!Array.isArray(failures)) return false;
  for (const failure of failures) {
    if (
      !isPlainObject(failure) ||
      !Object.keys(failure).every((field) =>
        ["code", "viewport", "mode", "subjectIndex", "count"].includes(field),
      ) ||
      !CONTEXT_FAILURE_CODES.has(failure.code) ||
      failure.viewport !== viewportName ||
      failure.mode !== mode ||
      (Object.hasOwn(failure, "subjectIndex") &&
        !isNonnegativeInteger(failure.subjectIndex)) ||
      (Object.hasOwn(failure, "count") && !isNonnegativeInteger(failure.count)) ||
      !failureSupportedByContext(failure.code, context, {
        viewportName,
        mode,
        motionMoveSlugs,
      })
    ) {
      return false;
    }
  }
  if (JSON.stringify(failures) !== JSON.stringify(sortFailures(failures))) return false;

  const baseAndNetworkCodes = new Set([
    "horizontal-overflow",
    "h1-count",
    "main-count",
    "broken-internal-anchor",
    "image-alt-missing",
    "broken-image",
    "visible-text-empty",
    "console-error",
    "page-error",
    "external-request",
    "request-failed",
  ]);
  const derived = sortFailures([
    ...baseFailures(context.base, viewportName, mode),
    ...counterFailures(context.network, viewportName, mode),
  ]);
  const stored = failures.filter((failure) => baseAndNetworkCodes.has(failure.code));
  return JSON.stringify(stored) === JSON.stringify(derived);
}

function failureSupportedByContext(code, context, { viewportName, mode, motionMoveSlugs }) {
  if (
    [
      "horizontal-overflow",
      "h1-count",
      "main-count",
      "broken-internal-anchor",
      "image-alt-missing",
      "broken-image",
      "visible-text-empty",
      "console-error",
      "page-error",
      "external-request",
      "request-failed",
    ].includes(code)
  ) {
    return true;
  }
  if (viewportName === "narrow") return false;
  if (code === "section-first-beat-count") {
    return context.firstBeats.exactFirstBeatCount < context.firstBeats.sectionCount;
  }
  if (
    [
      "first-beat-zero-box",
      "first-beat-hidden",
      "first-beat-opacity",
      "first-beat-outside-upper-fold",
    ].includes(code)
  ) {
    return context.firstBeats.visibleFirstBeatCount < context.firstBeats.exactFirstBeatCount;
  }
  if (code === "touch-target-too-small") {
    return (
      mode === "normal" &&
      (viewportName === "tablet" || viewportName === "phone") &&
      context.touchTargets.passingCount < context.touchTargets.checkedCount
    );
  }

  const motion = context.motion;
  if (code === "motion-root-count") {
    return motion.foundRootCount < motion.declaredRootCount;
  }
  if (mode === "normal") {
    if (code === "motion-root-not-active") {
      return motion.activeRootCount < motion.foundRootCount;
    }
    if (code === "motion-progress-static") {
      return (
        motion.progressChangedCount <
        motionMoveSlugs.filter((slug) => slug === "pinned-chapter-passage").length
      );
    }
    if (code === "motion-panel-selection-static") {
      return (
        motion.selectionChangedCount <
        motionMoveSlugs.filter((slug) => INTERACTIVE_SLUGS.has(slug)).length
      );
    }
    if (code === "motion-target-not-visible") {
      return motion.targetCount === 0 || motion.visibleTargetCount < motion.targetCount;
    }
    if (code.startsWith("motion-control-")) {
      return !controlsEvidencePasses(context.controls);
    }
  }
  if (mode === "reducedMotion") {
    if (code === "reduced-motion-root-not-disabled") {
      return motion.disabledRootCount < motion.declaredRootCount;
    }
    if (code === "reduced-motion-target-hidden") {
      return motion.visibleTargetCount < motion.targetCount;
    }
    if (code === "reduced-motion-panel-hidden") {
      return motion.visiblePanelCount < motion.panelCount;
    }
    if (code === "reduced-motion-duration") {
      return motion.maxDurationMs > MAX_REDUCED_DURATION_MS;
    }
  }
  if (mode === "javascriptDisabled") {
    if (code === "no-js-first-beat-hidden") {
      return motion.visibleFirstBeatCount < motion.firstBeatCount;
    }
    if (code === "no-js-motion-target-hidden") {
      return motion.visibleTargetCount < motion.targetCount;
    }
    if (code === "no-js-motion-panel-hidden") {
      return motion.visiblePanelCount < motion.panelCount;
    }
  }
  return false;
}

function contextEvidencePasses(context, viewportName) {
  if (
    baseFailures(context.base, viewportName, context.mode).length > 0 ||
    counterFailures(context.network, viewportName, context.mode).length > 0
  ) {
    return false;
  }
  if (viewportName === "narrow") return true;
  return (
    context.firstBeats.exactFirstBeatCount === context.firstBeats.sectionCount &&
    context.firstBeats.visibleFirstBeatCount === context.firstBeats.sectionCount &&
    context.touchTargets.passingCount === context.touchTargets.checkedCount &&
    context.motion.contractPassed
  );
}

function motionContractMatchesFailures(
  context,
  { viewportName, mode, motionMoveSlugs },
) {
  if (viewportName === "narrow") return true;
  const hasMotionFailure = context.failures.some(
    ({ code }) =>
      code.startsWith("motion-") ||
      code.startsWith("reduced-motion-") ||
      code.startsWith("no-js-"),
  );
  if (context.motion.contractPassed !== !hasMotionFailure) return false;
  if (mode !== "normal" || !context.motion.contractPassed) return true;

  const pinnedCount = motionMoveSlugs.filter(
    (slug) => slug === "pinned-chapter-passage",
  ).length;
  const interactiveCount = motionMoveSlugs.filter((slug) =>
    INTERACTIVE_SLUGS.has(slug),
  ).length;
  const revealCount = motionMoveSlugs.filter(
    (slug) => slug === "staged-hero-entrance" || slug === "gentle-scroll-reveals",
  ).length;
  return (
    context.motion.foundRootCount === context.motion.declaredRootCount &&
    context.motion.activeRootCount === context.motion.declaredRootCount &&
    context.motion.progressChangedCount === pinnedCount &&
    context.motion.selectionChangedCount === interactiveCount &&
    context.motion.visibleTargetCount === context.motion.targetCount &&
    (revealCount === 0 || context.motion.targetCount >= revealCount) &&
    controlsEvidencePasses(context.controls)
  );
}

function controlsEvidencePasses(controls) {
  return (
    controls.roots.every(
      (root) =>
        root.rootCount === 1 &&
        root.controlCount >= 2 &&
        root.ariaLinkedCount === root.controlCount &&
        root.enterPassed &&
        root.spacePassed &&
        (!root.tapChecked || root.tapPassed),
    ) &&
    controls.enterPassed &&
    controls.spacePassed &&
    (!controls.tapChecked || controls.tapPassed)
  );
}

function isNonnegativeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function recordsEqual(left, right, fields) {
  return fields.every((field) => JSON.stringify(left[field]) === JSON.stringify(right[field]));
}

function createCriticManifest({
  cycle,
  capturedAt,
  buffers,
  metadata,
  canonicalCaptureSha256,
}) {
  if (!SHA256_HEX.test(canonicalCaptureSha256 || "")) {
    throw new Error("Canonical screenshot evidence binding is invalid.");
  }
  const manifest = {
    schemaVersion: "1.0",
    cycle,
    capturedAt,
    capture: "full-page",
    motionMode: "reducedMotion",
    canonicalCaptureSha256,
    viewports: Object.fromEntries(
      VISUAL_VIEWPORTS.map((viewportName) => {
        const buffer = buffers[viewportName];
        const viewport = EVIDENCE_VIEWPORTS[viewportName];
        const image = metadata[viewportName];
        if (
          !Buffer.isBuffer(buffer) ||
          image?.width < viewport.width ||
          image?.height < viewport.height
        ) {
          throw new Error("Rendered full page screenshot bytes are invalid.");
        }
        return [
          viewportName,
          {
            width: viewport.width,
            renderedWidth: image.width,
            height: image.height,
            path: `screenshots/critic/${CRITIC_FULL_PAGE_FILES[viewportName]}`,
            bytes: buffer.length,
            sha256: sha256Hex(buffer),
          },
        ];
      }),
    ),
  };
  return manifest;
}

function isReusableCriticManifest(
  candidate,
  { cycle, buffers, metadata, canonicalManifestBytes, canonicalBuffers },
) {
  const expectedCanonicalCaptureSha256 = createCanonicalCaptureSha256({
    manifestBytes: canonicalManifestBytes,
    buffers: canonicalBuffers,
  });
  if (
    !isPlainObject(candidate) ||
    !hasExactKeys(candidate, [
      "schemaVersion",
      "cycle",
      "capturedAt",
      "capture",
      "motionMode",
      "canonicalCaptureSha256",
      "viewports",
    ]) ||
    candidate.schemaVersion !== "1.0" ||
    candidate.cycle !== cycle ||
    typeof candidate.capturedAt !== "string" ||
    !Number.isFinite(Date.parse(candidate.capturedAt)) ||
    candidate.capture !== "full-page" ||
    candidate.motionMode !== "reducedMotion" ||
    !SHA256_HEX.test(candidate.canonicalCaptureSha256 || "") ||
    candidate.canonicalCaptureSha256 !== expectedCanonicalCaptureSha256 ||
    !isPlainObject(candidate.viewports) ||
    !hasExactKeys(candidate.viewports, VISUAL_VIEWPORTS)
  ) {
    return false;
  }
  return VISUAL_VIEWPORTS.every((viewportName) => {
    const record = candidate.viewports[viewportName];
    const viewport = EVIDENCE_VIEWPORTS[viewportName];
    const buffer = buffers[viewportName];
    const image = metadata[viewportName];
    return (
      isPlainObject(record) &&
      hasExactKeys(record, ["width", "renderedWidth", "height", "path", "bytes", "sha256"]) &&
      record.width === viewport.width &&
      Number.isSafeInteger(record.renderedWidth) &&
      record.renderedWidth >= record.width &&
      Number.isSafeInteger(record.height) &&
      record.height >= viewport.height &&
      record.path === `screenshots/critic/${CRITIC_FULL_PAGE_FILES[viewportName]}` &&
      Number.isSafeInteger(record.bytes) &&
      record.bytes > 0 &&
      SHA256_HEX.test(record.sha256) &&
      image?.width >= viewport.width &&
      image?.height >= viewport.height &&
      image.width === record.renderedWidth &&
      image.height === record.height &&
      buffer.length === record.bytes &&
      sha256Hex(buffer) === record.sha256
    );
  });
}

function createCanonicalCaptureSha256({ manifestBytes, buffers }) {
  if (!Buffer.isBuffer(manifestBytes) || !isPlainObject(buffers)) {
    throw new TypeError("Canonical screenshot evidence bytes are invalid.");
  }
  const entries = [
    { path: "screenshots/manifest.json", value: manifestBytes },
    ...VISUAL_VIEWPORTS.map((viewportName) => ({
      path: `screenshots/${EVIDENCE_VIEWPORTS[viewportName].filename}`,
      value: buffers[viewportName],
    })),
  ].map(({ path: relativePath, value }) => {
    if (!Buffer.isBuffer(value) || value.length === 0) {
      throw new TypeError("Canonical screenshot evidence bytes are invalid.");
    }
    return {
      path: relativePath,
      bytes: value.length,
      sha256: sha256Hex(value),
    };
  });
  return sha256Hex(Buffer.from(JSON.stringify(entries), "utf8"));
}

function isReusableScreenshotManifest(candidate, { cycle, mechanical }) {
  const networkFields = [
    "externalRequestCount",
    "requestFailureCount",
    "consoleErrorCount",
    "pageErrorCount",
  ];
  if (
    !isPlainObject(candidate) ||
    !hasExactKeys(candidate, ["schemaVersion", "cycle", "capturedAt", "viewports", "network"]) ||
    candidate.schemaVersion !== "2.0" ||
    candidate.cycle !== cycle ||
    typeof candidate.capturedAt !== "string" ||
    !Number.isFinite(Date.parse(candidate.capturedAt)) ||
    !isPlainObject(candidate.viewports) ||
    !hasExactKeys(candidate.viewports, VISUAL_VIEWPORTS) ||
    !isPlainObject(candidate.network) ||
    !hasExactKeys(candidate.network, networkFields)
  ) {
    return false;
  }
  for (const viewportName of VISUAL_VIEWPORTS) {
    const viewport = EVIDENCE_VIEWPORTS[viewportName];
    const record = candidate.viewports[viewportName];
    if (
      !isPlainObject(record) ||
      !hasExactKeys(record, ["width", "height", "path"]) ||
      record.width !== viewport.width ||
      record.height !== viewport.height ||
      record.path !== `screenshots/${viewport.filename}`
    ) {
      return false;
    }
  }
  return networkFields.every(
    (field) => isNonnegativeInteger(candidate.network[field]) &&
      candidate.network[field] === mechanical.totals[field],
  );
}

function invalidEvidencePacket(cause) {
  const error = new Error("Completed evidence packet is invalid.");
  error.code = EVIDENCE_PACKET_ERROR;
  if (cause !== undefined) error.cause = cause;
  return error;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value, expected) {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return (
    actual.length === wanted.length &&
    actual.every((key, index) => key === wanted[index])
  );
}

function isFocalPoint(value) {
  return (
    Number.isFinite(value.x) &&
    Number.isFinite(value.y) &&
    value.x >= 0 &&
    value.x <= 1 &&
    value.y >= 0 &&
    value.y <= 1
  );
}

function emptyMotionEvidence(declaredRootCount = 0) {
  return {
    declaredRootCount,
    foundRootCount: 0,
    activeRootCount: 0,
    disabledRootCount: 0,
    targetCount: 0,
    visibleTargetCount: 0,
    panelCount: 0,
    visiblePanelCount: 0,
    maxDurationMs: 0,
    progressChangedCount: 0,
    selectionChangedCount: 0,
    contractPassed: declaredRootCount === 0,
    reducedFallbackPassed: declaredRootCount === 0,
    noJavaScriptFallbackPassed: declaredRootCount === 0,
  };
}

function roundDuration(value) {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function cycleNumberFromPath(cycleDir) {
  const match = path.basename(path.resolve(cycleDir)).match(/^cycle-(\d{2})$/);
  return match ? Number(match[1]) : 0;
}

function validateEvidencePaths({ siteDir, cycleDir }) {
  if (!siteDir || !cycleDir) throw new TypeError("Evidence paths are required.");
  const normalizedCycleDir = path.resolve(cycleDir);
  const normalizedSiteDir = path.resolve(siteDir);
  if (
    !/^cycle-\d{2}$/.test(path.basename(normalizedCycleDir)) ||
    normalizedSiteDir !== path.join(normalizedCycleDir, "site")
  ) {
    throw new TypeError("Evidence paths must use one cycle directory and its site child.");
  }
  return {
    runRoot: path.dirname(normalizedCycleDir),
    cycleDir: normalizedCycleDir,
    siteDir: normalizedSiteDir,
    screenshotsDir: resolveInside(normalizedCycleDir, "screenshots"),
  };
}

async function assertNoLinkedPath(trustedRoot, target) {
  const root = path.resolve(trustedRoot);
  const resolvedTarget = path.resolve(target);
  const relative = path.relative(root, resolvedTarget);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw untrustedPathError();
  }
  try {
    const rootStats = await lstat(root);
    if (rootStats.isSymbolicLink()) throw untrustedPathError();
  } catch (error) {
    if (error?.code === UNTRUSTED_PATH_ERROR) throw error;
    throw error;
  }
  let current = root;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    try {
      if ((await lstat(current)).isSymbolicLink()) throw untrustedPathError();
    } catch (error) {
      if (error?.code === "ENOENT") return;
      throw error;
    }
  }
}

function untrustedPathError() {
  const error = new Error("Symlink, junction, or linked path ancestors are not allowed.");
  error.code = UNTRUSTED_PATH_ERROR;
  return error;
}

async function assertAbsent(target) {
  try {
    await lstat(target);
    throw new Error(`Evidence file already exists: ${path.basename(target)}`);
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }
}

async function writeBinaryNew(target, value, runRoot) {
  if (!Buffer.isBuffer(value) || value.length === 0) {
    throw new Error("Rendered screenshot bytes are missing.");
  }
  await writeExclusiveNew(target, value, runRoot);
}

async function writeTextNew(target, value, runRoot) {
  if (typeof value !== "string") throw new TypeError("Evidence text is invalid.");
  await writeExclusiveNew(
    target,
    value.endsWith("\n") ? value : `${value}\n`,
    runRoot,
    "utf8",
  );
}

async function writeJsonNew(target, value, runRoot) {
  await writeExclusiveNew(
    target,
    serializeJson(value),
    runRoot,
    "utf8",
  );
}

function serializeJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

async function writeExclusiveNew(target, value, runRoot, encoding) {
  await assertNoLinkedPath(runRoot, target);
  await mkdir(path.dirname(target), { recursive: true });
  await assertNoLinkedPath(runRoot, target);
  try {
    await writeFile(target, value, { flag: "wx", ...(encoding ? { encoding } : {}) });
  } catch (error) {
    if (error?.code === "EEXIST") {
      const conflict = new Error(`Evidence file already exists: ${path.basename(target)}`);
      conflict.code = "EEXIST";
      throw conflict;
    }
    throw error;
  }
}
