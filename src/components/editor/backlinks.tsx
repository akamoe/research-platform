import { useEffect, useState } from "react"
import { api } from "@/lib/api"
import { navigate } from "@/lib/router"

/** "Linked from": the notes whose `[[links]]` point at this one. Hidden when there are none. */
export function Backlinks({ projectId, path, refresh }: { projectId: string; path: string; refresh?: unknown }) {
  const [items, setItems] = useState<{ path: string; name: string; excerpt: string }[]>([])
  useEffect(() => {
    let live = true
    api.backlinks(projectId, path).then(
      (b) => live && setItems(b),
      () => live && setItems([]),
    )
    return () => {
      live = false
    }
  }, [projectId, path, refresh])
  if (!items.length) return null
  return (
    <section className="mt-2 mb-16 border-t pt-4 font-sans">
      <h2 className="mb-2 text-xs font-medium text-muted-foreground">Linked from</h2>
      <ul className="space-y-1">
        {items.map((b) => (
          <li key={b.path}>
            <button
              type="button"
              onClick={() => navigate({ name: "project", projectId, note: b.path })}
              className="w-full rounded-md px-2 py-1.5 text-left hover:bg-muted"
            >
              <div className="truncate text-sm font-medium">{b.name}</div>
              {b.excerpt && <div className="line-clamp-2 text-xs text-muted-foreground">{b.excerpt}</div>}
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}
