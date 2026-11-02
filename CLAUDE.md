# Research Platform

Local-first web app for students writing research papers. Hard product rule: the AI must never write the student's paper; see `server/mentor.ts`, which is sent as the system prompt for every model.

- `server/`: Hono server (run with `tsx`, no build step). Stores everything as plain files under `RP_DATA_DIR` (default `~/ResearchPlatform`). `llm.ts` talks to providers with plain `fetch` (OpenAI-compatible for OpenAI/OpenRouter/OpenCode Go, native Messages API for Anthropic). Keys never leave the server.
- `src/`: Vite + React + Tailwind v4 + shadcn/ui (new-york-v4 sources copied into `src/components/ui`). Hash router in `src/lib/router.ts`. Plate editor config in `src/components/editor/`.
- UI rules from the owner: shadcn components (or shadcn-compatible libraries) only, minimal, no clutter.
- Checks: `npm run typecheck` and `npx vite build`.
- Deletes go to `<data>/.trash`, never hard-delete user files.
