/**
 * Journal templates for the LaTeX tab. Each one uses a document class that ships with TeX Live,
 * MacTeX, MiKTeX and Tectonic, so it compiles offline without downloading anything from the
 * journal. Journals whose class isn't in TeX (Springer Nature, PLOS, MDPI...) are left out; the
 * student can still upload that journal's own .cls file.
 */

export interface LatexTemplate {
  id: string
  name: string
  publisher: string
  /** A few journals or venues that use it, so students recognise it. */
  examples: string
  field: "General" | "Computing & engineering" | "Physics & astronomy" | "Chemistry" | "Mathematics" | "Life & multidisciplinary science" | "Psychology & social science"
  /** The class it loads, shown so people can look it up. */
  cls: string
  body: (title: string) => string
}

/** RevTeX always has a bibliography of its own, so its \\bibliography line can stay on (style null). */
const CITE_NOTE = (style: string | null) =>
  style
    ? `% Cite with \\cite{key}: type \\cite and pick from your References.
% After your first citation, remove the % from the next two lines to print the reference list.
% \\bibliographystyle{${style}}
% \\bibliography{references}`
    : `% Cite with \\cite{key}: type \\cite and pick from your References. The list below fills in as you cite.
\\bibliography{references}`

const SECTIONS = `\\section{Introduction}


\\section{Methods}


\\section{Results}


\\section{Discussion}

`

export const TEMPLATES: LatexTemplate[] = [
  {
    id: "article",
    name: "Plain article",
    publisher: "Folio",
    examples: "Class papers, theses chapters, any journal that takes a plain PDF",
    field: "General",
    cls: "article",
    body: (title) => `\\documentclass[12pt]{article}
\\usepackage[margin=1in]{geometry}
\\usepackage{graphicx}
\\usepackage[authoryear,round]{natbib}
\\usepackage[hidelinks]{hyperref}

\\title{${title}}
\\author{Your name}
\\date{\\today}

\\begin{document}
\\maketitle

\\section{Introduction}


% Cite with \\citep{key} or \\citet{key}: type \\cite and pick from your References.
% After your first citation, remove the % from the next two lines to print the reference list.
% \\bibliographystyle{apalike}
% \\bibliography{references}

\\end{document}
`,
  },

  // ---------- Computing & engineering ----------
  {
    id: "ieee-journal",
    name: "IEEE Transactions and journals",
    publisher: "IEEE",
    examples: "IEEE Transactions on Pattern Analysis and Machine Intelligence, IEEE Access",
    field: "Computing & engineering",
    cls: "IEEEtran",
    body: (title) => `\\documentclass[journal]{IEEEtran}
\\usepackage{graphicx}
\\usepackage{amsmath}
\\usepackage{cite}
\\usepackage[hidelinks]{hyperref}

\\begin{document}

\\title{${title}}
\\author{First~Author,~\\IEEEmembership{Student Member,~IEEE,}
  and~Second~Author%
\\thanks{F. Author and S. Author are with the Department of ..., University of ... (e-mail: you@example.edu).}}
\\markboth{IEEE Transactions on ...}{Author \\MakeLowercase{\\textit{et al.}}: ${title}}

\\maketitle

\\begin{abstract}
Your abstract.
\\end{abstract}

\\begin{IEEEkeywords}
Keyword, keyword, keyword.
\\end{IEEEkeywords}

\\section{Introduction}
\\IEEEPARstart{T}{his} is where the paper starts.

\\section{Method}


\\section{Results}


\\section{Conclusion}


${CITE_NOTE("IEEEtran")}

\\end{document}
`,
  },
  {
    id: "ieee-conference",
    name: "IEEE conference paper",
    publisher: "IEEE",
    examples: "CVPR, ICRA, ICASSP and most IEEE conferences",
    field: "Computing & engineering",
    cls: "IEEEtran",
    body: (title) => `\\documentclass[conference]{IEEEtran}
\\usepackage{graphicx}
\\usepackage{amsmath}
\\usepackage{cite}
\\usepackage[hidelinks]{hyperref}

\\begin{document}

\\title{${title}}
\\author{\\IEEEauthorblockN{First Author}
\\IEEEauthorblockA{Department, University\\\\
City, Country\\\\
you@example.edu}
\\and
\\IEEEauthorblockN{Second Author}
\\IEEEauthorblockA{Department, University\\\\
City, Country\\\\
them@example.edu}}

\\maketitle

\\begin{abstract}
Your abstract.
\\end{abstract}

\\begin{IEEEkeywords}
Keyword, keyword, keyword.
\\end{IEEEkeywords}

\\section{Introduction}


\\section{Related work}


\\section{Method}


\\section{Experiments}


\\section{Conclusion}


${CITE_NOTE("IEEEtran")}

\\end{document}
`,
  },
  {
    id: "acm-journal",
    name: "ACM journals",
    publisher: "ACM",
    examples: "Journal of the ACM, ACM Computing Surveys, ACM TOCHI",
    field: "Computing & engineering",
    cls: "acmart (acmsmall)",
    body: (title) => `\\documentclass[acmsmall,screen]{acmart}
% Remove these two lines once the journal gives you the rights and DOI details.
\\setcopyright{none}
\\settopmatter{printacmref=false}

\\begin{document}

\\title{${title}}
\\author{First Author}
\\affiliation{%
  \\institution{University}
  \\city{City}
  \\country{Country}}
\\email{you@example.edu}

\\author{Second Author}
\\affiliation{%
  \\institution{University}
  \\city{City}
  \\country{Country}}

\\begin{abstract}
Your abstract.
\\end{abstract}

\\keywords{keyword, keyword, keyword}

\\maketitle

${SECTIONS}${CITE_NOTE("ACM-Reference-Format")}

\\end{document}
`,
  },
  {
    id: "acm-conference",
    name: "ACM conference paper",
    publisher: "ACM",
    examples: "CHI, SIGGRAPH, KDD, and other ACM conferences (sigconf)",
    field: "Computing & engineering",
    cls: "acmart (sigconf)",
    body: (title) => `\\documentclass[sigconf,screen]{acmart}
% Remove these two lines once the conference gives you the rights and DOI details.
\\setcopyright{none}
\\settopmatter{printacmref=false}

\\begin{document}

\\title{${title}}
\\author{First Author}
\\affiliation{%
  \\institution{University}
  \\city{City}
  \\country{Country}}
\\email{you@example.edu}

\\begin{abstract}
Your abstract.
\\end{abstract}

\\keywords{keyword, keyword, keyword}

\\maketitle

\\section{Introduction}


\\section{Related work}


\\section{Method}


\\section{Evaluation}


\\section{Conclusion}


${CITE_NOTE("ACM-Reference-Format")}

\\end{document}
`,
  },
  {
    id: "springer-lncs",
    name: "Springer LNCS",
    publisher: "Springer",
    examples: "Lecture Notes in Computer Science proceedings (ECCV, MICCAI, ...)",
    field: "Computing & engineering",
    cls: "llncs",
    body: (title) => `\\documentclass[runningheads]{llncs}
\\usepackage{graphicx}
\\usepackage{amsmath}
\\usepackage[hidelinks]{hyperref}

\\begin{document}

\\title{${title}}
\\author{First Author\\inst{1} \\and Second Author\\inst{2}}
\\authorrunning{F. Author and S. Author}
\\institute{University, City, Country \\email{you@example.edu} \\and
University, City, Country}

\\maketitle

\\begin{abstract}
Your abstract (150--250 words).
\\keywords{Keyword \\and Keyword \\and Keyword.}
\\end{abstract}

\\section{Introduction}


\\section{Related work}


\\section{Method}


\\section{Experiments}


\\section{Conclusion}


${CITE_NOTE("splncs04")}

\\end{document}
`,
  },

  // ---------- Physics & astronomy ----------
  {
    id: "aps",
    name: "Physical Review (APS)",
    publisher: "American Physical Society",
    examples: "Physical Review Letters, Physical Review B, Physical Review X",
    field: "Physics & astronomy",
    cls: "revtex4-2 (aps)",
    body: (title) => `\\documentclass[aps,prl,reprint,superscriptaddress]{revtex4-2}
% For another journal change prl to pra, prb, prd, pre, prx...
\\usepackage{graphicx}
\\usepackage{amsmath}
\\usepackage[hidelinks]{hyperref}

\\begin{document}

\\title{${title}}
\\author{First Author}
\\email{you@example.edu}
\\affiliation{Department of Physics, University, City, Country}
\\author{Second Author}
\\affiliation{Department of Physics, University, City, Country}

\\date{\\today}

\\begin{abstract}
Your abstract.
\\end{abstract}

\\maketitle

\\section{Introduction}


\\section{Model}


\\section{Results}


\\section{Conclusion}


\\begin{acknowledgments}
We thank ...
\\end{acknowledgments}

${CITE_NOTE(null)}

\\end{document}
`,
  },
  {
    id: "aip",
    name: "AIP journals",
    publisher: "AIP Publishing",
    examples: "The Journal of Chemical Physics, Applied Physics Letters, Journal of Applied Physics",
    field: "Physics & astronomy",
    cls: "revtex4-2 (aip)",
    body: (title) => `\\documentclass[aip,jcp,reprint,amsmath,amssymb]{revtex4-2}
% For another journal change jcp to apl, jap, rsi, pop, cha...
\\usepackage{graphicx}
\\usepackage[hidelinks]{hyperref}

\\begin{document}

\\title{${title}}
\\author{First Author}
\\email{you@example.edu}
\\affiliation{Department, University, City, Country}
\\author{Second Author}
\\affiliation{Department, University, City, Country}

\\date{\\today}

\\begin{abstract}
Your abstract.
\\end{abstract}

\\maketitle

${SECTIONS}${CITE_NOTE(null)}

\\end{document}
`,
  },
  {
    id: "mnras",
    name: "Monthly Notices of the RAS",
    publisher: "Royal Astronomical Society",
    examples: "MNRAS, MNRAS Letters",
    field: "Physics & astronomy",
    cls: "mnras",
    body: (title) => `\\documentclass[fleqn,usenatbib]{mnras}
\\usepackage[T1]{fontenc}
\\usepackage{graphicx}
\\usepackage{amsmath}
\\usepackage{amssymb}

\\title[Short title]{${title}}
\\author[F. Author et al.]{First Author,$^{1}$\\thanks{E-mail: you@example.edu}
Second Author$^{2}$
\\\\
$^{1}$Department, University, City, Country\\\\
$^{2}$Department, University, City, Country}

\\date{Accepted XXX. Received YYY; in original form ZZZ}
\\pubyear{\\the\\year}

\\begin{document}
\\label{firstpage}
\\pagerange{\\pageref{firstpage}--\\pageref{lastpage}}
\\maketitle

\\begin{abstract}
Your abstract.
\\end{abstract}

\\begin{keywords}
keyword -- keyword -- keyword
\\end{keywords}

\\section{Introduction}


\\section{Observations}


\\section{Results}


\\section{Conclusions}


\\section*{Data availability}


${CITE_NOTE("mnras")}

\\bsp
\\label{lastpage}
\\end{document}
`,
  },
  {
    id: "aas",
    name: "AAS journals",
    publisher: "American Astronomical Society",
    examples: "The Astrophysical Journal, The Astronomical Journal, ApJ Letters",
    field: "Physics & astronomy",
    cls: "aastex631",
    body: (title) => `\\documentclass[twocolumn]{aastex631}

\\begin{document}

\\title{${title}}

\\author{First Author}
\\affiliation{Department of Astronomy, University, City, Country}
\\email{you@example.edu}

\\author{Second Author}
\\affiliation{Department of Astronomy, University, City, Country}

\\begin{abstract}
Your abstract.
\\end{abstract}

\\keywords{keyword --- keyword --- keyword}

\\section{Introduction}


\\section{Observations}


\\section{Results}


\\section{Discussion}


${CITE_NOTE("aasjournal")}

\\end{document}
`,
  },

  // ---------- Chemistry ----------
  {
    id: "acs",
    name: "ACS journals",
    publisher: "American Chemical Society",
    examples: "Journal of the American Chemical Society, Nano Letters, ACS Nano",
    field: "Chemistry",
    cls: "achemso",
    body: (title) => `\\documentclass[journal=jacsat,manuscript=article]{achemso}
% For another journal change jacsat to its code, e.g. nalefd (Nano Letters), ancac3 (ACS Nano).
\\usepackage{graphicx}
\\usepackage[version=4]{mhchem}

\\author{First Author}
\\affiliation{Department of Chemistry, University, City, Country}
\\email{you@example.edu}
\\author{Second Author}
\\affiliation{Department of Chemistry, University, City, Country}

\\title{${title}}

\\begin{document}

\\begin{abstract}
Your abstract.
\\end{abstract}

\\section{Introduction}


\\section{Results and discussion}


\\section{Conclusions}


\\section{Experimental section}


\\begin{acknowledgement}
We thank ...
\\end{acknowledgement}

% Cite with \\cite{key}: type \\cite and pick from your References.
% After your first citation, remove the % from the next line to print the reference list.
% \\bibliography{references}

\\end{document}
`,
  },

  // ---------- Mathematics ----------
  {
    id: "ams",
    name: "AMS journals",
    publisher: "American Mathematical Society",
    examples: "Journal of the AMS, Transactions of the AMS, Proceedings of the AMS",
    field: "Mathematics",
    cls: "amsart",
    body: (title) => `\\documentclass{amsart}
\\usepackage{amssymb}
\\usepackage[hidelinks]{hyperref}

\\newtheorem{theorem}{Theorem}[section]
\\newtheorem{lemma}[theorem]{Lemma}
\\theoremstyle{definition}
\\newtheorem{definition}[theorem]{Definition}
\\theoremstyle{remark}
\\newtheorem{remark}[theorem]{Remark}

\\begin{document}

\\title{${title}}
\\author{First Author}
\\address{Department of Mathematics, University, City, Country}
\\email{you@example.edu}

\\subjclass[2020]{Primary 00A00; Secondary 00A00}
\\keywords{keyword, keyword}

\\begin{abstract}
Your abstract.
\\end{abstract}

\\maketitle

\\section{Introduction}


\\section{Main results}

\\begin{theorem}
Statement.
\\end{theorem}

\\begin{proof}
Proof.
\\end{proof}

${CITE_NOTE("amsplain")}

\\end{document}
`,
  },

  // ---------- Life & multidisciplinary science ----------
  {
    id: "nature",
    name: "Nature (first submission)",
    publisher: "Springer Nature",
    examples: "Nature and Nature research journals. Nature takes any tidy PDF at first submission; this follows its layout",
    field: "Life & multidisciplinary science",
    cls: "nature",
    body: (title) => `\\documentclass{nature}
\\usepackage{graphicx}

\\title{${title}}
\\author{First Author$^{1}$ \\& Second Author$^{2}$}

\\begin{document}

\\maketitle

\\begin{affiliations}
 \\item Department, University, City, Country.
 \\item Department, University, City, Country.
\\end{affiliations}

\\begin{abstract}
Your summary paragraph (about 150 words for an Article, without references).
\\end{abstract}

The main text starts here, without headings in the first part.

\\section*{Results}


\\section*{Discussion}


\\begin{methods}

\\subsection{A methods subsection.}

\\end{methods}

% Cite with \\cite{key}: type \\cite and pick from your References.
% After your first citation, remove the % from the next two lines to print the reference list.
% \\bibliographystyle{naturemag}
% \\bibliography{references}

\\begin{addendum}
 \\item[Acknowledgements] We thank ...
 \\item[Competing interests] The authors declare no competing interests.
 \\item[Correspondence] should be addressed to F.A. (email: you@example.edu).
\\end{addendum}

\\end{document}
`,
  },
  {
    id: "elsevier",
    name: "Elsevier journals",
    publisher: "Elsevier",
    examples: "Cognition, Neural Networks, Computers & Education, and most Elsevier journals",
    field: "Life & multidisciplinary science",
    cls: "elsarticle",
    body: (title) => `\\documentclass[preprint,12pt,authoryear]{elsarticle}
\\usepackage{graphicx}
\\usepackage{amsmath}
\\usepackage[hidelinks]{hyperref}

\\journal{Journal name}

\\begin{document}

\\begin{frontmatter}

\\title{${title}}

\\author[uni]{First Author\\corref{cor}}
\\ead{you@example.edu}
\\author[uni]{Second Author}
\\cortext[cor]{Corresponding author}
\\affiliation[uni]{organization={University},
  city={City},
  country={Country}}

\\begin{abstract}
Your abstract.
\\end{abstract}

\\begin{keyword}
keyword \\sep keyword \\sep keyword
\\end{keyword}

\\end{frontmatter}

${SECTIONS}% Cite with \\citep{key} or \\citet{key}: type \\cite and pick from your References.
% After your first citation, remove the % from the next two lines to print the reference list.
% \\bibliographystyle{elsarticle-harv}
% \\bibliography{references}

\\end{document}
`,
  },
  {
    id: "oup",
    name: "Oxford University Press journals",
    publisher: "Oxford University Press",
    examples: "Bioinformatics, Nucleic Acids Research, and other OUP journals",
    field: "Life & multidisciplinary science",
    cls: "oup-authoring-template",
    body: (title) => `\\documentclass[unnumsec,webpdf,contemporary,large]{oup-authoring-template}

\\begin{document}

\\journaltitle{Journal name}
\\DOI{DOI}
\\copyrightyear{\\the\\year}
\\pubyear{\\the\\year}
\\access{Advance Access Publication Date: Day Month Year}
\\appnotes{Paper}

\\firstpage{1}

\\title[Short title]{${title}}

\\author[1,$\\ast$]{First Author}
\\author[2]{Second Author}

\\authormark{First Author et al.}

\\address[1]{\\orgdiv{Department}, \\orgname{University}, \\orgaddress{\\street{Street}, \\postcode{Postcode}, \\country{Country}}}
\\address[2]{\\orgdiv{Department}, \\orgname{University}, \\orgaddress{\\street{Street}, \\postcode{Postcode}, \\country{Country}}}

\\corresp[$\\ast$]{Corresponding author. \\href{mailto:you@example.edu}{you@example.edu}}

\\received{Date}{0}{Year}
\\revised{Date}{0}{Year}
\\accepted{Date}{0}{Year}

\\abstract{Your abstract.}
\\keywords{keyword, keyword, keyword}

\\maketitle

${SECTIONS}${CITE_NOTE("abbrvnat")}

\\end{document}
`,
  },

  // ---------- Psychology & social science ----------
  {
    id: "apa7",
    name: "APA 7th edition",
    publisher: "American Psychological Association",
    examples: "Psychology and social science journals, and student papers in APA style",
    field: "Psychology & social science",
    cls: "apa7",
    body: (title) => `\\documentclass[man,natbib]{apa7}
% man = manuscript for submission; use stu for a student paper or jou for a journal look.
\\usepackage[american]{babel}

\\title{${title}}
\\shorttitle{Short title}
\\authorsnames{First Author, Second Author}
\\authorsaffiliations{University}
\\authornote{Correspondence concerning this article should be addressed to First Author, you@example.edu.}

\\abstract{Your abstract (up to 250 words).}
\\keywords{keyword, keyword, keyword}

\\begin{document}
\\maketitle

The introduction starts here, under the title, without its own heading.

\\section{Method}

\\subsection{Participants}


\\subsection{Procedure}


\\section{Results}


\\section{Discussion}


% Cite with \\citep{key} or \\citet{key}: type \\cite and pick from your References.
% After your first citation, remove the % from the next two lines to print the reference list.
% \\bibliographystyle{apacite}
% \\bibliography{references}

\\end{document}
`,
  },
]

export const templateById = (id: string) => TEMPLATES.find((t) => t.id === id)

export function escapeTitle(title: string) {
  return title.replace(/([&%$#_{}])/g, "\\$1").replace(/~/g, "\\textasciitilde{}").replace(/\^/g, "\\textasciicircum{}")
}
