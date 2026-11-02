# Research Platform

Local-first web app for students writing research papers. Hard product rule: the AI must never write the student's paper; see `server/mentor.ts`, which is sent as the system prompt for every model.

- `server/`: Hono server (run with `tsx`, no build step). Stores everything as plain files under `RP_DATA_DIR` (default `~/ResearchPlatform`). `llm.ts` talks to providers with plain `fetch` (OpenAI-compatible for OpenAI/OpenRouter/OpenCode Go, native Messages API for Anthropic). Keys never leave the server.
- `src/`: Vite + React + Tailwind v4 + shadcn/ui (new-york-v4 sources copied into `src/components/ui`). Hash router in `src/lib/router.ts`. Plate editor config in `src/components/editor/`.
- UI rules from the owner: shadcn components (or shadcn-compatible libraries) only, minimal, no clutter.
- Checks: `npm run typecheck` and `npx vite build`.
- PDF viewer is EmbedPDF (headless, PDFium wasm served locally) in `src/components/papers/pdf-annotator.tsx`. Highlights are stored as overlays in `sources/<id>.highlights.json`, not written into the PDF. Note links to highlights use `#hl/<sourceId>/<highlightId>`.
- Knowledge base: `server/knowledge.ts` writes an OKF v0.2 bundle in `<project>/knowledge/` (index.md and log.md are regenerated/appended by code; pages merge per-paper subsections deterministically, the model only returns JSON). Canvas: `server/canvas.ts` + `src/components/canvas/` (React Flow; student drawings are `shapes`/`arrows` in canvas.json saved via PUT `/canvas/drawing`, pen strokes rendered with perfect-freehand). Background AI calls go through `server/ai.ts` and use `settings.defaultModel`.
- References: `server/references.ts` keeps `<project>/references.json` (CSL-JSON array, `id` = citation key) and regenerates `references.bib` on every write. citation-js (`@citation-js/*`) parses BibTeX/RIS and renders CSL; styles/locales are fetched from the CSL GitHub repos into `<data>/.cache/csl`. Notes cite with pandoc `[@key]`; `unescapeCitations` in `src/components/editor/plugins.ts` stops the markdown writer from saving them as `\[@key]`. UI in `src/components/references/` and the Cite button in `src/components/editor/toolbar.tsx`.
- Deletes go to `<data>/.trash`, never hard-delete user files.
