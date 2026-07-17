import assert from "node:assert/strict";
import test from "node:test";

import {
  ModelResponseError,
  requestStructured,
} from "../../src/lib/openai.js";

const schema = {
  type: "object",
  properties: { ok: { type: "boolean" } },
  required: ["ok"],
  additionalProperties: false,
};

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
