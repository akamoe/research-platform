import { useState } from "react"
import { BookOpenIcon, CheckIcon, ChevronDownIcon, FileTextIcon, PlusIcon } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { api, type NoteFile, type Source } from "@/lib/api"
import { navigate } from "@/lib/router"

const nameOf = (p: string) => p.replace(/\.md$/i, "").split("/").pop() ?? p

/** Which note the paper view writes in: the paper's own, or a note shared with other papers. */
export function paperNoteKey(sourceId: string) {
  return `rp-paper-note:${sourceId}`
}
export function chosenNote(source: Source) {
  try {
    const p = localStorage.getItem(paperNoteKey(source.id))
    if (p && source.notes?.includes(p)) return p
  } catch {}
  return source.notePath
}

/**
 * The menu next to the Note tab: switch between the paper's own reading note and notes it shares
 * with other papers (one note about a theme, written while reading several papers).
 */
export function NotePicker({
  projectId,
  source,
  current,
  onPick,
  onChanged,
  onNotesChanged,
}: {
  projectId: string
  source: Source
  current: string
  onPick: (path: string) => void
  onChanged: (s: Source) => void
  onNotesChanged?: () => void
}) {
  const [finding, setFinding] = useState(false)
  const [all, setAll] = useState<NoteFile[]>([])
  const [query, setQuery] = useState("")
  const shared = source.notes ?? []

  const pick = (p: string) => {
    try {
      if (p === source.notePath) localStorage.removeItem(paperNoteKey(source.id))
      else localStorage.setItem(paperNoteKey(source.id), p)
    } catch {}
    onPick(p)
  }
  const attach = async (p: string) => {
    try {
      onChanged(await api.attachNote(projectId, source.id, p, true))
      pick(p)
      setFinding(false)
    } catch (e) {
      toast.error((e as Error).message)
    }
  }
  const createAndAttach = async (name: string) => {
    try {
      const { path } = await api.createNote(projectId, name.trim() || "Untitled", `# ${name.trim() || "Untitled"}\n\n`)
      await attach(path)
      onNotesChanged?.()
    } catch (e) {
      toast.error((e as Error).message)
    }
  }
  const detach = async (p: string) => {
    try {
      onChanged(await api.attachNote(projectId, source.id, p, false))
      pick(source.notePath)
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  const candidates = all.filter((n) => !n.path.startsWith("Papers/") && !shared.includes(n.path))

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="-ml-1 size-6 text-muted-foreground" aria-label="Choose the note">
            <ChevronDownIcon className="size-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64">
          <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Write about this paper in</DropdownMenuLabel>
          <DropdownMenuItem onSelect={() => pick(source.notePath)}>
            <CheckIcon className={current === source.notePath ? "" : "invisible"} />
            Its own reading note
          </DropdownMenuItem>
          {shared.map((p) => (
            <DropdownMenuItem key={p} onSelect={() => pick(p)}>
              <CheckIcon className={current === p ? "" : "invisible"} />
              <span className="truncate">{nameOf(p)}</span>
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={() => {
              setQuery("")
              setFinding(true)
              api.notes(projectId).then(setAll, () => {})
            }}
          >
            <PlusIcon /> Use another note too…
          </DropdownMenuItem>
          {current !== source.notePath && (
            <DropdownMenuItem onSelect={() => detach(current)}>
              <span className="pl-6">Stop using “{nameOf(current)}” here</span>
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <CommandDialog open={finding} onOpenChange={setFinding} title="Use a note with this paper" description="Pick a note to write in while you read this paper">
        <CommandInput placeholder="Find a note, or name a new one…" value={query} onValueChange={setQuery} />
        <CommandList>
          <CommandEmpty>No note by that name.</CommandEmpty>
          {query.trim() && (
            <CommandGroup>
              <CommandItem value={`new ${query}`} onSelect={() => createAndAttach(query)}>
                <PlusIcon /> New note “{query.trim()}”
              </CommandItem>
            </CommandGroup>
          )}
          <CommandGroup heading="Your notes">
            {candidates.map((n) => (
              <CommandItem key={n.path} value={n.path} onSelect={() => attach(n.path)}>
                <FileTextIcon className="text-muted-foreground" />
                <span className="truncate">{n.name}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        </CommandList>
      </CommandDialog>
    </>
  )
}

/** Under a note: the papers it's written with. Opening one shows it beside this note. */
export function NotePapers({ projectId, path, papers }: { projectId: string; path: string; papers: Source[] }) {
  const used = papers.filter((p) => p.notes?.includes(path))
  if (!used.length) return null
  return (
    <section className="mt-2 border-t pt-4 font-sans" data-testid="note-papers">
      <h2 className="mb-2 text-xs font-medium text-muted-foreground">Written with {used.length === 1 ? "this paper" : `these ${used.length} papers`}</h2>
      <ul className="flex flex-wrap gap-1.5">
        {used.map((p) => (
          <li key={p.id}>
            <Button
              variant="outline"
              size="sm"
              className="h-7 max-w-64 font-normal"
              onClick={() => {
                try {
                  localStorage.setItem(paperNoteKey(p.id), path)
                } catch {}
                navigate({ name: "project", projectId, paper: p.id })
              }}
            >
              <BookOpenIcon className="text-muted-foreground" />
              <span className="truncate">{p.title}</span>
            </Button>
          </li>
        ))}
      </ul>
    </section>
  )
}
