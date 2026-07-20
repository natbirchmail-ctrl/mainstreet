# Mainstreet demo plan

Target length: 2 minutes 55 seconds. Hard limit: 3 minutes.

## Recording evidence

Canyon Wheelworks is both the demo run and the current shared alias owner. These values come from the committed run report and verified deployment manifest.

- `DEMO_RUN_SLUG: canyon-wheelworks`
- `DEMO_SCORE_PATH: 71 to 86`
- `DEMO_SELECTED_CYCLE: 2`
- `DEMO_VERDICT: ship`
- `DEMO_STOP_REASON: threshold_reached`
- `DEMO_DELIVERY_MODE: cloudflare`
- `DEMO_AGGREGATE_SHA256: e9af70db174e2ac1a3be49fb6519513c5098f61ad377e6900bb5e1e56c9140e9`
- `DEMO_IMMUTABLE_URL: https://f3a57ad6.mainstreet-hackathon.pages.dev/`
- `LIVE_ALIAS_OWNER_SLUG: canyon-wheelworks`
- `LIVE_URL: https://mainstreet-hackathon.pages.dev/`
- `DEPLOYMENT_COMMIT: 5e61d6a09eefaad61973a3c70a81b8b96ccba5a4`

Exact successful run output:

```text
Run started: canyon-wheelworks
Intake brief complete.
Build complete: cycle 1.
Critic cycle 1: 71/100 (revise).
Revision complete: cycle 2.
Critic cycle 2: 86/100 (ship).
Delivery selected: cloudflare.
Site URL: https://mainstreet-hackathon.pages.dev/
```

The shared alias currently resolves to Canyon. The immutable URL identifies this specific Canyon deployment even after another verified run takes ownership of the shared alias. A local URL can demonstrate preserved delivery, but it cannot be presented as the public release.

## Recording setup

- Use a 1920 by 1080 canvas.
- Increase terminal text to at least 22 pixels.
- Close notifications and unrelated applications.
- Open Canyon's evidence folder, selected cycle, README diagram, immutable deployment URL, and verified shared alias before recording.
- Prepare the canonical desktop, tablet, and phone screenshots as one comparison, followed by the three digest-bound full-page critic screenshots.
- Prepare `assets.json`, three generated PNGs, `site/script.js`, `mechanical.json`, `critique.json`, and `deployment.json` as static shots.
- Keep secrets and `.env` off screen.
- Record the command separately, then time compress waiting periods. Add `Time compressed` whenever an API is working off screen.

## Shot list and narration

### 0:00 to 0:12: Verified outcome

Visual: Open `https://mainstreet-hackathon.pages.dev/`, which currently serves Canyon Wheelworks. Keep the shared alias visible. Scroll from the hero into the next complete section.

Narration:

> This public site began with one business name. Mainstreet generated the design and images, judged three rendered viewports, revised the work, and promoted it only after every ship gate passed.

### 0:12 to 0:26: The problem

Visual: Show the Mainstreet logo and the README's one sentence description.

Narration:

> Local businesses need a credible first website, but the blank page demands facts, copy, visual direction, photography, and technical setup. Mainstreet turns that first step into one inspectable command.

### 0:26 to 0:48: One command

Visual: Run the Canyon command. Show the exact terminal output recorded above. Do not recreate or type output for the camera.

```powershell
mainstreet run "Canyon Wheelworks" --city "Tucson, AZ" --details "Neighborhood bicycle repair for commuters. Walk in service is welcome." --fast
```

Narration:

> Fast mode needs no answers after the command. The pipeline creates a structured brief, builds an editorial site, generates local imagery, and enters a bounded critic loop. These score and delivery lines come from this recorded run.

### 0:48 to 1:08: Owned site payload

Visual: Show three PNGs from the selected cycle's `site/assets/` folder as a static strip. Cut to `assets.json`, then `site/script.js`. Keep each shot large enough to read the filenames, resolution state, and the script header.

Narration:

> The model plans three to five images as one coherent shoot. Mainstreet records each file's source, byte count, and digest. The model returns no JavaScript. Mainstreet supplies the deterministic motion script and validates its exact bytes and hooks.

### 1:08 to 1:30: Rendered evidence

Visual: Show the canonical `desktop-home.png`, `tablet-home.png`, and `mobile-home.png` together. Follow them with the digest-bound full-page images in `screenshots/critic/`. Then show the normal, reduced motion, JavaScript disabled, and 320 pixel contexts in `mechanical.json`, plus both screenshot manifests.

Narration:

> Every cycle preserves canonical desktop, tablet, and phone frames plus a digest-bound full-page critic image for each viewport. Mechanical evidence tests normal, reduced motion, JavaScript disabled, and 320 pixel states without pretending that the narrow probe is a fourth critic viewport.

### 1:30 to 1:56: Quality laws and revision

Visual: Open Canyon cycle two's `critique.json`. Show its vision mode, score, hard gate failures, ship eligibility, and eight law records. Place cycle one's desktop frame beside cycle two's frame and show the exact `71 to 86` score path from the run report.

Narration:

> The critic scores what it can see, then reports eight laws: headline discipline, fold composition, complete layouts, first beat visibility, image contrast, motion restraint, imagery coherence, and factual restraint. Mainstreet, not the model, derives the verdict. A high score cannot override a failed law, a major issue, broken mechanics, unresolved imagery, or missing vision evidence.

### 1:56 to 2:20: Local versus public

Visual: Show the README pipeline decision, then Canyon's `deployment.json`. Highlight `mode`, `selectedCycle`, `verified`, `aggregateSha256`, the immutable URL, and the per file verification records. Place the shared alias beside the immutable Canyon URL.

Narration:

> A failed critic gate does not publish a best effort. Mainstreet preserves the selected site and keeps delivery local. Source fallback can guide revision, but it can never ship. The shared alias changes only after an eligible cycle is tied to a commit and every deployed HTML, CSS, script, and PNG verifies against the digest manifest. The immutable URL keeps that exact deployment addressable.

### 2:20 to 2:38: Failure behavior

Visual: Show the failure branches in the README diagram. Do not show raw exception output.

Narration:

> The pipeline owns bounded retries. A critic or revision failure preserves completed evidence. A deterministic image fallback preserves a usable preview but fails the asset gate. Missing credentials, an unavailable commit, or a Cloudflare error keeps the result local and leaves the public alias unchanged.

### 2:38 to 2:50: Built with Codex

Visual: Show a short sequence of timestamped commit subjects without author fields, then the README's Built with Codex section. Label the commit shot `Build milestones, not agent authorship`.

Narration:

> Codex was the sole code author. One root agent directed bounded Codex subagents, integrated every change, ran the evidence pipeline, and made the final release decisions. Commits use the owner's Git identity and prove milestones, not individual agent authorship.

### 2:50 to 2:55: End card

Visual: Return to Canyon at the verified shared alias. Keep `https://mainstreet-hackathon.pages.dev/` visible and hold through the final frame.

Narration:

> Mainstreet. One name in. Evidence at every cycle. Public only when it passes.

On screen text:

```text
https://mainstreet-hackathon.pages.dev/
github.com/natbirchmail-ctrl/mainstreet
```

## Evidence ledger

These lines match each committed `run-report.json` and selected `deployment.json`. The score format is intentionally machine checked.

Evidence: `runs/canyon-wheelworks/` Scores: 71 to 86. Selected cycle: 2. Verdict: ship. Stop reason: threshold_reached. Delivery: cloudflare verified. Immutable URL: https://f3a57ad6.mainstreet-hackathon.pages.dev/. Aggregate SHA 256: e9af70db174e2ac1a3be49fb6519513c5098f61ad377e6900bb5e1e56c9140e9.

Evidence: `runs/harborlight-flower-studio/` Scores: 75 to 88. Selected cycle: 2. Verdict: ship. Stop reason: threshold_reached. Delivery: cloudflare verified. Immutable URL: https://a4eb8385.mainstreet-hackathon.pages.dev/. Aggregate SHA 256: a1241109055834ae36aac9f642b78c774bd6212fa41e96c94ad8b7600e22a4df.

Evidence: `runs/juniper-oven/` Scores: 80 to 85. Selected cycle: 2. Verdict: ship. Stop reason: threshold_reached. Delivery: cloudflare verified. Immutable URL: https://8107ec4c.mainstreet-hackathon.pages.dev/. Aggregate SHA 256: 028250693db26937ae9f84f8a8046278921e3a291d18567ff635ef818738d5c8.

Canyon's deployment manifest records commit `5e61d6a09eefaad61973a3c70a81b8b96ccba5a4`. Harborlight records commit `e1bb0948fc6c253999d460c6eeb620d12488d6b6`, and Juniper records commit `0d524f78162452d6ac6b65d267f2fc5ca1d8e72a`. Each selected critique used vision mode and records `mechanicalPassed`, `assetsResolved`, `lawGatePassed`, and `shipEligible` as true. Canyon owns the current shared alias.

## Final recording checks

- The finished video is under 3 minutes.
- The command and terminal output match the committed Canyon run exactly.
- The canonical desktop, tablet, and phone screenshots and their digest-bound full-page critic images are visible and identified.
- Normal, reduced motion, JavaScript disabled, and 320 pixel mechanics appear. The 320 pixel probe is mechanical evidence, not a critic screenshot.
- Three generated PNGs, `assets.json`, the owned `script.js`, and all eight laws appear on screen.
- The selected cycle, score path, verdict, delivery mode, aggregate digest, live alias owner, and URL match committed artifacts.
- Failed gates, source fallback, image fallback, and Cloudflare failure are described as local only.
- The public alias is shown only for a ship eligible, verified deployment.
- The `Time compressed` label appears during edited API waits.
- No terminal history, environment file, token, account identifier, local user path, or private workspace appears.
- The last frame holds the verified public URL long enough to read it.
