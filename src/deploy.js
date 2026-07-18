import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { resolveInside, writeJsonNew } from "./lib/runs.js";
import { findLatestSite } from "./serve.js";

const LOCAL_URL = "http://127.0.0.1:4601/";
const DEFAULT_PROJECT = "mainstreet-hackathon";
const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const wranglerBin = fileURLToPath(
  new URL("../node_modules/wrangler/bin/wrangler.js", import.meta.url),
);

export async function deployToPages({
  siteDir,
  projectName = process.env.MAINSTREET_CF_PROJECT || DEFAULT_PROJECT,
  env = process.env,
  runner = runWrangler,
  fetchFn = fetch,
  sleep = defaultSleep,
}) {
  if (!env.CLOUDFLARE_API_TOKEN?.trim() || !env.CLOUDFLARE_ACCOUNT_ID?.trim()) {
    return localFallback("missing_credentials");
  }

  try {
    assertProjectName(projectName);
    const listResult = await runner(["pages", "project", "list", "--json"], { env });
    assertCommandSucceeded(listResult, "PROJECT_READ_FAILED");
    const projects = parseJsonOutput(listResult.stdout);
    const exists = Array.isArray(projects)
      ? projects.some(
          (project) =>
            (project?.name ?? project?.["Project Name"]) === projectName,
        )
      : false;

    if (!exists) {
      const createResult = await runner(
        [
          "pages",
          "project",
          "create",
          projectName,
          "--production-branch",
          "main",
        ],
        { env },
      );
      assertCommandSucceeded(createResult, "PROJECT_CREATE_FAILED");
    }

    const deployResult = await runner(
      [
        "pages",
        "deploy",
        path.resolve(siteDir),
        "--project-name",
        projectName,
        "--branch",
        "main",
      ],
      { env },
    );
    assertCommandSucceeded(deployResult, "DEPLOY_FAILED");
    const deploymentUrl = parseDeploymentUrl(
      `${deployResult.stdout}\n${deployResult.stderr}`,
    );
    const url = `https://${projectName}.pages.dev/`;
    const expectedDigest = digest(
      await readFile(resolveInside(siteDir, "index.html")),
    );
    const verification = await verifyDeployment({
      url,
      expectedDigest,
      fetchFn,
      sleep,
    });

    return {
      mode: "cloudflare",
      projectName,
      url,
      deploymentUrl,
      verified: verification.verified,
      status: verification.status,
      reason: null,
    };
  } catch (error) {
    return {
      ...localFallback("cloudflare_failed"),
      errorCode: error?.code || error?.name || "CLOUDFLARE_ERROR",
    };
  }
}

export async function deployRun({
  runDir,
  slug,
  selectedCycle,
  siteDir,
  deployFn = deployToPages,
  startLocalFn = null,
  now = () => new Date(),
}) {
  const resolvedSiteDir = siteDir || (await findSelectedSite(runDir));
  let result = await deployFn({ siteDir: resolvedSiteDir });
  if (result.mode === "local" && startLocalFn) {
    const preview = await startLocalFn({ root: resolvedSiteDir, port: 4601 });
    result = {
      ...result,
      url: preview.url,
      verified: true,
      status: preview.status ?? null,
    };
  }
  const artifact = {
    schemaVersion: "1.0",
    slug,
    selectedCycle,
    createdAt: now().toISOString(),
    ...result,
  };
  await writeJsonNew(await nextDeploymentArtifactPath(runDir), artifact);
  return artifact;
}

async function nextDeploymentArtifactPath(runDir) {
  const first = resolveInside(runDir, "deployment.json");
  if (!(await pathExists(first))) {
    return first;
  }

  for (let sequence = 2; sequence <= 999; sequence += 1) {
    const candidate = resolveInside(
      runDir,
      "deployments",
      `deployment-${String(sequence).padStart(2, "0")}.json`,
    );
    if (!(await pathExists(candidate))) {
      return candidate;
    }
  }
  throw new Error("Deployment history limit reached.");
}

async function pathExists(target) {
  try {
    await access(target);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

export async function findSelectedSite(runDir) {
  try {
    const report = JSON.parse(
      await readFile(resolveInside(runDir, "run-report.json"), "utf8"),
    );
    if (
      !Number.isInteger(report.selectedCycle) ||
      report.selectedCycle < 1 ||
      report.selectedCycle > 3
    ) {
      throw new Error("Run report contains an invalid selected cycle.");
    }
    return resolveInside(runDir, `cycle-${String(report.selectedCycle).padStart(2, "0")}`, "site");
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
    return findLatestSite(runDir);
  }
}

export function parseDeploymentUrl(output) {
  const matches = String(output).match(/https:\/\/[a-z0-9.-]+\.pages\.dev\/?/gi) ?? [];
  for (const match of matches.reverse()) {
    const url = new URL(match);
    if (url.protocol === "https:" && url.hostname.endsWith(".pages.dev")) {
      url.pathname = "/";
      url.search = "";
      url.hash = "";
      return url.href;
    }
  }
  throw codedError("Cloudflare did not return a valid Pages deployment URL.", "URL_PARSE_FAILED");
}

export function runWrangler(args, { env = process.env } = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [wranglerBin, ...args], {
      cwd: projectRoot,
      env: { ...process.env, ...env, CI: "1" },
      shell: false,
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => child.kill(), 180_000);
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      resolve({ exitCode: 1, stdout: "", stderr: "", errorCode: error.code });
    });
    child.on("close", (exitCode) => {
      clearTimeout(timeout);
      resolve({ exitCode: exitCode ?? 1, stdout, stderr });
    });
  });
}

async function verifyDeployment({ url, expectedDigest, fetchFn, sleep }) {
  let status = null;
  for (let attempt = 1; attempt <= 7; attempt += 1) {
    try {
      const response = await fetchFn(url, {
        redirect: "follow",
        signal: AbortSignal.timeout(5_000),
      });
      status = response.status;
      const bodyDigest = digest(Buffer.from(await response.arrayBuffer()));
      if (response.ok && bodyDigest === expectedDigest) {
        return { verified: true, status };
      }
    } catch {
      status = null;
    }
    if (attempt < 7) {
      await sleep(500 * 2 ** (attempt - 1));
    }
  }
  throw codedError("Cloudflare deployment could not be verified.", "VERIFY_FAILED");
}

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

function assertProjectName(value) {
  if (!/^[a-z0-9](?:[a-z0-9-]{0,56}[a-z0-9])?$/.test(value ?? "")) {
    throw codedError("Cloudflare Pages project name is invalid.", "INVALID_PROJECT_NAME");
  }
}

function parseJsonOutput(output) {
  try {
    return JSON.parse(String(output).trim());
  } catch {
    throw codedError("Cloudflare project output was not valid JSON.", "PROJECT_READ_INVALID");
  }
}

function assertCommandSucceeded(result, code) {
  if (!result || result.exitCode !== 0) {
    throw codedError("Cloudflare command failed.", code);
  }
}

function localFallback(reason) {
  return {
    mode: "local",
    projectName: null,
    url: LOCAL_URL,
    verified: false,
    status: null,
    reason,
  };
}

function codedError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function defaultSleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
