import type { ChainableOperation } from "../types/calculator";
import { formatResult } from "./formatResult";
import { OPERATOR_SYMBOLS } from "./operatorSymbols";

// A parenthesized group that's still open: the outer terms/operators
// captured at the moment "(" was pressed, so they can be restored once
// the group closes (or the user backspaces out of it).
export interface ParenFrame {
  terms: number[];
  operators: ChainableOperation[];
  termLabels: (string | null)[];
  // True when "(" was pressed with a √ prefix pending and nothing typed
  // for its radicand yet — the group about to open *is* the radicand,
  // e.g. "√" then "(" then "9" then ")" reads "√(9)" and resolves
  // sqrt(9), not "√0" immediately multiplied by a new group (see
  // useCalculator's openParen/closeParen).
  sqrtOnClose: boolean;
}

// Everything needed to render one level's own content: its committed
// terms/operators plus whatever's currently being typed for the next
// one. Shared by buildExpressionText (the top/innermost level) and
// useCalculator's closeParen (to capture a group's literal text at the
// moment it closes).
export interface LevelRenderState {
  terms: number[];
  operators: ChainableOperation[];
  // Parallel to terms: null for an ordinary typed number (rendered via
  // formatResult), or a literal override for a term that came from a
  // closed group or a resolved √ prefix — e.g. the 5 in "9+(5)", or the
  // 3 in "9+√9" — so the term's origin stays visible, not just its value.
  termLabels: (string | null)[];
  currentInput: string;
  // Same idea as termLabels, for the term currently being typed/edited.
  currentInputLabel: string | null;
  // True while a "√" has been pressed with nothing typed yet, and the
  // user is now typing the number that goes under the root — e.g. "√"
  // then "9" reads "√9" as it's typed, instead of needing the number
  // first (see useCalculator's applySqrt).
  pendingSqrt: boolean;
  // True while "−" has been pressed with nothing typed yet for this
  // term, marking the next digits typed as a negative number — e.g.
  // "×" then "−" then "4" reads "×−4" as it's typed. This is the only
  // way to type a negative number at all (there's no dedicated ± key),
  // so "−" here means "sign", not "subtract" (see useCalculator's
  // chooseOperation).
  pendingNegative: boolean;
  overwrite: boolean;
}

export interface ExpressionRenderState extends LevelRenderState {
  parenStack: ParenFrame[];
}

// A term whose display starts with the minus sign gets wrapped in
// parens when something precedes it in the same level — "4×(−4)"
// instead of "4×−4" — so the operator symbol and the sign symbol are
// never left touching, unreadable as a run of two glyphs. The very
// first term in a level never needs this: "−4+3" is ordinary notation,
// nothing precedes the sign there to confuse it with.
function wrapIfNegative(display: string, needsWrap: boolean): string {
  return needsWrap && display.startsWith("−") ? `(${display})` : display;
}

// Swaps a leading ASCII "-" for the Unicode minus sign. currentInput is
// kept parseFloat-safe (a plain ASCII "-", not "−" — see useCalculator's
// numberToInputString) wherever it might get re-parsed later, e.g. after
// restoring a term from a closed group or resolving in place (like
// percentage's in-place transform, which sets no overriding label at
// all). Displaying it directly — the only place raw currentInput reaches
// the user — needs the same minus sign used everywhere else, so this
// converts on the way out instead of storing it pre-converted.
export function toDisplayMinus(input: string): string {
  return input.startsWith("-") ? `−${input.slice(1)}` : input;
}

function renderTerms(
  terms: number[],
  operators: ChainableOperation[],
  termLabels: (string | null)[],
): string {
  let text = "";
  terms.forEach((term, index) => {
    const display = wrapIfNegative(termLabels[index] ?? formatResult(term), index > 0);
    text += display + OPERATOR_SYMBOLS[operators[index]];
  });
  return text;
}

function renderLevel(state: LevelRenderState): string {
  const text = renderTerms(state.terms, state.operators, state.termLabels);

  // The sign goes *after* "√" when both are pending — "√−4", not
  // "−√4" — since it's the radicand that's negative, not (yet) a
  // result to negate: "√" then "−" then "4" builds up exactly the
  // number that's about to be checked for a negative-sqrt error, the
  // same way "−" then "4" alone builds up a plain negative number.
  const sign = state.pendingNegative ? "−" : "";
  const displayInput = toDisplayMinus(state.currentInput);
  const rawTrailing =
    state.currentInputLabel ?? (state.pendingSqrt ? `√${sign}${displayInput}` : `${sign}${displayInput}`);
  const trailingLabel = wrapIfNegative(rawTrailing, state.terms.length > 0);

  // currentInput resets to the "0" placeholder right after an operator
  // (with overwrite=true) so a fresh digit replaces it rather than
  // appending; that placeholder shouldn't show up in the expression (it
  // would render as a stray trailing "0", e.g. "9+0"). A pending √ or a
  // pending negative sign always shows, though — "√0" and "−0" are
  // meaningful placeholders, the same way an open group always shows
  // its "(0" placeholder.
  const isUntouchedPlaceholder =
    state.overwrite &&
    state.currentInput === "0" &&
    state.currentInputLabel === null &&
    !state.pendingSqrt &&
    !state.pendingNegative;
  const showCurrentInput = state.terms.length === 0 || !isUntouchedPlaceholder;

  return showCurrentInput ? text + trailingLabel : text;
}

// Renders the expression as typed so far, e.g. "9×7+1-6÷6" or
// "5+(2×(3+1)" while a group is still open, or "9+√9" while a √ prefix
// is being typed — so the user can see and follow along with exactly
// what they've entered, not a collapsed running total.
export function buildExpressionText(state: ExpressionRenderState): string {
  let prefix = "";
  for (const frame of state.parenStack) {
    const sqrtPrefix = frame.sqrtOnClose ? "√" : "";
    prefix += sqrtPrefix + renderTerms(frame.terms, frame.operators, frame.termLabels) + "(";
  }
  return prefix + renderLevel(state);
}

// Exposed so useCalculator can render a group's own content into a
// literal label (wrapped in parentheses) at the moment it closes.
export { renderLevel };
