# Mainstreet Decisions

This file records autonomous decisions, assumptions, fallbacks, and deviations made during the build.

## Execution contract

### Done test

1. `mainstreet run "Any Business" --fast` produces a complete site and prints a reachable Cloudflare Pages URL or `http://127.0.0.1:4601/` without further input.
2. A real run preserves a brief, generated source, desktop and mobile screenshots, structured critiques, revisions, scores, and a final deployment record.
3. Three committed example runs each contain two or more scored cycles and evidence that the final score is higher than the initial score.
4. Automated tests cover the CLI, intake, generation contracts, critic loop, revision limits, static serving, deployment fallback, path safety, and secret exclusion.
5. The generated examples pass source and rendered checks for design, accessibility, SEO, performance, browser behavior, and security with no open medium or higher finding.
6. Git history is on `main`, contains no secrets or private workspace references, and the working tree is clean.

### Scope

In scope: the isolated Mainstreet repository, its CLI pipeline, model prompts, test seams, three example runs, local and Cloudflare delivery, public documentation, and judging proof.

Out of scope: modifying the production factory, importing production customer content, changing the existing business process, DNS changes, and hard deletion.

### Assumptions

- ASSUMPTION: `plan.md` is the approved product design. The explicit autonomous build instruction replaces any additional design approval gate.
- ASSUMPTION: plain ESM JavaScript on Node.js 22 or newer is the fastest reliable clean-room implementation.
- ASSUMPTION: helper agents may inspect, research, and verify, but only this root Codex session authors repository files.
- ASSUMPTION: every cleanup target moves under `.trash/`; nothing is hard-deleted.
- ASSUMPTION: absent Cloudflare credentials select the documented local server fallback and do not fail a run.
- DECISION: port 4601 is the static preview and fallback server. Port 4600 remains reserved for the optional local UI. This resolves the contradictory fallback URL in the original plan.
- DECISION: the OpenAI SDK runs with automatic retries disabled. Mainstreet owns one bounded ladder of three total attempts so latency and cost do not multiply invisibly.
- DECISION: fast intake may infer positioning and design direction, but it never publishes invented phone numbers, email addresses, street addresses, or hours. Unknown precise facts remain null and are recorded as needed.
- DECISION: the build model returns a bounded two file site manifest plus design notes. Deterministic gates reject active content, remote assets, placeholders, emojis, visible dashes, and incomplete semantics before any file is written.
- DECISION: a model outage produces a complete deterministic editorial baseline rather than a failed run. The artifact records that fallback honestly.
- DECISION: each cycle is immutable. The final selector prefers mechanically clean cycles, then chooses the highest score, with a later cycle winning a tie.
- DECISION: Cloudflare delivery uses the project local pinned Wrangler executable and the stable `mainstreet-hackathon` Pages project. This keeps the public prototype self contained while honoring the authorized least privilege Pages credential.
- DECISION: the canonical production alias is the reported URL. The hash deployment URL is retained as deployment metadata because a newly created hash route may lag or be unavailable while the production alias is healthy.
- DECISION: brand files supplied by the project owner are authorized for this public hackathon repository. Four required assets are tracked. The full source extract is retained only in the ignored recovery area.
- DECISION: Mainstreet is repository-only software for the hackathon. The package is private to prevent accidental npm publication, while its local `mainstreet` binary remains available through `npm link`.
- DECISION: the first public push will contain a reconstructed `main` history that preserves commit authors, messages, and timestamps while generalizing two early process references. The original objects remain recoverable in an ignored bundle and a local-only backup ref.

## Security controls

- Secrets live only in `.env`, which is ignored before the first commit.
- `.env.example` contains names only.
- Public artifacts must not contain local machine paths, production customer names, credential source metadata, tokens, or copied production source.
- Secret scanning and full-history scanning are required before public release.

## Attempt log

- Attempt 1: project preflight found no `.env`; stopped exactly as the plan required.
- Attempt 2: an authorized preexisting credential source was used to materialize the local `.env`. No source metadata or secret value was printed or committed.
- Attempt 3: the initial dependency tree was moved intact to `.trash/` after a newly published Wrangler release failed the seven day package age gate. Wrangler was pinned to a mature release, the lockfile was regenerated, package provenance checks passed, and `npm audit` reported zero vulnerabilities.
- Attempt 4: the first Pages upload completed, but immediate verification used the hash route and degraded to local serving. The record was archived intact. A read back proved the production alias healthy.
- Attempt 5: the next deployment read misidentified Wrangler's table shaped JSON and tried to recreate the existing project. The fallback record was archived intact, the parser received a regression test, and the corrected deployment verified the production alias with HTTP 200.
- Attempt 6: the original supplied brand archive disappeared during the build while its extracted files remained unchanged. A new archive of those files and the full source extract were retained in `.trash/`; nothing was discarded.
- Attempt 7: the public live audit found 12 pixels of overflow at a 320 pixel viewport and proved that HTTP 200 alone could briefly verify a stale Pages alias. The critic added a narrow viewport gate, deployment verification added an exact content digest, the prompts were hardened, and a clean rerun improved from 84 to 86 with a `ship` verdict.
- Attempt 8: the Cloudflare credential variables were intentionally blanked for an isolated deployment copy. The CLI bound `127.0.0.1:4601`, recorded a verified local fallback, returned the selected site with HTTP 200, and left no listener after the smoke test.

## Known prototype limits

- All three demonstration runs improved. Canyon Wheelworks reached the `ship` threshold after the final quality hardening pass. Harborlight Flower Studio and Juniper Oven remain `revise` because their inputs lack confirmed operating details or their rendered mobile designs retain quality findings.
- Fast mode produces a concept site. A real business launch still requires verified facts, owner approval, and human review.
- The shared Cloudflare Pages alias hosts one promoted example at a time. Per-deployment preview URLs remain in each deployment artifact.
