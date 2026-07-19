# Mainstreet Decisions

This file records autonomous decisions, assumptions, fallbacks, and deviations made during the build.

## Execution contract

### Done test

1. `mainstreet run "Any Business" --fast` produces a complete selected site without further input. It attempts public promotion only for a ship eligible cycle tied to a Git commit; every other disposition remains local.
2. A real run preserves a brief, generated source, the owned script, three to five PNGs with digest evidence, desktop, tablet, and phone screenshots, a 320 pixel mechanical probe, structured critiques, revisions, scores, laws, and deployment evidence.
3. Three regenerated example runs report their actual score paths, selected cycles, verdicts, delivery modes, and deployment digests from committed artifacts. Improvement is reported only when the artifacts prove it.
4. Automated tests cover the CLI, intake, generation contracts, owned motion, asset integrity, rendered evidence, critic policy, revision limits, static serving, deployment fallback, path safety, secret exclusion, and release validation.
5. A cycle is ship eligible only when its score is at least 85, it has no major issue, mechanics pass, all assets resolve, the critic ran in vision mode, and all eight quality laws pass.
6. `npm run release:check` passes against the final working tree and reachable history, Git history remains on `main`, and no secret or private source reference enters the public repository.

### Scope

In scope: the isolated Mainstreet repository, its CLI pipeline, model prompts, test seams, three example runs, local and Cloudflare delivery, public documentation, and judging proof.

Out of scope: modifying the production factory, importing production customer content, changing the existing business process, DNS changes, and hard deletion.

### Assumptions

- ASSUMPTION: the approved product design and the explicit autonomous build instruction replace any additional design approval gate.
- ASSUMPTION: plain ESM JavaScript on Node.js 22 or newer is the fastest reliable clean-room implementation.
- ASSUMPTION: a Codex agent team may work in bounded repository scopes. The root Codex agent owns integration, shared contract enforcement, verification, and final decisions.
- ASSUMPTION: every cleanup target moves under `.trash/`; nothing is hard-deleted.
- ASSUMPTION: absent Cloudflare credentials select the documented local server fallback and do not fail a run.
- DECISION: port 4601 is the static preview and fallback server. Port 4600 remains reserved for the optional local UI. This resolves the contradictory fallback URL in the original plan.
- DECISION: the OpenAI SDK runs with automatic retries disabled. Mainstreet owns one bounded ladder of three total attempts so latency and cost do not multiply invisibly.
- DECISION: fast intake may infer positioning and design direction, but it never publishes invented phone numbers, email addresses, street addresses, or hours. Unknown precise facts remain null and are recorded as needed.
- DECISION: the build model returns semantic HTML, CSS, an empty script sentinel, a three to five image plan, and design notes. Mainstreet appends the exact owned motion CSS, materializes the deterministic script, and rejects model supplied JavaScript, active content, remote assets, unsafe paths, placeholders, emojis, visible dashes, and incomplete semantics before completing the cycle.
- DECISION: a model outage may produce a complete deterministic editorial baseline rather than a failed run. The artifact records that fallback honestly, and fallback evidence cannot make the cycle ship eligible.
- DECISION: each cycle is immutable. The selector prefers ship eligible cycles, then mechanically safe scored cycles, then other scored cycles. It chooses the highest score in the active tier, with a later cycle winning a tie. Selecting an ineligible cycle preserves it for local delivery and never grants public promotion.
- DECISION: Cloudflare delivery uses the project local pinned Wrangler executable and the stable `mainstreet-hackathon` Pages project. This keeps the public prototype self contained while honoring the authorized least privilege Pages credential.
- DECISION: the canonical production alias is the reported URL. The hash deployment URL is retained as deployment metadata because a newly created hash route may lag or be unavailable while the production alias is healthy.
- DECISION: brand files supplied by the project owner are authorized for this public hackathon repository. Four required assets are tracked. The full source extract is retained only in the ignored recovery area.
- DECISION: Mainstreet is repository-only software for the hackathon. The package is private to prevent accidental npm publication, while its local `mainstreet` binary remains available through `npm link`.
- DECISION: the first public push will contain a reconstructed `main` history that preserves commit authors, messages, and timestamps while generalizing two early process references. The original objects remain recoverable in an ignored bundle and a local-only backup ref.

## Quality rebuild decision

**Status:** Accepted on July 18, 2026.

The rebuild replaces score led best effort publishing with a fail closed quality and evidence contract.

1. **Design input:** the builder follows explicit copy, composition, imagery, and motion laws. It chooses one coherent visual idea and only one or two named motion moves.
2. **Owned output boundary:** the model supplies layout, copy, CSS, an image plan, and an empty script sentinel. Mainstreet alone supplies `script.js` and the matching motion CSS. Each cycle contains three to five local PNGs whose source, size, and SHA 256 digest are recorded.
3. **Rendered evidence:** Playwright captures 1440 by 900 desktop, 1024 by 768 tablet, and 390 by 844 phone screenshots. A separate 320 by 800 context provides a mechanical narrow viewport probe.
4. **Eight laws:** headline discipline, fold composition, complete layouts, first beat visibility, image contrast, motion restraint, imagery coherence, and factual restraint are hard gates. Required desktop, tablet, and phone observations must be present; missing evidence becomes unverified.
5. **Derived eligibility:** Mainstreet, not the critic model, derives ship eligibility from the 85 point threshold, issue severity, mechanics, asset resolution, vision mode, and all eight laws.
6. **Public promotion:** a ship eligible cycle must also resolve to a Git commit and pass canonical byte verification for every deployed HTML, CSS, JavaScript, and PNG file. Any failed gate, source fallback, deterministic image fallback, missing commit, missing credentials, or Cloudflare failure keeps delivery local and leaves the public alias unchanged.
7. **Release proof:** the three public examples, README evidence table, demo ledger, selected cycle summaries, deployment dispositions, and digests must agree. `npm run release:check` enforces that agreement and rejects unsafe paths, secrets, private source references, and inconsistent artifacts.

The example score paths, selected cycles, verdicts, live alias owner, public URL, terminal output, and deployment digests remain pending until the quality rebuild regenerates and commits all three runs. Pre-rebuild values are historical evidence, not current release claims.

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
- Attempt 9: the repository history was rebuilt commit for commit with its original authorship, timestamps, messages, and final tree while removing private workstation references from the public object graph. The sanitized `main` branch was pushed alone, the rendered GitHub README loaded without broken images or console warnings, and the original local history was preserved under ignored `.trash/` recovery storage.

## Known prototype limits

- The three public examples require regeneration under the current quality contract. Their score paths, selected cycles, verdicts, delivery modes, digests, and live alias ownership are pending committed evidence.
- Fast mode produces a concept site. A real business launch still requires verified facts, owner approval, and human review.
- A selected ineligible result remains useful as a local preview, but it cannot update or stand in for the public alias.
- The shared Cloudflare Pages alias hosts one verified promoted example at a time. Immutable deployment URLs remain in deployment artifacts when Cloudflare returns them.
