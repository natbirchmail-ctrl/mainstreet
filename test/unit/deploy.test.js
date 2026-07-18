import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import {
  deployRun,
  deployToPages,
  findSelectedSite,
  parseDeploymentUrl,
} from "../../src/deploy.js";

const credentials = {
  CLOUDFLARE_API_TOKEN: "test-token-not-real",
  CLOUDFLARE_ACCOUNT_ID: "test-account",
};

test("deployToPages returns the local fallback when credentials are absent", async () => {
  let called = false;
  const result = await deployToPages({
    siteDir: process.cwd(),
    env: {},
    runner: async () => {
      called = true;
    },
  });

  assert.equal(called, false);
  assert.equal(result.mode, "local");
  assert.equal(result.url, "http://127.0.0.1:4601/");
  assert.equal(result.reason, "missing_credentials");
});

test("deployToPages reads the project, uploads, and verifies the returned URL", async () => {
  const calls = [];
  const siteDir = path.join(process.cwd(), "tmp", randomUUID(), "site");
  const expectedHtml = "<!doctype html><title>Mainstreet current</title>";
  await mkdir(siteDir, { recursive: true });
  await writeFile(path.join(siteDir, "index.html"), expectedHtml, "utf8");
  const runner = async (args) => {
    calls.push(args);
    if (args.join(" ").includes("project list")) {
      return {
        exitCode: 0,
        stdout: JSON.stringify([{ "Project Name": "mainstreet-hackathon" }]),
        stderr: "",
      };
    }
    return {
      exitCode: 0,
      stdout: "Deployment complete https://abc.mainstreet-hackathon.pages.dev",
      stderr: "",
    };
  };

  const result = await deployToPages({
    siteDir,
    projectName: "mainstreet-hackathon",
    env: credentials,
    runner,
    fetchFn: async () => new Response(expectedHtml, { status: 200 }),
    sleep: async () => {},
  });

  assert.equal(result.mode, "cloudflare");
  assert.equal(result.verified, true);
  assert.equal(result.url, "https://mainstreet-hackathon.pages.dev/");
  assert.equal(result.deploymentUrl, "https://abc.mainstreet-hackathon.pages.dev/");
  assert.equal(calls.some((args) => args.join(" ").includes("project create")), false);
  assert.equal(calls.some((args) => args.join(" ").includes("pages deploy")), true);
});

test("deployToPages creates a missing project noninteractively before upload", async () => {
  const calls = [];
  const siteDir = path.join(process.cwd(), "tmp", randomUUID(), "site");
  await mkdir(siteDir, { recursive: true });
  await writeFile(path.join(siteDir, "index.html"), "current deployment", "utf8");
  const runner = async (args) => {
    calls.push(args);
    if (args.join(" ").includes("project list")) {
      return { exitCode: 0, stdout: "[]", stderr: "" };
    }
    if (args.join(" ").includes("project create")) {
      return { exitCode: 0, stdout: "Created", stderr: "" };
    }
    return {
      exitCode: 0,
      stdout: "https://new.mainstreet-hackathon.pages.dev",
      stderr: "",
    };
  };

  const result = await deployToPages({
    siteDir,
    projectName: "mainstreet-hackathon",
    env: credentials,
    runner,
    fetchFn: async () => new Response("current deployment", { status: 200 }),
    sleep: async () => {},
  });

  const createCall = calls.find((args) => args.join(" ").includes("project create"));
  assert.ok(createCall);
  assert.ok(createCall.includes("--production-branch"));
  assert.equal(result.mode, "cloudflare");
});

test("deployToPages waits until the canonical alias serves the selected site", async () => {
  const siteDir = path.join(process.cwd(), "tmp", randomUUID(), "site");
  const expectedHtml = "<!doctype html><title>New release</title>";
  await mkdir(siteDir, { recursive: true });
  await writeFile(path.join(siteDir, "index.html"), expectedHtml, "utf8");
  let fetches = 0;
  let sleeps = 0;

  const result = await deployToPages({
    siteDir,
    projectName: "mainstreet-hackathon",
    env: credentials,
    runner: async (args) => {
      if (args.join(" ").includes("project list")) {
        return {
          exitCode: 0,
          stdout: JSON.stringify([{ name: "mainstreet-hackathon" }]),
          stderr: "",
        };
      }
      return {
        exitCode: 0,
        stdout: "https://new.mainstreet-hackathon.pages.dev",
        stderr: "",
      };
    },
    fetchFn: async () => {
      fetches += 1;
      return new Response(fetches === 1 ? "previous deployment" : expectedHtml, {
        status: 200,
      });
    },
    sleep: async () => {
      sleeps += 1;
    },
  });

  assert.equal(result.verified, true);
  assert.equal(fetches, 2);
  assert.equal(sleeps, 1);
});

test("deployToPages degrades to local serving after a Cloudflare failure", async () => {
  const result = await deployToPages({
    siteDir: process.cwd(),
    env: credentials,
    runner: async () => ({ exitCode: 1, stdout: "", stderr: "denied" }),
  });
  assert.equal(result.mode, "local");
  assert.equal(result.reason, "cloudflare_failed");
  assert.equal(result.url, "http://127.0.0.1:4601/");
  assert.equal("stderr" in result, false);
});

test("parseDeploymentUrl accepts only secure pages.dev URLs", () => {
  assert.equal(
    parseDeploymentUrl("Preview: https://abc.mainstreet-hackathon.pages.dev"),
    "https://abc.mainstreet-hackathon.pages.dev/",
  );
  assert.throws(() => parseDeploymentUrl("http://unsafe.example.com"), /pages deployment url/i);
});

test("findSelectedSite honors the final run report", async () => {
  const runDir = path.join(process.cwd(), "tmp", randomUUID(), "run");
  await mkdir(path.join(runDir, "cycle-02", "site"), { recursive: true });
  await writeFile(path.join(runDir, "run-report.json"), JSON.stringify({ selectedCycle: 2 }), "utf8");
  await writeFile(path.join(runDir, "cycle-02", "site", "index.html"), "proof", "utf8");

  assert.equal(await findSelectedSite(runDir), path.join(runDir, "cycle-02", "site"));
  assert.equal(await readFile(path.join(await findSelectedSite(runDir), "index.html"), "utf8"), "proof");
});

test("deployRun starts a local fallback before recording a truthful URL", async () => {
  const runDir = path.join(process.cwd(), "tmp", randomUUID(), "run");
  const siteDir = path.join(runDir, "cycle-01", "site");
  await mkdir(siteDir, { recursive: true });
  let started = false;

  const result = await deployRun({
    runDir,
    slug: "local-proof",
    selectedCycle: 1,
    siteDir,
    deployFn: async () => ({
      mode: "local",
      url: "http://127.0.0.1:4601/",
      verified: false,
      status: null,
      reason: "missing_credentials",
    }),
    startLocalFn: async ({ root, port }) => {
      assert.equal(root, siteDir);
      assert.equal(port, 4601);
      started = true;
      return { url: "http://127.0.0.1:4601/", status: 200 };
    },
    now: () => new Date("2026-07-17T18:00:00.000Z"),
  });

  assert.equal(started, true);
  assert.equal(result.mode, "local");
  assert.equal(result.verified, true);
  assert.equal(result.status, 200);
  assert.equal(result.url, "http://127.0.0.1:4601/");
  const recorded = JSON.parse(await readFile(path.join(runDir, "deployment.json"), "utf8"));
  assert.equal(recorded.verified, true);
});

test("deployRun does not record a local URL when the preview cannot bind", async () => {
  const runDir = path.join(process.cwd(), "tmp", randomUUID(), "run");
  const siteDir = path.join(runDir, "cycle-01", "site");
  await mkdir(siteDir, { recursive: true });

  await assert.rejects(
    deployRun({
      runDir,
      slug: "bind-failure",
      selectedCycle: 1,
      siteDir,
      deployFn: async () => ({
        mode: "local",
        url: "http://127.0.0.1:4601/",
        verified: false,
        status: null,
        reason: "missing_credentials",
      }),
      startLocalFn: async () => {
        throw new Error("listen EADDRINUSE");
      },
    }),
    /EADDRINUSE/,
  );
  await assert.rejects(readFile(path.join(runDir, "deployment.json"), "utf8"), {
    code: "ENOENT",
  });
});

test("deployRun preserves deployment history across later promotions", async () => {
  const runDir = path.join(process.cwd(), "tmp", randomUUID(), "run");
  const siteDir = path.join(runDir, "cycle-01", "site");
  await mkdir(siteDir, { recursive: true });
  let tick = 0;
  const deploy = () =>
    deployRun({
      runDir,
      slug: "history-proof",
      selectedCycle: 1,
      siteDir,
      deployFn: async () => ({
        mode: "cloudflare",
        url: "https://mainstreet-hackathon.pages.dev/",
        verified: true,
        status: 200,
        reason: null,
      }),
      now: () => new Date(Date.UTC(2026, 6, 17, 19, 0, tick++)),
    });

  const first = await deploy();
  const second = await deploy();

  assert.notEqual(first.createdAt, second.createdAt);
  assert.equal(
    JSON.parse(await readFile(path.join(runDir, "deployment.json"), "utf8")).createdAt,
    first.createdAt,
  );
  assert.equal(
    JSON.parse(
      await readFile(path.join(runDir, "deployments", "deployment-02.json"), "utf8"),
    ).createdAt,
    second.createdAt,
  );
});
