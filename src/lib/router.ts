import { useEffect, useState } from "react"

/**
 * Tiny hash router: #/ , #/p/<projectId>?note=<path> , ?paper=<id> , ?view=canvas ,
 * ?view=knowledge&page=<page id>
 */
export type View = "canvas" | "knowledge" | "references" | "latex" | "discover" | "thesis" | "matrix" | "supervisor" | "flashcards" | "reading"
export type Route =
  | { name: "home" }
  | { name: "project"; projectId: string; note?: string; paper?: string; view?: View; page?: string }

function parse(): Route {
  const hash = window.location.hash.replace(/^#/, "") || "/"
  const [pathname, query = ""] = hash.split("?")
  const params = new URLSearchParams(query)
  const m = pathname.match(/^\/p\/([\w-]+)/)
  if (m)
    return {
      name: "project",
      projectId: m[1],
      note: params.get("note") ?? undefined,
      paper: params.get("paper") ?? undefined,
      view: (["canvas", "knowledge", "references", "latex", "discover", "thesis", "matrix", "supervisor", "flashcards", "reading"] as const).find((v) => v === params.get("view")),
      page: params.get("page") ?? undefined,
    }
  return { name: "home" }
}

export function href(route: Route) {
  if (route.name === "home") return "#/"
  const q = route.view
    ? `?view=${route.view}${route.page ? `&page=${encodeURIComponent(route.page)}` : ""}`
    : route.paper
      ? `?paper=${encodeURIComponent(route.paper)}`
      : route.note
        ? `?note=${encodeURIComponent(route.note)}`
        : ""
  return `#/p/${route.projectId}${q}`
}

export function navigate(route: Route, replace = false) {
  const url = href(route)
  if (replace) history.replaceState(null, "", url)
  else history.pushState(null, "", url)
  window.dispatchEvent(new HashChangeEvent("hashchange"))
}

export function useRoute() {
  const [route, setRoute] = useState(parse)
  useEffect(() => {
    const on = () => setRoute(parse())
    window.addEventListener("hashchange", on)
    window.addEventListener("popstate", on)
    return () => {
      window.removeEventListener("hashchange", on)
      window.removeEventListener("popstate", on)
    }
  }, [])
  return route
}
