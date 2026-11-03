/** Sent by the PDF viewer when a highlight's colour changes; open notes update its links. */
export function highlightRecolored(sourceId: string, highlightId: string, dot: string) {
  window.dispatchEvent(new CustomEvent("rp:highlight-recolored", { detail: { url: `#hl/${sourceId}/${highlightId}`, dot } }))
}
export function onHighlightRecolored(fn: (d: { url: string; dot: string }) => void) {
  const on = (e: Event) => fn((e as CustomEvent<{ url: string; dot: string }>).detail)
  window.addEventListener("rp:highlight-recolored", on)
  return () => window.removeEventListener("rp:highlight-recolored", on)
}
