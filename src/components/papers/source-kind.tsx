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
