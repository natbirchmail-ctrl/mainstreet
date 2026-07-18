import assert from "node:assert/strict";
import test from "node:test";

import {
  ImageRequestError,
  ModelResponseError,
  requestImage,
  requestStructured,
} from "../../src/lib/openai.js";
import { deflateSync } from "node:zlib";

function crc32(buffer) {
  let value = 0xffffffff;
  for (const byte of buffer) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
    }
  }
  return (value ^ 0xffffffff) >>> 0;
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

function validPng(width = 1536, height = 1024) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const raw = Buffer.alloc(height * (1 + width * 3));
  for (let row = 0; row < height; row += 1) raw[row * (1 + width * 3)] = 0;
  return Buffer.concat([
    Buffer.from("89504e470d0a1a0a", "hex"),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

const schema = {
  type: "object",
  properties: { ok: { type: "boolean" } },
  required: ["ok"],
  additionalProperties: false,
};

test("requestImage sends one exact PNG landscape request and returns validated bytes", async () => {
  let calls = 0;
  let request;
  const image = validPng();
  const result = await requestImage({
    client: {
      images: {
        generate: async (value) => {
          calls += 1;
          request = value;
          return { data: [{ b64_json: image.toString("base64") }] };
        },
      },
    },
    model: "test-image-model",
    prompt: "A careful test image.",
  });

  assert.deepEqual(request, {
    model: "test-image-model",
    prompt: "A careful test image.",
    n: 1,
    size: "1536x1024",
    quality: "medium",
    output_format: "png",
  });
  assert.equal(calls, 1);
  assert.deepEqual(result, image);
});

test("requestImage rejects malformed output with one sanitized stable error", async () => {
  const providerMessage = "secret prompt = do not retain";
  for (const response of [
    { data: [] },
    { data: [{ b64_json: "not base64" }] },
    { data: [{ b64_json: Buffer.from("not png").toString("base64") }] },
  ]) {
    await assert.rejects(
      requestImage({ client: { images: { generate: async () => response } }, prompt: "Safe prompt." }),
      (error) =>
        error instanceof ImageRequestError &&
        error.code === "IMAGE_REQUEST_FAILED" &&
        error.message === "Image generation failed." &&
        !Object.values(error).some((value) => String(value).includes(providerMessage)),
    );
  }

  await assert.rejects(
    requestImage({
      client: {
        images: {
          generate: async () => {
            const error = new Error(providerMessage);
            error.status = 429;
            throw error;
          },
        },
      },
      prompt: "Safe prompt.",
    }),
    (error) =>
      error instanceof ImageRequestError &&
      error.code === "IMAGE_REQUEST_FAILED" &&
      error.message === "Image generation failed." &&
      !String(error.stack).includes(providerMessage),
  );
});

test("requestImage rejects oversized base64 before decoding it", async () => {
  const encodedLimit = Math.ceil((16 * 1024 * 1024) / 3) * 4;
  const oversized = ["A".repeat(encodedLimit + 4), "A".repeat(encodedLimit)];
  const originalFrom = Buffer.from;
  let decodeCalls = 0;
  Buffer.from = (...args) => {
    decodeCalls += 1;
    return originalFrom(...args);
  };
  try {
    for (const b64_json of oversized) {
      await assert.rejects(
        requestImage({
          client: { images: { generate: async () => ({ data: [{ b64_json }] }) } },
          prompt: "Safe prompt.",
        }),
        (error) => error instanceof ImageRequestError && error.code === "IMAGE_REQUEST_FAILED",
      );
    }
  } finally {
    Buffer.from = originalFrom;
  }
  assert.equal(decodeCalls, 0);
});

test("requestStructured uses the Responses API with a strict JSON schema", async () => {
  const calls = [];
  const client = {
    responses: {
      create: async (request) => {
        calls.push(request);
        return {
          status: "completed",
          output: [],
          output_text: JSON.stringify({ ok: true }),
        };
      },
    },
  };

  const result = await requestStructured({
    client,
    model: "gpt-5.6",
    schema,
    schemaName: "test_response",
    systemPrompt: "Return a test object.",
    userPayload: { task: "test" },
    sleep: async () => {},
  });

  assert.deepEqual(result, { ok: true });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].model, "gpt-5.6");
  assert.equal(calls[0].text.format.type, "json_schema");
  assert.equal(calls[0].text.format.name, "test_response");
  assert.equal(calls[0].text.format.strict, true);
  assert.deepEqual(calls[0].text.format.schema, schema);
  assert.equal(calls[0].input[0].content[0].type, "input_text");
});

test("requestStructured accepts multimodal content for vision stages", async () => {
  let request;
  const inputContent = [
    { type: "input_text", text: "Review this page." },
    { type: "input_image", image_url: "data:image/png;base64,iVBORw0KGgo=", detail: "high" },
  ];

  await requestStructured({
    client: {
      responses: {
        create: async (value) => {
          request = value;
          return {
            status: "completed",
            output: [],
            output_text: JSON.stringify({ ok: true }),
          };
        },
      },
    },
    schema,
    schemaName: "vision_response",
    systemPrompt: "Review images.",
    inputContent,
    sleep: async () => {},
  });

  assert.deepEqual(request.input[0].content, inputContent);
});

test("requestStructured retries transient API failures without SDK retry multiplication", async () => {
  let attempts = 0;
  const client = {
    responses: {
      create: async () => {
        attempts += 1;
        if (attempts < 3) {
          const error = new Error("rate limited");
          error.status = 429;
          throw error;
        }
        return {
          status: "completed",
          output: [],
          output_text: JSON.stringify({ ok: true }),
        };
      },
    },
  };

  const result = await requestStructured({
    client,
    schema,
    schemaName: "retry_response",
    systemPrompt: "Retry safely.",
    userPayload: {},
    maxAttempts: 3,
    sleep: async () => {},
  });

  assert.deepEqual(result, { ok: true });
  assert.equal(attempts, 3);
});

test("requestStructured retries incomplete output and then succeeds", async () => {
  const responses = [
    {
      status: "incomplete",
      incomplete_details: { reason: "max_output_tokens" },
      output: [],
      output_text: "",
    },
    {
      status: "completed",
      output: [],
      output_text: JSON.stringify({ ok: true }),
    },
  ];

  const result = await requestStructured({
    client: { responses: { create: async () => responses.shift() } },
    schema,
    schemaName: "incomplete_response",
    systemPrompt: "Return complete JSON.",
    userPayload: {},
    sleep: async () => {},
  });

  assert.deepEqual(result, { ok: true });
});

test("requestStructured surfaces model refusals without retrying", async () => {
  let attempts = 0;
  const client = {
    responses: {
      create: async () => {
        attempts += 1;
        return {
          status: "completed",
          output_text: "",
          output: [
            {
              type: "message",
              content: [{ type: "refusal", refusal: "Cannot comply" }],
            },
          ],
        };
      },
    },
  };

  await assert.rejects(
    requestStructured({
      client,
      schema,
      schemaName: "refusal_response",
      systemPrompt: "Return JSON.",
      userPayload: {},
      sleep: async () => {},
    }),
    (error) => error instanceof ModelResponseError && error.code === "MODEL_REFUSAL",
  );
  assert.equal(attempts, 1);
});
