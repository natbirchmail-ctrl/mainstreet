import { createHash } from "node:crypto";
import { lstat, mkdir, open, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { deflateSync } from "node:zlib";

import { requestImage as requestOpenAIImage } from "./lib/openai.js";
import { validatePngBuffer } from "./lib/png.js";
import { resolveInside } from "./lib/runs.js";

export { PngValidationError, validatePngBuffer } from "./lib/png.js";

export const MAX_IMAGE_REQUESTS_PER_CYCLE = 5;
const MAX_PNG_DIMENSION = 4096;
const PNG_SIGNATURE = Buffer.from("89504e470d0a1a0a", "hex");
const SAFE_FILENAME = /^[a-z0-9]+(?:-[a-z0-9]+)*\.png$/;
const PLAN_ITEM_FIELDS = ["filename", "role", "alt", "prompt", "focalPoint"];
const EVIDENCE_FIELDS = ["schemaVersion", "allResolved", "requestCount", "successCount", "fallbackCount", "files"];
const EVIDENCE_FILE_FIELDS = ["filename", "path", "role", "alt", "focalPoint", "promptHash", "mediaType", "bytes", "sha256", "source", "resolved", "errorCode"];

export function sha256Hex(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function createDeterministicPng(planItem, { width = 1536, height = 1024 } = {}) {
  assertDimensions(width, height);
  const digest = Buffer.from(sha256Hex(JSON.stringify(planTuple(planItem))), "hex");
  const rowLength = 1 + width * 3;
  const raw = Buffer.alloc(rowLength * height);
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * rowLength;
    raw[rowStart] = 0;
    for (let x = 0; x < width; x += 1) {
      const pixel = rowStart + 1 + x * 3;
      raw[pixel] = (digest[(x + y) % digest.length] + x) & 0xff;
      raw[pixel + 1] = (digest[(x * 3 + y * 5) % digest.length] + y) & 0xff;
      raw[pixel + 2] = digest[(x + y * 7) % digest.length];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const png = Buffer.concat([
    PNG_SIGNATURE,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
  return validatePngBuffer(png, { expectedWidth: width, expectedHeight: height });
}

export async function materializeAssets({
  cycleDir,
  siteDir,
  plan,
  shootDirection,
  client,
  model,
  requestImage = requestOpenAIImage,
  priorAssets,
  priorSiteDir,
} = {}) {
  const paths = validateMaterializationInput({ cycleDir, siteDir, plan, shootDirection, requestImage, priorAssets, priorSiteDir });
  if (priorAssets) validatePriorAssetEvidence(priorAssets, plan, shootDirection);
  await assertNoLinkedPath(paths.runRoot, paths.cycleDir);
  await assertNoLinkedPath(paths.runRoot, paths.siteDir);
  await assertNoLinkedPath(paths.runRoot, resolveInside(paths.siteDir, "assets"));
  if (paths.priorRunRoot) {
    await assertNoLinkedPath(paths.priorRunRoot, paths.priorSiteDir);
    await assertNoLinkedPath(paths.priorRunRoot, resolveInside(paths.priorSiteDir, "assets"));
  }
  let evidenceReservation;
  try {
    evidenceReservation = await reserveAssetEvidence(paths.cycleDir, paths.runRoot);
    const priorByFilename = new Map((priorAssets?.files ?? []).map((record) => [record.filename, record]));
    const files = [];
    let requestCount = 0;
    let successCount = 0;
    let fallbackCount = 0;

    for (const item of plan) {
      const requestPrompt = `${shootDirection}\n\n${item.prompt}`;
      const promptHash = sha256Hex(requestPrompt);
      const prior = priorByFilename.get(item.filename);
      const carried = await carryForwardIfEligible({ prior, priorSiteDir: paths.priorSiteDir, priorRunRoot: paths.priorRunRoot, item, promptHash });
      let buffer;
      let source;
      let resolved;
      let errorCode = null;

      if (carried) {
        buffer = carried;
        source = "carried-forward";
        resolved = true;
      } else {
        requestCount += 1;
        try {
          buffer = await requestImage({ client, model, prompt: requestPrompt });
          buffer = validatePngBuffer(buffer, { expectedWidth: 1536, expectedHeight: 1024 });
          source = "openai";
          resolved = true;
          successCount += 1;
        } catch {
          buffer = createDeterministicPng({ ...item, shootDirection });
          source = "deterministic-fallback";
          resolved = false;
          errorCode = "IMAGE_REQUEST_FAILED";
          fallbackCount += 1;
        }
      }

      const assetPath = resolveInside(paths.siteDir, "assets", item.filename);
      await writeBufferNew(assetPath, buffer, paths.runRoot);
      files.push({
        filename: item.filename,
        path: `assets/${item.filename}`,
        role: item.role,
        alt: item.alt,
        focalPoint: { x: item.focalPoint.x, y: item.focalPoint.y },
        promptHash,
        mediaType: "image/png",
        bytes: buffer.length,
        sha256: sha256Hex(buffer),
        source,
        resolved,
        errorCode,
      });
    }

    const evidence = {
      schemaVersion: "1.0",
      allResolved: files.every((file) => file.resolved),
      requestCount,
      successCount,
      fallbackCount,
      files,
    };
    await evidenceReservation.handle.writeFile(`${JSON.stringify(evidence, null, 2)}\n`, "utf8");
    await evidenceReservation.handle.close();
    evidenceReservation.handle = null;
    await assertNoLinkedPath(paths.runRoot, paths.cycleDir);
    await assertEvidenceAbsent(evidenceReservation.finalPath);
    await rename(evidenceReservation.pendingPath, evidenceReservation.finalPath);
    return evidence;
  } finally {
    await evidenceReservation?.handle?.close();
  }
}

async function carryForwardIfEligible({ prior, priorSiteDir, priorRunRoot, item, promptHash }) {
  if (!prior || prior.filename !== item.filename || prior.promptHash !== promptHash || prior.resolved !== true) return null;
  if (!priorSiteDir) throw new Error("Prior asset directory is required.");
  if (!/^[a-f0-9]{64}$/.test(prior.sha256 ?? "") || !Number.isInteger(prior.bytes) || prior.bytes < 1) {
    throw new Error("Prior asset evidence is invalid.");
  }
  const priorAssetPath = resolveInside(priorSiteDir, "assets", item.filename);
  await assertNoLinkedPath(priorRunRoot, priorAssetPath);
  const bytes = await readFile(priorAssetPath);
  if (bytes.length !== prior.bytes || sha256Hex(bytes) !== prior.sha256) {
    throw new Error("Prior asset digest does not match.");
  }
  validatePngBuffer(bytes, { expectedWidth: 1536, expectedHeight: 1024 });
  return bytes;
}

async function writeBufferNew(target, bytes, runRoot) {
  await assertNoLinkedPath(runRoot, target);
  await mkdir(path.dirname(target), { recursive: true });
  await assertNoLinkedPath(runRoot, target);
  try {
    await writeFile(target, bytes, { flag: "wx" });
  } catch (error) {
    if (error?.code === "EEXIST") throw new Error(`Asset file already exists: ${target}`);
    throw error;
  }
}

async function reserveAssetEvidence(cycleDir, runRoot) {
  const finalPath = resolveInside(cycleDir, "assets.json");
  const pendingPath = resolveInside(cycleDir, "assets.json.pending");
  await assertNoLinkedPath(runRoot, cycleDir);
  await mkdir(path.dirname(finalPath), { recursive: true });
  await assertNoLinkedPath(runRoot, cycleDir);
  await assertEvidenceAbsent(finalPath);
  await assertEvidenceAbsent(pendingPath);
  let handle;
  try {
    handle = await open(pendingPath, "wx");
  } catch (error) {
    if (error?.code === "EEXIST") throw new Error(`Evidence file already exists: ${pendingPath}`);
    throw error;
  }
  try {
    await assertEvidenceAbsent(finalPath);
  } catch (error) {
    await handle.close();
    throw error;
  }
  return { handle, pendingPath, finalPath };
}

async function assertEvidenceAbsent(target) {
  try {
    await lstat(target);
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
  throw new Error(`Evidence file already exists: ${target}`);
}

function validateMaterializationInput({ cycleDir, siteDir, plan, shootDirection, requestImage, priorAssets, priorSiteDir }) {
  if (!cycleDir || !siteDir || !shootDirection?.trim() || typeof requestImage !== "function") throw new TypeError("Invalid asset materialization input.");
  if (!Array.isArray(plan) || plan.length < 3 || plan.length > MAX_IMAGE_REQUESTS_PER_CYCLE) throw new TypeError("Asset plan must contain three to five items.");
  if ((priorAssets && !priorSiteDir) || (!priorAssets && priorSiteDir)) throw new TypeError("Prior assets and site directory must be supplied together.");
  const normalizedCycleDir = path.resolve(cycleDir);
  const runRoot = path.dirname(normalizedCycleDir);
  const normalizedSiteDir = path.resolve(siteDir);
  if (!/^cycle-\d{2}$/.test(path.basename(normalizedCycleDir)) || normalizedSiteDir !== path.join(normalizedCycleDir, "site")) {
    throw new TypeError("Asset paths must use one cycle directory and its site child.");
  }
  const filenames = new Set();
  for (const item of plan) {
    if (!isPlainObject(item) || !hasExactKeys(item, PLAN_ITEM_FIELDS) || !isPlainObject(item.focalPoint) || !hasExactKeys(item.focalPoint, ["x", "y"]) || !SAFE_FILENAME.test(item.filename ?? "") || filenames.has(item.filename)) throw new TypeError("Asset plan contains an unsafe filename or shape.");
    filenames.add(item.filename);
    if (!item.role?.trim() || !item.alt?.trim() || !item.prompt?.trim() || !isFocalPoint(item.focalPoint)) throw new TypeError("Asset plan contains an invalid item.");
  }
  let normalizedPriorSiteDir;
  let priorRunRoot;
  if (priorSiteDir) {
    normalizedPriorSiteDir = path.resolve(priorSiteDir);
    const priorCycleDir = path.dirname(normalizedPriorSiteDir);
    priorRunRoot = path.dirname(priorCycleDir);
    if (path.basename(normalizedPriorSiteDir) !== "site" || !/^cycle-\d{2}$/.test(path.basename(priorCycleDir))) {
      throw new TypeError("Prior asset paths must use one cycle site directory.");
    }
  }
  return { cycleDir: normalizedCycleDir, siteDir: normalizedSiteDir, runRoot, priorSiteDir: normalizedPriorSiteDir, priorRunRoot };
}

function validatePriorAssetEvidence(evidence, plan, shootDirection) {
  const fail = () => { throw new TypeError("Prior asset evidence is invalid."); };
  if (!isPlainObject(evidence) || !hasExactKeys(evidence, EVIDENCE_FIELDS) || evidence.schemaVersion !== "1.0") fail();
  if (!Array.isArray(evidence.files) || evidence.files.length < 3 || evidence.files.length > MAX_IMAGE_REQUESTS_PER_CYCLE) fail();
  for (const count of [evidence.requestCount, evidence.successCount, evidence.fallbackCount]) {
    if (!Number.isInteger(count) || count < 0 || count > MAX_IMAGE_REQUESTS_PER_CYCLE) fail();
  }
  if (typeof evidence.allResolved !== "boolean") fail();

  const planByFilename = new Map(plan.map((item) => [item.filename, item]));
  const filenames = new Set();
  let openaiCount = 0;
  let fallbackCount = 0;
  for (const file of evidence.files) {
    if (!isPlainObject(file) || !hasExactKeys(file, EVIDENCE_FILE_FIELDS) || !SAFE_FILENAME.test(file.filename ?? "") || filenames.has(file.filename)) fail();
    filenames.add(file.filename);
    if (
      file.path !== `assets/${file.filename}` || file.mediaType !== "image/png" ||
      typeof file.role !== "string" || !file.role.trim() || typeof file.alt !== "string" || !file.alt.trim() ||
      !isPlainObject(file.focalPoint) || !hasExactKeys(file.focalPoint, ["x", "y"]) || !isFocalPoint(file.focalPoint) || !/^[a-f0-9]{64}$/.test(file.promptHash ?? "") ||
      !/^[a-f0-9]{64}$/.test(file.sha256 ?? "") || !Number.isInteger(file.bytes) || file.bytes < 1
    ) fail();
    const validState =
      ((file.source === "openai" || file.source === "carried-forward") && file.resolved === true && file.errorCode === null) ||
      (file.source === "deterministic-fallback" && file.resolved === false && file.errorCode === "IMAGE_REQUEST_FAILED");
    if (!validState) fail();
    if (file.source === "openai") openaiCount += 1;
    if (file.source === "deterministic-fallback") fallbackCount += 1;

    const planned = planByFilename.get(file.filename);
    if (planned && (
      file.role !== planned.role || file.alt !== planned.alt ||
      file.focalPoint.x !== planned.focalPoint.x || file.focalPoint.y !== planned.focalPoint.y
    )) fail();
    if (
      planned && (file.source === "openai" || file.source === "carried-forward") &&
      file.sha256 === sha256Hex(createDeterministicPng({ ...planned, shootDirection }))
    ) fail();
    if (planned && file.promptHash === sha256Hex(`${shootDirection}\n\n${planned.prompt}`) && file.resolved !== true && file.source !== "deterministic-fallback") fail();
  }
  if (
    evidence.successCount !== openaiCount || evidence.fallbackCount !== fallbackCount ||
    evidence.requestCount !== openaiCount + fallbackCount ||
    evidence.allResolved !== evidence.files.every((file) => file.resolved)
  ) fail();
}

async function assertNoLinkedPath(trustedRoot, target) {
  const root = path.resolve(trustedRoot);
  const resolvedTarget = path.resolve(target);
  const relative = path.relative(root, resolvedTarget);
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
    if (relative === "") return;
    throw new Error("Asset path escapes the trusted run root.");
  }
  let current = root;
  for (const segment of relative.split(path.sep)) {
    current = path.join(current, segment);
    try {
      if ((await lstat(current)).isSymbolicLink()) {
        throw new Error("Symlink, junction, or linked path ancestors are not allowed.");
      }
    } catch (error) {
      if (error?.code === "ENOENT") return;
      throw error;
    }
  }
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function hasExactKeys(value, fields) {
  const keys = Object.keys(value);
  return keys.length === fields.length && fields.every((field) => Object.hasOwn(value, field));
}

function isFocalPoint(value) {
  return Number.isFinite(value?.x) && Number.isFinite(value?.y) && value.x >= 0 && value.x <= 1 && value.y >= 0 && value.y <= 1;
}

function planTuple(item) {
  return [item?.filename, item?.role, item?.alt, item?.prompt, item?.focalPoint?.x, item?.focalPoint?.y, item?.shootDirection ?? ""];
}

function assertDimensions(width, height) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > MAX_PNG_DIMENSION || height > MAX_PNG_DIMENSION) {
    throw new RangeError("Invalid PNG dimensions.");
  }
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type, "ascii");
  const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length, 0);
  typeBuffer.copy(chunk, 4);
  data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 8 + data.length);
  return chunk;
}

function crc32(buffer) {
  let value = 0xffffffff;
  for (const byte of buffer) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit += 1) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  }
  return (value ^ 0xffffffff) >>> 0;
}
