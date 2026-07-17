import assert from "node:assert/strict";
import test from "node:test";

import { parseCli } from "../../bin/mainstreet.js";

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
