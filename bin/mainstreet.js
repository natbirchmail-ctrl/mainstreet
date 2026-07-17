#!/usr/bin/env node

import "dotenv/config";

import path from "node:path";
import { pathToFileURL } from "node:url";

import { createBrief } from "../src/intake.js";
import { initializeRun, resolveInside, writeJsonNew } from "../src/lib/runs.js";
import { slugify } from "../src/lib/slug.js";

const booleanFlags = new Set(["fast", "help"]);
const valueFlags = new Set(["city", "details", "port", "max-cycles"]);

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

export async function main(argv = process.argv.slice(2)) {
  const parsed = parseCli(argv);

  if (parsed.command === "help" || parsed.flags.help) {
    process.stdout.write(helpText());
    return;
  }

  if (parsed.command !== "intake") {
    throw new TypeError(`Unknown command: ${parsed.command}`);
  }

  const businessName = parsed.positionals.join(" ").trim();
  if (!businessName) {
    throw new TypeError("The intake command requires a business name.");
  }

  const slug = slugify(businessName);
  const projectRoot = process.cwd();
  const runsRoot = path.resolve(
    process.env.MAINSTREET_RUNS_DIR || path.join(projectRoot, "runs"),
  );
  const trashRoot = path.resolve(
    process.env.MAINSTREET_TRASH_DIR || path.join(projectRoot, ".trash", "runs"),
  );
  const { runDir } = await initializeRun({ slug, runsRoot, trashRoot });

  const brief = await createBrief({
    businessName,
    city: parsed.flags.city,
    details: parsed.flags.details,
    fast: Boolean(parsed.flags.fast),
  });
  const briefPath = resolveInside(runDir, "brief.json");
  await writeJsonNew(briefPath, brief);

  process.stdout.write(`Brief saved: ${briefPath}\n`);
}

function toCamelCase(value) {
  return value.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
}

function helpText() {
  return `Mainstreet\n\nUsage:\n  mainstreet intake "Business Name" [--city "City, ST"] [--details "Known facts"] [--fast]\n`;
}

const isEntryPoint =
  process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isEntryPoint) {
  main().catch((error) => {
    process.stderr.write(`Mainstreet failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}
