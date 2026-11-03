/** Word counts the way a supervisor would count them: prose only, no markup, citations or maths. */

const WORD = /[\p{L}\p{N}][\p{L}\p{N}\p{M}'’\-]*/gu

export const countWords = (text: string) => text.match(WORD)?.length ?? 0

/** Markdown notes: drop code, images, link targets, citations, html and markup characters. */
export function markdownProse(md: string) {
  return md
    .replace(/^---\n[\s\S]*?\n---\n/, "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`\n]*`/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[(?:-?@[\w:.#$%&+?<>~/-]+[;,\s]*)+[^\]]*\]/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\$\$[\s\S]*?\$\$|\$[^$\n]+\$/g, " ")
    .replace(/^\s*(#{1,6}|>|[-*+]|\d+[.)])\s+/gm, "")
    .replace(/[*_~|]/g, " ")
}

/** LaTeX: only the document body, without comments, maths, citations, labels and command names. */
export function latexProse(tex: string) {
  let t = tex.replace(/(^|[^\\])%.*$/gm, "$1")
  const begin = t.indexOf("\\begin{document}")
  if (begin >= 0) t = t.slice(begin + 16)
  const end = t.indexOf("\\end{document}")
  if (end >= 0) t = t.slice(0, end)
  return t
    .replace(/\\begin\{(equation|align|gather|multline|eqnarray|displaymath|math|figure|table|tikzpicture|verbatim|lstlisting)\*?\}[\s\S]*?\\end\{\1\*?\}/g, (m) =>
      // Keep figure and table captions, they're part of the text.
      [...m.matchAll(/\\caption(?:\[[^\]]*\])?\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}/g)].map((c) => c[1]).join(" "),
    )
    .replace(/\\\[[\s\S]*?\\\]|\\\([\s\S]*?\\\)|\$\$[\s\S]*?\$\$|\$[^$]*\$/g, " ")
    .replace(/\\(cite\w*|ref|eqref|autoref|cref|Cref|label|pageref|includegraphics|input|include|bibliography|bibliographystyle|url|usepackage|documentclass|begin|end|vspace|hspace|setlength|newcommand|renewcommand)\*?(\[[^\]]*\])*(\{[^}]*\})?/g, " ")
    .replace(/\\([%$#])/g, "$1")
    .replace(/\\[a-zA-Z@]+\*?/g, " ")
    .replace(/\\./g, " ")
    .replace(/[{}[\]&~^_]/g, " ")
}

export const countMarkdown = (md: string) => countWords(markdownProse(md))
export const countLatex = (tex: string) => countWords(latexProse(tex))
