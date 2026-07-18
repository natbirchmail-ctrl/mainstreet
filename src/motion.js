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

export function createOwnedMotionRuntime(motionMoves) {
  const slugs = motionSlugsFor(motionMoves);
  const needsSelection = motionMoves.some((move) => interactiveMoves.has(move));
  const blocks = motionMoves.map((move, index) => runtimeBlock(move, slugs[index])).join("\n");

  return `(() => {
  "use strict";
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
  };${
    needsSelection
      ? `
  const selectPanel = (root, selected) => {
    root.dataset.motionSelected = selected;
    root.querySelectorAll("button[data-motion-control]").forEach((control) => {
      control.setAttribute("aria-pressed", String(control.dataset.motionControl === selected));
    });
    root.querySelectorAll("[data-motion-panel]").forEach((panel) => {
      panel.hidden = panel.dataset.motionPanel !== selected;
    });
  };`
      : ""
  }
${blocks}
})();
`;
}

function runtimeBlock(move, slug) {
  const start = `  {
    const root = document.querySelector('[data-motion-root="${slug}"]');
    if (root) {
      if (reduced) {
        disable(root);
      } else {
        root.dataset.motionState = "active";`;
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
        if (controls[0]) selectPanel(root, controls[0].dataset.motionControl);${end}`;
  }
  if (move === "pinned chapter passage") {
    return `${start}
        const updateProgress = () => {
          const bounds = root.getBoundingClientRect();
          const distance = Math.max(1, bounds.height - window.innerHeight);
          const progress = Math.min(1, Math.max(0, -bounds.top / distance));
          root.dataset.motionProgress = progress.toFixed(3);
        };
        updateProgress();
        window.addEventListener("scroll", updateProgress, { passive: true });${end}`;
  }
  if (move === "staged hero entrance") {
    return `${start}
        window.requestAnimationFrame(() => reveal(root));${end}`;
  }
  return `${start}
        const targets = [...root.querySelectorAll("[data-motion-target]")];
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
