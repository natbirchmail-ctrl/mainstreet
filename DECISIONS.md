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
- ASSUMPTION: plain ESM JavaScript on Node.js 20 is the fastest reliable clean-room implementation.
- ASSUMPTION: helper agents may inspect, research, and verify, but only this root Codex session authors repository files.
- ASSUMPTION: every cleanup target moves under `.trash/`; nothing is hard-deleted.
- ASSUMPTION: absent Cloudflare credentials select the documented local server fallback and do not fail a run.
- DECISION: port 4601 is the static preview and fallback server. Port 4600 remains reserved for the optional local UI. This resolves the contradictory fallback URL in the original plan.
- DECISION: the OpenAI SDK runs with automatic retries disabled. Mainstreet owns one bounded ladder of three total attempts so latency and cost do not multiply invisibly.
- DECISION: fast intake may infer positioning and design direction, but it never publishes invented phone numbers, email addresses, street addresses, or hours. Unknown precise facts remain null and are recorded as needed.

## Security controls

- Secrets live only in `.env`, which is ignored before the first commit.
- `.env.example` contains names only.
- Public artifacts must not contain local machine paths, production customer names, vault metadata, tokens, or copied production source.
- Secret scanning and full-history scanning are required before public release.

## Attempt log

- Attempt 1: project preflight found no `.env`; stopped exactly as the plan required.
- Attempt 2: an authorized preexisting credential source was used to materialize the local `.env`. No source metadata or secret value was printed or committed.
- Attempt 3: the initial dependency tree was moved intact to `.trash/` after a newly published Wrangler release failed the seven day package age gate. Wrangler was pinned to a mature release, the lockfile was regenerated, package provenance checks passed, and `npm audit` reported zero vulnerabilities.

## Found, not fixed

None.
