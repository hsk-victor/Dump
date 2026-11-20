import fs from "node:fs/promises";
import path from "node:path";
import { DATA_DIR } from "./data-dir";

interface FileStorage {
  /** Saves bytes under a flat key and returns the app's URL for the file. */
  put(name: string, bytes: Uint8Array): Promise<string>;
  read(name: string): Promise<Buffer>;
  remove(name: string): Promise<void>;
}

const UPLOAD_DIR = path.join(DATA_DIR, "uploads");
const FILE_URL_PREFIX = "/api/files/";

function isFileName(name: string): boolean {
  return name.length > 0 && !/[^\w.-]/.test(name) && !name.endsWith(".") &&
    !/^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(name);
}

export function storedFileName(url: string | null | undefined): string | null {
  if (!url?.startsWith(FILE_URL_PREFIX)) return null;
  const name = url.slice(FILE_URL_PREFIX.length);
  return isFileName(name) ? name : null;
}

function localPath(name: string): string {
  if (!isFileName(name)) throw new Error("Invalid stored file name");
  return path.join(UPLOAD_DIR, name);
}

export const fileStorage: FileStorage = {
  async put(name, bytes) {
    const file = localPath(name);
    await fs.mkdir(UPLOAD_DIR, { recursive: true });
    await fs.writeFile(file, bytes);
    return `${FILE_URL_PREFIX}${name}`;
  },
  async read(name) {
    return fs.readFile(localPath(name));
  },
  async remove(name) {
    await fs.rm(localPath(name), { force: true });
  },
};
