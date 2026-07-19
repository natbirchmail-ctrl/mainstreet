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
      shell: false,
      stdio: "ignore",
      timeout: 45_000,
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
  assert.equal(invocation.options.shell, false);
});

test("Windows command builder uses fixed tokens and a safe command processor fallback", () => {
  assert.equal(typeof recoveryModule.createNpxInvocation, "function");
  assert.deepEqual(
    recoveryModule.createNpxInvocation({
      platform: "win32",
      commandProcessor: syntheticWindowsPath("Trusted", "cmd.exe"),
      action: "version",
    }),
    {
      command: syntheticWindowsPath("Trusted", "cmd.exe"),
      args: ["/d", "/s", "/c", "npx.cmd", "--version"],
    },
  );
  assert.deepEqual(
    recoveryModule.createNpxInvocation({
      platform: "win32",
      commandProcessor: "",
      action: "install",
    }),
    {
      command: syntheticWindowsPath("Windows", "System32", "cmd.exe"),
      args: ["/d", "/s", "/c", "npx.cmd", "playwright", "install", "chromium"],
    },
  );
});

test("synchronous Windows spawn EINVAL is sanitized as installer start failure", async () => {
  const installPlaywrightChromium = recoveryApi("installPlaywrightChromium");
  const result = await installPlaywrightChromium({
    platform: "win32",
    commandProcessor: syntheticWindowsPath("Windows", "System32", "cmd.exe"),
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

test("installer returns sanitized typed outcomes for missing command nonzero exit and timeout", async (t) => {
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
    {
      name: "timeout",
      emit: (child) => child.emit("close", null, "SIGTERM"),
      expected: { status: "unavailable", reason: "installer_timeout" },
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
