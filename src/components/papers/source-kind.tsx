import { BookOpenIcon, FileTextIcon, GlobeIcon, LetterTextIcon, MonitorPlayIcon } from "lucide-react"
import type { Source, SourceType } from "@/lib/api"

export const sourceType = (s: Pick<Source, "type">): SourceType => s.type ?? "pdf"

const KINDS: Record<SourceType, { label: string; icon: typeof BookOpenIcon }> = {
  pdf: { label: "PDF", icon: BookOpenIcon },
  web: { label: "Web page", icon: GlobeIcon },
  youtube: { label: "YouTube video", icon: MonitorPlayIcon },
  docx: { label: "Word document", icon: FileTextIcon },
  text: { label: "Text", icon: LetterTextIcon },
}

export const sourceKind = (s: Pick<Source, "type">) => KINDS[sourceType(s)]

export function SourceIcon({ source, className }: { source: Pick<Source, "type">; className?: string }) {
  const Icon = sourceKind(source).icon
  return <Icon className={className} />
}

/** File types the upload accepts. */
export const ACCEPT = "application/pdf,.pdf,.docx,.md,.markdown,.txt"
export const isAcceptedFile = (f: File) => /\.(pdf|docx|md|markdown|txt)$/i.test(f.name) || f.type === "application/pdf"

const pageList = (pages: number[]) =>
  pages.length > 4 ? `${pages.length} pages` : `${pages.length === 1 ? "Page" : "Pages"} ${pages.join(", ").replace(/, (\d+)$/, " and $1")}`

/** What chat and search can't read in this source, in a few words, or nothing when it reads fine. */
export function unreadableNote(s: Pick<Source, "type" | "hasText" | "pages" | "scannedPages">) {
  const scans = s.scannedPages ?? []
  const pdf = sourceType(s) === "pdf"
  if (!s.hasText) {
    if (pdf && scans.length && scans.length >= s.pages) return "This PDF is a scan, so chat can't read it yet"
    return pdf ? "No text found, chat can't read this PDF" : "No text found, chat can't read this"
  }
  if (pdf && scans.length) return `${pageList(scans)} ${scans.length === 1 ? "is a scan" : "are scans"}, chat can't read ${scans.length === 1 ? "it" : "them"} yet`
  return null
}
