import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  cp,
  mkdir,
  readFile,
  rename,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { deflateSync } from "node:zlib";

import {
  checkRelease,
  formatFindings,
} from "../../tools/release-check.js";
import { createRenderedEvidencePacketSha256 } from "../../src/lib/rendered-evidence.js";

const execFileAsync = promisify(execFile);
const projectRoot = fileURLToPath(new URL("../..", import.meta.url));
const releaseCheckPath = path.join(projectRoot, "tools", "release-check.js");
const forbiddenLocalDir = [".", "trash"].join("");
const fixtureRoot = path.join(
  projectRoot,
  forbiddenLocalDir,
  "release-check-tests",
);
const envFile = [".", "env"].join("");
const envExampleFile = [envFile, "example"].join(".");
const qualityLaws = [
  "headlineDiscipline",
  "foldComposition",
  "completeLayouts",
  "firstBeatVisibility",
  "imageContrast",
  "motionRestraint",
  "imageryCoherence",
  "factualRestraint",
];
const viewportCoverageLaws = new Set([
  "foldComposition",
  "firstBeatVisibility",
  "imageContrast",
  "imageryCoherence",
]);
const evidenceViewports = ["desktop", "tablet", "phone"];
const dimensionScores = Object.freeze({
  layout: 18,
  hierarchy: 15,
  color: 12,
  typography: 15,
  mobile: 15,
  specificity: 5,
  accessibility: 5,
  polish: 5,
});
const defaultExamples = [
  "harborlight-flower-studio",
  "juniper-oven",
  "canyon-wheelworks",
];
const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const approvedHistoricalAbsolutePathFixtures = Object.freeze([
  Object.freeze({
    path: "test/unit/critic.test.js",
    object: "07e8c300359258bdfc760d0aa652ba31501700b4",
    sha256: "be91293e0347cacb0d53133ab3a16484cdd90c0b988e7bc48c8eedf8420b8e4d",
    bytes: 9131,
  }),
  Object.freeze({
    path: "test/unit/critic.test.js",
    object: "3b49ae9b1d85f823e11198af6c69322e9c79eda3",
    sha256: "255663823186a119e266443dedca6fa920f33638cacfc9c92d64a8a134f19c86",
    bytes: 6504,
  }),
  Object.freeze({
    path: "test/unit/critic.test.js",
    object: "ae51d4961f2701f938fcb103a76ab875638e5e4a",
    sha256: "38deef84dac7ce96ad2816c5776fa4c0555a3a89ae60622c595fb2d4a48745f8",
    bytes: 8273,
  }),
  Object.freeze({
    path: "test/unit/critic.test.js",
    object: "e72f4c0401073a2e9a47f2ad9679d063d233a01e",
    sha256: "4066a0aeee4d97b9c173fe803eb516242423b7a0daa81bbde7ffb7bb8bdae330",
    bytes: 8202,
  }),
  Object.freeze({
    path: "test/unit/revise.test.js",
    object: "3b3bf0e08845fde652856177fd67df33d6432443",
    sha256: "daa64020f72dda21a865f6acfc710e450e6b775ea6b0c540b6ebab9640daad07",
    bytes: 19172,
  }),
  Object.freeze({
    path: "test/unit/revise.test.js",
    object: "a932750ae48b89fdeed66ca194d2adfcbdc7a476",
    sha256: "1ed3178b80a8a30c4e0ec269a4258d1992af433332b2e18f8e59ab0784a96fe9",
    bytes: 17910,
  }),
  Object.freeze({
    path: "test/unit/revise.test.js",
    object: "759b61da342abac05150628fe9405554f53484ce",
    sha256: "70a2b65f2f757b0f8df2f01c37fd3ea18441482b5595d35b6073fdab5dcb2418",
    bytes: 17823,
  }),
]);

test("release checker exports the public API and formats stable rule path lines", () => {
  assert.equal(typeof checkRelease, "function");
  assert.equal(typeof formatFindings, "function");
  assert.equal(
    formatFindings([
      { rule: "Z_RULE", path: "z.txt" },
      { rule: "A_RULE", path: "b.txt" },
      { rule: "A_RULE", path: "a.txt" },
      { rule: "A_RULE", path: "a.txt" },
    ]),
    "A_RULE a.txt\nA_RULE b.txt\nZ_RULE z.txt",
  );
});

test("a complete fixture is clean even when ignored forbidden directories exist locally", async () => {
  const fixture = await makeFixture();
  await writeOwnedFile(
    fixture.root,
    `${forbiddenLocalDir}/local-only.txt`,
    "ignored local recovery evidence",
  );

  assert.deepEqual(
    await checkRelease({
      repoRoot: fixture.root,
      expectedSlugs: fixture.expectedSlugs,
    }),
    { ok: true, findings: [] },
  );
});

test("tracked environment files enforce secret placeholders without blocking config defaults", async (t) => {
  await t.test("tracked environment file", async () => {
    const fixture = await makeFixture();
    await writeOwnedFile(fixture.root, envFile, `${secretKey()}=\n`);
    await git(fixture.root, ["add", "-f", "--", envFile]);
    await git(fixture.root, ["commit", "-m", "track env fixture"]);

    const result = await checkRelease({
      repoRoot: fixture.root,
      expectedSlugs: fixture.expectedSlugs,
    });
    assertFinding(result, "ENV_TRACKED", envFile);
  });

  await t.test("documented nonsecret defaults", async () => {
    const fixture = await makeFixture();
    await writeOwnedFile(
      fixture.root,
      envExampleFile,
      [
        `${secretKey()}=`,
        `${modelKey()}=gpt-5.6`,
        `${imageModelKey()}=gpt-image-1`,
        "",
      ].join("\n"),
    );

    assert.deepEqual(
      await checkRelease({
        repoRoot: fixture.root,
        expectedSlugs: fixture.expectedSlugs,
      }),
      { ok: true, findings: [] },
    );
  });

  await t.test("nonempty secret example assignment", async () => {
    const fixture = await makeFixture({
      envExampleValue: ["configured", "value"].join("-"),
    });
    const result = await checkRelease({
      repoRoot: fixture.root,
      expectedSlugs: fixture.expectedSlugs,
    });
    assertFinding(result, "ENV_TRACKED", envExampleFile);
  });
});

test("empty secret placeholders cannot consume an adjacent config line", async (t) => {
  await t.test("unquoted assignment", async () => {
    const fixture = await makeFixture();
    await writeOwnedFile(
      fixture.root,
      "notes/config.env",
      `${secretKey()}=\n${modelKey()}=gpt-5.6\n`,
    );
    assert.deepEqual(
      await checkRelease({
        repoRoot: fixture.root,
        expectedSlugs: fixture.expectedSlugs,
      }),
      { ok: true, findings: [] },
    );
  });

  await t.test("quoted key", async () => {
    const fixture = await makeFixture();
    await writeOwnedFile(
      fixture.root,
      "notes/config.yml",
      `"${secretKey().toLowerCase()}":\n"${modelKey().toLowerCase()}": "gpt-5.6"\n`,
    );
    assert.deepEqual(
      await checkRelease({
        repoRoot: fixture.root,
        expectedSlugs: fixture.expectedSlugs,
      }),
      { ok: true, findings: [] },
    );
  });
});

test("secret shaped assignments in nonignored untracked files are redacted", async () => {
  const fixture = await makeFixture();
  const secret = ["sk", "release", randomUUID().replaceAll("-", "")].join("-");
  await writeOwnedFile(
    fixture.root,
    "notes/current.txt",
    `${secretKey()}=${secret}\n`,
  );

  const result = await checkRelease({
    repoRoot: fixture.root,
    expectedSlugs: fixture.expectedSlugs,
  });
  assertFinding(result, "SECRET_ASSIGNMENT", "notes/current.txt");
  assert.equal(formatFindings(result.findings).includes(secret), false);
  assert.equal(formatFindings(result.findings).includes(fixture.root), false);
});

test("unquoted YAML secret assignments are detected without exposing values", async () => {
  const fixture = await makeFixture();
  const secret = ["release", randomUUID().replaceAll("-", "")].join("-");
  await writeOwnedFile(
    fixture.root,
    "notes/config.yml",
    `${secretKey().toLowerCase()}: ${secret}\n`,
  );

  const result = await checkRelease({
    repoRoot: fixture.root,
    expectedSlugs: fixture.expectedSlugs,
  });
  assertFinding(result, "SECRET_ASSIGNMENT", "notes/config.yml");
  assert.equal(formatFindings(result.findings).includes(secret), false);
});

test("absolute machine paths report ABSOLUTE_MACHINE_PATH without echoing them", async () => {
  const fixture = await makeFixture();
  const machinePath = ["C:", "Users", "release-user", "private.txt"].join("\\");
  await writeOwnedFile(fixture.root, "notes/path.txt", machinePath);

  const result = await checkRelease({
    repoRoot: fixture.root,
    expectedSlugs: fixture.expectedSlugs,
  });
  assertFinding(result, "ABSOLUTE_MACHINE_PATH", "notes/path.txt");
  assert.equal(formatFindings(result.findings).includes(machinePath), false);
});

test("escaped drive UNC and POSIX machine paths are all rejected", async (t) => {
  for (const [name, relativePath, value] of [
    [
      "escaped drive",
      "notes/escaped.json",
      JSON.stringify({ path: ["D:", "release", "private.txt"].join("\\") }),
    ],
    [
      "UNC",
      "notes/unc.txt",
      ["", "", "release-server", "share", "private.txt"].join("\\"),
    ],
    [
      "POSIX",
      "notes/posix.txt",
      ["", "opt", "release", "private.txt"].join("/"),
    ],
  ]) {
    await t.test(name, async () => {
      const fixture = await makeFixture();
      await writeOwnedFile(fixture.root, relativePath, value);
      const result = await checkRelease({
        repoRoot: fixture.root,
        expectedSlugs: fixture.expectedSlugs,
      });
      assertFinding(result, "ABSOLUTE_MACHINE_PATH", relativePath);
      assert.equal(formatFindings(result.findings).includes(value), false);
    });
  }
});

test("regular expression escapes are not mistaken for UNC paths", async () => {
  const fixture = await makeFixture();
  const slash = "\\";
  await writeOwnedFile(
    fixture.root,
    "notes/pattern.js",
    [
      `const pattern = /[${slash}${slash}s${slash}${slash}S]+/g;`,
      `const escaped = "${slash}${slash}x60${slash}${slash}r${slash}${slash}n";`,
      "",
    ].join("\n"),
  );
  assert.deepEqual(
    await checkRelease({
      repoRoot: fixture.root,
      expectedSlugs: fixture.expectedSlugs,
    }),
    { ok: true, findings: [] },
  );
});

test("confidential source terms report CONFIDENTIAL_SOURCE_TERM without echoing them", async () => {
  const fixture = await makeFixture();
  const privateTerm = ["Claude", "Design"].join("");
  await writeOwnedFile(fixture.root, "notes/source.txt", privateTerm);

  const result = await checkRelease({
    repoRoot: fixture.root,
    expectedSlugs: fixture.expectedSlugs,
  });
  assertFinding(result, "CONFIDENTIAL_SOURCE_TERM", "notes/source.txt");
  assert.equal(formatFindings(result.findings).includes(privateTerm), false);
});

test("ignored recovery paths fail only when tracked or historical", async () => {
  const fixture = await makeFixture();
  const trackedPath = `${forbiddenLocalDir}/tracked.txt`;
  await writeOwnedFile(fixture.root, trackedPath, "tracked recovery evidence");
  await git(fixture.root, ["add", "-f", "--", trackedPath]);
  await git(fixture.root, ["commit", "-m", "track forbidden fixture"]);

  const result = await checkRelease({
    repoRoot: fixture.root,
    expectedSlugs: fixture.expectedSlugs,
  });
  assertFinding(result, "FORBIDDEN_TRACKED_PATH", trackedPath);
});

test("deleted historical matches remain findings without hashes or matched text", async () => {
  const fixture = await makeFixture();
  const secret = ["sk", "history", randomUUID().replaceAll("-", "")].join("-");
  await writeOwnedFile(
    fixture.root,
    "notes/historical.txt",
    `${secretKey()}=${secret}\n`,
  );
  await commitAll(fixture.root, "add historical fixture");
  await rename(
    path.join(fixture.root, "notes", "historical.txt"),
    path.join(fixture.root, "notes", "current.txt"),
  );
  await writeOwnedFile(fixture.root, "notes/current.txt", "public current evidence\n");
  await commitAll(fixture.root, "replace historical fixture");

  const result = await checkRelease({
    repoRoot: fixture.root,
    expectedSlugs: fixture.expectedSlugs,
  });
  assertFinding(result, "SECRET_ASSIGNMENT", "notes/historical.txt");
  const output = formatFindings(result.findings);
  assert.equal(output.includes(secret), false);
  assert.equal(output.includes(fixture.root), false);
  assert.equal(/[a-f0-9]{40}/i.test(output), false);
});

test("exact attested historical fixture blobs suppress only ABSOLUTE_MACHINE_PATH", async (t) => {
  for (const fixture of approvedHistoricalAbsolutePathFixtures) {
    await t.test(`${fixture.path} ${fixture.object.slice(0, 8)}`, async () => {
      const value = await readProjectBlob(fixture.object);
      assert.equal(value.length, fixture.bytes);
      assert.equal(digest(value), fixture.sha256);

      const unapproved = await checkSyntheticHistory([
        { ...fixture, object: differentObjectId(fixture.object), value },
      ]);
      assertFinding(unapproved, "ABSOLUTE_MACHINE_PATH", fixture.path);

      const approved = await checkSyntheticHistory([{ ...fixture, value }]);
      assertNoFinding(approved, "ABSOLUTE_MACHINE_PATH", fixture.path);
    });
  }
});

test("attested historical bytes remain rejected by the current index scan", async () => {
  const fixture = approvedHistoricalAbsolutePathFixtures.at(-1);
  const value = await readProjectBlob(fixture.object);
  const root = path.join(fixtureRoot, randomUUID());
  await writeOwnedFile(root, fixture.path, value);

  const result = await checkRelease({
    repoRoot: root,
    expectedSlugs: ["example-run"],
    git: syntheticGit({ trackedPaths: [fixture.path] }),
  });

  assertFinding(result, "ABSOLUTE_MACHINE_PATH", fixture.path);
});

test("historical fixture attestation fails closed for every tuple or byte mismatch", async (t) => {
  const fixture = approvedHistoricalAbsolutePathFixtures.at(-1);
  const value = await readProjectBlob(fixture.object);
  const sameLengthAlteration = Buffer.from(value);
  sameLengthAlteration[0] ^= 1;

  for (const [name, entry] of [
    ["repository path", { ...fixture, path: "test/unit/copied-revise.test.js", value }],
    ["Git blob object", { ...fixture, object: differentObjectId(fixture.object), value }],
    ["SHA256 and bytes", { ...fixture, value: sameLengthAlteration }],
    ["byte length", { ...fixture, value: Buffer.concat([value, Buffer.from("\n")]) }],
  ]) {
    await t.test(name, async () => {
      const result = await checkSyntheticHistory([entry]);
      assertFinding(result, "ABSOLUTE_MACHINE_PATH", entry.path);
    });
  }
});

test("a new deleted historical machine path fails closed", async () => {
  const relativePath = "test/unit/new-deleted-fixture.test.js";
  const value = Buffer.from(
    `const machinePath = ${JSON.stringify(["C:", "synthetic", "fixture.txt"].join("\\"))};\n`,
  );
  const object = gitBlobObjectId(value);
  const result = await checkSyntheticHistory([{ path: relativePath, object, value }]);

  assertFinding(result, "ABSOLUTE_MACHINE_PATH", relativePath);
});

test("historical attestation never suppresses nonabsolute security rules", async () => {
  const fixture = approvedHistoricalAbsolutePathFixtures.at(-1);
  const approvedValue = await readProjectBlob(fixture.object);
  const secret = ["sk", "attestation", "0123456789abcdef"].join("-");
  const value = Buffer.concat([
    approvedValue,
    Buffer.from(`\n${secretKey()}=${secret}\n`),
  ]);
  const result = await checkSyntheticHistory([{ ...fixture, value }]);

  assertFinding(result, "ABSOLUTE_MACHINE_PATH", fixture.path);
  assertFinding(result, "SECRET_ASSIGNMENT", fixture.path);
  const output = formatFindings(result.findings);
  assert.equal(output.includes(secret), false);
  assert.equal(output.includes(fixture.object), false);
  assert.equal(output.includes(fixture.sha256), false);
});

test("historical attestation failures remain redacted and deterministic", async () => {
  const fixture = approvedHistoricalAbsolutePathFixtures.at(-1);
  const value = await readProjectBlob(fixture.object);
  const newPath = "test/unit/new-deleted-fixture.test.js";
  const newValue = Buffer.from(
    `const machinePath = ${JSON.stringify(["D:", "synthetic", "fixture.txt"].join("\\"))};\n`,
  );
  const entries = [
    { ...fixture, object: differentObjectId(fixture.object), value },
    { path: newPath, object: gitBlobObjectId(newValue), value: newValue },
  ];

  const first = formatFindings((await checkSyntheticHistory(entries)).findings);
  const second = formatFindings(
    (await checkSyntheticHistory(entries.toReversed())).findings,
  );
  assert.equal(first, second);
  assert.equal(first.includes(fixture.object), false);
  assert.equal(first.includes(fixture.sha256), false);
  assert.equal(first.includes("D:"), false);
  assert.equal(first.includes(projectRoot), false);
});

test("the example set must match the expected slugs exactly", async () => {
  const fixture = await makeFixture();
  await writeOwnedFile(fixture.root, "runs/unexpected-example/brief.json", "{}\n");

  const result = await checkRelease({
    repoRoot: fixture.root,
    expectedSlugs: fixture.expectedSlugs,
  });
  assertFinding(result, "EXAMPLE_SET_INVALID", "runs");
});

test("missing and invalid cycle evidence report artifact rules", async (t) => {
  await t.test("missing script", async () => {
    const fixture = await makeFixture({ omit: "site/script.js" });
    const result = await checkRelease({
      repoRoot: fixture.root,
      expectedSlugs: fixture.expectedSlugs,
    });
    assertFinding(
      result,
      "ARTIFACT_MISSING",
      "runs/example-run/cycle-01/site/script.js",
    );
  });

  await t.test("invalid asset digest", async () => {
    const fixture = await makeFixture({ invalidAssetDigest: true });
    const result = await checkRelease({
      repoRoot: fixture.root,
      expectedSlugs: fixture.expectedSlugs,
    });
    assert.ok(result.findings.some((finding) => finding.rule === "ARTIFACT_INVALID"));
  });

  await t.test("invalid critic full page digest", async () => {
    const fixture = await makeFixture();
    const manifestPath =
      "runs/example-run/cycle-01/screenshots/critic/manifest.json";
    await rewriteJson(fixture.root, manifestPath, (manifest) => {
      manifest.viewports.desktop.sha256 = "0".repeat(64);
    });
    const result = await checkRelease({
      repoRoot: fixture.root,
      expectedSlugs: fixture.expectedSlugs,
    });
    assertFinding(result, "ARTIFACT_INVALID", manifestPath);
  });

  await t.test("canonical screenshot IHDR dimensions must match its manifest", async () => {
    const fixture = await makeFixture();
    const screenshotPath = "runs/example-run/cycle-01/screenshots/desktop-home.png";
    await writeOwnedFile(fixture.root, screenshotPath, solidPng(1439, 900, 31));
    await rewriteJson(
      fixture.root,
      "runs/example-run/cycle-01/screenshots/manifest.json",
      (manifest) => {
        manifest.viewports.desktop.width = 1439;
      },
    );
    const criticManifestPath =
      "runs/example-run/cycle-01/screenshots/critic/manifest.json";
    const binding = await canonicalCaptureDigest(
      fixture.root,
      "runs/example-run/cycle-01",
    );
    await rewriteJson(fixture.root, criticManifestPath, (manifest) => {
      manifest.canonicalCaptureSha256 = binding;
    });

    const result = await checkRelease({
      repoRoot: fixture.root,
      expectedSlugs: fixture.expectedSlugs,
    });
    assertFinding(result, "ARTIFACT_INVALID", screenshotPath);
  });

  await t.test("critic screenshot IHDR dimensions cannot hide behind valid bytes and digest", async () => {
    const fixture = await makeFixture();
    const screenshotPath =
      "runs/example-run/cycle-01/screenshots/critic/desktop-full-page.png";
    const manifestPath =
      "runs/example-run/cycle-01/screenshots/critic/manifest.json";
    const bytes = solidPng(1440, 3599, 32);
    await writeOwnedFile(fixture.root, screenshotPath, bytes);
    await rewriteJson(fixture.root, manifestPath, (manifest) => {
      manifest.viewports.desktop.bytes = bytes.length;
      manifest.viewports.desktop.sha256 = digest(bytes);
    });

    const result = await checkRelease({
      repoRoot: fixture.root,
      expectedSlugs: fixture.expectedSlugs,
    });
    assertFinding(result, "ARTIFACT_INVALID", screenshotPath);
  });

  await t.test("critic evidence remains bound to the canonical capture", async () => {
    const fixture = await makeFixture();
    const screenshotPath = "runs/example-run/cycle-01/screenshots/desktop-home.png";
    await writeOwnedFile(fixture.root, screenshotPath, solidPng(1440, 900, 33));

    const result = await checkRelease({
      repoRoot: fixture.root,
      expectedSlugs: fixture.expectedSlugs,
    });
    assertFinding(
      result,
      "ARTIFACT_INVALID",
      "runs/example-run/cycle-01/screenshots/critic/manifest.json",
    );
  });

  await t.test("critique remains bound when full page evidence is regenerated consistently", async () => {
    const fixture = await makeFixture();
    const screenshotPath =
      "runs/example-run/cycle-01/screenshots/critic/desktop-full-page.png";
    const manifestPath =
      "runs/example-run/cycle-01/screenshots/critic/manifest.json";
    const bytes = solidPng(1440, 3600, 41);
    await writeOwnedFile(fixture.root, screenshotPath, bytes);
    await rewriteJson(fixture.root, manifestPath, (manifest) => {
      manifest.viewports.desktop.bytes = bytes.length;
      manifest.viewports.desktop.sha256 = digest(bytes);
    });

    const result = await checkRelease({
      repoRoot: fixture.root,
      expectedSlugs: fixture.expectedSlugs,
    });
    assertFinding(
      result,
      "ARTIFACT_INVALID",
      "runs/example-run/cycle-01/critique.json",
    );
  });

  await t.test("critique remains bound when canonical evidence and its critic binding change", async () => {
    const fixture = await makeFixture();
    const cycleRoot = "runs/example-run/cycle-01";
    await writeOwnedFile(
      fixture.root,
      `${cycleRoot}/screenshots/desktop-home.png`,
      solidPng(1440, 900, 42),
    );
    const binding = await canonicalCaptureDigest(fixture.root, cycleRoot);
    await rewriteJson(
      fixture.root,
      `${cycleRoot}/screenshots/critic/manifest.json`,
      (manifest) => {
        manifest.canonicalCaptureSha256 = binding;
      },
    );

    const result = await checkRelease({
      repoRoot: fixture.root,
      expectedSlugs: fixture.expectedSlugs,
    });
    assertFinding(result, "ARTIFACT_INVALID", `${cycleRoot}/critique.json`);
  });

  await t.test("critique remains bound to the bounded rendered mechanics", async () => {
    const fixture = await makeFixture();
    const cycleRoot = "runs/example-run/cycle-01";
    await rewriteJson(fixture.root, `${cycleRoot}/mechanical.json`, (mechanical) => {
      mechanical.contexts.desktop.normal.firstBeats.sectionCount = 1;
    });

    const result = await checkRelease({
      repoRoot: fixture.root,
      expectedSlugs: fixture.expectedSlugs,
    });
    assertFinding(result, "ARTIFACT_INVALID", `${cycleRoot}/critique.json`);
  });

  for (const [name, mutate] of [
    ["CRC corruption", corruptPngCrc],
    ["missing IDAT", removePngIdat],
    ["corrupt compressed data", corruptPngCompressedData],
  ]) {
    await t.test(`critic screenshot rejects ${name} with updated bytes and digest`, async () => {
      const fixture = await makeFixture();
      const screenshotPath =
        "runs/example-run/cycle-01/screenshots/critic/desktop-full-page.png";
      const manifestPath =
        "runs/example-run/cycle-01/screenshots/critic/manifest.json";
      const fullPath = path.join(fixture.root, ...screenshotPath.split("/"));
      const bytes = mutate(await readFile(fullPath));
      await writeOwnedFile(fixture.root, screenshotPath, bytes);
      await rewriteJson(fixture.root, manifestPath, (manifest) => {
        manifest.viewports.desktop.bytes = bytes.length;
        manifest.viewports.desktop.sha256 = digest(bytes);
      });

      const result = await checkRelease({
        repoRoot: fixture.root,
        expectedSlugs: fixture.expectedSlugs,
      });
      assertFinding(result, "ARTIFACT_INVALID", screenshotPath);
    });
  }
});

test("cycle directories and run report references must agree", async () => {
  const fixture = await makeFixture({ reportSelectedCycle: 2 });
  const result = await checkRelease({
    repoRoot: fixture.root,
    expectedSlugs: fixture.expectedSlugs,
  });
  assertFinding(
    result,
    "REFERENCE_MISMATCH",
    "runs/example-run/run-report.json",
  );
});

test("malformed or excessive cycle directories cannot hide outside the report", async (t) => {
  await t.test("malformed cycle directory", async () => {
    const fixture = await makeFixture();
    await writeOwnedFile(
      fixture.root,
      "runs/example-run/cycle-2/site/index.html",
      "<main>Hidden cycle</main>\n",
    );
    const result = await checkRelease({
      repoRoot: fixture.root,
      expectedSlugs: fixture.expectedSlugs,
    });
    assertFinding(
      result,
      "REFERENCE_MISMATCH",
      "runs/example-run/run-report.json",
    );
  });

  await t.test("fourth cycle", async () => {
    const fixture = await makeFixture();
    await writeOwnedFile(
      fixture.root,
      "runs/example-run/cycle-04/site/index.html",
      "<main>Fourth cycle</main>\n",
    );
    const result = await checkRelease({
      repoRoot: fixture.root,
      expectedSlugs: fixture.expectedSlugs,
    });
    assertFinding(
      result,
      "REFERENCE_MISMATCH",
      "runs/example-run/run-report.json",
    );
  });
});

test("every cycle summary agrees with evidence and earlier cycles carry revision handoff", async (t) => {
  await t.test("missing revision handoff", async () => {
    const fixture = await makeFixture();
    await addSecondCycle(fixture.root, "example-run", { includeRevise: false });
    const result = await checkRelease({
      repoRoot: fixture.root,
      expectedSlugs: fixture.expectedSlugs,
    });
    assertFinding(
      result,
      "ARTIFACT_MISSING",
      "runs/example-run/cycle-01/revise.json",
    );
  });

  await t.test("nonselected summary mismatch", async () => {
    const fixture = await makeFixture();
    await addSecondCycle(fixture.root, "example-run");
    await rewriteJson(
      fixture.root,
      "runs/example-run/run-report.json",
      (report) => {
        report.cycles[0].score = 12;
      },
    );
    const result = await checkRelease({
      repoRoot: fixture.root,
      expectedSlugs: fixture.expectedSlugs,
    });
    assertFinding(
      result,
      "REFERENCE_MISMATCH",
      "runs/example-run/run-report.json",
    );
  });
});

test("semantic artifact equality does not depend on JSON object key order", async () => {
  const fixture = await makeFixture();
  await rewriteJson(
    fixture.root,
    "runs/example-run/run-report.json",
    (report) => {
      report.cycles[0].laws = Object.fromEntries(
        Object.entries(report.cycles[0].laws).reverse(),
      );
      report.cycles[0].lawCoverage = Object.fromEntries(
        Object.entries(report.cycles[0].lawCoverage).reverse(),
      );
      report.delivery = Object.fromEntries(Object.entries(report.delivery).reverse());
    },
  );

  assert.deepEqual(
    await checkRelease({
      repoRoot: fixture.root,
      expectedSlugs: fixture.expectedSlugs,
    }),
    { ok: true, findings: [] },
  );
});

test("selected mechanics evidence is mandatory and cross checked", async () => {
  const fixture = await makeFixture();
  await rewriteJson(
    fixture.root,
    "runs/example-run/cycle-01/critique.json",
    (critique) => {
      delete critique.mechanicalPassed;
    },
  );

  const result = await checkRelease({
    repoRoot: fixture.root,
    expectedSlugs: fixture.expectedSlugs,
  });
  assertFinding(
    result,
    "SELECTED_MECHANICS_MISSING",
    "runs/example-run/cycle-01/mechanical.json",
  );
});

test("mechanical pass state is derived from recorded failures", async () => {
  const fixture = await makeFixture();
  await rewriteJson(
    fixture.root,
    "runs/example-run/cycle-01/mechanical.json",
    (mechanical) => {
      mechanical.failures.push({
        code: "fixture-failure",
        viewport: "desktop",
        mode: "normal",
      });
    },
  );

  const result = await checkRelease({
    repoRoot: fixture.root,
    expectedSlugs: fixture.expectedSlugs,
  });
  assertFinding(
    result,
    "SELECTED_MECHANICS_MISSING",
    "runs/example-run/cycle-01/mechanical.json",
  );
});

test("selected asset evidence is mandatory and cross checked", async () => {
  const fixture = await makeFixture();
  await rewriteJson(
    fixture.root,
    "runs/example-run/cycle-01/critique.json",
    (critique) => {
      delete critique.assetsResolved;
    },
  );

  const result = await checkRelease({
    repoRoot: fixture.root,
    expectedSlugs: fixture.expectedSlugs,
  });
  assertFinding(
    result,
    "SELECTED_ASSETS_MISSING",
    "runs/example-run/cycle-01/assets.json",
  );
});

test("asset resolution and counts are derived from each file record", async () => {
  const fixture = await makeFixture();
  await rewriteJson(
    fixture.root,
    "runs/example-run/cycle-01/assets.json",
    (assets) => {
      assets.files[0].resolved = false;
      assets.files[0].source = "deterministic-fallback";
      assets.files[0].errorCode = "FIXTURE_FALLBACK";
    },
  );

  const result = await checkRelease({
    repoRoot: fixture.root,
    expectedSlugs: fixture.expectedSlugs,
  });
  assertFinding(
    result,
    "ARTIFACT_INVALID",
    "runs/example-run/cycle-01/assets.json",
  );
  assertFinding(
    result,
    "SELECTED_ASSETS_MISSING",
    "runs/example-run/cycle-01/assets.json",
  );
});

test("selected law evidence requires all eight laws and viewport coverage", async () => {
  const fixture = await makeFixture();
  await rewriteJson(
    fixture.root,
    "runs/example-run/cycle-01/critique.json",
    (critique) => {
      delete critique.laws.foldComposition;
      delete critique.lawCoverage.foldComposition;
    },
  );

  const result = await checkRelease({
    repoRoot: fixture.root,
    expectedSlugs: fixture.expectedSlugs,
  });
  assertFinding(
    result,
    "SELECTED_LAWS_MISSING",
    "runs/example-run/cycle-01/critique.json",
  );
});

test("selected law coverage and failure arrays are derived from evidence", async (t) => {
  await t.test("claimed viewport coverage", async () => {
    const fixture = await makeFixture();
    await rewriteJson(
      fixture.root,
      "runs/example-run/cycle-01/critique.json",
      (critique) => {
        critique.laws.foldComposition.evidence = [
          critique.laws.foldComposition.evidence[0],
        ];
      },
    );
    await mirrorCritiqueSummary(fixture.root, "example-run");

    const result = await checkRelease({
      repoRoot: fixture.root,
      expectedSlugs: fixture.expectedSlugs,
    });
    assertFinding(
      result,
      "SELECTED_LAWS_MISSING",
      "runs/example-run/cycle-01/critique.json",
    );
  });

  await t.test("forged law failure list", async () => {
    const fixture = await makeFixture();
    await rewriteJson(
      fixture.root,
      "runs/example-run/cycle-01/critique.json",
      (critique) => {
        critique.lawGateFailures = ["law:foldComposition:fail"];
      },
    );
    await mirrorCritiqueSummary(fixture.root, "example-run");

    const result = await checkRelease({
      repoRoot: fixture.root,
      expectedSlugs: fixture.expectedSlugs,
    });
    assertFinding(
      result,
      "SELECTED_LAWS_MISSING",
      "runs/example-run/cycle-01/critique.json",
    );
  });
});

test("selected visual evidence must be a scored vision critique", async () => {
  const fixture = await makeFixture();
  await rewriteJson(
    fixture.root,
    "runs/example-run/cycle-01/critique.json",
    (critique) => {
      critique.mode = "source-fallback";
    },
  );

  const result = await checkRelease({
    repoRoot: fixture.root,
    expectedSlugs: fixture.expectedSlugs,
  });
  assertFinding(
    result,
    "SELECTED_VISION_MISSING",
    "runs/example-run/cycle-01/critique.json",
  );
});

test("selected score and major issue state are derived from critique evidence", async (t) => {
  await t.test("dimension score mismatch", async () => {
    const fixture = await makeFixture();
    await rewriteJson(
      fixture.root,
      "runs/example-run/cycle-01/critique.json",
      (critique) => {
        critique.dimensions.polish.score = 4;
      },
    );
    await mirrorCritiqueSummary(fixture.root, "example-run");

    const result = await checkRelease({
      repoRoot: fixture.root,
      expectedSlugs: fixture.expectedSlugs,
    });
    assertFinding(
      result,
      "SELECTED_VISION_MISSING",
      "runs/example-run/cycle-01/critique.json",
    );
  });

  await t.test("major issue mismatch", async () => {
    const fixture = await makeFixture();
    await rewriteJson(
      fixture.root,
      "runs/example-run/cycle-01/critique.json",
      (critique) => {
        critique.issues.push({
          priority: 1,
          severity: "major",
          dimension: "layout",
          evidence: "Fixture evidence.",
          impact: "Fixture impact.",
          fix: "Fixture fix.",
        });
      },
    );
    await mirrorCritiqueSummary(fixture.root, "example-run");

    const result = await checkRelease({
      repoRoot: fixture.root,
      expectedSlugs: fixture.expectedSlugs,
    });
    assertFinding(
      result,
      "REFERENCE_MISMATCH",
      "runs/example-run/run-report.json",
    );
  });
});

test("selected cycle follows the deterministic best cycle policy", async () => {
  const fixture = await makeFixture();
  await addSecondCycle(fixture.root, "example-run");
  await rewriteJson(
    fixture.root,
    "runs/example-run/cycle-01/critique.json",
    (critique) => {
      critique.dimensions.specificity.score = 10;
      critique.score = 95;
    },
  );
  await mirrorCritiqueSummary(fixture.root, "example-run", 1);

  const result = await checkRelease({
    repoRoot: fixture.root,
    expectedSlugs: fixture.expectedSlugs,
  });
  assertFinding(
    result,
    "REFERENCE_MISMATCH",
    "runs/example-run/run-report.json",
  );
});

test("mechanical fallback selection does not require resolved assets", async () => {
  const fixture = await makeFixture();
  await addSecondCycle(fixture.root, "example-run");

  await rewriteJson(
    fixture.root,
    "runs/example-run/cycle-01/assets.json",
    (assets) => {
      assets.allResolved = false;
      assets.successCount = 2;
      assets.fallbackCount = 1;
      assets.files[0].source = "deterministic-fallback";
      assets.files[0].resolved = false;
      assets.files[0].errorCode = "FIXTURE_FALLBACK";
    },
  );
  await rewriteJson(
    fixture.root,
    "runs/example-run/cycle-01/build.json",
    (build) => {
      build.assetSummary.allResolved = false;
      build.assetSummary.successCount = 2;
      build.assetSummary.fallbackCount = 1;
    },
  );
  await rewriteJson(
    fixture.root,
    "runs/example-run/cycle-01/mechanical.json",
    (mechanical) => {
      mechanical.assetsResolved = false;
    },
  );
  await rewriteJson(
    fixture.root,
    "runs/example-run/cycle-01/critique.json",
    (critique) => {
      critique.assetsResolved = false;
      critique.hardGateFailures = ["assets:not-resolved"];
      critique.shipEligible = false;
      critique.verdict = "revise";
    },
  );
  await mirrorCritiqueSummary(fixture.root, "example-run", 1);

  await rewriteJson(
    fixture.root,
    "runs/example-run/cycle-02/mechanical.json",
    (mechanical) => {
      mechanical.passed = false;
      mechanical.failures = [{ code: "fixture-failure" }];
    },
  );
  await rewriteJson(
    fixture.root,
    "runs/example-run/cycle-02/critique.json",
    (critique) => {
      critique.dimensions.specificity.score = 10;
      critique.score = 95;
      critique.mechanicalPassed = false;
      critique.hardGateFailures = ["mechanical:not-passed"];
      critique.shipEligible = false;
      critique.verdict = "revise";
    },
  );
  const cycleTwoEvidencePacketSha256 = await fixtureEvidencePacketSha256(
    fixture.root,
    "runs/example-run/cycle-02",
  );
  await rewriteJson(
    fixture.root,
    "runs/example-run/cycle-02/critique.json",
    (critique) => {
      critique.evidencePacketSha256 = cycleTwoEvidencePacketSha256;
    },
  );
  await mirrorCritiqueSummary(fixture.root, "example-run", 2);

  await rewriteJson(
    fixture.root,
    "runs/example-run/run-report.json",
    (report) => {
      report.selectedCycle = 1;
      report.scoresImproved = false;
      report.delivery.selectedCycle = 1;
    },
  );
  await rewriteJson(
    fixture.root,
    "runs/example-run/deployment.json",
    (deployment) => {
      deployment.selectedCycle = 1;
    },
  );
  await writeOwnedFile(
    fixture.root,
    "README.md",
    [
      "| Business | Score path | Selected cycle | Final verdict | Evidence |",
      "| --- | --- | ---: | --- | --- |",
      "| example-run | 90 to 95 | 1 | revise | [Run report](runs/example-run/RUN-REPORT.md) |",
      "",
    ].join("\n"),
  );
  await writeOwnedFile(
    fixture.root,
    "DEMO.md",
    "Evidence: `runs/example-run/` Scores: 90 to 95. Selected cycle: 1. Verdict: revise.\n",
  );

  assert.deepEqual(
    await checkRelease({
      repoRoot: fixture.root,
      expectedSlugs: fixture.expectedSlugs,
    }),
    { ok: true, findings: [] },
  );
});

test("deployment evidence binds to selected site bytes and disposition", async (t) => {
  await t.test("site digest mismatch", async () => {
    const fixture = await makeFixture();
    await mutateDeployment(fixture.root, "example-run", (deployment) => {
      deployment.files[0].sha256 = "0".repeat(64);
    });

    const result = await checkRelease({
      repoRoot: fixture.root,
      expectedSlugs: fixture.expectedSlugs,
    });
    assertFinding(
      result,
      "REFERENCE_MISMATCH",
      "runs/example-run/deployment.json",
    );
  });

  await t.test("ineligible cycle cannot claim a nonlocal disposition", async () => {
    const fixture = await makeFixture();
    await rewriteJson(
      fixture.root,
      "runs/example-run/cycle-01/critique.json",
      (critique) => {
        critique.dimensions.layout.score = 8;
        critique.score = 80;
        critique.hardGateFailures = ["score:below-threshold"];
        critique.shipEligible = false;
        critique.verdict = "revise";
      },
    );
    await mirrorCritiqueSummary(fixture.root, "example-run");
    await mutateDeployment(fixture.root, "example-run", (deployment) => {
      deployment.mode = "preview";
    });

    const result = await checkRelease({
      repoRoot: fixture.root,
      expectedSlugs: fixture.expectedSlugs,
    });
    assertFinding(
      result,
      "REFERENCE_MISMATCH",
      "runs/example-run/deployment.json",
    );
  });

  await t.test("local disposition cannot carry a public URL", async () => {
    const fixture = await makeFixture();
    await mutateDeployment(fixture.root, "example-run", (deployment) => {
      deployment.url = ["https:", "", "public.example.invalid", ""].join("/");
    });

    const result = await checkRelease({
      repoRoot: fixture.root,
      expectedSlugs: fixture.expectedSlugs,
    });
    assertFinding(
      result,
      "REFERENCE_MISMATCH",
      "runs/example-run/deployment.json",
    );
  });

  await t.test("unverified local files require null statuses", async () => {
    const fixture = await makeFixture();
    await mutateDeployment(fixture.root, "example-run", (deployment) => {
      deployment.verified = false;
      deployment.status = null;
      for (const file of deployment.files) {
        file.verified = false;
        file.status = null;
      }
      deployment.files[0].status = 200;
    });

    const result = await checkRelease({
      repoRoot: fixture.root,
      expectedSlugs: fixture.expectedSlugs,
    });
    assertFinding(
      result,
      "REFERENCE_MISMATCH",
      "runs/example-run/deployment.json",
    );
  });
});

test("README and DEMO run references must resolve", async () => {
  const fixture = await makeFixture();
  await writeOwnedFile(
    fixture.root,
    "README.md",
    "[Missing evidence](runs/example-run/cycle-09/screenshots/desktop-home.png)\n",
  );

  const result = await checkRelease({
    repoRoot: fixture.root,
    expectedSlugs: fixture.expectedSlugs,
  });
  assertFinding(result, "DOC_REFERENCE_MISMATCH", "README.md");
});

test("README and DEMO each carry consistent release metadata", async (t) => {
  await t.test("README cannot delegate all example references to DEMO", async () => {
    const fixture = await makeFixture();
    await writeOwnedFile(fixture.root, "README.md", "# Release evidence\n");
    const result = await checkRelease({
      repoRoot: fixture.root,
      expectedSlugs: fixture.expectedSlugs,
    });
    assertFinding(result, "DOC_REFERENCE_MISMATCH", "README.md");
  });

  await t.test("DEMO score metadata", async () => {
    const fixture = await makeFixture();
    await writeOwnedFile(
      fixture.root,
      "DEMO.md",
      "Evidence: `runs/example-run/` Scores: 91. Selected cycle: 1. Verdict: ship.\n",
    );
    const result = await checkRelease({
      repoRoot: fixture.root,
      expectedSlugs: fixture.expectedSlugs,
    });
    assertFinding(result, "DOC_REFERENCE_MISMATCH", "DEMO.md");
  });
});

test("finding output uses ordinal deterministic ordering", () => {
  const highCodePoint = String.fromCharCode(228);
  assert.equal(
    formatFindings([
      { rule: "A_RULE", path: `${highCodePoint}.txt` },
      { rule: "A_RULE", path: "z.txt" },
      { rule: "A_RULE", path: "a.txt" },
    ]),
    `A_RULE a.txt\nA_RULE z.txt\nA_RULE ${highCodePoint}.txt`,
  );
});

test("the default example set contains exactly the three release examples", async () => {
  const fixture = await makeFixture({ expectedSlugs: defaultExamples });
  const result = await checkRelease({ repoRoot: fixture.root });
  assert.deepEqual(result, { ok: true, findings: [] });
});

test("CLI exits clean only with no findings and sanitizes internal errors", async (t) => {
  await t.test("clean repository", async () => {
    const fixture = await makeFixture({ expectedSlugs: defaultExamples });
    const result = await runCli(fixture.root);
    assert.equal(result.code, 0);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, "");
  });

  await t.test("release finding", async () => {
    const fixture = await makeFixture({ expectedSlugs: defaultExamples });
    const secret = ["sk", "cli", randomUUID().replaceAll("-", "")].join("-");
    await writeOwnedFile(
      fixture.root,
      "notes/cli.txt",
      `${secretKey()}=${secret}\n`,
    );
    const result = await runCli(fixture.root);
    assert.equal(result.code, 1);
    assert.equal(result.stdout.trim(), "SECRET_ASSIGNMENT notes/cli.txt");
    assert.equal(result.stderr, "");
    assert.equal(result.stdout.includes(secret), false);
  });

  await t.test("internal failure", async () => {
    const root = path.join(
      tmpdir(),
      "mainstreet-release-check-tests",
      randomUUID(),
    );
    await mkdir(root, { recursive: true });
    const result = await runCli(root);
    assert.equal(result.code, 1);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr.trim(), "RELEASE_INTERNAL .");
    assert.equal(result.stderr.includes(root), false);
    assert.equal(result.stderr.toLowerCase().includes("fatal"), false);
  });
});

test("package scripts serialize Node tests and expose the release check", async () => {
  const packageJson = JSON.parse(
    await readFile(path.join(projectRoot, "package.json"), "utf8"),
  );
  assert.equal(packageJson.scripts.test, "node --test --test-concurrency=1");
  assert.equal(
    packageJson.scripts["test:unit"],
    "node --test --test-concurrency=1 test/unit/*.test.js",
  );
  assert.equal(
    packageJson.scripts.check,
    "node --check bin/mainstreet.js && node --test --test-concurrency=1",
  );
  assert.equal(packageJson.scripts["release:check"], "node tools/release-check.js");
});

async function makeFixture({
  expectedSlugs = ["example-run"],
  envExampleValue = "",
  omit = null,
  invalidAssetDigest = false,
  reportSelectedCycle = null,
} = {}) {
  const root = path.join(fixtureRoot, randomUUID());
  await mkdir(root, { recursive: true });
  await git(root, ["init", "-b", "main"]);
  await git(root, ["config", "user.email", "release-check@example.invalid"]);
  await git(root, ["config", "user.name", "Release Check Fixture"]);

  const ignoredModuleDir = ["node", "_modules"].join("");
  await writeOwnedFile(
    root,
    ".gitignore",
    [
      envFile,
      `${envFile}.*`,
      `!${envExampleFile}`,
      `${forbiddenLocalDir}/`,
      `${ignoredModuleDir}/`,
      ".wrangler/",
      "tmp/",
      "coverage/",
      "dist/",
      "",
    ].join("\n"),
  );
  await writeOwnedFile(
    root,
    envExampleFile,
    `${secretKey()}=${envExampleValue}\n`,
  );

  for (const slug of expectedSlugs) {
    await writeCompleteRun(root, slug, {
      omit: expectedSlugs.length === 1 ? omit : null,
      invalidAssetDigest: expectedSlugs.length === 1 && invalidAssetDigest,
      reportSelectedCycle:
        expectedSlugs.length === 1 ? reportSelectedCycle : null,
    });
  }

  await writeOwnedFile(
    root,
    "README.md",
    [
      "| Business | Score path | Selected cycle | Final verdict | Evidence |",
      "| --- | --- | ---: | --- | --- |",
      ...expectedSlugs.map(
        (slug) =>
          `| ${slug} | 90 | 1 | ship | [Run report](runs/${slug}/RUN-REPORT.md) |`,
      ),
      "",
    ].join("\n"),
  );
  await writeOwnedFile(
    root,
    "DEMO.md",
    expectedSlugs
      .map(
        (slug) =>
          `Evidence: \`runs/${slug}/\` Scores: 90. Selected cycle: 1. Verdict: ship.`,
      )
      .join("\n") + "\n",
  );
  await commitAll(root, "create clean release fixture");
  return { root, expectedSlugs };
}

async function writeCompleteRun(
  root,
  slug,
  { omit, invalidAssetDigest, reportSelectedCycle },
) {
  const cycle = 1;
  const cycleRoot = `runs/${slug}/cycle-01`;
  const assetFiles = [];
  const imagePlan = [];

  for (let index = 1; index <= 3; index += 1) {
    const filename = `image-${index}.png`;
    const assetPath = `${cycleRoot}/site/assets/${filename}`;
    const bytes = png(index);
    await writeOwnedFile(root, assetPath, bytes);
    imagePlan.push({
      filename,
      role: `image-${index}`,
      alt: `Generated image ${index}`,
      prompt: `One coherent local business image ${index}`,
      focalPoint: { x: 0.5, y: 0.5 },
    });
    assetFiles.push({
      filename,
      path: `assets/${filename}`,
      role: `image-${index}`,
      alt: `Generated image ${index}`,
      focalPoint: { x: 0.5, y: 0.5 },
      promptHash: "b".repeat(64),
      mediaType: "image/png",
      bytes: bytes.length,
      sha256:
        invalidAssetDigest && index === 1
          ? "0".repeat(64)
          : digest(bytes),
      source: "openai",
      resolved: true,
      errorCode: null,
    });
  }

  const assetSummary = {
    allResolved: true,
    requestCount: 3,
    successCount: 3,
    fallbackCount: 0,
  };
  const laws = Object.fromEntries(
    qualityLaws.map((name) => [
      name,
      {
        status: "pass",
        evidence: evidenceViewports.map((viewport) => ({
          viewport,
          observation: `${viewport} verifies ${name}`,
        })),
        fix: "Preserve the verified result.",
      },
    ]),
  );
  const lawCoverage = Object.fromEntries(
    qualityLaws.map((name) => [
      name,
      {
        requiredViewports: viewportCoverageLaws.has(name)
          ? [...evidenceViewports]
          : [],
        observedViewports: [...evidenceViewports],
        missingViewports: [],
        complete: true,
      },
    ]),
  );
  const critique = {
    rubricVersion: "1.0",
    summary: "Complete visual evidence.",
    dimensions: Object.fromEntries(
      Object.entries(dimensionScores).map(([name, score]) => [
        name,
        {
          score,
          evidence: `${name} evidence.`,
          fix: `Preserve ${name}.`,
        },
      ]),
    ),
    strengths: ["Clear composition."],
    issues: [],
    laws,
    revisionBrief: { mustFix: [], preserve: ["Keep the composition."] },
    score: 90,
    lawCoverage,
    lawGatePassed: true,
    lawGateFailures: [],
    mechanicalPassed: true,
    assetsResolved: true,
    mode: "vision",
    hasMajorIssue: false,
    hardGateFailures: [],
    shipEligible: true,
    verdict: "ship",
    cycle,
    createdAt: "2026-07-18T00:00:00.000Z",
  };
  const mechanical = releaseMechanicalEvidence(cycle);

  await writeJson(root, `runs/${slug}/brief.json`, {
    schemaVersion: "1.0",
    slug,
    business: { name: slug },
  });
  await writeJson(root, `${cycleRoot}/build.json`, {
    cycle,
    createdAt: "2026-07-18T00:00:00.000Z",
    source: "openai",
    fallbackReason: null,
    designNotes: {
      aesthetic: "Editorial",
      signatureMove: "staged-hero-entrance",
      rationale: "A calm first beat.",
    },
    imagePlan,
    assetSummary,
  });
  await writeJson(root, `${cycleRoot}/assets.json`, {
    schemaVersion: "1.0",
    ...assetSummary,
    files: assetFiles,
  });
  await writeOwnedFile(
    root,
    `${cycleRoot}/site/index.html`,
    '<!doctype html><link rel="stylesheet" href="styles.css"><main>Example</main><script src="script.js"></script>\n',
  );
  await writeOwnedFile(
    root,
    `${cycleRoot}/site/styles.css`,
    "body { color: #171717; }\n",
  );
  if (omit !== "site/script.js") {
    await writeOwnedFile(
      root,
      `${cycleRoot}/site/script.js`,
      "document.documentElement.dataset.ready = 'true';\n",
    );
  }

  const screenshotPaths = {
    desktop: "screenshots/desktop-home.png",
    tablet: "screenshots/tablet-home.png",
    phone: "screenshots/mobile-home.png",
  };
  const screenshotDimensions = {
    desktop: { width: 1440, height: 900 },
    tablet: { width: 1024, height: 768 },
    phone: { width: 390, height: 844 },
  };
  for (const [index, [viewport, relative]] of Object.entries(screenshotPaths).entries()) {
    const dimensions = screenshotDimensions[viewport];
    await writeOwnedFile(
      root,
      `${cycleRoot}/${relative}`,
      solidPng(dimensions.width, dimensions.height, index + 10),
    );
  }
  await writeJson(root, `${cycleRoot}/screenshots/manifest.json`, {
    schemaVersion: "2.0",
    cycle,
    capturedAt: "2026-07-18T00:00:00.000Z",
    viewports: {
      desktop: { width: 1440, height: 900, path: screenshotPaths.desktop },
      tablet: { width: 1024, height: 768, path: screenshotPaths.tablet },
      phone: { width: 390, height: 844, path: screenshotPaths.phone },
    },
    network: {
      externalRequestCount: 0,
      requestFailureCount: 0,
      consoleErrorCount: 0,
      pageErrorCount: 0,
    },
  });
  const criticScreenshotPaths = {
    desktop: "screenshots/critic/desktop-full-page.png",
    tablet: "screenshots/critic/tablet-full-page.png",
    phone: "screenshots/critic/mobile-full-page.png",
  };
  const criticViewports = {};
  for (const [index, [viewport, relative]] of Object.entries(criticScreenshotPaths).entries()) {
    const width = { desktop: 1440, tablet: 1024, phone: 390 }[viewport];
    const height = { desktop: 3600, tablet: 3072, phone: 3376 }[viewport];
    const bytes = solidPng(width, height, index + 20);
    await writeOwnedFile(root, `${cycleRoot}/${relative}`, bytes);
    criticViewports[viewport] = {
      width,
      renderedWidth: width,
      height,
      path: relative,
      bytes: bytes.length,
      sha256: digest(bytes),
    };
  }
  await writeJson(root, `${cycleRoot}/screenshots/critic/manifest.json`, {
    schemaVersion: "1.0",
    cycle,
    capturedAt: "2026-07-18T00:00:00.000Z",
    capture: "full-page",
    motionMode: "reducedMotion",
    canonicalCaptureSha256: await canonicalCaptureDigest(root, cycleRoot),
    viewports: criticViewports,
  });
  await writeJson(root, `${cycleRoot}/mechanical.json`, mechanical);
  critique.evidencePacketSha256 = await fixtureEvidencePacketSha256(root, cycleRoot);
  await writeJson(root, `${cycleRoot}/critique.json`, critique);
  await writeOwnedFile(root, `${cycleRoot}/visible-text.txt`, "Example business\n");

  const selectedCycle = reportSelectedCycle ?? cycle;
  const deploymentFiles = [];
  for (const relativePath of [
    "index.html",
    "styles.css",
    ...(omit === "site/script.js" ? [] : ["script.js"]),
    ...assetFiles.map((file) => file.path),
  ].sort((left, right) => left.localeCompare(right, "en"))) {
    const value = await readFile(
      path.join(root, ...`${cycleRoot}/site/${relativePath}`.split("/")),
    );
    deploymentFiles.push({
      path: relativePath,
      bytes: value.length,
      sha256: digest(value),
      status: 200,
      verified: true,
    });
  }
  const deployment = {
    schemaVersion: "2.0",
    slug,
    selectedCycle,
    commit: "unavailable",
    createdAt: "2026-07-18T00:00:00.000Z",
    mode: "local",
    url: "http://127.0.0.1:4601/",
    immutableUrl: null,
    verified: true,
    status: 200,
    aggregateSha256: aggregateDigest(deploymentFiles),
    files: deploymentFiles,
  };
  await writeJson(root, `runs/${slug}/deployment.json`, deployment);
  await writeJson(root, `runs/${slug}/run-report.json`, {
    schemaVersion: "1.0",
    slug,
    businessName: slug,
    startedAt: "2026-07-18T00:00:00.000Z",
    completedAt: "2026-07-18T00:01:00.000Z",
    status: "completed",
    stopReason: "ship_threshold",
    selectedCycle,
    scoresImproved: false,
    cycles: [
      {
        cycle,
        score: critique.score,
        visionScore: null,
        verdict: critique.verdict,
        mode: critique.mode,
        evidencePacketSha256: critique.evidencePacketSha256,
        mechanicalPassed: critique.mechanicalPassed,
        assetsResolved: critique.assetsResolved,
        lawGatePassed: critique.lawGatePassed,
        lawGateFailures: critique.lawGateFailures,
        shipEligible: critique.shipEligible,
        hardGateFailures: critique.hardGateFailures,
        laws: critique.laws,
        lawCoverage: critique.lawCoverage,
      },
    ],
    delivery: deployment,
  });
  await writeOwnedFile(
    root,
    `runs/${slug}/RUN-REPORT.md`,
    `# ${slug} run report\n\nSelected cycle: ${selectedCycle}\n`,
  );
}

async function rewriteJson(root, relativePath, mutate) {
  const fullPath = path.join(root, ...relativePath.split("/"));
  const value = JSON.parse(await readFile(fullPath, "utf8"));
  mutate(value);
  await writeFile(fullPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function addSecondCycle(root, slug, { includeRevise = true } = {}) {
  const runRoot = `runs/${slug}`;
  const firstCycle = `${runRoot}/cycle-01`;
  const secondCycle = `${runRoot}/cycle-02`;
  await cp(
    path.join(root, ...firstCycle.split("/")),
    path.join(root, ...secondCycle.split("/")),
    { recursive: true },
  );
  await rewriteJson(root, `${secondCycle}/build.json`, (build) => {
    build.cycle = 2;
    build.fromCycle = 1;
  });
  await rewriteJson(
    root,
    `${secondCycle}/screenshots/manifest.json`,
    (manifest) => {
      manifest.cycle = 2;
    },
  );
  const secondCanonicalCaptureSha256 = await canonicalCaptureDigest(root, secondCycle);
  await rewriteJson(
    root,
    `${secondCycle}/screenshots/critic/manifest.json`,
    (manifest) => {
      manifest.cycle = 2;
      manifest.canonicalCaptureSha256 = secondCanonicalCaptureSha256;
    },
  );
  await rewriteJson(root, `${secondCycle}/mechanical.json`, (mechanical) => {
    mechanical.cycle = 2;
  });
  await rewriteJson(root, `${secondCycle}/critique.json`, (critique) => {
    critique.cycle = 2;
  });
  const secondEvidencePacketSha256 = await fixtureEvidencePacketSha256(
    root,
    secondCycle,
  );
  await rewriteJson(root, `${secondCycle}/critique.json`, (critique) => {
    critique.evidencePacketSha256 = secondEvidencePacketSha256;
  });
  if (includeRevise) {
    await writeJson(root, `${firstCycle}/revise.json`, {
      schemaVersion: "1.0",
      fromCycle: 1,
      toCycle: 2,
      createdAt: "2026-07-18T00:00:30.000Z",
      targetScore: 95,
      mustKeep: [],
      mustFix: [],
      preserve: [],
      mechanicalFailures: [],
    });
  }
  await rewriteJson(root, `${runRoot}/run-report.json`, (report) => {
    const second = structuredClone(report.cycles[0]);
    second.cycle = 2;
    second.evidencePacketSha256 = secondEvidencePacketSha256;
    report.cycles.push(second);
    report.selectedCycle = 2;
    report.delivery.selectedCycle = 2;
  });
  await rewriteJson(root, `${runRoot}/deployment.json`, (deployment) => {
    deployment.selectedCycle = 2;
  });
  await writeOwnedFile(
    root,
    `${runRoot}/RUN-REPORT.md`,
    `# ${slug} run report\n\nSelected cycle: 2\n`,
  );
}

async function mirrorCritiqueSummary(root, slug, cycle = 1) {
  const cycleName = `cycle-${String(cycle).padStart(2, "0")}`;
  const critique = JSON.parse(
    await readFile(
      path.join(root, "runs", slug, cycleName, "critique.json"),
      "utf8",
    ),
  );
  await rewriteJson(root, `runs/${slug}/run-report.json`, (report) => {
    const summary = report.cycles.find((entry) => entry.cycle === cycle);
    for (const field of [
      "score",
      "verdict",
      "mode",
      "evidencePacketSha256",
      "mechanicalPassed",
      "assetsResolved",
      "lawGatePassed",
      "lawGateFailures",
      "shipEligible",
      "hardGateFailures",
      "laws",
      "lawCoverage",
    ]) {
      summary[field] = structuredClone(critique[field]);
    }
  });
}

async function mutateDeployment(root, slug, mutate) {
  const relativePath = `runs/${slug}/deployment.json`;
  const deployment = JSON.parse(
    await readFile(path.join(root, ...relativePath.split("/")), "utf8"),
  );
  mutate(deployment);
  await writeJson(root, relativePath, deployment);
  await rewriteJson(root, `runs/${slug}/run-report.json`, (report) => {
    report.delivery = structuredClone(deployment);
  });
}

async function writeJson(root, relativePath, value) {
  await writeOwnedFile(root, relativePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function writeOwnedFile(root, relativePath, value) {
  const fullPath = path.join(root, ...relativePath.split("/"));
  await mkdir(path.dirname(fullPath), { recursive: true });
  await writeFile(fullPath, value);
}

async function commitAll(root, message) {
  await git(root, ["add", "-A"]);
  await git(root, ["commit", "-m", message]);
}

async function git(root, args) {
  await execFileAsync("git", ["-C", root, ...args], {
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
    windowsHide: true,
  });
}

async function readProjectBlob(object) {
  const { stdout } = await execFileAsync(
    "git",
    ["-C", projectRoot, "cat-file", "blob", object],
    {
      encoding: "buffer",
      maxBuffer: 8 * 1024 * 1024,
      windowsHide: true,
    },
  );
  return stdout;
}

function checkSyntheticHistory(entries) {
  return checkRelease({
    repoRoot: projectRoot,
    expectedSlugs: ["example-run"],
    git: syntheticGit({ historyEntries: entries }),
  });
}

function syntheticGit({
  historyEntries = [],
  trackedPaths = [],
  untrackedPaths = [],
} = {}) {
  const commits = new Map(
    historyEntries.map((entry, index) => [`synthetic-commit-${index}`, entry]),
  );
  const blobs = new Map(historyEntries.map((entry) => [entry.object, entry.value]));
  return async (args, { input } = {}) => {
    const command = args.join(" ");
    if (command === "ls-files -z") return nulPaths(trackedPaths);
    if (command === "ls-files --deleted -z") return Buffer.alloc(0);
    if (command === "ls-files --others --exclude-standard -z") {
      return nulPaths(untrackedPaths);
    }
    if (command === "rev-list --all") {
      return Buffer.from(`${[...commits.keys()].join("\n")}\n`);
    }
    if (args[0] === "ls-tree") {
      const entry = commits.get(args.at(-1));
      if (!entry) throw new Error("Unexpected synthetic commit.");
      return Buffer.from(`100644 blob ${entry.object}\t${entry.path}\0`);
    }
    if (command === "cat-file --batch") {
      const objects = String(input).trim().split(/\r?\n/).filter(Boolean);
      return Buffer.concat(
        objects.flatMap((object) => {
          const value = blobs.get(object);
          if (!value) throw new Error("Unexpected synthetic blob.");
          return [
            Buffer.from(`${object} blob ${value.length}\n`),
            value,
            Buffer.from("\n"),
          ];
        }),
      );
    }
    throw new Error(`Unexpected synthetic Git command: ${command}`);
  };
}

function nulPaths(paths) {
  return Buffer.from(paths.length === 0 ? "" : `${paths.join("\0")}\0`);
}

function differentObjectId(object) {
  const replacement = object[0] === "0" ? "1" : "0";
  return `${replacement}${object.slice(1)}`;
}

function gitBlobObjectId(value) {
  return createHash("sha1")
    .update(`blob ${value.length}\0`)
    .update(value)
    .digest("hex");
}

function runCli(root) {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [releaseCheckPath],
      {
        cwd: root,
        encoding: "utf8",
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        resolve({
          code: error?.code ?? 0,
          stdout,
          stderr,
        });
      },
    );
  });
}

function assertFinding(result, rule, relativePath) {
  assert.equal(result.ok, false);
  assert.ok(
    result.findings.some(
      (finding) => finding.rule === rule && finding.path === relativePath,
    ),
    `Expected ${rule} at ${relativePath}`,
  );
}

function assertNoFinding(result, rule, relativePath) {
  assert.equal(
    result.findings.some(
      (finding) => finding.rule === rule && finding.path === relativePath,
    ),
    false,
    `Did not expect ${rule} at ${relativePath}`,
  );
}

function secretKey() {
  return ["OPEN", "AI", "API", "KEY"].join("_");
}

function modelKey() {
  return ["OPEN", "AI", "MODEL"].join("_");
}

function imageModelKey() {
  return ["OPEN", "AI", "IMAGE", "MODEL"].join("_");
}

function png(marker) {
  return Buffer.concat([pngSignature, Buffer.from([marker, 1, 2, 3, 4])]);
}

const solidPngCache = new Map();

function solidPng(width, height, marker = 0) {
  const key = `${width}x${height}:${marker}`;
  const cached = solidPngCache.get(key);
  if (cached) return cached;

  const rowLength = width * 3 + 1;
  const pixels = Buffer.alloc(rowLength * height);
  for (let row = 0; row < height; row += 1) {
    const offset = row * rowLength;
    pixels[offset] = 0;
    pixels.fill(marker, offset + 1, offset + rowLength);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const value = Buffer.concat([
    pngSignature,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(pixels)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
  solidPngCache.set(key, value);
  return value;
}

function pngChunk(type, data) {
  const name = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([name, data])), 0);
  return Buffer.concat([length, name, data, checksum]);
}

function pngChunks(value) {
  const chunks = [];
  let offset = pngSignature.length;
  while (offset < value.length) {
    const length = value.readUInt32BE(offset);
    const end = offset + 12 + length;
    chunks.push({
      type: value.subarray(offset + 4, offset + 8).toString("ascii"),
      start: offset,
      end,
      data: value.subarray(offset + 8, offset + 8 + length),
    });
    offset = end;
  }
  return chunks;
}

function corruptPngCrc(value) {
  const result = Buffer.from(value);
  const ihdr = pngChunks(result).find((chunk) => chunk.type === "IHDR");
  result[ihdr.end - 1] ^= 1;
  return result;
}

function removePngIdat(value) {
  return Buffer.concat([
    pngSignature,
    ...pngChunks(value)
      .filter((chunk) => chunk.type !== "IDAT")
      .map((chunk) => value.subarray(chunk.start, chunk.end)),
  ]);
}

function corruptPngCompressedData(value) {
  return Buffer.concat([
    pngSignature,
    ...pngChunks(value).map((chunk) =>
      chunk.type === "IDAT"
        ? pngChunk("IDAT", Buffer.from([0, 1, 2, 3]))
        : value.subarray(chunk.start, chunk.end),
    ),
  ]);
}

function crc32(value) {
  let crc = 0xffffffff;
  for (const byte of value) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

async function canonicalCaptureDigest(root, cycleRoot) {
  const paths = [
    "screenshots/manifest.json",
    "screenshots/desktop-home.png",
    "screenshots/tablet-home.png",
    "screenshots/mobile-home.png",
  ];
  const entries = [];
  for (const relativePath of paths) {
    const value = await readFile(
      path.join(root, ...`${cycleRoot}/${relativePath}`.split("/")),
    );
    entries.push({
      path: relativePath,
      bytes: value.length,
      sha256: digest(value),
    });
  }
  return digest(Buffer.from(JSON.stringify(entries), "utf8"));
}

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

function releaseMechanicalEvidence(cycle) {
  const context = {
    firstBeats: {},
    touchTargets: {},
    controls: {},
    motion: {},
  };
  return {
    schemaVersion: "2.0",
    cycle,
    passed: true,
    assetsResolved: true,
    assetManifestPresent: true,
    motionMoveSlugs: ["staged-hero-entrance"],
    contexts: Object.fromEntries(
      evidenceViewports.map((viewport) => [
        viewport,
        {
          normal: structuredClone(context),
          reducedMotion: structuredClone(context),
          javascriptDisabled: structuredClone(context),
        },
      ]),
    ),
    failures: [],
    totals: {
      externalRequestCount: 0,
      requestFailureCount: 0,
      consoleErrorCount: 0,
      pageErrorCount: 0,
    },
  };
}

async function fixtureEvidencePacketSha256(root, cycleRoot) {
  const read = (relativePath) =>
    readFile(path.join(root, ...`${cycleRoot}/${relativePath}`.split("/")));
  const [canonicalManifestBytes, criticManifestBytes, mechanicalBytes] =
    await Promise.all([
      read("screenshots/manifest.json"),
      read("screenshots/critic/manifest.json"),
      read("mechanical.json"),
    ]);
  const canonicalBuffers = Object.fromEntries(
    await Promise.all(
      Object.entries({
        desktop: "screenshots/desktop-home.png",
        tablet: "screenshots/tablet-home.png",
        phone: "screenshots/mobile-home.png",
      }).map(async ([viewport, relativePath]) => [viewport, await read(relativePath)]),
    ),
  );
  const fullPageBuffers = Object.fromEntries(
    await Promise.all(
      Object.entries({
        desktop: "screenshots/critic/desktop-full-page.png",
        tablet: "screenshots/critic/tablet-full-page.png",
        phone: "screenshots/critic/mobile-full-page.png",
      }).map(async ([viewport, relativePath]) => [viewport, await read(relativePath)]),
    ),
  );
  return createRenderedEvidencePacketSha256({
    canonicalManifestBytes,
    canonicalBuffers,
    criticManifestBytes,
    fullPageBuffers,
    mechanical: JSON.parse(mechanicalBytes.toString("utf8")),
  });
}

function aggregateDigest(files) {
  const aggregate = createHash("sha256");
  for (const file of files) {
    aggregate.update(file.path, "utf8");
    aggregate.update("\0", "utf8");
    aggregate.update(String(file.bytes), "utf8");
    aggregate.update("\0", "utf8");
    aggregate.update(file.sha256, "utf8");
    aggregate.update("\n", "utf8");
  }
  return aggregate.digest("hex");
}
