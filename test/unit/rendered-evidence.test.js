import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_CRITIC_FULL_PAGE_HEIGHT,
  MAX_CRITIC_IMAGE_BYTES,
  MAX_CRITIC_TOTAL_IMAGE_BYTES,
  assertCriticEvidenceLimits,
} from "../../src/lib/rendered-evidence.js";

const viewports = ["desktop", "tablet", "phone"];

test("critic image limits accept exact boundaries", () => {
  const perImageBoundary = metadata({ bytes: 1, height: 900 });
  perImageBoundary.fullPage.desktop.bytes = MAX_CRITIC_IMAGE_BYTES;
  perImageBoundary.fullPage.desktop.height = MAX_CRITIC_FULL_PAGE_HEIGHT;
  assert.doesNotThrow(() => assertCriticEvidenceLimits(perImageBoundary));

  const totalBoundary = metadata({ bytes: 1, height: 900 });
  const base = Math.floor(MAX_CRITIC_TOTAL_IMAGE_BYTES / 6);
  const remainder = MAX_CRITIC_TOTAL_IMAGE_BYTES - base * 6;
  const records = [
    ...Object.values(totalBoundary.canonical),
    ...Object.values(totalBoundary.fullPage),
  ];
  records.forEach((record, index) => {
    record.bytes = base + (index < remainder ? 1 : 0);
  });
  assert.doesNotThrow(() => assertCriticEvidenceLimits(totalBoundary));
});

test("critic image limits reject height per-image and aggregate overflow", () => {
  for (const mutate of [
    (value) => {
      value.fullPage.desktop.height = MAX_CRITIC_FULL_PAGE_HEIGHT + 1;
    },
    (value) => {
      value.fullPage.desktop.bytes = MAX_CRITIC_IMAGE_BYTES + 1;
    },
    (value) => {
      const base = Math.floor(MAX_CRITIC_TOTAL_IMAGE_BYTES / 6);
      const records = [
        ...Object.values(value.canonical),
        ...Object.values(value.fullPage),
      ];
      records.forEach((record) => {
        record.bytes = base;
      });
      records[0].bytes += MAX_CRITIC_TOTAL_IMAGE_BYTES - base * 6 + 1;
    },
  ]) {
    const value = metadata({ bytes: 1, height: 900 });
    mutate(value);
    assert.throws(
      () => assertCriticEvidenceLimits(value),
      (error) => error?.code === "CRITIC_EVIDENCE_LIMIT_EXCEEDED",
    );
  }
});

function metadata({ bytes, height }) {
  return {
    canonical: Object.fromEntries(
      viewports.map((viewport) => [viewport, { bytes, width: 1, height: 1 }]),
    ),
    fullPage: Object.fromEntries(
      viewports.map((viewport) => [viewport, { bytes, width: 1, height }]),
    ),
  };
}
