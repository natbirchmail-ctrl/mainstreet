import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { chromium } from "playwright";

import { requestStructured } from "./lib/openai.js";
import { resolveInside, writeJsonNew } from "./lib/runs.js";
import { startStaticServer } from "./serve.js";

const projectRoot = new URL("../", import.meta.url);
const promptUrl = new URL("prompts/critic-system.md", projectRoot);
const sourcePromptUrl = new URL("prompts/critic-source-system.md", projectRoot);
const schemaUrl = new URL("prompts/schemas/critique.schema.json", projectRoot);
const VIEWPORTS = {
  desktop: { width: 1440, height: 900, filename: "desktop-home.png" },
  mobile: { width: 390, height: 844, filename: "mobile-home.png" },
  narrow: { width: 320, height: 800, filename: null },
};
const DIMENSION_MAXIMUMS = {
  layout: 18,
  hierarchy: 15,
  color: 12,
  typography: 15,
  mobile: 15,
  specificity: 10,
  accessibility: 10,
  polish: 5,
};

export async function captureCycle({
  siteDir,
  cycleDir,
  port = 4601,
  browserType = chromium,
  now = () => new Date(),
}) {
  const cycle = cycleNumberFromPath(cycleDir);
  const screenshotsDir = resolveInside(cycleDir, "screenshots");
  const desktopPath = resolveInside(screenshotsDir, VIEWPORTS.desktop.filename);
  const mobilePath = resolveInside(screenshotsDir, VIEWPORTS.mobile.filename);
  const visibleTextPath = resolveInside(cycleDir, "visible-text.txt");
  const mechanicalPath = resolveInside(cycleDir, "mechanical.json");
  const screenshotManifestPath = resolveInside(screenshotsDir, "manifest.json");

  await Promise.all([
    assertAbsent(desktopPath),
    assertAbsent(mobilePath),
    assertAbsent(visibleTextPath),
    assertAbsent(mechanicalPath),
    assertAbsent(screenshotManifestPath),
  ]);
  await mkdir(screenshotsDir, { recursive: true });

  const preview = await startStaticServer({ root: siteDir, port });
  let browser;
  try {
    browser = await browserType.launch({ headless: true });
    const desktop = await captureViewport({
      browser,
      previewUrl: preview.url,
      viewport: VIEWPORTS.desktop,
      outputPath: desktopPath,
    });
    const mobile = await captureViewport({
      browser,
      previewUrl: preview.url,
      viewport: VIEWPORTS.mobile,
      outputPath: mobilePath,
    });
    const narrow = await captureViewport({
      browser,
      previewUrl: preview.url,
      viewport: VIEWPORTS.narrow,
    });

    const failures = collectMechanicalFailures({ desktop, mobile, narrow });
    const mechanical = {
      schemaVersion: "1.0",
      cycle,
      passed: failures.length === 0,
      failures,
      metrics: {
        desktop: desktop.metrics,
        mobile: mobile.metrics,
        narrow: narrow.metrics,
        consoleErrors: [
          ...desktop.consoleErrors,
          ...mobile.consoleErrors,
          ...narrow.consoleErrors,
        ],
        pageErrors: [...desktop.pageErrors, ...mobile.pageErrors, ...narrow.pageErrors],
        externalRequests: [
          ...desktop.externalRequests,
          ...mobile.externalRequests,
          ...narrow.externalRequests,
        ],
      },
    };
    const capturedAt = now().toISOString();
    const screenshotManifest = {
      schemaVersion: "1.0",
      cycle,
      capturedAt,
      previewUrl: preview.url,
      viewports: {
        desktop: {
          width: VIEWPORTS.desktop.width,
          height: VIEWPORTS.desktop.height,
          path: `screenshots/${VIEWPORTS.desktop.filename}`,
        },
        mobile: {
          width: VIEWPORTS.mobile.width,
          height: VIEWPORTS.mobile.height,
          path: `screenshots/${VIEWPORTS.mobile.filename}`,
        },
      },
      network: {
        externalRequests: mechanical.metrics.externalRequests.length,
        consoleErrors: mechanical.metrics.consoleErrors.length,
        pageErrors: mechanical.metrics.pageErrors.length,
      },
    };

    await Promise.all([
      writeTextNew(visibleTextPath, desktop.visibleText),
      writeJsonNew(mechanicalPath, mechanical),
      writeJsonNew(screenshotManifestPath, screenshotManifest),
    ]);

    return {
      cycle,
      desktopPath,
      mobilePath,
      visibleTextPath,
      mechanical,
      screenshotManifest,
    };
  } finally {
    await browser?.close().catch(() => {});
    await preview.close().catch(() => {});
  }
}

export async function critiqueCycle({
  brief,
  cycleDir,
  model = process.env.OPENAI_MODEL || "gpt-5.6",
  client,
  structuredRequester = requestStructured,
}) {
  const screenshotsDir = resolveInside(cycleDir, "screenshots");
  const [systemPrompt, schema, desktop, mobile, visibleText] = await Promise.all([
    readFile(promptUrl, "utf8"),
    readFile(schemaUrl, "utf8").then(JSON.parse),
    readFile(resolveInside(screenshotsDir, VIEWPORTS.desktop.filename)),
    readFile(resolveInside(screenshotsDir, VIEWPORTS.mobile.filename)),
    readFile(resolveInside(cycleDir, "visible-text.txt"), "utf8"),
  ]);

  const candidate = await structuredRequester({
    client,
    model,
    schema,
    schemaName: "mainstreet_critique",
    systemPrompt,
    inputContent: [
      {
        type: "input_text",
        text: JSON.stringify({
          rubricVersion: "1.0",
          cycle: cycleNumberFromPath(cycleDir),
          brief,
          visibleText,
          viewports: {
            desktop: { width: 1440, height: 900 },
            mobile: { width: 390, height: 844 },
          },
        }),
      },
      {
        type: "input_image",
        image_url: `data:image/png;base64,${desktop.toString("base64")}`,
        detail: "high",
      },
      {
        type: "input_image",
        image_url: `data:image/png;base64,${mobile.toString("base64")}`,
        detail: "high",
      },
    ],
    maxOutputTokens: 10_000,
  });

  return normalizeCritique(candidate);
}

export async function critiqueSource({
  brief,
  cycleDir,
  siteDir = resolveInside(cycleDir, "site"),
  model = process.env.OPENAI_MODEL || "gpt-5.6",
  client,
  structuredRequester = requestStructured,
}) {
  const [systemPrompt, schema, indexHtml, stylesCss] = await Promise.all([
    readFile(sourcePromptUrl, "utf8"),
    readFile(schemaUrl, "utf8").then(JSON.parse),
    readFile(resolveInside(siteDir, "index.html"), "utf8"),
    readFile(resolveInside(siteDir, "styles.css"), "utf8"),
  ]);
  const candidate = await structuredRequester({
    client,
    model,
    schema,
    schemaName: "mainstreet_source_critique",
    systemPrompt,
    userPayload: {
      rubricVersion: "1.0",
      cycle: cycleNumberFromPath(cycleDir),
      brief,
      indexHtml,
      stylesCss,
    },
    maxOutputTokens: 10_000,
  });
  return normalizeCritique(candidate);
}

export async function runCriticCycle({
  runDir,
  cycle,
  port = 4601,
  captureCycleFn = captureCycle,
  critiqueCycleFn = critiqueCycle,
  critiqueSourceFn = critiqueSource,
  now = () => new Date(),
}) {
  if (!Number.isInteger(cycle) || cycle < 1 || cycle > 3) {
    throw new TypeError("Critic cycle must be an integer from 1 through 3.");
  }

  const cycleDir = resolveInside(runDir, `cycle-${String(cycle).padStart(2, "0")}`);
  const siteDir = resolveInside(cycleDir, "site");
  const brief = JSON.parse(await readFile(resolveInside(runDir, "brief.json"), "utf8"));

  let mode = "vision";
  let mechanical = null;
  let critique;
  try {
    const evidence = await captureCycleFn({ siteDir, cycleDir, port });
    mechanical = evidence.mechanical;
  } catch (error) {
    mode = "source-fallback";
    await writeJsonNew(resolveInside(cycleDir, "capture-error.json"), {
      schemaVersion: "1.0",
      cycle,
      createdAt: now().toISOString(),
      errorCode: error?.code || error?.name || "CAPTURE_ERROR",
      message: "Playwright capture failed. Source review was used.",
    });
  }

  if (mode === "vision") {
    critique = await critiqueCycleFn({ brief, cycleDir });
  } else {
    critique = await critiqueSourceFn({ brief, cycleDir, siteDir });
  }

  const gated = applyMechanicalGate(critique, mechanical);
  const artifact = {
    ...gated,
    cycle,
    mode,
    createdAt: now().toISOString(),
    mechanicalPassed: mechanical?.passed ?? null,
  };
  await writeJsonNew(resolveInside(cycleDir, "critique.json"), artifact);
  return artifact;
}

export function normalizeCritique(candidate) {
  if (!candidate?.dimensions || !Array.isArray(candidate.issues)) {
    throw new TypeError("Critique is missing dimensions or issues.");
  }

  let score = 0;
  for (const [dimension, maximum] of Object.entries(DIMENSION_MAXIMUMS)) {
    const value = candidate.dimensions[dimension];
    if (!value || !Number.isInteger(value.score) || value.score < 0 || value.score > maximum) {
      throw new TypeError(`Critique has an invalid ${dimension} score.`);
    }
    if (!value.evidence?.trim() || !value.fix?.trim()) {
      throw new TypeError(`Critique has incomplete ${dimension} evidence.`);
    }
    score += value.score;
  }

  const issues = [...candidate.issues].sort((left, right) => left.priority - right.priority);
  const hasMajorIssue = issues.some((issue) => issue.severity === "major");

  return {
    ...candidate,
    rubricVersion: "1.0",
    score,
    verdict: score >= 85 && !hasMajorIssue ? "ship" : "revise",
    issues,
  };
}

function applyMechanicalGate(critique, mechanical) {
  if (!mechanical || mechanical.passed) {
    return critique;
  }
  return {
    ...critique,
    visionScore: critique.score,
    score: Math.min(critique.score, 60),
    verdict: "revise",
  };
}

async function captureViewport({ browser, previewUrl, viewport, outputPath }) {
  const consoleErrors = [];
  const pageErrors = [];
  const externalRequests = [];
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    colorScheme: "light",
    reducedMotion: "reduce",
  });
  const page = await context.newPage();

  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push(message.text());
    }
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("request", (request) => {
    try {
      const url = new URL(request.url());
      if (url.hostname !== "127.0.0.1") {
        externalRequests.push(request.url());
      }
    } catch {
      externalRequests.push(request.url());
    }
  });

  try {
    await page.goto(previewUrl, { waitUntil: "networkidle", timeout: 30_000 });
    await page.evaluate(() => document.fonts?.ready);
    const metrics = await page.evaluate(() => {
      const anchors = [...document.querySelectorAll('a[href^="#"]')];
      const brokenAnchors = anchors
        .map((anchor) => anchor.getAttribute("href"))
        .filter((href) => href && href !== "#" && !document.querySelector(href));
      const smallTargets = [...document.querySelectorAll("a, button")]
        .map((element) => {
          const rect = element.getBoundingClientRect();
          return { text: element.textContent?.trim() || "", width: rect.width, height: rect.height };
        })
        .filter((target) => target.width < 44 || target.height < 44);

      return {
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        scrollWidth: document.documentElement.scrollWidth,
        horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
        h1Count: document.querySelectorAll("h1").length,
        mainCount: document.querySelectorAll("main").length,
        missingAltCount: document.querySelectorAll("img:not([alt])").length,
        brokenAnchors,
        smallTargets,
        visibleTextLength: document.body.innerText.trim().length,
      };
    });
    const visibleText = await page.locator("body").innerText();
    if (outputPath) {
      await page.screenshot({ path: outputPath, fullPage: true, animations: "disabled" });
    }
    return { metrics, visibleText, consoleErrors, pageErrors, externalRequests };
  } finally {
    await context.close();
  }
}

function collectMechanicalFailures({ desktop, mobile }) {
  const failures = [];
  for (const [name, result] of Object.entries({ desktop, mobile })) {
    if (result.metrics.horizontalOverflow) failures.push(`${name}: horizontal overflow`);
    if (result.metrics.h1Count !== 1) failures.push(`${name}: expected one h1`);
    if (result.metrics.mainCount !== 1) failures.push(`${name}: expected one main`);
    if (result.metrics.missingAltCount > 0) failures.push(`${name}: images missing alt text`);
    if (result.metrics.brokenAnchors.length > 0) failures.push(`${name}: broken internal anchors`);
    if (result.metrics.visibleTextLength === 0) failures.push(`${name}: no visible text`);
    if (result.consoleErrors.length > 0) failures.push(`${name}: console errors`);
    if (result.pageErrors.length > 0) failures.push(`${name}: page errors`);
    if (result.externalRequests.length > 0) failures.push(`${name}: external requests`);
  }
  return failures;
}

function cycleNumberFromPath(cycleDir) {
  const match = path.basename(path.resolve(cycleDir)).match(/^cycle-(\d{2})$/);
  return match ? Number(match[1]) : 0;
}

async function assertAbsent(target) {
  try {
    await access(target);
    throw new Error(`Evidence file already exists: ${target}`);
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }
}

async function writeTextNew(target, value) {
  try {
    await writeFile(target, value.endsWith("\n") ? value : `${value}\n`, {
      encoding: "utf8",
      flag: "wx",
    });
  } catch (error) {
    if (error?.code === "EEXIST") {
      throw new Error(`Evidence file already exists: ${target}`);
    }
    throw error;
  }
}
