import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { findLatestSite, startStaticServer } from "../../src/serve.js";

test("findLatestSite selects the highest preserved cycle", async () => {
  const runDir = path.join(process.cwd(), "tmp", randomUUID(), "run");
  for (const cycle of [1, 3, 2]) {
    const siteDir = path.join(runDir, `cycle-${String(cycle).padStart(2, "0")}`, "site");
    await mkdir(siteDir, { recursive: true });
    await writeFile(path.join(siteDir, "index.html"), `cycle ${cycle}`, "utf8");
  }

  assert.equal(
    await findLatestSite(runDir),
    path.join(runDir, "cycle-03", "site"),
  );
});

test("static server binds to loopback and serves GET and HEAD safely", async () => {
  const root = path.join(process.cwd(), "tmp", randomUUID(), "site");
  await mkdir(root, { recursive: true });
  await writeFile(path.join(root, "index.html"), "<!doctype html><h1>Mainstreet</h1>", "utf8");
  await writeFile(path.join(root, "styles.css"), "body { color: #123456; }", "utf8");
  await writeFile(path.join(root, "script.js"), "window.mainstreet = true;", "utf8");
  await mkdir(path.join(root, "assets"));
  await writeFile(path.join(root, "assets", "cover.png"), Buffer.from("89504e470d0a1a0a", "hex"));

  const preview = await startStaticServer({ root, port: 4601 });
  try {
    assert.equal(preview.url, "http://127.0.0.1:4601/");

    const getResponse = await fetch(preview.url);
    assert.equal(getResponse.status, 200);
    assert.equal(getResponse.headers.get("cache-control"), "no-store");
    assert.equal(getResponse.headers.get("x-content-type-options"), "nosniff");
    assert.match(await getResponse.text(), /Mainstreet/);

    const headResponse = await fetch(`${preview.url}styles.css`, { method: "HEAD" });
    assert.equal(headResponse.status, 200);
    assert.equal(await headResponse.text(), "");

    for (const [pathname, contentType] of [["script.js", "application/javascript; charset=utf-8"], ["assets/cover.png", "image/png"]]) {
      const scriptGet = await fetch(`${preview.url}${pathname}`);
      assert.equal(scriptGet.status, 200);
      assert.equal(scriptGet.headers.get("content-type"), contentType);
      assert.equal(scriptGet.headers.get("x-content-type-options"), "nosniff");
      const scriptHead = await fetch(`${preview.url}${pathname}`, { method: "HEAD" });
      assert.equal(scriptHead.status, 200);
      assert.equal(scriptHead.headers.get("content-type"), contentType);
      assert.equal(await scriptHead.text(), "");
    }

    const postResponse = await fetch(preview.url, { method: "POST" });
    assert.equal(postResponse.status, 405);

    const traversalResponse = await fetch(`${preview.url}%2e%2e%2f.env`);
    assert.ok([400, 403, 404].includes(traversalResponse.status));
  } finally {
    await preview.close();
  }
});
