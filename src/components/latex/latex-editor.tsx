import { forwardRef, useEffect, useImperativeHandle, useRef } from "react"
import { EditorState, type Extension } from "@codemirror/state"
import {
  EditorView,
  drawSelection,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
  placeholder,
} from "@codemirror/view"
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands"
import { HighlightStyle, StreamLanguage, bracketMatching, indentOnInput, syntaxHighlighting } from "@codemirror/language"
import { stex } from "@codemirror/legacy-modes/mode/stex"
import {
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap,
  snippetCompletion,
  startCompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
} from "@codemirror/autocomplete"
import { highlightSelectionMatches, searchKeymap } from "@codemirror/search"
import { setDiagnostics, type Diagnostic } from "@codemirror/lint"
import { tags as t } from "@lezer/highlight"
import type { LatexFile, LatexProblem, Reference } from "@/lib/api"
import { refLine } from "@/components/references/cite"

/** What the editor needs to know about the project, read at completion time. */
export interface EditorContext {
  refs: Reference[]
  files: LatexFile[]
}

export interface LatexEditorHandle {
  goto: (line: number) => void
  insert: (text: string) => void
  focus: () => void
}

interface Props {
  /** Changing it starts a fresh editor (another file). */
  docKey: string
  initial: string
  readOnly?: boolean
  problems: LatexProblem[]
  context: React.RefObject<EditorContext>
  onChange: (text: string) => void
  onRun: () => void
}

const theme = EditorView.theme({
  "&": { height: "100%", fontSize: "13.5px", backgroundColor: "var(--background)", color: "var(--foreground)" },
  ".cm-scroller": { fontFamily: "var(--font-mono)", lineHeight: "1.65" },
  ".cm-content": { padding: "16px 0 40vh", caretColor: "var(--foreground)" },
  ".cm-line": { padding: "0 20px 0 12px" },
  ".cm-gutters": {
    backgroundColor: "var(--background)",
    color: "color-mix(in oklab, var(--muted-foreground) 70%, transparent)",
    border: "none",
  },
  ".cm-lineNumbers .cm-gutterElement": { padding: "0 4px 0 14px", fontSize: "12px" },
  ".cm-activeLine": { backgroundColor: "color-mix(in oklab, var(--muted) 55%, transparent)" },
  ".cm-activeLineGutter": { backgroundColor: "transparent", color: "var(--foreground)" },
  "&.cm-focused": { outline: "none" },
  ".cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection": {
    backgroundColor: "color-mix(in oklab, var(--primary) 22%, transparent) !important",
  },
  ".cm-cursor": { borderLeftColor: "var(--foreground)" },
  ".cm-tooltip": {
    backgroundColor: "var(--popover)",
    color: "var(--popover-foreground)",
    border: "1px solid var(--border)",
    borderRadius: "8px",
    boxShadow: "0 6px 24px -8px rgb(0 0 0 / 0.2)",
    overflow: "hidden",
  },
  ".cm-tooltip-autocomplete > ul": { fontFamily: "var(--font-sans)", fontSize: "13px", maxHeight: "18em" },
  ".cm-tooltip-autocomplete > ul > li": { padding: "3px 10px !important" },
  ".cm-tooltip-autocomplete ul li[aria-selected]": { backgroundColor: "var(--accent)", color: "var(--accent-foreground)" },
  ".cm-completionDetail": { marginLeft: "10px", fontStyle: "normal", color: "var(--muted-foreground)" },
  ".cm-completionInfo": { padding: "6px 10px", maxWidth: "320px", fontFamily: "var(--font-sans)", fontSize: "12px" },
  ".cm-completionIcon": { display: "none" },
  ".cm-panels": { backgroundColor: "var(--background)", color: "var(--foreground)", borderColor: "var(--border)" },
  ".cm-panel.cm-search": { fontFamily: "var(--font-sans)", fontSize: "12px", padding: "6px 8px" },
  ".cm-panel.cm-search input, .cm-panel.cm-search button": {
    borderRadius: "6px",
    border: "1px solid var(--border)",
    backgroundColor: "var(--background)",
    color: "var(--foreground)",
    backgroundImage: "none",
  },
  ".cm-searchMatch": { backgroundColor: "color-mix(in oklab, #facc15 40%, transparent)" },
  ".cm-selectionMatch": { backgroundColor: "color-mix(in oklab, var(--muted) 90%, transparent)" },
  ".cm-matchingBracket": { backgroundColor: "color-mix(in oklab, var(--primary) 18%, transparent)", outline: "none" },
  ".cm-lintRange-error": { backgroundImage: "none", textDecoration: "underline wavy var(--destructive)", textUnderlineOffset: "3px" },
  ".cm-lintRange-warning": { backgroundImage: "none", textDecoration: "underline wavy #d97706", textUnderlineOffset: "3px" },
  ".cm-diagnostic": { fontFamily: "var(--font-sans)", fontSize: "12px", padding: "4px 8px" },
  ".cm-placeholder": { color: "var(--muted-foreground)" },
})

const highlight = HighlightStyle.define([
  { tag: [t.tagName, t.keyword], color: "var(--primary)" },
  { tag: [t.atom, t.typeName, t.special(t.variableName)], color: "color-mix(in oklab, var(--primary) 70%, var(--foreground))" },
  { tag: [t.bracket], color: "var(--muted-foreground)" },
  { tag: t.comment, color: "var(--muted-foreground)", fontStyle: "italic" },
  { tag: [t.number, t.string], color: "color-mix(in oklab, #0d9488 80%, var(--foreground))" },
  { tag: t.invalid, color: "var(--destructive)" },
])

const ENVS = ["itemize", "enumerate", "figure", "table", "tabular", "equation", "align", "abstract", "quote", "description", "center"]
const COMMANDS: [string, string][] = [
  ["\\section{${}}", "section"],
  ["\\subsection{${}}", "subsection"],
  ["\\subsubsection{${}}", "subsubsection"],
  ["\\paragraph{${}}", "paragraph"],
  ["\\textbf{${}}", "bold"],
  ["\\emph{${}}", "emphasis"],
  ["\\textit{${}}", "italic"],
  ["\\footnote{${}}", "footnote"],
  ["\\label{${}}", "label"],
  ["\\ref{${}}", "reference"],
  ["\\item ${}", "list item"],
  ["\\includegraphics[width=\\linewidth]{${}}", "image"],
  ["\\caption{${}}", "caption"],
  ["\\input{${}}", "another file"],
  ["\\url{${}}", "link"],
  ["\\href{${url}}{${text}}", "link with text"],
  ["\\usepackage{${}}", "package"],
]
const CITES = ["citep", "citet", "cite", "citeauthor", "citeyear", "nocite"]

/** Opens the list again right after a command that takes a key, like \citep{ }. */
function reopen(view: EditorView) {
  setTimeout(() => startCompletion(view), 0)
}

function completions(context: React.RefObject<EditorContext>) {
  return (cx: CompletionContext): CompletionResult | null => {
    const line = cx.state.doc.lineAt(cx.pos)
    const before = line.text.slice(0, cx.pos - line.from)

    // Inside \cite{...}: the keys from References.
    const cite = /\\(?:[a-zA-Z]*cite[a-zA-Z]*|nocite)\*?(?:\[[^\]]*\]){0,2}\{([^}]*)$/.exec(before)
    if (cite) {
      const word = cite[1].split(",").pop()!.trimStart()
      const refs = context.current?.refs ?? []
      return {
        from: cx.pos - word.length,
        validFor: /^[\w:.-]*$/,
        options: refs.map((r) => ({
          label: r.id,
          detail: refLine(r),
          info: r.title ?? undefined,
          type: "variable",
        })),
      }
    }
    // Inside \ref{...}: labels in this file.
    const ref = /\\(?:eq|auto|page|c|C)?ref\{([^}]*)$/.exec(before)
    if (ref) {
      const labels = [...new Set([...cx.state.doc.toString().matchAll(/\\label\{([^}]+)\}/g)].map((m) => m[1]))]
      return { from: cx.pos - ref[1].length, validFor: /^[^}]*$/, options: labels.map((l) => ({ label: l, type: "variable" })) }
    }
    // Images and other files.
    const file = /\\(includegraphics|input|include)(?:\[[^\]]*\])?\{([^}]*)$/.exec(before)
    if (file) {
      const files = context.current?.files ?? []
      const images = file[1] === "includegraphics"
      const options = files
        .filter((f) => (images ? /\.(png|jpe?g|pdf|eps)$/i.test(f.path) : /\.tex$/i.test(f.path) && f.path !== "main.tex"))
        .map((f) => ({ label: images ? f.path : f.path.replace(/\.tex$/, ""), type: "text" }))
      return { from: cx.pos - file[2].length, validFor: /^[^}]*$/, options }
    }
    // Commands.
    const cmd = cx.matchBefore(/\\[a-zA-Z]*/)
    if (cmd && (cmd.from < cmd.to || cx.explicit)) {
      const options: Completion[] = [
        ...CITES.map((c) => ({
          label: `\\${c}`,
          detail: c === "citep" ? "(Author, Year)" : c === "citet" ? "Author (Year)" : "cite",
          type: "keyword",
          boost: c === "citep" || c === "citet" ? 2 : 0,
          apply: (view: EditorView, _c: Completion, from: number, to: number) => {
            view.dispatch({ changes: { from, to, insert: `\\${c}{}` }, selection: { anchor: from + c.length + 2 } })
            reopen(view)
          },
        })),
        ...COMMANDS.map(([snippet, detail]) => snippetCompletion(snippet, { label: snippet.replace(/[\s{[].*$/, ""), detail, type: "keyword" })),
        ...ENVS.map((env) =>
          snippetCompletion(`\\begin{${env}}\n\t${env === "itemize" || env === "enumerate" ? "\\item " : ""}\${}\n\\end{${env}}`, {
            label: `\\begin{${env}}`,
            detail: "environment",
            type: "keyword",
          }),
        ),
      ]
      return { from: cmd.from, validFor: /^\\[a-zA-Z{]*$/, options }
    }
    return null
  }
}

function diagnostics(view: EditorView, problems: LatexProblem[]): Diagnostic[] {
  const doc = view.state.doc
  return problems
    .filter((p) => p.line && p.line <= doc.lines)
    .map((p) => {
      const line = doc.line(p.line!)
      // Underline the text on the line, not its indentation.
      const start = line.from + (line.text.length - line.text.trimStart().length)
      return { from: start, to: Math.max(start, line.to), severity: p.severity, message: p.message }
    })
}

export const LatexEditor = forwardRef<LatexEditorHandle, Props>(function LatexEditor(
  { docKey, initial, readOnly, problems, context, onChange, onRun },
  ref,
) {
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  // Callbacks change every render; the editor reads the latest ones.
  const latest = useRef({ onChange, onRun })
  latest.current = { onChange, onRun }

  useEffect(() => {
    const extensions: Extension[] = [
      lineNumbers(),
      highlightActiveLineGutter(),
      history(),
      drawSelection(),
      indentOnInput(),
      bracketMatching(),
      closeBrackets(),
      highlightActiveLine(),
      highlightSelectionMatches(),
      StreamLanguage.define(stex),
      // Prose: only brackets pair up, never quotes or apostrophes.
      EditorState.languageData.of(() => [{ closeBrackets: { brackets: ["(", "[", "{"] } }]),
      syntaxHighlighting(highlight),
      autocompletion({ override: [completions(context)], icons: false, activateOnTyping: true }),
      EditorView.lineWrapping,
      EditorView.perLineTextDirection.of(true),
      EditorView.contentAttributes.of({ spellcheck: "true", autocapitalize: "sentences" }),
      placeholder("Start writing…"),
      keymap.of([
        { key: "Mod-s", preventDefault: true, run: () => (latest.current.onRun(), true) },
        { key: "Mod-Enter", preventDefault: true, run: () => (latest.current.onRun(), true) },
        ...closeBracketsKeymap,
        ...defaultKeymap,
        ...searchKeymap,
        ...historyKeymap,
        ...completionKeymap,
        indentWithTab,
      ]),
      EditorState.readOnly.of(!!readOnly),
      EditorView.updateListener.of((u) => {
        if (u.docChanged) latest.current.onChange(u.state.doc.toString())
      }),
      theme,
    ]
    const v = new EditorView({ state: EditorState.create({ doc: initial, extensions }), parent: host.current! })
    view.current = v
    return () => {
      v.destroy()
      view.current = null
    }
    // A new file (docKey) gets a fresh editor and undo history; `initial` only matters then.
  }, [docKey]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const v = view.current
    if (v) v.dispatch(setDiagnostics(v.state, diagnostics(v, problems)))
  }, [problems, docKey])

  useImperativeHandle(ref, () => ({
    goto(lineNo) {
      const v = view.current
      if (!v) return
      const line = v.state.doc.line(Math.min(Math.max(1, lineNo), v.state.doc.lines))
      v.dispatch({ selection: { anchor: line.from }, effects: EditorView.scrollIntoView(line.from, { y: "center" }) })
      v.focus()
    },
    insert(text) {
      const v = view.current
      if (!v) return
      const { from, to } = v.state.selection.main
      v.dispatch({ changes: { from, to, insert: text }, selection: { anchor: from + text.length }, scrollIntoView: true })
      v.focus()
    },
    focus: () => view.current?.focus(),
  }))

  return <div ref={host} className="h-full min-h-0 overflow-hidden [&_.cm-editor]:h-full" />
})
