import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { access, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import {
  initializeRun,
  resolveInside,
  writeJsonNew,
} from "../../src/lib/runs.js";

const projectRoot = process.cwd();

test("resolveInside rejects traversal outside an owned root", () => {
  const root = path.join(projectRoot, "tmp", randomUUID());
  assert.throws(() => resolveInside(root, "..", "escape"), /outside the owned root/i);
});

test("initializeRun archives an existing run instead of deleting it", async () => {
  const id = randomUUID();
  const runsRoot = path.join(projectRoot, "tmp", id, "runs");
  const trashRoot = path.join(projectRoot, "tmp", id, "trash");

  const first = await initializeRun({
    slug: "juniper-oven",
    runsRoot,
    trashRoot,
    now: () => new Date("2026-07-17T12:00:00.000Z"),
  });
  await writeFile(path.join(first.runDir, "proof.txt"), "preserve me", "utf8");

  const second = await initializeRun({
    slug: "juniper-oven",
    runsRoot,
    trashRoot,
    now: () => new Date("2026-07-17T12:01:00.000Z"),
  });

  assert.equal(second.runDir, first.runDir);
  const archived = path.join(
    trashRoot,
    "2026-07-17T12-01-00-000Z-juniper-oven",
    "proof.txt",
  );
  assert.equal(await readFile(archived, "utf8"), "preserve me");
  await access(second.runDir);
});

test("writeJsonNew refuses to overwrite evidence", async () => {
  const root = path.join(projectRoot, "tmp", randomUUID());
  const target = resolveInside(root, "brief.json");
  await writeJsonNew(target, { version: 1 });
  await assert.rejects(writeJsonNew(target, { version: 2 }), /already exists/i);
});
