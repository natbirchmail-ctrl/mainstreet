import assert from "node:assert/strict";
import test from "node:test";

import { slugify } from "../../src/lib/slug.js";

test("slugify creates a stable, path safe run slug", () => {
  assert.equal(slugify("  Juniper & Stone Café  "), "juniper-stone-cafe");
  assert.equal(slugify("..\\Secret/Shop"), "secret-shop");
});

test("slugify rejects names without usable characters", () => {
  assert.throws(() => slugify("..."), /usable letters or numbers/i);
});

test("slugify limits public run identifiers", () => {
  const slug = slugify("A very long business name ".repeat(10));
  assert.ok(slug.length <= 64);
  assert.doesNotMatch(slug, /-$/);
});
