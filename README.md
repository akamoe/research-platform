# Research Platform

A local research workspace for students. Collect ideas, take reading notes, and think through your project with the AI model of your choice. **The AI never writes your paper.** It asks questions, explains, and gives feedback, but the writing is yours.

Everything runs on your own computer and opens in your browser. Your work is saved as plain `.md` files you can open in any editor.

## Quick start

You need [Node.js](https://nodejs.org) 20 or newer.

```bash
npm install
npm start
```

This builds the app and opens <http://localhost:5174> in your browser. Next time, `npm run serve` starts it without rebuilding.

Then open **Settings** and paste an API key for any of:

| Provider | Where to get a key |
| --- | --- |
| OpenAI | platform.openai.com/api-keys |
| Anthropic | console.anthropic.com/settings/keys |
| OpenRouter | openrouter.ai/keys |
| OpenCode Go | opencode.ai (Go plan) |

Each provider also has an editable base URL, in case you use a proxy or a compatible endpoint.

## Where your files live

By default everything is in `~/ResearchPlatform` (set `RP_DATA_DIR` to change it):

```
ResearchPlatform/
  settings.json          your API keys (readable only by you)
  projects/<project>/
    project.json
    notes/*.md           your notes, as plain markdown
    knowledge/           the project's knowledge base (coming in step 2)
    sources/             your PDFs, their extracted text, and a small record for each
    chats/*.json         chat history
  .trash/                deleted notes and projects, so nothing is lost
```

## Using it

- **Projects**: one per paper or research question.
- **Papers**: add PDFs with the upload button in the sidebar, or drag them onto the window. Each paper opens with the PDF on the left and its own note on the right (drag the divider to resize). Switch to **Chat** to ask about that paper: the model reads its text, cites page numbers, and the conversation is saved with the paper. Scanned PDFs without a text layer can be read but not chatted with yet.
- **Notes**: a markdown editor with no toolbars. Type `# ` for a heading, `- ` for a list, `> ` for a quote, `**bold**`, `==highlight==`. The `</>` button switches to the raw markdown.
- **Chat** (`Ctrl/⌘ J`): pick any model from your connected providers. The assistant can see the note you have open (click the note chip to hide it). It follows one firm rule in every model: it won't write your paper.

## Development

```bash
npm run dev        # API server on :5174 + Vite on :5173 with hot reload
npm run typecheck
```

Stack: Vite, React, TypeScript, Tailwind and [shadcn/ui](https://ui.shadcn.com) in the browser; [Plate](https://platejs.org) for markdown editing; a small [Hono](https://hono.dev) server for files and model calls. The server only listens on `127.0.0.1` and rejects requests from other websites.

## Roadmap

1. **Foundation**: projects, markdown notes, API keys, model picker, mentor chat. *(done)*
2. **Knowledge base and notes canvas**: a per-project wiki in the Open Knowledge Format, maintained on Karpathy's ingest / query / lint loop and used as the chat's memory; a canvas where you write freely and the AI quietly tags, links, and flags contradictions.
3. **Library and citations**: PDF upload, side-by-side reading notes and per-paper chat are done. Still to come: add papers by DOI or BibTeX, search and chat across them (open-notebook's engine behind this UI), export citations in any CSL style or as BibTeX/RIS.
4. **LaTeX editor**: write LaTeX with a live PDF preview compiled locally, wired to your library.
