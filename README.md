# Folio

**English** · [العربية](README.ar.md)

*Every source, every note, one folio.*

Folio is a research workspace for students. Collect your sources, read and highlight them, take notes, keep your references, and think your project through with the AI model of your choice.

**The AI never writes your paper.** It asks questions, explains, points you to the right page and gives feedback. The writing stays yours.

Folio runs on your own computer and opens in your browser. Your work is saved as plain files (`.md` notes, your PDFs, a `.bib` file) that you can open in any other app.

## What it does

- **Sources**: PDFs, Word files, Markdown and text files, web articles, YouTube videos (via their transcript) and pasted text, each with its own reading note beside it.
- **Highlights**: colored highlights and figure captures in PDFs, copied into your notes with a link back to the page.
- **Notes**: a clean markdown editor with a small toolbar.
- **Chat**: ask about one source or all of them. Answers cite the exact passage and open the source at that page.
- **Search** (`Ctrl/⌘ K`): full-text search across every source and note, offline.
- **Summaries**: key claims, methods, limitations and open questions for each source.
- **Knowledge base**: the AI's memory of your project, built from what you have read.
- **Canvas**: drop ideas as cards, draw shapes and arrows, and let the AI sort and connect them.
- **Writing feedback**: points at unclear sentences, weak structure, claims without a citation, grammar and vague words in your notes and LaTeX, and asks questions. It never rewrites your text.
- **Thesis**: plan your chapters with word goals and due dates, track words written (counted from your notes or LaTeX files), your submission date and your supervisor's milestones.
- **Literature matrix**: every source in a row, your questions (method, findings, gaps…) in columns, with notes the AI takes from your highlights, each linked to its page.
- **Find papers**: search OpenAlex, Semantic Scholar, arXiv and Crossref in one place, follow related and citing papers, and add a paper with its free PDF in one click.
- **References**: add by DOI, BibTeX, RIS or title, cite in notes with `[@key]`, and export in any of 10,000+ citation styles (APA, MLA, Chicago, IEEE, Harvard…) or as BibTeX/RIS.
- **LaTeX**: write your paper in LaTeX beside a live PDF that compiles on your computer, with `\cite` completion from your References.
- **Bring your own key**: OpenAI, Anthropic, OpenRouter or OpenCode Go. Keys stay on your computer.

## Install

You need two free tools: **Git** and **Node.js 20 or newer**.

1. **Install Node.js**: download the LTS version from [nodejs.org](https://nodejs.org) and run the installer. On a Mac with Homebrew you can run `brew install node` instead.
2. **Install Git**:
   - macOS: open Terminal and run `xcode-select --install` (skip this if `git --version` already works).
   - Windows: download it from [git-scm.com](https://git-scm.com/download/win) and keep the default options.
   - Linux: use your package manager, for example `sudo apt install git`.
3. **Download Folio and start it.** Open Terminal (macOS/Linux) or PowerShell (Windows) and run:

   ```bash
   git clone https://github.com/akamoe/research-platform.git
   cd research-platform
   npm ci
   npm start
   ```

   The first start takes a minute. Folio then opens at <http://localhost:5174>. Keep the terminal window open while you use it; press `Ctrl+C` in it to stop Folio.

4. **Add an AI model.** In Folio, open **Settings** and paste an API key for any of these:

   | Provider | Where to get a key |
   | --- | --- |
   | OpenAI | [platform.openai.com/api-keys](https://platform.openai.com/api-keys) |
   | Anthropic | [console.anthropic.com/settings/keys](https://console.anthropic.com/settings/keys) |
   | OpenRouter | [openrouter.ai/keys](https://openrouter.ai/keys) |
   | OpenCode Go | [opencode.ai](https://opencode.ai) (Go plan) |

   Then pick a model in the chat. Each provider also has an editable base URL, for proxies or compatible endpoints. Everything except the AI features works without a key.

### Start it again later

Open a terminal in the folder and run:

```bash
cd research-platform
npm run serve
```

`npm run serve` starts Folio without rebuilding it, so it is quicker. Open <http://localhost:5174> if the browser doesn't open by itself.

### Update to the latest version

```bash
cd research-platform
git pull origin main
npm ci
npm start
```

Use `npm ci`, not `npm install`: `npm install` can change `package-lock.json`, and then the next `git pull` refuses to run. If that has already happened, run `git checkout -- package-lock.json` once and pull again. Updating never touches your projects, which live in a separate folder.

## Where your files live

By default everything is in `~/ResearchPlatform` (on Windows `C:\Users\<you>\ResearchPlatform`). Set `RP_DATA_DIR` to use another folder.

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
    latex/               your LaTeX paper (main.tex and any other files); the PDF is in latex/.build/
    organize.json        starred items and sidebar folders (files never move)
    thesis.json          your thesis plan: chapters, goals, dates, milestones
    matrix.json          the literature matrix
  .tools/                Tectonic, if Folio downloaded it for you
  .trash/                deleted notes, sources and projects, so nothing is lost
```

To back up your work, copy this folder.

## Privacy

Folio only listens on your own computer (`127.0.0.1`) and refuses requests from other websites. Your files never leave your machine, except the text you send to the AI provider you chose when you use an AI feature. Finding papers, DOI lookup, title search, web and YouTube sources and uncommon citation styles need the internet; everything else works offline.

## Guide

- **Projects**: one per paper or research question.
- **Sidebar**: click **Starred**, **Sources** or **Notes** to fold the list away. Choose **Star** in a source or note's `…` menu to pin it to **Starred** at the top. Hover over Sources or Notes for the folder button to make a folder; drag sources or notes onto a folder (or use **Move to** in the `…` menu), and use a folder's `…` menu for subfolders, renaming or removing it. Folders only arrange the sidebar: your files stay where they are, and removing a folder keeps everything that was in it.
- **Sources**: press **+** next to Sources in the sidebar to add a PDF, Word (.docx), Markdown or text file, a web article, a YouTube video (its transcript), a direct link to a PDF, or pasted text. You can also drop files onto the window. Each source opens on the left with its own note on the right (drag the divider to resize): PDFs in the PDF viewer, everything else in a clean reader, with the video player above a YouTube transcript (click a timestamp to play from there). Switch to **Chat** to ask about that source: the model reads its text, cites page numbers or timestamps, and the conversation is saved with it. **Summary** gives AI reading notes for the source (what it found, key claims with page links, methods, limitations, open questions); they are the source's page in the knowledge base, so chat reads the same notes. Web pages that need a login, or that load their text with scripts, can't be fetched; paste their text instead. Folio reads each PDF's text with [pdf-inspector](https://github.com/firecrawl/pdf-inspector), which keeps two-column papers in reading order, joins lines into paragraphs and keeps headings and tables, so search, chat and summaries see the paper the way you read it (on Intel Macs, where it isn't available, Folio uses its older reader). It also spots scanned pages: you can read and highlight them, but chat can't read them yet, and the paper's header says which pages they are.
- **Highlights**: select text in a PDF and pick a color. The highlight stays on the PDF and the quote is copied with a small `p. N` link; paste it into the note, and click the link to jump back to that spot. **Capture area** grabs a figure or table as an image the same way. The **Copy / Add to note** switch above the PDF decides whether new highlights are copied (the default) or go straight into the note. Click a highlight to recolor it, copy it, add it to the note, or remove it. Drag the handles on an image in a note to resize it; the size is kept in the markdown as `![caption|320](...)`. Highlights live in their own file; your PDF is never changed.
- **Canvas**: write one thought per card in the box at the bottom. Pick its kind in the row above the box (Question, Claim, Evidence, Idea…), or leave it on Auto and the AI sorts it; typing `#question` etc. also works. A few seconds after you stop, the AI reads new cards: it sets a kind, adds a short note (a caveat, a definition or a question), tags it, links related cards (green supports, red dashed contradicts; hover a line for why) and lists emerging themes on the right. Double-click a card to edit it; select it and press Delete to remove it (Undo brings it back). It uses the model you last picked in chat and never writes text for your paper.
- **Drawing on the canvas**: the tools on the left draw rectangles (R), ellipses (O), arrows (A), freehand pen strokes (P) and text (T); V or Escape goes back to selecting. Hover a card or shape to see its dots; drag from a dot onto another card or shape to connect them with an arrow that stays attached when they move (the arrow tool does the same). Drag across empty canvas to select several items (Shift or ⌘/Ctrl-click adds one); scroll, Space-drag or middle-drag moves around, and pinch or ⌘/Ctrl-scroll zooms. A small bar above the selection has color, duplicate (⌘/Ctrl D) and delete. Select a shape to resize it; double-click a rectangle or ellipse to label it. Rectangles sit behind cards, so you can use them to group cards.
- **Knowledge base**: the AI's memory of the project, following Google's Open Knowledge Format and Karpathy's LLM-wiki loop. Each PDF you add is read once (automatically if a model is set up) and filed into a page for the paper plus shared concept pages, with page citations and a **Tensions** section when papers disagree. **Check** looks for contradictions, gaps and broken links. Pages are AI notes until you **Mark reviewed** (the OKF `verified` field); you can edit any page. The chat reads the index and the most relevant pages, so it builds on what you've read.
- **Notes**: a markdown editor with a slim toolbar on top (turn into heading, quote or code block; bold, italic, strikethrough, code, highlight, link; bulleted, numbered and check lists; undo/redo). Markdown shortcuts work too: `# ` for a heading, `- ` for a list, `> ` for a quote, `**bold**`, `==highlight==`. The `</>` button switches to the raw markdown. A note's file is named after its first `# heading` and follows it as you change it; renaming the note yourself (click its name at the top) stops that.
- **Writing feedback**: in a note, press the check-mark button at the top right (or the same button in **LaTeX** for the open `.tex` file). Quick checks run at once, offline: very long sentences and paragraphs, repeated words, vague or absolute words ("very", "obviously", "proves"), and sentences that report what studies found or give a figure without a citation (`[@key]`, `\cite{}` or "(Author, 2020)" count). **Review with AI** adds a closer read for clarity, structure, uncited claims and grammar. Each point quotes the words it is about, which are underlined in the note; click a point to jump to them. The feedback says what the problem is and asks a question; it never gives replacement wording (any wording the model slips in is removed), so the fix stays yours. Filter by kind with the pills, dismiss points with ×, and press the refresh button after you've revised. The quick word checks are for English; the AI review works in any language.
- **Thesis plan**: open **Thesis** in the sidebar. **Start from a standard outline** adds Introduction, Literature review, Methodology, Results, Discussion and Conclusion with a share of a 15,000-word goal each, or add your own chapters. Click the word goal at the top or on a chapter to change it, and set your submission date; Folio shows the days left and roughly how many words a day you need. Under each chapter, **Link a note or LaTeX file** points it at the note or `.tex` file you write it in (or makes a new note for it), and its words are counted for you: prose only, without citations, maths, markup or LaTeX commands. The circle on the left sets the chapter's state (not started, drafting, revising, done), and each chapter can have a due date, shown in red when it's late. **Supervisor milestones** is a checklist with dates for things like sending a draft or ethics approval. The top line shows the words you've added today and this week. The chat knows your plan and dates, so it can help you plan your time. Everything is saved in `thesis.json` in the project folder.
- **Literature matrix**: open **Literature matrix** in the sidebar. Each source is a row; the columns start as Research question, Method, Sample / data, Key findings, Limitations and Gaps / future work. Add your own with **+** (say "Theory" or "Country", with a hint of what to look for), and rename or remove them from a column's `…` menu. **Fill empty cells** has the AI take short notes for every empty cell from your highlights (and from the source's text when you've highlighted little), with a page chip after each point: yellow chips are your highlights, and clicking one opens the paper at that page. A cell says "Not found" when the source doesn't cover it. Click any cell to write or correct it; the AI never changes a cell you wrote, and **Fill again** redoes one cell. A row's `…` menu fills just that source or hides it. **Export** copies the matrix as a Markdown table (paste it into a note) or downloads a CSV for Excel, with each source's citation key. The notes are for you to compare sources; the comparison in your review is yours to write.
- **Finding papers**: open **Find papers** in the sidebar and search by topic, title, author or DOI. By default it searches OpenAlex, Semantic Scholar and arXiv together (the same paper found twice is shown once); the menu next to the search box picks one of them or Crossref, and the filter button limits the years or shows only papers with a free PDF. Click a title to read its abstract. **Add with PDF** puts the paper in your References and downloads its free, legal open-access copy (from arXiv, the publisher or a repository, found through OpenAlex's Unpaywall data and Semantic Scholar) into Sources; **Add** adds only the reference when there is no free copy. If a "free" link turns out to need a login, Folio says so and keeps the reference. The `…` menu on each result shows **Related papers**, **Papers citing this** and **Its references**, so you can follow a paper's trail (the arrow goes back), and **Look for a free PDF**. From **References**, `…` → **Find related papers** starts from a paper you already have. All of this needs the internet; no account or key is needed.
- **References and citations**: open **References** in the sidebar and press **Add**. Paste a DOI or doi.org link, BibTeX or RIS (several at once is fine), or type a title to search Crossref and pick the match; you can also import a .bib or .ris file. PDFs you upload that print their DOI are added automatically and linked to the paper. Each reference gets a key like `@walker2002practice`; edit any field, or delete it (Undo brings it back). In a note, **Cite** on the toolbar inserts `[@walker2002practice]` (cite again right after to get `[@a; @b]`), pandoc's citation syntax, so pandoc or Quarto can turn the note into a Word or LaTeX document with real citations. Tick the boxes next to references to pick some: a bar appears where you choose a style and copy them as a reference list or an in-text citation, export them, or delete them. **Export** builds a bibliography for the whole library or just what one note cites, in any of the 10,000+ CSL styles (APA, MLA, Chicago, IEEE, Harvard, Vancouver, or search a journal's name), copied with formatting for Word or Google Docs, or as BibTeX, RIS or CSL JSON. DOI lookup, title search and less common styles need the internet; styles are cached once fetched.
- **LaTeX**: open **LaTeX** in the sidebar to write your paper in LaTeX, with the PDF beside it. Folio compiles on your computer. If you have MacTeX, TeX Live or MiKTeX, it uses that; otherwise it offers to download [Tectonic](https://tectonic-typesetting.github.io), a small LaTeX engine (about 20 MB). The first Tectonic compile downloads the packages your paper uses, so it needs the internet and takes a minute; after that it works offline. The PDF updates a moment after you stop typing (turn this off in the menu next to **Compile**), and `Ctrl/⌘ S` compiles right away. Type `\cite` (or press **Cite**) to pick from your References; `references.bib` is rewritten from them on every compile, so remove the `%` in front of `\bibliography{references}` once you cite something. Errors and warnings appear under the editor; click one to jump to its line. The file menu at the top adds chapter files (include them with `\input{name}`) and uploads figures (click an image there to insert it). **Download PDF** is in the menu next to **Compile**. For Arabic and other right-to-left languages, use `fontspec` or `polyglossia`: Tectonic handles them, and with TeX Live Folio switches to XeLaTeX by itself. The chat can read the file you have open, so you can ask for feedback on it. **Template** at the top starts main.tex from a journal's template (with a preview of each first page): IEEE (journals and conferences), ACM (journals and conferences), Springer LNCS, Physical Review (APS), AIP, MNRAS, AAS (ApJ), ACS, AMS, Nature, Elsevier, Oxford University Press, APA 7th, or a plain article. They all use LaTeX classes that come with TeX and Tectonic, so they work offline. What you had in main.tex is kept as a separate file (for example `main-before-ieee-journal.tex`), so copy your text across. If your journal isn't listed, download its LaTeX template from the journal's website and upload its `.cls` file from the file menu.
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
4. **LaTeX editor**: write LaTeX with a live PDF preview compiled locally, wired to your library. *(done)*

## Credits

Theme presets in `src/lib/tweakcn-presets.json` come from [tweakcn](https://github.com/jnsahaj/tweakcn) (Apache-2.0).
