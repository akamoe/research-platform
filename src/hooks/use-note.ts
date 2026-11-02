import { useCallback, useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { api } from "@/lib/api"

/**
 * Loads one note and saves edits back to disk.
 * Saves and renames run one after another, so an edit made while the note is being renamed
 * lands in the renamed file, never in a new copy under the old name.
 */
export function useNote(projectId: string, path: string) {
  const [content, setContent] = useState<string | null>(null)
  const [status, setStatus] = useState<"saved" | "saving" | "error">("saved")
  const latest = useRef("")
  const current = useRef(path)
  const queue = useRef<Promise<unknown>>(Promise.resolve())

  useEffect(() => {
    // We renamed it ourselves: same note, keep what's on screen.
    if (path === current.current && content !== null) return
    current.current = path
    setContent(null)
    api.note(projectId, path).then(
      (n) => {
        latest.current = n.content
        setContent(n.content)
      },
      (e) => toast.error(e.message),
    )
  }, [projectId, path]) // eslint-disable-line react-hooks/exhaustive-deps

  const enqueue = useCallback(<T,>(job: () => Promise<T>) => {
    const next = queue.current.then(job, job)
    queue.current = next.catch(() => {})
    return next
  }, [])

  const save = useCallback(
    (md: string) => {
      latest.current = md
      setStatus("saving")
      enqueue(() => api.saveNote(projectId, current.current, md)).then(
        () => setStatus("saved"),
        (e) => {
          setStatus("error")
          toast.error(`Couldn't save: ${e.message}`)
        },
      )
    },
    [projectId, enqueue],
  )

  /** Rename the note's file. Resolves to the new path. */
  const rename = useCallback(
    (name: string, unique = false) =>
      enqueue(async () => {
        const { path: next } = await api.renameNote(projectId, current.current, name, unique)
        current.current = next
        return next
      }),
    [projectId, enqueue],
  )

  /** Re-read the latest text into `content`, e.g. before switching editor views. */
  const sync = useCallback(() => setContent(latest.current), [])

  return { content, status, save, sync, rename }
}
