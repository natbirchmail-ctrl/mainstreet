<p align="center">
  <img src="assets/brand/mainstreet-lockup-split.png" width="520" alt="Mainstreet">
</p>

<p align="center"><strong>One business name in. A designed and critiqued website out. Public promotion happens only after every ship gate passes.</strong></p>

Mainstreet is an AI website generator for local small businesses. Give it a business name and optional facts. It creates a structured brief, builds an image led static site, captures rendered evidence, applies an independent vision critique, revises up to three cycles, and selects the strongest safe result. A selected result can be served locally. Only a ship eligible result can replace the public Cloudflare Pages alias.

## Public release status

The quality rebuild changes the run artifacts and promotion contract. The final public values must come from the regenerated, committed artifacts. Replace these markers after regeneration:

- `LIVE_ALIAS_OWNER_SLUG: PENDING_REGENERATION`
- `LIVE_URL: PENDING_REGENERATION`
- `LIVE_AGGREGATE_SHA256: PENDING_REGENERATION`

A loopback URL is proof of local delivery only. It is never a substitute for the public alias.

## Why Mainstreet

Small businesses often need a credible web presence before they have the time, budget, copy, photography, or design vocabulary to commission one. Mainstreet turns the blank page into an inspectable prototype while keeping uncertain facts out of public copy.

The critic loop is the core idea. Generation is not the finish line. Every cycle preserves the source, local image evidence, three screenshots, a 320 pixel mechanical probe, rendered checks, law findings, score, and revision handoff. Mainstreet derives ship eligibility from those artifacts instead of accepting a model's recommendation.

## What it does

- Runs intake, build, critique, revision, selection, and delivery from one command.
- Uses strict structured outputs for the brief, site manifest, vision critique, and revision.
- Requires the model to return semantic HTML, CSS, an empty script sentinel, a plan for three to five local PNG images, and design notes.
- Materializes an owned deterministic `script.js` and its matching motion styles. Model supplied JavaScript is rejected.
- Captures desktop at 1440 by 900, tablet at 1024 by 768, and phone at 390 by 844.
- Probes a 320 by 800 viewport mechanically without treating it as a fourth critic screenshot.
- Preserves every cycle as immutable judging evidence.
- Blocks public promotion when any ship gate fails, when the critic uses source fallback, or when deployment verification fails.

## Quick start

Requirements:

- Node.js 22 or newer
- npm
- An OpenAI API key
- Optional Cloudflare Pages credentials

```powershell
git clone https://github.com/natbirchmail-ctrl/mainstreet.git
cd mainstreet
npm ci
npx playwright install chromium
Copy-Item .env.example .env
```

Add `OPENAI_API_KEY` to `.env`. Add `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` if you want an eligible run to attempt public promotion. Mainstreet never prints these values or writes them into run artifacts.

Link the local CLI once:

```powershell
npm link
```

Then run the full pipeline:

```powershell
mainstreet run "Harborlight Flower Studio" --fast
```

The command needs no further input. A run that clears every ship gate and completes verified Cloudflare delivery may end on a public Pages URL. Any failed gate, missing public prerequisite, or Cloudflare failure keeps delivery on the verified loopback preview at `http://127.0.0.1:4601/`.

You can supply confirmed facts without starting an interview:

```powershell
mainstreet run "Canyon Wheelworks" --city "Tucson, AZ" --details "Neighborhood bicycle repair for commuters. Walk in service is welcome." --fast
```

If you do not want to link the CLI, use the repository command:

```powershell
npm run mainstreet -- run "Harborlight Flower Studio" --fast
```

## Commands

| Command | Purpose |
| --- | --- |
| `mainstreet run "Name" --fast` | Run intake, build, critique, revision, selection, and delivery |
| `mainstreet intake "Name"` | Create a structured business brief |
| `mainstreet build <slug>` | Build the first immutable site cycle |
| `mainstreet critique <slug>` | Capture and score the latest cycle |
| `mainstreet revise <slug>` | Create the next cycle from critic findings |
| `mainstreet deploy <slug>` | Promote an eligible selected cycle or record local delivery |
| `mainstreet serve <slug>` | Serve a generated site on `127.0.0.1:4601` |

## The quality system

### Design contract

The builder commits to one visual idea and carries it through type, color, spacing, imagery, and interaction.

- **Copy:** headings identify the subject or promise, body copy explains it, and actions lead somewhere real. Primary editorial headings use at most two meaningful words unless the exact business name stands alone. Unknown operating facts remain unpublished.
- **Composition:** every section opens as a complete thought. Its first meaningful beat appears in the upper two thirds when the section aligns to the viewport. Repeating layouts must fit their actual item count without empty slots or orphan cards.
- **Motion:** each site chooses one or two named moves from `pinned chapter passage`, `horizontal click reel`, `numbered story stepper`, `staged hero entrance`, and `gentle one direction scroll reveals`. Content remains visible with JavaScript disabled and with reduced motion enabled.
- **Imagery:** each site plans three to five PNGs as one contemporary commissioned shoot. Every image has a distinct job, precise prompt, alt text, and focal point. Mainstreet records whether each file came from image generation, verified carry forward, or deterministic fallback.

### Eight hard laws

| Law | Required result |
| --- | --- |
| Headline discipline | Headings identify, body explains, and actions direct without decorative copy |
| Fold composition | Each section opens as a complete composition |
| Complete layouts | Repeating content has no empty slot, phantom column, orphan card, or broken count state |
| First beat visibility | Every section reveals its first meaningful content promptly without depending on animation |
| Image contrast | Text remains readable beside or over imagery across difficult crops |
| Motion restraint | One or two moves support hierarchy without delaying or competing with reading |
| Imagery coherence | The images read as one shoot with deliberate focal crops and no fabricated history |
| Factual restraint | Copy contains no invented fact, review, rating, award, history, or claim |

Fold composition, first beat visibility, image contrast, and imagery coherence require evidence from desktop, tablet, and phone. Missing viewport evidence makes the law unverified. Source fallback makes the visual laws unverified.

### Exact ship gates

A cycle is ship eligible only when all of these statements are true:

1. The derived visual score is at least 85.
2. The critique contains no major issue.
3. The rendered mechanical report passes.
4. All three to five image assets are resolved without deterministic fallback.
5. The critic ran in `vision` mode against desktop, tablet, and phone screenshots.
6. All eight quality laws pass.

The selector prefers ship eligible cycles. If none qualify, it prefers mechanically safe scored cycles, then other scored cycles, with the later cycle winning a tie. Selection preserves the strongest completed result; it does not grant public eligibility.

Public promotion adds two operational requirements: the run must resolve to a Git commit, and Cloudflare must return and verify the complete selected site. A failed gate, missing commit, unavailable credential, or Cloudflare error records local delivery. That local result cannot replace the public alias.

## Pipeline

```mermaid
flowchart TD
    A["Business name and confirmed facts"] --> B["Structured intake brief"]
    B --> C["Site manifest: HTML, CSS, image plan, design notes, empty script sentinel"]
    C --> D["Owned motion runtime and three to five local PNGs"]
    D --> E["Source, path, script, and asset gates"]
    E --> F["Immutable site cycle"]
    F --> G["Desktop, tablet, and phone screenshots"]
    F --> H["Rendered mechanics plus 320 pixel probe"]
    G --> I["Vision critic and eight laws"]
    H --> I
    I --> J{"All ship gates pass?"}
    J -->|"No and cycles remain"| K["Targeted revision"]
    K --> E
    J -->|"Yes"| L["Select eligible cycle"]
    J -->|"No cycles remain"| M["Select strongest completed cycle"]
    L --> N{"Commit and Cloudflare verification pass?"}
    N -->|"Yes"| O["Public alias promotion"]
    N -->|"No"| P["Verified local delivery"]
    M --> P
```

Each model stage uses a versioned prompt and strict JSON schema. Mainstreet owns one bounded three attempt retry ladder. If rendered capture fails, source review can guide another revision, but it can never pass the vision mode gate. If the critic or revision remains unavailable, Mainstreet preserves the best completed build and keeps delivery local unless an independently completed cycle already satisfies every public gate.

## Run artifacts

```text
runs/<slug>/
  brief.json
  cycle-01/
    build.json
    assets.json
    site/
      index.html
      styles.css
      script.js
      assets/
        <three-to-five-owned-images>.png
    screenshots/
      desktop-home.png
      tablet-home.png
      mobile-home.png
      manifest.json
    visible-text.txt
    mechanical.json
    critique.json
    revise.json
  cycle-02/
  cycle-03/
  deployment.json
  deployments/
    deployment-02.json
  run-report.json
  RUN-REPORT.md
```

`revise.json`, later cycles, and versioned deployment records appear only when the run reaches those stages. Failure artifacts such as `capture-error.json`, `critic-error.json`, or `revision-error.json` preserve bounded failures without changing prior evidence.

## Regenerated example evidence

The three rows below are deliberately pending. Replace the score path, selected cycle, verdict, delivery disposition, and aggregate digest from each regenerated committed run. Do not reuse pre-rebuild values.

| Business | Score path | Selected cycle | Final verdict | Delivery | Aggregate SHA 256 | Evidence |
| --- | --- | ---: | --- | --- | --- | --- |
| Canyon Wheelworks | `PENDING_REGENERATION` | `PENDING_REGENERATION` | `PENDING_REGENERATION` | `PENDING_REGENERATION` | `PENDING_REGENERATION` | [Run report](runs/canyon-wheelworks/RUN-REPORT.md) |
| Harborlight Flower Studio | `PENDING_REGENERATION` | `PENDING_REGENERATION` | `PENDING_REGENERATION` | `PENDING_REGENERATION` | `PENDING_REGENERATION` | [Run report](runs/harborlight-flower-studio/RUN-REPORT.md) |
| Juniper Oven | `PENDING_REGENERATION` | `PENDING_REGENERATION` | `PENDING_REGENERATION` | `PENDING_REGENERATION` | `PENDING_REGENERATION` | [Run report](runs/juniper-oven/RUN-REPORT.md) |

The live alias owner, public URL, and public aggregate digest at the top of this document must match the committed deployment artifact for the promoted run.

## Testing and release checks

Run the complete local suite:

```powershell
npm test
```

Run syntax checks and tests together:

```powershell
npm run check
```

Validate the public release snapshot:

```powershell
npm run release:check
```

`release:check` fails closed on the example set, immutable artifact structure, image and deployment digests, screenshot evidence, law and ship eligibility consistency, documentation metadata, unsafe paths, secrets, and private source references across the working tree and reachable history. The pending markers in this document must be replaced from regenerated artifacts before that command can pass.

## Security and privacy

- Secrets live only in the ignored `.env` file.
- Generated sites contain semantic HTML, CSS, the owned local script, and three to five local PNGs.
- Model supplied JavaScript, forms, remote resources, inline event handlers, linked paths, unplanned files, and unsafe URLs are rejected.
- Fast mode never invents phone numbers, email addresses, street addresses, business hours, reviews, ratings, awards, or operating claims.
- The local server binds only to `127.0.0.1` and restricts serving to the selected site directory.
- Run artifacts contain prompts, model results, screenshots, generated public images, and public business input. Review owner supplied facts before committing a real business run.

See [SECURITY.md](SECURITY.md) for the trust boundary and disclosure process.

## Built with Codex

A Codex agent team built Mainstreet during OpenAI Build Week. The root Codex agent owned integration, scope control, verification, and final decisions. Other Codex agents worked in parallel on bounded research, implementation, tests, adversarial review, release tooling, and documentation. The root agent reconciled those contributions against the shared contracts and retained responsibility for the final repository state.

The commit history records the work in reviewable milestones from scaffold through the quality rebuild. It is the source of truth for authorship and integration. Multiple agents contributed repository writes under root integration.

GPT 5.6 powers Mainstreet's text and vision stages at runtime. The configured image model produces the planned PNGs. Deterministic code remains responsible for schemas, source safety, the owned script, asset integrity, rendered evidence, mechanical gates, cycle limits, selection, storage, delivery, and release validation.

## Devpost description

Mainstreet gives a local business an inspectable website concept from one command. A business name enters a structured pipeline for intake, editorial site generation, local image creation, rendered criticism, and targeted revision. Each cycle contains semantic HTML, CSS, an owned deterministic motion script, three to five local PNGs, desktop, tablet, and phone screenshots, a 320 pixel mechanical probe, and an eight law critique. Mainstreet derives ship eligibility from a score threshold, issue severity, rendered mechanics, asset resolution, vision evidence, and every quality law. It promotes only an eligible, fully verified site to Cloudflare Pages. Failed gates and deployment failures remain available on a loopback preview without replacing the public alias. Three regenerated public examples will provide the final score paths, selected cycles, verdicts, deployment digests, and live URL evidence.

## Limits

- Fast mode produces a static design concept from incomplete input, not a production approved customer site, commerce system, or content management system.
- A name only run cannot supply confirmed address, hours, pricing, or contact details. Mainstreet leaves those facts unpublished.
- Critic scores are model judgments. Screenshots, findings, laws, and mechanical evidence make those judgments inspectable.
- Deterministic source or image fallback can preserve a usable local result, but it cannot create a ship eligible cycle.
- A real business launch still requires verified operating facts, owner approval, and final human review.
- The shared Pages alias can represent only the most recently verified public promotion.

## License

The software and documentation are available under the [MIT License](LICENSE). Mainstreet brand marks follow the separate [asset notice](assets/brand/ASSET-NOTICE.md).
