# Folio

[عربي](README.md) · **English**

*Every source, every note, one folio.*

Folio is a free research workspace for students. Collect your sources, read and highlight them, take notes, keep your references, and think your project through with the AI model of your choice.

**The AI never writes your paper.** It asks questions, explains, points you to the right page and gives feedback on your writing. The writing stays yours.

It runs on your own computer, opens in your browser, and keeps your files with you.

## What it does

- **Sources**: PDFs, Word files, web pages, YouTube videos and text, each with its own note beside it.
- **Highlights**: highlight PDFs; quotes are saved with a link back to the page.
- **Chat**: ask about one source or all of them; answers cite the page.
- **Search** (`Ctrl/⌘ K`): across every source and note, offline.
- **References**: add by DOI, BibTeX or title; export in any style (APA, IEEE, Harvard…).
- **Find papers**: search OpenAlex, Semantic Scholar and arXiv; add a paper with its free PDF in one click.
- Also: literature matrix, thesis plan, writing feedback, idea canvas, LaTeX editor, and export to Word and PDF.

## Install (once)

Nothing else to install first.

**Mac or Linux**: open **Terminal**, paste this line and press Enter:

```bash
curl -fsSL https://raw.githubusercontent.com/akamoe/research-platform/main/scripts/install.sh | bash
```

**Windows**: open **PowerShell** from the Start menu, paste this line and press Enter:

```powershell
irm https://raw.githubusercontent.com/akamoe/research-platform/main/scripts/install.ps1 | iex
```

The first time takes a few minutes. Then Folio opens in your browser and you get a **Folio** icon like any other app: in Launchpad and Spotlight on a Mac (drag it to the Dock), or on the Desktop and in the Start menu on Windows.

## Use

1. Open Folio from its icon.
2. In **Settings**, paste an API key from OpenAI, Anthropic, OpenRouter or OpenCode Go. Everything except the AI works without one.
3. Make a project, add sources with the **+** next to Sources, and start.

- **Update**: run the install line again. Your projects aren't touched.
- **Your files**: in the `ResearchPlatform` folder in your home folder. Copy it to back up.
- **Still running?** Folio runs in the background until you shut down, and uses very little.
- **Privacy**: only your computer can reach it. The only thing that leaves is the text you send to the AI provider you chose.

Every feature in detail: [the guide](docs/GUIDE.md).

## Contribute

Fixes and new features are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) first.

```bash
git clone https://github.com/akamoe/research-platform.git
cd research-platform
npm ci
npm run dev        # API server on :5174 + Vite on :5173 with hot reload
npm run folio      # start Folio the way students do
npm run shortcut   # make a Folio app icon for this copy
```

## Credits

Theme presets in `src/lib/tweakcn-presets.json` come from [tweakcn](https://github.com/jnsahaj/tweakcn) (Apache-2.0).
