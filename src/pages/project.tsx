import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  ArrowLeftIcon,
  LibraryBigIcon,
  QuoteIcon,
  SigmaIcon,
  SearchIcon,
  TelescopeIcon,
  GraduationCapIcon,
  TableIcon,
  SpellCheckIcon,
  DownloadIcon,
  WaypointsIcon,
  CodeIcon,
  HistoryIcon,
  MessageSquareIcon,
  MoreHorizontalIcon,
  PencilIcon,
  PlusIcon,
  SettingsIcon,
  Trash2Icon,
} from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { ChatPanel } from "@/components/chat/chat-panel"
import { LatexView } from "@/components/latex/latex-view"
import { NoteEditor, SourceEditor } from "@/components/editor/note-editor"
import { Backlinks } from "@/components/editor/backlinks"
import { NoteHistory } from "@/components/editor/note-history"
import type { NoteLinks } from "@/components/editor/note-links"
import { resolveLink } from "@/lib/wikilinks"
import { ProjectDialog } from "@/components/project-dialog"
import { PaperView } from "@/components/papers/paper-view"
import { CanvasView } from "@/components/canvas/canvas-view"
import { KnowledgeView } from "@/components/knowledge/knowledge-view"
import { ReferencesView } from "@/components/references/references-view"
import { DiscoverView } from "@/components/discover/discover-view"
import { ThesisView } from "@/components/thesis/thesis-view"
import { FeedbackPanel, domTarget } from "@/components/feedback/feedback-panel"
import { ExportDialog } from "@/components/export/export-dialog"
import { MatrixView } from "@/components/matrix/matrix-view"
import { SearchDialog } from "@/components/search/search-dialog"
import { LibrarySections } from "@/components/sidebar/library"
import { AddSourceDialog } from "@/components/papers/add-source-dialog"
import { ACCEPT, isAcceptedFile } from "@/components/papers/source-kind"
import { api, type NoteFile, type Project, type PublicSettings, type Source } from "@/lib/api"
import { navigate, type View } from "@/lib/router"
import { useNote } from "@/hooks/use-note"
import { cn } from "@/lib/utils"

interface Props {
  projectId: string
  notePath?: string
  paperId?: string
  view?: View
  kbPage?: string
  settings: PublicSettings
  onOpenSettings: () => void
}

export function ProjectPage({ projectId, notePath, paperId, view, kbPage, settings, onOpenSettings }: Props) {
  const [project, setProject] = useState<Project | null>(null)
  const [allNotes, setNotes] = useState<NoteFile[]>([])
  // Paper notes are opened next to their PDF, so they aren't listed twice.
  const notes = allNotes.filter((n) => !n.path.startsWith("Papers/"))
  const [papers, setPapers] = useState<Source[]>([])
  const [uploading, setUploading] = useState(0)
  const [dragging, setDragging] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const paper = papers.find((p) => p.id === paperId)
  const [editing, setEditing] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<
    null | { kind: "project" } | { kind: "note"; path: string } | { kind: "paper"; id: string }
  >(null)
  const [latexFile, setLatexFile] = useState<string | null>(null)
  const [chatOpen, setChatOpen] = useState(() => localStorage.getItem("rp-chat-open") === "1")
  const [chatWidth, setChatWidth] = useState(() => clampChat(Number(localStorage.getItem("rp-chat-width")) || CHAT_WIDTH))
  useEffect(() => localStorage.setItem("rp-chat-width", String(Math.round(chatWidth))), [chatWidth])
  const [searching, setSearching] = useState(false)
  const [addingSource, setAddingSource] = useState(false)

  // A note keeps its editor when it's renamed, so typing isn't interrupted; any other note gets a fresh one.
  const renamedTo = useRef<string | null>(null)
  const pane = useRef<{ path?: string; key?: string }>({})
  if (pane.current.path !== notePath) {
    if (!notePath || renamedTo.current !== notePath || !pane.current.key) pane.current.key = notePath
    pane.current.path = notePath
    renamedTo.current = null
  }
  const paneKey = pane.current.key

  const refreshNotes = useCallback(() => api.notes(projectId).then(setNotes), [projectId])

  useEffect(() => {
    api.project(projectId).then(setProject, () => navigate({ name: "home" }, true))
    refreshNotes().catch(() => {})
    api.sources(projectId).then(setPapers, () => {})
  }, [projectId, refreshNotes])

  // Open the first note when nothing is selected.
  const firstNote = notes[0]?.path
  useEffect(() => {
    if (!notePath && !paperId && !view && firstNote) navigate({ name: "project", projectId, note: firstNote }, true)
  }, [notePath, paperId, view, firstNote, projectId])

  const upload = async (files: File[]) => {
    const ok = files.filter(isAcceptedFile)
    if (!ok.length) return toast.error("You can add PDF, Word (.docx), Markdown and text files")
    if (ok.length < files.length) toast(`Skipped ${files.length - ok.length} file(s) that aren't PDF, Word, Markdown or text`)
    setUploading((n) => n + ok.length)
    let last: Source | undefined
    for (const f of ok) {
      try {
        last = await api.uploadSource(projectId, f)
        setPapers((p) => [last!, ...p])
      } catch (err) {
        toast.error(`${f.name}: ${(err as Error).message}`)
      } finally {
        setUploading((n) => n - 1)
      }
    }
    refreshNotes().catch(() => {})
    if (last) navigate({ name: "project", projectId, paper: last.id })
  }

  useEffect(() => {
    localStorage.setItem("rp-chat-open", chatOpen ? "1" : "0")
  }, [chatOpen])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "j") {
        e.preventDefault()
        setChatOpen((o) => !o)
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault()
        setSearching((o) => !o)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  const newNote = async () => {
    try {
      const { path } = await api.createNote(projectId, "Untitled")
      await refreshNotes()
      navigate({ name: "project", projectId, note: path })
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  const doDelete = async () => {
    if (!confirmDelete) return
    try {
      if (confirmDelete.kind === "project") {
        await api.deleteProject(projectId)
        navigate({ name: "home" })
      } else if (confirmDelete.kind === "paper") {
        await api.deleteSource(projectId, confirmDelete.id)
        setPapers((p) => p.filter((x) => x.id !== confirmDelete.id))
        if (confirmDelete.id === paperId) navigate({ name: "project", projectId }, true)
      } else {
        await api.deleteNote(projectId, confirmDelete.path)
        const rest = notes.filter((n) => n.path !== confirmDelete.path)
        setNotes(rest)
        if (confirmDelete.path === notePath)
          navigate({ name: "project", projectId, note: rest[0]?.path }, true)
      }
    } catch (err) {
      toast.error((err as Error).message)
    }
    setConfirmDelete(null)
  }

  if (!project) return null

  return (
    <SidebarProvider
      className="h-full min-h-0"
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("Files")) {
          e.preventDefault()
          setDragging(true)
        }
      }}
      onDragLeave={(e) => e.currentTarget === e.target && setDragging(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDragging(false)
        upload(Array.from(e.dataTransfer.files))
      }}
    >
      <input
        ref={fileInput}
        type="file"
        accept={ACCEPT}
        multiple
        hidden
        onChange={(e) => {
          upload(Array.from(e.target.files ?? []))
          e.target.value = ""
        }}
      />
      {dragging && (
        <div
          className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm"
          onDragLeave={() => setDragging(false)}
        >
          <div className="rounded-xl border-2 border-dashed px-10 py-8 text-sm text-muted-foreground">
            Drop PDFs, Word, Markdown or text files to add them
          </div>
        </div>
      )}
      <Sidebar variant="sidebar" collapsible="offcanvas">
        <SidebarHeader className="gap-0 pt-3">
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton onClick={() => navigate({ name: "home" })} className="text-muted-foreground">
                <ArrowLeftIcon /> All projects
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <div className="flex items-center gap-1 px-2 pt-3 pb-1">
                <span className="min-w-0 flex-1 truncate font-semibold">{project.name}</span>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="size-6" aria-label="Project options">
                      <MoreHorizontalIcon className="size-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    <DropdownMenuItem onSelect={() => setEditing(true)}>
                      <PencilIcon /> Rename
                    </DropdownMenuItem>
                    <DropdownMenuItem variant="destructive" onSelect={() => setConfirmDelete({ kind: "project" })}>
                      <Trash2Icon /> Delete project
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton onClick={() => setSearching(true)}>
                    <SearchIcon /> Search
                    <kbd className="ml-auto font-sans text-xs text-muted-foreground">{navigator.platform.startsWith("Mac") ? "⌘K" : "Ctrl K"}</kbd>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    isActive={view === "thesis"}
                    onClick={() => navigate({ name: "project", projectId, view: "thesis" })}
                  >
                    <GraduationCapIcon /> Thesis
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    isActive={view === "canvas"}
                    onClick={() => navigate({ name: "project", projectId, view: "canvas" })}
                  >
                    <WaypointsIcon /> Canvas
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    isActive={view === "knowledge"}
                    onClick={() => navigate({ name: "project", projectId, view: "knowledge" })}
                  >
                    <LibraryBigIcon /> Knowledge base
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    isActive={view === "discover"}
                    onClick={() => navigate({ name: "project", projectId, view: "discover" })}
                  >
                    <TelescopeIcon /> Find papers
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    isActive={view === "references"}
                    onClick={() => navigate({ name: "project", projectId, view: "references" })}
                  >
                    <QuoteIcon /> References
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    isActive={view === "matrix"}
                    onClick={() => navigate({ name: "project", projectId, view: "matrix" })}
                  >
                    <TableIcon /> Literature matrix
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    isActive={view === "latex"}
                    onClick={() => navigate({ name: "project", projectId, view: "latex" })}
                  >
                    <SigmaIcon /> LaTeX
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
          <LibrarySections
            projectId={projectId}
            sources={papers}
            notes={notes}
            paperId={paperId}
            notePath={notePath}
            uploading={uploading}
            onAddSource={() => setAddingSource(true)}
            onNewNote={newNote}
            onRemoveSource={(id) => setConfirmDelete({ kind: "paper", id })}
            onDeleteNote={(path) => setConfirmDelete({ kind: "note", path })}
          />
        </SidebarContent>
        <SidebarFooter>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton onClick={onOpenSettings} className="text-muted-foreground">
                <SettingsIcon /> Settings
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
      </Sidebar>

      <SidebarInset className="min-h-0 min-w-0">
        <div className="flex h-full min-h-0">
          <div className="flex min-w-0 flex-1 flex-col">
            {view === "canvas" ? (
              <CanvasView projectId={projectId} chatOpen={chatOpen} onToggleChat={() => setChatOpen((o) => !o)} />
            ) : view === "matrix" ? (
              <MatrixView projectId={projectId} papers={papers} chatOpen={chatOpen} onToggleChat={() => setChatOpen((o) => !o)} />
            ) : view === "thesis" ? (
              <ThesisView
                projectId={projectId}
                projectName={project?.name ?? ""}
                notes={allNotes}
                chatOpen={chatOpen}
                onToggleChat={() => setChatOpen((o) => !o)}
                onNotesChanged={refreshNotes}
              />
            ) : view === "discover" ? (
              <DiscoverView
                projectId={projectId}
                seed={kbPage}
                papers={papers}
                chatOpen={chatOpen}
                onToggleChat={() => setChatOpen((o) => !o)}
                onAdded={(s) => setPapers((ps) => (ps.some((p) => p.id === s.id) ? ps : [...ps, s]))}
              />
            ) : view === "references" ? (
              <ReferencesView
                projectId={projectId}
                notes={allNotes}
                papers={papers}
                chatOpen={chatOpen}
                onToggleChat={() => setChatOpen((o) => !o)}
              />
            ) : view === "latex" ? (
              <LatexView
                projectId={projectId}
                chatOpen={chatOpen}
                onToggleChat={() => setChatOpen((o) => !o)}
                onOpenFile={setLatexFile}
              />
            ) : view === "knowledge" ? (
              <KnowledgeView
                projectId={projectId}
                page={kbPage}
                chatOpen={chatOpen}
                onToggleChat={() => setChatOpen((o) => !o)}
              />
            ) : paperId ? (
              paper ? (
                <PaperView
                  key={paper.id}
                  projectId={projectId}
                  source={paper}
                  settings={settings}
                  onOpenSettings={onOpenSettings}
                  onRenamed={(s) => setPapers((ps) => ps.map((x) => (x.id === s.id ? s : x)))}
                />
              ) : null
            ) : notePath ? (
              <NotePane
                key={paneKey}
                projectId={projectId}
                path={notePath}
                notes={allNotes}
                onNotesChanged={refreshNotes}
                chatOpen={chatOpen}
                onToggleChat={() => setChatOpen((o) => !o)}
                onRenamed={async (path, stay) => {
                  if (stay) {
                    renamedTo.current = path
                    navigate({ name: "project", projectId, note: path }, true)
                  }
                  await refreshNotes()
                }}
              />
            ) : (
              <div className="flex flex-1 flex-col">
                <div className="flex h-12 items-center px-3">
                  <SidebarTrigger />
                </div>
                <div className="flex flex-1 items-center justify-center">
                  <Button variant="outline" onClick={newNote}>
                    <PlusIcon /> New note
                  </Button>
                </div>
              </div>
            )}
          </div>
          {chatOpen && (view || !paperId) && (
            <aside
              style={{ width: chatWidth }}
              className="relative shrink-0 border-l bg-background max-lg:absolute max-lg:inset-y-0 max-lg:right-0 max-lg:z-20 max-lg:shadow-xl"
            >
              <ChatResizer width={chatWidth} onResize={setChatWidth} />
              <ChatPanel
                projectId={projectId}
                settings={settings}
                openNotePath={view === "latex" ? (latexFile ? `latex/${latexFile}` : undefined) : view ? undefined : notePath}
                onClose={() => setChatOpen(false)}
                onOpenSettings={onOpenSettings}
              />
            </aside>
          )}
        </div>
      </SidebarInset>

      <ProjectDialog
        open={editing}
        onOpenChange={setEditing}
        project={project}
        onSubmit={async (name, description) => setProject(await api.updateProject(projectId, { name, description }))}
      />
      <AlertDialog open={!!confirmDelete} onOpenChange={(o) => !o && setConfirmDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmDelete?.kind === "project"
                ? `Delete "${project.name}"?`
                : confirmDelete?.kind === "paper"
                  ? "Remove this source?"
                  : "Delete this note?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmDelete?.kind === "paper" ? "Your note about it stays. " : ""}It will be moved to the .trash folder
              inside your ResearchPlatform folder, so you can still recover it there.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={doDelete}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <SearchDialog projectId={projectId} open={searching} onOpenChange={setSearching} />
      <AddSourceDialog
        projectId={projectId}
        open={addingSource}
        onOpenChange={setAddingSource}
        onPickFiles={() => fileInput.current?.click()}
        onAdded={(src) => {
          setPapers((p) => [src, ...p])
          refreshNotes().catch(() => {})
          navigate({ name: "project", projectId, paper: src.id })
        }}
      />
    </SidebarProvider>
  )
}

const baseName = (path: string) => path.replace(/\.md$/i, "").split("/").pop() ?? ""

/** The note's title: its first line, if that's a top-level heading. Cleaned up to work as a file name. */
function headingOf(md: string) {
  const first = md.split("\n").find((l) => l.trim())
  const m = first ? /^#\s+(.+?)\s*#*\s*$/.exec(first.trim()) : null
  if (!m) return ""
  return m[1]
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*_`~]/g, "")
    .replace(/[\\/:?"<>|]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100)
}

function NotePane({
  projectId,
  path,
  notes,
  onNotesChanged,
  chatOpen,
  onToggleChat,
  onRenamed,
}: {
  projectId: string
  path: string
  notes: NoteFile[]
  onNotesChanged: () => Promise<unknown>
  chatOpen: boolean
  onToggleChat: () => void
  onRenamed: (path: string, stay: boolean) => void
}) {
  const { content, status, save: saveNote, sync, rename: renameFile, whenSaved, replace } = useNote(projectId, path)
  const [historyOpen, setHistoryOpen] = useState(false)
  // Bumped to load restored text into a fresh editor.
  const [rev, setRev] = useState(0)
  const [source, setSource] = useState(false)
  const [feedback, setFeedback] = useState(false)
  const [exporting, setExporting] = useState(false)
  const editorBox = useRef<HTMLDivElement>(null)
  const feedbackTarget = useMemo(() => domTarget(() => editorBox.current?.querySelector<HTMLElement>("[data-slate-editor]") ?? null), [])
  const [title, setTitle] = useState(baseName(path))
  useEffect(() => setTitle(baseName(path)), [path])

  // The file name follows the note's first heading, until the student names the note themselves.
  const follows = useRef<boolean | null>(null)
  if (follows.current === null && content !== null) {
    const name = baseName(path)
    follows.current = /^Untitled( \d+)?$/.test(name) || name.replace(/ \d+$/, "") === headingOf(content)
  }
  const pathRef = useRef(path)
  pathRef.current = path
  const renameTimer = useRef<number | undefined>(undefined)
  const pendingName = useRef<string | null>(null)
  const renameToHeading = (stay = true) => {
    window.clearTimeout(renameTimer.current)
    const name = pendingName.current
    pendingName.current = null
    if (!name) return
    renameFile(name, true).then(
      (p) => onRenamed(p, stay),
      (err) => toast.error(`Couldn't rename the note: ${err.message}`),
    )
  }
  // Leaving the note before the rename ran: still rename it, but don't pull the student back.
  useEffect(() => () => renameToHeading(false), []) // eslint-disable-line react-hooks/exhaustive-deps

  const save = (md: string) => {
    saveNote(md)
    const heading = headingOf(md)
    const name = baseName(pathRef.current)
    if (!follows.current || !heading || heading === name || heading === name.replace(/ \d+$/, "")) {
      // The heading went away or back to the current name: drop a rename that's still waiting.
      window.clearTimeout(renameTimer.current)
      pendingName.current = null
      return
    }
    pendingName.current = heading
    window.clearTimeout(renameTimer.current)
    renameTimer.current = window.setTimeout(renameToHeading, 800)
  }

  // `[[Note]]` links: open the note, or make it first if it doesn't exist yet.
  const notesRef = useRef(notes)
  notesRef.current = notes
  const links = useMemo<NoteLinks>(
    () => ({
      notes,
      current: path,
      open: async (target) => {
        const found = resolveLink(target, notesRef.current)
        if (found) return navigate({ name: "project", projectId, note: found.path })
        try {
          const { path: made } = await api.createNote(projectId, target)
          await onNotesChanged()
          navigate({ name: "project", projectId, note: made })
        } catch (err) {
          toast.error(`Couldn't create the note: ${(err as Error).message}`)
        }
      },
      create: (name) => {
        if (resolveLink(name, notesRef.current)) return
        api.createNote(projectId, name).then(onNotesChanged, (err) => toast.error(`Couldn't create the note: ${err.message}`))
      },
    }),
    [notes, path, projectId, onNotesChanged],
  )

  const rename = async () => {
    const current = baseName(path)
    if (!title.trim() || title.trim() === current) {
      setTitle(current)
      return
    }
    try {
      onRenamed(await renameFile(title), true)
      follows.current = false
    } catch (err) {
      toast.error((err as Error).message)
      setTitle(current)
    }
  }

  return (
    <>
      <div className="flex h-12 shrink-0 items-center gap-2 px-3">
        <SidebarTrigger className="text-muted-foreground" />
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={rename}
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
          className="min-w-0 flex-1 truncate bg-transparent text-sm font-medium outline-none"
          aria-label="Note name"
        />
        <span className={cn("text-xs text-muted-foreground", status === "error" && "text-destructive")}>
          {status === "saving" ? "Saving…" : status === "error" ? "Not saved" : ""}
        </span>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className={cn("size-8 text-muted-foreground", source && "bg-muted text-foreground")}
              onClick={() => {
                sync()
                setSource((s) => !s)
              }}
            >
              <CodeIcon className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{source ? "Back to writing view" : "Edit markdown source"}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className={cn("size-8 text-muted-foreground", feedback && "bg-muted text-foreground")}
              onClick={() => setFeedback((f) => !f)}
              aria-label="Writing feedback"
            >
              <SpellCheckIcon className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Writing feedback</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" className="size-8 text-muted-foreground" onClick={() => setExporting(true)} aria-label="Export">
              <DownloadIcon className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Export to Word or PDF</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className={cn("size-8 text-muted-foreground", historyOpen && "bg-muted text-foreground")}
              onClick={() => setHistoryOpen(true)}
              aria-label="History"
            >
              <HistoryIcon className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>History</TooltipContent>
        </Tooltip>
        <NoteHistory
          projectId={projectId}
          path={path}
          open={historyOpen}
          onOpenChange={setHistoryOpen}
          beforeOpen={whenSaved}
          onRestore={(md) => {
            replace(md)
            setRev((r) => r + 1)
            // After the old editor has saved what it had, so the restored text lands last.
            window.setTimeout(() => save(md), 0)
          }}
        />
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className={cn("size-8 text-muted-foreground", chatOpen && "bg-muted text-foreground")}
              onClick={onToggleChat}
            >
              <MessageSquareIcon className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Chat (Ctrl/⌘ J)</TooltipContent>
        </Tooltip>
      </div>
      <div className="flex min-h-0 flex-1">
        <div ref={editorBox} className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-[720px] px-8 pt-6 sm:px-12">
            {content !== null &&
              (source ? (
                <SourceEditor key={`src-${rev}`} initialMarkdown={content} onChange={save} />
              ) : (
                <NoteEditor key={`rich-${rev}`} initialMarkdown={content} onChange={save} projectId={projectId} notePath={path} links={links} />
              ))}
            {content !== null && <Backlinks projectId={projectId} path={path} refresh={notes} />}
          </div>
        </div>
        <ExportDialog
          projectId={projectId}
          open={exporting}
          onOpenChange={setExporting}
          notes={[path]}
          name={baseName(path)}
          beforeExport={whenSaved}
        />
        {feedback && (
          <aside className="w-80 shrink-0 border-l max-md:absolute max-md:inset-y-0 max-md:right-0 max-md:z-20 max-md:bg-background max-md:shadow-xl">
            <FeedbackPanel
              projectId={projectId}
              file={{ notePath: path }}
              target={source ? null : feedbackTarget}
              beforeCheck={whenSaved}
              onClose={() => setFeedback(false)}
            />
          </aside>
        )}
      </div>
    </>
  )
}

const CHAT_WIDTH = 380
const clampChat = (w: number) => Math.min(Math.max(w, 300), Math.max(300, window.innerWidth * 0.6))

/** Drag the chat's left edge to resize it; double-click to reset. Arrow keys work when focused. */
function ChatResizer({ width, onResize }: { width: number; onResize: (w: number) => void }) {
  const start = (e: React.PointerEvent) => {
    e.preventDefault()
    const x0 = e.clientX
    const w0 = width
    const move = (ev: PointerEvent) => onResize(clampChat(w0 + x0 - ev.clientX))
    const up = () => {
      window.removeEventListener("pointermove", move)
      window.removeEventListener("pointerup", up)
      document.body.style.removeProperty("cursor")
      document.body.style.removeProperty("user-select")
    }
    document.body.style.cursor = "col-resize"
    document.body.style.userSelect = "none"
    window.addEventListener("pointermove", move)
    window.addEventListener("pointerup", up)
  }
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize chat"
      aria-valuenow={Math.round(width)}
      tabIndex={0}
      onPointerDown={start}
      onDoubleClick={() => onResize(CHAT_WIDTH)}
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft") onResize(clampChat(width + 24))
        else if (e.key === "ArrowRight") onResize(clampChat(width - 24))
      }}
      className="absolute inset-y-0 -left-1 z-30 w-2 cursor-col-resize outline-none after:absolute after:inset-y-0 after:left-1/2 after:w-px after:-translate-x-1/2 after:transition-colors hover:after:bg-ring focus-visible:after:bg-ring"
    />
  )
}
