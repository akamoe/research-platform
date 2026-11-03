import Papa from "papaparse"
import type { FigureSpec } from "@/lib/api"

/** A CSV as columns of strings. */
export interface Table {
  fields: string[]
  rows: Record<string, string>[]
}

export function parse(text: string): Table {
  const r = Papa.parse<Record<string, string>>(text.replace(/^﻿/, ""), { header: true, skipEmptyLines: "greedy", transformHeader: (h, i) => h.trim() || `Column ${i + 1}` })
  return { fields: r.meta.fields ?? [], rows: r.data }
}

/** A number from a cell: "3.5", "1,234", "3,5" (decimal comma), "45%". */
export function num(v: string | undefined): number | null {
  if (v == null) return null
  let s = v.trim().replace(/%$/, "")
  if (!s) return null
  if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, "")
  else if (/^-?\d+,\d+$/.test(s)) s = s.replace(",", ".")
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

export function isNumeric(t: Table, field: string) {
  let filled = 0
  let ok = 0
  for (const r of t.rows) {
    const v = r[field]?.trim()
    if (!v) continue
    filled++
    if (num(v) !== null) ok++
  }
  return filled > 0 && ok / filled >= 0.8
}

const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length
const sd = (a: number[]) => {
  if (a.length < 2) return NaN
  const m = mean(a)
  return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1))
}
const median = (a: number[]) => {
  const b = [...a].sort((x, y) => x - y)
  const h = Math.floor(b.length / 2)
  return b.length % 2 ? b[h] : (b[h - 1] + b[h]) / 2
}

/** Short, readable numbers for tables: 2 decimals, fewer for whole numbers. */
export function fmt(n: number) {
  if (!Number.isFinite(n)) return "–"
  if (Number.isInteger(n)) return String(n)
  return Math.abs(n) >= 100 ? n.toFixed(1) : n.toFixed(2)
}

/** Rows for a bar or line chart: one per x value, one key per y column. */
export function grouped(t: Table, f: FigureSpec) {
  const order: string[] = []
  const groups = new Map<string, Record<string, number[]>>()
  for (const r of t.rows) {
    const k = (r[f.x] ?? "").trim()
    if (!k) continue
    if (!groups.has(k)) {
      groups.set(k, {})
      order.push(k)
    }
    const g = groups.get(k)!
    for (const y of f.y) {
      const v = num(r[y])
      if (f.agg === "count") (g[y] ??= []).push(1)
      else if (v !== null) (g[y] ??= []).push(v)
    }
  }
  if (isNumeric(t, f.x)) order.sort((a, b) => num(a)! - num(b)!)
  return order.map((k) => {
    const g = groups.get(k)!
    const row: Record<string, string | number | null> = { [f.x]: k }
    for (const y of f.y) {
      const v = g[y] ?? []
      row[y] = !v.length ? null : f.agg === "sum" || f.agg === "count" ? v.reduce((s, x) => s + x, 0) : f.agg === "none" ? v[0] : mean(v)
    }
    return row
  })
}

export function points(t: Table, f: FigureSpec, y: string) {
  const out: { x: number; y: number }[] = []
  for (const r of t.rows) {
    const x = num(r[f.x])
    const v = num(r[y])
    if (x !== null && v !== null) out.push({ x, y: v })
  }
  return out
}

/** The table a "table" or "summary" figure shows, header first. */
export function tableRows(t: Table, f: FigureSpec): string[][] {
  if (f.kind === "summary") {
    const cols = f.y.length ? f.y : t.fields.filter((c) => isNumeric(t, c))
    const head = ["Variable", "N", "Mean", "SD", "Min", "Median", "Max"]
    const stats = (label: string, rows: Record<string, string>[], c: string) => {
      const v = rows.map((r) => num(r[c])).filter((x): x is number => x !== null)
      return v.length ? [label, String(v.length), fmt(mean(v)), fmt(sd(v)), fmt(Math.min(...v)), fmt(median(v)), fmt(Math.max(...v))] : [label, "0", "–", "–", "–", "–", "–"]
    }
    if (f.x) {
      const groups = [...new Set(t.rows.map((r) => (r[f.x] ?? "").trim()).filter(Boolean))]
      return [[f.x, ...head], ...groups.flatMap((g) => cols.map((c) => [g, ...stats(c, t.rows.filter((r) => (r[f.x] ?? "").trim() === g), c)]))]
    }
    return [head, ...cols.map((c) => stats(c, t.rows, c))]
  }
  const cols = [f.x, ...f.y].filter(Boolean)
  const use = cols.length ? cols : t.fields
  return [use, ...t.rows.slice(0, 1000).map((r) => use.map((c) => (r[c] ?? "").trim()))]
}

/** Colour-blind safe (Okabe–Ito), dark enough to print. */
export const PALETTE = ["#0072B2", "#E69F00", "#009E73", "#D55E00", "#CC79A7", "#56B4E9", "#7F7F7F", "#000000"]
