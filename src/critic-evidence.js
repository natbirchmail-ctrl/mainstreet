import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { chromium } from "playwright";

import { MOTION_MOVE_SLUGS } from "./motion.js";
import { resolveInside, writeJsonNew, writeTextNew } from "./lib/runs.js";
import { startStaticServer } from "./serve.js";

export const EVIDENCE_VIEWPORTS = Object.freeze({
  desktop: Object.freeze({
    width: 1440,
    height: 900,
    filename: "desktop-home.png",
    touch: false,
  }),
  tablet: Object.freeze({
    width: 1024,
    height: 768,
    filename: "tablet-home.png",
    touch: true,
  }),
  phone: Object.freeze({
    width: 390,
    height: 844,
    filename: "mobile-home.png",
    touch: true,
  }),
  narrow: Object.freeze({
    width: 320,
    height: 800,
    filename: null,
    touch: true,
  }),
});

const VISUAL_VIEWPORTS = Object.freeze(["desktop", "tablet", "phone"]);
const VISUAL_MODES = Object.freeze(["normal", "reducedMotion", "javascriptDisabled"]);
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

// The argument shape intentionally matches the original critic capture function
// so this module can be substituted without changing pipeline stage order.
export async function captureRenderedEvidence({
  siteDir,
  cycleDir,
  port = 4601,
  browserType = chromium,
  now = () => new Date(),
  startServer = startStaticServer,
}) {
  const cycle = cycleNumberFromPath(cycleDir);
  const screenshotsDir = resolveInside(cycleDir, "screenshots");
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
  const visibleTextPath = resolveInside(cycleDir, "visible-text.txt");
  const mechanicalPath = resolveInside(cycleDir, "mechanical.json");
  const screenshotManifestPath = resolveInside(screenshotsDir, "manifest.json");

  await Promise.all(
    [
      desktopPath,
      tabletPath,
      mobilePath,
      visibleTextPath,
      mechanicalPath,
      screenshotManifestPath,
    ].map(assertAbsent),
  );
  await mkdir(screenshotsDir, { recursive: true });

  const [assetGate, buildGate] = await Promise.all([
    readAssetGate(resolveInside(cycleDir, "assets.json")),
    readMotionGate(resolveInside(cycleDir, "build.json")),
  ]);
  const preview = await startServer({ root: siteDir, port });
  let browser;
  try {
    browser = await browserType.launch({ headless: true });
    const contexts = {};
    const screenshotBuffers = {};
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
        });
        contexts[viewportName][mode] = result.evidence;
        contextFailures.push(...result.failures);
        if (result.screenshot) {
          screenshotBuffers[viewportName] = result.screenshot;
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
    const screenshotManifest = {
      schemaVersion: "2.0",
      cycle,
      capturedAt: now().toISOString(),
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

    await Promise.all([
      writeBinaryNew(desktopPath, screenshotBuffers.desktop),
      writeBinaryNew(tabletPath, screenshotBuffers.tablet),
      writeBinaryNew(mobilePath, screenshotBuffers.phone),
      writeTextNew(visibleTextPath, visibleText),
      writeJsonNew(mechanicalPath, mechanical),
      writeJsonNew(screenshotManifestPath, screenshotManifest),
    ]);

    return {
      cycle,
      desktopPath,
      tabletPath,
      mobilePath,
      phonePath: mobilePath,
      visibleTextPath,
      mechanical,
      assetsResolved: assetGate.assetsResolved,
      screenshotManifest,
    };
  } finally {
    await browser?.close().catch(() => {});
    await preview.close().catch(() => {});
  }
}

export const captureCycleEvidence = captureRenderedEvidence;

async function captureContext({
  browser,
  previewUrl,
  viewportName,
  mode,
  motionMoveSlugs,
  captureScreenshot,
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
    if (captureScreenshot) {
      await page.waitForTimeout(450);
    }
    const screenshot = captureScreenshot
      ? await page.screenshot({ fullPage: false, type: "png" })
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
    return {
      screenshot,
      visibleText,
      evidence: {
        viewport: { width: viewport.width, height: viewport.height },
        mode,
        base,
        firstBeats,
        touchTargets,
        controls,
        motion,
        network: { ...counters },
      },
      failures,
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

async function probeFirstBeats(page, { animationFrames = true } = {}) {
  const results = animationFrames
    ? await page.evaluate(async () => {
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
    : await probeFirstBeatsWithoutFrames(page);

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
    await page.waitForTimeout(34);
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

async function readAssetGate(target) {
  try {
    const candidate = JSON.parse(await readFile(target, "utf8"));
    if (!isCanonicalAssetEvidence(candidate)) {
      return {
        manifestPresent: true,
        assetsResolved: false,
        failures: [{ code: "assets-manifest-invalid" }],
      };
    }
    return {
      manifestPresent: true,
      assetsResolved: candidate.allResolved,
      failures: [],
    };
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
}

async function readMotionGate(target) {
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
        motionMoveSlugs: [],
        failures: [{ code: "build-motion-manifest-invalid" }],
      };
    }
    return {
      motionMoveSlugs: moves.map((move) => MOTION_MOVE_SLUGS[move]),
      failures: [],
    };
  } catch (error) {
    return {
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
      totals.contextCount += 1;
      totals.externalRequestCount += evidence.network.externalRequestCount;
      totals.requestFailureCount += evidence.network.requestFailureCount;
      totals.consoleErrorCount += evidence.network.consoleErrorCount;
      totals.pageErrorCount += evidence.network.pageErrorCount;
      totals.brokenImageCount += evidence.base.brokenImageCount;
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

function isCanonicalAssetEvidence(candidate) {
  if (
    !isPlainObject(candidate) ||
    !hasExactKeys(candidate, ASSET_EVIDENCE_FIELDS) ||
    candidate.schemaVersion !== "1.0" ||
    typeof candidate.allResolved !== "boolean" ||
    !Array.isArray(candidate.files) ||
    candidate.files.length < 3 ||
    candidate.files.length > 5
  ) {
    return false;
  }
  for (const count of [
    candidate.requestCount,
    candidate.successCount,
    candidate.fallbackCount,
  ]) {
    if (!Number.isInteger(count) || count < 0 || count > 5) return false;
  }

  const filenames = new Set();
  let openaiCount = 0;
  let fallbackCount = 0;
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
      return false;
    }
    filenames.add(file.filename);
    const generated =
      (file.source === "openai" || file.source === "carried-forward") &&
      file.resolved === true &&
      file.errorCode === null;
    const fallback =
      file.source === "deterministic-fallback" &&
      file.resolved === false &&
      file.errorCode === "IMAGE_REQUEST_FAILED";
    if (!generated && !fallback) return false;
    if (file.source === "openai") openaiCount += 1;
    if (fallback) fallbackCount += 1;
  }

  return (
    candidate.successCount === openaiCount &&
    candidate.fallbackCount === fallbackCount &&
    candidate.requestCount === openaiCount + fallbackCount &&
    candidate.allResolved === candidate.files.every((file) => file.resolved)
  );
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

async function assertAbsent(target) {
  try {
    await access(target);
    throw new Error(`Evidence file already exists: ${path.basename(target)}`);
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }
}

async function writeBinaryNew(target, value) {
  if (!Buffer.isBuffer(value) || value.length === 0) {
    throw new Error("Rendered screenshot bytes are missing.");
  }
  await mkdir(path.dirname(target), { recursive: true });
  try {
    await writeFile(target, value, { flag: "wx" });
  } catch (error) {
    if (error?.code === "EEXIST") {
      throw new Error(`Evidence file already exists: ${path.basename(target)}`);
    }
    throw error;
  }
}
