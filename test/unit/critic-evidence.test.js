import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import test from "node:test";

import {
  EVIDENCE_VIEWPORTS,
  captureRenderedEvidence,
} from "../../src/critic-evidence.js";
import {
  MOTION_MOVE_SLUGS,
  createOwnedMotionRuntime,
  createOwnedMotionStyles,
} from "../../src/motion.js";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

const MOTION_MOVES = Object.keys(MOTION_MOVE_SLUGS);

test("rendered evidence publishes the fixed viewport contract", () => {
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

      const stored = [
        await readFile(path.join(fixture.cycleDir, "mechanical.json"), "utf8"),
        await readFile(path.join(fixture.cycleDir, "screenshots", "manifest.json"), "utf8"),
      ].join("\n");
      assert.doesNotMatch(stored, /https?:\/\//i);
      assert.doesNotMatch(stored, /[A-Z]:\\/i);
      assert.match(
        await readFile(path.join(fixture.cycleDir, "visible-text.txt"), "utf8"),
        /Rendered proof/,
      );

      await assert.rejects(
        captureRenderedEvidence({
          siteDir: fixture.siteDir,
          cycleDir: fixture.cycleDir,
          port: 4601,
        }),
        /already exists/i,
      );
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
  for (const failure of evidence.mechanical.failures) {
    assert.deepEqual(
      Object.keys(failure).every((key) =>
        ["code", "viewport", "mode", "subjectIndex", "count"].includes(key),
      ),
      true,
    );
  }
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
        designNotes: { motionMoves: declaredMoves },
      })}\n`,
      { encoding: "utf8", flag: "wx" },
    ),
  ]);
  if (writeImage) {
    await Promise.all(
      ["hero.png", "detail-one.png", "detail-two.png"].map((filename) =>
        writeFile(path.join(siteDir, "assets", filename), PNG, { flag: "wx" }),
      ),
    );
  }
  if (writeAssets) {
    const manifest = canonicalAssetManifest({ resolved: assetsResolved });
    await writeFile(
      path.join(cycleDir, "assets.json"),
      `${JSON.stringify(assetManifestTransform(manifest))}\n`,
      { encoding: "utf8", flag: "wx" },
    );
  }
  return { cycleDir, siteDir };
}

function canonicalAssetManifest({ resolved }) {
  const files = ["hero.png", "detail-one.png", "detail-two.png"].map(
    (filename) => ({
      filename,
      path: `assets/${filename}`,
      role: filename === "hero.png" ? "hero" : "detail",
      alt: `Rendered ${filename}`,
      focalPoint: { x: 0.5, y: 0.5 },
      promptHash: createHash("sha256").update(`prompt:${filename}`).digest("hex"),
      mediaType: "image/png",
      bytes: PNG.length,
      sha256: createHash("sha256").update(PNG).digest("hex"),
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
