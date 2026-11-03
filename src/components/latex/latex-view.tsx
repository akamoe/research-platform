import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  AlertTriangleIcon,
  ChevronDownIcon,
  ChevronsUpDownIcon,
  CircleXIcon,
  DownloadIcon,
  FileCodeIcon,
  FilePlusIcon,
  CheckIcon,
  ImageIcon,
  LayoutTemplateIcon,
  LibraryIcon,
  LoaderCircleIcon,
  MessageSquareIcon,
  PlayIcon,
  QuoteIcon,
  ScrollTextIcon,
  SpellCheckIcon,
  Trash2Icon,
  UploadIcon,
} from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from "@/components/ui/command"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable"
import { SidebarTrigger } from "@/components/ui/sidebar"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { refLine } from "@/components/references/cite"
import { api, type LatexFile, type LatexProblem, type LatexResult, type LatexState, type LatexTemplate, type Reference } from "@/lib/api"
import { navigate } from "@/lib/router"
import { cn } from "@/lib/utils"
import { LatexEditor, usesNatbib, type EditorContext, type LatexEditorHandle } from "./latex-editor"
import { PdfPreview } from "./pdf-preview"
import { FeedbackPanel, type FeedbackTarget } from "@/components/feedback/feedback-panel"

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform)
const MOD = isMac ? "⌘" : "Ctrl+"
const IMAGE = /\.(png|jpe?g|pdf|eps)$/i

/** Write the paper in LaTeX, beside a PDF that compiles on this computer. */
export function LatexView({
  projectId,
  chatOpen,
  onToggleChat,
  onOpenFile,
}: {
  projectId: string
  chatOpen: boolean
  onToggleChat: () => void
  /** The file being edited, so the chat can read it. */
  onOpenFile?: (path: string) => void
}) {
  const [state, setState] = useState<LatexState | null>(null)
  const fileKey = `rp-latex-file:${projectId}`
  const [path, setPath] = useState(() => localStorage.getItem(fileKey) ?? "main.tex")
  const [content, setContent] = useState<string | null>(null)
  const [saving, setSaving] = useState<"idle" | "saving" | "error">("idle")
  const [compiling, setCompiling] = useState(false)
  const [result, setResult] = useState<LatexResult | null>(null)
  const [pdfVersion, setPdfVersion] = useState<number | null>(null)
  const [auto, setAuto] = useState(() => localStorage.getItem("rp-latex-auto") !== "0")
  const [showLog, setShowLog] = useState(false)
  const [creating, setCreating] = useState(false)
  const [picking, setPicking] = useState(false)
  /** Bumped when main.tex is replaced from outside the editor, so the editor reloads it. */
  const [rev, setRev] = useState(0)

  const editor = useRef<LatexEditorHandle>(null)
  const [feedback, setFeedback] = useState(false)
  const feedbackTarget = useMemo<FeedbackTarget>(
    () => ({
      mark: (quotes) => new Set(quotes.filter((q) => editor.current?.find(q))),
      reveal: (q) => {
        const at = editor.current?.find(q)
        if (at) editor.current?.select(at.from, at.to)
      },
      clear: () => {},
    }),
    [],
  )
  const context = useRef<EditorContext>({ refs: [], files: [] })
  const pending = useRef<{ path: string; text: string } | null>(null)
  const saveTimer = useRef<number | undefined>(undefined)
  const compileTimer = useRef<number | undefined>(undefined)

  const refresh = useCallback(async () => {
    const s = await api.latex(projectId)
    setState(s)
    context.current.files = s.files
    if (s.pdf) setPdfVersion((v) => v ?? s.pdf)
    api.latexFile(projectId, s.main).then((r) => (context.current.natbib = usesNatbib(r.content)), () => {})
    return s
  }, [projectId])

  const loadRefs = useCallback(
    () => api.references(projectId).then((r: Reference[]) => (context.current.refs = r), () => {}),
    [projectId],
  )

  useEffect(() => {
    refresh().catch((e) => toast.error(e.message))
    loadRefs()
  }, [refresh, loadRefs])

  // Open the chosen file (falling back to main.tex if it is gone).
  useEffect(() => {
    if (!state) return
    const f = state.files.find((x) => x.path === path && x.text)
    if (!f) return setPath(state.main)
    localStorage.setItem(fileKey, path)
    onOpenFile?.(path)
    setContent(null)
    api.latexFile(projectId, path).then((r) => setContent(r.content), (e) => toast.error(e.message))
  }, [path, !!state, projectId]) // eslint-disable-line react-hooks/exhaustive-deps

  const flush = useCallback(async () => {
    window.clearTimeout(saveTimer.current)
    const p = pending.current
    if (!p) return true
    pending.current = null
    setSaving("saving")
    try {
      await api.saveLatexFile(projectId, p.path, p.text)
      setSaving("idle")
      return true
    } catch (e) {
      setSaving("error")
      toast.error((e as Error).message)
      return false
    }
  }, [projectId])

  const compile = useCallback(async () => {
    window.clearTimeout(compileTimer.current)
    if (!(await flush())) return
    setCompiling(true)
    try {
      const r = await api.compileLatex(projectId)
      setResult(r)
      if (r.fresh) setPdfVersion(Date.now())
      void loadRefs()
    } catch (e) {
      const msg = (e as Error).message
      if (/isn't installed/.test(msg)) await refresh()
      else toast.error(msg)
    } finally {
      setCompiling(false)
    }
  }, [flush, projectId, refresh, loadRefs])

  const onChange = (text: string) => {
    pending.current = { path, text }
    if (path === state?.main) context.current.natbib = usesNatbib(text)
    window.clearTimeout(saveTimer.current)
    window.clearTimeout(compileTimer.current)
    saveTimer.current = window.setTimeout(() => {
      void flush().then((ok) => {
        if (ok && auto && state?.engine) compileTimer.current = window.setTimeout(compile, 900)
      })
    }, 600)
  }

  // Save before leaving the page or switching files.
  useEffect(() => {
    const on = () => void flush()
    window.addEventListener("beforeunload", on)
    return () => {
      window.removeEventListener("beforeunload", on)
      void flush()
    }
  }, [flush])

  // First visit with LaTeX available: make the PDF.
  const compiledOnce = useRef(false)
  useEffect(() => {
    if (state?.engine && !compiledOnce.current) {
      compiledOnce.current = true
      void compile()
    }
  }, [state?.engine, compile])

  // While Tectonic downloads, check on it.
  useEffect(() => {
    if (!state?.install?.running) return
    const t = window.setInterval(() => void refresh(), 800)
    return () => window.clearInterval(t)
  }, [state?.install?.running, refresh])

  const open = async (p: string) => {
    if (p === path) return
    await flush()
    setPath(p)
  }

  const problems = result?.problems ?? []
  const mine = problems.filter((p) => (p.file ?? state?.main) === path)
  const errors = problems.filter((p) => p.severity === "error").length
  const warnings = problems.length - errors
  const file = state?.files.find((f) => f.path === path)

  const goto = async (p: LatexProblem) => {
    const target = p.file ?? state?.main ?? "main.tex"
    if (target !== path && state?.files.some((f) => f.path === target)) {
      await open(target)
      // The editor remounts with the new file; jump once it has.
      window.setTimeout(() => p.line && editor.current?.goto(p.line), 250)
    } else if (p.line) editor.current?.goto(p.line)
  }

  const upload = async (files: FileList | null) => {
    if (!files?.length) return
    try {
      let list: LatexFile[] = state?.files ?? []
      for (const f of Array.from(files)) list = await api.uploadLatexFile(projectId, f, IMAGE.test(f.name) ? "figures" : "")
      setState((s) => (s ? { ...s, files: list } : s))
      context.current.files = list
      toast.success(files.length === 1 ? `Added ${files[0].name}` : `Added ${files.length} files`)
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  const remove = async (f: LatexFile) => {
    try {
      const list = await api.deleteLatexFile(projectId, f.path)
      setState((s) => (s ? { ...s, files: list } : s))
      context.current.files = list
      if (f.path === path) setPath(state?.main ?? "main.tex")
      toast(`Moved ${f.path} to the trash`)
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  const status = compiling
    ? "Compiling…"
    : saving === "saving"
      ? "Saving…"
      : saving === "error"
        ? "Not saved"
        : result
          ? errors
            ? `${errors} ${errors === 1 ? "error" : "errors"}`
            : `Compiled in ${(result.ms / 1000).toFixed(1)} s`
          : ""

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      <div className="flex h-12 shrink-0 items-center gap-1.5 border-b px-3">
        <SidebarTrigger className="text-muted-foreground" />
        <FilesMenu
          files={state?.files ?? []}
          current={path}
          onOpen={open}
          onInsertImage={(p) => editor.current?.insert(`\\includegraphics[width=\\linewidth]{${p}}`)}
          onRemove={remove}
          onNew={() => setCreating(true)}
          onUpload={upload}
        />
        <CiteMenu projectId={projectId} onPick={(key) => editor.current?.insert(`\\${context.current.natbib === false ? "cite" : "citep"}{${key}}`)} />
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="sm" className="h-8 gap-1.5 px-2 font-normal text-muted-foreground" onClick={() => setPicking(true)}>
              <LayoutTemplateIcon /> Template
            </Button>
          </TooltipTrigger>
          <TooltipContent>Start from a journal template</TooltipContent>
        </Tooltip>
        <div className="ml-auto flex items-center gap-1">
          <span className={cn("mr-1 text-xs text-muted-foreground", (errors > 0 || saving === "error") && !compiling && "text-destructive")}>
            {status}
          </span>
          <div className="flex items-center">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button size="sm" className="h-8 rounded-r-none" onClick={compile} disabled={compiling || !state?.engine}>
                  {compiling ? <LoaderCircleIcon className="animate-spin" /> : <PlayIcon />} Compile
                </Button>
              </TooltipTrigger>
              <TooltipContent>Compile ({MOD}S)</TooltipContent>
            </Tooltip>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" className="h-8 w-7 rounded-l-none border-l border-primary-foreground/20 px-0" aria-label="Compile options">
                  <ChevronDownIcon />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuCheckboxItem
                  checked={auto}
                  onCheckedChange={(v) => {
                    setAuto(!!v)
                    localStorage.setItem("rp-latex-auto", v ? "1" : "0")
                  }}
                >
                  Compile as I type
                </DropdownMenuCheckboxItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem disabled={!state?.pdf && !pdfVersion} asChild>
                  <a href={api.latexPdfUrl(projectId, pdfVersion, true)} download>
                    <DownloadIcon /> Download PDF
                  </a>
                </DropdownMenuItem>
                <DropdownMenuItem disabled={!result} onSelect={() => setShowLog(true)}>
                  <ScrollTextIcon /> Show the log
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className={cn("size-8 text-muted-foreground", feedback && "bg-muted text-foreground")}
                onClick={() => setFeedback((f) => !f)}
                disabled={!path.endsWith(".tex")}
                aria-label="Writing feedback"
              >
                <SpellCheckIcon className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Writing feedback on this file</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className={cn("size-8 text-muted-foreground", chatOpen && "bg-muted text-foreground")}
                onClick={onToggleChat}
                aria-label="Chat"
              >
                <MessageSquareIcon className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Chat (Ctrl/⌘ J)</TooltipContent>
          </Tooltip>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        <ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1">
          <ResizablePanel defaultSize="50%" minSize="25%">
            <div className="flex h-full min-h-0 flex-col">
              {file?.library && (
                <div className="flex shrink-0 items-center gap-2 border-b bg-muted/40 px-4 py-1.5 text-xs text-muted-foreground">
                  <LibraryIcon className="size-3.5" />
                  This file is made from your References each time you compile.
                  <button className="underline underline-offset-2 hover:text-foreground" onClick={() => navigate({ name: "project", projectId, view: "references" })}>
                    Edit them there
                  </button>
                </div>
              )}
              <div className="min-h-0 flex-1">
                {content !== null && (
                  <LatexEditor
                    ref={editor}
                    docKey={`${projectId}/${path}/${rev}`}
                    initial={content}
                    readOnly={file?.library}
                    problems={mine}
                    context={context}
                    onChange={onChange}
                    onRun={compile}
                  />
                )}
              </div>
              {problems.length > 0 && <Problems problems={problems} errors={errors} warnings={warnings} onPick={goto} />}
            </div>
          </ResizablePanel>
          <ResizableHandle />
          <ResizablePanel defaultSize="50%" minSize="20%">
            <Preview
              projectId={projectId}
              state={state}
              compiling={compiling}
              version={pdfVersion}
              failed={!!result && !result.pdf}
              onInstall={async () => {
                try {
                  setState(await api.installLatex(projectId).then(async () => refresh()))
                } catch (e) {
                  toast.error((e as Error).message)
                }
              }}
            />
          </ResizablePanel>
        </ResizablePanelGroup>
        {feedback && path.endsWith(".tex") && (
          <aside className="w-80 shrink-0 border-l max-md:absolute max-md:inset-y-0 max-md:right-0 max-md:z-20 max-md:bg-background max-md:shadow-xl">
            <FeedbackPanel
              projectId={projectId}
              file={{ latexPath: path }}
              target={feedbackTarget}
              beforeCheck={flush}
              onClose={() => setFeedback(false)}
            />
          </aside>
        )}
      </div>

      <Dialog open={showLog} onOpenChange={setShowLog}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Compile log</DialogTitle>
            <DialogDescription>
              What {result?.engine ?? "LaTeX"} printed the last time it ran{result?.ok === false ? ". It stopped with errors." : "."}
            </DialogDescription>
          </DialogHeader>
          <pre className="max-h-[60vh] overflow-auto rounded-md bg-muted p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap">
            {result?.log || "Nothing was printed."}
          </pre>
        </DialogContent>
      </Dialog>

      <TemplateDialog
        open={picking}
        onOpenChange={setPicking}
        onApply={async (t) => {
          await flush()
          const r = await api.applyLatexTemplate(projectId, t.id)
          setResult(null)
          await refresh()
          const main = state?.main ?? "main.tex"
          if (path === main) {
            setContent((await api.latexFile(projectId, main)).content)
            setRev((n) => n + 1)
          } else setPath(main)
          toast.success(`main.tex now uses the ${t.name} template`, {
            description: r.kept ? `What you had is kept in ${r.kept}.` : undefined,
          })
          if (state?.engine) void compile()
        }}
      />

      <NewFileDialog
        open={creating}
        onOpenChange={setCreating}
        onCreate={async (name) => {
          const list = await api.createLatexFile(projectId, name, name.endsWith(".tex") ? `\\section{${name.replace(/\.tex$/, "").replace(/[-_]+/g, " ")}}\n\n` : "")
          setState((s) => (s ? { ...s, files: list } : s))
          context.current.files = list
          await open(name)
          if (name.endsWith(".tex")) toast(`Add \\input{${name.replace(/\.tex$/, "")}} to main.tex where it belongs`)
        }}
      />
    </div>
  )
}

function Preview({
  projectId,
  state,
  compiling,
  version,
  failed,
  onInstall,
}: {
  projectId: string
  state: LatexState | null
  compiling: boolean
  version: number | null
  failed: boolean
  onInstall: () => void
}) {
  if (!state) return <div className="h-full bg-muted" />
  if (!state.engine) {
    const ins = state.install
    return (
      <div className="flex h-full items-center justify-center bg-muted p-8">
        <div className="max-w-sm space-y-3 text-center">
          <p className="text-sm font-medium">Folio needs LaTeX to make the PDF</p>
          {ins?.running ? (
            <>
              <div className="h-1.5 overflow-hidden rounded-full bg-background">
                <div
                  className="h-full bg-primary transition-[width]"
                  style={{ width: ins.total ? `${Math.round((ins.done / ins.total) * 100)}%` : "8%" }}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Downloading LaTeX… {(ins.done / 1e6).toFixed(0)}
                {ins.total ? ` of ${(ins.total / 1e6).toFixed(0)}` : ""} MB
              </p>
            </>
          ) : state.installable ? (
            <>
              <p className="text-sm text-muted-foreground">
                Folio can download Tectonic, a small LaTeX engine (about 20 MB). The first compile also fetches the LaTeX packages your
                paper uses, so it needs the internet and takes a minute.
              </p>
              {ins?.error && <p className="text-xs text-destructive">The download failed: {ins.error}</p>}
              <Button size="sm" onClick={onInstall}>
                <DownloadIcon /> {ins?.error ? "Try again" : "Download LaTeX"}
              </Button>
              <p className="text-xs text-muted-foreground">Already have MacTeX, TeX Live or MiKTeX? Folio uses it as soon as it's installed.</p>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">Install TeX Live or MiKTeX, then come back here. Folio finds it by itself.</p>
          )}
        </div>
      </div>
    )
  }
  if (version)
    return (
      <div className="relative h-full">
        <PdfPreview url={`/api/projects/${projectId}/latex/pdf`} version={version} />
        {compiling && (
          <LoaderCircleIcon className="absolute top-3 right-3 size-4 animate-spin text-muted-foreground" aria-label="Compiling" />
        )}
      </div>
    )
  return (
    <div className="flex h-full items-center justify-center bg-muted p-8 text-center text-sm text-muted-foreground">
      {compiling ? (
        <div className="max-w-xs space-y-2">
          <LoaderCircleIcon className="mx-auto size-5 animate-spin" />
          <p>Compiling… The first time can take a minute while LaTeX fetches the packages your paper uses.</p>
        </div>
      ) : failed ? (
        <p className="max-w-xs">No PDF yet. Fix the errors on the left, then compile again.</p>
      ) : (
        <p className="max-w-xs">Press Compile to see your PDF here.</p>
      )}
    </div>
  )
}

function Problems({
  problems,
  errors,
  warnings,
  onPick,
}: {
  problems: LatexProblem[]
  errors: number
  warnings: number
  onPick: (p: LatexProblem) => void
}) {
  const [open, setOpen] = useState(true)
  // Errors first; warnings are often many and harmless.
  const sorted = [...problems].sort((a, b) => Number(a.severity === "warning") - Number(b.severity === "warning"))
  return (
    <div className="shrink-0 border-t">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-3 px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground"
      >
        {errors > 0 && (
          <span className="flex items-center gap-1 text-destructive">
            <CircleXIcon className="size-3.5" /> {errors} {errors === 1 ? "error" : "errors"}
          </span>
        )}
        {warnings > 0 && (
          <span className="flex items-center gap-1">
            <AlertTriangleIcon className="size-3.5 text-amber-600" /> {warnings} {warnings === 1 ? "warning" : "warnings"}
          </span>
        )}
        <ChevronDownIcon className={cn("ml-auto size-3.5 transition-transform", !open && "rotate-180")} />
      </button>
      {open && (
        <ul className="max-h-40 overflow-y-auto pb-1">
          {sorted.map((p, i) => (
            <li key={i}>
              <button
                onClick={() => onPick(p)}
                className="flex w-full items-start gap-2 px-3 py-1 text-left text-xs hover:bg-muted"
              >
                {p.severity === "error" ? (
                  <CircleXIcon className="mt-0.5 size-3.5 shrink-0 text-destructive" />
                ) : (
                  <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0 text-amber-600" />
                )}
                <span className="min-w-0 flex-1">{p.message}</span>
                {p.line && (
                  <span className="shrink-0 font-mono text-muted-foreground">
                    {p.file && p.file !== "main.tex" ? `${p.file}:` : "line "}
                    {p.line}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function FilesMenu({
  files,
  current,
  onOpen,
  onInsertImage,
  onRemove,
  onNew,
  onUpload,
}: {
  files: LatexFile[]
  current: string
  onOpen: (p: string) => void
  onInsertImage: (p: string) => void
  onRemove: (f: LatexFile) => void
  onNew: () => void
  onUpload: (files: FileList | null) => void
}) {
  const [open, setOpen] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const docs = files.filter((f) => f.text)
  const images = files.filter((f) => !f.text)
  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="sm" className="h-8 gap-1.5 px-2 font-mono text-[13px] font-normal">
            <FileCodeIcon className="text-muted-foreground" /> {current}
            <ChevronsUpDownIcon className="size-3 opacity-60" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-80 p-0">
          <Command>
            <CommandInput placeholder="Find a file" />
            <CommandList className="max-h-80">
              <CommandEmpty>No file with that name.</CommandEmpty>
              <CommandGroup heading="Files">
                {docs.map((f) => (
                  <FileRow
                    key={f.path}
                    file={f}
                    active={f.path === current}
                    icon={f.library ? LibraryIcon : FileCodeIcon}
                    onSelect={() => {
                      setOpen(false)
                      onOpen(f.path)
                    }}
                    onRemove={f.path === "main.tex" || f.library ? undefined : () => onRemove(f)}
                  />
                ))}
              </CommandGroup>
              {images.length > 0 && (
                <CommandGroup heading="Images (click to insert)">
                  {images.map((f) => (
                    <FileRow
                      key={f.path}
                      file={f}
                      icon={ImageIcon}
                      onSelect={() => {
                        setOpen(false)
                        onInsertImage(f.path)
                      }}
                      onRemove={() => onRemove(f)}
                    />
                  ))}
                </CommandGroup>
              )}
              <CommandSeparator />
              <CommandGroup>
                <CommandItem
                  value="__new"
                  onSelect={() => {
                    setOpen(false)
                    onNew()
                  }}
                >
                  <FilePlusIcon /> New file…
                </CommandItem>
                <CommandItem
                  value="__upload"
                  onSelect={() => {
                    setOpen(false)
                    input.current?.click()
                  }}
                >
                  <UploadIcon /> Upload images or files…
                </CommandItem>
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      <input
        ref={input}
        type="file"
        multiple
        hidden
        accept=".png,.jpg,.jpeg,.pdf,.eps,.tex,.bib,.sty,.cls,.bst"
        onChange={(e) => {
          onUpload(e.target.files)
          e.target.value = ""
        }}
      />
    </>
  )
}

function FileRow({
  file,
  active,
  icon: Icon,
  onSelect,
  onRemove,
}: {
  file: LatexFile
  active?: boolean
  icon: typeof FileCodeIcon
  onSelect: () => void
  onRemove?: () => void
}) {
  return (
    <CommandItem value={file.path} onSelect={onSelect} className={cn("group", active && "font-medium")}>
      <Icon className="text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate font-mono text-[13px]">{file.path}</span>
      {onRemove && (
        <button
          onClick={(e) => {
            e.stopPropagation()
            onRemove()
          }}
          onPointerDown={(e) => e.stopPropagation()}
          className="rounded p-0.5 text-muted-foreground opacity-0 group-hover:opacity-100 group-data-[selected=true]:opacity-100 hover:text-destructive"
          aria-label={`Remove ${file.path}`}
        >
          <Trash2Icon className="size-3.5" />
        </button>
      )}
    </CommandItem>
  )
}

function CiteMenu({ projectId, onPick }: { projectId: string; onPick: (key: string) => void }) {
  const [open, setOpen] = useState(false)
  const [refs, setRefs] = useState<Reference[] | null>(null)
  useEffect(() => {
    if (open) api.references(projectId).then(setRefs, () => setRefs([]))
  }, [open, projectId])
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="sm" className="h-8 gap-1.5 px-2 font-normal text-muted-foreground">
              <QuoteIcon /> Cite
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>Cite a reference (or type \cite)</TooltipContent>
      </Tooltip>
      <PopoverContent align="start" className="w-96 p-0" onCloseAutoFocus={(e) => e.preventDefault()}>
        <Command key={refs ? "ready" : "loading"}>
          <CommandInput placeholder="Search your references" />
          <CommandList className="max-h-80">
            <CommandEmpty>{refs === null ? "Loading…" : refs.length ? "No match." : "No references yet."}</CommandEmpty>
            {!!refs?.length && (
              <CommandGroup>
                {refs.map((r) => (
                  <CommandItem
                    key={r.id}
                    value={`${r.id} ${r.title ?? ""} ${refLine(r)}`}
                    onSelect={() => {
                      setOpen(false)
                      onPick(r.id)
                    }}
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm">{r.title || r.id}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        <span className="font-mono">{r.id}</span> · {refLine(r)}
                      </p>
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            <CommandSeparator />
            <CommandGroup>
              <CommandItem value="__refs" onSelect={() => navigate({ name: "project", projectId, view: "references" })}>
                <LibraryIcon /> Add references…
              </CommandItem>
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

/** Journal templates, grouped by field. Picking one rewrites main.tex; the old text is kept beside it. */
function TemplateDialog({
  open,
  onOpenChange,
  onApply,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onApply: (t: LatexTemplate) => Promise<void>
}) {
  const [list, setList] = useState<LatexTemplate[] | null>(null)
  const [chosen, setChosen] = useState<LatexTemplate | null>(null)
  /** The row under the pointer or keyboard; the preview follows it. */
  const [active, setActive] = useState("")
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (open && !list) api.latexTemplates().then(setList, (e) => toast.error(e.message))
    if (!open) setChosen(null)
  }, [open, list])
  const fields = [...new Set((list ?? []).map((t) => t.field))]
  const shown = list?.find((t) => t.id === active.split(" ")[0]) ?? chosen ?? list?.[0]
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 p-0 sm:max-w-3xl">
        <DialogHeader className="p-4 pb-3">
          <DialogTitle>Journal templates</DialogTitle>
          <DialogDescription>
            Each one sets up main.tex the way the journal asks for. Your current main.tex is kept as a separate file.
          </DialogDescription>
        </DialogHeader>
        <div className="flex min-h-0 border-t">
        <Command className="min-w-0 flex-1 rounded-none" value={active} onValueChange={setActive}>
          <CommandInput placeholder="Search journals, publishers or fields" />
          <CommandList className="h-[55vh] max-h-none">
            <CommandEmpty>{list ? "No template matches. You can upload a journal's own .cls file from the Files menu." : "Loading…"}</CommandEmpty>
            {fields.map((field) => (
              <CommandGroup key={field} heading={field}>
                {list!
                  .filter((t) => t.field === field)
                  .map((t) => (
                    <CommandItem
                      key={t.id}
                      value={`${t.id} ${t.name} ${t.publisher} ${t.examples} ${t.cls} ${t.field}`}
                      onSelect={() => setChosen(t)}
                      onDoubleClick={() => void apply(t)}
                      className="items-start"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-sm">{t.name}</p>
                        <p className="line-clamp-2 text-xs text-muted-foreground">
                          {t.publisher === "Folio" ? t.examples : `${t.publisher} · ${t.examples}`}
                        </p>
                      </div>
                      <CheckIcon className={cn("mt-0.5 size-4", chosen?.id !== t.id && "invisible")} />
                    </CommandItem>
                  ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
          {shown && (
            <div className="hidden w-64 shrink-0 flex-col gap-2 border-l bg-muted/40 p-4 sm:flex">
              <img
                key={shown.id}
                src={`/latex-templates/${shown.id}.png`}
                alt={`First page of a paper in the ${shown.name} template`}
                className="w-full rounded-sm border bg-white shadow-sm"
              />
              <p className="text-xs text-muted-foreground">First page, with sample text.</p>
            </div>
          )}
        </div>
        <DialogFooter className="items-center border-t p-3 sm:justify-between">
          <p className="text-xs text-muted-foreground">
            {chosen ? <>Uses the <span className="font-mono">{chosen.cls}</span> class, included with LaTeX.</> : "Journal not here? Upload its .cls file from the Files menu."}
          </p>
          <Button size="sm" disabled={!chosen || busy} onClick={() => chosen && void apply(chosen)}>
            {busy && <LoaderCircleIcon className="animate-spin" />} Use template
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )

  async function apply(t: LatexTemplate) {
    setBusy(true)
    try {
      await onApply(t)
      onOpenChange(false)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
}

function NewFileDialog({
  open,
  onOpenChange,
  onCreate,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  onCreate: (name: string) => Promise<void>
}) {
  const [name, setName] = useState("")
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (open) setName("")
  }, [open])
  const clean = (() => {
    const n = name.trim().replace(/\s+/g, "-")
    return !n ? "" : /\.\w+$/.test(n) ? n : `${n}.tex`
  })()
  const submit = async () => {
    if (!clean || busy) return
    setBusy(true)
    try {
      await onCreate(clean)
      onOpenChange(false)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>New file</DialogTitle>
          <DialogDescription>A chapter or section in its own .tex file, or a .bib or .sty file.</DialogDescription>
        </DialogHeader>
        <Input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder="methods.tex"
          className="font-mono"
          aria-label="File name"
        />
        <DialogFooter>
          <Button onClick={submit} disabled={!clean || busy}>
            Create {clean && <span className="font-mono">{clean}</span>}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
