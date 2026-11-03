import { listNotes, readNote, writeNote, type NoteFile } from "./projects.ts"

/** `[[Note name]]` or `[[Note name|shown text]]`, as Obsidian writes them. */
export const WIKI_LINK = /\[\[([^[\]\n|]+)(\|[^[\]\n]*)?\]\]/g

const key = (s: string) => s.trim().replace(/\.md$/i, "").toLowerCase()

/** A link names a note by its path ("Chapters/Methods") or just its name ("Methods"). */
export function resolveLink(target: string, notes: NoteFile[]) {
  const k = key(target)
  return notes.find((n) => key(n.path) === k) ?? notes.find((n) => n.name.toLowerCase() === k)
}

export interface Backlink {
  path: string
  name: string
  /** The line the link sits on, as plain text. */
  excerpt: string
}

/** The notes that link to `rel`, each with the line of its first link. */
export async function backlinks(id: string, rel: string): Promise<Backlink[]> {
  const notes = await listNotes(id)
  const out: Backlink[] = []
  for (const n of notes) {
    if (n.path === rel) continue
    const text = await readNote(id, n.path).catch(() => "")
    if (!text.includes("[[")) continue
    for (const line of text.split("\n")) {
      const hit = [...line.matchAll(WIKI_LINK)].some((m) => resolveLink(m[1], notes)?.path === rel)
      if (!hit) continue
      out.push({ path: n.path, name: n.name, excerpt: plainLine(line) })
      break
    }
  }
  return out
}

function plainLine(line: string) {
  return line
    .replace(WIKI_LINK, (_, t: string, alias?: string) => (alias ? alias.slice(1) : t))
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s*(#{1,6}|[-*+]|\d+\.|>)\s+(\[[ x]\]\s+)?/i, "")
    .replace(/[*_`~]/g, "")
    .trim()
    .slice(0, 200)
}

/**
 * After a rename, point `[[Old]]` links in other notes at the new name. Links keep their shown
 * text, and a link that wrote the folder keeps writing it.
 */
export async function renameLinks(id: string, from: string, to: string) {
  const before = await listNotes(id)
  // Resolve against the list as it was, with the old file in place of the new one.
  const old = before.map((n) => (n.path === to ? { ...n, path: from, name: baseName(from) } : n))
  for (const n of before) {
    const text = await readNote(id, n.path).catch(() => "")
    if (!text.includes("[[")) continue
    const next = text.replace(WIKI_LINK, (all, target: string, alias = "") => {
      if (resolveLink(target, old)?.path !== from) return all
      const withFolder = target.includes("/")
      return `[[${withFolder ? to.replace(/\.md$/i, "") : baseName(to)}${alias}]]`
    })
    if (next !== text) await writeNote(id, n.path, next)
  }
}

const baseName = (rel: string) => rel.replace(/\.md$/i, "").split("/").pop() ?? rel

/** The dot each highlight colour shows in a note's `[🟡 p. 3](#hl/…)` link (as in pdf-annotator.tsx). */
export const HIGHLIGHT_DOTS: Record<string, string> = { yellow: "🟡", green: "🟢", blue: "🔵", red: "🔴", purple: "🟣" }
const DOT = Object.values(HIGHLIGHT_DOTS).join("|")

/** After a highlight changes colour, change the dot in every note that links to it. */
export async function recolorHighlightLinks(id: string, sourceId: string, highlightId: string, color: string) {
  const dot = HIGHLIGHT_DOTS[color]
  if (!dot || !/^[\w-]+$/.test(sourceId) || !/^[\w-]+$/.test(highlightId)) return 0
  const target = `(#hl/${sourceId}/${highlightId})`
  const re = new RegExp(`\\[(?:${DOT})( [^\\]\\n]*)\\]\\(#hl/${sourceId}/${highlightId}\\)`, "gu")
  let changed = 0
  for (const n of await listNotes(id)) {
    const text = await readNote(id, n.path).catch(() => "")
    if (!text.includes(target)) continue
    const next = text.replace(re, (_all, rest: string) => `[${dot}${rest}]${target}`)
    if (next !== text) {
      await writeNote(id, n.path, next)
      changed++
    }
  }
  return changed
}
