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
      /full page/i,
      /full page[^.]*reduced motion/i,
      /rendered mechanical/i,
      /reduced motion/i,
      /no JavaScript/i,
      /missing[^.]*unverified/i,
      /score[^.]*cannot override/i,
      /do not require[^.]*forms/i,
      /absent from the brief/i,
      /available on page content/i,
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
      /do not require[^.]*forms/i,
      /contact channels?[^.]*absent from the brief/i,
      /available on page content/i,
    ],
    "source critic",
  );
});

test("each public prompt is business agnostic and free of source provenance", async () => {
  const privateSourceTerms = [
    ["BSC", "Workspace"].join("-"),
    ["local", "sites"].join("-"),
    ["naz", "site", "factory"].join("-"),
    ["Claude", "Design"].join(""),
    ["Broadside", "Code"].join(" "),
    ["Northern", "Arizona", "Design"].join(" "),
    ["Ranch", "House", "Cafe"].join(" "),
    ["private", "workspace"].join(" "),
    ["copied", "from"].join(" "),
    ["production", "reference"].join(" "),
  ];
  const exampleNameParts = [
    ["Harborlight", "Flower", "Studio"],
    ["Juniper", "Oven"],
    ["Canyon", "Wheelworks"],
  ];
  const exampleBusinessTerms = exampleNameParts.flatMap((parts) => [
    parts.join(" "),
    parts.join("-"),
  ]);
  const machinePathPatterns = [
    /[A-Za-z]:[\\/]/,
    /\\\\[^\\\s]+\\[^\\\s]+/,
    /(?:^|[\s("'\x60])(?:~\/|\/(?:Users|home|mnt|opt|private|tmp|Volumes)\/)/m,
  ];

  for (const name of promptNames) {
    const prompt = await readPrompt(name);
    for (const pattern of machinePathPatterns) {
      assert.doesNotMatch(prompt, pattern, name + " must not contain a machine path");
    }
    const normalized = prompt.toLocaleLowerCase("en-US");
    for (const term of [...privateSourceTerms, ...exampleBusinessTerms]) {
      assert.equal(
        normalized.includes(term.toLocaleLowerCase("en-US")),
        false,
        name + " must not contain a denylisted provenance term",
      );
    }
  }
});
