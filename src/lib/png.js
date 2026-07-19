import { inflateSync } from "node:zlib";

export const DEFAULT_MAX_PNG_BYTES = 16 * 1024 * 1024;
export const DEFAULT_MAX_PNG_WIDTH = 4096;
export const DEFAULT_MAX_PNG_HEIGHT = 4096;
export const DEFAULT_MAX_DECODED_BYTES = 96 * 1024 * 1024;

const PNG_SIGNATURE = Buffer.from("89504e470d0a1a0a", "hex");

export class PngValidationError extends Error {
  constructor() {
    super("PNG validation failed.");
    this.name = "PngValidationError";
  }
}

export function validatePngBuffer(buffer, options) {
  inspectPngBuffer(buffer, options);
  return buffer;
}

export function inspectPngBuffer(
  buffer,
  {
    expectedWidth,
    expectedHeight,
    maxBytes = DEFAULT_MAX_PNG_BYTES,
    maxWidth = DEFAULT_MAX_PNG_WIDTH,
    maxHeight = DEFAULT_MAX_PNG_HEIGHT,
    maxDecodedBytes = DEFAULT_MAX_DECODED_BYTES,
  } = {},
) {
  try {
    assertPositiveLimit(maxBytes);
    assertPositiveLimit(maxWidth);
    assertPositiveLimit(maxHeight);
    assertPositiveLimit(maxDecodedBytes);
    if (
      !Buffer.isBuffer(buffer) ||
      buffer.length < PNG_SIGNATURE.length ||
      buffer.length > maxBytes ||
      !buffer.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)
    ) {
      throw new Error("invalid png");
    }

    let offset = PNG_SIGNATURE.length;
    let sawIhdr = false;
    let sawIdat = false;
    let sawIend = false;
    let width;
    let height;
    let channels;
    let colorType;
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
      if (
        ![...type].every(
          (byte) => (byte >= 65 && byte <= 90) || (byte >= 97 && byte <= 122),
        ) ||
        (type[2] & 0x20) !== 0 ||
        buffer.readUInt32BE(dataEnd) !== crc32(type, data)
      ) {
        throw new Error("invalid png");
      }
      const typeText = type.toString("ascii");

      if (!sawIhdr) {
        if (typeText !== "IHDR" || length !== 13) throw new Error("invalid png");
        sawIhdr = true;
        width = data.readUInt32BE(0);
        height = data.readUInt32BE(4);
        const bitDepth = data[8];
        colorType = data[9];
        const compression = data[10];
        const filter = data[11];
        const interlace = data[12];
        if (
          width < 1 ||
          height < 1 ||
          width > maxWidth ||
          height > maxHeight ||
          bitDepth !== 8 ||
          ![2, 6].includes(colorType) ||
          compression !== 0 ||
          filter !== 0 ||
          interlace !== 0
        ) {
          throw new Error("invalid png");
        }
        channels = colorType === 2 ? 3 : 4;
      } else if (typeText === "IHDR" || sawIend) {
        throw new Error("invalid png");
      } else if (typeText === "IDAT") {
        sawIdat = true;
        idatChunks.push(data);
      } else if (typeText === "IEND") {
        if (!sawIdat || length !== 0 || crcEnd !== buffer.length) {
          throw new Error("invalid png");
        }
        sawIend = true;
      } else if (sawIdat || (type[0] & 0x20) === 0) {
        throw new Error("invalid png");
      }
      offset = crcEnd;
    }

    if (!sawIhdr || !sawIdat || !sawIend || offset !== buffer.length) {
      throw new Error("invalid png");
    }
    if (
      (expectedWidth !== undefined && width !== expectedWidth) ||
      (expectedHeight !== undefined && height !== expectedHeight)
    ) {
      throw new Error("invalid png");
    }

    const stride = width * channels;
    const expectedLength = height * (stride + 1);
    if (!Number.isSafeInteger(expectedLength) || expectedLength > maxDecodedBytes) {
      throw new Error("invalid png");
    }
    const compressed = Buffer.concat(idatChunks);
    const inflated = inflateSync(compressed, {
      info: true,
      maxOutputLength: expectedLength,
    });
    const raw = inflated.buffer;
    if (
      !Number.isSafeInteger(inflated.engine?.bytesWritten) ||
      inflated.engine.bytesWritten !== compressed.length
    ) {
      throw new Error("invalid png");
    }
    if (raw.length !== expectedLength) throw new Error("invalid png");
    for (let row = 0; row < height; row += 1) {
      if (raw[row * (stride + 1)] > 4) throw new Error("invalid png");
    }
    return Object.freeze({
      width,
      height,
      bytes: buffer.length,
      decodedBytes: expectedLength,
      colorType,
      channels,
    });
  } catch (error) {
    if (error instanceof PngValidationError) throw error;
    throw new PngValidationError();
  }
}

function assertPositiveLimit(value) {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error("invalid png");
}

function crc32(...buffers) {
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
