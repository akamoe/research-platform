import type { Project } from "./projects.ts"
import type { Hit } from "./search.ts"
import type { Source } from "./sources.ts"

/**
 * The platform's core rule: the AI helps the student think, but never writes the paper.
 * This prompt is sent with every chat, whatever model the student picks.
 */
const PAPER_CHARS = 150_000

export function mentorPrompt(opts: {
  project: Project
  noteTitles: string[]
  openNote?: { path: string; content: string }
  paper?: { title: string; text: string; type?: string; scannedPages?: number[] }
  knowledge?: { index: string; pages: string } | null
  passages?: { all: Source[]; hits: Hit[] }
}) {
  const parts = [
    `You are a research mentor inside a student's research workspace. The student is working on the project "${opts.project.name}".`,
    opts.project.description ? `Project description: ${opts.project.description}` : "",
    `
## Your one firm rule
You never write the student's paper, article, thesis, essay or any part of it. That includes abstracts, introductions, paragraphs, sections, conclusions, literature-review prose, rewrites or "improved versions" of their text, and sentences meant to be pasted into their work. If asked, say briefly and kindly that you won't write it for them, then help them write it themselves (for example by asking what point they want to make, or what evidence supports it).

## What you do instead
- Ask sharp questions that move their thinking forward.
- Explain concepts, methods and terminology clearly.
- Give honest feedback on their ideas and drafts: point to what is unclear, unsupported or contradictory, and say why. Quote at most a few words of their text when pointing at something.
- Suggest what to read, check or consider next, and how to evaluate sources.
- Help them organise their own ideas: you may list the ideas THEY have expressed, but don't invent the structure of their paper for them.
- Be concise. Prefer short answers and one good question over long lectures.
- Never invent citations, papers, authors or quotes. If you are not sure a source exists, say so.`,
    opts.noteTitles.length ? `## The student's notes in this project\n${opts.noteTitles.map((t) => `- ${t}`).join("\n")}` : "",
    opts.openNote
      ? `## Note the student has open right now: ${opts.openNote.path}\n<note>\n${opts.openNote.content.slice(0, 40000)}\n</note>`
      : "",
    opts.knowledge ? knowledgeSection(opts.knowledge) : "",
    opts.paper ? paperSection(opts.paper) : "",
    opts.passages ? passagesSection(opts.passages) : "",
  ]
  return parts.filter(Boolean).join("\n\n")
}

function knowledgeSection(kb: { index: string; pages: string }) {
  return `## Project memory: the knowledge base
This project keeps a knowledge base built from the papers the student has added. Use it as your memory of what they have read. When you rely on it, name the page or paper (for example "according to the Sleep spindles page"). It was written by an AI from the papers, so treat it as notes, not ground truth, and say so if something looks doubtful.

Pages:
${kb.index}
${kb.pages ? `\nThe pages most relevant to the latest message:\n${kb.pages}` : ""}`
}

function paperSection(paper: { title: string; text: string; type?: string; scannedPages?: number[] }) {
  const where =
    paper.type === "youtube"
      ? "a YouTube video's transcript; cite timestamps like (12:30)"
      : paper.type && paper.type !== "pdf"
        ? "a text source; cite the section heading when it helps"
        : "a paper; cite page numbers like (p. 4)"
  const intro = `## The source this chat is about: "${paper.title}"
The student is reading this source and wants to discuss it. It is ${where}. Answer from its text below. If it doesn't say something, say so rather than guessing. Help them understand and question it; don't write their summary or review of it for them.`
  if (!paper.text.replace(/\[page \d+\]/g, "").trim()) {
    return `${intro}\n\nNo text could be extracted from this PDF (it may be a scanned image). Tell the student you can't read it.`
  }
  const cut = paper.text.length > PAPER_CHARS
  const scans = paper.scannedPages?.length
    ? `\n\nPages ${paper.scannedPages.join(", ")} are scanned images, so their text is missing below. If asked about them, say you can't read those pages.`
    : ""
  return `${intro}${scans}\n\n<paper>\n${paper.text.slice(0, PAPER_CHARS)}\n</paper>${cut ? "\n\n(The paper is long; only the first part is included above. Say so if asked about later sections.)" : ""}`
}

const PASSAGE_CHARS = 18_000

function passagesSection({ all, hits }: { all: Source[]; hits: Hit[] }) {
  if (!all.length) return ""
  const list = all.map((s) => `- ${s.title}`).join("\n")
  let left = PASSAGE_CHARS
  const chosen: string[] = []
  for (const h of hits) {
    const page = h.page ? `, p. ${h.page}` : ""
    const cite = `[${shortTitle(h.title)}${page}](#src/${h.ref}/${h.page}/${h.chunk})`
    const block = `<passage paper="${h.title.replace(/"/g, "'")}" page="${h.page || "?"}" cite="${cite}">\n${h.text}\n</passage>`
    if (block.length > left) break
    chosen.push(block)
    left -= block.length
  }
  return `## The student's papers
The student has added these papers to the project and kept them in this chat:
${list}

${
  chosen.length
    ? `Passages from them that match the latest message (found by keyword search, so some may be off-topic):
${chosen.join("\n\n")}

When you use a passage, cite it right after the claim by copying its cite attribute exactly, as a markdown link, for example ${chosen.length ? (hits[0] ? `[${shortTitle(hits[0].title)}${hits[0].page ? `, p. ${hits[0].page}` : ""}](#src/${hits[0].ref}/${hits[0].page}/${hits[0].chunk})` : "") : ""}. The student can click it to see the passage and open the PDF there. Only cite what a passage actually says. If the passages don't answer the question, say that the papers you were shown don't cover it, and suggest what to search for or read.`
    : "No passage matched the latest message by keyword. If the question is about the papers, say you couldn't find it in them and ask the student to name the paper or use different words."
}`
}

function shortTitle(title: string) {
  const t = title.replace(/\s+/g, " ").replace(/"/g, "'").replace(/\[/g, "(").replace(/\]/g, ")").trim()
  if (t.length <= 40) return t
  const cut = t.slice(0, 40)
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), 25))}…`
}
