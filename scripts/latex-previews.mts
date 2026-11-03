/**
 * Renders the first page of every journal template, filled with placeholder text, into
 * public/latex-templates/<id>.png for the template picker. Needs TeX Live (latexmk) and
 * poppler (pdftoppm). Run: npx tsx scripts/latex-previews.mts
 */
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { execFileSync } from "node:child_process"
import { TEMPLATES } from "../server/latex-templates.ts"

const out = path.resolve(import.meta.dirname, "../public/latex-templates")
fs.mkdirSync(out, { recursive: true })
const bib = `@article{walker2002,
  author = {Walker, Matthew P. and Brakefield, Tiffany and Morgan, Alexandra and Hobson, J. Allan and Stickgold, Robert},
  title = {Practice with sleep makes perfect: sleep-dependent motor skill learning},
  journal = {Neuron}, volume = {35}, number = {1}, pages = {205--211}, year = {2002}
}
@article{rasch2013,
  author = {Rasch, Bj{\\"o}rn and Born, Jan},
  title = {About sleep's role in memory},
  journal = {Physiological Reviews}, volume = {93}, number = {2}, pages = {681--766}, year = {2013}
}
`
const natbib = (tex: string) =>
  /^[^%\n]*natbib/m.test(tex) || /\\documentclass(\[[^\]]*\])?\{(acmart|revtex4-[12]|aastex\d*|elsarticle|achemso|oup-authoring-template)\}/.test(tex)

for (const t of TEMPLATES) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `folio-${t.id}-`))
  const cite = natbib(t.body("")) ? "citep" : "cite"
  let first = true
  const tex = t
    .body("Sleep and the consolidation of motor memory")
    .replace(/\\begin\{document\}/, "\\usepackage{lipsum}\n\\begin{document}")
    .replace(/Your (abstract|summary paragraph)[^\n}]*?(?=\n|\})/g, "\\lipsum[1][1-5]")
    .replace(/\\(section|section\*)\{([^}]*)\}\n/g, (m) => {
      const add = first ? `\\lipsum[2][1-4] Earlier work~\\${cite}{walker2002,rasch2013} points the same way. \\lipsum[3]\n` : "\\lipsum[4]\n"
      first = false
      return `${m}${add}`
    })
    .replace(/(The (main text|introduction) starts here[^\n]*)/, `\\lipsum[2] Earlier work~\\${cite}{walker2002,rasch2013} points the same way.`)
    .replace(/^% (\\bibliography(style)?\{)/gm, "$1")
  fs.writeFileSync(path.join(dir, "main.tex"), tex)
  fs.writeFileSync(path.join(dir, "references.bib"), bib)
  try {
    execFileSync("latexmk", ["-pdf", "-interaction=nonstopmode", "main.tex"], { cwd: dir, stdio: "ignore", timeout: 120_000 })
  } catch {
    if (!fs.existsSync(path.join(dir, "main.pdf"))) {
      console.error(`${t.id}: failed, see ${dir}/main.log`)
      continue
    }
  }
  execFileSync("pdftoppm", ["-png", "-singlefile", "-f", "1", "-scale-to-x", "420", "-scale-to-y", "-1", "main.pdf", path.join(out, t.id)], { cwd: dir })
  console.log(`${t.id}: ok`)
}
