(() => {
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
  
  {
    const root = document.querySelector('[data-motion-root="staged-hero-entrance"]');
    if (root) {
      root.dataset.motionState = "idle";
      if (reduced) {
        disable(root);
      } else {
        window.requestAnimationFrame(() => {
          root.dataset.motionState = "active";
          window.requestAnimationFrame(() => reveal(root));
        });
      }
    }
  }
  body.dataset.motionReady = "true";
})();
