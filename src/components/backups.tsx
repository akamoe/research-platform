import { useEffect, useRef, useState } from "react"
import { ArchiveRestoreIcon, LoaderCircleIcon, UploadIcon } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { api, type BackupEvery, type BackupStatus, type Project } from "@/lib/api"
import { navigate } from "@/lib/router"

const when = (iso: string) => {
  const d = new Date(iso)
  const t = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
  if (d.toDateString() === new Date().toDateString()) return `today at ${t}`
  return `${d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: d.getFullYear() === new Date().getFullYear() ? undefined : "numeric" })} at ${t}`
}
const size = (n: number) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`)

/** The Backups part of Settings. */
export function BackupSettings({ open }: { open: boolean }) {
  const [status, setStatus] = useState<BackupStatus | null>(null)
  const [dir, setDir] = useState("")
  const [busy, setBusy] = useState(false)
  const [restoring, setRestoring] = useState(false)

  useEffect(() => {
    if (!open) return
    api.backups().then((s) => {
      setStatus(s)
      setDir(s.dir)
    }, (e) => toast.error(e.message))
  }, [open])

  const save = async (body: { dir?: string; every?: BackupEvery }) => {
    try {
      const s = await api.saveBackupSettings(body)
      setStatus(s)
      setDir(s.dir)
      if (body.dir !== undefined) toast.success("Backups will go to this folder")
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  const now = async () => {
    setBusy(true)
    try {
      setStatus(await api.backUpNow())
      toast.success("Every project is backed up")
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (!status) return null
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-4">
        <div>
          <Label>Backups</Label>
          <p className="mt-1 text-xs text-muted-foreground">
            {status.last ? `Last backup ${when(status.last)}` : "No backups yet"}
            {status.error && <span className="text-destructive"> · The last one failed: {status.error}</span>}
          </p>
        </div>
        <Select value={status.every} onValueChange={(v) => save({ every: v as BackupEvery })}>
          <SelectTrigger className="h-8 w-36" aria-label="How often">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="daily">Every day</SelectItem>
            <SelectItem value="weekly">Every week</SelectItem>
            <SelectItem value="off">Off</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          save({ dir })
        }}
      >
        <Input value={dir} onChange={(e) => setDir(e.target.value)} className="font-mono text-xs" aria-label="Backup folder" spellCheck={false} />
        {dir.trim() !== status.dir && (
          <Button type="submit" variant="secondary">
            Save
          </Button>
        )}
      </form>
      <p className="text-xs text-muted-foreground">
        Folio zips each changed project into this folder and keeps the last {status.keep} of each. Use a folder that Dropbox, iCloud Drive, OneDrive or
        Google Drive syncs to keep a copy off this computer, and to restore your projects on another one. API keys are never in a backup.
      </p>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" disabled={busy} onClick={now}>
          {busy ? <LoaderCircleIcon className="animate-spin" /> : null} Back up now
        </Button>
        <Button variant="outline" size="sm" onClick={() => setRestoring(true)}>
          <ArchiveRestoreIcon /> Restore…
        </Button>
      </div>
      <RestoreDialog open={restoring} onOpenChange={setRestoring} status={status} />
    </div>
  )
}

function RestoreDialog({ open, onOpenChange, status }: { open: boolean; onOpenChange: (o: boolean) => void; status: BackupStatus }) {
  const [projects, setProjects] = useState<Project[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) api.projects().then(setProjects, () => {})
  }, [open])

  const done = (p: Project, mode: "copy" | "replace") => {
    toast.success(mode === "replace" ? `${p.name} is back as it was in the backup` : `Restored as “${p.name}”`, {
      description: mode === "replace" ? "The version you replaced is in the trash." : undefined,
    })
    onOpenChange(false)
    navigate({ name: "project", projectId: p.id })
    // The open project may have been swapped under the app: start fresh.
    if (mode === "replace") window.setTimeout(() => window.location.reload(), 50)
  }
  const restore = async (file: string, mode: "copy" | "replace") => {
    setBusy(`${file}:${mode}`)
    try {
      done(await api.restoreBackup(file, mode), mode)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(null)
    }
  }
  const fromFile = async (f: File) => {
    setBusy("file")
    try {
      done(await api.importBackup(f, "copy"), "copy")
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  const groups = new Map<string, typeof status.backups>()
  for (const b of status.backups) groups.set(b.projectId, [...(groups.get(b.projectId) ?? []), b])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[80vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Restore a backup</DialogTitle>
          <DialogDescription>
            Restore as a copy to look at an older version next to your project, or replace the project with it. A replaced project goes to the trash, so
            nothing is lost.
          </DialogDescription>
        </DialogHeader>
        {!groups.size && <p className="text-sm text-muted-foreground">There are no backups in {status.dir} yet.</p>}
        <div className="space-y-4">
          {[...groups].map(([pid, list]) => {
            const current = projects.find((p) => p.id === pid)
            return (
              <div key={pid}>
                <div className="mb-1 text-sm font-medium">{current?.name ?? list[0].name}</div>
                <ul className="divide-y rounded-md border">
                  {list.map((b) => (
                    <li key={b.file} className="flex items-center gap-2 px-3 py-2 text-sm" data-testid="backup">
                      <span className="min-w-0 flex-1">
                        {when(b.at)} <span className="text-xs text-muted-foreground">· {size(b.bytes)}</span>
                      </span>
                      <Button variant="ghost" size="sm" className="h-7" disabled={!!busy} onClick={() => restore(b.file, "copy")}>
                        {busy === `${b.file}:copy` && <LoaderCircleIcon className="animate-spin" />}
                        {current ? "As a copy" : "Restore"}
                      </Button>
                      {current && (
                        <Button variant="ghost" size="sm" className="h-7" disabled={!!busy} onClick={() => restore(b.file, "replace")}>
                          {busy === `${b.file}:replace` && <LoaderCircleIcon className="animate-spin" />}
                          Replace
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )
          })}
        </div>
        <input
          ref={input}
          type="file"
          accept=".zip,application/zip"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            e.target.value = ""
            if (f) fromFile(f)
          }}
        />
        <Button variant="outline" className="w-full" disabled={!!busy} onClick={() => input.current?.click()}>
          {busy === "file" ? <LoaderCircleIcon className="animate-spin" /> : <UploadIcon />} Restore from a .zip file
        </Button>
      </DialogContent>
    </Dialog>
  )
}
