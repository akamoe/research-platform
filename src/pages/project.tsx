import { useCallback, useEffect, useRef, useState } from "react"
import {
  ArrowLeftIcon,
  CodeIcon,
  FileTextIcon,
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
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { ChatPanel } from "@/components/chat/chat-panel"
import { NoteEditor, SourceEditor } from "@/components/editor/note-editor"
import { ProjectDialog } from "@/components/project-dialog"
import { api, type NoteFile, type Project, type PublicSettings } from "@/lib/api"
import { navigate } from "@/lib/router"
import { cn } from "@/lib/utils"

interface Props {
  projectId: string
  notePath?: string
  settings: PublicSettings
  onOpenSettings: () => void
}

export function ProjectPage({ projectId, notePath, settings, onOpenSettings }: Props) {
  const [project, setProject] = useState<Project | null>(null)
  const [notes, setNotes] = useState<NoteFile[]>([])
  const [editing, setEditing] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<null | { kind: "project" } | { kind: "note"; path: string }>(null)
  const [chatOpen, setChatOpen] = useState(() => localStorage.getItem("rp-chat-open") === "1")

  const refreshNotes = useCallback(() => api.notes(projectId).then(setNotes), [projectId])

  useEffect(() => {
    api.project(projectId).then(setProject, () => navigate({ name: "home" }, true))
    refreshNotes().catch(() => {})
  }, [projectId, refreshNotes])

  // Open the first note when none is selected.
  useEffect(() => {
    if (!notePath && notes.length) navigate({ name: "project", projectId, note: notes[0].path }, true)
  }, [notePath, notes, projectId])

  useEffect(() => {
    localStorage.setItem("rp-chat-open", chatOpen ? "1" : "0")
  }, [chatOpen])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "j") {
        e.preventDefault()
        setChatOpen((o) => !o)
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
    <SidebarProvider className="h-full min-h-0">
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
            <SidebarGroupLabel>Notes</SidebarGroupLabel>
            <SidebarGroupAction onClick={newNote} title="New note">
              <PlusIcon /> <span className="sr-only">New note</span>
            </SidebarGroupAction>
            <SidebarGroupContent>
              <SidebarMenu>
                {notes.map((n) => (
                  <SidebarMenuItem key={n.path}>
                    <SidebarMenuButton
                      isActive={n.path === notePath}
                      onClick={() => navigate({ name: "project", projectId, note: n.path })}
                    >
                      <FileTextIcon />
                      <span>{n.path.replace(/\.md$/i, "")}</span>
                    </SidebarMenuButton>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <SidebarMenuAction showOnHover>
                          <MoreHorizontalIcon />
                        </SidebarMenuAction>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent side="right" align="start">
                        <DropdownMenuItem variant="destructive" onSelect={() => setConfirmDelete({ kind: "note", path: n.path })}>
                          <Trash2Icon /> Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </SidebarMenuItem>
                ))}
                {notes.length === 0 && (
                  <SidebarMenuItem>
                    <SidebarMenuButton onClick={newNote} className="text-muted-foreground">
                      <PlusIcon /> New note
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                )}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
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
            {notePath ? (
              <NotePane
                key={notePath}
                projectId={projectId}
                path={notePath}
                chatOpen={chatOpen}
                onToggleChat={() => setChatOpen((o) => !o)}
                onRenamed={async (path) => {
                  await refreshNotes()
                  navigate({ name: "project", projectId, note: path }, true)
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
          {chatOpen && (
            <aside className="w-[380px] shrink-0 border-l bg-background max-lg:absolute max-lg:inset-y-0 max-lg:right-0 max-lg:z-20 max-lg:shadow-xl">
              <ChatPanel
                projectId={projectId}
                settings={settings}
                openNotePath={notePath}
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
              {confirmDelete?.kind === "project" ? `Delete "${project.name}"?` : "Delete this note?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              It will be moved to the .trash folder inside your ResearchPlatform folder, so you can still recover it there.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={doDelete}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SidebarProvider>
  )
}

function NotePane({
  projectId,
  path,
  chatOpen,
  onToggleChat,
  onRenamed,
}: {
  projectId: string
  path: string
  chatOpen: boolean
  onToggleChat: () => void
  onRenamed: (path: string) => void
}) {
  const [content, setContent] = useState<string | null>(null)
  const [source, setSource] = useState(false)
  const [status, setStatus] = useState<"saved" | "saving" | "error">("saved")
  const [title, setTitle] = useState(path.replace(/\.md$/i, "").split("/").pop() ?? "")
  const latest = useRef<string>("")

  useEffect(() => {
    api.note(projectId, path).then(
      (n) => {
        latest.current = n.content
        setContent(n.content)
      },
      (e) => toast.error(e.message),
    )
  }, [projectId, path])

  const save = useCallback(
    (md: string) => {
      latest.current = md
      setStatus("saving")
      api.saveNote(projectId, path, md).then(
        () => setStatus("saved"),
        (e) => {
          setStatus("error")
          toast.error(`Couldn't save: ${e.message}`)
        },
      )
    },
    [projectId, path],
  )

  const rename = async () => {
    const current = path.replace(/\.md$/i, "").split("/").pop()
    if (!title.trim() || title.trim() === current) {
      setTitle(current ?? "")
      return
    }
    try {
      onRenamed((await api.renameNote(projectId, path, title)).path)
    } catch (err) {
      toast.error((err as Error).message)
      setTitle(current ?? "")
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
                setContent(latest.current)
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
              className={cn("size-8 text-muted-foreground", chatOpen && "bg-muted text-foreground")}
              onClick={onToggleChat}
            >
              <MessageSquareIcon className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Chat (Ctrl/⌘ J)</TooltipContent>
        </Tooltip>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[720px] px-8 pt-6 sm:px-12">
          {content !== null &&
            (source ? (
              <SourceEditor key="src" initialMarkdown={content} onChange={save} />
            ) : (
              <NoteEditor key="rich" initialMarkdown={content} onChange={save} />
            ))}
        </div>
      </div>
    </>
  )
}
