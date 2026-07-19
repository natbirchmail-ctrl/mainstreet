# Mainstreet demo plan

Target length: 2 minutes 55 seconds. Hard limit: 3 minutes.

## Regeneration fields

Fill these values from the regenerated, committed artifacts before recording. Do not reuse prior score paths, terminal output, deployment records, or URLs.

- `DEMO_RUN_SLUG: PENDING_REGENERATION`
- `DEMO_SCORE_PATH: PENDING_REGENERATION`
- `DEMO_SELECTED_CYCLE: PENDING_REGENERATION`
- `DEMO_VERDICT: PENDING_REGENERATION`
- `DEMO_DELIVERY_MODE: PENDING_REGENERATION`
- `DEMO_AGGREGATE_SHA256: PENDING_REGENERATION`
- `LIVE_ALIAS_OWNER_SLUG: PENDING_REGENERATION`
- `LIVE_URL: PENDING_REGENERATION`

Paste the exact successful run output here after regeneration:

```text
DEMO_TERMINAL_OUTPUT_FROM_REGENERATED_RUN
```

The demo run and live alias owner may differ. If they do, say so on screen. A local URL can demonstrate preserved delivery, but it cannot be presented as the public release or as a replacement for the live alias.

## Recording setup

- Use a 1920 by 1080 canvas.
- Increase terminal text to at least 22 pixels.
- Close notifications and unrelated applications.
- Open the selected run's evidence folder, its selected cycle, the README diagram, and the verified public alias before recording.
- Prepare the desktop, tablet, and phone screenshots as a three image comparison.
- Prepare `assets.json`, three generated PNGs, `site/script.js`, `mechanical.json`, `critique.json`, and `deployment.json` as static shots.
- Keep secrets and `.env` off screen.
- Record the command separately, then time compress waiting periods. Add `Time compressed` whenever an API is working off screen.

## Shot list and narration

### 0:00 to 0:12: Verified outcome

Visual: Open the regenerated public site whose slug matches `LIVE_ALIAS_OWNER_SLUG`. Keep the verified public URL visible. Scroll from the hero into the next complete section.

Narration:

> This public site began with one business name. Mainstreet generated the design and images, judged three rendered viewports, revised the work, and promoted it only after every ship gate passed.

### 0:12 to 0:26: The problem

Visual: Show the Mainstreet logo and the README's one sentence description.

Narration:

> Local businesses need a credible first website, but the blank page demands facts, copy, visual direction, photography, and technical setup. Mainstreet turns that first step into one inspectable command.

### 0:26 to 0:48: One command

Visual: Run the regenerated demo command. Show the exact terminal output saved in `DEMO_TERMINAL_OUTPUT_FROM_REGENERATED_RUN`. Do not recreate or type output for the camera.

```powershell
mainstreet run "<regenerated public example name>" --fast
```

Narration:

> Fast mode needs no answers after the command. The pipeline creates a structured brief, builds an editorial site, generates local imagery, and enters a bounded critic loop. These score and delivery lines come from this recorded run.

### 0:48 to 1:08: Owned site payload

Visual: Show three PNGs from the selected cycle's `site/assets/` folder as a static strip. Cut to `assets.json`, then `site/script.js`. Keep each shot large enough to read the filenames, resolution state, and the script header.

Narration:

> The model plans three to five images as one coherent shoot. Mainstreet records each file's source, byte count, and digest. The model returns no JavaScript. Mainstreet supplies the deterministic motion script and validates its exact bytes and hooks.

### 1:08 to 1:30: Rendered evidence

Visual: Show `desktop-home.png`, `tablet-home.png`, and `mobile-home.png` together. Then show the 320 pixel context in `mechanical.json` and the screenshot dimensions in `screenshots/manifest.json`.

Narration:

> Every cycle captures desktop, tablet, and phone screenshots for the vision critic. A separate 320 pixel probe tests the narrow layout, overflow, visibility, touch behavior, and motion states without pretending to be a fourth critic image.

### 1:30 to 1:56: Quality laws and revision

Visual: Open the selected `critique.json`. Show the score, hard gate failures, ship eligibility, and the eight law records. If the demo uses more than one cycle, place the first and selected desktop screenshots side by side and show the exact score path from the regenerated run report.

Narration:

> The critic scores what it can see, then reports eight laws: headline discipline, fold composition, complete layouts, first beat visibility, image contrast, motion restraint, imagery coherence, and factual restraint. Mainstreet, not the model, derives the verdict. A high score cannot override a failed law, a major issue, broken mechanics, unresolved imagery, or missing vision evidence.

### 1:56 to 2:20: Local versus public

Visual: Show the README pipeline decision, then the selected `deployment.json`. Highlight `mode`, `selectedCycle`, `verified`, `aggregateSha256`, and the per file verification records. If useful, place a loopback preview label beside the public alias label.

Narration:

> A failed critic gate does not publish a best effort. Mainstreet preserves the selected site and keeps delivery local. Source fallback can guide revision, but it can never ship. The public alias changes only after an eligible cycle is tied to a commit and every deployed HTML, CSS, script, and PNG verifies against the digest manifest.

### 2:20 to 2:38: Failure behavior

Visual: Show the failure branches in the README diagram. Do not show raw exception output.

Narration:

> The pipeline owns bounded retries. A critic or revision failure preserves completed evidence. A deterministic image fallback preserves a usable preview but fails the asset gate. Missing credentials, an unavailable commit, or a Cloudflare error keeps the result local and leaves the public alias unchanged.

### 2:38 to 2:50: Built with Codex

Visual: Show a short sequence of timestamped commit subjects without author fields, then the README's Built with Codex section. Label the commit shot `Build milestones, not agent authorship`.

Narration:

> The Codex agent process records implementation provenance under root integration and final decisions. Commits use the owner's Git identity and prove milestones, not agent authorship.

### 2:50 to 2:55: End card

Visual: Return to the verified public site. Keep `LIVE_URL` visible and hold through the final frame.

Narration:

> Mainstreet. One name in. Evidence at every cycle. Public only when it passes.

On screen text, filled after regeneration:

```text
LIVE_URL_FROM_REGENERATED_DEPLOYMENT
github.com/natbirchmail-ctrl/mainstreet
```

## Regenerated evidence ledger

Replace each pending value from its committed `run-report.json` and selected `deployment.json`. These lines are intentionally formatted for the release checker.

Evidence: `runs/canyon-wheelworks/` Scores: PENDING_REGENERATION. Selected cycle: PENDING_REGENERATION. Verdict: PENDING_REGENERATION. Delivery: PENDING_REGENERATION. Aggregate SHA 256: PENDING_REGENERATION.

Evidence: `runs/harborlight-flower-studio/` Scores: PENDING_REGENERATION. Selected cycle: PENDING_REGENERATION. Verdict: PENDING_REGENERATION. Delivery: PENDING_REGENERATION. Aggregate SHA 256: PENDING_REGENERATION.

Evidence: `runs/juniper-oven/` Scores: PENDING_REGENERATION. Selected cycle: PENDING_REGENERATION. Verdict: PENDING_REGENERATION. Delivery: PENDING_REGENERATION. Aggregate SHA 256: PENDING_REGENERATION.

## Final recording checks

- The finished video is under 3 minutes.
- The command and terminal output match the regenerated run exactly.
- The desktop, tablet, and phone screenshots are all visible and identified.
- The 320 pixel probe is described as mechanical evidence, not a critic screenshot.
- Three generated PNGs, `assets.json`, the owned `script.js`, and all eight laws appear on screen.
- The selected cycle, score path, verdict, delivery mode, aggregate digest, live alias owner, and URL match committed artifacts.
- Failed gates, source fallback, image fallback, and Cloudflare failure are described as local only.
- The public alias is shown only for a ship eligible, verified deployment.
- The `Time compressed` label appears during edited API waits.
- No terminal history, environment file, token, account identifier, local user path, or private workspace appears.
- The last frame holds the verified public URL long enough to read it.
