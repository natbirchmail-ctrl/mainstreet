#!/usr/bin/env node

import "dotenv/config";

import path from "node:path";
import { createInterface } from "node:readline/promises";
import { pathToFileURL } from "node:url";

import { buildRun } from "../src/build.js";
import { runCriticCycle } from "../src/critic.js";
import { deployRun, findSelectedSite } from "../src/deploy.js";
import { conductOwnerInterview, createBrief } from "../src/intake.js";
import { initializeRun, resolveInside, writeJsonNew } from "../src/lib/runs.js";
import { executePipeline } from "../src/pipeline.js";
import { reviseRun } from "../src/revise.js";
import { findLatestSite, startStaticServer } from "../src/serve.js";
import { slugify } from "../src/lib/slug.js";

const booleanFlags = new Set(["fast", "help"]);
const valueFlags = new Set(["city", "details", "port", "cycle", "max-cycles"]);

export function parseCli(argv) {
  const [command = "help", ...tokens] = argv;
  const positionals = [];
  const flags = {};

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token.startsWith("--")) {
      positionals.push(token);
      continue;
    }

    const flag = token.slice(2);
    if (booleanFlags.has(flag)) {
      flags[toCamelCase(flag)] = true;
      continue;
    }
    if (!valueFlags.has(flag)) {
      throw new TypeError(`Unknown option: --${flag}`);
    }

    const value = tokens[index + 1];
    if (!value || value.startsWith("--")) {
      throw new TypeError(`Option --${flag} requires a value.`);
    }
    flags[toCamelCase(flag)] = value;
    index += 1;
  }

  return { command, positionals, flags };
}

export async function main(argv = process.argv.slice(2), dependencies = {}) {
  const {
    conductOwnerInterviewFn = conductOwnerInterview,
    createBriefFn = createBrief,
    executePipelineFn = executePipeline,
    initializeRunFn = initializeRun,
    promptInterfaceFactory = createTerminalPromptInterface,
    stdout = process.stdout,
    writeJsonNewFn = writeJsonNew,
  } = dependencies;
  const parsed = parseCli(argv);

  if (parsed.command === "help" || parsed.flags.help) {
    stdout.write(helpText());
    return;
  }

  const projectRoot = process.cwd();
  const runsRoot = path.resolve(
    process.env.MAINSTREET_RUNS_DIR || path.join(projectRoot, "runs"),
  );
  const trashRoot = path.resolve(
    process.env.MAINSTREET_TRASH_DIR || path.join(projectRoot, ".trash", "runs"),
  );

  if (parsed.command === "intake") {
    const businessName = parsed.positionals.join(" ").trim();
    if (!businessName) {
      throw new TypeError("The intake command requires a business name.");
    }

    const fast = Boolean(parsed.flags.fast);
    const interviewAnswers = fast
      ? undefined
      : await collectOwnerInterview({
          businessName,
          city: parsed.flags.city,
          details: parsed.flags.details,
          conductOwnerInterviewFn,
          promptInterfaceFactory,
          stdout,
        });
    const slug = slugify(businessName);
    const { runDir } = await initializeRunFn({ slug, runsRoot, trashRoot });

    const brief = await createBriefFn({
      businessName,
      city: parsed.flags.city,
      details: parsed.flags.details,
      ...(fast ? {} : { interviewAnswers }),
      fast,
    });
    const briefPath = resolveInside(runDir, "brief.json");
    await writeJsonNewFn(briefPath, brief);

    stdout.write(`Brief saved: ${briefPath}\n`);
    return;
  }

  if (parsed.command === "build") {
    const slug = slugify(parsed.positionals.join(" "));
    const runDir = resolveInside(runsRoot, slug);
    const result = await buildRun({ runDir });
    stdout.write(`Site built: ${result.siteDir}\n`);
    return;
  }

  if (parsed.command === "serve") {
    const slug = slugify(parsed.positionals.join(" "));
    const runDir = resolveInside(runsRoot, slug);
    const siteDir = await findLatestSite(runDir);
    const port = parsed.flags.port ? Number(parsed.flags.port) : 4601;
    const preview = await startStaticServer({ root: siteDir, port });
    stdout.write(`Serving ${slug}: ${preview.url}\n`);
    await new Promise(() => {});
  }

  if (parsed.command === "critique") {
    const slug = slugify(parsed.positionals.join(" "));
    const runDir = resolveInside(runsRoot, slug);
    const latestSite = await findLatestSite(runDir);
    const inferredCycle = Number(path.basename(path.dirname(latestSite)).slice("cycle-".length));
    const cycle = parsed.flags.cycle ? Number(parsed.flags.cycle) : inferredCycle;
    const critique = await runCriticCycle({ runDir, cycle });
    stdout.write(
      `Critique complete: ${critique.score}/100 (${critique.verdict})\n`,
    );
    return;
  }

  if (parsed.command === "revise") {
    const slug = slugify(parsed.positionals.join(" "));
    const runDir = resolveInside(runsRoot, slug);
    const latestSite = await findLatestSite(runDir);
    const inferredCycle = Number(path.basename(path.dirname(latestSite)).slice("cycle-".length));
    const fromCycle = parsed.flags.cycle ? Number(parsed.flags.cycle) : inferredCycle;
    const revision = await reviseRun({ runDir, fromCycle });
    stdout.write(`Revision built: cycle ${revision.toCycle}\n`);
    return;
  }

  if (parsed.command === "deploy") {
    const slug = slugify(parsed.positionals.join(" "));
    const runDir = resolveInside(runsRoot, slug);
    const siteDir = await findSelectedSite(runDir);
    const selectedCycle = Number(
      path.basename(path.dirname(siteDir)).slice("cycle-".length),
    );
    let localPreview = null;
    const deployment = await deployRun({
      runDir,
      slug,
      selectedCycle,
      siteDir,
      startLocalFn: async ({ root, port }) => {
        localPreview = await startStaticServer({ root, port });
        return localPreview;
      },
    });
    stdout.write(`Site URL: ${deployment.url}\n`);
    if (localPreview) {
      await new Promise(() => {});
    }
    return;
  }

  if (parsed.command === "run") {
    const businessName = parsed.positionals.join(" ").trim();
    if (!businessName) {
      throw new TypeError("The run command requires a business name.");
    }
    const maxCycles = parsed.flags.maxCycles ? Number(parsed.flags.maxCycles) : 3;
    const fast = Boolean(parsed.flags.fast);
    const interviewAnswers = fast
      ? undefined
      : await collectOwnerInterview({
          businessName,
          city: parsed.flags.city,
          details: parsed.flags.details,
          conductOwnerInterviewFn,
          promptInterfaceFactory,
          stdout,
        });
    let localPreview = null;
    const pipelineInput = {
      businessName,
      city: parsed.flags.city,
      details: parsed.flags.details,
      fast,
      maxCycles,
      runsRoot,
      trashRoot,
      deliveryFn: (input) =>
        deployRun({
          ...input,
          startLocalFn: async ({ root, port }) => {
            localPreview = await startStaticServer({ root, port });
            return localPreview;
          },
        }),
      onProgress: (event) => printProgress(event, stdout),
    };
    if (!fast) {
      pipelineInput.createBriefFn = (input) =>
        createBriefFn({ ...input, interviewAnswers });
    }
    const result = await executePipelineFn(pipelineInput);
    stdout.write(`Site URL: ${result.delivery.url}\n`);
    if (localPreview) {
      stdout.write(`Local preview running: ${localPreview.url}\n`);
      await new Promise(() => {});
    }
    return;
  }

  throw new TypeError(`Unknown command: ${parsed.command}`);
}

export function createTerminalPromptInterface({
  input = process.stdin,
  output = process.stdout,
} = {}) {
  const terminal = createInterface({ input, output });
  let activeQuestion = null;
  let closed = false;
  terminal.once("close", () => {
    closed = true;
    activeQuestion?.abort();
  });
  terminal.on("SIGINT", () => activeQuestion?.abort());
  return {
    ask: async ({ index, total, label, question }) => {
      if (closed) {
        throw new Error("Terminal input closed.");
      }
      const controller = new AbortController();
      activeQuestion = controller;
      try {
        return await terminal.question(
          `\nQuestion ${index} of ${total}: ${label}\n${question}\n> `,
          { signal: controller.signal },
        );
      } finally {
        if (activeQuestion === controller) {
          activeQuestion = null;
        }
      }
    },
    close: () => terminal.close(),
  };
}

async function collectOwnerInterview({
  businessName,
  city,
  details,
  conductOwnerInterviewFn,
  promptInterfaceFactory,
  stdout,
}) {
  const promptInterface = promptInterfaceFactory({
    input: process.stdin,
    output: stdout,
  });
  try {
    return await conductOwnerInterviewFn({
      businessName,
      city,
      details,
      promptInterface,
    });
  } finally {
    promptInterface?.close?.();
  }
}

function toCamelCase(value) {
  return value.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
}

function helpText() {
  return `Mainstreet\n\nUsage:\n  mainstreet run "Business Name" [--city "City, ST"] [--details "Known facts"] [--fast] [--max-cycles 3]\n  mainstreet intake "Business Name" [--city "City, ST"] [--details "Known facts"] [--fast]\n  mainstreet build <slug>\n  mainstreet critique <slug> [--cycle 1]\n  mainstreet revise <slug> [--cycle 1]\n  mainstreet deploy <slug>\n  mainstreet serve <slug> [--port 4601]\n`;
}

function printProgress(event, output = process.stdout) {
  switch (event.type) {
    case "run_started":
      output.write(`Run started: ${event.slug}\n`);
      break;
    case "intake_complete":
      output.write("Intake brief complete.\n");
      break;
    case "build_complete":
      output.write(`Build complete: cycle ${event.cycle}.\n`);
      break;
    case "critique_complete":
      output.write(
        `Critic cycle ${event.cycle}: ${event.score}/100 (${event.verdict}).\n`,
      );
      break;
    case "revision_complete":
      output.write(`Revision complete: cycle ${event.toCycle}.\n`);
      break;
    case "delivery_complete":
      output.write(`Delivery selected: ${event.delivery.mode}.\n`);
      break;
    default:
      break;
  }
}

const isEntryPoint =
  process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isEntryPoint) {
  main().catch((error) => {
    process.stderr.write(`Mainstreet failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}
