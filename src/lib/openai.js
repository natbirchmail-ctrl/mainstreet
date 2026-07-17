import OpenAI from "openai";

const DEFAULT_MODEL = "gpt-5.6";
const DEFAULT_ATTEMPTS = 3;

export class ModelResponseError extends Error {
  constructor(message, { code = "MODEL_RESPONSE_ERROR", retryable = true } = {}) {
    super(message);
    this.name = "ModelResponseError";
    this.code = code;
    this.retryable = retryable;
  }
}

export function createOpenAIClient({ apiKey = process.env.OPENAI_API_KEY } = {}) {
  if (!apiKey?.trim()) {
    throw new Error("OPENAI_API_KEY is required. Add it to the project .env file.");
  }

  return new OpenAI({
    apiKey,
    maxRetries: 0,
    timeout: 180_000,
  });
}

export async function requestStructured({
  client = createOpenAIClient(),
  model = DEFAULT_MODEL,
  schema,
  schemaName,
  systemPrompt,
  userPayload,
  maxOutputTokens = 8_000,
  maxAttempts = DEFAULT_ATTEMPTS,
  sleep = defaultSleep,
}) {
  assertStructuredRequest({ schema, schemaName, systemPrompt, maxAttempts });

  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await client.responses.create({
        model,
        instructions: systemPrompt,
        input: [
          {
            role: "user",
            content: [
              {
                type: "input_text",
                text: JSON.stringify(userPayload),
              },
            ],
          },
        ],
        text: {
          format: {
            type: "json_schema",
            name: schemaName,
            schema,
            strict: true,
          },
        },
        max_output_tokens: maxOutputTokens,
      });

      return parseStructuredResponse(response);
    } catch (error) {
      lastError = error;
      if (attempt >= maxAttempts || !isRetryable(error)) {
        throw error;
      }

      await sleep(500 * 2 ** (attempt - 1));
    }
  }

  throw lastError;
}

export function parseStructuredResponse(response) {
  const refusal = response?.output
    ?.flatMap((item) => item?.content ?? [])
    .find((item) => item?.type === "refusal");

  if (refusal) {
    throw new ModelResponseError("The model refused the structured request.", {
      code: "MODEL_REFUSAL",
      retryable: false,
    });
  }

  if (response?.status === "incomplete") {
    const reason = response.incomplete_details?.reason ?? "unknown";
    throw new ModelResponseError(`The model response was incomplete: ${reason}.`, {
      code: reason === "content_filter" ? "CONTENT_FILTER" : "INCOMPLETE_RESPONSE",
      retryable: reason !== "content_filter",
    });
  }

  if (response?.status !== "completed" || !response.output_text?.trim()) {
    throw new ModelResponseError("The model returned no complete structured output.", {
      code: "EMPTY_RESPONSE",
    });
  }

  try {
    return JSON.parse(response.output_text);
  } catch {
    throw new ModelResponseError("The model returned invalid JSON.", {
      code: "INVALID_JSON",
    });
  }
}

function assertStructuredRequest({ schema, schemaName, systemPrompt, maxAttempts }) {
  if (!schema || typeof schema !== "object") {
    throw new TypeError("A JSON schema is required.");
  }
  if (!schemaName?.trim()) {
    throw new TypeError("A schema name is required.");
  }
  if (!systemPrompt?.trim()) {
    throw new TypeError("A system prompt is required.");
  }
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
    throw new TypeError("maxAttempts must be a positive integer.");
  }
}

function isRetryable(error) {
  if (error instanceof ModelResponseError) {
    return error.retryable;
  }

  const status = Number(error?.status);
  return (
    !status ||
    status === 408 ||
    status === 409 ||
    status === 429 ||
    status >= 500
  );
}

function defaultSleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
