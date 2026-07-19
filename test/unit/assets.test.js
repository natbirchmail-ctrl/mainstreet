import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rename, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { deflateSync } from "node:zlib";

import {
  MAX_IMAGE_REQUESTS_PER_CYCLE,
  createDeterministicPng,
  materializeAssets,
  sha256Hex,
  validatePngBuffer,
} from "../../src/assets.js";

function crc32(buffer) {
  let value = 0xffffffff;
  for (const byte of buffer) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit += 1) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  }
  return (value ^ 0xffffffff) >>> 0;
}

function chunk(type, data = Buffer.alloc(0)) {
  const typeBuffer = Buffer.from(type, "ascii");
  const result = Buffer.alloc(12 + data.length);
  result.writeUInt32BE(data.length, 0);
  typeBuffer.copy(result, 4);
  data.copy(result, 8);
  result.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 8 + data.length);
  return result;
}

function appendToLastIdat(image, trailing) {
  let offset = 8;
  let target = null;
  while (offset < image.length) {
    const length = image.readUInt32BE(offset);
    const end = offset + 12 + length;
    const type = image.subarray(offset + 4, offset + 8).toString("ascii");
    if (type === "IDAT") {
      target = { offset, end, data: image.subarray(offset + 8, offset + 8 + length) };
    }
    offset = end;
  }
  if (!target) throw new Error("fixture PNG has no IDAT chunk");
  return Buffer.concat([
    image.subarray(0, target.offset),
    chunk("IDAT", Buffer.concat([target.data, trailing])),
    image.subarray(target.end),
  ]);
}

function plan() {
  return [
    { filename: "hero.png", role: "hero", alt: "A storefront", prompt: "sunlit storefront", focalPoint: { x: 0.5, y: 0.4 } },
    { filename: "detail.png", role: "detail", alt: "A craft detail", prompt: "crafted detail", focalPoint: { x: 0.4, y: 0.5 } },
    { filename: "portrait.png", role: "portrait", alt: "A local owner", prompt: "local owner portrait", focalPoint: { x: 0.6, y: 0.5 } },
  ];
}

async function fixtureDirectories() {
  const root = await mkdtemp(path.join(os.tmpdir(), "mainstreet-assets-"));
  const cycleDir = path.join(root, "cycle-01");
  const siteDir = path.join(cycleDir, "site");
  await mkdir(siteDir, { recursive: true });
  return { root, cycleDir, siteDir };
}

test("validatePngBuffer accepts a deterministic RGB PNG and rejects mutations", () => {
  const image = createDeterministicPng(plan()[0], { width: 8, height: 6 });
  assert.equal(validatePngBuffer(image, { expectedWidth: 8, expectedHeight: 6 }), image);

  const mutations = [
    image.subarray(0, 7),
    Buffer.concat([image, Buffer.from([0])]),
    Buffer.from(image),
  ];
  mutations[2][mutations[2].length - 5] ^= 0xff;
  for (const candidate of mutations) {
    assert.throws(() => validatePngBuffer(candidate), /PNG validation failed\./);
  }
});

test("validatePngBuffer rejects a non alphabetic ancillary-looking chunk type", () => {
  const image = createDeterministicPng(plan()[0], { width: 8, height: 6 });
  const ihdrLength = image.readUInt32BE(8);
  const afterIhdr = 8 + 12 + ihdrLength;
  const malformed = Buffer.concat([image.subarray(0, afterIhdr), chunk("1abc"), image.subarray(afterIhdr)]);
  assert.throws(() => validatePngBuffer(malformed), /PNG validation failed\./);
});

test("validatePngBuffer bounds decompression to the known scanline payload", () => {
  const image = createDeterministicPng(plan()[0], { width: 8, height: 6 });
  const ihdrEnd = 8 + 12 + image.readUInt32BE(8);
  const oversizedIdat = chunk("IDAT", deflateSync(Buffer.alloc(2 * 1024 * 1024)));
  const iend = chunk("IEND");
  const compressedOversize = Buffer.concat([image.subarray(0, ihdrEnd), oversizedIdat, iend]);
  assert.throws(() => validatePngBuffer(compressedOversize), /PNG validation failed\./);
});

test("validatePngBuffer rejects trailing bytes inside a CRC-valid IDAT", () => {
  const image = createDeterministicPng(plan()[0], { width: 8, height: 6 });
  const malformed = appendToLastIdat(image, Buffer.from([0xde, 0xad, 0xbe, 0xef]));
  assert.throws(() => validatePngBuffer(malformed), /PNG validation failed\./);
});

test("validatePngBuffer rejects malformed IHDR dimensions and required chunks", () => {
  const image = createDeterministicPng(plan()[0], { width: 8, height: 6 });
  const ihdrEnd = 8 + 12 + image.readUInt32BE(8);
  const ihdr = Buffer.from(image.subarray(16, ihdrEnd - 4));
  const idatStart = ihdrEnd;
  const idatEnd = idatStart + 12 + image.readUInt32BE(idatStart);
  const idat = image.subarray(idatStart, idatEnd);
  const signature = image.subarray(0, 8);

  const zeroWidth = Buffer.from(ihdr);
  zeroWidth.writeUInt32BE(0, 0);
  const invalidHeight = Buffer.from(ihdr);
  invalidHeight.writeUInt32BE(0, 4);
  const malformed = [
    Buffer.concat([signature, chunk("IHDR", zeroWidth), idat, chunk("IEND")]),
    Buffer.concat([signature, chunk("IHDR", invalidHeight), idat, chunk("IEND")]),
    Buffer.concat([signature, chunk("IHDR", ihdr), chunk("IEND")]),
    Buffer.concat([signature, chunk("IHDR", ihdr), idat]),
  ];
  for (const candidate of malformed) {
    assert.throws(() => validatePngBuffer(candidate), /PNG validation failed\./);
  }
});

test("validatePngBuffer rejects chunk length overflow before reading chunk data", () => {
  const image = createDeterministicPng(plan()[0], { width: 8, height: 6 });
  const ihdrEnd = 8 + 12 + image.readUInt32BE(8);
  const overflow = Buffer.alloc(12);
  overflow.writeUInt32BE(0xffffffff, 0);
  overflow.write("IDAT", 4, "ascii");
  assert.throws(() => validatePngBuffer(Buffer.concat([image.subarray(0, ihdrEnd), overflow])), /PNG validation failed\./);
});

test("createDeterministicPng is stable, valid, and changes with the ordered plan tuple", () => {
  const first = createDeterministicPng(plan()[0], { width: 11, height: 7 });
  const same = createDeterministicPng(plan()[0], { width: 11, height: 7 });
  const changed = createDeterministicPng({ ...plan()[0], prompt: "different composition" }, { width: 11, height: 7 });
  assert.deepEqual(first, same);
  assert.notDeepEqual(first, changed);
  assert.equal(validatePngBuffer(first, { expectedWidth: 11, expectedHeight: 7 }), first);
});

test("materializeAssets writes sequential provider successes and one deterministic fallback with sanitized evidence", async () => {
  const { cycleDir, siteDir } = await fixtureDirectories();
  let active = 0;
  let peak = 0;
  let calls = 0;
  const result = await materializeAssets({
    cycleDir,
    siteDir,
    plan: plan(),
    shootDirection: "Warm daylight with honest materials.",
    requestImage: async ({ prompt }) => {
      active += 1;
      peak = Math.max(peak, active);
      calls += 1;
      active -= 1;
      if (calls === 2) throw new Error(`provider response for ${prompt}`);
      return createDeterministicPng({ ...plan()[calls - 1], prompt }, { width: 1536, height: 1024 });
    },
  });

  assert.equal(MAX_IMAGE_REQUESTS_PER_CYCLE, 5);
  assert.equal(peak, 1);
  assert.equal(calls, 3);
  assert.deepEqual(
    { requestCount: result.requestCount, successCount: result.successCount, fallbackCount: result.fallbackCount, allResolved: result.allResolved },
    { requestCount: 3, successCount: 2, fallbackCount: 1, allResolved: false },
  );
  assert.equal(result.files[1].source, "deterministic-fallback");
  assert.equal(result.files[1].resolved, false);
  assert.equal(result.files[1].errorCode, "IMAGE_REQUEST_FAILED");
  assert.equal(JSON.stringify(result).includes("provider response"), false);
  for (const file of result.files) {
    const bytes = await readFile(path.join(siteDir, file.path));
    assert.equal(file.bytes, bytes.length);
    assert.equal(file.sha256, sha256Hex(bytes));
    validatePngBuffer(bytes, { expectedWidth: 1536, expectedHeight: 1024 });
  }
  assert.deepEqual(JSON.parse(await readFile(path.join(cycleDir, "assets.json"), "utf8")), result);
  await assert.rejects(readFile(path.join(cycleDir, "assets.json.pending")));
});

test("materializeAssets rejects over-limit plans before any request or write", async () => {
  const { cycleDir, siteDir } = await fixtureDirectories();
  const tooMany = [...plan(), { filename: "four.png", role: "detail", alt: "Four", prompt: "four", focalPoint: { x: 0.5, y: 0.5 } }, { filename: "five.png", role: "detail", alt: "Five", prompt: "five", focalPoint: { x: 0.5, y: 0.5 } }, { filename: "six.png", role: "detail", alt: "Six", prompt: "six", focalPoint: { x: 0.5, y: 0.5 } }];
  let calls = 0;
  await assert.rejects(materializeAssets({ cycleDir, siteDir, plan: tooMany, shootDirection: "Direction", requestImage: async () => { calls += 1; } }));
  assert.equal(calls, 0);
  await assert.rejects(readFile(path.join(cycleDir, "assets.json")));
});

test("materializeAssets preserves existing evidence through exclusive writes", async () => {
  const { cycleDir, siteDir } = await fixtureDirectories();
  await writeFile(path.join(cycleDir, "assets.json"), "preserve", "utf8");
  let requests = 0;
  await assert.rejects(materializeAssets({ cycleDir, siteDir, plan: plan(), shootDirection: "Direction", requestImage: async () => { requests += 1; return createDeterministicPng(plan()[0]); } }), /already exists/i);
  assert.equal(requests, 0);
  assert.equal(await readFile(path.join(cycleDir, "assets.json"), "utf8"), "preserve");
  await assert.rejects(readFile(path.join(siteDir, "assets", "hero.png")));
});

test("materializeAssets treats a pending evidence reservation as occupied before requests", async () => {
  const { cycleDir, siteDir } = await fixtureDirectories();
  await writeFile(path.join(cycleDir, "assets.json.pending"), "pending", "utf8");
  let requests = 0;
  await assert.rejects(
    materializeAssets({ cycleDir, siteDir, plan: plan(), shootDirection: "Direction", requestImage: async () => { requests += 1; } }),
    /already exists/i,
  );
  assert.equal(requests, 0);
  assert.equal(await readFile(path.join(cycleDir, "assets.json.pending"), "utf8"), "pending");
  await assert.rejects(readFile(path.join(cycleDir, "assets.json")));
});

test("materializeAssets leaves only immutable pending evidence after a later asset write failure", async () => {
  const { cycleDir, siteDir } = await fixtureDirectories();
  await mkdir(path.join(siteDir, "assets"), { recursive: true });
  await writeFile(path.join(siteDir, "assets", "hero.png"), "preserve", "utf8");
  let requests = 0;
  await assert.rejects(
    materializeAssets({
      cycleDir,
      siteDir,
      plan: plan(),
      shootDirection: "Direction",
      requestImage: async ({ prompt }) => {
        requests += 1;
        return createDeterministicPng({ ...plan()[0], prompt });
      },
    }),
    /already exists/i,
  );
  assert.equal(requests, 1);
  await assert.rejects(readFile(path.join(cycleDir, "assets.json")));
  assert.equal(await readFile(path.join(cycleDir, "assets.json.pending"), "utf8"), "");
  assert.equal(await readFile(path.join(siteDir, "assets", "hero.png"), "utf8"), "preserve");
});

test("materializeAssets rejects site and prior asset symlinks before asset access", async (t) => {
  const external = await mkdtemp(path.join(os.tmpdir(), "mainstreet-assets-external-"));
  const current = await fixtureDirectories();
  try {
    await symlink(external, path.join(current.siteDir, "assets"), "junction");
  } catch (error) {
    if (["EPERM", "EACCES", "ENOTSUP"].includes(error?.code)) {
      t.skip("symlink creation is unavailable on this Windows host");
      return;
    }
    throw error;
  }
  let requests = 0;
  await assert.rejects(materializeAssets({ cycleDir: current.cycleDir, siteDir: current.siteDir, plan: plan(), shootDirection: "Direction", requestImage: async () => { requests += 1; } }), /symlink/i);
  assert.equal(requests, 0);

  const prior = await fixtureDirectories();
  const priorEvidence = await materializeAssets({
    cycleDir: prior.cycleDir,
    siteDir: prior.siteDir,
    plan: plan(),
    shootDirection: "Direction",
    requestImage: async ({ prompt }) => createDeterministicPng({ ...plan().find((item) => prompt.endsWith(item.prompt)), prompt }),
  });
  const linkedTarget = path.join(external, "prior.png");
  await rename(path.join(prior.siteDir, "assets", "hero.png"), linkedTarget);
  try {
    await symlink(linkedTarget, path.join(prior.siteDir, "assets", "hero.png"), "file");
  } catch (error) {
    if (["EPERM", "EACCES", "ENOTSUP"].includes(error?.code)) {
      t.skip("file symlink creation is unavailable on this Windows host");
      return;
    }
    throw error;
  }
  const next = await fixtureDirectories();
  await assert.rejects(
    materializeAssets({
      cycleDir: next.cycleDir,
      siteDir: next.siteDir,
      plan: plan(),
      shootDirection: "Direction",
      priorAssets: priorEvidence,
      priorSiteDir: prior.siteDir,
      requestImage: async () => { throw new Error("must not request"); },
    }),
    /symlink/i,
  );
});

test("materializeAssets rejects cycle and site junction ancestors before any write", async (t) => {
  const cases = [
    {
      name: "cycle-01",
      arrange: async () => {
        const runRoot = await mkdtemp(path.join(os.tmpdir(), "mainstreet-run-root-"));
        const external = await mkdtemp(path.join(os.tmpdir(), "mainstreet-cycle-junction-"));
        await mkdir(path.join(external, "site"), { recursive: true });
        const cycleDir = path.join(runRoot, "cycle-01");
        await symlink(external, cycleDir, "junction");
        return { cycleDir, siteDir: path.join(cycleDir, "site"), external };
      },
    },
    {
      name: "cycle-02/site",
      arrange: async () => {
        const runRoot = await mkdtemp(path.join(os.tmpdir(), "mainstreet-run-root-"));
        const cycleDir = path.join(runRoot, "cycle-02");
        const external = await mkdtemp(path.join(os.tmpdir(), "mainstreet-site-junction-"));
        await mkdir(cycleDir, { recursive: true });
        const siteDir = path.join(cycleDir, "site");
        await symlink(external, siteDir, "junction");
        return { cycleDir, siteDir, external };
      },
    },
  ];

  for (const scenario of cases) {
    await t.test(scenario.name, async (subtest) => {
      let fixture;
      try {
        fixture = await scenario.arrange();
      } catch (error) {
        if (["EPERM", "EACCES", "ENOTSUP"].includes(error?.code)) {
          subtest.skip("junction creation is unavailable on this Windows host");
          return;
        }
        throw error;
      }
      let requests = 0;
      await assert.rejects(
        materializeAssets({
          cycleDir: fixture.cycleDir,
          siteDir: fixture.siteDir,
          plan: plan(),
          shootDirection: "Direction",
          requestImage: async () => { requests += 1; },
        }),
        /symlink|junction|linked path/i,
      );
      assert.equal(requests, 0);
      await assert.rejects(readFile(path.join(fixture.cycleDir, "assets.json.pending")));
      await assert.rejects(readFile(path.join(fixture.external, "assets.json.pending")));
    });
  }
});

test("materializeAssets rejects a prior site root junction before reading assets", async (t) => {
  const previous = await fixtureDirectories();
  const prior = await materializeAssets({
    cycleDir: previous.cycleDir,
    siteDir: previous.siteDir,
    plan: plan(),
    shootDirection: "Direction",
    requestImage: async ({ prompt }) => createDeterministicPng({ ...plan().find((item) => prompt.endsWith(item.prompt)), prompt }),
  });
  const linkedRunRoot = await mkdtemp(path.join(os.tmpdir(), "mainstreet-prior-root-"));
  const linkedCycle = path.join(linkedRunRoot, "cycle-01");
  await mkdir(linkedCycle, { recursive: true });
  const priorSiteDir = path.join(linkedCycle, "site");
  try {
    await symlink(previous.siteDir, priorSiteDir, "junction");
  } catch (error) {
    if (["EPERM", "EACCES", "ENOTSUP"].includes(error?.code)) {
      t.skip("junction creation is unavailable on this Windows host");
      return;
    }
    throw error;
  }
  const next = await fixtureDirectories();
  let requests = 0;
  await assert.rejects(
    materializeAssets({
      cycleDir: next.cycleDir,
      siteDir: next.siteDir,
      plan: plan(),
      shootDirection: "Direction",
      priorAssets: prior,
      priorSiteDir,
      requestImage: async () => { requests += 1; },
    }),
    /symlink|junction|linked path/i,
  );
  assert.equal(requests, 0);
  await assert.rejects(readFile(path.join(next.cycleDir, "assets.json.pending")));
});

test("materializeAssets strictly rejects malformed or laundered prior evidence before writes", async (t) => {
  const previous = await fixtureDirectories();
  const prior = await materializeAssets({
    cycleDir: previous.cycleDir,
    siteDir: previous.siteDir,
    plan: plan(),
    shootDirection: "Direction",
    requestImage: async ({ prompt }) => createDeterministicPng({ ...plan().find((item) => prompt.endsWith(item.prompt)), prompt }),
  });
  const cases = [
    ["missing schema", (evidence) => { delete evidence.schemaVersion; }],
    ["wrong request count", (evidence) => { evidence.requestCount += 1; }],
    ["wrong allResolved", (evidence) => { evidence.allResolved = false; }],
    ["duplicate filename", (evidence) => { evidence.files[1] = { ...evidence.files[1], filename: evidence.files[0].filename, path: evidence.files[0].path }; }],
    ["unsafe filename", (evidence) => { evidence.files[0].filename = "../hero.png"; }],
    ["missing record field", (evidence) => { delete evidence.files[0].mediaType; }],
    ["plan metadata mismatch", (evidence) => { evidence.files[0].role = "laundered-role"; }],
    ["resolved fallback laundering", (evidence) => {
      evidence.files[0] = { ...evidence.files[0], source: "deterministic-fallback", resolved: true, errorCode: null };
      evidence.successCount = 2;
      evidence.fallbackCount = 1;
    }],
  ];

  for (const [name, mutate] of cases) {
    await t.test(name, async () => {
      const next = await fixtureDirectories();
      const malformed = structuredClone(prior);
      mutate(malformed);
      let requests = 0;
      await assert.rejects(
        materializeAssets({
          cycleDir: next.cycleDir,
          siteDir: next.siteDir,
          plan: plan(),
          shootDirection: "Direction",
          priorAssets: malformed,
          priorSiteDir: previous.siteDir,
          requestImage: async () => { requests += 1; },
        }),
        /prior asset evidence/i,
      );
      assert.equal(requests, 0);
      await assert.rejects(readFile(path.join(next.cycleDir, "assets.json.pending")));
    });
  }
});

test("materializeAssets rejects deterministic fallback bytes relabeled as resolved provenance", async (t) => {
  const previous = await fixtureDirectories();
  let priorRequests = 0;
  const prior = await materializeAssets({
    cycleDir: previous.cycleDir,
    siteDir: previous.siteDir,
    plan: plan(),
    shootDirection: "Direction",
    requestImage: async ({ prompt }) => {
      priorRequests += 1;
      const item = plan().find((candidate) => prompt.endsWith(candidate.prompt));
      if (item.filename === plan()[0].filename) throw new Error("force deterministic fallback");
      return createDeterministicPng({ ...item, prompt });
    },
  });
  assert.equal(priorRequests, 3);
  assert.equal(prior.files[0].source, "deterministic-fallback");

  const cases = [
    ["openai", { requestCount: 3, successCount: 3 }],
    ["carried-forward", { requestCount: 2, successCount: 2 }],
  ];
  for (const [source, counts] of cases) {
    await t.test(source, async () => {
      const relabeled = structuredClone(prior);
      relabeled.files[0] = {
        ...relabeled.files[0],
        source,
        resolved: true,
        errorCode: null,
      };
      relabeled.allResolved = true;
      relabeled.requestCount = counts.requestCount;
      relabeled.successCount = counts.successCount;
      relabeled.fallbackCount = 0;
      const next = await fixtureDirectories();
      let requests = 0;
      await assert.rejects(
        materializeAssets({
          cycleDir: next.cycleDir,
          siteDir: next.siteDir,
          plan: plan(),
          shootDirection: "Direction",
          priorAssets: relabeled,
          priorSiteDir: previous.siteDir,
          requestImage: async () => { requests += 1; throw new Error("must not request"); },
        }),
        /prior asset evidence/i,
      );
      assert.equal(requests, 0);
      await assert.rejects(readFile(path.join(next.cycleDir, "assets.json.pending")), { code: "ENOENT" });
    });
  }
});

test("materializeAssets requires the exact safe plan item shape before writes", async () => {
  const current = await fixtureDirectories();
  const malformedPlan = plan();
  malformedPlan[0] = { ...malformedPlan[0], providerHint: "forbidden" };
  let requests = 0;
  await assert.rejects(
    materializeAssets({ cycleDir: current.cycleDir, siteDir: current.siteDir, plan: malformedPlan, shootDirection: "Direction", requestImage: async () => { requests += 1; } }),
    /asset plan/i,
  );
  assert.equal(requests, 0);
  await assert.rejects(readFile(path.join(current.cycleDir, "assets.json.pending")));
});

test("materializeAssets carries verified resolved assets forward and retries unresolved assets", async () => {
  const previous = await fixtureDirectories();
  const prior = await materializeAssets({
    cycleDir: previous.cycleDir,
    siteDir: previous.siteDir,
    plan: plan(),
    shootDirection: "Direction",
    requestImage: async ({ prompt }) => createDeterministicPng({ ...plan().find((item) => prompt.endsWith(item.prompt)), prompt }, { width: 1536, height: 1024 }),
  });
  prior.files[1] = { ...prior.files[1], resolved: false, source: "deterministic-fallback", errorCode: "IMAGE_REQUEST_FAILED" };
  prior.allResolved = false;
  prior.successCount = 2;
  prior.fallbackCount = 1;
  const next = await fixtureDirectories();
  let requests = 0;
  const result = await materializeAssets({
    cycleDir: next.cycleDir,
    siteDir: next.siteDir,
    plan: plan(),
    shootDirection: "Direction",
    priorAssets: prior,
    priorSiteDir: previous.siteDir,
    requestImage: async ({ prompt }) => {
      requests += 1;
      return createDeterministicPng({ ...plan().find((item) => prompt.endsWith(item.prompt)), prompt }, { width: 1536, height: 1024 });
    },
  });
  assert.equal(requests, 1);
  assert.equal(result.files[0].source, "carried-forward");
  assert.equal(result.files[1].source, "openai");
  assert.deepEqual(await readFile(path.join(previous.siteDir, "assets", "hero.png")), await readFile(path.join(next.siteDir, "assets", "hero.png")));

  const third = await fixtureDirectories();
  let repeatedCarryRequests = 0;
  const carriedAgain = await materializeAssets({
    cycleDir: third.cycleDir,
    siteDir: third.siteDir,
    plan: plan(),
    shootDirection: "Direction",
    priorAssets: result,
    priorSiteDir: next.siteDir,
    requestImage: async () => { repeatedCarryRequests += 1; throw new Error("must not request"); },
  });
  assert.equal(repeatedCarryRequests, 0);
  assert.deepEqual(carriedAgain.files.map((file) => file.source), ["carried-forward", "carried-forward", "carried-forward"]);
});

test("materializeAssets fails closed when a prior resolved digest does not match", async () => {
  const previous = await fixtureDirectories();
  const prior = await materializeAssets({ cycleDir: previous.cycleDir, siteDir: previous.siteDir, plan: plan(), shootDirection: "Direction", requestImage: async ({ prompt }) => createDeterministicPng({ ...plan().find((item) => prompt.endsWith(item.prompt)), prompt }) });
  await writeFile(path.join(previous.siteDir, "assets", "hero.png"), Buffer.from("changed"));
  const next = await fixtureDirectories();
  await assert.rejects(materializeAssets({ cycleDir: next.cycleDir, siteDir: next.siteDir, plan: plan(), shootDirection: "Direction", priorAssets: prior, priorSiteDir: previous.siteDir, requestImage: async () => { throw new Error("must not request"); } }), /prior asset/i);
});
