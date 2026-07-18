# Mainstreet Quality Rebuild Design

## Context

Mainstreet already completes the full name to URL workflow, but its generated site contract limits the result to one HTML file and one stylesheet. It forbids local imagery and local behavior, while its critic rewards general polish without enforcing the production design laws. The result can pass mechanically and score above the ship threshold while still looking generic and unfinished.

This rebuild raises the design ceiling without changing the outer pipeline:

1. intake
2. generation
3. screenshot capture
4. independent critique
5. bounded revision
6. deployment

## Goals

- Express the production quality principles as new public wording owned by this repository.
- Generate sites with local imagery, calm motion, stronger composition, and disciplined copy.
- Make measurable design laws mandatory for a ship verdict.
- Preserve deterministic safety checks, immutable run evidence, Cloudflare deployment, and local fallback.
- Regenerate all three example runs and update the public documentation with honest evidence.

## Non goals

- Port another production system or its fixed section kit.
- Add a customer Admin Center, database, forms, or business outreach.
- Copy private text, names, paths, prompts, or reference brands.
- Change the CLI commands or the order of pipeline stages.

## Approaches considered

### Prompt only

Expand the builder and critic prompts but retain the two file output contract. This is fast, but it cannot produce a coherent image set or the interactive motion vocabulary. It preserves the current design ceiling.

### Quality contract rebuild

Keep the pipeline stages and expand the site manifest to include one local script and a small local image plan. Generate the image assets inside the existing generation stage. Add explicit quality law results to the critic schema and enforce them as ship gates. This is the approved approach.

### Full system migration

Import fixed sections, blueprints, content contracts, and the complete production harness. This would be a separate product migration, would expose private implementation details, and would exceed the hackathon scope.

## Generated site contract

The structured site manifest will contain:

- `indexHtml`
- `stylesCss`
- `scriptJs`
- `imagePlan`
- `designNotes`

`imagePlan` contains three to five local image requests. Each request has a safe filename, semantic role, descriptive alt text, a visual prompt, and a normalized focal point. Every prompt shares one shoot direction so lighting, lens feel, palette, location cues, and human presence remain coherent.

The build stage materializes images under `assets/`. The default image model is configurable through `OPENAI_IMAGE_MODEL`. If image generation is unavailable, Mainstreet emits a safe local abstract illustration fallback and records the failure. The critic may review the fallback, but the imagery quality law prevents a false ship verdict when the visual result is not credible.

Generated HTML may load only:

- `styles.css`
- `script.js`
- relative files below `assets/`

Inline scripts, inline event handlers, remote URLs, data URLs, imports, embeds, and third party runtime dependencies remain forbidden. The Content Security Policy permits only the local stylesheet, local script, and local images.

## Quality law

### Copy

- Headings name the subject or action.
- Supporting text explains useful facts.
- Buttons state the action and destination.
- Primary section headings use no more than two meaningful words.
- The hero has one heading and no decorative label that repeats it.
- No invented testimonials, ratings, awards, dates, people, prices, or operating facts.
- Unknown facts stay out of public claims.

### Composition

- The main idea and primary visual of each section are understandable within a common viewport.
- A heading block above full width content is centered as one unit.
- A split section keeps its heading aligned with its text column.
- Repeating layouts adapt to the actual item count and never leave blank cells.
- The first visible beat of every section is present without interaction.
- Motion enhances content but never controls access to it.
- Text over imagery keeps readable contrast at every state.

### Motion

Each site chooses one or two moves that fit the business:

- pinned chapter passage
- horizontal click reel
- numbered story stepper
- staged hero entrance
- gentle one direction scroll reveals

Motion is calm, runs for a reason, supports keyboard and touch input where interactive, and has a complete reduced motion fallback. The builder must not combine every move.

### Imagery

- The set resembles one commissioned shoot.
- Subjects relate directly to the business and nearby copy.
- People appear naturally where appropriate.
- Crops preserve the focal subject at desktop, tablet, and phone widths.
- New imagery is presented as contemporary concept imagery, never as documentary history.
- Decorative empty frames and repeated unrelated images are forbidden.

## Critic contract

The vision critic keeps a numerical score, but also returns explicit quality law checks with evidence:

- headline discipline
- fold composition
- complete item layouts
- first beat visibility
- readable image overlays
- motion restraint
- imagery coherence
- factual restraint

A cycle can ship only when:

- the score is at least 85
- no major issue exists
- deterministic mechanics pass
- every mandatory quality law passes
- the current site contains resolved local visual assets

The critic receives fresh screenshots and no previous scores. Evidence includes desktop, tablet, and phone renderings. A separate narrow viewport remains a deterministic overflow check.

## Revision behavior

The revision stage receives the current source, image catalog, mechanical evidence, and one consolidated critic brief. It returns a full replacement manifest. Existing assets carry forward unless the revised image plan explicitly replaces them. The pipeline remains bounded to three total cycles and selects the highest scoring mechanically clean cycle.

## Evidence and examples

All three example runs are regenerated after the implementation passes. Each run retains:

- source files and local assets per cycle
- desktop, tablet, and phone screenshots
- mechanical results
- critic quality law results
- scores and revision handoffs
- the selected deployment record

The README explains the quality law, motion vocabulary, hard ship gates, and honest limitations without referring to private sources.

## Security and failure handling

- Secrets stay in the ignored `.env`.
- No generated output may contain an external request or executable remote dependency.
- Asset filenames are allowlisted and resolved inside the owned site directory.
- Image errors are recorded without exposing provider responses or credentials.
- Every failure keeps the best completed cycle deliverable.
- Superseded run evidence moves to ignored `.trash` rather than being deleted.

## Acceptance checks

1. Unit tests first demonstrate the expanded manifest, local script and asset safety, quality law ship gates, and asset carry forward.
2. The full existing suite plus new tests passes.
3. A real autonomous run produces local image assets, one or two working motion moves, three viewport screenshots, and explicit quality law evidence.
4. Three committed example runs show the upgraded output and honest score paths.
5. The public URL serves the exact bytes of the selected committed site and passes desktop, tablet, phone, reduced motion, console, request, and overflow checks.
