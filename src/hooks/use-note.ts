import { useCallback, useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { api } from "@/lib/api"

/** Loads one note and saves edits back to disk. */
export function useNote(projectId: string, path: string) {
  const [content, setContent] = useState<string | null>(null)
  const [status, setStatus] = useState<"saved" | "saving" | "error">("saved")
  const latest = useRef("")

  useEffect(() => {
    setContent(null)
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

  /** Re-read the latest text into `content`, e.g. before switching editor views. */
  const sync = useCallback(() => setContent(latest.current), [])

  return { content, status, save, sync }
}
