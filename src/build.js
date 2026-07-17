import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { requestStructured } from "./lib/openai.js";
import { resolveInside, writeJsonNew } from "./lib/runs.js";

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
      validateSiteManifest(candidate);
      return { ...candidate, source: "openai" };
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
  });

  return { cycle: 1, cycleDir, siteDir, manifest };
}

export function validateSiteManifest(manifest) {
  if (!manifest || typeof manifest !== "object") {
    throw new TypeError("Site manifest is required.");
  }
  if (!manifest.indexHtml?.trim() || !manifest.stylesCss?.trim()) {
    throw new TypeError("Site manifest must contain indexHtml and stylesCss.");
  }
  if (!manifest.designNotes || typeof manifest.designNotes !== "object") {
    throw new TypeError("Site manifest must contain designNotes.");
  }

  const html = manifest.indexHtml;
  const css = manifest.stylesCss;
  const requiredHtml = [
    /<!doctype html>/i,
    /<html\b[^>]*\blang=/i,
    /<meta\b[^>]*\bname=["']viewport["']/i,
    /<link\b[^>]*\bhref=["']styles\.css["']/i,
    /<main\b/i,
    /<h1\b/i,
  ];
  if (requiredHtml.some((pattern) => !pattern.test(html))) {
    throw new Error("Generated HTML is missing required semantic structure.");
  }

  if (
    /<(script|iframe|object|embed|form|base)\b/i.test(html) ||
    /\son[a-z]+\s*=/i.test(html) ||
    /(?:https?:)?\/\//i.test(html) ||
    /(?:javascript|data\s*:\s*text\/html)\s*:/i.test(html)
  ) {
    throw new Error("Generated site contains forbidden HTML or active content.");
  }
  if (/\bframe-ancestors\b/i.test(html)) {
    throw new Error("frame-ancestors is not valid in an HTML meta policy.");
  }

  if (/@import\b|url\s*\(|expression\s*\(|(?:^|[;{]\s*)behavior\s*:/im.test(css)) {
    throw new Error("Generated site contains remote or embedded CSS assets.");
  }

  const visibleText = extractVisibleText(html);
  if (/[-\u2010-\u2015]/.test(visibleText)) {
    throw new Error("Generated visible copy contains dash characters.");
  }
  if (/\p{Extended_Pictographic}/u.test(visibleText)) {
    throw new Error("Generated visible copy contains emoji.");
  }
  if (/\b(lorem ipsum|todo|tbd|placeholder|insert here|example\.com|555[\s-]?\d+)\b/i.test(visibleText)) {
    throw new Error("Generated visible copy contains placeholder content.");
  }

  return manifest;
}

export async function writeSiteFiles(siteDir, manifest) {
  validateSiteManifest(manifest);
  await mkdir(siteDir, { recursive: true });
  await Promise.all([
    writeNew(path.join(siteDir, "index.html"), manifest.indexHtml),
    writeNew(path.join(siteDir, "styles.css"), manifest.stylesCss),
  ]);
}

function extractVisibleText(html) {
  return html
    .replace(/<!--[^]*?-->/g, " ")
    .replace(/<style\b[^>]*>[^]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(?:nbsp|amp|quot|apos|lt|gt);/gi, " ")
    .replace(/&#(?:x[0-9a-f]+|\d+);/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
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
  <meta http-equiv="Content-Security-Policy" content="default-src 'self'; style-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'">
  <title>${name}</title>
  <link rel="stylesheet" href="styles.css">
</head>
<body>
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
    <section class="hero" id="top">
      <div class="hero-copy">
        <p class="eyebrow">${escapeHtml(content.eyebrow)}</p>
        <h1>${escapeHtml(content.headline)}</h1>
        <p class="hero-intro">${escapeHtml(content.subheadline)}</p>
        <a class="primary-action" href="#offerings">${escapeHtml(content.primaryAction)}</a>
      </div>
      <div class="hero-art" aria-hidden="true"><span></span><span></span><span></span></div>
    </section>
    <section class="offerings-section" id="offerings">
      <div class="section-heading">
        <p class="eyebrow">What we make</p>
        <h2>A small collection with a clear point of view</h2>
      </div>
      <div class="offerings-list">${offerings}
      </div>
    </section>
    <section class="story" id="story">
      <div class="story-marker" aria-hidden="true">${name.charAt(0)}</div>
      <div>
        <p class="eyebrow">Our point of view</p>
        <h2>Made with attention. Shared with ease.</h2>
        <p>${escapeHtml(content.about)}</p>
      </div>
    </section>
    <section class="contact" id="contact">
      <p class="eyebrow">${city}</p>
      <h2>${escapeHtml(content.contactPrompt)}</h2>
      <p>Verified contact details will appear here when the owner provides them.</p>
    </section>
  </main>
  <footer><p>${name}</p><p>Built for the neighborhood</p></footer>
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
.hero-art::before { content: ""; position: absolute; inset: 9% 8%; border: 1px solid color-mix(in srgb, var(--paper) 55%, transparent); }
.hero-art span { position: absolute; width: 42%; aspect-ratio: 1; border: clamp(1rem, 3vw, 2.5rem) solid var(--surface); border-radius: 50%; }
.hero-art span:nth-child(1) { left: 8%; top: 13%; }
.hero-art span:nth-child(2) { right: 6%; top: 35%; }
.hero-art span:nth-child(3) { left: 27%; bottom: -16%; }
.offerings-section { padding: clamp(5rem, 10vw, 9rem) clamp(1.25rem, 7vw, 8rem); }
.section-heading { display: grid; gap: 1rem; margin-bottom: 4rem; }
.section-heading h2 { max-width: 16ch; margin: 0; font-size: clamp(2.6rem, 6vw, 5rem); }
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
    designNotes: {
      aesthetic: brief.brand.aesthetic,
      signatureMove: brief.brand.signatureMove.description,
      rationale: "A deterministic editorial baseline preserves the brief and accessibility when model generation is unavailable.",
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
