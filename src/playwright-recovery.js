import { spawn } from "node:child_process";

const INSTALL_TIMEOUT_MS = 120_000;
const SAFE_STAGES = new Set(["build", "critic", "revise"]);

export class PlaywrightBrowserUnavailableError extends Error {
  constructor(recovery) {
    super("Chromium is unavailable after one recovery attempt.");
    this.name = "PlaywrightBrowserUnavailableError";
    this.code = "PLAYWRIGHT_BROWSER_UNAVAILABLE";
    this.recovery = Object.freeze({ ...recovery });
  }
}

export function isPlaywrightChromiumExecutableMissing(error) {
  if (typeof error?.message !== "string") return false;
  const [firstLine] = error.message.split(/\r?\n/, 1);
  return /^browserType\.launch: Executable doesn't exist at .+$/.test(firstLine);
}

export async function installPlaywrightChromium({
  spawnFn = spawn,
  platform = process.platform,
  timeoutMs = INSTALL_TIMEOUT_MS,
} = {}) {
  if (typeof spawnFn !== "function") {
    throw new TypeError("A Chromium installer process function is required.");
  }
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) {
    throw new TypeError("The Chromium installer timeout must be a positive integer.");
  }

  const command = platform === "win32" ? "npx.cmd" : "npx";
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawnFn(command, ["playwright", "install", "chromium"], {
        shell: false,
        stdio: "ignore",
        timeout: timeoutMs,
        windowsHide: true,
      });
    } catch (error) {
      resolve(installerUnavailable(error?.code === "ENOENT" ? "installer_missing" : "installer_start_failed"));
      return;
    }

    if (!child || typeof child.once !== "function") {
      reject(new TypeError("The Chromium installer process contract is invalid."));
      return;
    }

    let settled = false;
    const settle = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    child.once("error", (error) => {
      settle(installerUnavailable(error?.code === "ENOENT" ? "installer_missing" : "installer_start_failed"));
    });
    child.once("close", (code, signal) => {
      if (signal) {
        settle(installerUnavailable("installer_timeout"));
      } else if (code === 0) {
        settle(Object.freeze({ status: "installed", reason: null }));
      } else {
        settle(installerUnavailable("installer_nonzero"));
      }
    });
  });
}

export function createPlaywrightRecovery({ installer = installPlaywrightChromium } = {}) {
  if (typeof installer !== "function") {
    throw new TypeError("A Chromium installer function is required.");
  }

  let installPromise = null;
  let installResult = null;
  let triggerStage = null;
  const unavailableStages = new Set();

  const installOnce = (stage) => {
    if (!installPromise) {
      triggerStage = stage;
      installPromise = Promise.resolve()
        .then(() => installer())
        .then(validateInstallerResult)
        .then((result) => {
          installResult = result;
          return result;
        });
    }
    return installPromise;
  };

  return Object.freeze({
    async run(operation, { stage } = {}) {
      if (typeof operation !== "function") {
        throw new TypeError("A browser operation is required.");
      }
      if (!SAFE_STAGES.has(stage)) {
        throw new TypeError("A known browser recovery stage is required.");
      }

      try {
        return await operation();
      } catch (error) {
        if (!isPlaywrightChromiumExecutableMissing(error)) throw error;
      }

      const installation = await installOnce(stage);
      try {
        return await operation();
      } catch (error) {
        if (!isPlaywrightChromiumExecutableMissing(error)) throw error;
        unavailableStages.add(stage);
        throw new PlaywrightBrowserUnavailableError({
          schemaVersion: "1.0",
          stage,
          reason:
            installation.status === "installed"
              ? "chromium_missing_after_retry"
              : installation.reason,
          installStatus: installation.status,
          installReason: installation.reason,
        });
      }
    },

    snapshot() {
      return {
        schemaVersion: "1.0",
        installAttempted: installPromise !== null,
        installStatus: installResult?.status ?? null,
        installReason: installResult?.reason ?? null,
        triggerStage,
        unavailableStages: [...unavailableStages],
      };
    },
  });
}

export function isPlaywrightBrowserUnavailable(error) {
  return error?.code === "PLAYWRIGHT_BROWSER_UNAVAILABLE" && isRecoveryMetadata(error.recovery);
}

function installerUnavailable(reason) {
  return Object.freeze({ status: "unavailable", reason });
}

function validateInstallerResult(result) {
  const valid =
    result?.status === "installed"
      ? result.reason === null
      : result?.status === "unavailable" &&
        [
          "installer_missing",
          "installer_nonzero",
          "installer_start_failed",
          "installer_timeout",
        ].includes(result.reason);
  if (!valid || Object.keys(result).some((key) => !["status", "reason"].includes(key))) {
    throw new TypeError("The Chromium installer returned invalid recovery metadata.");
  }
  return Object.freeze({ status: result.status, reason: result.reason });
}

function isRecoveryMetadata(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const expectedFields = [
    "schemaVersion",
    "stage",
    "reason",
    "installStatus",
    "installReason",
  ];
  if (
    Object.keys(value).length !== expectedFields.length ||
    expectedFields.some((field) => !Object.hasOwn(value, field)) ||
    value.schemaVersion !== "1.0" ||
    !SAFE_STAGES.has(value.stage)
  ) {
    return false;
  }
  if (value.installStatus === "installed") {
    return (
      value.reason === "chromium_missing_after_retry" &&
      value.installReason === null
    );
  }
  const unavailableReasons = new Set([
    "installer_missing",
    "installer_nonzero",
    "installer_start_failed",
    "installer_timeout",
  ]);
  return (
    value.installStatus === "unavailable" &&
    unavailableReasons.has(value.reason) &&
    value.installReason === value.reason
  );
}
