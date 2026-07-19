import path from "node:path";

export function syntheticWindowsPath(...segments) {
  return syntheticWindowsPathOnDrive("C", ...segments);
}

export function syntheticWindowsPathOnDrive(drive, ...segments) {
  if (!/^[A-Z]$/.test(drive)) {
    throw new TypeError("A synthetic Windows drive letter is required.");
  }
  return path.win32.join(drive + ":" + path.win32.sep, ...segments);
}
