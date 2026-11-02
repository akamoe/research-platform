import { useEffect, useState } from "react"
import { PlusIcon, SettingsIcon } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { ProjectDialog } from "@/components/project-dialog"
import { api, type Project } from "@/lib/api"
import { navigate } from "@/lib/router"

const ago = (iso: string) => {
  const s = (Date.now() - new Date(iso).getTime()) / 1000
  if (s < 60) return "just now"
  if (s < 3600) return `${Math.floor(s / 60)} min ago`
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })
}

export function HomePage({ onOpenSettings }: { onOpenSettings: () => void }) {
  const [projects, setProjects] = useState<Project[] | null>(null)
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    api.projects().then(setProjects, (e) => toast.error(e.message))
  }, [])

  return (
    <div className="mx-auto flex min-h-full max-w-2xl flex-col px-6 py-16">
      <header className="mb-10 flex items-center">
        <h1 className="font-serif text-xl font-semibold tracking-tight">Folio</h1>
        <div className="ml-auto flex gap-1">
          <Button variant="ghost" size="icon" onClick={onOpenSettings} aria-label="Settings">
            <SettingsIcon className="size-4" />
          </Button>
          <Button onClick={() => setCreating(true)} size="sm">
            <PlusIcon /> New project
          </Button>
        </div>
      </header>

      {projects === null ? null : projects.length === 0 ? (
        <div className="mt-16 text-center">
          <p className="font-serif text-2xl">Every paper starts with a question.</p>
          <p className="mt-2 text-sm text-muted-foreground">Create a project to collect your ideas, notes and sources.</p>
          <Button className="mt-6" onClick={() => setCreating(true)}>
            <PlusIcon /> New project
          </Button>
        </div>
      ) : (
        <ul className="divide-y border-y">
          {projects.map((p) => (
            <li key={p.id}>
              <button
                className="flex w-full items-baseline gap-4 px-1 py-4 text-left transition-colors hover:bg-muted/50"
                onClick={() => navigate({ name: "project", projectId: p.id })}
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{p.name}</div>
                  {p.description && <div className="mt-0.5 truncate text-sm text-muted-foreground">{p.description}</div>}
                </div>
                <span className="shrink-0 text-xs text-muted-foreground">{ago(p.updatedAt)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <ProjectDialog
        open={creating}
        onOpenChange={setCreating}
        onSubmit={async (name, description) => {
          const p = await api.createProject(name, description)
          navigate({ name: "project", projectId: p.id })
        }}
      />
    </div>
  )
}
