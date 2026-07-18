import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { requestStructured } from "./lib/openai.js";
import { resolveInside, writeJsonNew } from "./lib/runs.js";
import {
  createOwnedMotionRuntime,
  motionSlugsFor,
} from "./motion.js";

export { createOwnedMotionRuntime } from "./motion.js";

const projectRoot = new URL("../", import.meta.url);
const promptUrl = new URL("prompts/build-system.md", projectRoot);
const schemaUrl = new URL("prompts/schemas/site.schema.json", projectRoot);

export async function buildSite({
  brief,
  model = process.env.OPENAI_MODEL || "gpt-5.6",
  client,
  structuredRequester = requestStructured,
}) {
  if (!brief?.business?.name) {
    throw new TypeError("A complete brief is required to build a site.");
  }

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

    try {
      const hydrated = hydrateSiteManifest(candidate);
      return { ...hydrated, source: "openai" };
    } catch (error) {
      lastValidationError = error;
    }
  }

  const fallback = createDeterministicSite(brief);
  validateSiteManifest(fallback);
  return {
    ...fallback,
    source: "deterministic-fallback",
    fallbackReason: lastValidationError?.message || "OpenAI generation was unavailable.",
  };
}

export async function buildRun({
  runDir,
  buildSiteFn = buildSite,
  now = () => new Date(),
}) {
  const briefPath = resolveInside(runDir, "brief.json");
  const brief = JSON.parse(await readFile(briefPath, "utf8"));
  const manifest = await buildSiteFn({ brief });
  const cycleDir = resolveInside(runDir, "cycle-01");
  const siteDir = resolveInside(cycleDir, "site");

  await writeSiteFiles(siteDir, manifest);
  await writeJsonNew(resolveInside(cycleDir, "build.json"), {
    cycle: 1,
    createdAt: now().toISOString(),
    source: manifest.source,
    fallbackReason: manifest.fallbackReason ?? null,
    designNotes: manifest.designNotes,
    imagePlan: manifest.imagePlan,
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
    scriptJs: createOwnedMotionRuntime(manifest.designNotes.motionMoves),
  };
  validateSiteManifest(hydrated);
  return hydrated;
}

const manifestFields = ["indexHtml", "stylesCss", "scriptJs", "imagePlan", "designNotes"];
const buildMetadataFields = ["source", "fallbackReason"];
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

  if (modelOutput) {
    if (manifest.scriptJs !== "") {
      throw new Error("Model scriptJs must be the empty sentinel.");
    }
  } else {
    const expectedRuntime = createOwnedMotionRuntime(motionMoves);
    if (manifest.scriptJs !== expectedRuntime) {
      throw new Error("Site manifest must contain the exact owned motion runtime.");
    }
  }

  validateHtml(manifest.indexHtml, manifest.imagePlan, motionMoves);
  validateCss(manifest.stylesCss);
  validateVisibleCopy(manifest.indexHtml);
  return manifest;
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
      if (!openingTags(element.inner).some(({ raw }) => attributeEntries(raw, "data-motion-target").length === 1)) {
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
  if (
    /@import\b|url\s*\(|expression\s*\(|(?:^|[;{]\s*)behavior\s*:|(?:https?:|data\s*:|blob\s*:)/im.test(css)
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

export async function writeSiteFiles(siteDir, manifest) {
  validateSiteManifest(manifest);
  await mkdir(siteDir, { recursive: true });
  await Promise.all([
    writeNew(path.join(siteDir, "index.html"), manifest.indexHtml),
    writeNew(path.join(siteDir, "styles.css"), manifest.stylesCss),
    writeNew(path.join(siteDir, "script.js"), manifest.scriptJs),
  ]);
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

async function writeNew(target, value) {
  try {
    await writeFile(target, value.endsWith("\n") ? value : `${value}\n`, {
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

function createDeterministicSite(brief) {
  const name = escapeHtml(brief.business.name);
  const city = brief.business.city ? escapeHtml(brief.business.city) : "Your neighborhood";
  const content = brief.content;
  const motionMoves = ["staged hero entrance"];
  const imagePlan = [
    {
      filename: "workbench-hero.png",
      role: "hero",
      alt: "Hands arranging materials on a clean work surface",
      prompt: `Contemporary editorial hero scene for ${brief.business.name} with natural materials and calm light`,
      focalPoint: { x: 0.56, y: 0.44 },
    },
    {
      filename: "offerings-detail.png",
      role: "offerings",
      alt: "A close view of tools and tactile materials",
      prompt: `Close editorial detail of the work and materials associated with ${brief.business.name}`,
      focalPoint: { x: 0.5, y: 0.5 },
    },
    {
      filename: "story-detail.png",
      role: "story",
      alt: "A quiet neighborhood scene in natural morning light",
      prompt: `Quiet neighborhood context scene for ${brief.business.name} using the same light palette and lens feel`,
      focalPoint: { x: 0.42, y: 0.52 },
    },
  ];
  const offerings = brief.offerings
    .slice(0, 4)
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
  <meta name="description" content="${escapeHtml(brief.business.summary)}">
  <meta http-equiv="Content-Security-Policy" content="default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'">
  <title>${name}</title>
  <link rel="stylesheet" href="styles.css">
</head>
<body data-motion-moves="staged-hero-entrance">
  <a class="skip-link" href="#main">Skip to content</a>
  <header class="site-header">
    <a class="wordmark" href="#top" aria-label="${name} home">${name}</a>
    <nav aria-label="Primary">
      <a href="#offerings">Offerings</a>
      <a href="#story">Story</a>
      <a href="#contact">Contact</a>
    </nav>
  </header>
  <main id="main">
    <section class="hero" id="top" data-section="hero" data-motion-root="staged-hero-entrance">
      <div class="hero-copy" data-first-beat data-motion-target>
        <p class="eyebrow">${escapeHtml(content.eyebrow)}</p>
        <h1>${escapeHtml(content.headline)}</h1>
        <p class="hero-intro">${escapeHtml(content.subheadline)}</p>
        <a class="primary-action" href="#offerings" data-primary-action>${escapeHtml(content.primaryAction)}</a>
      </div>
      <div class="hero-art"><img src="assets/workbench-hero.png" alt="${escapeHtml(imagePlan[0].alt)}"><span></span><span></span><span></span></div>
    </section>
    <section class="offerings-section" id="offerings" data-section="offerings">
      <div class="section-heading" data-first-beat>
        <p class="eyebrow">What we make</p>
        <h2>A small collection with a clear point of view</h2>
        <img src="assets/offerings-detail.png" alt="${escapeHtml(imagePlan[1].alt)}">
      </div>
      <div class="offerings-list">${offerings}
      </div>
    </section>
    <section class="story" id="story" data-section="story">
      <div class="story-marker" aria-hidden="true">${name.charAt(0)}</div>
      <div data-first-beat>
        <p class="eyebrow">Our point of view</p>
        <h2>Made with attention. Shared with ease.</h2>
        <p>${escapeHtml(content.about)}</p>
        <img src="assets/story-detail.png" alt="${escapeHtml(imagePlan[2].alt)}">
      </div>
    </section>
    <section class="contact" id="contact" data-section="contact">
      <div data-first-beat>
        <p class="eyebrow">${city}</p>
        <h2>${escapeHtml(content.contactPrompt)}</h2>
        <p>Verified contact details will appear here when the owner provides them.</p>
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
    stylesCss,
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
