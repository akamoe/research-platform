import { navigate } from "./router"

/** Open a paper and scroll its PDF to a page, from anywhere (search results, chat citations). */
export interface PageTarget {
  sourceId: string
  page: number
}

let pending: PageTarget | null = null

export function openSourceAt(projectId: string, target: PageTarget) {
  pending = target
  navigate({ name: "project", projectId, paper: target.sourceId })
  // If the paper is already open, it scrolls now; otherwise it picks this up when it loads.
  window.dispatchEvent(new CustomEvent<PageTarget>("rp:goto-page", { detail: target }))
}

export function takePendingPage(sourceId: string) {
  if (pending?.sourceId !== sourceId) return null
  const t = pending
  pending = null
  return t
}
