import type { NoteFile } from "@/lib/api"

/** `[[Note name]]` or `[[Note name|shown text]]`, as Obsidian writes them. Same rule as server/links.ts. */
export const WIKI_LINK = /\[\[([^[\]\n|]+)(\|[^[\]\n]*)?\]\]/g

const key = (s: string) => s.trim().replace(/\.md$/i, "").toLowerCase()

/** A link names a note by its path ("Chapters/Methods") or just its name ("Methods"). */
export function resolveLink(target: string, notes: NoteFile[]) {
  const k = key(target)
  return notes.find((n) => key(n.path) === k) ?? notes.find((n) => n.name.toLowerCase() === k)
}

/** The note a link's text points at: the part before "|". */
export const linkTarget = (inner: string) => inner.split("|")[0]
