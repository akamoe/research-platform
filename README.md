# Folio

*Every source, every note, one folio.*

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
    knowledge/           the knowledge base: an Open Knowledge Format bundle
                         (index.md, log.md, papers/*.md, concepts/*.md)
    canvas.json          the notes canvas: cards, links, themes and your drawings
    references.json      your reference library (CSL JSON), with references.bib
                         kept next to it for LaTeX, Zotero or pandoc
    sources/             your PDFs and other sources, their text, a small record for each,
                         and your highlights (<id>.highlights.json, <id>-assets/*.png)
    chats/*.json         chat history
  .trash/                deleted notes and projects, so nothing is lost
```

## Using it

- **Projects**: one per paper or research question.
- **Sources**: press **+** next to Sources in the sidebar to add a PDF, Word (.docx), Markdown or text file, a web article, a YouTube video (its transcript), a direct link to a PDF, or pasted text. You can also drop files onto the window. Each source opens on the left with its own note on the right (drag the divider to resize): PDFs in the PDF viewer, everything else in a clean reader, with the video player above a YouTube transcript (click a timestamp to play from there). Switch to **Chat** to ask about that source: the model reads its text, cites page numbers or timestamps, and the conversation is saved with it. **Summary** gives AI reading notes for the source (what it found, key claims with page links, methods, limitations, open questions); they are the source's page in the knowledge base, so chat reads the same notes. Web pages that need a login, or that load their text with scripts, can't be fetched; paste their text instead. Scanned PDFs without a text layer can be read but not chatted with yet.
- **Highlights**: select text in a PDF and pick a color. The highlight stays on the PDF and the quote is copied with a small `p. N` link; paste it into the note, and click the link to jump back to that spot. **Capture area** grabs a figure or table as an image the same way. The **Copy / Add to note** switch above the PDF decides whether new highlights are copied (the default) or go straight into the note. Click a highlight to recolor it, copy it, add it to the note, or remove it. Drag the handles on an image in a note to resize it; the size is kept in the markdown as `![caption|320](...)`. Highlights live in their own file; your PDF is never changed.
- **Canvas**: write one thought per card in the box at the bottom. Pick its kind in the row above the box (Question, Claim, Evidence, Idea…), or leave it on Auto and the AI sorts it; typing `#question` etc. also works. A few seconds after you stop, the AI reads new cards: it sets a kind, adds a short note (a caveat, a definition or a question), tags it, links related cards (green supports, red dashed contradicts; hover a line for why) and lists emerging themes on the right. Double-click a card to edit it; select it and press Delete to remove it (Undo brings it back). It uses the model you last picked in chat and never writes text for your paper.
- **Drawing on the canvas**: the tools on the left draw rectangles (R), ellipses (O), arrows (A), freehand pen strokes (P) and text (T); V or Escape goes back to selecting. Hover a card or shape to see its dots; drag from a dot onto another card or shape to connect them with an arrow that stays attached when they move (the arrow tool does the same). Drag across empty canvas to select several items (Shift or ⌘/Ctrl-click adds one); scroll, Space-drag or middle-drag moves around, and pinch or ⌘/Ctrl-scroll zooms. A small bar above the selection has color, duplicate (⌘/Ctrl D) and delete. Select a shape to resize it; double-click a rectangle or ellipse to label it. Rectangles sit behind cards, so you can use them to group cards.
- **Knowledge base**: the AI's memory of the project, following Google's Open Knowledge Format and Karpathy's LLM-wiki loop. Each PDF you add is read once (automatically if a model is set up) and filed into a page for the paper plus shared concept pages, with page citations and a **Tensions** section when papers disagree. **Check** looks for contradictions, gaps and broken links. Pages are AI notes until you **Mark reviewed** (the OKF `verified` field); you can edit any page. The chat reads the index and the most relevant pages, so it builds on what you've read.
- **Notes**: a markdown editor with a slim toolbar on top (turn into heading, quote or code block; bold, italic, strikethrough, code, highlight, link; bulleted, numbered and check lists; undo/redo). Markdown shortcuts work too: `# ` for a heading, `- ` for a list, `> ` for a quote, `**bold**`, `==highlight==`. The `</>` button switches to the raw markdown. A note's file is named after its first `# heading` and follows it as you change it; renaming the note yourself (click its name at the top) stops that.
- **References and citations**: open **References** in the sidebar and press **Add**. Paste a DOI or doi.org link, BibTeX or RIS (several at once is fine), or type a title to search Crossref and pick the match; you can also import a .bib or .ris file. PDFs you upload that print their DOI are added automatically and linked to the paper. Each reference gets a key like `@walker2002practice`; edit any field, or delete it (Undo brings it back). In a note, **Cite** on the toolbar inserts `[@walker2002practice]` (cite again right after to get `[@a; @b]`), pandoc's citation syntax, so pandoc or Quarto can turn the note into a Word or LaTeX document with real citations. Tick the boxes next to references to pick some: a bar appears where you choose a style and copy them as a reference list or an in-text citation, export them, or delete them. **Export** builds a bibliography for the whole library or just what one note cites, in any of the 10,000+ CSL styles (APA, MLA, Chicago, IEEE, Harvard, Vancouver, or search a journal's name), copied with formatting for Word or Google Docs, or as BibTeX, RIS or CSL JSON. DOI lookup, title search and less common styles need the internet; styles are cached once fetched.
- **Search** (`Ctrl/⌘ K`): finds words in the full text of every paper and note, with the matching passage, and opens the paper at that page. It runs on your computer, so it works offline and without an API key.
- **Themes**: **Settings → Theme** picks the color theme. Folio (warm paper, oxblood ink) is the default; Neutral and 42 presets from [tweakcn](https://tweakcn.com) are built in. To use your own, design it on tweakcn, open **Code**, copy the CSS and press **Paste theme**. Light, dark and system mode work with every theme. Themes that use web fonts load them from Google Fonts when online.
- **Chat** (`Ctrl/⌘ J`): pick any model from your connected providers. The assistant can see the note you have open (click the note chip to hide it). It also searches your papers for passages that match your question, answers from them, and cites them as small chips: click one to read the passage and open the PDF on that page. The papers chip under the box picks which papers it searches. It follows one firm rule in every model: it won't write your paper.

## Development

```bash
npm run dev        # API server on :5174 + Vite on :5173 with hot reload
npm run typecheck
```

Stack: Vite, React, TypeScript, Tailwind and [shadcn/ui](https://ui.shadcn.com) in the browser; [Plate](https://platejs.org) for markdown editing; a small [Hono](https://hono.dev) server for files and model calls. The server only listens on `127.0.0.1` and rejects requests from other websites.

## Roadmap

1. **Foundation**: projects, markdown notes, API keys, model picker, mentor chat. *(done)*
2. **Knowledge base and notes canvas**: a per-project wiki in the Open Knowledge Format, maintained on Karpathy's ingest / query / lint loop and used as the chat's memory; a canvas where you write freely and the AI quietly tags, links, and flags contradictions. *(done)*
3. **Library and citations**: PDF upload, side-by-side reading notes, colored highlights and figure captures, per-paper chat, a reference library (DOI, BibTeX, RIS, title search), `[@key]` citations in notes, and bibliography export in any CSL style or as BibTeX/RIS are done, plus open-notebook's features in this UI: full-text search, chat across all sources with cited passages, web/YouTube/Word/text sources, and per-source summaries.
4. **LaTeX editor**: write LaTeX with a live PDF preview compiled locally, wired to your library.

## Credits

Theme presets in `src/lib/tweakcn-presets.json` come from [tweakcn](https://github.com/jnsahaj/tweakcn) (Apache-2.0).
