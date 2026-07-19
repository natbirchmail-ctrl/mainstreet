import assert from "node:assert/strict";
import path from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";

import {
  createTerminalPromptInterface,
  main,
  parseCli,
} from "../../bin/mainstreet.js";

function interviewAnswers() {
  return [
    { label: "Available services", value: "Bread and pastries", source: "user" },
    { label: "Hours", value: "Tuesday through Saturday", source: "user" },
    { label: "Vibe", value: "Warm and practical", source: "user" },
    { label: "Photos", value: "Storefront and product photos", source: "user" },
    { label: "Contact facts", value: "Call 928 555 0100", source: "user" },
    { label: "Customer value", value: "Consistent quality", source: "user" },
  ];
}

test("parseCli reads the fast intake command", () => {
  assert.deepEqual(
    parseCli([
      "intake",
      "Juniper Oven",
      "--city",
      "Flagstaff, AZ",
      "--details",
      "Known for naturally leavened bread",
      "--fast",
    ]),
    {
      command: "intake",
      positionals: ["Juniper Oven"],
      flags: {
        city: "Flagstaff, AZ",
        details: "Known for naturally leavened bread",
        fast: true,
      },
    },
  );
});

test("parseCli rejects unsupported flags", () => {
  assert.throws(
    () => parseCli(["intake", "Juniper Oven", "--mystery"]),
    /unknown option/i,
  );
});

test("parseCli reads a build slug", () => {
  assert.deepEqual(parseCli(["build", "juniper-oven"]), {
    command: "build",
    positionals: ["juniper-oven"],
    flags: {},
  });
});

test("parseCli reads an explicit preview port", () => {
  assert.deepEqual(parseCli(["serve", "juniper-oven", "--port", "4601"]), {
    command: "serve",
    positionals: ["juniper-oven"],
    flags: { port: "4601" },
  });
});

test("parseCli reads an explicit critic cycle", () => {
  assert.deepEqual(parseCli(["critique", "juniper-oven", "--cycle", "1"]), {
    command: "critique",
    positionals: ["juniper-oven"],
    flags: { cycle: "1" },
  });
});

test("parseCli reads a revision cycle", () => {
  assert.deepEqual(parseCli(["revise", "juniper-oven", "--cycle", "1"]), {
    command: "revise",
    positionals: ["juniper-oven"],
    flags: { cycle: "1" },
  });
});

test("parseCli reads a deploy slug", () => {
  assert.deepEqual(parseCli(["deploy", "juniper-oven"]), {
    command: "deploy",
    positionals: ["juniper-oven"],
    flags: {},
  });
});

test("parseCli reads the autonomous fast run command", () => {
  assert.deepEqual(parseCli(["run", "Juniper Oven", "--fast", "--max-cycles", "3"]), {
    command: "run",
    positionals: ["Juniper Oven"],
    flags: { fast: true, maxCycles: "3" },
  });
});

test("non fast intake interviews before creating and saving the strict brief", async () => {
  const answers = interviewAnswers();
  const runDir = path.resolve("virtual-runs", "juniper-oven");
  const promptInterface = { closeCalled: false, close() { this.closeCalled = true; } };
  let briefInput;
  let saved;
  let output = "";

  await main(["intake", "Juniper Oven", "--city", "Flagstaff, AZ"], {
    promptInterfaceFactory: () => promptInterface,
    conductOwnerInterviewFn: async (input) => {
      assert.equal(input.promptInterface, promptInterface);
      assert.equal(input.businessName, "Juniper Oven");
      return answers;
    },
    createBriefFn: async (input) => {
      briefInput = input;
      return { schemaVersion: "1.0" };
    },
    initializeRunFn: async () => ({ runDir }),
    writeJsonNewFn: async (target, value) => {
      saved = { target, value };
    },
    stdout: { write: (value) => { output += value; } },
  });

  assert.deepEqual(briefInput.interviewAnswers, answers);
  assert.equal(promptInterface.closeCalled, true);
  assert.deepEqual(saved, {
    target: path.resolve(runDir, "brief.json"),
    value: { schemaVersion: "1.0" },
  });
  assert.equal(output, `Brief saved: ${path.resolve(runDir, "brief.json")}\n`);
});

test("non fast run interviews before the pipeline and preserves progress output", async () => {
  const answers = interviewAnswers();
  const promptInterface = { closeCalled: false, close() { this.closeCalled = true; } };
  let briefInput;
  let pipelineInput;
  let output = "";

  await main(["run", "Juniper Oven"], {
    promptInterfaceFactory: () => promptInterface,
    conductOwnerInterviewFn: async () => answers,
    createBriefFn: async (input) => {
      briefInput = input;
      return { schemaVersion: "1.0" };
    },
    executePipelineFn: async (input) => {
      pipelineInput = input;
      input.onProgress({ type: "run_started", slug: "juniper-oven" });
      await input.createBriefFn({
        businessName: input.businessName,
        city: input.city,
        details: input.details,
        fast: input.fast,
      });
      input.onProgress({ type: "intake_complete", slug: "juniper-oven" });
      return { delivery: { url: "https://example.test" } };
    },
    stdout: { write: (value) => { output += value; } },
  });

  assert.equal(pipelineInput.fast, false);
  assert.deepEqual(briefInput.interviewAnswers, answers);
  assert.equal(promptInterface.closeCalled, true);
  assert.equal(
    output,
    "Run started: juniper-oven\nIntake brief complete.\nSite URL: https://example.test\n",
  );
});

test("fast intake and run never construct or call a prompt interface", async (t) => {
  const forbiddenPromptFactory = () => {
    throw new Error("fast mode attempted to create a prompt interface");
  };
  const forbiddenInterview = async () => {
    throw new Error("fast mode attempted an interview");
  };

  await t.test("intake", async () => {
    let briefInput;
    await main(["intake", "Juniper Oven", "--fast"], {
      promptInterfaceFactory: forbiddenPromptFactory,
      conductOwnerInterviewFn: forbiddenInterview,
      createBriefFn: async (input) => {
        briefInput = input;
        return { schemaVersion: "1.0" };
      },
      initializeRunFn: async () => ({ runDir: path.resolve("virtual-runs", "juniper-oven") }),
      writeJsonNewFn: async () => {},
      stdout: { write: () => {} },
    });
    assert.equal(briefInput.fast, true);
    assert.equal(briefInput.interviewAnswers, undefined);
  });

  await t.test("run", async () => {
    let pipelineInput;
    await main(["run", "Juniper Oven", "--fast"], {
      promptInterfaceFactory: forbiddenPromptFactory,
      conductOwnerInterviewFn: forbiddenInterview,
      executePipelineFn: async (input) => {
        pipelineInput = input;
        return { delivery: { url: "https://example.test" } };
      },
      stdout: { write: () => {} },
    });
    assert.equal(pipelineInput.fast, true);
    assert.equal(Object.hasOwn(pipelineInput, "createBriefFn"), false);
  });
});

test("cancelled intake closes the terminal and never creates a brief or run", async () => {
  const promptInterface = { closeCalled: false, close() { this.closeCalled = true; } };
  let creates = 0;

  await assert.rejects(
    main(["intake", "Juniper Oven"], {
      promptInterfaceFactory: () => promptInterface,
      conductOwnerInterviewFn: async () => {
        throw new Error("Interview cancelled before all six answers were confirmed.");
      },
      createBriefFn: async () => {
        creates += 1;
      },
      initializeRunFn: async () => {
        creates += 1;
      },
      stdout: { write: () => {} },
    }),
    /interview cancelled before all six answers were confirmed/i,
  );

  assert.equal(promptInterface.closeCalled, true);
  assert.equal(creates, 0);
});

test("terminal prompt rejects when its input reaches EOF", async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  const promptInterface = createTerminalPromptInterface({ input, output });
  try {
    const asking = promptInterface.ask({
      index: 1,
      total: 6,
      label: "Available services",
      question: "Which services are available?",
    });
    input.end();
    await assert.rejects(
      Promise.race([
        asking,
        new Promise((_, reject) => {
          setTimeout(() => reject(new Error("Terminal prompt did not reject on EOF.")), 100);
        }),
      ]),
      /aborted|closed/i,
    );
  } finally {
    promptInterface.close();
  }
});
