import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import {
  createSiteDigestManifest,
  deployRun,
  deployToPages,
  findSelectedSite,
  parseDeploymentUrl,
} from "../../src/deploy.js";

const credentials = {
  CLOUDFLARE_API_TOKEN: "test-token-not-real",
  CLOUDFLARE_ACCOUNT_ID: "test-account",
};
const TEST_COMMIT = "a".repeat(40);

async function makeCompleteSite(siteDir, label = "Mainstreet current") {
  await mkdir(path.join(siteDir, "assets"), { recursive: true });
  await Promise.all([
    writeFile(path.join(siteDir, "index.html"), `<!doctype html><title>${label}</title>`, "utf8"),
    writeFile(path.join(siteDir, "styles.css"), "body { color: #171717; }", "utf8"),
    writeFile(path.join(siteDir, "script.js"), "'use strict';\n", "utf8"),
    writeFile(path.join(siteDir, "assets", "hero.png"), Buffer.from([137, 80, 78, 71, 1, 2, 3])),
  ]);
}

async function writeEligibility(runDir, cycle, shipEligible) {
  const cycleDir = path.join(runDir, `cycle-${String(cycle).padStart(2, "0")}`);
  await mkdir(cycleDir, { recursive: true });
  await writeFile(
    path.join(cycleDir, "critique.json"),
    JSON.stringify({ mode: "vision", shipEligible }),
    "utf8",
  );
}

test("site digest includes every public byte in stable path order", async () => {
  const siteDir = path.join(process.cwd(), "tmp", randomUUID(), "site");
  await makeCompleteSite(siteDir);

  const first = await createSiteDigestManifest(siteDir);
  const second = await createSiteDigestManifest(siteDir);

  assert.deepEqual(
    first.files.map((file) => file.path),
    ["assets/hero.png", "index.html", "script.js", "styles.css"],
  );
  assert.deepEqual(second, first);
  assert.match(first.aggregateSha256, /^[a-f0-9]{64}$/);
  for (const file of first.files) {
    assert.deepEqual(Object.keys(file).sort(), ["bytes", "path", "sha256"]);
    assert.ok(file.bytes > 0);
    assert.match(file.sha256, /^[a-f0-9]{64}$/);
  }
});

test("deployToPages returns the local fallback when credentials are absent", async () => {
  let called = false;
  const siteDir = path.join(process.cwd(), "tmp", randomUUID(), "site");
  await makeCompleteSite(siteDir);
  const result = await deployToPages({
    siteDir,
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
  const siteDir = path.join(process.cwd(), "tmp", randomUUID(), "site");
  await makeCompleteSite(siteDir);
  const result = await deployToPages({
    siteDir,
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
  await makeCompleteSite(siteDir);
  await writeEligibility(runDir, 1, true);
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
    commitResolver: async () => TEST_COMMIT,
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
  await makeCompleteSite(siteDir);
  await writeEligibility(runDir, 1, true);

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
      commitResolver: async () => TEST_COMMIT,
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
  await makeCompleteSite(siteDir);
  await writeEligibility(runDir, 1, true);
  const digestManifest = await createSiteDigestManifest(siteDir);
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
        immutableUrl: "https://history.mainstreet-hackathon.pages.dev/",
        verified: true,
        status: 200,
        aggregateSha256: digestManifest.aggregateSha256,
        files: digestManifest.files.map((file) => ({ ...file, status: 200, verified: true })),
      }),
      commitResolver: async () => TEST_COMMIT,
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

test("deployToPages verifies HTML, CSS, script, and image bytes on the canonical alias", async () => {
  const siteDir = path.join(process.cwd(), "tmp", randomUUID(), "site");
  await makeCompleteSite(siteDir, "Whole site");
  const expected = new Map([
    ["/", await readFile(path.join(siteDir, "index.html"))],
    ["/styles.css", await readFile(path.join(siteDir, "styles.css"))],
    ["/script.js", await readFile(path.join(siteDir, "script.js"))],
    ["/assets/hero.png", await readFile(path.join(siteDir, "assets", "hero.png"))],
  ]);
  const fetched = [];

  const result = await deployToPages({
    siteDir,
    projectName: "mainstreet-hackathon",
    env: credentials,
    runner: async (args) => {
      if (args.join(" ").includes("project list")) {
        return { exitCode: 0, stdout: JSON.stringify([{ name: "mainstreet-hackathon" }]), stderr: "" };
      }
      return { exitCode: 0, stdout: "https://whole.mainstreet-hackathon.pages.dev", stderr: "" };
    },
    fetchFn: async (url) => {
      const pathname = new URL(url).pathname;
      fetched.push(pathname);
      return new Response(expected.get(pathname), { status: expected.has(pathname) ? 200 : 404 });
    },
    sleep: async () => {},
  });

  assert.equal(result.mode, "cloudflare");
  assert.equal(result.verified, true);
  assert.deepEqual([...new Set(fetched)].sort(), ["/", "/assets/hero.png", "/script.js", "/styles.css"]);
  assert.equal(result.files.length, 4);
  assert.ok(result.files.every((file) => file.status === 200 && file.verified === true));
});

test("one stale image prevents Cloudflare verification even when index HTML matches", async () => {
  const siteDir = path.join(process.cwd(), "tmp", randomUUID(), "site");
  await makeCompleteSite(siteDir, "Fresh HTML");

  const result = await deployToPages({
    siteDir,
    projectName: "mainstreet-hackathon",
    env: credentials,
    runner: async (args) => {
      if (args.join(" ").includes("project list")) {
        return { exitCode: 0, stdout: JSON.stringify([{ name: "mainstreet-hackathon" }]), stderr: "" };
      }
      return { exitCode: 0, stdout: "https://stale.mainstreet-hackathon.pages.dev", stderr: "" };
    },
    fetchFn: async (url) => {
      const pathname = new URL(url).pathname;
      if (pathname === "/") return new Response(await readFile(path.join(siteDir, "index.html")), { status: 200 });
      if (pathname === "/assets/hero.png") return new Response("stale image", { status: 200 });
      const relative = pathname.slice(1);
      return new Response(await readFile(path.join(siteDir, relative)), { status: 200 });
    },
    sleep: async () => {},
  });

  assert.equal(result.mode, "local");
  assert.equal(result.verified, false);
  assert.equal(result.reason, "cloudflare_failed");
});

test("deployRun records only the public allowlist bound to cycle, commit, and all files", async () => {
  const runDir = path.join(process.cwd(), "tmp", randomUUID(), "run");
  const siteDir = path.join(runDir, "cycle-02", "site");
  await makeCompleteSite(siteDir, "Allowlist");
  await writeEligibility(runDir, 2, true);
  const digestManifest = await createSiteDigestManifest(siteDir);

  const result = await deployRun({
    runDir,
    slug: "allowlist-proof",
    selectedCycle: 2,
    siteDir,
    deployFn: async () => ({
      mode: "cloudflare",
      url: "https://mainstreet-hackathon.pages.dev/",
      immutableUrl: "https://allowlist.mainstreet-hackathon.pages.dev/",
      verified: true,
      status: 200,
      aggregateSha256: digestManifest.aggregateSha256,
      files: digestManifest.files.map((file) => ({ ...file, status: 200, verified: true })),
      providerOutput: "must not persist",
      projectName: "must-not-persist",
    }),
    commitResolver: async () => TEST_COMMIT,
    now: () => new Date("2026-07-17T20:00:00.000Z"),
  });

  assert.deepEqual(Object.keys(result).sort(), [
    "aggregateSha256",
    "commit",
    "createdAt",
    "files",
    "immutableUrl",
    "mode",
    "schemaVersion",
    "selectedCycle",
    "slug",
    "status",
    "url",
    "verified",
  ]);
  assert.equal(result.slug, "allowlist-proof");
  assert.equal(result.selectedCycle, 2);
  assert.equal(result.commit, TEST_COMMIT);
  assert.equal(result.aggregateSha256, digestManifest.aggregateSha256);
  assert.equal(JSON.stringify(result).includes("must not persist"), false);
  assert.ok(result.files.every((file) =>
    JSON.stringify(Object.keys(file).sort()) === JSON.stringify(["bytes", "path", "sha256", "status", "verified"])
  ));
});

test("deployRun never calls Cloudflare for a noneligible selected cycle", async () => {
  const runDir = path.join(process.cwd(), "tmp", randomUUID(), "run");
  const siteDir = path.join(runDir, "cycle-01", "site");
  await makeCompleteSite(siteDir, "Local only");
  await writeEligibility(runDir, 1, false);
  let cloudflareCalled = false;
  let localStarted = false;

  const result = await deployRun({
    runDir,
    slug: "local-only",
    selectedCycle: 1,
    siteDir,
    deployFn: async () => {
      cloudflareCalled = true;
      throw new Error("must not deploy");
    },
    startLocalFn: async ({ root, port }) => {
      assert.equal(root, siteDir);
      assert.equal(port, 4601);
      localStarted = true;
      return { url: "http://127.0.0.1:4601/", status: 200 };
    },
    commitResolver: async () => TEST_COMMIT,
  });

  assert.equal(cloudflareCalled, false);
  assert.equal(localStarted, true);
  assert.equal(result.mode, "local");
  assert.equal(result.url, "http://127.0.0.1:4601/");
  assert.equal(result.immutableUrl, null);
});
