import fs from "node:fs/promises";
import path from "node:path";

export const rootDir = process.cwd();
export const storageDir = path.join(rootDir, "storage");
export const uploadsDir = path.join(storageDir, "uploads");
export const outputsDir = path.join(storageDir, "outputs");
export const tmpDir = path.join(storageDir, "tmp");

export async function ensureStorageFolders() {
  await Promise.all([
    fs.mkdir(uploadsDir, { recursive: true }),
    fs.mkdir(outputsDir, { recursive: true }),
    fs.mkdir(tmpDir, { recursive: true })
  ]);
}

export function safeOutputPath(filename: string) {
  const basename = path.basename(filename);
  return path.join(outputsDir, basename);
}
