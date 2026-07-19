import { readFile } from "node:fs/promises";
import path from "node:path";

import { captureRenderedEvidence } from "./critic-evidence.js";
import {
  deriveCritiqueOutcome,
  normalizeModelCritique,
} from "./critic-policy.js";
import { requestStructured } from "./lib/openai.js";
import { resolveInside, writeJsonNew } from "./lib/runs.js";
import { EVIDENCE_VIEWPORTS } from "./viewports.js";

const projectRoot = new URL("../", import.meta.url);
const promptUrl = new URL("prompts/critic-system.md", projectRoot);
const sourcePromptUrl = new URL("prompts/critic-source-system.md", projectRoot);
const schemaUrl = new URL("prompts/schemas/critique.schema.json", projectRoot);
const CRITIC_VIEWPORT_NAMES = Object.freeze(["desktop", "tablet", "phone"]);

export const captureCycle = captureRenderedEvidence;
export { EVIDENCE_VIEWPORTS };

export async function critiqueCycle({
  brief,
  cycleDir,
  model = process.env.OPENAI_MODEL || "gpt-5.6",
  client,
  structuredRequester = requestStructured,
}) {
  const screenshotsDir = resolveInside(cycleDir, "screenshots");
  const [systemPrompt, schema, desktop, tablet, phone, visibleText] = await Promise.all([
    readFile(promptUrl, "utf8"),
    readFile(schemaUrl, "utf8").then(JSON.parse),
    readFile(resolveInside(screenshotsDir, EVIDENCE_VIEWPORTS.desktop.filename)),
    readFile(resolveInside(screenshotsDir, EVIDENCE_VIEWPORTS.tablet.filename)),
    readFile(resolveInside(screenshotsDir, EVIDENCE_VIEWPORTS.phone.filename)),
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
          viewports: Object.fromEntries(
            CRITIC_VIEWPORT_NAMES.map((name) => [
              name,
              {
                width: EVIDENCE_VIEWPORTS[name].width,
                height: EVIDENCE_VIEWPORTS[name].height,
              },
            ]),
          ),
        }),
      },
      {
        type: "input_image",
        image_url: `data:image/png;base64,${desktop.toString("base64")}`,
        detail: "high",
      },
      {
        type: "input_image",
        image_url: `data:image/png;base64,${tablet.toString("base64")}`,
        detail: "high",
      },
      {
        type: "input_image",
        image_url: `data:image/png;base64,${phone.toString("base64")}`,
        detail: "high",
      },
    ],
    maxOutputTokens: 10_000,
  });

  return normalizeModelCritique(candidate);
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
  return normalizeModelCritique(candidate);
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
  let assetsResolved = null;
  let critique;
  try {
    const evidence = await captureCycleFn({ siteDir, cycleDir, port });
    mechanical = evidence.mechanical;
    assetsResolved = evidence.assetsResolved;
  } catch (error) {
    if (error?.code !== "CAPTURE_UNAVAILABLE") throw error;
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

  const outcome = deriveCritiqueOutcome(critique, {
    mechanicalPassed: mechanical?.passed ?? null,
    assetsResolved,
    mode,
  });
  const artifact = {
    ...outcome,
    cycle,
    createdAt: now().toISOString(),
  };
  await writeJsonNew(resolveInside(cycleDir, "critique.json"), artifact);
  return artifact;
}

function cycleNumberFromPath(cycleDir) {
  const match = path.basename(path.resolve(cycleDir)).match(/^cycle-(\d{2})$/);
  return match ? Number(match[1]) : 0;
}
