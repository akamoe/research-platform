import { useCallback, useEffect, useRef, useState } from "react"
import { CodeIcon, ExternalLinkIcon, MessageSquareIcon, NotebookPenIcon } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable"
import { SidebarTrigger } from "@/components/ui/sidebar"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { ChatPanel } from "@/components/chat/chat-panel"
import { NoteEditor, SourceEditor, type NoteInserter } from "@/components/editor/note-editor"
import { PdfAnnotator } from "./pdf-annotator"
import { TextSource } from "./text-source"
import { sourceType } from "./source-kind"
import { useNote } from "@/hooks/use-note"
import { api, type PublicSettings, type Source } from "@/lib/api"
import { cn } from "@/lib/utils"

/** The paper on the left, the student's note (or a chat about the paper) on the right. */
export function PaperView({
  projectId,
  source,
  settings,
  onOpenSettings,
  onRenamed,
}: {
  projectId: string
  source: Source
  settings: PublicSettings
  onOpenSettings: () => void
  onRenamed: (s: Source) => void
}) {
  const [tab, setTab] = useState<"note" | "chat">(() =>
    localStorage.getItem("rp-paper-tab") === "chat" ? "chat" : "note",
  )
  const [title, setTitle] = useState(source.title)
  const isPdf = sourceType(source) === "pdf"
  useEffect(() => localStorage.setItem("rp-paper-tab", tab), [tab])
  const inserter = useRef<NoteInserter | null>(null)
  const insert = useCallback((md: string) => {
    setTab("note")
    if (inserter.current) inserter.current.insertMarkdown(md)
    else toast.error("Open the note to add highlights to it")
  }, [])

  const rename = async () => {
    if (!title.trim() || title.trim() === source.title) return setTitle(source.title)
    try {
      onRenamed(await api.renameSource(projectId, source.id, title))
    } catch (err) {
      toast.error((err as Error).message)
      setTitle(source.title)
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-12 shrink-0 items-center gap-2 border-b px-3">
        <SidebarTrigger className="text-muted-foreground" />
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={rename}
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
          className="min-w-0 flex-1 truncate bg-transparent text-sm font-medium outline-none"
          aria-label="Source title"
        />
        {isPdf && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="size-8 text-muted-foreground" asChild>
                <a href={api.pdfUrl(projectId, source.id)} target="_blank" rel="noreferrer" aria-label="Open PDF in new tab">
                  <ExternalLinkIcon className="size-4" />
                </a>
              </Button>
            </TooltipTrigger>
            <TooltipContent>Open PDF in a new tab</TooltipContent>
          </Tooltip>
        )}
      </div>
      <ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1">
        <ResizablePanel defaultSize="55%" minSize="25%">
          {isPdf ? (
            <PdfAnnotator projectId={projectId} source={source} onInsert={insert} />
          ) : (
            <TextSource projectId={projectId} source={source} />
          )}
        </ResizablePanel>
        <ResizableHandle />
        <ResizablePanel defaultSize="45%" minSize="25%">
          <div className="flex h-full min-h-0 flex-col">
            <div className="flex shrink-0 items-center gap-1 border-b px-2 py-1.5">
              <TabButton active={tab === "note"} onClick={() => setTab("note")}>
                <NotebookPenIcon className="size-3.5" /> Note
              </TabButton>
              <TabButton active={tab === "chat"} onClick={() => setTab("chat")}>
                <MessageSquareIcon className="size-3.5" /> Chat
              </TabButton>
              {!source.hasText && (
                <span className="ml-auto pr-1 text-xs text-muted-foreground">
                  {isPdf ? "No text found, chat can't read this PDF" : "No text found, chat can't read this"}
                </span>
              )}
            </div>
            {/* Both stay mounted so a reply keeps streaming while you switch to the note. */}
            <div className={cn("min-h-0 flex-1", tab !== "note" && "hidden")}>
              <PaperNote projectId={projectId} path={source.notePath} onReady={(i) => (inserter.current = i)} />
            </div>
            <div className={cn("min-h-0 flex-1", tab !== "chat" && "hidden")}>
              <ChatPanel
                projectId={projectId}
                settings={settings}
                openNotePath={source.notePath}
                source={{ id: source.id, title: source.title }}
                onOpenSettings={onOpenSettings}
              />
            </div>
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  )
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
        active ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  )
}

function PaperNote({
  projectId,
  path,
  onReady,
}: {
  projectId: string
  path: string
  onReady: (i: NoteInserter | null) => void
}) {
  const { content, status, save, sync } = useNote(projectId, path)
  const [source, setSource] = useState(false)
  return (
    <div className="relative h-full overflow-y-auto">
      <div className="absolute top-2 right-2 z-20 flex items-center gap-2">
        <span className={cn("text-xs text-muted-foreground", status === "error" && "text-destructive")}>
          {status === "saving" ? "Saving…" : status === "error" ? "Not saved" : ""}
        </span>
        <Button
          variant="ghost"
          size="icon"
          className={cn("size-7 text-muted-foreground", source && "bg-muted text-foreground")}
          onClick={() => {
            sync()
            setSource((s) => !s)
          }}
          aria-label={source ? "Back to writing view" : "Edit markdown source"}
        >
          <CodeIcon className="size-3.5" />
        </Button>
      </div>
      <div className="pt-4 pr-11 pl-8">
        {content !== null &&
          (source ? (
            <SourceEditor key="src" initialMarkdown={content} onChange={save} onReady={onReady} />
          ) : (
            <NoteEditor key="rich" initialMarkdown={content} onChange={save} onReady={onReady} projectId={projectId} notePath={path} />
          ))}
      </div>
    </div>
  )
}
