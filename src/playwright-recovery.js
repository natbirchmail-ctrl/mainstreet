import { spawn } from "node:child_process";
import path from "node:path";

const INSTALL_TIMEOUT_MS = 120_000;
const CLEANUP_TIMEOUT_MS = 10_000;
const WINDOWS_SYSTEM_ROOT_FALLBACK = path.win32.join(
  "C:" + path.win32.sep,
  "Windows",
);
const SAFE_STAGES = new Set(["build", "critic", "revise"]);
const liveRecoveryEvidenceByStage = new WeakMap();

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
  systemRoot = process.env.SystemRoot || WINDOWS_SYSTEM_ROOT_FALLBACK,
  commandProcessor = process.env.ComSpec,
  timeoutMs = INSTALL_TIMEOUT_MS,
  cleanupTimeoutMs = CLEANUP_TIMEOUT_MS,
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
  cleanupProcessTreeFn = terminateOwnedProcessTree,
} = {}) {
  if (typeof spawnFn !== "function") {
    throw new TypeError("A Chromium installer process function is required.");
  }
  if (
    typeof setTimeoutFn !== "function" ||
    typeof clearTimeoutFn !== "function" ||
    typeof cleanupProcessTreeFn !== "function"
  ) {
    throw new TypeError("Chromium installer lifecycle functions are required.");
  }
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1 ||
    !Number.isSafeInteger(cleanupTimeoutMs) ||
    cleanupTimeoutMs < 1
  ) {
    throw new TypeError("Chromium installer timeouts must be positive integers.");
  }

  const { command, args } = createNpxInvocation({
    platform,
    systemRoot,
    commandProcessor,
    action: "install",
  });
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawnFn(command, args, {
        detached: platform !== "win32",
        shell: false,
        stdio: "ignore",
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
    const ownedPid = isOwnedPid(child.pid) ? child.pid : null;

    let state = "active";
    let timeoutHandle;
    const clearOwnedTimeout = () => {
      if (timeoutHandle === undefined) return;
      const handle = timeoutHandle;
      timeoutHandle = undefined;
      clearTimeoutFn(handle);
    };
    const settle = (result) => {
      if (state !== "active") return;
      state = "settled";
      clearOwnedTimeout();
      resolve(result);
    };
    child.once("error", (error) => {
      settle(installerUnavailable(error?.code === "ENOENT" ? "installer_missing" : "installer_start_failed"));
    });
    child.once("close", (code, signal) => {
      if (signal) {
        settle(installerUnavailable("installer_cleanup_failed"));
      } else if (code === 0) {
        settle(Object.freeze({ status: "installed", reason: null }));
      } else {
        settle(installerUnavailable("installer_nonzero"));
      }
    });
    const onTimeout = () => {
      if (state !== "active") return;
      if (hasTerminalChildState(child)) {
        clearOwnedTimeout();
        return;
      }
      state = "terminating";
      clearOwnedTimeout();
      const childStillOwnsPid =
        ownedPid !== null &&
        child.pid === ownedPid &&
        child.exitCode === null &&
        child.signalCode === null;
      const cleanupController = new AbortController();
      const cleanup = childStillOwnsPid
        ? cleanupBeforeDeadline({
            cleanup: () =>
              cleanupProcessTreeFn({
                pid: ownedPid,
                child,
                platform,
                systemRoot,
                signal: cleanupController.signal,
              }),
            timeoutMs: cleanupTimeoutMs,
            setTimeoutFn,
            clearTimeoutFn,
            onDeadline: () => cleanupController.abort(),
          })
        : Promise.resolve(false);
      cleanup.then((cleanupSucceeded) => {
        if (state !== "terminating") return;
        releaseOwnedProcessHandle(child, ownedPid, {
          terminate: !cleanupSucceeded,
        });
        state = "settled";
        resolve(
          installerUnavailable(
            cleanupSucceeded ? "installer_timeout" : "installer_cleanup_failed",
          ),
        );
      });
    };
    timeoutHandle = setTimeoutFn(onTimeout, timeoutMs);
    if (state !== "active") clearOwnedTimeout();
  });
}

export function createNpxInvocation({
  platform = process.platform,
  systemRoot = process.env.SystemRoot || WINDOWS_SYSTEM_ROOT_FALLBACK,
  commandProcessor = process.env.ComSpec,
  action = "install",
} = {}) {
  const npxArgs =
    action === "install"
      ? ["playwright", "install", "chromium"]
      : action === "version"
        ? ["--version"]
        : null;
  if (!npxArgs) {
    throw new TypeError("A known npx action is required.");
  }
  if (platform !== "win32") {
    return Object.freeze({ command: "npx", args: Object.freeze(npxArgs) });
  }

  const canonicalCommandProcessor = windowsSystemExecutable(systemRoot, "cmd.exe");
  const trustedCommandProcessor = isCanonicalWindowsExecutable(
    commandProcessor,
    canonicalCommandProcessor,
  )
    ? path.win32.normalize(commandProcessor)
    : canonicalCommandProcessor;
  return Object.freeze({
    command: trustedCommandProcessor,
    args: Object.freeze(["/d", "/s", "/c", "npx.cmd", ...npxArgs]),
  });
}

export async function terminateOwnedProcessTree({
  pid,
  child,
  platform = process.platform,
  systemRoot = process.env.SystemRoot || WINDOWS_SYSTEM_ROOT_FALLBACK,
  spawnFn = spawn,
  killFn = process.kill,
  signal,
} = {}) {
  if (!isOwnedPid(pid)) {
    throw new TypeError("An owned process id is required for installer cleanup.");
  }
  if (platform !== "win32") {
    if (typeof killFn !== "function") {
      throw new TypeError("A process group cleanup function is required.");
    }
    if (
      !child ||
      child.pid !== pid ||
      typeof child.once !== "function" ||
      hasTerminalChildState(child)
    ) {
      throw new TypeError("The owned installer process contract is invalid for cleanup.");
    }
    await new Promise((resolve, reject) => {
      let settled = false;
      let abortHandler;
      const finish = (error) => {
        if (settled) return;
        settled = true;
        if (abortHandler) signal?.removeEventListener?.("abort", abortHandler);
        if (error) reject(error);
        else resolve();
      };
      child.once("error", () => {
        finish(new Error("The installer process group cleanup failed."));
      });
      child.once("close", () => {
        finish();
      });
      abortHandler = () => {
        finish(new Error("The installer process group cleanup was cancelled."));
      };
      signal?.addEventListener?.("abort", abortHandler, { once: true });
      if (signal?.aborted) {
        abortHandler();
        return;
      }
      try {
        killFn(-pid, "SIGKILL");
      } catch {
        finish(new Error("The installer process group cleanup failed."));
      }
    });
    return;
  }
  if (typeof spawnFn !== "function") {
    throw new TypeError("A Windows process tree cleanup function is required.");
  }

  const command = windowsSystemExecutable(systemRoot, "taskkill.exe");
  await new Promise((resolve, reject) => {
    let cleanupChild;
    try {
      cleanupChild = spawnFn(command, ["/PID", String(pid), "/T", "/F"], {
        shell: false,
        stdio: "ignore",
        windowsHide: true,
      });
    } catch {
      reject(new Error("The installer process tree cleanup could not start."));
      return;
    }
    if (!cleanupChild || typeof cleanupChild.once !== "function") {
      reject(new TypeError("The installer process tree cleanup contract is invalid."));
      return;
    }
    const ownedCleanupPid = isOwnedPid(cleanupChild.pid) ? cleanupChild.pid : null;
    let settled = false;
    let abortHandler;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      if (abortHandler) signal?.removeEventListener?.("abort", abortHandler);
      if (error) reject(error);
      else resolve();
    };
    cleanupChild.once("error", () => {
      finish(new Error("The installer process tree cleanup could not start."));
    });
    cleanupChild.once("close", (code) => {
      finish(code === 0 ? null : new Error("The installer process tree cleanup failed."));
    });
    abortHandler = () => {
      finish(new Error("The installer process tree cleanup was cancelled."));
      releaseOwnedProcessHandle(cleanupChild, ownedCleanupPid, { terminate: true });
    };
    signal?.addEventListener?.("abort", abortHandler, { once: true });
    if (signal?.aborted) abortHandler();
  });
}

export function createPlaywrightRecovery({ installer = installPlaywrightChromium } = {}) {
  if (typeof installer !== "function") {
    throw new TypeError("A Chromium installer function is required.");
  }

  let installPromise = null;
  let installResult = null;
  let triggerStage = null;
  const unavailableEvidenceByStage = new Map();

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

  const recovery = Object.freeze({
    async run(operation, { stage } = {}) {
      if (typeof operation !== "function") {
        throw new TypeError("A browser operation is required.");
      }
      if (!SAFE_STAGES.has(stage)) {
        throw new TypeError("A known browser recovery stage is required.");
      }
      if (installResult?.reason === "installer_cleanup_failed") {
        throw latchUnavailable(stage, installResult, unavailableEvidenceByStage);
      }

      try {
        return await operation();
      } catch (error) {
        if (!isPlaywrightChromiumExecutableMissing(error)) throw error;
      }

      const installation = await installOnce(stage);
      if (installation.reason === "installer_cleanup_failed") {
        throw latchUnavailable(stage, installation, unavailableEvidenceByStage);
      }
      try {
        return await operation();
      } catch (error) {
        if (!isPlaywrightChromiumExecutableMissing(error)) throw error;
        throw latchUnavailable(stage, installation, unavailableEvidenceByStage);
      }
    },

    snapshot() {
      return {
        schemaVersion: "1.0",
        installAttempted: installPromise !== null,
        installStatus: installResult?.status ?? null,
        installReason: installResult?.reason ?? null,
        triggerStage,
        unavailableStages: [...unavailableEvidenceByStage.keys()],
      };
    },
  });
  liveRecoveryEvidenceByStage.set(recovery, unavailableEvidenceByStage);
  return recovery;
}

export function matchesLatchedUnavailableEvidence(recovery, stage, evidence) {
  const expected = liveRecoveryEvidenceByStage.get(recovery)?.get(stage);
  return Boolean(
    expected &&
      evidence &&
      typeof evidence === "object" &&
      !Array.isArray(evidence) &&
      Object.keys(evidence).length === 4 &&
      evidence.status === "unavailable" &&
      evidence.reason === expected.reason &&
      evidence.installStatus === expected.installStatus &&
      evidence.installReason === expected.installReason,
  );
}

export function isPlaywrightBrowserUnavailable(error) {
  return error?.code === "PLAYWRIGHT_BROWSER_UNAVAILABLE" && isRecoveryMetadata(error.recovery);
}

function installerUnavailable(reason) {
  return Object.freeze({ status: "unavailable", reason });
}

function latchUnavailable(stage, installation, unavailableEvidenceByStage) {
  const evidence = Object.freeze({
    schemaVersion: "1.0",
    stage,
    reason:
      installation.status === "installed"
        ? "chromium_missing_after_retry"
        : installation.reason,
    installStatus: installation.status,
    installReason: installation.reason,
  });
  unavailableEvidenceByStage.set(stage, evidence);
  return new PlaywrightBrowserUnavailableError(evidence);
}

function cleanupBeforeDeadline({
  cleanup,
  timeoutMs,
  setTimeoutFn,
  clearTimeoutFn,
  onDeadline,
}) {
  let timeoutHandle;
  const deadline = new Promise((resolve) => {
    timeoutHandle = setTimeoutFn(() => {
      resolve(false);
      try {
        onDeadline?.();
      } catch {
        // Cleanup cancellation is best effort; the deadline remains authoritative.
      }
    }, timeoutMs);
  });
  const attempt = Promise.resolve()
    .then(cleanup)
    .then(
      () => true,
      () => false,
    );
  return Promise.race([attempt, deadline]).finally(() => {
    if (timeoutHandle !== undefined) clearTimeoutFn(timeoutHandle);
  });
}

function releaseOwnedProcessHandle(child, ownedPid, { terminate }) {
  if (!isOwnedPid(ownedPid) || !child || child.pid !== ownedPid) return;
  if (terminate && !hasTerminalChildState(child) && typeof child.kill === "function") {
    try {
      child.kill("SIGKILL");
    } catch {
      // The handle is still released below so a failed cleanup cannot pin the CLI.
    }
  }
  if (typeof child.unref === "function") {
    try {
      child.unref();
    } catch {
      // An unusable handle cannot safely be acted on further.
    }
  }
}

function hasTerminalChildState(child) {
  return (
    (child.exitCode !== null && child.exitCode !== undefined) ||
    (child.signalCode !== null && child.signalCode !== undefined)
  );
}

function windowsSystemExecutable(systemRoot, filename) {
  if (typeof systemRoot !== "string" || !systemRoot.trim()) {
    throw new TypeError("A canonical Windows system root is required.");
  }
  const normalized = path.win32.resolve(systemRoot);
  if (!/^[a-z]:\\Windows$/i.test(normalized)) {
    throw new TypeError("A canonical Windows system root is required.");
  }
  return path.win32.join(normalized, "System32", filename);
}

function isCanonicalWindowsExecutable(candidate, canonical) {
  return (
    typeof candidate === "string" &&
    candidate.trim() !== "" &&
    path.win32.resolve(candidate).toLowerCase() === canonical.toLowerCase()
  );
}

function isOwnedPid(value) {
  return Number.isSafeInteger(value) && value > 0;
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
          "installer_cleanup_failed",
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
    "installer_cleanup_failed",
  ]);
  return (
    value.installStatus === "unavailable" &&
    unavailableReasons.has(value.reason) &&
    value.installReason === value.reason
  );
}
