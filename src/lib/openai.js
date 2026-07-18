import OpenAI from "openai";

const DEFAULT_MODEL = "gpt-5.6";
const DEFAULT_ATTEMPTS = 3;
const DEFAULT_IMAGE_MODEL = "gpt-image-1";
const MAX_IMAGE_PNG_BYTES = 16 * 1024 * 1024;
const MAX_IMAGE_BASE64_LENGTH = Math.ceil(MAX_IMAGE_PNG_BYTES / 3) * 4;

export class ImageRequestError extends Error {
  constructor() {
    super("Image generation failed.");
    this.name = "ImageRequestError";
    this.code = "IMAGE_REQUEST_FAILED";
  }
}

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

export async function requestImage({
  client = createOpenAIClient(),
  model = process.env.OPENAI_IMAGE_MODEL || DEFAULT_IMAGE_MODEL,
  prompt,
} = {}) {
  try {
    if (!prompt?.trim()) {
      throw new Error("invalid prompt");
    }

    const response = await client.images.generate({
      model,
      prompt,
      n: 1,
      size: "1536x1024",
      quality: "medium",
      output_format: "png",
    });
    const encoded = extractImageBase64(response);
    const bytes = Buffer.from(encoded, "base64");
    const { validatePngBuffer } = await import("../assets.js");
    return validatePngBuffer(bytes, { expectedWidth: 1536, expectedHeight: 1024 });
  } catch {
    throw new ImageRequestError();
  }
}

function extractImageBase64(response) {
  const data = response?.data;
  const encoded = data?.[0]?.b64_json;
  if (!Array.isArray(data) || data.length !== 1 || typeof encoded !== "string" || !encoded) {
    throw new Error("invalid image response");
  }

  const paddingBytes = encoded.endsWith("==") ? 2 : encoded.endsWith("=") ? 1 : 0;
  const decodedLength = (encoded.length / 4) * 3 - paddingBytes;
  if (encoded.length > MAX_IMAGE_BASE64_LENGTH || decodedLength > MAX_IMAGE_PNG_BYTES) {
    throw new Error("invalid image response");
  }

  if (
    encoded.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded) ||
    Buffer.from(encoded, "base64").toString("base64") !== encoded
  ) {
    throw new Error("invalid image response");
  }
  return encoded;
}

export async function requestStructured({
  client = createOpenAIClient(),
  model = DEFAULT_MODEL,
  schema,
  schemaName,
  systemPrompt,
  userPayload,
  inputContent,
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
            content:
              inputContent ??
              [
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
