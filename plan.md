# Mainstreet — Build Plan

Hackathon: OpenAI Build Week. Submission deadline: July 21, 2026, 5:00 PM PT.
Track: Apps for Your Life. Judging: depth of Codex usage, design quality, real-world impact, novelty (equal weight).

## What this is

An AI website generator for local small businesses. One input: the business name (plus optional city and owner facts). Output: a polished, deployed static website. The pipeline interviews the owner, writes the site, then runs an automated design-critic loop (screenshots scored by GPT-5.6 vision) that visibly improves the site over 2-3 cycles before deploying.

## Operating rules for the builder (Codex)

You are the sole code author. This plan is written so you can run the entire build without stopping to ask permission. Follow these rules:

1. **Never stop to ask "may I."** Make the call, note it in `DECISIONS.md`, keep moving. The only thing you may stop for is a missing secret (see rule 4).
2. **Use the approved reference workflow only for general patterns.** Study its intake, critique, and evidence ideas. Write every file fresh in this repository. Do not copy source, prompts, customer data, or artifacts.
3. **This repo goes public for judging.** Nothing sensitive gets committed, ever: no API keys, tokens, customer names from a reference system, private paths, or credential source metadata.
4. **Secrets ladder — never block, degrade:**
   - `OPENAI_API_KEY` missing → this is the only hard stop. Print exactly what is needed and where to put it (`.env`), then wait.
   - `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` missing → do NOT stop. Fall back to `mainstreet serve`, which serves the finished site on `http://127.0.0.1:4601/` and prints the URL. Deploy is a bonus, not a gate.
5. **Failure ladder — always have a fallback:**
   - Playwright install fails → run `npx playwright install chromium` once; if it still fails, degrade the critic loop to HTML/CSS source review by GPT-5.6 (no screenshots) and note the degradation in DECISIONS.md. The pipeline must still complete end to end.
   - OpenAI API error → retry 3x with exponential backoff; on persistent failure of a critic cycle, ship the best build so far rather than failing the run.
   - Any single site page failing to generate → regenerate that page once, then ship what exists.
6. **Commit early, commit often.** Small commits with clear messages, from the very first scaffold. The timestamped history is our proof of new work built during the hackathon window.
7. **Port binding:** every local server binds explicitly to `127.0.0.1`, never `localhost`. Use port 4600 (UI) and 4601 (preview serve) — nothing else on this machine uses those.
8. **Generated site copy:** no emojis, no dashes or hyphens in user-facing sentences (rewrite instead). Applies to generated sites and the demo site, not to code or the README.

## Architecture

Node.js (LTS), TypeScript optional (plain JS is fine — pick one and stay consistent). Dependencies: `openai`, `playwright`, `dotenv`, and little else. No frontend framework; generated sites are hand-quality semantic HTML + modern CSS.

```
mainstreet/
  bin/mainstreet.js        CLI entry: intake | build | critique | run | serve | deploy
  src/
    intake.js              Interview agent (gpt-5.6) -> brief.json
    build.js               Site generator (gpt-5.6) -> site/ folder
    critic.js              Screenshot (Playwright, desktop 1440x900 + mobile 390x844)
                           -> gpt-5.6 vision critique -> revision instructions JSON
    revise.js              Feeds critique back to build agent
    deploy.js              wrangler direct upload; falls back to serve
    serve.js               Static server on 127.0.0.1:4601
  prompts/                 All model prompts as versioned files, not inline strings
  runs/<slug>/             brief.json, cycle-01..N/ (site snapshot, screenshots, critique.json)
  ui/                      Optional local web UI (Day 3 stretch)
  .env.example
  README.md
  DECISIONS.md
  DEMO.md
```

### Pipeline stages

1. **Intake** — `mainstreet intake "Business Name" --city "Flagstaff, AZ"`. GPT-5.6 asks 5-8 sharp follow-up questions in the terminal (services, hours, vibe, photos available, phone/address, one thing customers love). Answers become `runs/<slug>/brief.json`. A `--fast` flag skips the interview and lets GPT-5.6 infer a plausible brief from the name and city alone (needed for the demo video pacing).
2. **Build** — GPT-5.6 generates the full site from the brief: single page (or hero + menu/services + about + contact sections), mobile first, real copywriting from the brief, tasteful CSS placeholder treatments where no photos exist. Design direction comes from a style-selection step: the model picks one coherent aesthetic (and a "signature move" — one memorable design gesture) before writing any code.
3. **Critic loop** — screenshot desktop + mobile, send to GPT-5.6 vision with a strict rubric (layout, hierarchy, color, typography, mobile behavior, cliché detection), get back a score /100 and a JSON list of specific fixes. Revise. Repeat until score >= 85 or 3 cycles. Every cycle's screenshots + critique are saved — this is the demo's money shot.
4. **Deploy** — `mainstreet deploy <slug>` does a Cloudflare Pages direct upload via wrangler using env credentials. No credentials → `mainstreet serve <slug>` on `http://127.0.0.1:4601/`.
5. **`mainstreet run`** — the whole pipeline in one command. This is what the video shows.

## Schedule

- **Day 1 (Jul 17/18):** repo + scaffold, intake agent working, first build agent output rendering in a browser. Commit milestone: "first generated site."
- **Day 2 (Jul 18/19):** critic loop end to end with saved artifacts, revise cycle working, deploy + serve commands. Commit milestone: "full pipeline."
- **Day 3 (Jul 19/20):** quality passes on prompts (this is where the judging is won — iterate on generated-site design quality using the critic scores), 3 example runs committed in `runs/`, optional web UI.
- **Day 4 (Jul 20/21):** README with "Built with Codex" section, DEMO.md video script, scrub pass, and final commits well before 5 PM PT.

## Definition of done

- `mainstreet run "Any Business Name" --fast` completes name-to-URL with zero human input beyond the command.
- Three example runs in `runs/` showing critic scores improving across cycles.
- README: what it is, setup, architecture, honest "Built with Codex" section describing how Codex built this project.
- DEMO.md: exact shot list for a sub-3-minute video ending on a live (or locally served) URL.
- `git log` shows steady commits across the window. No secrets, no verbatim production files, repo ready to flip public.

## Deliverables checklist (hackathon requirements)

- [ ] Functional project
- [ ] Text description of features (goes in Devpost form; draft it in README)
- [ ] Video under 3 minutes on YouTube showing Codex/GPT-5.6 usage
- [ ] Public repo
- [ ] README documenting collaboration with Codex
- [ ] Testing/installation instructions
