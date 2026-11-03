import { z } from "zod"
import { completeJson } from "./ai.ts"
import { countWords, latexProse } from "./wordcount.ts"

/**
 * Writing feedback that points at problems and asks questions, and never rewrites the student's
 * text. Quick rule checks run offline; the AI review adds clarity, structure, argument, uncited
 * claims and grammar. Every issue quotes the exact words it is about, so the editor can mark them.
 */

export type Kind = "clarity" | "structure" | "citation" | "grammar" | "style"
export interface Issue {
  id: string
  kind: Kind
  /** Exact words from the text, so the editor can find them. */
  quote: string
  message: string
  by: "rules" | "ai"
}

/** The note as a reader sees it: no markdown symbols, links as their text, citations kept. */
export function readableMarkdown(md: string) {
  return md
    .replace(/^---\n[\s\S]*?\n---\n/, "")
    .replace(/```[\s\S]*?```/g, "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\((?!@)[^)]*\)/g, "$1")
    .replace(/\\\[(@[^\]]*)\\\]/g, "[$1]")
    .replace(/^\s*(#{1,6}|>|[-*+]|\d+[.)])\s+/gm, "")
    .replace(/(\*\*|__|\*|_|~~|`)(?=\S)([^\n]*?\S)\1/g, "$2")
    .replace(/<[^>]+>/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}
export const readableLatex = (tex: string) =>
  // Keep citations visible (as @key) so cited sentences aren't flagged as uncited.
  latexProse(
    tex.replace(/\\(?:\w*cite\w*)\*?(?:\[[^\]]*\])*\{([^}]*)\}/g, (_, keys: string) =>
      ` ${keys
        .split(",")
        .map((k) => `@${k.trim()}`)
        .join(" ")} `,
    ),
  )
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n\s*/g, "\n\n")
    .trim()

const sentences = (para: string) => para.match(/[^.!?]+(?:[.!?]+["”’)]*|$)/g)?.map((s) => s.trim()).filter(Boolean) ?? []
const firstWords = (s: string, n = 8) => s.split(/\s+/).slice(0, n).join(" ")
const looksEnglish = (t: string) => (t.match(/[a-z]/gi)?.length ?? 0) > 0.6 * (t.match(/\p{L}/gu)?.length ?? 1)

const CLAIM = /\b(stud(y|ies)|research|evidence|literature|scholars|researchers|experts|surveys?|data)\s+(has\s+|have\s+)?(shows?|showed|shown|suggests?|suggested|indicates?|indicated|finds?|found|demonstrates?|demonstrated|confirms?|confirmed|reveals?|revealed)\b|\b(it is|it's|has been|have been) (well[- ])?(known|established|shown|demonstrated|documented)\b|\baccording to\b|\b\d+(\.\d+)?\s?(%|percent)\b|\bmost (people|students|researchers|studies)\b/i
export const CITED = /\[@|(^|\s)@[\w:.-]|\\cite|\(\s*[A-Z][\p{L}'-]+(,| et al\.?| and )[^)]*\d{4}[a-z]?\s*\)/u
const VAGUE = /\b(obviously|clearly|of course|very|really|basically|actually|quite|a lot of|lots of|things?|stuff|huge|massive|always|never|everyone|nobody|proves?)\b/gi
const VAGUE_NOTE: Record<string, string> = {
  obviously: "tells the reader what to think. Does the evidence show it on its own?",
  clearly: "tells the reader what to think. Does the evidence show it on its own?",
  "of course": "assumes the reader agrees. Would a sceptical reader?",
  very: "adds emphasis without information. Is there a more exact word or a number?",
  really: "adds emphasis without information.",
  basically: "is filler in academic writing. What exactly do you mean?",
  actually: "is usually filler. Does the sentence need it?",
  quite: "is vague. How much, exactly?",
  "a lot of": "is informal and vague. How many or how much?",
  "lots of": "is informal and vague. How many or how much?",
  thing: "is vague. What is the thing, exactly?",
  things: "is vague. What are they, exactly?",
  stuff: "is informal. What exactly do you mean?",
  huge: "is informal. Can you give the size?",
  massive: "is informal. Can you give the size?",
  always: "is absolute. Is it true in every case, and can you support that?",
  never: "is absolute. Is it true in every case, and can you support that?",
  everyone: "is absolute. Who exactly, and how do you know?",
  nobody: "is absolute. Who exactly, and how do you know?",
  prove: "is strong for research. Does the evidence prove it, or support it?",
  proves: "is strong for research. Does the evidence prove it, or support it?",
}

let seq = 0
const mk = (kind: Kind, quote: string, message: string, by: Issue["by"] = "rules"): Issue => ({ id: `${by[0]}${++seq}`, kind, quote, message, by })

/** Instant offline checks. English-only for the word lists; length checks work for any language. */
export function rules(text: string): Issue[] {
  const out: Issue[] = []
  const english = looksEnglish(text)
  const paras = text.split(/\n\s*\n/).map((p) => p.trim()).filter((p) => p && !/^\S+$/.test(p))
  for (const para of paras) {
    const words = countWords(para)
    if (words > 220)
      out.push(mk("structure", firstWords(para), `This paragraph is ${words} words long. Does it make one point? If it makes two, where does the second begin?`))
    for (const s of sentences(para)) {
      const n = countWords(s)
      if (n > 40) out.push(mk("clarity", firstWords(s), `This sentence is ${n} words long. Readers tend to lose track past about 30. Which part is the main point?`))
      const rep = s.match(/\b(\p{L}+)\s+\1\b/iu)
      if (rep && !/^(that|had|is)$/i.test(rep[1])) out.push(mk("grammar", rep[0], `“${rep[1]}” is repeated.`))
      if (english && CLAIM.test(s) && !CITED.test(s))
        out.push(mk("citation", firstWords(s), "This reports what others found, or a figure, but has no citation. Which source supports it?"))
    }
    if (english) {
      const seen = new Set<string>()
      for (const m of para.matchAll(VAGUE)) {
        const w = m[0].toLowerCase()
        if (seen.has(w)) continue
        seen.add(w)
        // Quote the word and the two after it, so the editor finds this one and not another.
        const quote = (para.slice(m.index!).match(/^[^\s.,;:!?]+(?:\s+[^\s.,;:!?]+){0,2}/)?.[0] ?? m[0]).trim()
        out.push(mk("style", quote, `“${m[0]}” ${VAGUE_NOTE[w] ?? "is vague."}`))
      }
    }
  }
  return out
}

const SYSTEM = `You are a demanding but kind writing tutor giving a student feedback on their draft of an academic text.

Your one firm rule: you never write any part of their text. No rewritten sentences, no "try: ...", no replacement words or phrases, no example sentences, no suggested wording in quotes. Point at the problem, say why it is a problem, and ask a question or name what to check, so the student fixes it themselves. For grammar and spelling, name the problem (for example "subject and verb don't agree" or "possible misspelling") without giving the corrected form.

Look for:
- clarity: unclear or ambiguous sentences, undefined terms or abbreviations, sentences that try to do too much
- structure: paragraphs without one clear point, missing links between ideas, ideas in an order that's hard to follow, a claim that is never developed
- citation: claims about research, facts, figures or other people's ideas with no citation. Citations look like [@key], @key or (Author, Year); those count.
- grammar: grammar, spelling, punctuation and agreement errors
- style: informal words, vague words, overclaiming ("proves"), unsupported generalisations

Rules for each issue:
- "quote": copy 3 to 12 consecutive words EXACTLY as they appear in the text (same spelling and punctuation), so they can be found. Never paraphrase the quote.
- "message": at most 40 words, in the same language as the text.
- Give the most useful 5 to 20 issues, most important first. Skip trivia.

Reply with only JSON: {"issues": [{"kind": "clarity|structure|citation|grammar|style", "quote": "...", "message": "..."}]}`

const Reply = z.object({
  issues: z.array(
    z.object({
      kind: z.enum(["clarity", "structure", "citation", "grammar", "style"]).catch("clarity"),
      quote: z.string(),
      message: z.string(),
    }),
  ),
})

const squash = (s: string) => s.replace(/\s+/g, " ").trim()

/** Remove any wording the model suggests: quoted phrases of 3+ words that aren't the student's own. */
function stripSuggestions(message: string, text: string) {
  const own = squash(text).toLowerCase()
  return message
    .replace(/["“”'‘’«»]([^"“”'‘’«»]{12,})["“”'‘’«»]/g, (m, inner: string) => (own.includes(squash(inner).toLowerCase()) ? m : "…"))
    .replace(/\s*(\b(try|consider|e\.g\.|for example|instead|such as|like)\b[:,]?\s*…[.,]?)/gi, "")
    .replace(/\s*…\s*/g, " ")
    .trim()
}

export async function aiReview(text: string): Promise<Issue[]> {
  const body = text.slice(0, 60_000)
  const { data } = await completeJson(SYSTEM, `The student's draft:\n<draft>\n${body}\n</draft>`, Reply)
  const flat = squash(body)
  const out: Issue[] = []
  for (const i of data.issues) {
    const quote = squash(i.quote).replace(/^["“”']|["“”']$/g, "")
    // Drop issues whose quote isn't really in the text: the model may have paraphrased.
    if (!quote || !flat.includes(quote)) continue
    const message = stripSuggestions(i.message, body)
    if (message.length < 8) continue
    out.push(mk(i.kind, quote, message, "ai"))
  }
  return out
}
