import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const promptRoot = new URL("../../prompts/", import.meta.url);
const promptNames = [
  "build-system.md",
  "revise-system.md",
  "critic-system.md",
  "critic-source-system.md",
];

async function readPrompt(name) {
  return readFile(new URL(name, promptRoot), "utf8");
}

function assertIncludesAll(text, patterns, label) {
  for (const pattern of patterns) {
    assert.match(text, pattern, `${label} must encode ${pattern}`);
  }
}

test("builder encodes the complete quality law and calm motion vocabulary", async () => {
  const prompt = await readPrompt("build-system.md");

  assertIncludesAll(
    prompt,
    [
      /headings? identif/i,
      /body (?:copy )?explain/i,
      /actions? direct/i,
      /two meaningful words/i,
      /testimonials?/i,
      /ratings?/i,
      /compose[^.]*fold/i,
      /centered heading block/i,
      /empty (?:grid )?slots?/i,
      /first beat[^.]*upper two thirds/i,
      /commissioned shoot/i,
      /focal (?:point|crop)/i,
      /false historical|fake historical/i,
      /choose (?:only )?one or two/i,
    ],
    "builder",
  );

  for (const move of [
    "pinned chapter passage",
    "horizontal click reel",
    "numbered story stepper",
    "staged hero entrance",
    "gentle one direction scroll reveals",
  ]) {
    assert.match(prompt, new RegExp(move, "i"));
  }
});

test("revision instructions preserve the same taste system", async () => {
  const prompt = await readPrompt("revise-system.md");

  assertIncludesAll(
    prompt,
    [
      /headings? identif/i,
      /body (?:copy )?explain/i,
      /actions? direct/i,
      /two meaningful words/i,
      /centered heading block/i,
      /empty (?:grid )?slots?/i,
      /first beat[^.]*upper two thirds/i,
      /commissioned shoot/i,
      /focal (?:point|crop)/i,
      /one or two[^.]*motion/i,
      /unchanged assets?/i,
    ],
    "revision",
  );
});

test("vision critic judges every hard law with three viewport evidence", async () => {
  const prompt = await readPrompt("critic-system.md");

  for (const law of [
    "headline discipline",
    "fold composition",
    "complete layouts",
    "first beat visibility",
    "image contrast",
    "motion restraint",
    "imagery coherence",
    "factual restraint",
  ]) {
    assert.match(prompt, new RegExp(law, "i"), `critic must name ${law}`);
  }
  assertIncludesAll(
    prompt,
    [
      /desktop, tablet, and phone/i,
      /viewport tagged evidence/i,
      /missing[^.]*unverified/i,
      /score[^.]*cannot override/i,
    ],
    "vision critic",
  );
});

test("source critic never claims visual proof or recommends shipping", async () => {
  const prompt = await readPrompt("critic-source-system.md");

  assertIncludesAll(
    prompt,
    [
      /source fallback/i,
      /never (?:recommend )?ship/i,
      /visual[^.]*unverified/i,
      /fold composition/i,
      /first beat visibility/i,
      /image contrast/i,
      /imagery coherence/i,
    ],
    "source critic",
  );
});

test("public prompts contain no machine paths or private provenance", async () => {
  const prompts = await Promise.all(promptNames.map(readPrompt));
  const combined = prompts.join("\n");

  assert.doesNotMatch(combined, /[A-Za-z]:\\/);
  assert.doesNotMatch(combined, /\bprivate workspace\b/i);
  assert.doesNotMatch(combined, /\bcopied from\b/i);
  assert.doesNotMatch(combined, /\bproduction reference\b/i);
});
