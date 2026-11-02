import os from "node:os"
import path from "node:path"

/** Where all user data lives. Plain folders and .md files the user can open in any editor. */
export const DATA_DIR = path.resolve(
  process.env.RP_DATA_DIR ?? path.join(os.homedir(), "ResearchPlatform"),
)
export const PROJECTS_DIR = path.join(DATA_DIR, "projects")
export const TRASH_DIR = path.join(DATA_DIR, ".trash")
export const SETTINGS_FILE = path.join(DATA_DIR, "settings.json")

/** Resolve `rel` inside `root`, refusing anything that escapes it. */
export function safeJoin(root: string, rel: string): string {
  const full = path.resolve(root, rel)
  if (full !== root && !full.startsWith(root + path.sep)) {
    throw new HttpError(400, "Path escapes the project folder")
  }
  return full
}

export class HttpError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}
