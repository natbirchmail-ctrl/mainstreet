import { access, mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export function resolveInside(root, ...segments) {
  const ownedRoot = path.resolve(root);
  const target = path.resolve(ownedRoot, ...segments);
  const relative = path.relative(ownedRoot, target);

  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Resolved path is outside the owned root.");
  }

  return target;
}

export async function initializeRun({
  slug,
  runsRoot,
  trashRoot,
  now = () => new Date(),
}) {
  const runDir = resolveInside(runsRoot, slug);
  await mkdir(runsRoot, { recursive: true });
  await mkdir(trashRoot, { recursive: true });

  if (await pathExists(runDir)) {
    const timestamp = now().toISOString().replace(/[.:]/g, "-");
    const archiveDir = resolveInside(trashRoot, `${timestamp}-${slug}`);
    await rename(runDir, archiveDir);
  }

  await mkdir(runDir, { recursive: true });
  return { runDir };
}

export async function writeJsonNew(target, value) {
  await mkdir(path.dirname(target), { recursive: true });
  try {
    await writeFile(target, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
    });
  } catch (error) {
    if (error?.code === "EEXIST") {
      throw new Error(`Evidence file already exists: ${target}`);
    }
    throw error;
  }
}

async function pathExists(target) {
  try {
    await access(target);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}
