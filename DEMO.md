# Mainstreet demo plan

Target length: 2 minutes 50 seconds. Hard limit: 3 minutes.

End on: `https://mainstreet-hackathon.pages.dev/`

## Recording setup

- Use a 1920 by 1080 canvas.
- Increase terminal text to at least 22 pixels.
- Close notifications and unrelated applications.
- Open the repository, the Canyon Wheelworks evidence folder, and the live Pages URL before recording.
- Keep secrets and `.env` off screen.
- Record the command run separately, then time compress waiting periods. Add the label `Time compressed` whenever the API is working off screen.

## Shot list and narration

### 0:00 to 0:12: Outcome first

Visual: Open the live Canyon Wheelworks homepage. Scroll from the hero into services, then stop.

Narration:

> This site started with one business name. Mainstreet generated it, critiqued real desktop and mobile screenshots, revised the design, and deployed the best version.

### 0:12 to 0:28: The problem

Visual: Show the Mainstreet logo, then the README's one sentence description.

Narration:

> Local businesses need a credible first website, but the blank page demands time, copy, design judgment, and technical setup. Mainstreet turns that first step into one command.

### 0:28 to 0:52: One command

Visual: In the terminal, run:

```powershell
mainstreet run "Harborlight Flower Studio" --fast
```

Show these lines as they appear:

```text
Run started: harborlight-flower-studio
Intake brief complete.
Build complete: cycle 1.
Critic cycle 1: 72/100 (revise).
Revision complete: cycle 2.
Critic cycle 2: 77/100 (revise).
Revision complete: cycle 3.
Critic cycle 3: 79/100 (revise).
Delivery selected: cloudflare.
Site URL: https://mainstreet-hackathon.pages.dev/
```

Edit out the waits and display `Time compressed` in the lower right.

Narration:

> Fast mode needs no answers after the command. GPT 5.6 creates a structured brief, writes a static site, and enters a bounded critic loop. This real run moved from 72 to 79 before deployment.

### 0:52 to 1:18: Inspectable evidence

Visual: Open `runs/harborlight-flower-studio/`. Expand cycle 1, cycle 2, and cycle 3. Show `brief.json`, both screenshots, `mechanical.json`, `critique.json`, and the site source without lingering on dense text.

Narration:

> Every pass is immutable. Mainstreet saves the brief, HTML, CSS, desktop and mobile captures, mechanical checks, the full vision critique, and the revision handoff. The process is evidence, not a hidden before and after trick.

### 1:18 to 1:48: The critic loop

Visual: Place Canyon Wheelworks cycle 1 and cycle 2 desktop screenshots side by side. Overlay `84` on cycle 1 and `86` on cycle 2. Cut to the matching mobile screenshots.

Narration:

> Canyon Wheelworks began at 84. The critic called out hierarchy, legibility, conversion clarity, and visual consistency. One targeted revision raised the score to 86 and earned a ship verdict. Both cycles passed desktop, mobile, and narrow viewport browser gates.

### 1:48 to 2:10: How it works

Visual: Show the README pipeline diagram. Trace intake, generation, source gates, Playwright capture, vision critique, revision, selection, and delivery.

Narration:

> GPT 5.6 handles the creative reasoning. Deterministic code enforces strict schemas, blocks unsafe or remote content, captures both viewports, limits the loop to three cycles, and promotes the highest scoring clean result.

### 2:10 to 2:28: Failure ladder

Visual: Show the deployment result and briefly highlight `deployment.json`.

Narration:

> The pipeline always returns the best completed site. API stages use three bounded attempts. A critic outage ships the best existing cycle. Cloudflare failure starts a verified server on 127.0.0.1 instead of losing the run.

### 2:28 to 2:43: Built with Codex

Visual: Show `git log --oneline --reverse`, then the README's Built with Codex section.

Narration:

> Codex authored the repository from the first scaffold through tests, real example runs, deployment, audits, and documentation. Read only Codex subagents challenged the API, design, and release decisions. The timestamped commits show the build as it happened.

### 2:43 to 2:50: End card

Visual: Return to the live Canyon Wheelworks homepage. Keep the browser address visible and hold for seven seconds.

Narration:

> Mainstreet. One name in. A designed, critiqued, deployed website out.

On screen text:

```text
https://mainstreet-hackathon.pages.dev/
github.com/natbirchmail-ctrl/mainstreet
```

## Final recording checks

- The finished video is under 3 minutes.
- The command, score changes, Codex authorship, and live URL are readable at normal playback speed.
- The `Time compressed` label appears during edited API waits.
- No terminal history, environment file, token, account identifier, local user path, or private workspace appears.
- The last frame holds the live URL long enough to read it.
