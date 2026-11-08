import { useEffect, useRef, useState } from "react"
import { LoaderCircleIcon, RefreshCwIcon } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { api, type UpdateCheck, type UpdateJob } from "@/lib/api"

const day = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : null
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** The "Check for updates" part of Settings. */
export function UpdateSettings() {
  const [check, setCheck] = useState<UpdateCheck | null>(null)
  const [checking, setChecking] = useState(false)
  const [job, setJob] = useState<UpdateJob | null>(null)
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  const runCheck = async () => {
    setChecking(true)
    try {
      setCheck(await api.checkUpdate())
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setChecking(false)
    }
  }

  /** Polls the update, then waits for the new server and reloads the page. */
  const follow = async (first: UpdateJob) => {
    const { pid } = await api.health().catch(() => ({ pid: 0 }))
    let j = first
    setJob(j)
    while (j.state === "running" && alive.current) {
      await wait(1500)
      j = await api.updateProgress().catch(() => ({ state: "restarting", step: "Restarting Folio" }) as UpdateJob)
      setJob(j)
    }
    if (j.state === "error") {
      toast.error(j.error ?? "The update failed")
      return
    }
    if (j.state !== "restarting") return
    for (let i = 0; i < 240; i++) {
      await wait(1000)
      const h = await api.health().catch(() => null)
      if (h && h.pid !== pid) {
        location.reload()
        return
      }
    }
    setJob({ state: "error", step: "", error: "Folio didn't come back. Open it again from its icon." })
  }

  const update = async () => {
    try {
      await follow(await api.startUpdate())
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  // An update may already be running (Settings was closed and opened again).
  useEffect(() => {
    api.updateProgress().then(
      (j) => {
        if (j.state === "running" || j.state === "restarting") void follow(j)
      },
      () => {},
    )
  }, [])

  const busy = job?.state === "running" || job?.state === "restarting"
  const version = check?.current.sha ? check.current.sha.slice(0, 7) : null
  // The Mac app updates itself when it opens, so there's nothing to click here.
  if (check?.kind === "desktop") {
    return (
      <div>
        <Label>Updates</Label>
        <p className="mt-1 text-xs text-muted-foreground">{check.blocked}</p>
      </div>
    )
  }
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <Label>Updates</Label>
          <p className="mt-1 text-xs text-muted-foreground">
            {busy
              ? `${job.step}…`
              : job?.state === "error"
                ? <span className="text-destructive">{job.error}</span>
                : !check
                  ? "Get the newest version of Folio."
                  : !check.available
                    ? `Folio is up to date${version ? ` (${version}, ${day(check.current.date)})` : ""}.`
                    : check.behind === 1
                      ? "A new version is ready."
                      : `${check.behind} updates are ready.`}
          </p>
        </div>
        {check?.available && !check.blocked && job?.state !== "error" ? (
          <Button size="sm" onClick={update} disabled={busy}>
            {busy && <LoaderCircleIcon className="animate-spin" />}
            {busy ? "Updating" : "Update now"}
          </Button>
        ) : (
          <Button size="sm" variant="outline" onClick={runCheck} disabled={checking || busy}>
            {checking ? <LoaderCircleIcon className="animate-spin" /> : <RefreshCwIcon />}
            Check for updates
          </Button>
        )}
      </div>
      {check?.available && !busy && (
        <ul className="space-y-1 text-xs text-muted-foreground">
          {check.commits.slice(0, 5).map((c) => (
            <li key={c.sha} className="truncate" title={c.title}>
              · {c.title.split(": ")[0]}
            </li>
          ))}
          {check.commits.length > 5 && <li>and {check.behind - 5} more</li>}
        </ul>
      )}
      {check?.blocked && <p className="text-xs text-muted-foreground">{check.blocked}</p>}
    </div>
  )
}
