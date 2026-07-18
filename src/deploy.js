import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { access, lstat, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { resolveInside, writeJsonNew } from "./lib/runs.js";
import { findLatestSite } from "./serve.js";

const LOCAL_URL = "http://127.0.0.1:4601/";
const DEFAULT_PROJECT = "mainstreet-hackathon";
const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const execFileAsync = promisify(execFile);
const wranglerBin = fileURLToPath(
  new URL("../node_modules/wrangler/bin/wrangler.js", import.meta.url),
);

export async function createSiteDigestManifest(siteDir) {
  const root = path.resolve(siteDir);
  const rootStat = await lstat(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw codedError("Deployment site root must be a real directory.", "INVALID_SITE_ROOT");
  }

  const files = [];
  await collectSiteFiles(root, root, files);
  if (files.length === 0) {
    throw codedError("Deployment site contains no files.", "EMPTY_SITE");
  }
  files.sort((left, right) => left.path.localeCompare(right.path, "en"));

  const aggregate = createHash("sha256");
  for (const file of files) {
    aggregate.update(file.path, "utf8");
    aggregate.update("\0", "utf8");
    aggregate.update(String(file.bytes), "utf8");
    aggregate.update("\0", "utf8");
    aggregate.update(file.sha256, "utf8");
    aggregate.update("\n", "utf8");
  }
  return {
    aggregateSha256: aggregate.digest("hex"),
    files,
  };
}

export async function deployToPages({
  siteDir,
  projectName = process.env.MAINSTREET_CF_PROJECT || DEFAULT_PROJECT,
  env = process.env,
  runner = runWrangler,
  fetchFn = fetch,
  sleep = defaultSleep,
  digestManifest,
}) {
  const manifest = digestManifest || (await createSiteDigestManifest(siteDir));
  if (!env.CLOUDFLARE_API_TOKEN?.trim() || !env.CLOUDFLARE_ACCOUNT_ID?.trim()) {
    return localFallback("missing_credentials", manifest);
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
    const immutableUrl = parseDeploymentUrl(
      `${deployResult.stdout}\n${deployResult.stderr}`,
    );
    const url = `https://${projectName}.pages.dev/`;
    const verification = await verifyDeployment({
      url,
      expectedFiles: manifest.files,
      fetchFn,
      sleep,
    });

    return {
      mode: "cloudflare",
      projectName,
      url,
      deploymentUrl: immutableUrl,
      immutableUrl,
      verified: verification.verified,
      status: verification.status,
      aggregateSha256: manifest.aggregateSha256,
      files: verification.files,
      reason: null,
    };
  } catch (error) {
    return {
      ...localFallback("cloudflare_failed", manifest),
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
  commitResolver = resolveGitCommit,
  now = () => new Date(),
}) {
  if (!Number.isInteger(selectedCycle) || selectedCycle < 1 || selectedCycle > 3) {
    throw new TypeError("Selected cycle must be an integer from 1 through 3.");
  }
  const resolvedSiteDir = siteDir || (await findSelectedSite(runDir));
  const expectedSiteDir = resolveInside(
    runDir,
    `cycle-${String(selectedCycle).padStart(2, "0")}`,
    "site",
  );
  if (path.resolve(resolvedSiteDir) !== path.resolve(expectedSiteDir)) {
    throw new Error("Selected site directory does not match the selected cycle.");
  }

  const digestManifest = await createSiteDigestManifest(resolvedSiteDir);
  const shipEligible = await readShipEligibility(runDir, selectedCycle);
  let result = shipEligible
    ? await deployFn({ siteDir: resolvedSiteDir, digestManifest })
    : localFallback("not_ship_eligible", digestManifest);
  if (result.mode === "local" && startLocalFn) {
    const preview = await startLocalFn({ root: resolvedSiteDir, port: 4601 });
    result = {
      ...result,
      url: preview.url,
      verified: true,
      status: preview.status ?? null,
      files: digestManifest.files.map((file) => ({
        ...file,
        status: preview.status ?? null,
        verified: true,
      })),
    };
  }
  const commit = await commitResolver();
  const files = normalizeDeploymentFiles({
    sourceFiles: digestManifest.files,
    verificationFiles: result.files,
    mode: result.mode,
    verified: result.verified,
    status: result.status,
  });
  const artifact = {
    schemaVersion: "2.0",
    mode: result.mode,
    slug,
    selectedCycle,
    commit: normalizeCommit(commit),
    url: result.url,
    immutableUrl: result.immutableUrl ?? result.deploymentUrl ?? null,
    createdAt: now().toISOString(),
    status: result.status ?? null,
    verified: result.verified === true,
    aggregateSha256: digestManifest.aggregateSha256,
    files,
  };
  await writeJsonNew(await nextDeploymentArtifactPath(runDir), artifact);
  return artifact;
}

export async function resolveGitCommit() {
  try {
    const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], {
      cwd: projectRoot,
      windowsHide: true,
      timeout: 10_000,
      encoding: "utf8",
    });
    return normalizeCommit(stdout.trim());
  } catch {
    return "unavailable";
  }
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

async function collectSiteFiles(root, currentDir, files) {
  const entries = await readdir(currentDir, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name, "en"));
  for (const entry of entries) {
    const target = path.join(currentDir, entry.name);
    const stat = await lstat(target);
    if (stat.isSymbolicLink()) {
      throw codedError("Deployment site cannot contain linked paths.", "LINKED_SITE_PATH");
    }
    if (stat.isDirectory()) {
      await collectSiteFiles(root, target, files);
      continue;
    }
    if (!stat.isFile()) {
      throw codedError("Deployment site contains a non-file entry.", "INVALID_SITE_ENTRY");
    }

    const relative = path.relative(root, target).split(path.sep).join("/");
    if (
      !/^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/.test(relative) ||
      relative.split("/").some((segment) => segment === "." || segment === ".." || segment.startsWith("."))
    ) {
      throw codedError("Deployment site contains an unsafe relative path.", "UNSAFE_SITE_PATH");
    }
    const bytes = await readFile(target);
    files.push({
      path: relative,
      bytes: bytes.length,
      sha256: digest(bytes),
    });
  }
}

async function readShipEligibility(runDir, selectedCycle) {
  try {
    const critique = JSON.parse(
      await readFile(
        resolveInside(
          runDir,
          `cycle-${String(selectedCycle).padStart(2, "0")}`,
          "critique.json",
        ),
        "utf8",
      ),
    );
    return critique?.shipEligible === true && critique?.mode === "vision";
  } catch (error) {
    if (error?.code === "ENOENT" || error instanceof SyntaxError) {
      return false;
    }
    throw error;
  }
}

function normalizeDeploymentFiles({
  sourceFiles,
  verificationFiles,
  mode,
  verified,
  status,
}) {
  const byPath = new Map(
    (Array.isArray(verificationFiles) ? verificationFiles : []).map((file) => [
      file?.path,
      file,
    ]),
  );
  return sourceFiles.map((source) => {
    const observed = byPath.get(source.path);
    if (mode === "cloudflare") {
      if (
        !observed ||
        observed.bytes !== source.bytes ||
        observed.sha256 !== source.sha256 ||
        observed.verified !== true
      ) {
        throw codedError(
          "Cloudflare verification evidence is incomplete.",
          "INCOMPLETE_DEPLOYMENT_EVIDENCE",
        );
      }
    }
    return {
      path: source.path,
      bytes: source.bytes,
      sha256: source.sha256,
      status: observed?.status ?? status ?? null,
      verified: observed?.verified === true || (mode === "local" && verified === true),
    };
  });
}

function normalizeCommit(value) {
  const commit = String(value ?? "").trim().toLowerCase();
  return /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(commit) ? commit : "unavailable";
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

async function verifyDeployment({ url, expectedFiles, fetchFn, sleep }) {
  let lastFiles = expectedFiles.map((file) => ({
    ...file,
    status: null,
    verified: false,
  }));
  for (let attempt = 1; attempt <= 7; attempt += 1) {
    const observed = [];
    for (const expected of expectedFiles) {
      const targetUrl = canonicalFileUrl(url, expected.path);
      try {
        const response = await fetchFn(targetUrl, {
          redirect: "follow",
          signal: AbortSignal.timeout(5_000),
        });
        const body = Buffer.from(await response.arrayBuffer());
        observed.push({
          ...expected,
          status: response.status,
          verified:
            response.ok &&
            body.length === expected.bytes &&
            digest(body) === expected.sha256,
        });
      } catch {
        observed.push({
          ...expected,
          status: null,
          verified: false,
        });
      }
    }
    lastFiles = observed;
    if (observed.length === expectedFiles.length && observed.every((file) => file.verified)) {
      const index = observed.find((file) => file.path === "index.html") ?? observed[0];
      return { verified: true, status: index.status, files: observed };
    }
    if (attempt < 7) {
      await sleep(500 * 2 ** (attempt - 1));
    }
  }
  void lastFiles;
  throw codedError("Cloudflare deployment could not be verified.", "VERIFY_FAILED");
}

function canonicalFileUrl(baseUrl, relativePath) {
  if (relativePath === "index.html") {
    return new URL(baseUrl).href;
  }
  const encodedPath = relativePath
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return new URL(encodedPath, baseUrl).href;
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

function localFallback(reason, manifest = { aggregateSha256: null, files: [] }) {
  return {
    mode: "local",
    projectName: null,
    url: LOCAL_URL,
    immutableUrl: null,
    verified: false,
    status: null,
    aggregateSha256: manifest.aggregateSha256,
    files: manifest.files.map((file) => ({
      ...file,
      status: null,
      verified: false,
    })),
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
