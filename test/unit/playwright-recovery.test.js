import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { syntheticWindowsPath, syntheticWindowsPathOnDrive } from "../helpers/windows-path.js";

import * as pipelineModule from "../../src/pipeline.js";
import * as recoveryModule from "../../src/playwright-recovery.js";
import { isPlaywrightBrowserUnavailable } from "../../src/playwright-recovery.js";

function recoveryApi(name) {
  assert.equal(typeof pipelineModule[name], "function", `${name} must be exported`);
  return pipelineModule[name];
}

function missingChromiumError(path = syntheticWindowsPath("private", "playwright", "chrome.exe")) {
  return new Error(
    `browserType.launch: Executable doesn't exist at ${path}\n` +
      "Playwright diagnostic text that must never be persisted",
  );
}

function fakeChild(emit) {
  const child = new EventEmitter();
  queueMicrotask(() => emit(child));
  return child;
}

test("missing executable detection is exact and does not accept generic launch failures", () => {
  const predicate = recoveryApi("isPlaywrightChromiumExecutableMissing");

  assert.equal(predicate(missingChromiumError()), true);
  assert.equal(
    predicate(new Error("browserType.launch: Failed to launch because the fixture is invalid")),
    false,
  );
  assert.equal(predicate(Object.assign(new Error("spawn failed"), { code: "ENOENT" })), false);
  assert.equal(
    predicate(new Error(`BrowserType.launch: Executable doesn't exist at ${syntheticWindowsPath("private", "chrome.exe")}`)),
    false,
  );
});

test("installer uses the platform safe exact command without shell or inherited output", async () => {
  const installPlaywrightChromium = recoveryApi("installPlaywrightChromium");
  let invocation;
  const result = await installPlaywrightChromium({
    platform: "win32",
    systemRoot: syntheticWindowsPath("Windows"),
    commandProcessor: syntheticWindowsPath("Windows", "System32", "cmd.exe"),
    timeoutMs: 45_000,
    spawnFn(command, args, options) {
      invocation = { command, args, options };
      return fakeChild((child) => child.emit("close", 0, null));
    },
  });

  assert.deepEqual(invocation, {
    command: syntheticWindowsPath("Windows", "System32", "cmd.exe"),
    args: ["/d", "/s", "/c", "npx.cmd", "playwright", "install", "chromium"],
    options: {
      detached: false,
      shell: false,
      stdio: "ignore",
      windowsHide: true,
    },
  });
  assert.deepEqual(result, { status: "installed", reason: null });
  assert.doesNotMatch(JSON.stringify(result), /private|stdout|stderr|chrome\.exe/i);
});

test("non Windows installer invokes npx directly with the exact install arguments", async () => {
  const installPlaywrightChromium = recoveryApi("installPlaywrightChromium");
  let invocation;
  await installPlaywrightChromium({
    platform: "linux",
    spawnFn(command, args, options) {
      invocation = { command, args, options };
      return fakeChild((child) => child.emit("close", 0, null));
    },
  });
  assert.equal(invocation.command, "npx");
  assert.deepEqual(invocation.args, ["playwright", "install", "chromium"]);
  assert.deepEqual(invocation.options, {
    detached: true,
    shell: false,
    stdio: "ignore",
    windowsHide: true,
  });
});

test("Windows command builder pins System32 cmd and rejects alternate executable roots", () => {
  assert.equal(typeof recoveryModule.createNpxInvocation, "function");
  assert.deepEqual(
    recoveryModule.createNpxInvocation({
      platform: "win32",
      systemRoot: syntheticWindowsPathOnDrive("D", "Windows"),
      commandProcessor: syntheticWindowsPathOnDrive("D", "Windows", "system32", "cmd.exe"),
      action: "version",
    }),
    {
      command: syntheticWindowsPathOnDrive("D", "Windows", "system32", "cmd.exe"),
      args: ["/d", "/s", "/c", "npx.cmd", "--version"],
    },
  );
  assert.deepEqual(
    recoveryModule.createNpxInvocation({
      platform: "win32",
      systemRoot: syntheticWindowsPath("Windows"),
      commandProcessor: syntheticWindowsPath("Trusted", "cmd.exe"),
      action: "version",
    }),
    {
      command: syntheticWindowsPath("Windows", "System32", "cmd.exe"),
      args: ["/d", "/s", "/c", "npx.cmd", "--version"],
    },
  );
  assert.throws(
    () =>
    recoveryModule.createNpxInvocation({
      platform: "win32",
      systemRoot: syntheticWindowsPath("Trusted"),
      action: "install",
    }),
    /system root/i,
  );
});

test("Windows process cleanup pins taskkill to System32 and targets only the owned pid", async () => {
  assert.equal(typeof recoveryModule.terminateOwnedProcessTree, "function");
  let invocation;
  await recoveryModule.terminateOwnedProcessTree({
    pid: 4321,
    platform: "win32",
    systemRoot: syntheticWindowsPath("Windows"),
    spawnFn(command, args, options) {
      invocation = { command, args, options };
      return fakeChild((child) => child.emit("close", 0, null));
    },
  });
  assert.deepEqual(invocation, {
    command: syntheticWindowsPath("Windows", "System32", "taskkill.exe"),
    args: ["/PID", "4321", "/T", "/F"],
    options: { shell: false, stdio: "ignore", windowsHide: true },
  });
});

test("Windows process cleanup rejects taskkill start and nonzero failures", async (t) => {
  for (const [name, emit] of [
    ["start error", (child) => child.emit("error", new Error("taskkill unavailable"))],
    ["nonzero exit", (child) => child.emit("close", 1, null)],
  ]) {
    await t.test(name, async () => {
      await assert.rejects(
        recoveryModule.terminateOwnedProcessTree({
          pid: 4321,
          platform: "win32",
          systemRoot: syntheticWindowsPath("Windows"),
          spawnFn: () => fakeChild(emit),
        }),
        /process tree cleanup/i,
      );
    });
  }
});

test("aborting Windows process cleanup terminates and releases its owned taskkill handle", async () => {
  const taskkill = new EventEmitter();
  taskkill.pid = 7337;
  taskkill.exitCode = null;
  taskkill.signalCode = null;
  const killCalls = [];
  let unrefCalls = 0;
  taskkill.kill = (signal) => {
    killCalls.push(signal);
    taskkill.emit("close", 0, signal);
    return true;
  };
  taskkill.unref = () => {
    unrefCalls += 1;
  };
  const controller = new AbortController();
  const cleanup = recoveryModule.terminateOwnedProcessTree({
    pid: 4321,
    platform: "win32",
    systemRoot: syntheticWindowsPath("Windows"),
    signal: controller.signal,
    spawnFn: () => taskkill,
  });

  controller.abort();
  await Promise.resolve();
  const killCallsAtAbort = [...killCalls];
  const unrefCallsAtAbort = unrefCalls;
  taskkill.emit("close", 1, null);
  await assert.rejects(cleanup, /process tree cleanup/i);
  assert.deepEqual(killCallsAtAbort, ["SIGKILL"]);
  assert.equal(unrefCallsAtAbort, 1);
});

test("POSIX process cleanup kills only the owned detached process group", async () => {
  const calls = [];
  const child = new EventEmitter();
  child.pid = 2468;
  child.exitCode = null;
  child.signalCode = null;
  let settled = false;
  const cleanup = recoveryModule.terminateOwnedProcessTree({
    pid: 2468,
    child,
    platform: "linux",
    killFn(pid, signal) {
      calls.push({ pid, signal });
    },
  });
  cleanup.then(() => {
    settled = true;
  });
  assert.deepEqual(calls, [{ pid: -2468, signal: "SIGKILL" }]);
  await Promise.resolve();
  assert.equal(settled, false, "signal delivery alone must not complete process cleanup");
  child.signalCode = "SIGKILL";
  child.emit("close", null, "SIGKILL");
  await cleanup;
  assert.equal(settled, true);

  for (const pid of [undefined, 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    await assert.rejects(
      recoveryModule.terminateOwnedProcessTree({
        pid,
        platform: "linux",
        killFn() {
          throw new Error("must not target an unowned pid");
        },
      }),
      /owned process id/i,
    );
  }
});

test("synchronous Windows spawn EINVAL is sanitized as installer start failure", async () => {
  const installPlaywrightChromium = recoveryApi("installPlaywrightChromium");
  const result = await installPlaywrightChromium({
    platform: "win32",
    systemRoot: syntheticWindowsPath("Windows"),
    spawnFn() {
      throw Object.assign(new Error(`spawn EINVAL at ${syntheticWindowsPath("private", "cmd.exe")}`), {
        code: "EINVAL",
      });
    },
  });
  assert.deepEqual(result, {
    status: "unavailable",
    reason: "installer_start_failed",
  });
  assert.doesNotMatch(JSON.stringify(result), /private|cmd\.exe|EINVAL/i);
});

test("installer returns sanitized typed outcomes for missing command and nonzero exit", async (t) => {
  const installPlaywrightChromium = recoveryApi("installPlaywrightChromium");
  const cases = [
    {
      name: "missing command",
      emit: (child) => child.emit("error", Object.assign(new Error(`missing at ${syntheticWindowsPath("private", "npx.cmd")}`), { code: "ENOENT" })),
      expected: { status: "unavailable", reason: "installer_missing" },
    },
    {
      name: "nonzero exit",
      emit: (child) => child.emit("close", 9, null),
      expected: { status: "unavailable", reason: "installer_nonzero" },
    },
  ];

  for (const item of cases) {
    await t.test(item.name, async () => {
      const result = await installPlaywrightChromium({
        spawnFn: () => fakeChild(item.emit),
      });
      assert.deepEqual(result, item.expected);
      assert.doesNotMatch(JSON.stringify(result), /private|stdout|stderr|npx\.cmd/i);
    });
  }
});

test("installer timeout awaits exactly one owned tree cleanup and ignores late close", async () => {
  const installPlaywrightChromium = recoveryApi("installPlaywrightChromium");
  const child = new EventEmitter();
  child.pid = 6123;
  child.exitCode = null;
  child.signalCode = null;
  const timerToken = Object.freeze({ id: "owned-installer-timeout" });
  const cleanupTimerToken = Object.freeze({ id: "owned-cleanup-timeout" });
  const cleared = [];
  const cleanupCalls = [];
  let timeoutCallback;
  let cleanupTimeoutCallback;
  let releaseCleanup;
  let announceCleanup;
  const cleanupStarted = new Promise((resolve) => {
    announceCleanup = resolve;
  });
  const cleanupGate = new Promise((resolve) => {
    releaseCleanup = resolve;
  });
  let settlementCount = 0;

  const installation = installPlaywrightChromium({
    platform: "win32",
    systemRoot: syntheticWindowsPath("Windows"),
    timeoutMs: 75,
    cleanupTimeoutMs: 25,
    spawnFn() {
      return child;
    },
    setTimeoutFn(callback, delay) {
      if (delay === 75) {
        timeoutCallback = callback;
        return timerToken;
      }
      assert.equal(delay, 25);
      cleanupTimeoutCallback = callback;
      return cleanupTimerToken;
    },
    clearTimeoutFn(token) {
      cleared.push(token);
    },
    async cleanupProcessTreeFn(ownedProcess) {
      cleanupCalls.push(ownedProcess);
      announceCleanup();
      await cleanupGate;
    },
  });
  installation.then(() => {
    settlementCount += 1;
  });

  timeoutCallback();
  timeoutCallback();
  await cleanupStarted;
  child.emit("close", 0, null);
  await Promise.resolve();

  assert.equal(settlementCount, 0, "timeout must not settle before tree cleanup completes");
  assert.equal(cleanupCalls.length, 1);
  const [{ signal, ...ownedProcess }] = cleanupCalls;
  assert.deepEqual(ownedProcess, {
    pid: 6123,
    child,
    platform: "win32",
    systemRoot: syntheticWindowsPath("Windows"),
  });
  assert.equal(signal.aborted, false);
  assert.equal(typeof cleanupTimeoutCallback, "function");

  releaseCleanup();
  assert.deepEqual(await installation, {
    status: "unavailable",
    reason: "installer_timeout",
  });
  assert.deepEqual(cleared, [timerToken, cleanupTimerToken]);
  child.emit("error", Object.assign(new Error("late close companion"), { code: "ENOENT" }));
  await Promise.resolve();
  assert.equal(settlementCount, 1);
  assert.equal(cleanupCalls.length, 1);
});

test("installer timeout leaves an already exited child close event authoritative", async () => {
  const installPlaywrightChromium = recoveryApi("installPlaywrightChromium");
  const child = new EventEmitter();
  child.pid = 8123;
  child.exitCode = 0;
  child.signalCode = null;
  let timeoutCallback;
  const cleanupCalls = [];

  const installation = installPlaywrightChromium({
    platform: "linux",
    spawnFn: () => child,
    setTimeoutFn(callback) {
      timeoutCallback = callback;
      return "exited-child-timer";
    },
    clearTimeoutFn: () => {},
    cleanupProcessTreeFn: async (ownedProcess) => {
      cleanupCalls.push(ownedProcess);
    },
  });
  timeoutCallback();
  child.emit("close", 0, null);

  assert.deepEqual(await installation, { status: "installed", reason: null });
  assert.deepEqual(cleanupCalls, []);
});

test("failed or hung tree cleanup is sanitized and cannot trigger a browser retry", async (t) => {
  for (const mode of ["rejected", "hung"]) {
    await t.test(mode, async () => {
      const child = new EventEmitter();
      child.pid = 9221;
      child.exitCode = null;
      child.signalCode = null;
      const childKillCalls = [];
      let childUnrefCalls = 0;
      child.kill = (signal) => {
        childKillCalls.push(signal);
        return true;
      };
      child.unref = () => {
        childUnrefCalls += 1;
      };
      let installerTimeoutCallback;
      let cleanupTimeoutCallback;
      let cleanupCalls = 0;
      const never = new Promise(() => {});
      const installation = recoveryModule.installPlaywrightChromium({
        platform: "linux",
        timeoutMs: 80,
        cleanupTimeoutMs: 20,
        spawnFn: () => child,
        setTimeoutFn(callback, delay) {
          if (delay === 80) installerTimeoutCallback = callback;
          else if (delay === 20) cleanupTimeoutCallback = callback;
          else assert.fail(`unexpected timeout ${delay}`);
          return `${delay}-timer`;
        },
        clearTimeoutFn: () => {},
        cleanupProcessTreeFn: async () => {
          cleanupCalls += 1;
          if (mode === "rejected") throw new Error("private cleanup failure");
          await never;
        },
      });
      installerTimeoutCallback();
      await Promise.resolve();
      await Promise.resolve();
      if (mode === "hung") {
        assert.equal(typeof cleanupTimeoutCallback, "function");
        cleanupTimeoutCallback();
      }
      const result = await installation;
      assert.deepEqual(result, {
        status: "unavailable",
        reason: "installer_cleanup_failed",
      });
      assert.equal(cleanupCalls, 1);
      assert.deepEqual(childKillCalls, ["SIGKILL"]);
      assert.equal(childUnrefCalls, 1);
      assert.doesNotMatch(JSON.stringify(result), /private|taskkill|pid/i);

      let browserCalls = 0;
      const recovery = recoveryModule.createPlaywrightRecovery({ installer: async () => result });
      await assert.rejects(
        recovery.run(async () => {
          browserCalls += 1;
          throw missingChromiumError();
        }, { stage: "build" }),
        (error) =>
          isPlaywrightBrowserUnavailable(error) &&
          error.recovery.reason === "installer_cleanup_failed",
      );
      assert.equal(browserCalls, 1, "cleanup failure must not launch a browser retry");
      await assert.rejects(
        recovery.run(async () => {
          browserCalls += 1;
          throw missingChromiumError();
        }, { stage: "critic" }),
        (error) =>
          isPlaywrightBrowserUnavailable(error) &&
          error.recovery.reason === "installer_cleanup_failed",
      );
      assert.equal(browserCalls, 1, "cleanup failure must block every later browser stage");
    });
  }
});

test("signaled installer close before the owned timeout cannot authorize a retry", async () => {
  const child = new EventEmitter();
  child.pid = 9441;
  child.exitCode = null;
  child.signalCode = null;
  queueMicrotask(() => {
    child.signalCode = "SIGTERM";
    child.emit("close", null, "SIGTERM");
  });
  const result = await recoveryModule.installPlaywrightChromium({
    platform: "win32",
    systemRoot: syntheticWindowsPath("Windows"),
    commandProcessor: syntheticWindowsPath("Windows", "System32", "cmd.exe"),
    spawnFn: () => child,
  });
  assert.deepEqual(result, {
    status: "unavailable",
    reason: "installer_cleanup_failed",
  });

  let browserCalls = 0;
  const recovery = recoveryModule.createPlaywrightRecovery({ installer: async () => result });
  await assert.rejects(
    recovery.run(async () => {
      browserCalls += 1;
      throw missingChromiumError();
    }, { stage: "build" }),
    (error) =>
      isPlaywrightBrowserUnavailable(error) &&
      error.recovery.reason === "installer_cleanup_failed",
  );
  assert.equal(browserCalls, 1);
});

test("installer success cancels its owned timeout and stale callbacks cannot kill", async () => {
  const installPlaywrightChromium = recoveryApi("installPlaywrightChromium");
  const child = new EventEmitter();
  child.pid = 7331;
  const timerToken = Object.freeze({ id: "success-timeout" });
  const cleared = [];
  const cleanupCalls = [];
  let timeoutCallback;

  const installation = installPlaywrightChromium({
    platform: "linux",
    spawnFn() {
      return child;
    },
    setTimeoutFn(callback) {
      timeoutCallback = callback;
      return timerToken;
    },
    clearTimeoutFn(token) {
      cleared.push(token);
    },
    cleanupProcessTreeFn: async (ownedProcess) => {
      cleanupCalls.push(ownedProcess);
    },
  });
  child.emit("close", 0, null);
  assert.deepEqual(await installation, { status: "installed", reason: null });
  timeoutCallback();
  await Promise.resolve();

  assert.deepEqual(cleared, [timerToken]);
  assert.deepEqual(cleanupCalls, []);
});

test("recovery installs once and retries each missing browser operation once across stages", async () => {
  const createPlaywrightRecovery = recoveryApi("createPlaywrightRecovery");
  let installerCalls = 0;
  const recovery = createPlaywrightRecovery({
    installer: async () => {
      installerCalls += 1;
      return { status: "installed", reason: null };
    },
  });
  const operationCalls = { build: 0, critic: 0, revise: 0 };

  for (const stage of Object.keys(operationCalls)) {
    const value = await recovery.run(async () => {
      operationCalls[stage] += 1;
      if (operationCalls[stage] === 1) throw missingChromiumError();
      return `${stage}-available`;
    }, { stage });
    assert.equal(value, `${stage}-available`);
  }

  assert.equal(installerCalls, 1);
  assert.deepEqual(operationCalls, { build: 2, critic: 2, revise: 2 });
  assert.deepEqual(recovery.snapshot(), {
    schemaVersion: "1.0",
    installAttempted: true,
    installStatus: "installed",
    installReason: null,
    triggerStage: "build",
    unavailableStages: [],
  });
});

test("persistent missing Chromium becomes sanitized typed unavailable metadata", async () => {
  const createPlaywrightRecovery = recoveryApi("createPlaywrightRecovery");
  let calls = 0;
  const recovery = createPlaywrightRecovery({
    installer: async () => ({ status: "installed", reason: null }),
  });

  await assert.rejects(
    recovery.run(async () => {
      calls += 1;
      throw missingChromiumError(syntheticWindowsPath("Users", "secret", "chrome.exe"));
    }, { stage: "critic" }),
    (error) => {
      assert.equal(error?.code, "PLAYWRIGHT_BROWSER_UNAVAILABLE");
      assert.deepEqual(error?.recovery, {
        schemaVersion: "1.0",
        stage: "critic",
        reason: "chromium_missing_after_retry",
        installStatus: "installed",
        installReason: null,
      });
      assert.doesNotMatch(JSON.stringify(error.recovery), /secret|chrome\.exe|stdout|stderr/i);
      assert.doesNotMatch(error.message, /secret|chrome\.exe/i);
      return true;
    },
  );
  assert.equal(calls, 2);
});

test("only exact evidence from a live recovery identity matches its unavailable stage", async () => {
  assert.equal(typeof recoveryModule.matchesLatchedUnavailableEvidence, "function");
  const forged = {
    snapshot: () => ({ unavailableStages: ["build"] }),
  };
  const evidence = {
    status: "unavailable",
    reason: "installer_nonzero",
    installStatus: "unavailable",
    installReason: "installer_nonzero",
  };
  assert.equal(recoveryModule.matchesLatchedUnavailableEvidence(forged, "build", evidence), false);

  const recovery = recoveryModule.createPlaywrightRecovery({
    installer: async () => ({ status: "unavailable", reason: "installer_nonzero" }),
  });
  assert.equal(recoveryModule.matchesLatchedUnavailableEvidence(recovery, "build", evidence), false);
  await assert.rejects(
    recovery.run(async () => {
      throw missingChromiumError();
    }, { stage: "build" }),
    (error) => isPlaywrightBrowserUnavailable(error),
  );
  assert.equal(recoveryModule.matchesLatchedUnavailableEvidence(recovery, "build", evidence), true);
  assert.equal(
    recoveryModule.matchesLatchedUnavailableEvidence(recovery, "build", {
      ...evidence,
      reason: "installer_timeout",
      installReason: "installer_timeout",
    }),
    false,
  );
  assert.equal(recoveryModule.matchesLatchedUnavailableEvidence(recovery, "critic", evidence), false);
});

test("typed unavailable recognition rejects forged unsanitized recovery metadata", () => {
  const forged = Object.assign(new Error("forged"), {
    code: "PLAYWRIGHT_BROWSER_UNAVAILABLE",
    recovery: {
      schemaVersion: "1.0",
      stage: "critic",
      reason: syntheticWindowsPath("private", "chrome.exe"),
      installStatus: "installed",
      installReason: null,
      rawException: "browserType.launch: secret path",
    },
  });
  assert.equal(isPlaywrightBrowserUnavailable(forged), false);
});

test("generic initial launch errors never install and retry programming errors propagate unchanged", async (t) => {
  const createPlaywrightRecovery = recoveryApi("createPlaywrightRecovery");

  await t.test("generic initial error", async () => {
    let installerCalls = 0;
    const initial = new Error("browserType.launch: Invalid launch configuration");
    const recovery = createPlaywrightRecovery({
      installer: async () => {
        installerCalls += 1;
        return { status: "installed", reason: null };
      },
    });
    await assert.rejects(recovery.run(async () => { throw initial; }, { stage: "build" }), (error) => error === initial);
    assert.equal(installerCalls, 0);
  });

  await t.test("retry programming error", async () => {
    const programming = new TypeError("fixture browser contract is broken");
    let calls = 0;
    const recovery = createPlaywrightRecovery({
      installer: async () => ({ status: "installed", reason: null }),
    });
    await assert.rejects(
      recovery.run(async () => {
        calls += 1;
        if (calls === 1) throw missingChromiumError();
        throw programming;
      }, { stage: "revise" }),
      (error) => error === programming,
    );
    assert.equal(calls, 2);
  });
});
