import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
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
  await mkdir(path.join(prior.siteDir, "assets"), { recursive: true });
  const linkedTarget = path.join(external, "prior.png");
  await writeFile(linkedTarget, "not-an-image", "utf8");
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
      priorAssets: { files: [{ filename: "hero.png", promptHash: sha256Hex("Direction\n\nsunlit storefront"), sha256: "0".repeat(64), bytes: 1, resolved: true }] },
      priorSiteDir: prior.siteDir,
      requestImage: async () => { throw new Error("must not request"); },
    }),
    /symlink/i,
  );
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
});

test("materializeAssets fails closed when a prior resolved digest does not match", async () => {
  const previous = await fixtureDirectories();
  const prior = await materializeAssets({ cycleDir: previous.cycleDir, siteDir: previous.siteDir, plan: plan(), shootDirection: "Direction", requestImage: async ({ prompt }) => createDeterministicPng({ ...plan().find((item) => prompt.endsWith(item.prompt)), prompt }) });
  await writeFile(path.join(previous.siteDir, "assets", "hero.png"), Buffer.from("changed"));
  const next = await fixtureDirectories();
  await assert.rejects(materializeAssets({ cycleDir: next.cycleDir, siteDir: next.siteDir, plan: plan(), shootDirection: "Direction", priorAssets: prior, priorSiteDir: previous.siteDir, requestImage: async () => { throw new Error("must not request"); } }), /prior asset/i);
});
