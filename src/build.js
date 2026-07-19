import { lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

import { deriveClaimPolicy, validateBriefClaims } from "./claim-policy.js";
import { requestStructured } from "./lib/openai.js";
import { resolveInside, writeJsonNew } from "./lib/runs.js";
import { materializeAssets } from "./assets.js";
import {
  createOwnedMotionRuntime,
  createOwnedMotionStyles,
  motionSlugsFor,
} from "./motion.js";
import { EVIDENCE_VIEWPORTS } from "./viewports.js";
import {
  createPlaywrightRecovery,
  isPlaywrightBrowserUnavailable,
} from "./playwright-recovery.js";

export { createOwnedMotionRuntime, createOwnedMotionStyles } from "./motion.js";

const projectRoot = new URL("../", import.meta.url);
const promptUrl = new URL("prompts/build-system.md", projectRoot);
const schemaUrl = new URL("prompts/schemas/site.schema.json", projectRoot);

export async function buildSite({
  brief,
  model = process.env.OPENAI_MODEL || "gpt-5.6",
  client,
  structuredRequester = requestStructured,
  browserRecovery = createPlaywrightRecovery(),
}) {
  if (!brief?.business?.name) {
    throw new TypeError("A complete brief is required to build a site.");
  }
  const claimPolicy = deriveClaimPolicy(brief);

  const [systemPrompt, schema] = await Promise.all([
    readFile(promptUrl, "utf8"),
    readFile(schemaUrl, "utf8").then(JSON.parse),
  ]);

  let lastValidationError;
  for (let generationAttempt = 1; generationAttempt <= 2; generationAttempt += 1) {
    let candidate;
    try {
      candidate = await structuredRequester({
        client,
        model,
        schema,
        schemaName: "mainstreet_site",
        systemPrompt,
        userPayload: {
          brief,
          claimPolicy,
          generationAttempt,
          repairInstruction:
            generationAttempt === 2
              ? "The first page failed deterministic safety or completeness checks. Rebuild it from scratch and obey every constraint."
              : null,
        },
        maxOutputTokens: 24_000,
      });
    } catch {
      break;
    }

    let hydrated;
    try {
      hydrated = hydrateSiteManifest(candidate);
      validateBriefClaims(hydrated.indexHtml, brief, claimPolicy);
    } catch (error) {
      lastValidationError = error;
      continue;
    }

    try {
      await validateRenderedSourceVisibility(hydrated, { browserRecovery });
      return { ...hydrated, source: "openai" };
    } catch (error) {
      const renderedVerification = unavailableRenderedVerification(error);
      if (renderedVerification) {
        return { ...hydrated, source: "openai", renderedVerification };
      }
      if (error?.code !== "RENDERED_SOURCE_VISIBILITY_FAILED") throw error;
      lastValidationError = error;
    }
  }

  const fallback = createDeterministicSite(brief, claimPolicy);
  validateSiteManifest(fallback);
  validateBriefClaims(fallback.indexHtml, brief, claimPolicy);
  try {
    await validateRenderedSourceVisibility(fallback, { browserRecovery });
  } catch (error) {
    const renderedVerification = unavailableRenderedVerification(error);
    if (renderedVerification) {
      return {
        ...fallback,
        source: "deterministic-fallback",
        fallbackReason: lastValidationError?.message || "OpenAI generation was unavailable.",
        renderedVerification,
      };
    }
    throw error;
  }
  return {
    ...fallback,
    source: "deterministic-fallback",
    fallbackReason: lastValidationError?.message || "OpenAI generation was unavailable.",
  };
}

export async function buildRun({
  runDir,
  buildSiteFn = buildSite,
  materializeAssetsFn = materializeAssets,
  client,
  model = process.env.OPENAI_IMAGE_MODEL || "gpt-image-1",
  requestImage,
  now = () => new Date(),
  browserRecovery = createPlaywrightRecovery(),
}) {
  const briefPath = resolveInside(runDir, "brief.json");
  const brief = JSON.parse(await readFile(briefPath, "utf8"));
  const manifest = await buildSiteFn({ brief, browserRecovery });
  validateBriefClaims(manifest.indexHtml, brief);
  const cycleDir = resolveInside(runDir, "cycle-01");
  const siteDir = resolveInside(cycleDir, "site");

  await writeSiteFiles(siteDir, manifest, runDir, { browserRecovery });
  const assets = await materializeAssetsFn({
    cycleDir,
    siteDir,
    plan: manifest.imagePlan,
    shootDirection: manifest.designNotes.shootDirection,
    client,
    model,
    requestImage,
  });
  await writeJsonNew(resolveInside(cycleDir, "build.json"), {
    cycle: 1,
    createdAt: now().toISOString(),
    source: manifest.source,
    fallbackReason: manifest.fallbackReason ?? null,
    renderedVerification: manifest.renderedVerification ?? null,
    designNotes: manifest.designNotes,
    imagePlan: manifest.imagePlan,
    assetSummary: sanitizeAssetSummary(assets),
  });

  return { cycle: 1, cycleDir, siteDir, manifest };
}

export function validateSiteManifest(manifest) {
  return validateManifest(manifest, { modelOutput: false, allowBuildMetadata: true });
}

function validateModelSiteManifest(manifest) {
  return validateManifest(manifest, { modelOutput: true, allowBuildMetadata: false });
}

export function hydrateSiteManifest(manifest) {
  validateModelSiteManifest(manifest);
  const hydrated = {
    ...manifest,
    stylesCss: `${manifest.stylesCss}\n${createOwnedMotionStyles(manifest.designNotes.motionMoves)}`,
    scriptJs: createOwnedMotionRuntime(manifest.designNotes.motionMoves),
  };
  validateSiteManifest(hydrated);
  return hydrated;
}

const manifestFields = ["indexHtml", "stylesCss", "scriptJs", "imagePlan", "designNotes"];
const buildMetadataFields = ["source", "fallbackReason", "renderedVerification"];
const imagePlanFields = ["filename", "role", "alt", "prompt", "focalPoint"];
const designNoteFields = [
  "aesthetic",
  "signatureMove",
  "rationale",
  "shootDirection",
  "motionMoves",
];
const exactCsp =
  "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'";
const safePngName = /^[a-z0-9]+(?:-[a-z0-9]+)*\.png$/;
const windowsDeviceStem = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

function validateManifest(manifest, { modelOutput, allowBuildMetadata }) {
  if (!isPlainObject(manifest)) {
    throw new TypeError("Site manifest is required.");
  }
  const allowedFields = allowBuildMetadata
    ? [...manifestFields, ...buildMetadataFields]
    : manifestFields;
  if (
    manifestFields.some((field) => !Object.hasOwn(manifest, field)) ||
    Object.keys(manifest).some((field) => !allowedFields.includes(field))
  ) {
    throw new TypeError("Site manifest must contain the exact manifest fields.");
  }

  requireString(manifest.indexHtml, "indexHtml", 120_000);
  requireString(manifest.stylesCss, "stylesCss", 80_000);
  const motionMoves = validateDesignNotes(manifest.designNotes);
  validateImagePlan(manifest.imagePlan);
  if (Object.hasOwn(manifest, "renderedVerification")) {
    validateRenderedVerification(manifest.renderedVerification);
  }

  if (modelOutput) {
    if (manifest.scriptJs !== "") {
      throw new Error("Model scriptJs must be the empty sentinel.");
    }
    validateModelMotionCss(manifest.stylesCss, manifest.indexHtml);
  } else {
    const expectedRuntime = createOwnedMotionRuntime(motionMoves);
    if (manifest.scriptJs !== expectedRuntime) {
      throw new Error("Site manifest must contain the exact owned motion runtime.");
    }
    const expectedStyles = createOwnedMotionStyles(motionMoves);
    if (!manifest.stylesCss.endsWith(expectedStyles)) {
      throw new Error("Site manifest must contain the exact owned motion styles suffix.");
    }
  }

  validateHtml(manifest.indexHtml, manifest.imagePlan, motionMoves);
  validateCss(manifest.stylesCss);
  validateVisibleCopy(manifest.indexHtml);
  return manifest;
}

function validateModelMotionCss(css, html) {
  if (/\bdata-(?:motion-[a-z0-9-]+|first-beat)\b/i.test(css) || /--motion-[a-z0-9-]+/i.test(css)) {
    throw new Error("Model CSS must not target Mainstreet owned motion hooks.");
  }
  const hooked = openingTags(html).filter(({ raw }) =>
    ["data-first-beat", "data-motion-root", "data-motion-target", "data-motion-panel", "data-motion-control"].some(
      (attribute) => attributeEntries(raw, attribute).length > 0,
    ),
  );
  const protectedTags = [...hooked];
  for (const hook of hooked) protectedTags.push(...ancestorTagsAt(html, hook.index));
  for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = match[1].trim();
    const declarations = match[2];
    if (!hasHookOverrideDeclaration(declarations)) continue;
    if (selectors.split(",").some((selector) => protectedTags.some((tag) => selectorCouldMatchTag(selector, tag)))) {
      throw new Error("Model CSS must not hide or override hooked source DOM.");
    }
  }
}

function hasHookOverrideDeclaration(declarations) {
  for (const match of declarations.matchAll(/(?:^|;)\s*([a-z-]+)\s*:\s*([^;}]*)/gi)) {
    const property = match[1].toLowerCase();
    const value = match[2].trim().toLowerCase();
    if (property === "opacity") return true;
    if (property === "display" && /\bnone\b/.test(value)) return true;
    if (property === "visibility" && /\b(?:hidden|collapse)\b/.test(value)) return true;
    if (["transform", "translate", "rotate", "scale", "clip", "clip-path"].includes(property)) return true;
    if (/^(?:animation|transition)(?:-|$)/.test(property)) return true;
    if (property === "content-visibility" && /\bhidden\b/.test(value)) return true;
    if (["width", "height", "max-width", "max-height"].includes(property) && /^0(?:\D|$)/.test(value)) return true;
    if ((property === "filter" || property === "backdrop-filter") && /opacity\(\s*0(?:\D|$)/.test(value)) return true;
  }
  return false;
}

function selectorCouldMatchTag(selector, tag) {
  const normalized = selector.trim();
  if (!normalized || normalized.startsWith("@")) return false;
  if (/(?:^|[\s>+~,(])\*(?=$|[\s>+~,:.)\[])/.test(normalized)) return true;
  const id = singleAttribute(tag.raw, "id");
  if (id && normalized.includes(`#${id}`)) return true;
  const classes = (singleAttribute(tag.raw, "class") ?? "").split(/\s+/).filter(Boolean);
  if (classes.some((className) => normalized.includes(`.${className}`))) return true;
  return new RegExp(`(?:^|[\\s>+~,(])${tag.tagName}(?=$|[\\s>+~,:.)\\[])`, "i").test(normalized);
}

export async function validateRenderedSourceVisibility(
  manifest,
  {
    browserRecovery = createPlaywrightRecovery(),
    browserType = chromium,
    stage = "build",
  } = {},
) {
  const sourceSelector = "[data-first-beat], [data-motion-root], [data-motion-target], [data-motion-panel], [data-motion-control]";
  const stylesheetUrl = `data:text/css;base64,${Buffer.from(manifest.stylesCss, "utf8").toString("base64")}`;
  const browserHtml = manifest.indexHtml
    .replace(/<meta\b(?=[^>]*\bhttp-equiv\s*=\s*["']Content-Security-Policy["'])[^>]*>/gi, "")
    .replace(
      /<link\b(?=[^>]*\bhref\s*=\s*["']styles\.css["'])[^>]*>/gi,
      `<link rel="stylesheet" href="${stylesheetUrl}">`,
    )
    .replace(/<script\b(?=[^>]*\bsrc\s*=\s*["']script\.js["'])[^>]*>\s*<\/script>/gi, "");

  const browser = await browserRecovery.run(
    () => browserType.launch({ headless: true }),
    { stage },
  );
  try {
    const context = await browser.newContext({ javaScriptEnabled: false });
    try {
      const page = await context.newPage();
      for (const [name, dimensions] of Object.entries(EVIDENCE_VIEWPORTS)) {
        const viewport = { name, width: dimensions.width, height: dimensions.height };
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await page.setContent(browserHtml, { waitUntil: "load" });
        const failures = await page.locator(sourceSelector).evaluateAll((hooks, currentViewport) => {
          const containsSourceContent = (element) =>
            element.textContent.trim().length > 0 ||
            element.matches("button, canvas, img, input, meter, progress, select, svg, textarea");
          const protectedElements = new Map();
          for (const hook of hooks) {
            for (const descendant of hook.querySelectorAll("*")) {
              const state = protectedElements.get(descendant) ?? { isHook: false, isContent: false };
              if (containsSourceContent(descendant)) state.isContent = true;
              protectedElements.set(descendant, state);
            }
            let current = hook;
            while (current) {
              const state = protectedElements.get(current) ?? { isHook: false, isContent: false };
              if (current === hook) state.isHook = true;
              protectedElements.set(current, state);
              current = current.parentElement;
            }
          }

          const isTransparent = (color) =>
            color === "transparent" || /rgba\([^)]*,\s*0(?:\.0+)?\s*\)$/i.test(color);
          const hasInvisibleOpacityFilter = (filter) => {
            const matches = [...filter.matchAll(/\bopacity\(\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+))(%?)\s*\)/gi)];
            if (matches.length === 0) return false;
            const effectiveOpacity = matches.reduce((product, match) => {
              const amount = Number.parseFloat(match[1]);
              return product * (match[2] === "%" ? amount / 100 : amount);
            }, 1);
            return effectiveOpacity <= 0.01;
          };
          const hasUnsafeLegacyClip = (style, element) => {
            if (style.position !== "absolute" && style.position !== "fixed") return false;
            const clip = style.clip.trim();
            if (clip === "auto") return false;
            const rect = /^rect\((.*)\)$/i.exec(clip);
            if (!rect) return true;
            const values = rect[1].trim().split(/\s*,\s*|\s+/).filter(Boolean);
            if (values.length !== 4) return true;
            const bounds = element.getBoundingClientRect();
            const autoValues = [0, bounds.width, bounds.height, 0];
            const resolved = values.map((value, index) => {
              if (value.toLowerCase() === "auto") return autoValues[index];
              const length = /^([+-]?(?:\d+(?:\.\d*)?|\.\d+))px$/i.exec(value);
              return length ? Number.parseFloat(length[1]) : Number.NaN;
            });
            if (!resolved.every(Number.isFinite)) return true;
            const [top, right, bottom, left] = resolved;
            const visibleWidth = Math.min(right, bounds.width) - Math.max(left, 0);
            const visibleHeight = Math.min(bottom, bounds.height) - Math.max(top, 0);
            return visibleWidth <= 0 || visibleHeight <= 0;
          };
          const hasClippedDisplacedText = (style, element) => {
            if (style.overflowX !== "hidden" && style.overflowX !== "clip") return false;
            const indent = /^([+-]?(?:\d+(?:\.\d*)?|\.\d+))(px|%)$/i.exec(style.textIndent);
            if (!indent) return style.textIndent !== "0px";
            const bounds = element.getBoundingClientRect();
            const amount = Number.parseFloat(indent[1]);
            const indentPixels = indent[2] === "%" ? (amount / 100) * bounds.width : amount;
            return indentPixels <= -bounds.width || indentPixels >= bounds.width;
          };
          const isFullyClippedByOverflowAncestor = (element) => {
            const clippingValues = new Set(["auto", "clip", "hidden", "scroll"]);
            const visible = element.getBoundingClientRect().toJSON();
            for (let ancestor = element.parentElement; ancestor; ancestor = ancestor.parentElement) {
              if (ancestor === document.scrollingElement) continue;
              const ancestorStyle = getComputedStyle(ancestor);
              const clipsX = clippingValues.has(ancestorStyle.overflowX);
              const clipsY = clippingValues.has(ancestorStyle.overflowY);
              if (!clipsX && !clipsY) continue;
              const bounds = ancestor.getBoundingClientRect();
              const scaleX = ancestor instanceof HTMLElement && ancestor.offsetWidth > 0
                ? bounds.width / ancestor.offsetWidth
                : 1;
              const scaleY = ancestor instanceof HTMLElement && ancestor.offsetHeight > 0
                ? bounds.height / ancestor.offsetHeight
                : 1;
              const clipLeft = bounds.left + ancestor.clientLeft * scaleX;
              const clipTop = bounds.top + ancestor.clientTop * scaleY;
              const clipRight = clipLeft + ancestor.clientWidth * scaleX;
              const clipBottom = clipTop + ancestor.clientHeight * scaleY;
              if (clipsX) {
                visible.left = Math.max(visible.left, clipLeft);
                visible.right = Math.min(visible.right, clipRight);
              }
              if (clipsY) {
                visible.top = Math.max(visible.top, clipTop);
                visible.bottom = Math.min(visible.bottom, clipBottom);
              }
              if (visible.right <= visible.left || visible.bottom <= visible.top) return true;
            }
            return false;
          };
          const isBelowDocumentReach = (style, bounds) => {
            if (style.position === "fixed") return true;
            const scroller = document.scrollingElement;
            if (!scroller) return true;
            const blocksScroll = [scroller, document.body]
              .filter(Boolean)
              .some((element) => ["clip", "hidden"].includes(getComputedStyle(element).overflowY));
            if (blocksScroll) return true;
            const documentTop = bounds.top + window.scrollY;
            return documentTop >= scroller.scrollHeight;
          };
          const hasUnsafeClipPath = (clipPath, element) => {
            if (clipPath === "none") return false;
            const inset = /^inset\((.*)\)$/i.exec(clipPath);
            if (!inset) return true;
            const values = inset[1].split(/\s+round\s+/i, 1)[0].trim().split(/\s+/);
            if (values.length < 1 || values.length > 4) return true;
            const [top, right = top, bottom = top, left = right] =
              values.length === 3
                ? [values[0], values[1], values[2], values[1]]
                : values.length === 4
                  ? values
                  : [values[0], values[1] ?? values[0], values[0], values[1] ?? values[0]];
            const bounds = element.getBoundingClientRect();
            const resolveInset = (value, size) => {
              const length = /^(-?(?:\d+(?:\.\d*)?|\.\d+))(px|%)?$/.exec(value);
              if (!length) return Number.NaN;
              const amount = Number.parseFloat(length[1]);
              if (length[2] === "%") return (amount / 100) * size;
              if (length[2] === "px" || amount === 0) return amount;
              return Number.NaN;
            };
            const resolved = [
              resolveInset(top, bounds.height),
              resolveInset(right, bounds.width),
              resolveInset(bottom, bounds.height),
              resolveInset(left, bounds.width),
            ];
            return !resolved.every(Number.isFinite) ||
              resolved[0] + resolved[2] >= bounds.height ||
              resolved[1] + resolved[3] >= bounds.width;
          };
          const hasUnsafeMaskImage = (style) =>
            ["mask-image", "-webkit-mask-image"].some((property) => {
              const value = style.getPropertyValue(property).trim();
              return value !== "" && value !== "none";
            });
          const describe = (element) => {
            const id = element.id ? `#${element.id}` : "";
            const classes = element.classList.length > 0 ? `.${[...element.classList].join(".")}` : "";
            return `${element.tagName.toLowerCase()}${id}${classes}`;
          };
          const failures = [];
          for (const [element, state] of protectedElements) {
            const style = getComputedStyle(element);
            const reasons = [];
            if (
              typeof element.checkVisibility === "function" &&
              !element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })
            ) reasons.push("not visible");
            if (style.display === "none") reasons.push("display none");
            if (style.visibility === "hidden" || style.visibility === "collapse") reasons.push(`visibility ${style.visibility}`);
            if (Number.parseFloat(style.opacity) <= 0.01) reasons.push("zero opacity");
            if (style.contentVisibility === "hidden") reasons.push("content visibility hidden");
            if (Number.parseFloat(style.fontSize) <= 0.01) reasons.push("zero font size");
            if (isTransparent(style.color)) reasons.push("transparent text color");
            if (hasInvisibleOpacityFilter(style.filter)) reasons.push("invisible opacity filter");
            if (hasUnsafeLegacyClip(style, element)) reasons.push("unsafe legacy clip");
            if (hasUnsafeClipPath(style.clipPath, element)) reasons.push("unsafe clip path");
            if (hasUnsafeMaskImage(style)) reasons.push("unsafe mask image");
            if (hasClippedDisplacedText(style, element)) reasons.push("clipped displaced text");
            if (
              (state.isHook || state.isContent) &&
              isFullyClippedByOverflowAncestor(element)
            ) reasons.push("fully clipped by overflow ancestor");

            if ((state.isHook || state.isContent) && style.display !== "contents") {
              const bounds = element.getBoundingClientRect();
              if (bounds.width <= 0 || bounds.height <= 0) reasons.push("zero rendered bounds");
              if (bounds.right <= 0 || bounds.left >= currentViewport.width) reasons.push("horizontally offscreen");
              if (bounds.bottom <= 0) reasons.push("above the rendered canvas");
              if (bounds.top >= currentViewport.height && isBelowDocumentReach(style, bounds)) {
                reasons.push("below document reach");
              }
            }
            if (reasons.length > 0) failures.push({ element: describe(element), reasons });
          }
          return failures;
        }, viewport);
        if (failures.length > 0) {
          const error = new Error(
            `Rendered no JavaScript source visibility failed at ${viewport.name}: ${JSON.stringify(failures)}`,
          );
          error.code = "RENDERED_SOURCE_VISIBILITY_FAILED";
          throw error;
        }
      }
    } finally {
      await context.close();
    }
  } finally {
    await browser.close();
  }
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

function validateDesignNotes(designNotes) {
  if (!isPlainObject(designNotes) || !hasExactKeys(designNotes, designNoteFields)) {
    throw new TypeError("Site manifest must contain the exact design note fields.");
  }
  requireString(designNotes.aesthetic, "designNotes.aesthetic", 400);
  requireString(designNotes.signatureMove, "designNotes.signatureMove", 400);
  requireString(designNotes.rationale, "designNotes.rationale", 800);
  requireString(designNotes.shootDirection, "designNotes.shootDirection", 800);
  motionSlugsFor(designNotes.motionMoves);
  return designNotes.motionMoves;
}

function validateImagePlan(imagePlan) {
  if (!Array.isArray(imagePlan) || imagePlan.length < 3 || imagePlan.length > 5) {
    throw new TypeError("Image plan must contain three to five items.");
  }

  const seenNames = new Set();
  for (const item of imagePlan) {
    if (!isPlainObject(item) || !hasExactKeys(item, imagePlanFields)) {
      throw new TypeError("Image plan items must contain the exact image plan fields.");
    }
    requireString(item.filename, "imagePlan.filename", 80);
    const stem = item.filename.replace(/\.png$/i, "");
    if (windowsDeviceStem.test(stem)) {
      throw new Error("Image plan filename uses a reserved Windows device name.");
    }
    const collisionKey = item.filename.toLowerCase();
    if (seenNames.has(collisionKey)) {
      throw new Error("Image plan contains a duplicate or case collision filename.");
    }
    seenNames.add(collisionKey);
    if (item.filename !== collisionKey || !safePngName.test(item.filename)) {
      throw new Error("Image plan filenames must be safe lowercase PNG names.");
    }
    requireString(item.role, "imagePlan.role", 64);
    requireString(item.alt, "imagePlan.alt", 180);
    requireString(item.prompt, "imagePlan.prompt", 1_200);
    if (
      !isPlainObject(item.focalPoint) ||
      !hasExactKeys(item.focalPoint, ["x", "y"]) ||
      !isUnitNumber(item.focalPoint.x) ||
      !isUnitNumber(item.focalPoint.y)
    ) {
      throw new TypeError("Image plan focal point coordinates must be from zero through one.");
    }
  }
}

function validateHtml(html, imagePlan, motionMoves) {
  const requiredHtml = [
    /<!doctype html>/i,
    /<html\b[^>]*\blang\s*=/i,
    /<meta\b[^>]*\bname=["']viewport["']/i,
    /<main\b/i,
    /<h1\b/i,
  ];
  if (requiredHtml.some((pattern) => !pattern.test(html))) {
    throw new Error("Generated HTML is missing required semantic structure.");
  }

  validateCsp(html);
  validateScriptTag(html);
  validateStylesheetTag(html);
  validateResourceBoundary(html);

  if (
    /<(?:iframe|object|embed|form|base|style|source|audio|video|track|picture|svg|math|template|noscript)\b/i.test(html) ||
    /\son[a-z]+\s*=/i.test(html)
  ) {
    throw new Error("Generated site contains forbidden HTML or active content.");
  }
  if (/(?:https?:|javascript\s*:|data\s*:|blob\s*:|file\s*:|\/\/)/i.test(html)) {
    throw new Error("Generated site contains a forbidden external or embedded URL.");
  }
  if (/\ssrcset(?:\s|=|>)/i.test(html)) {
    throw new Error("Generated HTML must not contain srcset.");
  }

  validateImageReferences(html, imagePlan);
  validateLocalFragmentLinks(html);
  validateSectionHooks(html);
  validateMotionHooks(html, motionMoves);
}

function validateCsp(html) {
  const parsedHtml = stripHtmlComments(html);
  if (/\bframe-ancestors\b/i.test(parsedHtml)) {
    throw new Error("frame-ancestors is not valid in an HTML meta policy.");
  }
  const heads = pairedElements(parsedHtml, "head");
  const policies = openingTags(parsedHtml)
    .filter(({ tagName }) => tagName === "meta")
    .filter(({ raw }) => singleAttribute(raw, "http-equiv")?.toLowerCase() === "content-security-policy")
    .map(({ raw }) => singleAttribute(raw, "content"));
  const headPolicies = heads.length === 1
    ? openingTags(heads[0].inner)
      .filter(({ tagName }) => tagName === "meta")
      .filter(({ raw }) => singleAttribute(raw, "http-equiv")?.toLowerCase() === "content-security-policy")
      .map(({ raw }) => singleAttribute(raw, "content"))
    : [];
  if (
    policies.length !== 1 ||
    policies[0] !== exactCsp ||
    headPolicies.length !== 1 ||
    headPolicies[0] !== exactCsp
  ) {
    throw new Error("Generated HTML must contain one exact Content Security Policy.");
  }
}

function validateScriptTag(html) {
  const openings = html.match(/<script\b[^>]*>/gi) ?? [];
  const blocks = html.match(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi) ?? [];
  if (
    openings.length !== 1 ||
    blocks.length !== 1 ||
    blocks[0] !== '<script src="script.js" defer></script>'
  ) {
    throw new Error("Generated site contains forbidden HTML or active content.");
  }
}

function validateStylesheetTag(html) {
  const links = openingTags(html).filter(({ tagName }) => tagName === "link");
  if (
    links.length !== 1 ||
    singleAttribute(links[0].raw, "rel")?.toLowerCase() !== "stylesheet" ||
    singleAttribute(links[0].raw, "href") !== "styles.css"
  ) {
    throw new Error("Generated HTML must load exactly one local styles.css file.");
  }
}

function validateResourceBoundary(html) {
  const tags = openingTags(html);
  for (const { tagName, raw } of tags) {
    if (attributeEntries(raw, "style").length > 0) {
      throw new Error("Generated HTML must not contain an inline style.");
    }
    if (
      attributeEntries(raw, "src").length > 0 &&
      tagName !== "img" &&
      tagName !== "script"
    ) {
      throw new Error("Generated HTML contains an undeclared resource loader.");
    }
    if (
      attributeEntries(raw, "href").length > 0 &&
      tagName !== "a" &&
      tagName !== "link"
    ) {
      throw new Error("Generated HTML contains an undeclared resource loader.");
    }
    if (
      ["srcdoc", "poster", "ping", "action", "formaction", "xlink:href", "background"].some(
        (attributeName) => attributeEntries(raw, attributeName).length > 0,
      )
    ) {
      throw new Error("Generated HTML contains an undeclared resource loader.");
    }
    const httpEquiv = singleAttribute(raw, "http-equiv");
    if (tagName === "meta" && httpEquiv && httpEquiv.toLowerCase() !== "content-security-policy") {
      throw new Error("Generated HTML contains an undeclared resource loader.");
    }
  }
}

function validateImageReferences(html, imagePlan) {
  const planned = new Map(imagePlan.map((item) => [item.filename, item]));
  const referenced = new Set();
  const images = openingTags(html).filter(({ tagName }) => tagName === "img");
  for (const { raw } of images) {
    const srcEntry = singleAttributeEntry(raw, "src");
    const altEntry = singleAttributeEntry(raw, "alt");
    if (!srcEntry?.quoted || !altEntry?.quoted) {
      throw new Error("Every image must contain one quoted local source and exact alt text.");
    }
    const match = /^assets\/([a-z0-9]+(?:-[a-z0-9]+)*\.png)$/.exec(srcEntry.value);
    if (!match) {
      throw new Error("Generated image asset path is unsafe.");
    }
    const item = planned.get(match[1]);
    if (!item) {
      throw new Error("Generated image references an unplanned asset.");
    }
    if (altEntry.value !== item.alt) {
      throw new Error("Generated image alt text must exactly match the image plan.");
    }
    referenced.add(item.filename);
  }
  if (imagePlan.some((item) => !referenced.has(item.filename))) {
    throw new Error("Every planned image must be referenced in HTML.");
  }
}

function validateLocalFragmentLinks(html) {
  const links = openingTags(html).filter(({ tagName }) => tagName === "a");
  for (const { raw } of links) {
    const href = singleAttributeEntry(raw, "href");
    if (!href?.quoted || !/^#[a-z][a-z0-9_-]*$/i.test(href.value)) {
      throw new Error("Generated anchors must use one quoted local fragment link.");
    }
  }
}

function validateSectionHooks(html) {
  const sections = pairedElements(html, "section");
  if (sections.length === 0 || (html.match(/<section\b/gi) ?? []).length !== sections.length) {
    throw new Error("Generated HTML sections must be complete and unnested.");
  }
  for (const section of sections) {
    const sectionName = singleAttribute(section.openTag, "data-section");
    if (!sectionName) {
      throw new Error("Every section must declare a nonempty data-section hook.");
    }
    if (hasExplicitHiddenState(section.openTag)) {
      throw new Error("Every section must expose a visible data-first-beat.");
    }
    const beats = openingTags(section.inner).filter(
      ({ raw }) => attributeEntries(raw, "data-first-beat").length === 1,
    );
    if (beats.length !== 1) {
      throw new Error("Every section must contain exactly one descendant data-first-beat.");
    }
    const beat = beats[0].raw;
    const hiddenAncestor = ancestorTagsAt(section.inner, beats[0].index).some(({ raw }) =>
      hasExplicitHiddenState(raw),
    );
    if (hasExplicitHiddenState(beat) || hiddenAncestor) {
      throw new Error("Every section must expose a visible data-first-beat.");
    }
  }
}

function hasExplicitHiddenState(tag) {
  const hidden = attributeEntries(tag, "hidden").length > 0;
  const ariaHidden = singleAttribute(tag, "aria-hidden")?.toLowerCase() === "true";
  const inlineStyle = singleAttribute(tag, "style") ?? "";
  return hidden || ariaHidden || /(?:display\s*:\s*none|visibility\s*:\s*hidden|opacity\s*:\s*0(?:\D|$))/i.test(inlineStyle);
}

function validateMotionHooks(html, motionMoves) {
  const expectedSlugs = motionSlugsFor(motionMoves);
  const structure = openingTags(html);
  const motionTargets = structure.filter(({ raw }) => attributeEntries(raw, "data-motion-target").length === 1);
  const motionPanels = structure.filter(({ raw }) => attributeEntries(raw, "data-motion-panel").length === 1);
  if (motionTargets.some((target) => hasExplicitHiddenState(target.raw) || ancestorTagsAt(html, target.index).some(({ raw }) => hasExplicitHiddenState(raw)))) {
    throw new Error("Every source motion target must remain visible without JavaScript.");
  }
  if (motionPanels.some((panel) => hasExplicitHiddenState(panel.raw) || ancestorTagsAt(html, panel.index).some(({ raw }) => hasExplicitHiddenState(raw)))) {
    throw new Error("Every source motion panel must remain visible without JavaScript.");
  }
  const declarationTags = structure.filter(({ tagName }) => tagName === "body" || tagName === "main");
  const declarations = declarationTags.flatMap(({ raw }) => attributeEntries(raw, "data-motion-moves"));
  if (declarations.length !== 1 || declarations[0].value !== expectedSlugs.join(" ")) {
    throw new Error("HTML must contain the exact ordered declared motion moves.");
  }

  const roots = structure.flatMap((tag) =>
    attributeEntries(tag.raw, "data-motion-root").map((entry) => ({ ...tag, entry })),
  );
  if (
    roots.length !== expectedSlugs.length ||
    expectedSlugs.some((slug) => roots.filter(({ entry }) => entry.value === slug).length !== 1) ||
    roots.some(({ entry }) => !expectedSlugs.includes(entry.value))
  ) {
    throw new Error("HTML must contain one matching motion root for every selected move.");
  }

  for (const root of roots) {
    const element = pairedElementAt(html, root);
    if (!element) {
      throw new Error("Every motion root must be a complete container element.");
    }
    if (root.entry.value === "staged-hero-entrance" || root.entry.value === "gentle-scroll-reveals") {
      const targets = openingTags(element.inner).filter(({ raw }) => attributeEntries(raw, "data-motion-target").length === 1);
      if (targets.length === 0) {
        throw new Error("Reveal motion roots must contain data-motion-target elements.");
      }
    }
    if (root.entry.value === "horizontal-click-reel" || root.entry.value === "numbered-story-stepper") {
      validateInteractiveRoot(element.inner);
    }
  }
}

function validateInteractiveRoot(innerHtml) {
  const tags = openingTags(innerHtml);
  const controls = tags.flatMap((tag) =>
    attributeEntries(tag.raw, "data-motion-control").map((entry) => ({ ...tag, entry })),
  );
  if (controls.length < 2 || controls.some(({ tagName, entry }) => tagName !== "button" || !entry.value)) {
    throw new Error("Interactive roots require button data-motion-control elements.");
  }
  const panels = tags.flatMap((tag) =>
    attributeEntries(tag.raw, "data-motion-panel").map((entry) => ({ ...tag, entry })),
  );
  const controlIds = controls.map(({ entry }) => entry.value);
  const panelIds = panels.map(({ entry }) => entry.value);
  if (
    panels.length < 2 ||
    new Set(controlIds).size !== controlIds.length ||
    new Set(panelIds).size !== panelIds.length ||
    controlIds.some((id) => !panelIds.includes(id)) ||
    panelIds.some((id) => !controlIds.includes(id))
  ) {
    throw new Error("Every motion control requires one matching data-motion-panel.");
  }
}

function validateCss(css) {
  if (/\\/.test(css)) {
    throw new Error("Generated CSS must not contain escape backslashes.");
  }
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, " ");
  if (/@counter-style\b/i.test(withoutComments)) {
    throw new Error("Generated copy through CSS custom counters is forbidden.");
  }
  for (const match of withoutComments.matchAll(/(?:^|[;{])\s*content\s*:\s*([^;}]+)/gim)) {
    const value = match[1].trim().toLowerCase();
    if (!["\"\"", "''", "none", "normal"].includes(value)) {
      throw new Error("Generated CSS text is forbidden; content may only be empty.");
    }
  }
  for (const match of withoutComments.matchAll(/(?:^|[;{])\s*(quotes|list-style(?:-type)?)\s*:\s*([^;}]+)/gim)) {
    const property = match[1].toLowerCase();
    const value = match[2].trim().toLowerCase();
    if (
      (property === "quotes" && !/^(?:auto|none)(?:\s*!important)?$/.test(value)) ||
      (property !== "quotes" && /["']|\b(?:symbols|var)\s*\(/i.test(value))
    ) {
      throw new Error("Generated CSS text through quotes or list markers is forbidden.");
    }
  }
  if (
    /@import\b|url\s*\(|expression\s*\(|(?:^|[;{]\s*)behavior\s*:|(?:https?:|data\s*:|blob\s*:)/im.test(withoutComments)
  ) {
    throw new Error("Generated site contains remote or embedded CSS assets.");
  }
}

function validateVisibleCopy(html) {
  const visibleText = extractVisibleText(html);
  if (/[-\u2010-\u2015]/.test(visibleText)) {
    throw new Error("Generated visible copy contains dash characters.");
  }
  if (/\p{Extended_Pictographic}/u.test(visibleText)) {
    throw new Error("Generated visible copy contains emoji.");
  }
  if (
    /\b(lorem ipsum|todo|tbd|placeholder|insert here|example\.com|555[\s-]?\d+)\b/i.test(visibleText) ||
    /\b(?:name|hello|info)@example\.(?:com|org)\b/i.test(visibleText)
  ) {
    throw new Error("Generated visible copy contains placeholder content.");
  }
}

function openingTags(html) {
  return [...html.matchAll(/<([a-z][a-z0-9-]*)\b[^>]*>/gi)].map((match) => ({
    tagName: match[1].toLowerCase(),
    raw: match[0],
    index: match.index,
  }));
}

function attributeEntries(tag, attributeName) {
  const escapedName = attributeName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(
    `\\s${escapedName}(?:\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+)))?(?=\\s|/?>)`,
    "gi",
  );
  return [...tag.matchAll(pattern)].map((match) => ({
    value: match[1] ?? match[2] ?? match[3] ?? "",
    quoted: match[1] !== undefined || match[2] !== undefined,
  }));
}

function singleAttributeEntry(tag, attributeName) {
  const entries = attributeEntries(tag, attributeName);
  return entries.length === 1 ? entries[0] : null;
}

function singleAttribute(tag, attributeName) {
  return singleAttributeEntry(tag, attributeName)?.value;
}

function pairedElements(html, tagName) {
  const pattern = new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}\\s*>`, "gi");
  return [...html.matchAll(pattern)].map((match) => ({
    openTag: match[0].slice(0, match[0].indexOf(">") + 1),
    inner: match[1],
  }));
}

function pairedElementAt(html, opening) {
  const start = opening.index + opening.raw.length;
  const tokenPattern = new RegExp(`<\\/?${opening.tagName}\\b[^>]*>`, "gi");
  tokenPattern.lastIndex = opening.index;
  let depth = 0;
  for (const match of html.matchAll(tokenPattern)) {
    if (match.index < opening.index) continue;
    if (/^<\//.test(match[0])) {
      depth -= 1;
      if (depth === 0) {
        return { inner: html.slice(start, match.index) };
      }
    } else {
      depth += 1;
    }
  }
  return null;
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value, fields) {
  const keys = Object.keys(value);
  return keys.length === fields.length && fields.every((field) => Object.hasOwn(value, field));
}

function requireString(value, field, maxLength) {
  if (typeof value !== "string" || !value.trim() || value.length > maxLength) {
    throw new TypeError(`${field} must be a nonempty bounded string.`);
  }
}

function isUnitNumber(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

export async function writeSiteFiles(
  siteDir,
  manifest,
  trustedRunRoot,
  {
    browserRecovery = createPlaywrightRecovery(),
    recoveryStage = "build",
  } = {},
) {
  validateSiteManifest(manifest);
  if (manifest.renderedVerification?.status !== "unavailable") {
    await validateRenderedSourceVisibility(manifest, {
      browserRecovery,
      stage: recoveryStage,
    });
  }
  const normalizedSiteDir = path.resolve(siteDir);
  await assertNoLinkedSitePath(trustedRunRoot, normalizedSiteDir);
  await mkdir(normalizedSiteDir, { recursive: true });
  await assertNoLinkedSitePath(trustedRunRoot, normalizedSiteDir);
  await writeNew(path.join(normalizedSiteDir, "index.html"), manifest.indexHtml, trustedRunRoot);
  await writeNew(path.join(normalizedSiteDir, "styles.css"), manifest.stylesCss, trustedRunRoot);
  await writeNew(path.join(normalizedSiteDir, "script.js"), manifest.scriptJs, trustedRunRoot);
}

function unavailableRenderedVerification(error) {
  if (!isPlaywrightBrowserUnavailable(error)) return null;
  return Object.freeze({
    status: "unavailable",
    reason: error.recovery.reason,
    installStatus: error.recovery.installStatus,
    installReason: error.recovery.installReason,
  });
}

function validateRenderedVerification(value) {
  const installedEvidenceIsValid =
    value?.installStatus === "installed" &&
    value.installReason === null &&
    value.reason === "chromium_missing_after_retry";
  const unavailableReasons = new Set([
    "installer_missing",
    "installer_nonzero",
    "installer_start_failed",
    "installer_timeout",
  ]);
  const unavailableEvidenceIsValid =
    value?.installStatus === "unavailable" &&
    unavailableReasons.has(value.installReason) &&
    value.reason === value.installReason;
  if (
    !isPlainObject(value) ||
    !hasExactKeys(value, ["status", "reason", "installStatus", "installReason"]) ||
    value.status !== "unavailable" ||
    (!installedEvidenceIsValid && !unavailableEvidenceIsValid)
  ) {
    throw new TypeError("Rendered verification metadata is invalid.");
  }
}

function extractVisibleText(html) {
  return html
    .replace(/<!--[^]*?-->/g, " ")
    .replace(/<style\b[^>]*>[^]*?<\/style>/gi, " ")
    .replace(/<script\b[^>]*>[^]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(nbsp|amp|quot|apos|lt|gt|mdash|ndash|hyphen);/gi, (_, name) =>
      decodeNamedHtmlEntity(name),
    )
    .replace(/&#(x[0-9a-f]+|\d+);/gi, (_, value) => decodeNumericHtmlEntity(value))
    .replace(/\s+/g, " ")
    .trim();
}

function stripHtmlComments(html) {
  return html.replace(/<!--[^]*?-->/g, "");
}

function ancestorTagsAt(html, targetIndex) {
  const structuralHtml = html.replace(/<!--[^]*?-->/g, (comment) => " ".repeat(comment.length));
  const stack = [];
  const voidElements = new Set([
    "area",
    "base",
    "br",
    "col",
    "embed",
    "hr",
    "img",
    "input",
    "link",
    "meta",
    "param",
    "source",
    "track",
    "wbr",
  ]);
  for (const match of structuralHtml.matchAll(/<(\/)?([a-z][a-z0-9-]*)\b[^>]*>/gi)) {
    if (match.index >= targetIndex) break;
    const tagName = match[2].toLowerCase();
    if (match[1]) {
      const matchingIndex = stack.findLastIndex((entry) => entry.tagName === tagName);
      if (matchingIndex !== -1) stack.splice(matchingIndex);
    } else if (!voidElements.has(tagName) && !/\/>$/.test(match[0])) {
      stack.push({ tagName, raw: match[0] });
    }
  }
  return stack;
}

function decodeNamedHtmlEntity(name) {
  const entities = {
    nbsp: " ",
    amp: "&",
    quot: '"',
    apos: "'",
    lt: "<",
    gt: ">",
    mdash: "\u2014",
    ndash: "\u2013",
    hyphen: "\u2010",
  };
  return entities[name.toLowerCase()];
}

function decodeNumericHtmlEntity(value) {
  const codePoint = value[0].toLowerCase() === "x"
    ? Number.parseInt(value.slice(1), 16)
    : Number.parseInt(value, 10);
  if (
    !Number.isInteger(codePoint) ||
    codePoint < 0 ||
    codePoint > 0x10ffff ||
    (codePoint >= 0xd800 && codePoint <= 0xdfff)
  ) {
    return "\ufffd";
  }
  return String.fromCodePoint(codePoint);
}

async function writeNew(target, value, trustedRunRoot) {
  const contents = value.endsWith("\n") ? value : `${value}\n`;
  await assertNoLinkedSitePath(trustedRunRoot, target);
  try {
    await writeFile(target, contents, {
      encoding: "utf8",
      flag: "wx",
    });
  } catch (error) {
    if (error?.code === "EEXIST") {
      throw new Error(`Site file already exists: ${target}`);
    }
    throw error;
  }
}

async function assertNoLinkedSitePath(trustedRunRoot, target) {
  if (typeof trustedRunRoot !== "string" || !trustedRunRoot.trim()) {
    throw new TypeError("A trusted run root is required for site writes.");
  }
  const root = path.resolve(trustedRunRoot);
  const resolvedTarget = path.resolve(target);
  const relative = path.relative(root, resolvedTarget);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Site path escapes the trusted run root.");
  }

  const candidates = [root];
  let current = root;
  for (const segment of relative.split(path.sep)) {
    current = path.join(current, segment);
    candidates.push(current);
  }
  for (const candidate of candidates) {
    try {
      if ((await lstat(candidate)).isSymbolicLink()) {
        throw new Error("Symlink, junction, or linked site path ancestors are not allowed.");
      }
    } catch (error) {
      if (error?.code === "ENOENT") return;
      throw error;
    }
  }
}

function createDeterministicSite(brief, claimPolicy = deriveClaimPolicy(brief)) {
  const rawName = String(brief.business.name);
  const name = escapeHtml(rawName);
  const rawCategory = String(brief.business.category || "local business");
  const category = escapeHtml(rawCategory.toLocaleLowerCase("en-US"));
  const city = brief.business.city ? escapeHtml(brief.business.city) : "Local guide";
  const guidanceOnly = claimPolicy.mode === "guidance-only";
  const sectionLabel = guidanceOnly ? "Ideas" : "Services";
  const sectionEyebrow = guidanceOnly ? "Planning notes" : "Confirmed details";
  const sectionHeading = guidanceOnly ? "Useful Directions" : "Known Services";
  const heroIntro = guidanceOnly
    ? `A visual guide inspired by ${category}. Use it to consider priorities and fit before confirming details.`
    : "Confirmed service information and planning context, presented with a clear local point of view.";
  const primaryAction = guidanceOnly ? "Explore Ideas" : "Explore Services";
  const motionMoves = ["staged hero entrance"];
  const imagePlan = [
    {
      filename: "workbench-hero.png",
      role: "hero",
      alt: `Contemporary still life inspired by ${rawCategory.toLocaleLowerCase("en-US")}`,
      prompt: `Contemporary editorial still life inspired by ${rawCategory} with natural materials calm light no logos no signage and no business specific details`,
      focalPoint: { x: 0.56, y: 0.44 },
    },
    {
      filename: "offerings-detail.png",
      role: "offerings",
      alt: "Materials and colors arranged as a planning reference",
      prompt: `Close editorial detail of materials and colors inspired by ${rawCategory} with no logos no signage and no claimed business activity`,
      focalPoint: { x: 0.5, y: 0.5 },
    },
    {
      filename: "story-detail.png",
      role: "story",
      alt: "A quiet neighborhood scene in natural morning light",
      prompt: "Quiet contemporary neighborhood context in natural morning light with no logos no signage and no identifiable people",
      focalPoint: { x: 0.42, y: 0.52 },
    },
  ];
  const publicItems = guidanceOnly
    ? createGuidanceItems(brief)
    : claimPolicy.confirmedOfferings.slice(0, 4);
  const offerings = publicItems
    .map(
      (offering, index) => `
        <article class="offering">
          <p class="offering-number">0${index + 1}</p>
          <h3>${escapeHtml(offering.name)}</h3>
          <p>${escapeHtml(offering.description)}</p>
        </article>`,
    )
    .join("");

  const indexHtml = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="description" content="A visual planning guide for ${name}. Service and availability details are shown only when confirmed.">
  <meta http-equiv="Content-Security-Policy" content="default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'">
  <title>${name}</title>
  <link rel="stylesheet" href="styles.css">
</head>
<body data-motion-moves="staged-hero-entrance">
  <a class="skip-link" href="#main">Skip to content</a>
  <header class="site-header">
    <a class="wordmark" href="#top" aria-label="${name} home">${name}</a>
    <nav aria-label="Primary">
      <a href="#offerings">${sectionLabel}</a>
      <a href="#story">Context</a>
      <a href="#contact">Details</a>
    </nav>
  </header>
  <main id="main">
    <section class="hero" id="top" data-section="hero" data-motion-root="staged-hero-entrance">
      <div class="hero-copy" data-first-beat data-motion-target>
        <p class="eyebrow">${city}</p>
        <h1>${name}</h1>
        <p class="hero-intro">${heroIntro}</p>
        <a class="primary-action" href="#offerings" data-primary-action>${primaryAction}</a>
      </div>
      <div class="hero-art"><img src="assets/workbench-hero.png" alt="${escapeHtml(imagePlan[0].alt)}"><span></span><span></span><span></span></div>
    </section>
    <section class="offerings-section" id="offerings" data-section="offerings">
      <div class="section-heading" data-first-beat>
        <p class="eyebrow">${sectionEyebrow}</p>
        <h2>${sectionHeading}</h2>
        <img src="assets/offerings-detail.png" alt="${escapeHtml(imagePlan[1].alt)}">
      </div>
      <div class="offerings-list">${offerings}
      </div>
    </section>
    <section class="story" id="story" data-section="story">
      <div class="story-marker" aria-hidden="true">${escapeHtml(rawName.charAt(0))}</div>
      <div data-first-beat>
        <p class="eyebrow">Planning context</p>
        <h2>Local Context</h2>
        <p>Use the neighborhood, timing, and personal preferences to shape a clearer conversation before choosing a direction.</p>
        <img src="assets/story-detail.png" alt="${escapeHtml(imagePlan[2].alt)}">
      </div>
    </section>
    <section class="contact" id="contact" data-section="contact">
      <div data-first-beat>
        <p class="eyebrow">${city}</p>
        <h2>Confirm Details</h2>
        <p>Service and availability details are not confirmed. Check directly with the business before making plans.</p>
      </div>
    </section>
  </main>
  <footer><p>${name}</p><p>Built for the neighborhood</p></footer>
  <script src="script.js" defer></script>
</body>
</html>`;

  const palette = brief.brand.palette;
  const stylesCss = `:root {
  color-scheme: light;
  --paper: ${safeColor(palette.background, "#f3ebdd")};
  --surface: ${safeColor(palette.surface, "#d8c5a5")};
  --ink: ${safeColor(palette.text, "#252820")};
  --accent: ${safeColor(palette.accent, "#315748")};
  --line: color-mix(in srgb, var(--ink) 24%, transparent);
  --serif: Georgia, "Times New Roman", serif;
  --sans: Arial, Helvetica, sans-serif;
}
* { box-sizing: border-box; }
html { scroll-behavior: smooth; }
body { margin: 0; background: var(--paper); color: var(--ink); font-family: var(--sans); }
a { color: inherit; }
a:focus-visible { outline: 3px solid var(--accent); outline-offset: 5px; }
.skip-link { position: fixed; top: 1rem; left: 1rem; z-index: 20; padding: .75rem 1rem; background: var(--ink); color: var(--paper); transform: translateY(-180%); }
.skip-link:focus { transform: translateY(0); }
.site-header { display: flex; align-items: center; justify-content: space-between; padding: 1.25rem clamp(1.25rem, 4vw, 4.5rem); border-bottom: 1px solid var(--line); }
.wordmark { font-family: var(--serif); font-size: 1.25rem; font-weight: 700; text-decoration: none; }
nav { display: flex; gap: clamp(.8rem, 3vw, 2.2rem); }
nav a { font-size: .75rem; font-weight: 700; letter-spacing: .12em; text-decoration: none; text-transform: uppercase; }
.hero { min-height: 78vh; display: grid; align-items: stretch; border-bottom: 1px solid var(--line); }
.hero-copy { display: flex; flex-direction: column; justify-content: center; padding: clamp(4rem, 11vw, 9rem) clamp(1.25rem, 7vw, 8rem); }
.eyebrow { margin: 0 0 1.5rem; font-size: .72rem; font-weight: 800; letter-spacing: .18em; text-transform: uppercase; }
h1, h2, h3, p { text-wrap: pretty; }
h1, h2, h3 { font-family: var(--serif); font-weight: 500; line-height: .98; }
h1 { max-width: 12ch; margin: 0; font-size: clamp(3.7rem, 10vw, 8.8rem); letter-spacing: -.055em; }
.hero-intro { max-width: 38rem; margin: 2rem 0; font-size: clamp(1.05rem, 2vw, 1.35rem); line-height: 1.65; }
.primary-action { align-self: flex-start; padding: .9rem 0 .55rem; border-bottom: 2px solid currentColor; font-weight: 800; text-decoration: none; }
.hero-art { position: relative; min-height: 22rem; overflow: hidden; background: var(--accent); }
.hero-art img { width: 100%; height: 100%; min-height: 22rem; object-fit: cover; }
.hero-art::before { content: ""; position: absolute; inset: 9% 8%; border: 1px solid color-mix(in srgb, var(--paper) 55%, transparent); }
.hero-art span { position: absolute; width: 42%; aspect-ratio: 1; border: clamp(1rem, 3vw, 2.5rem) solid var(--surface); border-radius: 50%; }
.hero-art span:nth-child(1) { left: 8%; top: 13%; }
.hero-art span:nth-child(2) { right: 6%; top: 35%; }
.hero-art span:nth-child(3) { left: 27%; bottom: -16%; }
.offerings-section { padding: clamp(5rem, 10vw, 9rem) clamp(1.25rem, 7vw, 8rem); }
.section-heading { display: grid; gap: 1rem; margin-bottom: 4rem; }
.section-heading h2 { max-width: 16ch; margin: 0; font-size: clamp(2.6rem, 6vw, 5rem); }
.section-heading img, .story img { width: min(100%, 34rem); height: auto; }
.offerings-list { border-top: 1px solid var(--line); }
.offering { display: grid; grid-template-columns: 3rem 1fr; gap: .5rem 1.5rem; padding: 1.6rem 0; border-bottom: 1px solid var(--line); }
.offering-number { grid-row: span 2; margin: .35rem 0 0; font-size: .72rem; letter-spacing: .12em; }
.offering h3 { margin: 0; font-size: clamp(1.65rem, 4vw, 2.5rem); }
.offering p:last-child { max-width: 35rem; margin: .35rem 0 0; line-height: 1.6; }
.story { display: grid; gap: 2rem; padding: clamp(5rem, 11vw, 10rem) clamp(1.25rem, 7vw, 8rem); background: var(--ink); color: var(--paper); }
.story-marker { display: grid; place-items: center; width: min(58vw, 22rem); aspect-ratio: 1; border: 1px solid color-mix(in srgb, var(--paper) 35%, transparent); border-radius: 50%; font-family: var(--serif); font-size: clamp(6rem, 20vw, 13rem); color: var(--surface); }
.story h2 { max-width: 14ch; margin: 0; font-size: clamp(2.8rem, 7vw, 6rem); }
.story p:last-child { max-width: 44rem; font-size: 1.15rem; line-height: 1.75; }
.contact { padding: clamp(5rem, 11vw, 10rem) clamp(1.25rem, 7vw, 8rem); background: var(--surface); }
.contact h2 { max-width: 17ch; margin: 0 0 2rem; font-size: clamp(2.8rem, 7vw, 6.3rem); }
.contact p:last-child { max-width: 36rem; line-height: 1.7; }
footer { display: flex; justify-content: space-between; gap: 1rem; padding: 1.5rem clamp(1.25rem, 4vw, 4.5rem); font-size: .8rem; border-top: 1px solid var(--line); }
@media (min-width: 780px) {
  .hero { grid-template-columns: minmax(0, 1.35fr) minmax(20rem, .65fr); }
  .section-heading { grid-template-columns: .45fr 1fr; }
  .offering { grid-template-columns: 4rem minmax(15rem, .8fr) 1fr; align-items: start; }
  .offering-number { grid-row: auto; }
  .offering p:last-child { margin-top: .25rem; }
  .story { grid-template-columns: .7fr 1.3fr; align-items: center; }
}
@media (max-width: 560px) {
  .site-header { align-items: flex-start; }
  nav { flex-direction: column; gap: .55rem; align-items: flex-end; }
  .hero { min-height: auto; }
  footer { flex-direction: column; }
}
@media (prefers-reduced-motion: reduce) {
  html { scroll-behavior: auto; }
  *, *::before, *::after { animation-duration: .01ms !important; animation-iteration-count: 1 !important; transition-duration: .01ms !important; }
}`;

  return {
    indexHtml,
    stylesCss: `${stylesCss}\n${createOwnedMotionStyles(motionMoves)}`,
    scriptJs: createOwnedMotionRuntime(motionMoves),
    imagePlan,
    designNotes: {
      aesthetic: brief.brand.aesthetic,
      signatureMove: brief.brand.signatureMove.description,
      rationale: "A deterministic editorial baseline preserves the brief and accessibility when model generation is unavailable.",
      shootDirection: "Natural morning light tactile materials calm framing and one consistent lens feel",
      motionMoves,
    },
  };
}

function createGuidanceItems(brief) {
  const categoryHints = [
    brief?.business?.category,
    ...(Array.isArray(brief?.offerings) ? brief.offerings.map((offering) => offering?.name) : []),
  ]
    .filter(Boolean)
    .join(" ")
    .toLocaleLowerCase("en-US");

  if (/flor|flower|bouquet/.test(categoryHints)) {
    return [
      {
        name: "Gift Moment",
        description: "Consider color, scale, and how the flowers will travel with the recipient.",
      },
      {
        name: "Event Setting",
        description: "For a gathering, consider the setting, timing, and colors before choosing a direction.",
      },
      {
        name: "Seasonal Mood",
        description: "Use season, texture, and palette as a starting point for a clearer conversation.",
      },
    ];
  }
  if (/bak|bread|oven|pastr/.test(categoryHints)) {
    return [
      {
        name: "Bread Style",
        description: "Consider texture, flavor, and the meal the bread will accompany.",
      },
      {
        name: "Sharing Size",
        description: "Think about the table, the number of guests, and how the food will be shared.",
      },
      {
        name: "Flavor Direction",
        description: "Use familiar tastes, season, and occasion to narrow the right direction.",
      },
    ];
  }
  if (/bicycle|bike|cycle|wheel/.test(categoryHints)) {
    return [
      {
        name: "Ride Pattern",
        description: "Consider distance, terrain, frequency, and the way the bicycle is used.",
      },
      {
        name: "Repair Priorities",
        description: "Note current symptoms, recent changes, and the result that matters most.",
      },
      {
        name: "Route Context",
        description: "Daily routes, weather, and storage can help frame a more useful conversation.",
      },
    ];
  }
  return [
    {
      name: "First Priority",
      description: "Start with the result that matters most and the context around it.",
    },
    {
      name: "Use Setting",
      description: "Consider where, when, and how the final choice needs to work.",
    },
    {
      name: "Personal Fit",
      description: "Gather preferences and constraints before confirming a direction.",
    },
  ];
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function safeColor(value, fallback) {
  return /^#[0-9a-f]{6}$/i.test(value ?? "") ? value : fallback;
}
