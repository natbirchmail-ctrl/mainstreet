import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, symlink, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import test from "node:test";

import {
  EVIDENCE_VIEWPORTS,
  captureRenderedEvidence,
} from "../../src/critic-evidence.js";
import { EVIDENCE_VIEWPORTS as CANONICAL_VIEWPORTS } from "../../src/viewports.js";
import {
  createDeterministicPng,
  sha256Hex,
} from "../../src/assets.js";
import {
  MOTION_MOVE_SLUGS,
  createOwnedMotionRuntime,
  createOwnedMotionStyles,
} from "../../src/motion.js";

const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);
const SHOOT_DIRECTION = "Clear natural light with consistent framing.";
const RESOLVED_PNG = createDeterministicPng({
  filename: "independent-source.png",
  role: "source",
  alt: "Independent source pixels",
  prompt: "A source image unrelated to the fixture plan",
  focalPoint: { x: 0.25, y: 0.75 },
  shootDirection: "A deliberately unrelated source direction",
});
const ALTERNATE_RESOLVED_PNG = createDeterministicPng({
  filename: "alternate-source.png",
  role: "source",
  alt: "Alternate source pixels",
  prompt: "A second source image unrelated to the fixture plan",
  focalPoint: { x: 0.75, y: 0.25 },
  shootDirection: "A second deliberately unrelated source direction",
});

const MOTION_MOVES = Object.keys(MOTION_MOVE_SLUGS);

function pngCrc32(...buffers) {
  let value = 0xffffffff;
  for (const buffer of buffers) {
    for (const byte of buffer) {
      value ^= byte;
      for (let bit = 0; bit < 8; bit += 1) {
        value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
      }
    }
  }
  return (value ^ 0xffffffff) >>> 0;
}

function appendToLastIdat(image, trailing) {
  let offset = 8;
  let target = null;
  while (offset < image.length) {
    const length = image.readUInt32BE(offset);
    const end = offset + 12 + length;
    const type = image.subarray(offset + 4, offset + 8);
    if (type.toString("ascii") === "IDAT") {
      target = { offset, end, type, data: image.subarray(offset + 8, offset + 8 + length) };
    }
    offset = end;
  }
  if (!target) throw new Error("fixture PNG has no IDAT chunk");
  const data = Buffer.concat([target.data, trailing]);
  const replacement = Buffer.alloc(12 + data.length);
  replacement.writeUInt32BE(data.length, 0);
  target.type.copy(replacement, 4);
  data.copy(replacement, 8);
  replacement.writeUInt32BE(pngCrc32(target.type, data), 8 + data.length);
  return Buffer.concat([
    image.subarray(0, target.offset),
    replacement,
    image.subarray(target.end),
  ]);
}

test("rendered evidence publishes the fixed viewport contract", () => {
  assert.equal(EVIDENCE_VIEWPORTS, CANONICAL_VIEWPORTS);
  assert.deepEqual(EVIDENCE_VIEWPORTS, {
    desktop: { width: 1440, height: 900, filename: "desktop-home.png", touch: false },
    tablet: { width: 1024, height: 768, filename: "tablet-home.png", touch: true },
    phone: { width: 390, height: 844, filename: "mobile-home.png", touch: true },
    narrow: { width: 320, height: 800, filename: null, touch: true },
  });
});

test("every motion move proves normal activation, reduced fallback, and no JavaScript visibility", async (t) => {
  for (const move of MOTION_MOVES) {
    await t.test(move, async () => {
      const fixture = await writeFixture({ move });
      const evidence = await captureRenderedEvidence({
        siteDir: fixture.siteDir,
        cycleDir: fixture.cycleDir,
        port: 4601,
        now: () => new Date("2026-07-17T20:00:00.000Z"),
      });

      assert.equal(evidence.mechanical.schemaVersion, "2.0");
      assert.equal(evidence.mechanical.passed, true, JSON.stringify(evidence.mechanical.failures));
      assert.equal(evidence.assetsResolved, true);
      assert.equal(evidence.mechanical.assetsResolved, true);
      assert.deepEqual(Object.keys(evidence.mechanical.contexts), [
        "desktop",
        "tablet",
        "phone",
        "narrow",
      ]);
      for (const viewport of ["desktop", "tablet", "phone"]) {
        assert.deepEqual(Object.keys(evidence.mechanical.contexts[viewport]), [
          "normal",
          "reducedMotion",
          "javascriptDisabled",
        ]);
        assert.equal(
          evidence.mechanical.contexts[viewport].normal.motion.contractPassed,
          true,
        );
        assert.equal(
          evidence.mechanical.contexts[viewport].reducedMotion.motion.reducedFallbackPassed,
          true,
        );
        assert.equal(
          evidence.mechanical.contexts[viewport].javascriptDisabled.motion.noJavaScriptFallbackPassed,
          true,
        );
        if (
          move === "horizontal click reel" ||
          move === "numbered story stepper"
        ) {
          assert.deepEqual(
            evidence.mechanical.contexts[viewport].normal.controls.roots.map(
              ({ slug, subjectIndex, rootCount, controlCount, ariaLinkedCount }) => ({
                slug,
                subjectIndex,
                rootCount,
                controlCount,
                ariaLinkedCount,
              }),
            ),
            [
              {
                slug: MOTION_MOVE_SLUGS[move],
                subjectIndex: 0,
                rootCount: 1,
                controlCount: 2,
                ariaLinkedCount: 2,
              },
            ],
          );
        }
      }
      assert.deepEqual(Object.keys(evidence.mechanical.contexts.narrow), ["normal"]);

      for (const target of [
        evidence.desktopPath,
        evidence.tabletPath,
        evidence.mobilePath,
        evidence.fullPagePaths.desktop,
        evidence.fullPagePaths.tablet,
        evidence.fullPagePaths.phone,
      ]) {
        assert.deepEqual([...(await readFile(target)).subarray(0, 8)], [
          137, 80, 78, 71, 13, 10, 26, 10,
        ]);
      }

      assert.equal(evidence.screenshotManifest.schemaVersion, "2.0");
      assert.equal(evidence.screenshotManifest.capturedAt, "2026-07-17T20:00:00.000Z");
      assert.deepEqual(evidence.screenshotManifest.viewports, {
        desktop: {
          width: 1440,
          height: 900,
          path: "screenshots/desktop-home.png",
        },
        tablet: {
          width: 1024,
          height: 768,
          path: "screenshots/tablet-home.png",
        },
        phone: {
          width: 390,
          height: 844,
          path: "screenshots/mobile-home.png",
        },
      });
      assert.equal("previewUrl" in evidence.screenshotManifest, false);
      assert.equal(evidence.criticManifest.schemaVersion, "1.0");
      assert.equal(evidence.criticManifest.cycle, 1);
      assert.equal(evidence.criticManifest.capture, "full-page");
      assert.equal(evidence.criticManifest.motionMode, "reducedMotion");
      assert.match(evidence.criticManifest.canonicalCaptureSha256, /^[a-f0-9]{64}$/);
      assert.equal(evidence.criticManifest.capturedAt, "2026-07-17T20:00:00.000Z");
      for (const viewportName of ["desktop", "tablet", "phone"]) {
        const record = evidence.criticManifest.viewports[viewportName];
        const bytes = await readFile(evidence.fullPagePaths[viewportName]);
        assert.equal(record.width, EVIDENCE_VIEWPORTS[viewportName].width);
        assert.equal(record.renderedWidth, bytes.readUInt32BE(16));
        assert.ok(record.height > EVIDENCE_VIEWPORTS[viewportName].height);
        assert.equal(record.height, bytes.readUInt32BE(20));
        assert.equal(record.bytes, bytes.length);
        assert.equal(record.sha256, sha256Hex(bytes));
        assert.equal(
          record.path,
          `screenshots/critic/${viewportName === "phone" ? "mobile" : viewportName}-full-page.png`,
        );
      }

      const stored = [
        await readFile(path.join(fixture.cycleDir, "mechanical.json"), "utf8"),
        await readFile(path.join(fixture.cycleDir, "screenshots", "manifest.json"), "utf8"),
        await readFile(path.join(fixture.cycleDir, "screenshots", "critic", "manifest.json"), "utf8"),
      ].join("\n");
      assert.doesNotMatch(stored, /https?:\/\//i);
      assert.doesNotMatch(stored, /[A-Z]:\\/i);
      assert.match(
        await readFile(path.join(fixture.cycleDir, "visible-text.txt"), "utf8"),
        /Rendered proof/,
      );

      const reused = await captureRenderedEvidence({
        siteDir: fixture.siteDir,
        cycleDir: fixture.cycleDir,
        port: 4601,
        startServer: async () => {
          throw new Error("completed evidence must not start another server");
        },
      });
      assert.deepEqual(reused.mechanical, evidence.mechanical);
      assert.deepEqual(reused.screenshotManifest, evidence.screenshotManifest);
      assert.deepEqual(reused.criticManifest, evidence.criticManifest);
      assert.deepEqual(reused.fullPagePaths, evidence.fullPagePaths);
      assert.equal(reused.assetsResolved, evidence.assetsResolved);
    });
  }
});

test("every motion move has a failing normal and reduced motion fixture", async (t) => {
  for (const move of MOTION_MOVES) {
    await t.test(move, async () => {
      const fixture = await writeFixture({ move, disableRuntime: true });
      const evidence = await captureRenderedEvidence({
        siteDir: fixture.siteDir,
        cycleDir: fixture.cycleDir,
        port: 4601,
      });

      for (const viewport of ["desktop", "tablet", "phone"]) {
        assert.equal(
          evidence.mechanical.contexts[viewport].normal.motion.contractPassed,
          false,
        );
        assert.equal(
          evidence.mechanical.contexts[viewport].reducedMotion.motion.contractPassed,
          false,
        );
      }
    });
  }
});

test("missing asset evidence and browser failures fail mechanics with stable codes", async () => {
  const fixture = await writeFixture({
    move: "staged hero entrance",
    writeAssets: false,
    writeImage: false,
    invalidLayout: true,
  });
  const evidence = await captureRenderedEvidence({
    siteDir: fixture.siteDir,
    cycleDir: fixture.cycleDir,
    port: 4601,
  });

  assert.equal(evidence.assetsResolved, false);
  assert.equal(evidence.mechanical.assetsResolved, false);
  assert.equal(evidence.mechanical.passed, false);
  const codes = evidence.mechanical.failures.map((failure) => failure.code);
  assert.ok(codes.includes("assets-manifest-missing"));
  assert.ok(codes.includes("broken-image"));
  assert.ok(codes.includes("horizontal-overflow"));
  assert.ok(codes.includes("touch-target-too-small"));
  assert.ok(
    evidence.criticManifest.viewports.desktop.renderedWidth >
      evidence.criticManifest.viewports.desktop.width,
  );
  for (const failure of evidence.mechanical.failures) {
    assert.deepEqual(
      Object.keys(failure).every((key) =>
        ["code", "viewport", "mode", "subjectIndex", "count"].includes(key),
      ),
      true,
    );
  }

  const reused = await captureRenderedEvidence({
    siteDir: fixture.siteDir,
    cycleDir: fixture.cycleDir,
    port: 4601,
    startServer: async () => {
      throw new Error("a complete failing packet must be reused without recapture");
    },
  });
  assert.deepEqual(reused.mechanical, evidence.mechanical);
});

test("an unresolved asset manifest remains a separate nonmechanical gate", async () => {
  const fixture = await writeFixture({
    move: "gentle one direction scroll reveals",
    assetsResolved: false,
  });
  const evidence = await captureRenderedEvidence({
    siteDir: fixture.siteDir,
    cycleDir: fixture.cycleDir,
    port: 4601,
  });

  assert.equal(evidence.assetsResolved, false);
  assert.equal(evidence.mechanical.assetsResolved, false);
  assert.equal(evidence.mechanical.passed, true, JSON.stringify(evidence.mechanical.failures));
  assert.equal(
    evidence.mechanical.failures.some((failure) => failure.code.startsWith("assets-")),
    false,
  );
});

test("asset gate rejects noncanonical manifest fields", async () => {
  const fixture = await writeFixture({
    move: "staged hero entrance",
    assetManifestTransform: (manifest) => ({ ...manifest, unexpected: true }),
  });
  const evidence = await captureRenderedEvidence({
    siteDir: fixture.siteDir,
    cycleDir: fixture.cycleDir,
    port: 4601,
  });

  assert.equal(evidence.assetsResolved, false);
  assert.equal(evidence.mechanical.passed, false);
  assert.ok(
    evidence.mechanical.failures.some(
      (failure) => failure.code === "assets-manifest-invalid",
    ),
  );
});

test("asset resolution is bound to build facts and the actual PNG bytes", async (t) => {
  await t.test("rejects deterministic fallback bytes relabeled as OpenAI", async () => {
    const fixture = await writeFixture({ move: "staged hero entrance" });
    const build = JSON.parse(await readFile(path.join(fixture.cycleDir, "build.json"), "utf8"));
    const manifestPath = path.join(fixture.cycleDir, "assets.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    const planned = build.imagePlan[0];
    const fallback = createDeterministicPng({
      ...planned,
      shootDirection: build.designNotes.shootDirection,
    });
    await writeFile(path.join(fixture.siteDir, "assets", planned.filename), fallback);
    manifest.files[0].bytes = fallback.length;
    manifest.files[0].sha256 = sha256Hex(fallback);
    await writeFile(manifestPath, `${JSON.stringify(manifest)}\n`, "utf8");

    assertAssetIntegrityFailure(await captureRenderedEvidence({
      siteDir: fixture.siteDir,
      cycleDir: fixture.cycleDir,
      port: 4601,
    }));
  });

  await t.test("rejects a valid PNG whose bytes no longer match its manifest", async () => {
    const fixture = await writeFixture({ move: "staged hero entrance" });
    await writeFile(
      path.join(fixture.siteDir, "assets", "hero.png"),
      ALTERNATE_RESOLVED_PNG,
    );

    assertAssetIntegrityFailure(await captureRenderedEvidence({
      siteDir: fixture.siteDir,
      cycleDir: fixture.cycleDir,
      port: 4601,
    }));
  });

  await t.test("rejects manifest-matching PNG bytes with wrong dimensions", async () => {
    const fixture = await writeFixture({ move: "staged hero entrance" });
    const manifestPath = path.join(fixture.cycleDir, "assets.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    await writeFile(path.join(fixture.siteDir, "assets", "hero.png"), ONE_PIXEL_PNG);
    manifest.files[0].bytes = ONE_PIXEL_PNG.length;
    manifest.files[0].sha256 = sha256Hex(ONE_PIXEL_PNG);
    await writeFile(manifestPath, `${JSON.stringify(manifest)}\n`, "utf8");

    assertAssetIntegrityFailure(await captureRenderedEvidence({
      siteDir: fixture.siteDir,
      cycleDir: fixture.cycleDir,
      port: 4601,
    }));
  });

  await t.test("rejects build plan and asset summary disagreement", async () => {
    const fixture = await writeFixture({ move: "staged hero entrance" });
    const buildPath = path.join(fixture.cycleDir, "build.json");
    const build = JSON.parse(await readFile(buildPath, "utf8"));
    build.imagePlan[0].prompt = "A different prompt after materialization";
    build.assetSummary.successCount -= 1;
    await writeFile(buildPath, `${JSON.stringify(build)}\n`, "utf8");

    assertAssetIntegrityFailure(await captureRenderedEvidence({
      siteDir: fixture.siteDir,
      cycleDir: fixture.cycleDir,
      port: 4601,
    }));
  });

  await t.test("distinguishes a missing asset file from a missing manifest", async () => {
    const fixture = await writeFixture({
      move: "staged hero entrance",
      writeImage: false,
    });
    const evidence = await captureRenderedEvidence({
      siteDir: fixture.siteDir,
      cycleDir: fixture.cycleDir,
      port: 4601,
    });

    assert.equal(evidence.mechanical.assetManifestPresent, true);
    assert.ok(
      evidence.mechanical.failures.some(
        (failure) => failure.code === "assets-manifest-invalid",
      ),
    );
    assert.equal(
      evidence.mechanical.failures.some(
        (failure) => failure.code === "assets-manifest-missing",
      ),
      false,
    );
  });
});

test("linked evidence ancestry cannot receive a single output byte", async (t) => {
  await t.test("rejects a precreated cycle link", async () => {
    const fixture = await writeFixture({ move: "staged hero entrance" });
    const attackRun = path.join(process.cwd(), "tmp", randomUUID(), "run");
    const linkedCycle = path.join(attackRun, "cycle-01");
    await mkdir(attackRun, { recursive: true });
    await symlink(fixture.cycleDir, linkedCycle, linkDirectoryType());
    const before = (await readdir(fixture.cycleDir)).sort();

    let captureError;
    try {
      await captureRenderedEvidence({
        siteDir: path.join(linkedCycle, "site"),
        cycleDir: linkedCycle,
        port: 4601,
      });
    } catch (error) {
      captureError = error;
    }

    assert.deepEqual((await readdir(fixture.cycleDir)).sort(), before);
    assert.match(captureError?.message ?? "", /symlink|junction|linked path/i);
  });

  await t.test("rejects a precreated screenshots link", async () => {
    const fixture = await writeFixture({ move: "staged hero entrance" });
    const external = path.join(process.cwd(), "tmp", randomUUID(), "outside");
    await mkdir(external, { recursive: true });
    await symlink(external, path.join(fixture.cycleDir, "screenshots"), linkDirectoryType());

    let captureError;
    try {
      await captureRenderedEvidence({
        siteDir: fixture.siteDir,
        cycleDir: fixture.cycleDir,
        port: 4601,
      });
    } catch (error) {
      captureError = error;
    }

    assert.deepEqual(await readdir(external), []);
    assert.match(captureError?.message ?? "", /symlink|junction|linked path/i);
  });
});

test("partial and corrupt completed packets are rejected before recapture", async (t) => {
  for (const packet of ["partial", "corrupt"]) {
    await t.test(packet, async () => {
      const fixture = await writeFixture({ move: "staged hero entrance" });
      const screenshotsDir = path.join(fixture.cycleDir, "screenshots");
      await mkdir(screenshotsDir, { recursive: true });
      await writeFile(path.join(screenshotsDir, "desktop-home.png"), ONE_PIXEL_PNG);
      if (packet === "corrupt") {
        await Promise.all([
          writeFile(path.join(screenshotsDir, "tablet-home.png"), ONE_PIXEL_PNG),
          writeFile(path.join(screenshotsDir, "mobile-home.png"), ONE_PIXEL_PNG),
          writeFile(path.join(screenshotsDir, "manifest.json"), "{}\n", "utf8"),
          writeFile(path.join(fixture.cycleDir, "visible-text.txt"), "visible\n", "utf8"),
          writeFile(path.join(fixture.cycleDir, "mechanical.json"), "{}\n", "utf8"),
        ]);
      }

      await assert.rejects(
        captureRenderedEvidence({
          siteDir: fixture.siteDir,
          cycleDir: fixture.cycleDir,
          port: 4601,
          startServer: async () => {
            throw new Error("invalid packets must not be recaptured");
          },
        }),
        (error) => error?.code === "EVIDENCE_PACKET_INVALID",
      );
    });
  }
});

test("completed packets reject tampered full page bytes and critic manifest digests", async (t) => {
  for (const tamper of ["bytes", "digest"]) {
    await t.test(tamper, async () => {
      const fixture = await writeFixture({ move: "staged hero entrance" });
      const evidence = await captureRenderedEvidence({
        siteDir: fixture.siteDir,
        cycleDir: fixture.cycleDir,
        port: 4601,
      });
      if (tamper === "bytes") {
        const altered = Buffer.from(await readFile(evidence.fullPagePaths.desktop));
        altered[altered.length - 16] ^= 1;
        await writeFile(evidence.fullPagePaths.desktop, altered);
      } else {
        const manifestPath = path.join(
          fixture.cycleDir,
          "screenshots",
          "critic",
          "manifest.json",
        );
        const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
        manifest.viewports.desktop.sha256 = "0".repeat(64);
        await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
      }

      await assert.rejects(
        captureRenderedEvidence({
          siteDir: fixture.siteDir,
          cycleDir: fixture.cycleDir,
          port: 4601,
          startServer: async () => {
            throw new Error("tampered completed evidence must not be recaptured");
          },
        }),
        (error) => error?.code === "EVIDENCE_PACKET_INVALID",
      );
    });
  }
});

test("completed packets reject trailing bytes inside a CRC-valid IDAT with a matching manifest", async () => {
  const fixture = await writeFixture({ move: "staged hero entrance" });
  const evidence = await captureRenderedEvidence({
    siteDir: fixture.siteDir,
    cycleDir: fixture.cycleDir,
    port: 4601,
  });
  const screenshotPath = evidence.fullPagePaths.desktop;
  const malformed = appendToLastIdat(
    await readFile(screenshotPath),
    Buffer.from([0xde, 0xad, 0xbe, 0xef]),
  );
  await writeFile(screenshotPath, malformed);

  const manifestPath = path.join(
    fixture.cycleDir,
    "screenshots",
    "critic",
    "manifest.json",
  );
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  manifest.viewports.desktop.bytes = malformed.length;
  manifest.viewports.desktop.sha256 = sha256Hex(malformed);
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  await assert.rejects(
    captureRenderedEvidence({
      siteDir: fixture.siteDir,
      cycleDir: fixture.cycleDir,
      port: 4601,
      startServer: async () => {
        throw new Error("invalid completed evidence must not be recaptured");
      },
    }),
    (error) => error?.code === "EVIDENCE_PACKET_INVALID",
  );
});

test("completed critic packets cannot be transplanted onto another canonical capture", async () => {
  const source = await writeFixture({
    move: "staged hero entrance",
    extraStyles: "body { background: #efe4cf; }",
  });
  const target = await writeFixture({
    move: "staged hero entrance",
    extraStyles: "body { background: #173f45; }",
  });
  const sourceEvidence = await captureRenderedEvidence({
    siteDir: source.siteDir,
    cycleDir: source.cycleDir,
    port: 4601,
  });
  const targetEvidence = await captureRenderedEvidence({
    siteDir: target.siteDir,
    cycleDir: target.cycleDir,
    port: 4601,
  });
  const sourceManifestPath = path.join(
    source.cycleDir,
    "screenshots",
    "critic",
    "manifest.json",
  );
  const targetManifestPath = path.join(
    target.cycleDir,
    "screenshots",
    "critic",
    "manifest.json",
  );
  await Promise.all([
    writeFile(targetManifestPath, await readFile(sourceManifestPath)),
    ...["desktop", "tablet", "phone"].map(async (viewport) =>
      writeFile(
        targetEvidence.fullPagePaths[viewport],
        await readFile(sourceEvidence.fullPagePaths[viewport]),
      ),
    ),
  ]);

  await assert.rejects(
    captureRenderedEvidence({
      siteDir: target.siteDir,
      cycleDir: target.cycleDir,
      port: 4601,
      startServer: async () => {
        throw new Error("a transplanted evidence packet must not be recaptured");
      },
    }),
    (error) => error?.code === "EVIDENCE_PACKET_INVALID",
  );
});

test("fresh full page evidence beyond the height bound fails as capture unavailable", async () => {
  const fixture = await writeFixture({
    move: "staged hero entrance",
    extraStyles: "html, body, main { min-height: 13000px !important; }",
  });

  await assert.rejects(
    captureRenderedEvidence({
      siteDir: fixture.siteDir,
      cycleDir: fixture.cycleDir,
      port: 4601,
    }),
    (error) => error?.code === "CAPTURE_UNAVAILABLE",
  );
});

test("completed packets reject forged mechanics contexts totals failures and keys", async (t) => {
  const fixture = await writeFixture({ move: "staged hero entrance" });
  const evidence = await captureRenderedEvidence({
    siteDir: fixture.siteDir,
    cycleDir: fixture.cycleDir,
    port: 4601,
  });
  assert.equal(evidence.mechanical.passed, true, JSON.stringify(evidence.mechanical.failures));
  for (const modes of Object.values(evidence.mechanical.contexts)) {
    for (const context of Object.values(modes)) {
      assert.equal(context.passed, true);
      assert.deepEqual(context.failures, []);
      assert.deepEqual(context.totals, {
        contextCount: 1,
        externalRequestCount: context.network.externalRequestCount,
        requestFailureCount: context.network.requestFailureCount,
        consoleErrorCount: context.network.consoleErrorCount,
        pageErrorCount: context.network.pageErrorCount,
        brokenImageCount: context.base.brokenImageCount,
      });
    }
  }

  const mechanicalPath = path.join(fixture.cycleDir, "mechanical.json");
  const manifestPath = path.join(fixture.cycleDir, "screenshots", "manifest.json");
  const originalMechanical = JSON.parse(await readFile(mechanicalPath, "utf8"));
  const originalManifest = JSON.parse(await readFile(manifestPath, "utf8"));

  const cases = [
    {
      name: "forged empty matrix with zero totals and a pass verdict",
      mutate(mechanical, manifest) {
        mechanical.contexts = {};
        mechanical.failures = [];
        mechanical.passed = true;
        mechanical.totals = {
          contextCount: 0,
          externalRequestCount: 0,
          requestFailureCount: 0,
          consoleErrorCount: 0,
          pageErrorCount: 0,
          brokenImageCount: 0,
        };
        manifest.network = {
          externalRequestCount: 0,
          requestFailureCount: 0,
          consoleErrorCount: 0,
          pageErrorCount: 0,
        };
      },
    },
    {
      name: "tampered aggregate totals",
      mutate(mechanical) {
        mechanical.totals.contextCount += 1;
      },
    },
    {
      name: "tampered per context totals",
      mutate(mechanical) {
        mechanical.contexts.desktop.normal.totals.contextCount = 0;
      },
    },
    {
      name: "zeroed normal motion hidden behind a forged pass",
      mutate(mechanical) {
        Object.assign(mechanical.contexts.desktop.normal.motion, {
          foundRootCount: 0,
          activeRootCount: 0,
          progressChangedCount: 0,
          selectionChangedCount: 0,
          targetCount: 0,
          visibleTargetCount: 0,
          contractPassed: true,
        });
      },
    },
    {
      name: "tampered derived failures and verdict",
      mutate(mechanical) {
        mechanical.failures.push({ code: "forged-failure" });
        mechanical.passed = false;
      },
    },
    {
      name: "coherently tampered context and aggregate failures",
      mutate(mechanical) {
        const forgedFailure = {
          code: "h1-count",
          viewport: "desktop",
          mode: "normal",
          count: 0,
        };
        mechanical.contexts.desktop.normal.failures = [forgedFailure];
        mechanical.contexts.desktop.normal.passed = false;
        mechanical.failures = [forgedFailure];
        mechanical.passed = false;
      },
    },
    {
      name: "unexpected nested context key",
      mutate(mechanical) {
        mechanical.contexts.desktop.normal.base.unexpected = true;
      },
    },
  ];

  for (const packetCase of cases) {
    await t.test(packetCase.name, async () => {
      const mechanical = structuredClone(originalMechanical);
      const manifest = structuredClone(originalManifest);
      packetCase.mutate(mechanical, manifest);
      await Promise.all([
        writeFile(mechanicalPath, `${JSON.stringify(mechanical, null, 2)}\n`, "utf8"),
        writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8"),
      ]);

      await assert.rejects(
        captureRenderedEvidence({
          siteDir: fixture.siteDir,
          cycleDir: fixture.cycleDir,
          port: 4601,
          startServer: async () => {
            throw new Error("invalid completed packets must not be recaptured");
          },
        }),
        (error) => error?.code === "EVIDENCE_PACKET_INVALID",
      );
    });
  }
});

test("preview infrastructure failures are explicitly classified", async () => {
  const fixture = await writeFixture({ move: "staged hero entrance" });
  const unavailable = Object.assign(new Error("port unavailable"), { code: "EADDRINUSE" });
  await assert.rejects(
    captureRenderedEvidence({
      siteDir: fixture.siteDir,
      cycleDir: fixture.cycleDir,
      port: 4601,
      startServer: async () => {
        throw unavailable;
      },
    }),
    (error) => error?.code === "CAPTURE_UNAVAILABLE" && error.cause === unavailable,
  );

  const programmingFixture = await writeFixture({ move: "staged hero entrance" });
  const programmingError = new TypeError("fixture server contract is broken");
  await assert.rejects(
    captureRenderedEvidence({
      siteDir: programmingFixture.siteDir,
      cycleDir: programmingFixture.cycleDir,
      port: 4601,
      startServer: async () => {
        throw programmingError;
      },
    }),
    (error) => error === programmingError,
  );
});

test("no JavaScript counts roots per declared slug instead of by aggregate", async () => {
  const fixture = await writeFixture({
    move: "horizontal click reel",
    declaredMoves: ["horizontal click reel", "numbered story stepper"],
    duplicateRoot: true,
  });
  const evidence = await captureRenderedEvidence({
    siteDir: fixture.siteDir,
    cycleDir: fixture.cycleDir,
    port: 4601,
  });

  const failures = evidence.mechanical.failures.filter(
    (failure) =>
      failure.viewport === "desktop" &&
      failure.mode === "javascriptDisabled" &&
      failure.code === "motion-root-count",
  );
  assert.deepEqual(failures, [
    {
      code: "motion-root-count",
      subjectIndex: 0,
      count: 2,
      viewport: "desktop",
      mode: "javascriptDisabled",
    },
    {
      code: "motion-root-count",
      subjectIndex: 1,
      count: 0,
      viewport: "desktop",
      mode: "javascriptDisabled",
    },
  ]);
  assert.deepEqual(
    evidence.mechanical.contexts.desktop.normal.controls.roots.map(
      ({ slug, subjectIndex, rootCount }) => ({ slug, subjectIndex, rootCount }),
    ),
    [
      { slug: "horizontal-click-reel", subjectIndex: 0, rootCount: 2 },
      { slug: "numbered-story-stepper", subjectIndex: 1, rootCount: 0 },
    ],
  );
  assert.ok(
    evidence.mechanical.failures.some(
      (failure) =>
        failure.code === "motion-control-root-missing" &&
        failure.viewport === "desktop" &&
        failure.mode === "normal" &&
        failure.subjectIndex === 1,
    ),
  );
});

test("deterministic click focus keyboard and tap faults become mechanical failures", async () => {
  const fixture = await writeFixture({
    move: "horizontal click reel",
    disableSecondControl: true,
    malformedSecondControl: true,
  });
  const evidence = await captureRenderedEvidence({
    siteDir: fixture.siteDir,
    cycleDir: fixture.cycleDir,
    port: 4601,
  });

  assert.equal(evidence.mechanical.passed, false);
  const codes = new Set(evidence.mechanical.failures.map((failure) => failure.code));
  for (const code of [
    "motion-control-click",
    "motion-control-aria-link",
    "motion-control-focus",
    "motion-control-enter",
    "motion-control-space",
    "motion-control-tap",
  ]) {
    assert.ok(codes.has(code), code);
  }
});

test("browser negatives stay viewport and mode tagged without flagging same origin or unscoped touch", async () => {
  const fixture = await writeFixture({
    move: "staged hero entrance",
    disableCsp: true,
    extraMarkup: `
      <img src="http://127.0.0.1:9/external.png" alt="External probe">
      <button class="tiny-unscoped" type="button">Tiny</button>`,
    extraStyles: `
.tiny-unscoped { width: 10px; height: 10px; }
@media (prefers-reduced-motion: reduce) {
  html[data-js-ready] #hero [data-first-beat] { opacity: .2 !important; }
}
html:not([data-js-ready]) #hero [data-first-beat] { visibility: hidden !important; }`,
    runtimeSuffix: `
document.documentElement.dataset.jsReady = "true";
console.error("fixture console failure");
fetch("http://127.0.0.1:9/probe").catch(() => {});
fetch("/network-fail").catch(() => {});
setTimeout(() => { throw new Error("fixture page failure"); }, 0);`,
  });
  const evidence = await captureRenderedEvidence({
    siteDir: fixture.siteDir,
    cycleDir: fixture.cycleDir,
    port: 4601,
    startServer: startPermissiveFixtureServer,
  });

  const failures = evidence.mechanical.failures;
  for (const code of [
    "console-error",
    "page-error",
    "external-request",
    "request-failed",
  ]) {
    assert.ok(
      failures.some(
        (failure) =>
          failure.code === code &&
          failure.viewport === "desktop" &&
          failure.mode === "normal",
      ),
      `${code}: ${JSON.stringify(failures)}`,
    );
  }
  assert.ok(
    failures.some(
      (failure) =>
        failure.code === "first-beat-opacity" &&
        failure.viewport === "desktop" &&
        failure.mode === "reducedMotion",
    ),
  );
  assert.ok(
    failures.some(
      (failure) =>
        failure.code === "first-beat-hidden" &&
        failure.viewport === "desktop" &&
        failure.mode === "javascriptDisabled",
    ),
  );
  assert.equal(
    evidence.mechanical.contexts.tablet.normal.touchTargets.checkedCount,
    1,
  );
  assert.equal(
    failures.some((failure) => failure.code === "touch-target-too-small"),
    false,
  );
});

async function writeFixture({
  move,
  declaredMoves = [move],
  writeAssets = true,
  assetsResolved = true,
  writeImage = true,
  invalidLayout = false,
  disableRuntime = false,
  disableSecondControl = false,
  malformedSecondControl = false,
  duplicateRoot = false,
  assetManifestTransform = (manifest) => manifest,
  extraHead = "",
  extraMarkup = "",
  extraStyles = "",
  runtimeSuffix = "",
  allowExternalNetwork = false,
  disableCsp = false,
}) {
  const root = path.join(process.cwd(), "tmp", randomUUID());
  const cycleDir = path.join(root, "cycle-01");
  const siteDir = path.join(cycleDir, "site");
  await mkdir(path.join(siteDir, "assets"), { recursive: true });
  const plan = canonicalImagePlan();
  const buffers = Object.fromEntries(
    plan.map((item) => [
      item.filename,
      assetsResolved
        ? RESOLVED_PNG
        : createDeterministicPng({ ...item, shootDirection: SHOOT_DIRECTION }),
    ]),
  );
  const baseAssetManifest = canonicalAssetManifest({
    resolved: assetsResolved,
    plan,
    buffers,
  });

  const slug = MOTION_MOVE_SLUGS[move];
  const interactive =
    move === "horizontal click reel" || move === "numbered story stepper";
  const targetHook =
    move === "staged hero entrance" ||
    move === "gentle one direction scroll reveals"
      ? " data-motion-target"
      : "";
  const controls = interactive
    ? `
        <div class="controls">
          <button id="control-one" type="button" data-motion-control="one" aria-controls="panel-one">One</button>
          <button id="control-two" type="button" data-motion-control="two" aria-controls="${malformedSecondControl ? "missing-panel" : "panel-two"}"${disableSecondControl ? " disabled" : ""}>Two</button>
        </div>
        <div id="panel-one" data-motion-panel="one">First panel</div>
        <div id="panel-two" data-motion-panel="two">Second panel</div>`
    : "";

  const indexHtml = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  ${disableCsp ? "" : `<meta http-equiv="Content-Security-Policy" content="default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self'${allowExternalNetwork ? " http://127.0.0.1:9" : ""}; connect-src 'self'${allowExternalNetwork ? " http://127.0.0.1:9" : ""}; base-uri 'none'; form-action 'none'">`}
  <title>Rendered proof</title>
  <link rel="stylesheet" href="styles.css">
  <script src="script.js" defer></script>
  ${extraHead}
</head>
<body data-motion-moves="${slug}">
  <main>
    <section id="hero" data-section="hero" data-motion-root="${slug}">
      <div data-first-beat${targetHook}>
        <h1>Rendered proof</h1>
        <p>Every required state remains inspectable.</p>
        <a href="#details" data-primary-action>Read details</a>
        ${controls}
        <img src="assets/hero.png" alt="Hands arranging tools on a work surface">
      </div>
    </section>
    <section id="details" data-section="details">
      <div data-first-beat>
        <h2>Visible details</h2>
        <p>The last section can reach the first beat test position.</p>
      </div>
    </section>
    ${duplicateRoot ? `<section data-section="duplicate" data-motion-root="${slug}"><div data-first-beat><h2>Duplicate root</h2></div></section>` : ""}
    ${extraMarkup}
    ${invalidLayout ? '<div class="forced-overflow">Overflow</div>' : ""}
  </main>
</body>
</html>`;

  const fixtureCss = `
* { box-sizing: border-box; }
html, body { margin: 0; min-height: 100%; }
body { color: #151515; background: #f7f3ea; font-family: Georgia, serif; }
main { overflow: visible; }
section { min-height: 110vh; padding: 2rem; }
[data-motion-root="${slug}"] { min-height: ${move === "pinned chapter passage" ? "190vh" : "110vh"}; }
[data-primary-action], [data-motion-control] {
  display: inline-flex;
  min-width: ${invalidLayout ? "20px" : "48px"};
  min-height: ${invalidLayout ? "20px" : "48px"};
  align-items: center;
  justify-content: center;
  padding: .75rem 1rem;
}
[data-motion-panel] { min-height: 3rem; padding: 1rem; }
img { display: block; width: 1px; height: 1px; }
.forced-overflow { width: 1800px; }
${createOwnedMotionStyles(declaredMoves)}
${extraStyles}`;

  await Promise.all([
    writeFile(path.join(siteDir, "index.html"), indexHtml, { encoding: "utf8", flag: "wx" }),
    writeFile(path.join(siteDir, "styles.css"), fixtureCss, { encoding: "utf8", flag: "wx" }),
    writeFile(path.join(siteDir, "script.js"), `${disableRuntime ? "" : createOwnedMotionRuntime(declaredMoves)}${runtimeSuffix}`, {
      encoding: "utf8",
      flag: "wx",
    }),
    writeFile(
      path.join(cycleDir, "build.json"),
      `${JSON.stringify({
        cycle: 1,
        designNotes: {
          motionMoves: declaredMoves,
          shootDirection: SHOOT_DIRECTION,
        },
        imagePlan: plan,
        assetSummary: {
          allResolved: baseAssetManifest.allResolved,
          requestCount: baseAssetManifest.requestCount,
          successCount: baseAssetManifest.successCount,
          fallbackCount: baseAssetManifest.fallbackCount,
        },
      })}\n`,
      { encoding: "utf8", flag: "wx" },
    ),
  ]);
  if (writeImage) {
    await Promise.all(
      plan.map((item) =>
        writeFile(path.join(siteDir, "assets", item.filename), buffers[item.filename], { flag: "wx" }),
      ),
    );
  }
  if (writeAssets) {
    await writeFile(
      path.join(cycleDir, "assets.json"),
      `${JSON.stringify(assetManifestTransform(baseAssetManifest))}\n`,
      { encoding: "utf8", flag: "wx" },
    );
  }
  return { cycleDir, siteDir };
}

function canonicalImagePlan() {
  return ["hero.png", "detail-one.png", "detail-two.png"].map((filename) => ({
    filename,
    role: filename === "hero.png" ? "hero" : "detail",
    alt: `Rendered ${filename}`,
    prompt: `Photograph the planned ${filename} scene`,
    focalPoint: { x: 0.5, y: 0.5 },
  }));
}

function canonicalAssetManifest({ resolved, plan, buffers }) {
  const files = plan.map(
    (item) => ({
      filename: item.filename,
      path: `assets/${item.filename}`,
      role: item.role,
      alt: item.alt,
      focalPoint: { ...item.focalPoint },
      promptHash: sha256Hex(`${SHOOT_DIRECTION}\n\n${item.prompt}`),
      mediaType: "image/png",
      bytes: buffers[item.filename].length,
      sha256: sha256Hex(buffers[item.filename]),
      source: resolved ? "openai" : "deterministic-fallback",
      resolved,
      errorCode: resolved ? null : "IMAGE_REQUEST_FAILED",
    }),
  );
  return {
    schemaVersion: "1.0",
    allResolved: resolved,
    requestCount: files.length,
    successCount: resolved ? files.length : 0,
    fallbackCount: resolved ? 0 : files.length,
    files,
  };
}

function assertAssetIntegrityFailure(evidence) {
  assert.equal(evidence.assetsResolved, false);
  assert.equal(evidence.mechanical.passed, false);
  assert.ok(
    evidence.mechanical.failures.some(
      (failure) => failure.code === "assets-manifest-invalid",
    ),
    JSON.stringify(evidence.mechanical.failures),
  );
}

function linkDirectoryType() {
  return process.platform === "win32" ? "junction" : "dir";
}

async function startPermissiveFixtureServer({ root, port }) {
  const server = createServer(async (request, response) => {
    try {
      if (request.url === "/network-fail") {
        request.socket.destroy();
        return;
      }
      const requestPath = request.url === "/" ? "index.html" : request.url.slice(1);
      const body = await readFile(path.join(root, requestPath));
      response.statusCode = 200;
      if (requestPath.endsWith(".css")) response.setHeader("Content-Type", "text/css");
      if (requestPath.endsWith(".js")) {
        response.setHeader("Content-Type", "application/javascript");
      }
      if (requestPath.endsWith(".png")) response.setHeader("Content-Type", "image/png");
      response.end(body);
    } catch {
      response.statusCode = 404;
      response.end("Not found");
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  return {
    url: `http://127.0.0.1:${port}/`,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}
