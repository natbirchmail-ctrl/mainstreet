import { createHash } from "node:crypto";
import { lstat, mkdir, open, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { deflateSync, inflateSync } from "node:zlib";

import { requestImage as requestOpenAIImage } from "./lib/openai.js";
import { resolveInside } from "./lib/runs.js";

export const MAX_IMAGE_REQUESTS_PER_CYCLE = 5;
const MAX_PNG_BYTES = 16 * 1024 * 1024;
const MAX_PNG_DIMENSION = 4096;
const PNG_SIGNATURE = Buffer.from("89504e470d0a1a0a", "hex");
const SAFE_FILENAME = /^[a-z0-9]+(?:-[a-z0-9]+)*\.png$/;

export class PngValidationError extends Error {
  constructor() {
    super("PNG validation failed.");
    this.name = "PngValidationError";
  }
}

export function sha256Hex(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function validatePngBuffer(buffer, { expectedWidth, expectedHeight } = {}) {
  try {
    if (!Buffer.isBuffer(buffer) || buffer.length < PNG_SIGNATURE.length || buffer.length > MAX_PNG_BYTES) {
      throw new Error("invalid png");
    }
    if (!buffer.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
      throw new Error("invalid png");
    }

    let offset = PNG_SIGNATURE.length;
    let sawIhdr = false;
    let sawIdat = false;
    let sawIend = false;
    let width;
    let height;
    let channels;
    const idatChunks = [];

    while (offset < buffer.length) {
      if (offset + 12 > buffer.length) throw new Error("invalid png");
      const length = buffer.readUInt32BE(offset);
      const dataStart = offset + 8;
      const dataEnd = dataStart + length;
      const crcEnd = dataEnd + 4;
      if (dataEnd < dataStart || crcEnd > buffer.length) throw new Error("invalid png");

      const type = buffer.subarray(offset + 4, offset + 8);
      const data = buffer.subarray(dataStart, dataEnd);
      if (buffer.readUInt32BE(dataEnd) !== crc32(Buffer.concat([type, data]))) throw new Error("invalid png");
      if (![...type].every((byte) => (byte >= 65 && byte <= 90) || (byte >= 97 && byte <= 122))) {
        throw new Error("invalid png");
      }
      const typeText = type.toString("ascii");

      if (!sawIhdr) {
        if (typeText !== "IHDR" || length !== 13) throw new Error("invalid png");
        sawIhdr = true;
        width = data.readUInt32BE(0);
        height = data.readUInt32BE(4);
        const bitDepth = data[8];
        const colorType = data[9];
        const compression = data[10];
        const filter = data[11];
        const interlace = data[12];
        if (
          width < 1 || height < 1 || width > MAX_PNG_DIMENSION || height > MAX_PNG_DIMENSION ||
          bitDepth !== 8 || ![2, 6].includes(colorType) || compression !== 0 || filter !== 0 || interlace !== 0
        ) throw new Error("invalid png");
        channels = colorType === 2 ? 3 : 4;
      } else if (typeText === "IHDR" || sawIend) {
        throw new Error("invalid png");
      } else if (typeText === "IDAT") {
        if (sawIend) throw new Error("invalid png");
        sawIdat = true;
        idatChunks.push(data);
      } else if (typeText === "IEND") {
        if (!sawIdat || sawIend || length !== 0 || crcEnd !== buffer.length) throw new Error("invalid png");
        sawIend = true;
      } else {
        if (sawIdat || (type[0] & 0x20) === 0) throw new Error("invalid png");
      }
      offset = crcEnd;
    }

    if (!sawIhdr || !sawIdat || !sawIend || offset !== buffer.length) throw new Error("invalid png");
    if ((expectedWidth !== undefined && width !== expectedWidth) || (expectedHeight !== undefined && height !== expectedHeight)) {
      throw new Error("invalid png");
    }

    const stride = width * channels;
    const expectedLength = height * (stride + 1);
    const raw = inflateSync(Buffer.concat(idatChunks), { maxOutputLength: expectedLength });
    if (raw.length !== expectedLength) throw new Error("invalid png");
    for (let row = 0; row < height; row += 1) {
      if (raw[row * (stride + 1)] > 4) throw new Error("invalid png");
    }
    return buffer;
  } catch (error) {
    if (error instanceof PngValidationError) throw error;
    throw new PngValidationError();
  }
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
  validateMaterializationInput({ cycleDir, siteDir, plan, shootDirection, requestImage, priorAssets, priorSiteDir });
  let evidenceReservation;
  try {
    evidenceReservation = await reserveAssetEvidence(cycleDir);
    await rejectSymlink(resolveInside(siteDir, "assets"));
    const priorByFilename = new Map((priorAssets?.files ?? []).map((record) => [record.filename, record]));
    const files = [];
    let requestCount = 0;
    let successCount = 0;
    let fallbackCount = 0;

    for (const item of plan) {
      const requestPrompt = `${shootDirection}\n\n${item.prompt}`;
      const promptHash = sha256Hex(requestPrompt);
      const prior = priorByFilename.get(item.filename);
      const carried = await carryForwardIfEligible({ prior, priorSiteDir, item, promptHash });
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

      const assetPath = resolveInside(siteDir, "assets", item.filename);
      await writeBufferNew(assetPath, buffer);
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
    await assertEvidenceAbsent(evidenceReservation.finalPath);
    await rename(evidenceReservation.pendingPath, evidenceReservation.finalPath);
    return evidence;
  } finally {
    await evidenceReservation?.handle?.close();
  }
}

async function carryForwardIfEligible({ prior, priorSiteDir, item, promptHash }) {
  if (!prior || prior.filename !== item.filename || prior.promptHash !== promptHash || prior.resolved !== true) return null;
  if (!priorSiteDir) throw new Error("Prior asset directory is required.");
  if (!/^[a-f0-9]{64}$/.test(prior.sha256 ?? "") || !Number.isInteger(prior.bytes) || prior.bytes < 1) {
    throw new Error("Prior asset evidence is invalid.");
  }
  const priorAssetPath = resolveInside(priorSiteDir, "assets", item.filename);
  await rejectSymlink(priorAssetPath);
  const bytes = await readFile(priorAssetPath);
  if (bytes.length !== prior.bytes || sha256Hex(bytes) !== prior.sha256) {
    throw new Error("Prior asset digest does not match.");
  }
  validatePngBuffer(bytes, { expectedWidth: 1536, expectedHeight: 1024 });
  return bytes;
}

async function writeBufferNew(target, bytes) {
  await rejectSymlink(path.dirname(target));
  await mkdir(path.dirname(target), { recursive: true });
  try {
    await writeFile(target, bytes, { flag: "wx" });
  } catch (error) {
    if (error?.code === "EEXIST") throw new Error(`Asset file already exists: ${target}`);
    throw error;
  }
}

async function reserveAssetEvidence(cycleDir) {
  const finalPath = resolveInside(cycleDir, "assets.json");
  const pendingPath = resolveInside(cycleDir, "assets.json.pending");
  await mkdir(path.dirname(finalPath), { recursive: true });
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

async function rejectSymlink(target) {
  try {
    if ((await lstat(target)).isSymbolicLink()) {
      throw new Error("Symlinked asset paths are not allowed.");
    }
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
}

function validateMaterializationInput({ cycleDir, siteDir, plan, shootDirection, requestImage, priorAssets, priorSiteDir }) {
  if (!cycleDir || !siteDir || !shootDirection?.trim() || typeof requestImage !== "function") throw new TypeError("Invalid asset materialization input.");
  if (!Array.isArray(plan) || plan.length < 3 || plan.length > MAX_IMAGE_REQUESTS_PER_CYCLE) throw new TypeError("Asset plan must contain three to five items.");
  if ((priorAssets && !priorSiteDir) || (!priorAssets && priorSiteDir)) throw new TypeError("Prior assets and site directory must be supplied together.");
  const filenames = new Set();
  for (const item of plan) {
    if (!item || typeof item !== "object" || !SAFE_FILENAME.test(item.filename ?? "") || filenames.has(item.filename)) throw new TypeError("Asset plan contains an unsafe filename.");
    filenames.add(item.filename);
    if (!item.role?.trim() || !item.alt?.trim() || !item.prompt?.trim() || !isFocalPoint(item.focalPoint)) throw new TypeError("Asset plan contains an invalid item.");
  }
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
