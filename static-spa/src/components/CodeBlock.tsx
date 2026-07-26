/**
 * Syntax-highlighted code block with a copy button.
 *
 * Hand-rolled rather than pulling in highlight.js/shiki: the only code this
 * app ever renders is the short Python snippet it generates itself, and a
 * tokeniser that handles that costs ~40 lines against ~40KB+ of bundle for a
 * general-purpose library. It also means the palette is driven by the same CSS
 * variables as the rest of the theme, so light/dark just work.
 *
 * Scope: `python` is the only grammar implemented. Anything else renders
 * unhighlighted rather than mis-highlighted.
 */
import { ReactNode, useEffect, useState } from "react";
import { Copy, Check } from "./icons";

type TokenClass =
  | "comment"
  | "string"
  | "kw"
  | "fn"
  | "num"
  | "kwarg";

/**
 * One pass, alternation ordered by precedence — comments and strings first so
 * a `#` or a keyword *inside* a string is never treated as code.
 *
 * Deliberately no lookbehind: `(?<=\.)` for attribute access would work in
 * current browsers but buys little here, since a method name is already caught
 * by `fn` (it is followed by `(`) and bare attributes read fine unstyled.
 */
const PYTHON_RE = new RegExp(
  [
    String.raw`(?<comment>#[^\n]*)`,
    String.raw`(?<string>[rbfuRBFU]{0,2}(?:"""[\s\S]*?"""|'''[\s\S]*?'''|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'))`,
    String.raw`(?<kw>\b(?:from|import|as|def|class|return|if|elif|else|for|while|in|is|not|and|or|None|True|False|with|try|except|finally|raise|lambda|pass|break|continue|yield|await|async|global|nonlocal|assert|del)\b)`,
    // Identifier immediately before `(` — covers both calls and constructors.
    String.raw`(?<fn>\b[A-Za-z_]\w*(?=\s*\())`,
    String.raw`(?<num>\b\d[\d_]*(?:\.\d+)?\b)`,
    // Keyword argument: `name=` but not `name==`.
    String.raw`(?<kwarg>\b[A-Za-z_]\w*(?=\s*=(?!=)))`,
  ].join("|"),
  "g",
);

const TOKEN_STYLE: Record<TokenClass, string> = {
  comment: "italic text-[hsl(var(--code-comment))]",
  string: "text-[hsl(var(--code-string))]",
  kw: "text-[hsl(var(--code-keyword))]",
  fn: "text-[hsl(var(--code-fn))]",
  num: "text-[hsl(var(--code-number))]",
  kwarg: "text-[hsl(var(--code-kwarg))]",
};

/** Split source into styled spans. Returns plain text for unknown languages. */
function highlightPython(source: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let key = 0;

  // exec-loop rather than replace() so we emit React nodes and never build an
  // HTML string — nothing here can inject markup.
  PYTHON_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = PYTHON_RE.exec(source)) !== null) {
    if (m.index > last) {
      out.push(source.slice(last, m.index));
    }
    const groups = (m.groups ?? {}) as Record<string, string | undefined>;
    const cls = (Object.keys(TOKEN_STYLE) as TokenClass[]).find(
      (c) => groups[c] !== undefined,
    );
    if (cls) {
      out.push(
        <span key={key++} className={TOKEN_STYLE[cls]}>
          {m[0]}
        </span>,
      );
    } else {
      out.push(m[0]);
    }
    last = m.index + m[0].length;

    // Zero-length match would spin forever; the grammar shouldn't produce one,
    // but a future edit to the regex could.
    if (m[0].length === 0) PYTHON_RE.lastIndex++;
  }
  if (last < source.length) out.push(source.slice(last));
  return out;
}

export function CodeBlock({
  code,
  language = "python",
  className = "",
}: {
  code: string;
  language?: "python" | "text";
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  // Reset the tick if the snippet changes under us (e.g. the model id resolves
  // after the catalogue loads).
  useEffect(() => setCopied(false), [code]);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(t);
  }, [copied]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
    } catch {
      // Clipboard is unavailable on insecure origins and in some mobile
      // webviews. The code is selectable, so failing quietly is acceptable.
    }
  }

  const content =
    language === "python" ? highlightPython(code) : code;

  return (
    // min-w-0 matters: this sits in grid/flex parents whose tracks size to
    // max-content by default, which would let the <pre> push the page wider
    // than the viewport instead of scrolling inside its own box.
    <div className={`group relative min-w-0 ${className}`}>
      <button
        type="button"
        onClick={copy}
        aria-label={copied ? "Copied" : "Copy code"}
        className="absolute right-2 top-2 z-10 inline-flex h-7 w-7 items-center justify-center rounded-md border border-border bg-background/80 text-muted-foreground backdrop-blur transition-colors hover:bg-accent hover:text-foreground focus-visible:opacity-100 md:opacity-0 md:group-hover:opacity-100"
      >
        {copied ? (
          <Check className="h-3.5 w-3.5 text-success" />
        ) : (
          <Copy className="h-3.5 w-3.5" />
        )}
      </button>
      <pre className="min-w-0 overflow-x-auto rounded-md border border-border bg-muted/50 p-3 pr-11 text-xs leading-relaxed">
        <code className="font-mono">{content}</code>
      </pre>
    </div>
  );
}

export default CodeBlock;
