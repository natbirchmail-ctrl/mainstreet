# Mainstreet Quality Rebuild Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan.

**Goal:** Raise Mainstreet's generated sites to the approved quality law while preserving the existing autonomous name to URL pipeline.

**Architecture:** Keep intake, generation, capture, critique, bounded revision, selection, and deployment in their current order. Expand the generated site manifest with one owned script and a three to five image plan. Materialize immutable local PNG assets during generation or revision, capture three visual viewports plus a narrow mechanical probe, and derive ship eligibility from both the numeric critic score and explicit quality law gates.

**Tech Stack:** Node.js 22, OpenAI JavaScript SDK, Responses API, Images API, Playwright Chromium, Cloudflare Pages, Node test runner

---

## Execution constraints

- The executor is the Codex agent team, with the root agent owning integration, commits, and final claims. Helpers may perform bounded discovery and review; the root agent must consume their results and release every helper before closeout.
- The repository is already initialized on a clean `main` branch. The user explicitly authorized autonomous commits, OpenAI requests, Cloudflare deployment, and the final GitHub push for this hackathon mission.
- Work only in this repository. External design references remain read only.
- Keep secrets in the ignored `.env`; expose only variable names in `.env.example`.
- Never delete superseded artifacts. Existing run initialization moves them into ignored `.trash`.
- Keep the CLI and outer pipeline stage order unchanged.
- Follow test driven development for each behavior: add a focused failing test, run it and confirm the expected failure, implement the minimum complete behavior, then rerun the focused and full checks.
- Commit each completed slice with a clear timestamped message.
- Treat source review as a delivery fallback, never as evidence that a site may ship.
- Cap image work at five requests per cycle and three cycles per run. The OpenAI client keeps SDK retries disabled, so one pipeline execution can make at most fifteen image requests. The first regeneration pass across three examples can make at most forty five image requests. Record actual request and fallback counts in run evidence.
- A cycle that misses any ship gate may still become the best local fallback, but it must never replace the public Cloudflare alias.

## Pre execution commit

Before Task 1, stage and commit this reviewed plan:

```powershell
git add docs/superpowers/plans/2026-07-17-quality-rebuild-plan.md
git commit -m "docs: plan quality rebuild"
```

## Public data contracts

### Generated site manifest

The strict structured response contains exactly:

```json
{
  "indexHtml": "string",
  "stylesCss": "string",
  "scriptJs": "",
  "imagePlan": [
    {
      "filename": "workbench-hero.png",
      "role": "hero",
      "alt": "Mechanic adjusting a bicycle on a work stand",
      "prompt": "Contemporary neighborhood bicycle workshop scene",
      "focalPoint": { "x": 0.58, "y": 0.42 }
    }
  ],
  "designNotes": {
    "aesthetic": "string",
    "signatureMove": "string",
    "rationale": "string",
    "shootDirection": "string",
    "motionMoves": ["staged hero entrance"]
  }
}
```

`imagePlan` has three to five unique lowercase PNG filenames. `motionMoves` has one or two distinct values from the exact published enum. Every planned image appears once or more in semantic HTML with the exact planned alt text.

The model returns an empty `scriptJs` sentinel. Mainstreet replaces it with a deterministic owned motion runtime derived only from the validated `motionMoves`. The runtime supports the stable `data-motion-root`, `data-motion-control`, `data-motion-panel`, `data-section`, `data-first-beat`, and `data-primary-action` contracts. Arbitrary model JavaScript never reaches disk.

### Cycle asset evidence

Each cycle writes `assets.json`:

```json
{
  "schemaVersion": "1.0",
  "allResolved": true,
  "files": [
    {
      "filename": "workbench-hero.png",
      "path": "assets/workbench-hero.png",
      "role": "hero",
      "alt": "Mechanic adjusting a bicycle on a work stand",
      "focalPoint": { "x": 0.58, "y": 0.42 },
      "promptHash": "sha256",
      "mediaType": "image/png",
      "bytes": 123456,
      "sha256": "sha256",
      "source": "openai",
      "resolved": true,
      "errorCode": null
    }
  ]
}
```

Provider errors are reduced to a stable local code. They never include a provider response, path, credential, or prompt. A deterministic PNG fallback keeps the site complete but sets `resolved: false`, which makes the cycle ineligible to ship.

### Critic quality laws

The structured critic response contains these required law results:

- `headlineDiscipline`
- `foldComposition`
- `completeLayouts`
- `firstBeatVisibility`
- `imageContrast`
- `motionRestraint`
- `imageryCoherence`
- `factualRestraint`

Each result has `status` (`pass`, `fail`, or `unverified`), viewport tagged evidence entries, and a concrete fix. The visual laws require desktop, tablet, and phone evidence; missing coverage becomes `unverified`. Normalization derives `lawGatePassed`, `lawGateFailures`, `shipEligible`, `hardGateFailures`, `score`, and `verdict`. A cycle ships only when score is at least 85, no major issue exists, mechanics explicitly pass, assets are resolved, the review used vision evidence, and every law status is `pass`.

## Task 1: Expand and secure the generated site contract

**Files:**

- Modify: `prompts/schemas/site.schema.json`
- Modify: `prompts/build-system.md`
- Modify: `src/build.js`
- Modify: `test/unit/build.test.js`

**Red tests:**

1. Update the safe manifest fixture with `scriptJs`, three planned images, the expanded design notes, matching `<img>` tags, one deferred `<script src="script.js">`, and a self only CSP.
2. Assert the strict schema requires exactly the five top level fields, requires an empty `scriptJs` sentinel from the model, and validates all nested fields.
3. Assert one deferred local script and planned local PNG images pass.
4. Assert Mainstreet replaces the empty sentinel with the exact deterministic runtime for the selected motion moves and rejects any other script bytes.
5. Table test asset rejection: unplanned or unused assets, missing or mismatched alt text, duplicate or case colliding names, traversal, absolute paths, backslashes, percent encoding, entities, queries, hashes, `srcset`, non PNG extensions, and Windows device names.
6. Assert visible copy still rejects dashes, emoji, placeholders, and invented placeholder contact data.
7. Reject unknown or duplicate motion moves and require one or two distinct values from: `pinned chapter passage`, `horizontal click reel`, `numbered story stepper`, `staged hero entrance`, and `gentle one direction scroll reveals`.
8. Require every section to declare `data-section` with one visible `data-first-beat`; require interactive reel or stepper markup to use buttons with `data-motion-control` and matching `data-motion-panel` elements.
9. Reject missing, duplicate, permissive, `data:`, or `blob:` Content Security Policies.

Run:

```powershell
node --test test/unit/build.test.js
```

Expected red result: the current three field schema and blanket script rejection fail the new contract tests.

**Implementation:**

1. Expand the JSON schema with strict nested objects, length limits, focal coordinates from zero through one, and one to two distinct enum motion moves.
2. Split manifest validation into narrow helpers for HTML, script, image plan, design notes, and copy.
3. Allow exactly one empty body deferred `script.js` tag.
4. Permit image references only as `assets/<planned-name>.png` in `<img>` elements.
5. Keep CSS `url()`, remote URLs, data URLs, inline handlers, embeds, forms, and `srcset` forbidden.
6. Require a CSP that permits only owned stylesheet, script, and images.
7. Update the builder prompt in this same slice so its response contract no longer contradicts the schema. Reserve the full quality law prose for Task 7.

**Green checks:**

```powershell
node --test test/unit/build.test.js
npm run check
```

**Commit:**

```powershell
git add prompts/schemas/site.schema.json prompts/build-system.md src/build.js test/unit/build.test.js
git commit -m "feat: expand generated site contract"
```

## Task 2: Materialize immutable local images and script files

**Files:**

- Create: `src/assets.js`
- Create: `src/motion.js`
- Modify: `src/lib/openai.js`
- Modify: `src/build.js`
- Modify: `src/serve.js`
- Modify: `test/unit/openai.test.js`
- Modify: `test/unit/build.test.js`
- Modify: `test/unit/serve.test.js`

**Red tests:**

1. `requestImage` calls `client.images.generate` with the configured model, PNG output, landscape size, and medium quality, then returns a structurally validated PNG buffer.
2. Empty or malformed image responses fail with a sanitized stable error.
3. Asset materialization writes successful siblings even when one request fails.
4. A failed request writes a stable, valid, nonempty deterministic PNG and marks only that asset unresolved.
5. Asset records contain byte length, SHA256, prompt hash, local source state, and no provider content.
6. `writeSiteFiles` writes `index.html`, `styles.css`, and `script.js` immutably.
7. `buildRun` writes `assets.json` and includes the image plan plus resolution summary in `build.json`.
8. Local preview serves JavaScript as JavaScript and PNG as `image/png` under `nosniff`.
9. PNG validation rejects truncated signatures, invalid IHDR dimensions, missing IDAT or IEND chunks, length mismatches, and CRC mismatches.
10. The materializer never exceeds five image calls in a cycle and records request, success, and fallback counts.
11. The owned motion runtime has exact snapshot tests and no model controlled executable bytes.

Run:

```powershell
node --test test/unit/openai.test.js test/unit/build.test.js test/unit/serve.test.js
```

Expected red result: no image adapter, binary writer, script file, or asset evidence exists.

**Implementation:**

1. Add `requestImage({ client, model, prompt })` using `OPENAI_IMAGE_MODEL || "gpt-image-1"`, `1536x1024`, medium quality, and PNG output.
2. Parse the PNG chunk stream and validate signature, IHDR, dimensions, IDAT, IEND, lengths, and CRCs before marking provider bytes resolved.
3. Add a deterministic PNG renderer based on a stable hash of the plan item. It must emit real PNG bytes, not disguised SVG or a data URL.
4. Materialize assets sequentially to bound memory and rate pressure.
5. Write all source and binary files with exclusive create semantics.
6. Write `assets.json` only after every planned file has a complete record.
7. Generate the canonical motion runtime from the validated motion enum and stable data attributes.
8. Add `.js` MIME support and a self only script CSP to the local server.

**Green checks:**

```powershell
node --test test/unit/openai.test.js test/unit/build.test.js test/unit/serve.test.js
npm run check
```

**Commit:**

```powershell
git add src/assets.js src/motion.js src/lib/openai.js src/build.js src/serve.js test/unit/openai.test.js test/unit/build.test.js test/unit/serve.test.js
git commit -m "feat: generate owned visual assets"
```

## Task 3: Upgrade the deterministic failure ladder

**Files:**

- Modify: `src/build.js`
- Modify: `test/unit/build.test.js`

**Red tests:**

1. When structured site generation fails, the fallback manifest contains a coherent three image plan, one calm local script, matching semantic image markup, and the expanded design notes.
2. When site generation and all image calls fail, cycle one still contains valid HTML, CSS, script, three PNG files, `assets.json`, and honest fallback records.
3. The fallback site passes every deterministic source safety check without inventing public facts.

Run:

```powershell
node --test test/unit/build.test.js
```

Expected red result: the current fallback returns the obsolete three field manifest.

**Implementation:**

1. Recompose the fallback as a restrained editorial site with real image slots, strong responsive composition, complete content at first paint, and a staged hero entrance plus gentle one way reveals.
2. Keep the script small, dependency free, keyboard safe, and complete when JavaScript never runs.
3. Preserve factual restraint by using only brief facts and explicit unknown handling.

**Green checks:**

```powershell
node --test test/unit/build.test.js
npm run check
```

**Commit:**

```powershell
git add src/build.js test/unit/build.test.js
git commit -m "feat: strengthen the build failure ladder"
```

## Task 4: Carry visual assets through bounded revision

**Files:**

- Modify: `src/assets.js`
- Modify: `src/revise.js`
- Modify: `prompts/revise-system.md`
- Modify: `test/unit/revise.test.js`

**Red tests:**

1. The revision model receives HTML, CSS, script, image plan, design notes, asset catalog, critique, and mechanical evidence.
2. Unchanged image plan entries copy byte for byte into the next immutable cycle without calling the image provider.
3. A changed prompt or new filename regenerates only the changed asset.
4. An unresolved prior fallback is retried rather than copied into the next cycle.
5. Missing or hash mismatched prior assets fail closed and never become resolved records.
6. The previous cycle remains byte identical.
7. The revised cycle writes its own `assets.json` and expanded `build.json`.

Run:

```powershell
node --test test/unit/revise.test.js
```

Expected red result: revision reads and writes only HTML and CSS.

**Implementation:**

1. Read the prior script, image plan, and asset catalog.
2. Pass only sanitized asset descriptors to the revision model.
3. Compare each revised item by safe filename and prompt hash.
4. Copy only records whose prior digest verifies and whose `resolved` value is true.
5. Generate only new or changed items through the same materializer.
6. Retry every unresolved prior item within the new cycle's five request cap.
7. Update the handoff language to require local assets, restrained motion, and every accessibility safeguard.

**Green checks:**

```powershell
node --test test/unit/revise.test.js
npm run check
```

**Commit:**

```powershell
git add src/assets.js src/revise.js prompts/revise-system.md test/unit/revise.test.js
git commit -m "feat: preserve assets across critique cycles"
```

## Task 5: Add tablet proof and deterministic rendered gates

**Files:**

- Modify: `src/critic.js`
- Modify: `test/unit/critic.test.js`

**Red tests:**

1. Capture writes desktop `1440x900`, tablet `1024x768`, and phone `390x844` screenshots.
2. The narrow `320x800` probe remains mechanical only.
3. The vision request contains one text packet followed by three fresh images in desktop, tablet, phone order.
4. Overflow at desktop, tablet, phone, or narrow fails mechanics.
5. Broken images, page errors, console errors, or external requests fail mechanics.
6. For every section, normal, reduced motion, and JavaScript disabled probes scroll the section start to the viewport start, then require its `data-first-beat` box to have nonzero dimensions, visible display and visibility, opacity of at least 0.95, and intersection with the upper two thirds of the viewport.
7. Touch size applies only to `[data-primary-action]` and `[data-motion-control]`; each must measure at least 44 by 44 CSS pixels on tablet and phone.
8. Keyboard probes focus every `[data-motion-control]`, activate it with Enter and Space, and require the matching panel state to change. Touch probes click each control and require the same state change.
9. A missing `assets.json` or a browser broken image fails mechanics. An unresolved asset remains a separate asset gate and does not change `mechanical.passed`.
10. Normal, reduced motion, and JavaScript disabled evidence runs at desktop, tablet, and phone. Only the normal context produces critic screenshots.
11. Every declared move has a rendered state contract. In normal mode its `[data-motion-root]` must reach `data-motion-state="active"` after the relevant load, scroll, or control action. Pinned passage must also change normalized `data-motion-progress`; reels and steppers must change the selected panel; staged entrance and gentle reveals must expose every target after activation.
12. In reduced motion mode every declared root must reach `data-motion-state="disabled"`, every target must remain visible, and computed animation and transition durations must be no more than 0.01 milliseconds. Add one failing fixture per move so all five enum values prove both normal activation and reduced motion fallback before a cycle becomes eligible.

Run:

```powershell
node --test test/unit/critic.test.js
```

Expected red result: capture emits two screenshots, sends two images, and ignores narrow and touch failures.

**Implementation:**

1. Add the tablet viewport and screenshot manifest entry.
2. Capture request, console, page error, image decode, first beat visibility, primary target, and interaction evidence without exposing local paths.
3. Refactor mechanical collection to iterate normal, reduced motion, and JavaScript disabled contexts at the three visual viewports plus the narrow overflow probe.
4. Keep `mechanicalPassed` and `assetsResolved` as separate evidence fields.

**Green checks:**

```powershell
node --test test/unit/critic.test.js
npm run check
```

**Commit:**

```powershell
git add src/critic.js test/unit/critic.test.js
git commit -m "feat: capture tablet and rendered quality proof"
```

## Task 6: Enforce explicit quality laws in critique and selection

**Files:**

- Modify: `prompts/schemas/critique.schema.json`
- Modify: `src/critic.js`
- Modify: `src/pipeline.js`
- Modify: `test/unit/critic.test.js`
- Modify: `test/unit/pipeline.test.js`

**Red tests:**

1. A score above 85 with one failed or unverified law remains `revise`.
2. A score above 85 with all laws passed but a major issue remains `revise`.
3. Source fallback is always ineligible to ship.
4. `hardGateFailures` names every failed law and mechanical or asset gate.
5. Fold composition, first beat visibility, image contrast, and imagery coherence require desktop, tablet, and phone evidence entries; missing viewport coverage normalizes to `unverified`.
6. Pipeline stops early only on a derived ship verdict.
7. Selection prefers the highest scoring fully eligible cycle, then the highest scoring cycle with `mechanicalPassed === true` when no cycle ships, and finally the highest score as the local failure ladder.
8. `mechanicalPassed: null` is never considered mechanically safe.

Run:

```powershell
node --test test/unit/critic.test.js test/unit/pipeline.test.js
```

Expected red result: the current normalizer considers only score and major issues.

**Implementation:**

1. Expand the strict critic schema with the eight named laws and viewport tagged evidence objects.
2. Derive score, law gate, hard gate, failures, and verdict locally.
3. Require `mechanical.passed === true`, `assetsResolved === true`, complete viewport evidence, and vision mode for `shipEligible`.
4. Keep the raw visual score intact when a gate fails so revisions remain comparable.
5. Preserve bounded three cycle behavior and the current progress event order.

**Green checks:**

```powershell
node --test test/unit/critic.test.js test/unit/pipeline.test.js
npm run check
```

**Commit:**

```powershell
git add prompts/schemas/critique.schema.json src/critic.js src/pipeline.js test/unit/critic.test.js test/unit/pipeline.test.js
git commit -m "feat: make design laws hard ship gates"
```

## Task 7: Rewrite builder and critic instructions in fresh public language

**Files:**

- Modify: `prompts/build-system.md`
- Modify: `prompts/critic-system.md`
- Modify: `prompts/critic-source-system.md`
- Modify: `prompts/revise-system.md`
- Modify: `test/unit/prompts.test.js`

**Red tests:**

1. Add prompt contract tests for the copy, composition, motion, imagery, factual restraint, and viewport requirements.
2. Assert the builder chooses one or two named motion moves.
3. Assert the critic names and judges all eight hard laws.
4. Assert source review marks visual only laws unverified and never recommends ship.
5. Assert no prompt contains private paths, source names, example customer names, or copied provenance language.

Run:

```powershell
node --test test/unit/prompts.test.js
```

Expected red result: the current prompts forbid the new asset contract and use a general aesthetics rubric.

**Implementation:**

1. Write a compact quality law section where headings identify, body text explains, and actions direct.
2. Require no more than two meaningful words in primary section headings.
3. Define fold composition, unit centered headings, count aware layouts, visible first beats, readable overlays, and no animation gated content.
4. Define the five named motion moves and require a calm choice of one or two.
5. Require one contemporary commissioned shoot direction with deliberate focal crops and no false documentary framing.
6. Make the critic use the same laws, cite viewport evidence, and prescribe concrete revisions.

**Green checks:**

```powershell
node --test test/unit/prompts.test.js
npm run check
```

**Commit:**

```powershell
git add prompts/build-system.md prompts/critic-system.md prompts/critic-source-system.md prompts/revise-system.md test/unit/prompts.test.js
git commit -m "feat: encode the Mainstreet quality law"
```

## Task 8: Verify complete deployed site bytes

**Files:**

- Modify: `src/deploy.js`
- Modify: `test/unit/deploy.test.js`

**Red tests:**

1. Build a deterministic digest manifest for every deployed file in sorted relative path order.
2. Verify canonical responses for HTML, CSS, script, and each image.
3. A missing or stale asset makes deployment verification fail even when `index.html` matches.
4. Deployment records use one safe allowlist: `schemaVersion`, `mode`, `slug`, `selectedCycle`, `commit`, `url`, `immutableUrl`, `createdAt`, `status`, `verified`, `aggregateSha256`, and `files`. Each file entry contains only relative `path`, `bytes`, `sha256`, `status`, and `verified`.
5. The allowlisted record binds the public result to its slug, selected cycle, aggregate digest, per file digests, and Git commit identity.
6. A non eligible selected cycle skips Cloudflare and returns a clearly labeled local preview URL.

Run:

```powershell
node --test test/unit/deploy.test.js
```

Expected red result: current verification hashes only `index.html`.

**Implementation:**

1. Enumerate the selected site recursively with strict relative path validation.
2. Hash every file and record a stable aggregate digest.
3. Refuse Cloudflare promotion unless the selected critique says `shipEligible: true`.
4. Fetch and compare every canonical file after Cloudflare promotion.
5. Preserve the local serve fallback when credentials are absent or the selected cycle is not eligible.

**Green checks:**

```powershell
node --test test/unit/deploy.test.js
npm run check
```

**Commit:**

```powershell
git add src/deploy.js test/unit/deploy.test.js
git commit -m "feat: verify complete deployed site bytes"
```

## Task 9: Update public configuration and security documentation

**Files:**

- Modify: `.env.example`
- Modify: `SECURITY.md`
- Modify: `README.md`
- Modify: `DEMO.md`
- Create: `tools/release-check.js`
- Create: `test/unit/release-check.test.js`
- Modify: `package.json`

**Work:**

1. Add `OPENAI_IMAGE_MODEL=gpt-image-1` to `.env.example`.
2. Replace the obsolete HTML and CSS only security claim with the owned local script and PNG policy.
3. Add a README design section explaining the copy law, composition law, motion vocabulary, coherent imagery, critic hard gates, and deterministic fallbacks.
4. Update architecture and artifact tree examples for three screenshots, `script.js`, `assets/`, and `assets.json`.
5. Keep run scores, selected cycle numbers, and screenshot paths marked for update only after regeneration; do not invent results.
6. Update the demo shot list to show the three viewport critic evidence and quality law improvement.
7. Add `npm run release:check`. The script fails closed on tracked or historical `.env` files, secret shaped assignments, absolute local machine paths, confidential source terms, forbidden ignored directories, missing example artifacts, inconsistent score or cycle references, and any selected cycle that lacks explicit mechanics, asset, law, and vision evidence.
8. Test both clean fixtures and each forbidden pattern. The script reports only relative paths and rule identifiers, never matching secret text.
9. If the scanner finds a secret or confidential reference, stop before push and identify whether it exists only in unpushed local commits or has already reached a public remote. Rotate every exposed credential before further release work. Never force push or rewrite history without new explicit user approval; preserve evidence and report the exact safe remediation path.

**Checks:**

```powershell
npm run check
npm run release:check
git diff --check
```

**Commit:**

```powershell
git add .env.example SECURITY.md README.md DEMO.md tools/release-check.js test/unit/release-check.test.js package.json
git commit -m "docs: explain the quality system"
```

## Task 10: Regenerate and visually review the three examples

**Files:**

- Replace through the CLI: `runs/harborlight-flower-studio/`
- Replace through the CLI: `runs/juniper-oven/`
- Replace through the CLI: `runs/canyon-wheelworks/`
- Modify after evidence exists: `README.md`
- Modify after evidence exists: `DEMO.md`

**Preflight:**

```powershell
npm run check
git status --short --branch
```

Confirm `.env` exists and both API clients can initialize without printing secret values. The mission already authorizes the bounded OpenAI requests and Cloudflare promotion. Existing same slug runs must move automatically into ignored `.trash`; record and verify one timestamped archive for each replaced slug.

**Runs:**

```powershell
npm run mainstreet -- run "Harborlight Flower Studio" --fast
npm run mainstreet -- run "Juniper Oven" --fast
npm run mainstreet -- run "Canyon Wheelworks" --city "Tucson, AZ" --details "Neighborhood bicycle repair for commuters. Walk in service is welcome." --fast
```

For each run, inspect every cycle's desktop, tablet, and phone screenshots. Confirm:

- the chosen aesthetic fits the business
- the first fold composes as a complete idea
- primary headings contain no more than two meaningful words
- repeating content has no empty slots
- imagery looks like one contemporary shoot
- crops keep their focal subject
- text over images remains readable
- one or two motion moves work calmly
- the no JavaScript and reduced motion states reveal all content
- the final evidence and scores match the rendered site

If any selected example still looks weak, diagnose the prompt, validator, asset, capture, or critic cause; add a regression test; fix the system; then rerun that example. Never hand edit a generated run to improve its screenshot.

**Evidence checks:**

```powershell
npm run check
git diff --check
git status --short --branch
```

Derive numerical scores, verdicts, selected cycles, and law states from JSON. Derive visual, crop, motion, reduced motion, and no JavaScript claims from the screenshots and runtime probes.

Before staging, run the release scanner against every generated brief, build record, asset record, critique, revision handoff, report, screenshot metadata record, and deployment record. Fail on owner facts, credentials, provider responses, local paths, confidential source terms, or unrelated customer data. Stage only the three named run directories and the two updated public documents. Confirm no unrelated run deletion appears in `git status`.

Run the example completeness audit and require each selected cycle to contain source, assets, three screenshots, mechanics, asset resolution, all eight laws, score, revision history when applicable, selection record, and deployment disposition.

**Commit:**

```powershell
git add runs/harborlight-flower-studio runs/juniper-oven runs/canyon-wheelworks README.md DEMO.md
git commit -m "evidence: regenerate quality reviewed examples"
```

## Task 11: Deploy, disconfirm, and close the public release

**Deployment:**

Canyon Wheelworks runs last so the shared alias ends on the demo site only if its selected cycle is ship eligible. If it is eligible but does not own the alias, promote it explicitly:

```powershell
npm run mainstreet -- deploy canyon-wheelworks
```

**Disconfirming probes:**

1. Fetch every file named in the newest deployment digest and compare bytes.
2. Load the public URL at desktop, tablet, phone, and reduced motion settings.
3. Disable JavaScript and confirm all content remains visible and usable.
4. Watch console, page errors, and network requests; fail on any external request or runtime error.
5. Probe 320 pixel width for horizontal overflow.
6. Confirm current README scores, cycle numbers, screenshot links, and live URL match stored evidence.
7. Search the full tracked tree and history for secret patterns, local machine paths, confidential source terms, and `.env`. On any hit, stop before push, rotate exposed credentials, and classify the affected history as local only or already public. Do not force push or rewrite history without new explicit approval.
8. Confirm `.trash`, `.env`, `node_modules`, `.wrangler`, and `tmp` are untracked.
9. Confirm the deployment record binds the example slug, selected cycle, current commit, aggregate digest, per file digests, and verified canonical responses.
10. Confirm each spawned helper has completed, its result has been consumed, and no helper remains running.
11. Keep the previous verified immutable Pages URL and deployment record as the rollback target. If the shared alias probe fails, redeploy that preserved site directory and repeat the complete byte check.

**Final commands:**

```powershell
npm run check
npm run release:check
git diff --check
git status --short --branch
git log --oneline --decorate -12
```

Run the repository's complete release check, then push `main` only after every probe passes.

**Final commit if evidence changed during deployment:**

```powershell
git add runs/harborlight-flower-studio runs/juniper-oven runs/canyon-wheelworks README.md DEMO.md
git commit -m "release: verify Mainstreet quality rebuild"
```

## Definition of done

- `mainstreet run "<business name>" --fast` reaches a deployed or locally served URL with no later user input.
- Every selected cycle contains HTML, CSS, script, three to five local PNGs, an asset manifest, three screenshots, mechanics, critic laws, and deployment evidence.
- The three committed examples show honest score paths and improved visual results.
- A ship verdict is impossible without score, issue, mechanical, asset, and law gates.
- README, DEMO, SECURITY, configuration, and live evidence agree.
- The public URL serves the exact committed selected site and only a ship eligible cycle can replace the alias.
- Tests, rendered review, reduced motion, no JavaScript, security scan, history scan, and repository hygiene all pass.
