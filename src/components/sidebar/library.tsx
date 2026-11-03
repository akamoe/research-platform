import { useCallback, useEffect, useRef, useState } from "react"
import {
  ChevronRightIcon,
  FileTextIcon,
  FolderIcon,
  FolderInputIcon,
  FolderOpenIcon,
  FolderPlusIcon,
  MoreHorizontalIcon,
  PencilIcon,
  PlusIcon,
  StarIcon,
  StarOffIcon,
  Trash2Icon,
  UploadIcon,
} from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import {
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"
import { SourceIcon } from "@/components/papers/source-kind"
import { api, type Folder, type NoteFile, type Organize, type Source } from "@/lib/api"
import { navigate } from "@/lib/router"
import { cn } from "@/lib/utils"

type Section = Folder["section"]
const EMPTY: Organize = { starred: [], folders: [], placed: {} }
const DRAG_TYPE = "application/x-folio-item"

/** Stars and folders, saved to the project. Changes show at once and save in the background. */
export function useOrganize(projectId: string) {
  const [org, setOrg] = useState<Organize>(EMPTY)
  const latest = useRef(org)
  const reload = useCallback(() => {
    api.organize(projectId).then((o) => setOrg((latest.current = o)), () => {})
  }, [projectId])
  useEffect(reload, [reload])
  const update = useCallback(
    (change: (o: Organize) => Organize) => {
      const next = change(latest.current)
      latest.current = next
      setOrg(next)
      api.saveOrganize(projectId, next).catch((e) => toast.error(`Couldn't save the sidebar: ${e.message}`))
    },
    [projectId],
  )
  return [org, update, reload] as const
}

/** Which sections and folders are folded, remembered on this computer. */
function useFolded(projectId: string) {
  const key = `rp-folded:${projectId}`
  const [folded, setFolded] = useState<Set<string>>(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem(key) ?? "[]"))
    } catch {
      return new Set()
    }
  })
  const toggle = (id: string, open?: boolean) =>
    setFolded((f) => {
      const next = new Set(f)
      if (open ?? next.has(id)) next.delete(id)
      else next.add(id)
      localStorage.setItem(key, JSON.stringify([...next]))
      return next
    })
  return [folded, toggle] as const
}

interface Item {
  key: string
  section: Section
  title: string
  icon: React.ReactNode
  active: boolean
  open: () => void
  remove: () => void
  removeLabel: string
}

export function LibrarySections({
  projectId,
  sources,
  notes,
  paperId,
  notePath,
  uploading,
  onAddSource,
  onNewNote,
  onRemoveSource,
  onDeleteNote,
}: {
  projectId: string
  sources: Source[]
  notes: NoteFile[]
  paperId?: string
  notePath?: string
  uploading: number
  onAddSource: () => void
  onNewNote: () => void
  onRemoveSource: (id: string) => void
  onDeleteNote: (path: string) => void
}) {
  const [org, update, reload] = useOrganize(projectId)
  // Renaming a note moves its star and folder on the server; pick that up.
  const notePaths = notes.map((n) => n.path).join("\n")
  const firstLoad = useRef(true)
  useEffect(() => {
    if (firstLoad.current) firstLoad.current = false
    else reload()
  }, [notePaths, reload])
  const [folded, toggle] = useFolded(projectId)
  const [naming, setNaming] = useState<null | { section: Section; parent?: string; folder?: Folder; moveKey?: string }>(null)

  const items: Item[] = [
    ...sources.map((s) => ({
      key: `s:${s.id}`,
      section: "sources" as const,
      title: s.title,
      icon: <SourceIcon source={s} />,
      active: s.id === paperId,
      open: () => navigate({ name: "project", projectId, paper: s.id }),
      remove: () => onRemoveSource(s.id),
      removeLabel: "Remove source",
    })),
    ...notes.map((n) => ({
      key: `n:${n.path}`,
      section: "notes" as const,
      title: n.path.replace(/\.md$/i, ""),
      icon: <FileTextIcon />,
      active: n.path === notePath,
      open: () => navigate({ name: "project", projectId, note: n.path }),
      remove: () => onDeleteNote(n.path),
      removeLabel: "Delete",
    })),
  ]
  const starred = new Set(org.starred)
  const folderIds = new Set(org.folders.map((f) => f.id))
  const where = (key: string) => (folderIds.has(org.placed[key]) ? org.placed[key] : undefined)

  const toggleStar = (key: string) =>
    update((o) => ({ ...o, starred: o.starred.includes(key) ? o.starred.filter((k) => k !== key) : [...o.starred, key] }))
  const move = (key: string, folder?: string) =>
    update((o) => {
      const placed = { ...o.placed }
      if (folder) placed[key] = folder
      else delete placed[key]
      return { ...o, placed }
    })
  const removeFolder = (f: Folder) =>
    update((o) => {
      // What was inside moves up a level; nothing is deleted.
      const placed = Object.fromEntries(
        Object.entries(o.placed).flatMap(([k, v]) => (v === f.id ? (f.parent ? [[k, f.parent]] : []) : [[k, v]])),
      )
      const folders = o.folders.filter((x) => x.id !== f.id).map((x) => (x.parent === f.id ? { ...x, parent: f.parent } : x))
      return { ...o, folders, placed }
    })
  const saveName = (name: string) => {
    if (!naming) return
    if (naming.folder) {
      const id = naming.folder.id
      update((o) => ({ ...o, folders: o.folders.map((f) => (f.id === id ? { ...f, name } : f)) }))
    } else {
      const folder: Folder = { id: crypto.randomUUID().slice(0, 8), name, section: naming.section, parent: naming.parent }
      update((o) => ({
        ...o,
        folders: [...o.folders, folder],
        placed: naming.moveKey ? { ...o.placed, [naming.moveKey]: folder.id } : o.placed,
      }))
      toggle(folder.id, true)
    }
    setNaming(null)
  }

  const row = (it: Item, inStarred = false) => (
    <ItemRow
      key={(inStarred ? "star-" : "") + it.key}
      item={it}
      starred={starred.has(it.key)}
      folders={org.folders.filter((f) => f.section === it.section)}
      current={where(it.key)}
      onStar={() => toggleStar(it.key)}
      onMove={(f) => move(it.key, f)}
      onNewFolder={() => setNaming({ section: it.section, moveKey: it.key })}
    />
  )

  // Folders and items inside `parent` (top level when undefined), folders first.
  const tree = (section: Section, parent?: string): React.ReactNode[] => [
    ...org.folders
      .filter((f) => f.section === section && f.parent === parent)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((f) => {
        const open = !folded.has(f.id)
        const inside = tree(section, f.id)
        return (
          <FolderRow
            key={f.id}
            folder={f}
            open={open}
            empty={!inside.length}
            onToggle={() => toggle(f.id)}
            onDrop={(key) => (key.startsWith(section === "sources" ? "s:" : "n:") ? move(key, f.id) : undefined)}
            onNewFolder={() => setNaming({ section, parent: f.id })}
            onRename={() => setNaming({ section, folder: f })}
            onRemove={() => removeFolder(f)}
          >
            {inside}
          </FolderRow>
        )
      }),
    ...items.filter((it) => it.section === section && where(it.key) === parent).map((it) => row(it)),
  ]

  const starredItems = org.starred.map((k) => items.find((it) => it.key === k)).filter((it): it is Item => !!it)

  return (
    <>
      {starredItems.length > 0 && (
        <Section id="starred" label="Starred" folded={folded} onToggle={toggle}>
          {starredItems.map((it) => row(it, true))}
        </Section>
      )}
      <Section
        id="sources"
        label="Sources"
        folded={folded}
        onToggle={toggle}
        onDrop={(key) => key.startsWith("s:") && move(key)}
        onNewFolder={() => setNaming({ section: "sources" })}
        action={{ label: "Add a source", onClick: onAddSource }}
      >
        {tree("sources")}
        {uploading > 0 && (
          <SidebarMenuItem>
            <SidebarMenuButton disabled className="text-muted-foreground">
              <UploadIcon className="animate-pulse" /> Adding {uploading} file{uploading > 1 ? "s" : ""}…
            </SidebarMenuButton>
          </SidebarMenuItem>
        )}
        {sources.length === 0 && uploading === 0 && (
          <SidebarMenuItem>
            <SidebarMenuButton onClick={onAddSource} className="text-muted-foreground">
              <PlusIcon /> Add a source
            </SidebarMenuButton>
          </SidebarMenuItem>
        )}
      </Section>
      <Section
        id="notes"
        label="Notes"
        folded={folded}
        onToggle={toggle}
        onDrop={(key) => key.startsWith("n:") && move(key)}
        onNewFolder={() => setNaming({ section: "notes" })}
        action={{ label: "New note", onClick: onNewNote }}
      >
        {tree("notes")}
        {notes.length === 0 && (
          <SidebarMenuItem>
            <SidebarMenuButton onClick={onNewNote} className="text-muted-foreground">
              <PlusIcon /> New note
            </SidebarMenuButton>
          </SidebarMenuItem>
        )}
      </Section>
      <NameDialog
        key={naming ? naming.folder?.id ?? `new-${naming.parent ?? ""}` : "closed"}
        open={!!naming}
        title={naming?.folder ? "Rename folder" : naming?.parent ? "New subfolder" : "New folder"}
        initial={naming?.folder?.name ?? ""}
        onCancel={() => setNaming(null)}
        onSave={saveName}
      />
    </>
  )
}

/** A sidebar group whose label folds it away, and which takes dropped items back to its top level. */
function Section({
  id,
  label,
  folded,
  onToggle,
  onDrop,
  onNewFolder,
  action,
  children,
}: {
  id: string
  label: string
  folded: Set<string>
  onToggle: (id: string) => void
  onDrop?: (key: string) => void
  onNewFolder?: () => void
  action?: { label: string; onClick: () => void }
  children: React.ReactNode
}) {
  const open = !folded.has(id)
  const drop = useDropTarget(onDrop)
  return (
    <SidebarGroup className="group/section">
      <SidebarGroupLabel asChild>
        <button
          onClick={() => onToggle(id)}
          {...drop.props}
          className={cn("w-full gap-1 hover:text-sidebar-foreground", drop.over && "bg-sidebar-accent text-sidebar-accent-foreground")}
          aria-expanded={open}
        >
          <ChevronRightIcon className={cn("transition-transform", open && "rotate-90")} />
          {label}
        </button>
      </SidebarGroupLabel>
      {onNewFolder && (
        <SidebarGroupAction
          onClick={onNewFolder}
          title="New folder"
          className={cn("opacity-0 group-hover/section:opacity-100 focus-visible:opacity-100", action && "right-9")}
        >
          <FolderPlusIcon /> <span className="sr-only">New folder</span>
        </SidebarGroupAction>
      )}
      {action && (
        <SidebarGroupAction onClick={action.onClick} title={action.label}>
          <PlusIcon /> <span className="sr-only">{action.label}</span>
        </SidebarGroupAction>
      )}
      {open && (
        <SidebarGroupContent>
          <SidebarMenu>{children}</SidebarMenu>
        </SidebarGroupContent>
      )}
    </SidebarGroup>
  )
}

function useDropTarget(onDrop?: (key: string) => void) {
  const [over, setOver] = useState(false)
  if (!onDrop) return { over: false, props: {} }
  return {
    over,
    props: {
      onDragOver: (e: React.DragEvent) => {
        if (!e.dataTransfer.types.includes(DRAG_TYPE)) return
        e.preventDefault()
        e.dataTransfer.dropEffect = "move"
        setOver(true)
      },
      onDragLeave: () => setOver(false),
      onDrop: (e: React.DragEvent) => {
        setOver(false)
        const key = e.dataTransfer.getData(DRAG_TYPE)
        if (key) {
          e.preventDefault()
          e.stopPropagation()
          onDrop(key)
        }
      },
    },
  }
}

function FolderRow({
  folder,
  open,
  empty,
  onToggle,
  onDrop,
  onNewFolder,
  onRename,
  onRemove,
  children,
}: {
  folder: Folder
  open: boolean
  empty: boolean
  onToggle: () => void
  onDrop: (key: string) => void
  onNewFolder: () => void
  onRename: () => void
  onRemove: () => void
  children: React.ReactNode
}) {
  const drop = useDropTarget(onDrop)
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        onClick={onToggle}
        {...drop.props}
        className={cn(drop.over && "bg-sidebar-accent text-sidebar-accent-foreground")}
        aria-expanded={open}
        title={folder.name}
      >
        <ChevronRightIcon className={cn("-mx-0.5 transition-transform", open && "rotate-90")} />
        {open ? <FolderOpenIcon /> : <FolderIcon />}
        <span>{folder.name}</span>
      </SidebarMenuButton>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <SidebarMenuAction showOnHover>
            <MoreHorizontalIcon />
          </SidebarMenuAction>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="right" align="start">
          <DropdownMenuItem onSelect={onNewFolder}>
            <FolderPlusIcon /> New subfolder
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={onRename}>
            <PencilIcon /> Rename
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={onRemove}>
            <Trash2Icon /> Remove folder
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {open && (
        <SidebarMenu className="ml-3.5 w-auto border-l border-sidebar-border pl-1.5">
          {children}
          {empty && <p className="px-2 py-1 text-xs text-muted-foreground">Drag items here</p>}
        </SidebarMenu>
      )}
    </SidebarMenuItem>
  )
}

function ItemRow({
  item,
  starred,
  folders,
  current,
  onStar,
  onMove,
  onNewFolder,
}: {
  item: Item
  starred: boolean
  folders: Folder[]
  current?: string
  onStar: () => void
  onMove: (folder?: string) => void
  onNewFolder: () => void
}) {
  // Folder names with their parents, so nested folders are clear in the Move menu.
  const label = (f: Folder): string => {
    const parent = f.parent && folders.find((x) => x.id === f.parent)
    return parent ? `${label(parent)} / ${f.name}` : f.name
  }
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        isActive={item.active}
        onClick={item.open}
        title={item.title}
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData(DRAG_TYPE, item.key)
          e.dataTransfer.effectAllowed = "move"
        }}
        className={cn(starred ? "pr-14" : "group-hover/menu-item:pr-14")}
      >
        {item.icon}
        <span>{item.title}</span>
      </SidebarMenuButton>
      <SidebarMenuAction
        showOnHover={!starred}
        onClick={onStar}
        className={cn("right-7", starred && "text-amber-500 peer-hover/menu-button:text-amber-500 hover:text-amber-500")}
        title={starred ? "Unstar" : "Star"}
        aria-pressed={starred}
      >
        <StarIcon className={cn(starred && "fill-current")} />
      </SidebarMenuAction>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <SidebarMenuAction showOnHover>
            <MoreHorizontalIcon />
          </SidebarMenuAction>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="right" align="start">
          <DropdownMenuItem onSelect={onStar}>
            {starred ? <StarOffIcon /> : <StarIcon />} {starred ? "Unstar" : "Star"}
          </DropdownMenuItem>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <FolderInputIcon /> Move to
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="max-h-80 overflow-y-auto">
              <DropdownMenuItem disabled={!current} onSelect={() => onMove(undefined)}>
                {item.section === "sources" ? "Sources" : "Notes"} (top level)
              </DropdownMenuItem>
              {folders
                .map((f) => [f, label(f)] as const)
                .sort((a, b) => a[1].localeCompare(b[1]))
                .map(([f, name]) => (
                  <DropdownMenuItem key={f.id} disabled={f.id === current} onSelect={() => onMove(f.id)}>
                    <FolderIcon /> {name}
                  </DropdownMenuItem>
                ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={onNewFolder}>
                <FolderPlusIcon /> New folder…
              </DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={item.remove}>
            <Trash2Icon /> {item.removeLabel}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </SidebarMenuItem>
  )
}

function NameDialog({
  open,
  title,
  initial,
  onCancel,
  onSave,
}: {
  open: boolean
  title: string
  initial: string
  onCancel: () => void
  onSave: (name: string) => void
}) {
  const [name, setName] = useState(initial)
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="sm:max-w-sm">
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            if (name.trim()) onSave(name.trim())
          }}
        >
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
          </DialogHeader>
          <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Folder name" maxLength={120} />
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
            <Button type="submit" disabled={!name.trim()}>
              {initial ? "Rename" : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
