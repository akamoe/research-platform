# Contributing to Folio

<div dir="rtl">

**بالمختصر:** سوّي fork للريبو، اشتغل على branch، تأكد `npm run typecheck` و `npx vite build` يمشون، وافتح Pull Request على `main` يشرح شنو غيّرت وليش، ويه صورة إذا غيّرت الواجهة. أهم قاعدة: **الذكاء الاصطناعي بـ Folio ما يكتب بحث الطالب أبداً**، فأي ميزة تكتب نص للبحث بدل الطالب ما تنقبل. وهم: بدون Python، الواجهة shadcn بس، وكلشي يبقى على جهاز الطالب.

</div>

Thanks for helping. Folio is a small project kept deliberately simple, so please read the rules below before you start: a pull request that breaks one of them can't be merged, however good the code is.

## The rules Folio won't bend

1. **The AI never writes the student's paper.** It asks questions, explains, finds sources and points at problems; the student writes. `server/mentor.ts` is the system prompt for every model and stays in every AI call. Not accepted: "rewrite this paragraph", "paraphrase", "generate a section/abstract/literature review", "fix my grammar" that hands back new wording, or anything that slips around the mentor prompt. Writing feedback may quote the student's words and ask; it may not suggest replacement wording.
2. **Local-first.** Everything lives as plain files in the student's data folder (`~/ResearchPlatform`): markdown notes, their PDFs, JSON and `.bib`. No accounts, no cloud database, no analytics or telemetry. The server listens only on `127.0.0.1`. The internet is used only when a feature needs it (an AI call, finding papers, a DOI lookup) and only for that.
3. **Keys stay on the server.** API keys are read and used in `server/`; they are never sent to the browser or anywhere except the provider they belong to.
4. **Node only.** No Python, no GPU, no Docker, no service the student has to install and run. Folio must install with the one-line installer on macOS, Windows and Linux. A native npm package is fine only if it ships prebuilt binaries and Folio has a fallback where it doesn't (see how `@firecrawl/pdf-inspector` falls back to pdf.js).
5. **shadcn/ui, minimal.** Use the components in `src/components/ui` (or shadcn-compatible libraries). No other UI kits, no decorative color bars, no clutter. If a screen gets busier, something else should get quieter.
6. **Never lose a student's work.** Deletes go to `<data>/.trash`. Old data files must keep opening after your change; if you change a file format, read the old one too.
7. **Browser app, not desktop.** No Electron or Tauri wrapper.

## How to contribute

1. **Big idea? Open an issue first.** Describe the problem for students and your plan, so you don't build something that can't be merged. Small fixes can go straight to a pull request.
2. **Fork** the repo on GitHub and clone your fork:
   ```bash
   git clone https://github.com/<you>/research-platform.git
   cd research-platform
   npm ci
   git checkout -b my-change
   ```
   Use `npm ci`, not `npm install`. If you add a package, use `npm install <pkg>` once and commit the updated `package-lock.json`.
3. **Run it** with `npm run dev` (API server on :5174, Vite on :5173 with hot reload). Point it at a test folder so your own projects stay safe: `RP_DATA_DIR=/tmp/folio-test npm run dev`.
4. **Make one change per pull request.** One feature or one fix, nothing unrelated. Keep it small enough to review.
5. **Check it:**
   ```bash
   npm run typecheck
   npx vite build
   ```
   Then try it in the browser the way a student would, in light and dark mode.
6. **Update the docs** if students will notice the change: a line in `README.md`/`README.en.md` if it's a headline feature, and its section in `docs/GUIDE.md`. If you add a server module or change how something works inside, add a line to `CLAUDE.md`, which describes the codebase.
7. **Open a pull request** against `akamoe/research-platform` `main`. Say what it does for students, how you tested it, and add a screenshot or short clip for any UI change. Moe reviews and merges.

## Code

- TypeScript everywhere. The server (`server/`) is Hono run by `tsx`, with no build step. The app (`src/`) is Vite, React and Tailwind v4. See `CLAUDE.md` for where each feature lives.
- Model calls go through `server/llm.ts` with plain `fetch`; background AI calls through `server/ai.ts`. Don't add provider SDKs.
- Write through the helpers in `server/paths.ts` (`safeJoin`, atomic writes) so paths can't escape the data folder and files are never half-written.
- Short, plain comments that say why, not what.
- New dependencies should be permissively licensed (MIT, Apache-2.0, BSD, ISC) and earn their size.
- Tests or scripts that need the internet should use the `RP_*_URL` overrides and a local mock, like the existing ones.
- Using an AI coding assistant is fine; you are still responsible for testing what it wrote.

## Folio for Mac

The Mac app is in `src-tauri/` (Tauri 2, Rust). It runs the same server with a Node.js it carries, so app changes are mostly in `server/` and `src/` as usual.

- **Try it**: install Rust (`rustup`), then `npm run desktop:dev`. That builds `src-tauri/resources/app/` and the bundled Node with `scripts/desktop/prepare.mjs`, then opens the app. If your own Folio already uses port 5174, the app shows that one; set `FOLIO_FIRST_PORT=5274` (debug builds only) to have it start its own.
- **Tests**: `npm run test:desktop` (server and build script) and `cargo test --manifest-path src-tauri/Cargo.toml`.
- **New server packages** are picked up automatically: `prepare.mjs` bundles exactly what `server/*.ts` imports, and fails if one is missing from `package.json`.

### Releasing the Mac app

1. Raise `version` in `src-tauri/tauri.conf.json` (and `src-tauri/Cargo.toml`).
2. Merge to `main`, then push a tag `desktop-v<version>` (for example `desktop-v0.1.1`).
3. The **Folio for Mac release** workflow builds the app and makes a **draft** release with the `.dmg` and the updater files (`Folio.app.tar.gz`, `.sig`, `latest.json`).
4. Download the `.dmg` from the draft and try it. Then press **Publish**: from that moment every installed Folio for Mac offers the update.

The workflow needs the repository secrets `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` (the updater key; Moe keeps it). Don't lose that key: without it, installed copies can't verify updates and people would have to download the app again. Building locally with `npm run desktop:build` needs the same two variables.

## What gets merged

Likely: bug fixes; features that help students read, organize, cite, plan or check their own writing; better support for Arabic and other languages; speed and accessibility; clearer wording in the app.

Not merged: anything that breaks the rules above; features for a single university or course that can't be turned off; restyling the whole app; large refactors without an issue first.
