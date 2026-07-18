export const MOTION_MOVE_SLUGS = Object.freeze({
  "pinned chapter passage": "pinned-chapter-passage",
  "horizontal click reel": "horizontal-click-reel",
  "numbered story stepper": "numbered-story-stepper",
  "staged hero entrance": "staged-hero-entrance",
  "gentle one direction scroll reveals": "gentle-scroll-reveals",
});

const interactiveMoves = new Set([
  "horizontal click reel",
  "numbered story stepper",
]);

export function motionSlugsFor(motionMoves) {
  if (
    !Array.isArray(motionMoves) ||
    motionMoves.length < 1 ||
    motionMoves.length > 2 ||
    new Set(motionMoves).size !== motionMoves.length ||
    motionMoves.some((move) => !Object.hasOwn(MOTION_MOVE_SLUGS, move))
  ) {
    throw new TypeError("Motion moves must contain one or two distinct published values.");
  }
  return motionMoves.map((move) => MOTION_MOVE_SLUGS[move]);
}

export function createOwnedMotionStyles(motionMoves) {
  const slugs = motionSlugsFor(motionMoves);
  const moveStyles = motionMoves.map((move, index) => styleBlock(move, slugs[index])).join("\n");
  return `\n/* Mainstreet owned motion styles. This exact suffix is validated. */
[data-motion-root] { --motion-progress: 0; }
body[data-motion-ready="true"] [data-motion-root][data-motion-state="active"] [data-motion-target]:not([data-motion-visible="true"]) { opacity: 0; transform: translateY(.75rem); }
body[data-motion-ready="true"] [data-motion-root] [data-motion-target] { transition: opacity 420ms ease, transform 420ms ease; }
body[data-motion-ready="true"] [data-motion-root] [data-motion-target][data-motion-visible="true"] { opacity: 1; transform: none; }
body[data-motion-ready="true"] [data-motion-root] [data-motion-panel] { transition: opacity 220ms ease, transform 220ms ease; }
body[data-motion-ready="true"] [data-motion-root] [data-motion-panel][hidden] { display: none; }
${moveStyles}
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation-duration: .01ms !important; animation-iteration-count: 1 !important; transition-duration: .01ms !important; scroll-behavior: auto !important; }
  [data-motion-target], [data-motion-panel] { opacity: 1 !important; transform: none !important; }
  [data-motion-panel][hidden] { display: block !important; }
}\n`;
}

export function createOwnedMotionRuntime(motionMoves) {
  const slugs = motionSlugsFor(motionMoves);
  const needsSelection = motionMoves.some((move) => interactiveMoves.has(move));
  const blocks = motionMoves.map((move, index) => runtimeBlock(move, slugs[index])).join("\n");

  return `(() => {
  "use strict";
  const body = document.body;
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const reveal = (root) => {
    root.querySelectorAll("[data-motion-target]").forEach((target) => {
      target.dataset.motionVisible = "true";
    });
  };
  const disable = (root) => {
    root.dataset.motionState = "disabled";
    reveal(root);
    root.querySelectorAll("[data-motion-panel]").forEach((panel) => {
      panel.hidden = false;
    });
  };
  ${
    needsSelection
      ? `
  const selectPanel = (root, selected) => {
    root.dataset.motionSelected = selected;
    root.querySelectorAll("button[data-motion-control]").forEach((control) => {
      control.setAttribute("aria-pressed", String(control.dataset.motionControl === selected));
    });
    root.querySelectorAll("[data-motion-panel]").forEach((panel) => {
      const selectedPanel = panel.dataset.motionPanel === selected;
      panel.hidden = !selectedPanel;
      panel.setAttribute("aria-hidden", String(!selectedPanel));
    });
  };`
      : ""
  }
${blocks}
  body.dataset.motionReady = "true";
})();
`;
}

function runtimeBlock(move, slug) {
  const start = `  {
    const root = document.querySelector('[data-motion-root="${slug}"]');
    if (root) {
      root.dataset.motionState = "idle";
      if (reduced) {
        disable(root);
      } else {`;
  const end = `
      }
    }
  }`;

  if (interactiveMoves.has(move)) {
    return `${start}
        const controls = [...root.querySelectorAll("button[data-motion-control]")];
        controls.forEach((control) => {
          control.addEventListener("click", () => selectPanel(root, control.dataset.motionControl));
        });
        window.requestAnimationFrame(() => {
          root.dataset.motionState = "active";
          if (controls[0]) selectPanel(root, controls[0].dataset.motionControl);
        });${end}`;
  }
  if (move === "pinned chapter passage") {
    return `${start}
        const updateProgress = () => {
          const bounds = root.getBoundingClientRect();
          const distance = Math.max(1, bounds.height - window.innerHeight);
          const progress = Math.min(1, Math.max(0, -bounds.top / distance));
          root.dataset.motionProgress = progress.toFixed(3);
          root.style.setProperty("--motion-progress", progress.toFixed(3));
        };
        let pending = false;
        const scheduleProgress = () => {
          if (pending) return;
          pending = true;
          window.requestAnimationFrame(() => {
            pending = false;
            updateProgress();
          });
        };
        root.dataset.motionState = "active";
        scheduleProgress();
        window.addEventListener("scroll", scheduleProgress, { passive: true });
        window.addEventListener("resize", scheduleProgress, { passive: true });${end}`;
  }
  if (move === "staged hero entrance") {
    return `${start}
        window.requestAnimationFrame(() => {
          root.dataset.motionState = "active";
          window.requestAnimationFrame(() => reveal(root));
        });${end}`;
  }
  return `${start}
        const targets = [...root.querySelectorAll("[data-motion-target]")];
        root.dataset.motionState = "active";
        if (targets.length === 0 || !("IntersectionObserver" in window)) {
          reveal(root);
        } else {
          const observer = new IntersectionObserver((entries) => {
            entries.forEach((entry) => {
              if (entry.isIntersecting) {
                entry.target.dataset.motionVisible = "true";
                observer.unobserve(entry.target);
              }
            });
          }, { threshold: 0.15 });
          targets.forEach((target) => observer.observe(target));
        }${end}`;
}

function styleBlock(move, slug) {
  if (move === "pinned chapter passage") {
    return `[data-motion-root="${slug}"][data-motion-state="active"] { transform: translateY(calc(var(--motion-progress) * -1.25rem)); }`;
  }
  if (move === "horizontal click reel") {
    return `[data-motion-root="${slug}"] [data-motion-panel] { transform: translateX(0); }`;
  }
  if (move === "numbered story stepper") {
    return `[data-motion-root="${slug}"] [data-motion-panel] { transform: translateY(0); }`;
  }
  if (move === "staged hero entrance") {
    return `[data-motion-root="${slug}"] [data-motion-target] { will-change: opacity, transform; }`;
  }
  return `[data-motion-root="${slug}"] [data-motion-target] { will-change: opacity, transform; }`;
}
