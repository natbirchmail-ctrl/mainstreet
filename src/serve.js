import { createServer } from "node:http";
import { access, readFile, readdir, realpath, stat } from "node:fs/promises";
import path from "node:path";

import { resolveInside } from "./lib/runs.js";

const HOST = "127.0.0.1";
const DEFAULT_PORT = 4601;

export async function findLatestSite(runDir) {
  const entries = await readdir(runDir, { withFileTypes: true });
  const cycles = entries
    .filter((entry) => entry.isDirectory() && /^cycle-\d{2}$/.test(entry.name))
    .map((entry) => ({
      name: entry.name,
      cycle: Number(entry.name.slice("cycle-".length)),
    }))
    .sort((left, right) => right.cycle - left.cycle);

  for (const cycle of cycles) {
    const siteDir = resolveInside(runDir, cycle.name, "site");
    try {
      await access(resolveInside(siteDir, "index.html"));
      return siteDir;
    } catch (error) {
      if (error?.code !== "ENOENT") {
        throw error;
      }
    }
  }

  throw new Error("No generated site was found for this run.");
}

export async function startStaticServer({ root, port = DEFAULT_PORT }) {
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new TypeError("Preview port must be a valid integer.");
  }
  if (![4600, 4601].includes(port)) {
    throw new TypeError("Mainstreet servers may use only ports 4600 and 4601.");
  }

  const canonicalRoot = await realpath(root);
  const server = createServer((request, response) => {
    handleRequest({ request, response, canonicalRoot }).catch(() => {
      if (!response.headersSent) {
        sendText(response, 500, "Internal server error");
      } else {
        response.destroy();
      }
    });
  });

  await new Promise((resolve, reject) => {
    const onError = (error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen({ host: HOST, port, exclusive: true });
  });

  return {
    server,
    host: HOST,
    port,
    root: canonicalRoot,
    url: `http://${HOST}:${port}/`,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

async function handleRequest({ request, response, canonicalRoot }) {
  setSecurityHeaders(response);

  if (!request.method || !["GET", "HEAD"].includes(request.method)) {
    response.setHeader("Allow", "GET, HEAD");
    sendText(response, 405, "Method not allowed", request.method === "HEAD");
    return;
  }

  const rawPath = String(request.url ?? "/").split("?", 1)[0];
  let decodedPath;
  try {
    decodedPath = decodeURIComponent(rawPath).replaceAll("\\", "/");
  } catch {
    sendText(response, 400, "Bad request", request.method === "HEAD");
    return;
  }

  if (
    decodedPath.includes("\0") ||
    decodedPath.split("/").some((segment) => segment === "..")
  ) {
    sendText(response, 403, "Forbidden", request.method === "HEAD");
    return;
  }

  const relativePath = decodedPath === "/" ? "index.html" : decodedPath.replace(/^\/+/, "");
  const lexicalTarget = resolveInside(canonicalRoot, relativePath);
  let target;
  try {
    target = await realpath(lexicalTarget);
  } catch (error) {
    if (error?.code === "ENOENT") {
      sendText(response, 404, "Not found", request.method === "HEAD");
      return;
    }
    throw error;
  }

  const relative = path.relative(canonicalRoot, target);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    sendText(response, 403, "Forbidden", request.method === "HEAD");
    return;
  }

  const targetStat = await stat(target);
  if (!targetStat.isFile()) {
    sendText(response, 404, "Not found", request.method === "HEAD");
    return;
  }

  const body = await readFile(target);
  response.statusCode = 200;
  response.setHeader("Content-Type", contentType(target));
  response.setHeader("Content-Length", body.length);
  if (request.method === "HEAD") {
    response.end();
    return;
  }
  response.end(body);
}

function setSecurityHeaders(response) {
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; style-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  );
}

function sendText(response, status, message, headOnly = false) {
  const body = Buffer.from(`${message}\n`, "utf8");
  response.statusCode = status;
  response.setHeader("Content-Type", "text/plain; charset=utf-8");
  response.setHeader("Content-Length", body.length);
  response.end(headOnly ? undefined : body);
}

function contentType(target) {
  switch (path.extname(target).toLowerCase()) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".svg":
      return "image/svg+xml";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".webp":
      return "image/webp";
    default:
      return "application/octet-stream";
  }
}
