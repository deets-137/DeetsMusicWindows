// The Compass calculator (docs/features/COMPASS.md §2c). Type a sum into the bar — `1+1`, `log(1000)`,
// `2^10`, `sin(30)` — and one "Answer" row shows `1 + 1 = 2`. Enter copies the answer.
//
// The bar is a search box first, so the grammar is strict on purpose: the WHOLE term must
// parse, every name must be a function or a constant this file knows, and the sum must hold
// at least one operator or function call. "Blink-182" fails, because "Blink" is not a number
// or a name. "1984" gives no row, because a bare number is not a sum. A sum that cannot be
// finished (`1+`) or has no real, finite answer (`1/0`, `sqrt(-1)`) gives no row at all.
//
// There is no `eval` here: the tokenizer and the recursive-descent parser below are the whole
// engine, so nothing the user types can run as code.
//
// Angles are DEGREES: `sin(30)` is 0.5 and `atan(1)` is 45. `rad(x)` and `deg(x)` convert
// between the units when you want the other one.

/** A parsed sum: the answer, and the sum re-printed in one shape (`1+1` → `1 + 1`). */
export interface Sum {
  /** The re-printed sum, for the row's title. */
  text: string;
  /** The answer, for the row's title. Thousands are grouped: `2^64` reads `18,446,744,073,709,552,000`. */
  shown: string;
  /** The answer as plain digits, for the clipboard. */
  plain: string;
}

// ── the words this file knows ─────────────────────────────────

const D = Math.PI / 180;
const fact = (n: number): number => {
  if (n < 0 || !Number.isInteger(n) || n > 170) return NaN;
  let r = 1;
  for (let i = 2; i <= n; i++) r *= i;
  return r;
};
const gcd2 = (a: number, b: number): number => {
  if (!Number.isInteger(a) || !Number.isInteger(b)) return NaN;
  a = Math.abs(a); b = Math.abs(b);
  while (b) { const t = a % b; a = b; b = t; }
  return a;
};

/** Every function name, with how many arguments it takes (`-1` = one or more). */
const FUNCS: Record<string, { n: number; f: (...a: number[]) => number }> = {
  sqrt: { n: 1, f: Math.sqrt }, cbrt: { n: 1, f: Math.cbrt },
  abs: { n: 1, f: Math.abs }, sign: { n: 1, f: Math.sign },
  round: { n: 1, f: Math.round }, floor: { n: 1, f: Math.floor }, ceil: { n: 1, f: Math.ceil },
  trunc: { n: 1, f: Math.trunc },
  exp: { n: 1, f: Math.exp },
  ln: { n: 1, f: Math.log }, log: { n: 1, f: Math.log10 }, log10: { n: 1, f: Math.log10 }, log2: { n: 1, f: Math.log2 },
  sin: { n: 1, f: (x) => Math.sin(x * D) }, cos: { n: 1, f: (x) => Math.cos(x * D) }, tan: { n: 1, f: (x) => Math.tan(x * D) },
  asin: { n: 1, f: (x) => Math.asin(x) / D }, acos: { n: 1, f: (x) => Math.acos(x) / D }, atan: { n: 1, f: (x) => Math.atan(x) / D },
  sinh: { n: 1, f: Math.sinh }, cosh: { n: 1, f: Math.cosh }, tanh: { n: 1, f: Math.tanh },
  rad: { n: 1, f: (x) => x * D }, deg: { n: 1, f: (x) => x / D },
  fact: { n: 1, f: fact },
  pow: { n: 2, f: (a, b) => a ** b }, root: { n: 2, f: (a, b) => (b < 0 && Number.isInteger(a) && a % 2 !== 0 ? -((-b) ** (1 / a)) : b ** (1 / a)) },
  atan2: { n: 2, f: (a, b) => Math.atan2(a, b) / D },
  hypot: { n: -1, f: (...a) => Math.hypot(...a) },
  min: { n: -1, f: (...a) => Math.min(...a) }, max: { n: -1, f: (...a) => Math.max(...a) },
  gcd: { n: -1, f: (...a) => a.reduce(gcd2) }, lcm: { n: -1, f: (...a) => a.reduce((x, y) => (x * y) / gcd2(x, y)) },
};

const CONSTS: Record<string, number> = { pi: Math.PI, "π": Math.PI, tau: Math.PI * 2, e: Math.E };
/** A sum that is only a constant still earns a row for these — `e` alone is a typed letter. */
const BARE_OK = new Set(["pi", "π", "tau"]);

// ── the tokenizer ─────────────────────────────────────────────

type Tok = { k: "num"; v: number } | { k: "name"; v: string } | { k: "op"; v: string };

/** Splits the term. Returns null on any character this file does not know — a colon, a
 *  letter that is not part of a name, a stray comma. */
function lex(src: string): Tok[] | null {
  const t: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === " " || c === "\t") { i++; continue; }
    if (c >= "0" && c <= "9") {
      const m = /^\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(src.slice(i));
      if (!m) return null;
      t.push({ k: "num", v: Number(m[0]) });
      i += m[0].length;
      continue;
    }
    if (c === ".") {
      const m = /^\.\d+(?:[eE][+-]?\d+)?/.exec(src.slice(i));
      if (!m) return null;
      t.push({ k: "num", v: Number(m[0]) });
      i += m[0].length;
      continue;
    }
    if (/[a-zA-Zπ]/.test(c)) {
      const m = /^[a-zA-Zπ][a-zA-Z0-9]*/.exec(src.slice(i))!;
      t.push({ k: "name", v: m[0].toLowerCase() });
      i += m[0].length;
      continue;
    }
    // ×, ÷ and − are what a paste from elsewhere carries; ** is the other power sign.
    if (c === "×" || c === "·") { t.push({ k: "op", v: "*" }); i++; continue; }
    if (c === "÷") { t.push({ k: "op", v: "/" }); i++; continue; }
    if (c === "−" || c === "–") { t.push({ k: "op", v: "-" }); i++; continue; }
    if (c === "*" && src[i + 1] === "*") { t.push({ k: "op", v: "^" }); i += 2; continue; }
    if ("+-*/^%!(),".includes(c)) { t.push({ k: "op", v: c }); i++; continue; }
    return null;
  }
  return t;
}

// ── the parser ────────────────────────────────────────────────

/** Thrown on any sum that does not parse; `parse` turns it into `null`. */
const BAD = Symbol("bad sum");
/** A node: its answer, and its text in the one printed shape. */
interface N { v: number; s: string }

class P {
  private i = 0;
  /** Set when an operator or a function call is seen: a bare number never earns a row. */
  works = false;
  constructor(private readonly t: Tok[]) {}

  private peek(): Tok | undefined { return this.t[this.i]; }
  private isOp(v: string): boolean { const p = this.peek(); return !!p && p.k === "op" && p.v === v; }
  private eat(v: string): boolean { if (!this.isOp(v)) return false; this.i++; return true; }
  private need(v: string): void { if (!this.eat(v)) throw BAD; }
  get done(): boolean { return this.i >= this.t.length; }

  /** expr := term (('+' | '-') term)* */
  expr(): N {
    let n = this.term();
    for (;;) {
      const op = this.isOp("+") ? "+" : this.isOp("-") ? "-" : null;
      if (!op) return n;
      this.i++;
      this.works = true;
      const r = this.term();
      n = { v: op === "+" ? n.v + r.v : n.v - r.v, s: `${n.s} ${op} ${r.s}` };
    }
  }

  /** term := unary (('*' | '/' | '%') unary)* — `%` is the remainder, as `mod` is. */
  private term(): N {
    let n = this.unary();
    for (;;) {
      const p = this.peek();
      let op: string;
      if (p?.k === "op" && (p.v === "*" || p.v === "/" || p.v === "%")) op = p.v;
      else if (p?.k === "name" && p.v === "mod") op = "%";
      else return n;
      this.i++;
      this.works = true;
      const r = this.unary();
      const v = op === "*" ? n.v * r.v : op === "/" ? n.v / r.v : n.v % r.v;
      n = { v, s: `${n.s} ${op === "*" ? "×" : op === "/" ? "÷" : "%"} ${r.s}` };
    }
  }

  /** unary := ('-' | '+') unary | power */
  private unary(): N {
    if (this.eat("-")) { this.works = true; const n = this.unary(); return { v: -n.v, s: `-${n.s}` }; }
    if (this.eat("+")) { this.works = true; return this.unary(); }
    return this.power();
  }

  /** power := postfix ('^' unary)? — right to left, so 2^3^2 is 2^9. */
  private power(): N {
    const b = this.postfix();
    if (!this.eat("^")) return b;
    this.works = true;
    const e = this.unary(); // a minus binds into the exponent: 2^-1
    return { v: b.v ** e.v, s: `${b.s}^${e.s}` };
  }

  /** postfix := primary '!'* */
  private postfix(): N {
    let n = this.primary();
    while (this.eat("!")) { this.works = true; n = { v: fact(n.v), s: `${n.s}!` }; }
    return n;
  }

  /** primary := number | constant | name '(' args ')' | '(' expr ')' */
  private primary(): N {
    const p = this.peek();
    if (!p) throw BAD;
    if (p.k === "num") { this.i++; return { v: p.v, s: num(p.v) }; }
    if (p.k === "name") {
      this.i++;
      const fn = FUNCS[p.v];
      if (fn) {
        this.works = true;
        this.need("(");
        const args: N[] = [this.expr()];
        while (this.eat(",")) args.push(this.expr());
        this.need(")");
        if (fn.n >= 0 ? args.length !== fn.n : args.length < 1) throw BAD;
        return { v: fn.f(...args.map((a) => a.v)), s: `${p.v}(${args.map((a) => a.s).join(", ")})` };
      }
      if (p.v in CONSTS) return { v: CONSTS[p.v], s: p.v === "π" ? "π" : p.v };
      throw BAD;
    }
    if (this.eat("(")) { const n = this.expr(); this.need(")"); return { v: n.v, s: `(${n.s})` }; }
    throw BAD;
  }
}

// ── printing ──────────────────────────────────────────────────

/** A number as typed back: float noise is cut at 12 significant digits, and a number too
 *  large or too small for plain digits goes to the exponent shape. */
function num(v: number): string {
  if (Number.isInteger(v) && Math.abs(v) < 1e21) return String(v);
  const a = Math.abs(v);
  if (a !== 0 && (a >= 1e15 || a < 1e-6)) return Number(v.toPrecision(12)).toExponential().replace("e+", "e");
  return String(Number(v.toPrecision(12)));
}

/** The same number with thousands grouped, for reading. `1234.5` → `1,234.5`. */
function grouped(s: string): string {
  const m = /^(-?)(\d+)(\.\d+)?$/.exec(s);
  if (!m) return s; // an exponent shape is left alone
  return `${m[1]}${m[2].replace(/\B(?=(\d{3})+(?!\d))/g, ",")}${m[3] ?? ""}`;
}

// ── the door ──────────────────────────────────────────────────

/** Reads a term as a sum. Returns null when it is not one, or has no real, finite answer. */
export function parseSum(termRaw: string): Sum | null {
  const src = termRaw.trim();
  if (!src || src.length > 200) return null;
  if (!/[0-9a-zA-Zπ.]/.test(src)) return null; // "++" is not a sum
  const toks = lex(src);
  if (!toks || !toks.length) return null;
  let n: N;
  let works: boolean;
  try {
    const p = new P(toks);
    n = p.expr();
    if (!p.done) return null; // trailing rubbish: the WHOLE term must be the sum
    works = p.works;
  } catch {
    return null;
  }
  // A bare number or a bare `e` is a search term, not a sum.
  if (!works && !(toks.length === 1 && toks[0].k === "name" && BARE_OK.has(toks[0].v))) return null;
  if (!Number.isFinite(n.v)) return null;
  const plain = num(n.v);
  return { text: n.s, shown: grouped(plain), plain };
}
