import { useEffect, useMemo, useRef, useState } from "react"
import { Bar, BarChart, CartesianGrid, Line, LineChart, Scatter, ScatterChart, XAxis, YAxis } from "recharts"
import {
  ChevronDownIcon,
  ClipboardPasteIcon,
  DownloadIcon,
  FileTextIcon,
  MessageSquareIcon,
  MoreHorizontalIcon,
  PlusIcon,
  SigmaIcon,
  TableIcon,
  UploadIcon,
} from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { SidebarTrigger } from "@/components/ui/sidebar"
import { Textarea } from "@/components/ui/textarea"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { api, type Dataset, type FigureKind, type FigureSpec, type NoteFile } from "@/lib/api"
import { navigate } from "@/lib/router"
import { cn } from "@/lib/utils"
import { PALETTE, grouped, isNumeric, parse, points, tableRows, type Table } from "./data"

const KINDS: { id: FigureKind; label: string }[] = [
  { id: "bar", label: "Bar" },
  { id: "line", label: "Line" },
  { id: "scatter", label: "Scatter" },
  { id: "table", label: "Table" },
  { id: "summary", label: "Summary" },
]
const W = 720
const H = 420
const FONT = "Helvetica, Arial, sans-serif"
const isPicture = (k: FigureKind) => k !== "table" && k !== "summary"

interface Props {
  projectId: string
  notes: NoteFile[]
  chatOpen: boolean
  onToggleChat: () => void
}

export function FiguresView({ projectId, notes, chatOpen, onToggleChat }: Props) {
  const [datasets, setDatasets] = useState<Dataset[]>([])
  const [figs, setFigs] = useState<FigureSpec[] | null>(null)
  const [current, setCurrent] = useState<string | null>(null)
  const [pasting, setPasting] = useState(false)
  const upload = useRef<HTMLInputElement>(null)

  useEffect(() => {
    api.datasets(projectId).then(setDatasets, () => {})
    api.figures(projectId).then((f) => {
      setFigs(f)
      setCurrent((c) => c ?? f[0]?.id ?? null)
    }, (e) => toast.error(e.message))
  }, [projectId])

  const newFigure = async (dataset: string) => {
    let t: Table | null = null
    try {
      t = parse((await api.dataset(projectId, dataset)).text)
    } catch {}
    const nums = t ? t.fields.filter((c) => isNumeric(t!, c)) : []
    const cats = t ? t.fields.filter((c) => !nums.includes(c)) : []
    const fig: FigureSpec = {
      id: Math.random().toString(16).slice(2, 12),
      title: dataset.replace(/\.(csv|tsv|txt)$/i, ""),
      caption: "",
      dataset,
      kind: cats.length && nums.length ? "bar" : "table",
      x: cats[0] ?? "",
      y: nums.slice(0, 1),
      agg: "mean",
      xLabel: "",
      yLabel: "",
    }
    const saved = await api.saveFigure(projectId, fig)
    setFigs((f) => [...(f ?? []), saved])
    setCurrent(saved.id)
  }

  const added = async (name: string) => {
    setDatasets(await api.datasets(projectId))
    await newFigure(name)
    toast.success(`${name} added`)
  }

  const fig = figs?.find((f) => f.id === current) ?? null

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      <div className="flex h-12 shrink-0 items-center gap-2 px-3">
        <SidebarTrigger className="text-muted-foreground" />
        <span className="text-sm font-medium">Figures and tables</span>
        <div className="ml-auto flex items-center gap-1">
          <input
            ref={upload}
            type="file"
            accept=".csv,.tsv,.txt,text/csv"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              e.target.value = ""
              if (f) api.uploadDataset(projectId, f).then((r) => added(r.name), (err) => toast.error(err.message))
            }}
          />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-8">
                <PlusIcon /> Add data
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => upload.current?.click()}>
                <UploadIcon /> Upload a CSV file
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setPasting(true)}>
                <ClipboardPasteIcon /> Paste from a spreadsheet
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
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
            <TooltipContent>Chat</TooltipContent>
          </Tooltip>
        </div>
      </div>

      {figs && !figs.length && !datasets.length ? (
        <div className="flex flex-1 items-center justify-center p-6">
          <div className="max-w-md rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
            Make charts and tables from your own data for your paper. Add a CSV file (in Excel: File → Save As → CSV) or paste cells from a spreadsheet, then pick a
            chart. Put it in a note or your LaTeX file in one click.
          </div>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1">
          <aside className="w-56 shrink-0 overflow-y-auto border-r px-2 py-2">
            <div className="px-2 pb-1 text-xs font-medium text-muted-foreground">Figures</div>
            <ul className="space-y-0.5">
              {figs?.map((f) => (
                <li key={f.id}>
                  <button
                    type="button"
                    onClick={() => setCurrent(f.id)}
                    className={cn("flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted", f.id === current && "bg-muted")}
                  >
                    {f.kind === "table" ? <TableIcon className="size-4 shrink-0 text-muted-foreground" /> : f.kind === "summary" ? <SigmaIcon className="size-4 shrink-0 text-muted-foreground" /> : <BarIcon />}
                    <span className="truncate">{f.title || "Untitled"}</span>
                  </button>
                </li>
              ))}
            </ul>
            <div className="mt-4 px-2 pb-1 text-xs font-medium text-muted-foreground">Data</div>
            <ul className="space-y-0.5">
              {datasets.map((d) => (
                <li key={d.name} className="group flex items-center gap-1 rounded-md px-2 py-1 text-sm hover:bg-muted">
                  <FileTextIcon className="size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate" title={d.name}>
                    {d.name}
                  </span>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="size-6 opacity-0 group-hover:opacity-100 data-[state=open]:opacity-100" aria-label={`${d.name} options`}>
                        <MoreHorizontalIcon />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start">
                      <DropdownMenuItem onSelect={() => newFigure(d.name)}>
                        <PlusIcon /> New figure from this
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        variant="destructive"
                        onSelect={() =>
                          api.removeDataset(projectId, d.name).then(() => setDatasets((ds) => ds.filter((x) => x.name !== d.name)), (e) => toast.error(e.message))
                        }
                      >
                        Remove
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </li>
              ))}
            </ul>
          </aside>
          {fig ? (
            <Editor
              key={fig.id}
              projectId={projectId}
              fig={fig}
              datasets={datasets}
              notes={notes}
              onSaved={(f) => setFigs((fs) => fs?.map((x) => (x.id === f.id ? f : x)) ?? fs)}
              onRemoved={() => {
                setFigs((fs) => fs?.filter((x) => x.id !== fig.id) ?? fs)
                setCurrent(null)
              }}
            />
          ) : (
            <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
              {datasets.length ? "Pick a data file's “…” menu to make a figure." : null}
            </div>
          )}
        </div>
      )}

      <PasteDialog open={pasting} onOpenChange={setPasting} projectId={projectId} onAdded={added} />
    </div>
  )
}

const BarIcon = () => (
  <svg viewBox="0 0 16 16" className="size-4 shrink-0 text-muted-foreground" fill="currentColor" aria-hidden>
    <rect x="2" y="8" width="3" height="6" rx="0.5" />
    <rect x="6.5" y="4" width="3" height="10" rx="0.5" />
    <rect x="11" y="6" width="3" height="8" rx="0.5" />
  </svg>
)

function Editor({
  projectId,
  fig: initial,
  datasets,
  notes,
  onSaved,
  onRemoved,
}: {
  projectId: string
  fig: FigureSpec
  datasets: Dataset[]
  notes: NoteFile[]
  onSaved: (f: FigureSpec) => void
  onRemoved: () => void
}) {
  const [fig, setFig] = useState(initial)
  const [table, setTable] = useState<Table | null>(null)
  const [dirty, setDirty] = useState(false)
  const chart = useRef<HTMLDivElement>(null)
  const savedRef = useRef(initial)

  useEffect(() => {
    if (!fig.dataset) return setTable(null)
    api.dataset(projectId, fig.dataset).then((r) => setTable(parse(r.text)), (e) => toast.error(e.message))
  }, [projectId, fig.dataset])

  const change = (p: Partial<FigureSpec>) => {
    setFig((f) => ({ ...f, ...p }))
    setDirty(true)
  }

  const numeric = useMemo(() => new Set(table ? table.fields.filter((c) => isNumeric(table, c)) : []), [table])
  const rows = useMemo(() => (table && !isPicture(fig.kind) ? tableRows(table, fig) : null), [table, fig])
  const data = useMemo(() => (table && (fig.kind === "bar" || fig.kind === "line") && fig.x ? grouped(table, fig) : []), [table, fig])

  // Save the settings, and a picture of the chart, shortly after each change.
  const save = async (f: FigureSpec) => {
    const spec = { ...f, table: rows ?? undefined }
    const s = await api.saveFigure(projectId, spec)
    if (isPicture(f.kind) && chart.current) {
      const shot = await snapshot(chart.current, f)
      if (shot) await api.saveFigureImage(projectId, f.id, shot.png, shot.svg)
      s.hasImage = !!shot || s.hasImage
    }
    savedRef.current = s
    onSaved(s)
    return s
  }
  useEffect(() => {
    if (!dirty || !table) return
    const t = window.setTimeout(() => {
      setDirty(false)
      save(fig).catch((e) => toast.error(e.message))
    }, 700)
    return () => window.clearTimeout(t)
  }, [fig, dirty, table, rows]) // eslint-disable-line react-hooks/exhaustive-deps
  // A figure made before its picture was drawn gets one now.
  useEffect(() => {
    if (table && isPicture(fig.kind) && !initial.hasImage) {
      const t = window.setTimeout(() => save(fig).catch(() => {}), 300)
      return () => window.clearTimeout(t)
    }
  }, [table]) // eslint-disable-line react-hooks/exhaustive-deps

  // Save first, so the note or LaTeX gets what is on screen (and a table its rows).
  const ready = () => save(fig)

  const toNote = async (n: NoteFile) => {
    try {
      await ready()
      await api.figureToNote(projectId, fig.id, n.path)
      toast.success(`Added at the end of ${n.name}`, { action: { label: "Open", onClick: () => navigate({ name: "project", projectId, note: n.path }) } })
    } catch (e) {
      toast.error((e as Error).message)
    }
  }
  const toLatex = async () => {
    try {
      await ready()
      const r = await api.figureToLatex(projectId, fig.id)
      await navigator.clipboard.writeText(r.snippet)
      toast.success("LaTeX copied. Paste it where the " + (isPicture(fig.kind) ? "figure" : "table") + " goes.", {
        description: r.file ? `The picture is saved as latex/${r.file}. main.tex needs \\usepackage{graphicx}.` : undefined,
      })
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  const xs = table?.fields ?? []
  const ys = fig.kind === "table" ? xs : xs.filter((c) => numeric.has(c))
  const scatter = fig.kind === "scatter"

  return (
    <div className="min-w-0 flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-[780px] px-4 py-4">
        <div className="flex items-center gap-2">
          <Input
            value={fig.title}
            onChange={(e) => change({ title: e.target.value })}
            className="h-8 max-w-xs border-transparent px-2 font-medium shadow-none hover:border-input"
            aria-label="Name"
            placeholder="Name"
          />
          <div className="ml-auto flex items-center gap-1">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" className="h-8">
                  Add to note <ChevronDownIcon />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="max-h-80 overflow-y-auto">
                <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Goes at the end of the note</DropdownMenuLabel>
                {notes.map((n) => (
                  <DropdownMenuItem key={n.path} onSelect={() => toNote(n)}>
                    <span className="truncate">{n.name}</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <Button variant="outline" size="sm" className="h-8" onClick={toLatex}>
              Copy for LaTeX
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="size-8" aria-label="More">
                  <MoreHorizontalIcon />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {isPicture(fig.kind) ? (
                  <>
                    <DropdownMenuItem asChild>
                      <a href={api.figureUrl(projectId, fig.id, "png")} download={`${fig.title || "figure"}.png`} onClick={() => void ready()}>
                        <DownloadIcon /> Download PNG
                      </a>
                    </DropdownMenuItem>
                    <DropdownMenuItem asChild>
                      <a href={api.figureUrl(projectId, fig.id, "svg")} download={`${fig.title || "figure"}.svg`}>
                        <DownloadIcon /> Download SVG
                      </a>
                    </DropdownMenuItem>
                  </>
                ) : (
                  <DropdownMenuItem
                    onSelect={() => {
                      if (!rows) return
                      const csv = rows.map((r) => r.map((c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(",")).join("\n")
                      const a = document.createElement("a")
                      a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }))
                      a.download = `${fig.title || "table"}.csv`
                      a.click()
                    }}
                  >
                    <DownloadIcon /> Download CSV
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onSelect={() => api.removeFigure(projectId, fig.id).then(onRemoved, (e) => toast.error(e.message))}>
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Select value={fig.dataset} onValueChange={(v) => change({ dataset: v })}>
            <SelectTrigger className="h-8 w-44" aria-label="Data">
              <SelectValue placeholder="Data" />
            </SelectTrigger>
            <SelectContent>
              {datasets.map((d) => (
                <SelectItem key={d.name} value={d.name}>
                  {d.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <ToggleGroup type="single" size="sm" variant="outline" value={fig.kind} onValueChange={(v) => v && change({ kind: v as FigureKind })} aria-label="Kind">
            {KINDS.map((k) => (
              <ToggleGroupItem key={k.id} value={k.id} className="px-2.5">
                {k.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Select value={fig.x || "__none"} onValueChange={(v) => change({ x: v === "__none" ? "" : v })}>
            <SelectTrigger className="h-8 w-48" aria-label={fig.kind === "summary" ? "Group by" : fig.kind === "table" ? "First column" : "X axis"}>
              <span className="text-muted-foreground">{fig.kind === "summary" ? "Group by" : fig.kind === "table" ? "First" : "X"}</span>
              <SelectValue placeholder="none" />
            </SelectTrigger>
            <SelectContent>
              {!isPicture(fig.kind) && <SelectItem value="__none">None</SelectItem>}
              {(scatter ? xs.filter((c) => numeric.has(c)) : xs).map((c) => (
                <SelectItem key={c} value={c}>
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-8 max-w-64 font-normal" aria-label={fig.kind === "table" || fig.kind === "summary" ? "Columns" : "Y axis"}>
                <span className="text-muted-foreground">{fig.kind === "table" || fig.kind === "summary" ? "Columns" : "Y"}</span>
                <span className="truncate">{fig.y.length ? fig.y.join(", ") : fig.kind === "summary" ? "all numbers" : fig.kind === "table" ? "all" : "pick"}</span>
                <ChevronDownIcon className="opacity-50" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="max-h-80 overflow-y-auto">
              {ys
                .filter((c) => c !== fig.x)
                .map((c) => (
                  <DropdownMenuCheckboxItem
                    key={c}
                    checked={fig.y.includes(c)}
                    onSelect={(e) => e.preventDefault()}
                    onCheckedChange={(on) => change({ y: on ? [...fig.y, c] : fig.y.filter((x) => x !== c) })}
                  >
                    {c}
                  </DropdownMenuCheckboxItem>
                ))}
              {!ys.length && <DropdownMenuLabel className="font-normal text-muted-foreground">No number columns</DropdownMenuLabel>}
            </DropdownMenuContent>
          </DropdownMenu>
          {(fig.kind === "bar" || fig.kind === "line") && (
            <Select value={fig.agg} onValueChange={(v) => change({ agg: v as FigureSpec["agg"] })}>
              <SelectTrigger className="h-8 w-40" aria-label="Combine rows">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="mean">Mean of each group</SelectItem>
                <SelectItem value="sum">Sum of each group</SelectItem>
                <SelectItem value="count">Count of rows</SelectItem>
                <SelectItem value="none">First value</SelectItem>
              </SelectContent>
            </Select>
          )}
        </div>
        {isPicture(fig.kind) && (
          <div className="mt-2 grid grid-cols-2 gap-2">
            <Input value={fig.xLabel} onChange={(e) => change({ xLabel: e.target.value })} placeholder={`X axis label (${fig.x || "none"})`} className="h-8" aria-label="X axis label" />
            <Input
              value={fig.yLabel}
              onChange={(e) => change({ yLabel: e.target.value })}
              placeholder={`Y axis label${fig.y.length === 1 ? ` (${fig.y[0]})` : ""}`}
              className="h-8"
              aria-label="Y axis label"
            />
          </div>
        )}

        {/* The figure as it will look on paper: white, whatever the app's theme. */}
        <div className="mt-4 overflow-x-auto rounded-md border bg-white p-4 text-neutral-900" data-testid="figure">
          {!table ? (
            <p className="py-16 text-center text-sm text-neutral-500">{fig.dataset ? "Reading the data…" : "Pick the data to use."}</p>
          ) : isPicture(fig.kind) ? (
            !fig.x || !fig.y.length ? (
              <p className="py-16 text-center text-sm text-neutral-500">Pick the X and Y columns.</p>
            ) : (
              <div ref={chart} style={{ width: W }}>
                {fig.y.length > 1 && (
                  <div className="mb-1 flex flex-wrap justify-end gap-4 pr-4 text-xs" style={{ fontFamily: FONT }}>
                    {fig.y.map((y, i) => (
                      <span key={y} className="flex items-center gap-1.5">
                        <span className="inline-block size-2.5" style={{ background: PALETTE[i % PALETTE.length] }} />
                        {y}
                      </span>
                    ))}
                  </div>
                )}
                <Chart fig={fig} table={table} data={data} />
              </div>
            )
          ) : (
            rows && <TablePreview rows={rows} />
          )}
        </div>

        <div className="mt-3 space-y-1.5">
          <Label htmlFor="fig-caption" className="text-xs text-muted-foreground">
            Caption
          </Label>
          <Textarea
            id="fig-caption"
            value={fig.caption}
            onChange={(e) => change({ caption: e.target.value })}
            placeholder={isPicture(fig.kind) ? "What the figure shows, and where the data come from" : "What the table shows"}
            className="min-h-16 text-sm"
          />
        </div>
      </div>
    </div>
  )
}

function Chart({ fig, table, data }: { fig: FigureSpec; table: Table; data: ReturnType<typeof grouped> }) {
  const margin = { top: 10, right: 24, bottom: fig.xLabel || fig.x ? 36 : 16, left: 16 }
  const tick = { fill: "#333", fontSize: 12, fontFamily: FONT }
  const xLabel = { value: fig.xLabel || fig.x, position: "insideBottom" as const, offset: -20, fill: "#111", fontSize: 13, fontFamily: FONT }
  const yLabel = { value: fig.yLabel || (fig.y.length === 1 ? fig.y[0] : ""), angle: -90, position: "insideLeft" as const, offset: 4, fill: "#111", fontSize: 13, fontFamily: FONT, style: { textAnchor: "middle" as const } }
  const grid = <CartesianGrid stroke="#e5e5e5" vertical={false} />
  const axis = { stroke: "#999", tickLine: false }
  if (fig.kind === "scatter")
    return (
      <ScatterChart width={W} height={H} margin={margin}>
        <CartesianGrid stroke="#e5e5e5" />
        <XAxis type="number" dataKey="x" name={fig.x} tick={tick} label={xLabel} domain={["auto", "auto"]} {...axis} />
        <YAxis type="number" dataKey="y" tick={tick} label={yLabel} domain={["auto", "auto"]} {...axis} />
        {fig.y.map((y, i) => (
          <Scatter key={y} name={y} data={points(table, fig, y)} fill={PALETTE[i % PALETTE.length]} isAnimationActive={false} />
        ))}
      </ScatterChart>
    )
  if (fig.kind === "line")
    return (
      <LineChart width={W} height={H} data={data} margin={margin}>
        {grid}
        <XAxis dataKey={fig.x} tick={tick} label={xLabel} {...axis} />
        <YAxis tick={tick} label={yLabel} {...axis} />
        {fig.y.map((y, i) => (
          <Line key={y} dataKey={y} stroke={PALETTE[i % PALETTE.length]} strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} connectNulls />
        ))}
      </LineChart>
    )
  return (
    <BarChart width={W} height={H} data={data} margin={margin}>
      {grid}
      <XAxis dataKey={fig.x} tick={tick} label={xLabel} {...axis} />
      <YAxis tick={tick} label={yLabel} {...axis} />
      {fig.y.map((y, i) => (
        <Bar key={y} dataKey={y} fill={PALETTE[i % PALETTE.length]} isAnimationActive={false} />
      ))}
    </BarChart>
  )
}

function TablePreview({ rows }: { rows: string[][] }) {
  const [head, ...body] = rows
  const shown = body.slice(0, 50)
  return (
    <>
      <table className="w-full border-collapse text-sm" style={{ fontFamily: FONT }}>
        <thead>
          <tr className="border-y border-neutral-800">
            {head.map((h, i) => (
              <th key={i} className="px-2 py-1.5 text-left font-semibold">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="tabular-nums">
          {shown.map((r, i) => (
            <tr key={i} className={i === shown.length - 1 ? "border-b border-neutral-800" : ""}>
              {head.map((_, c) => (
                <td key={c} className="px-2 py-1">
                  {r[c]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {body.length > shown.length && <p className="mt-2 text-xs text-neutral-500">Showing 50 of {body.length} rows. All of them go into the note.</p>}
    </>
  )
}

/** The chart as a standalone SVG (with a legend and a white background) and a 2× PNG. */
async function snapshot(el: HTMLElement, fig: FigureSpec): Promise<{ png: Blob; svg: string } | null> {
  const svg = el.querySelector("svg.recharts-surface") as SVGSVGElement | null
  if (!svg) return null
  const legend = fig.y.length > 1 ? 24 : 0
  const clone = svg.cloneNode(true) as SVGSVGElement
  const NS = "http://www.w3.org/2000/svg"
  const root = document.createElementNS(NS, "svg")
  root.setAttribute("xmlns", NS)
  root.setAttribute("width", String(W))
  root.setAttribute("height", String(H + legend))
  root.setAttribute("viewBox", `0 0 ${W} ${H + legend}`)
  root.setAttribute("font-family", FONT)
  const bg = document.createElementNS(NS, "rect")
  bg.setAttribute("width", "100%")
  bg.setAttribute("height", "100%")
  bg.setAttribute("fill", "#ffffff")
  root.appendChild(bg)
  if (legend) {
    // Right-aligned legend row, like the preview.
    let x = W - 16
    const g = document.createElementNS(NS, "g")
    for (let i = fig.y.length - 1; i >= 0; i--) {
      const label = fig.y[i]
      const w = label.length * 6.6 + 18
      x -= w
      const r = document.createElementNS(NS, "rect")
      r.setAttribute("x", String(x))
      r.setAttribute("y", "7")
      r.setAttribute("width", "10")
      r.setAttribute("height", "10")
      r.setAttribute("fill", PALETTE[i % PALETTE.length])
      const t = document.createElementNS(NS, "text")
      t.setAttribute("x", String(x + 15))
      t.setAttribute("y", "16")
      t.setAttribute("font-size", "12")
      t.setAttribute("fill", "#111")
      t.textContent = label
      g.append(r, t)
      x -= 12
    }
    root.appendChild(g)
  }
  const body = document.createElementNS(NS, "g")
  body.setAttribute("transform", `translate(0 ${legend})`)
  for (const child of Array.from(clone.childNodes)) body.appendChild(child)
  root.appendChild(body)
  const text = new XMLSerializer().serializeToString(root)
  const img = new Image()
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(text)}`
  await img.decode()
  const canvas = document.createElement("canvas")
  canvas.width = W * 2
  canvas.height = (H + legend) * 2
  const ctx = canvas.getContext("2d")!
  ctx.scale(2, 2)
  ctx.drawImage(img, 0, 0)
  const png = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/png"))
  return png ? { png, svg: text } : null
}

function PasteDialog({
  open,
  onOpenChange,
  projectId,
  onAdded,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  projectId: string
  onAdded: (name: string) => void
}) {
  const [name, setName] = useState("")
  const [text, setText] = useState("")
  useEffect(() => {
    if (open) {
      setName("")
      setText("")
    }
  }, [open])
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Paste data</DialogTitle>
          <DialogDescription>Copy the cells in Excel, Numbers or Google Sheets, with the column names in the first row, and paste them here.</DialogDescription>
        </DialogHeader>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name, e.g. Survey results" aria-label="Name" />
        <Textarea value={text} onChange={(e) => setText(e.target.value)} className="min-h-48 font-mono text-xs" aria-label="Data" placeholder={"group\tscore\nsleep\t12\nwake\t8"} />
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={!text.trim()}
            onClick={() =>
              api.pasteDataset(projectId, `${name.trim() || "Pasted data"}.${text.split("\n", 1)[0].includes("\t") ? "tsv" : "csv"}`, text).then(
                (r) => {
                  onOpenChange(false)
                  onAdded(r.name)
                },
                (e) => toast.error(e.message),
              )
            }
          >
            Add
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
