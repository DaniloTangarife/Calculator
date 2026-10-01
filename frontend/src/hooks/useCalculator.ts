import { useCallback, useEffect, useReducer, useRef } from "react";
import { CalculatorApiError, calculate, evaluateExpression } from "../services/calculatorApi";
import type { ChainableOperation } from "../types/calculator";
import { buildExpressionText, renderLevel, toDisplayMinus, type ParenFrame } from "../utils/buildExpression";
import { formatResult } from "../utils/formatResult";

interface State {
  // The term currently being typed, e.g. "8" while the user is in the
  // middle of typing the second operand.
  currentInput: string;
  // Set when currentInput is the value of a just-closed group or a
  // resolved √ — holds its literal text (e.g. "(9×9)" or "√9") so
  // buildExpressionText shows that instead of the plain number. null
  // for an ordinarily typed number.
  currentInputLabel: string | null;
  // True right after "√" is pressed with nothing typed yet: the next
  // digits typed build the radicand, shown as "√" + whatever's typed —
  // e.g. "√" then "9" reads "√9" — instead of requiring the number
  // first. Resolved (applied) the moment anything commits this term.
  pendingSqrt: boolean;
  // True right after "−" is pressed with nothing typed yet: the only
  // way to type a negative number, since there's no dedicated ± key —
  // e.g. "×" then "−" then "4" reads "×−4" and resolves to -4, instead
  // of "−" being read as yet another subtract operator (which would
  // otherwise commit a meaningless 0 as ×'s operand first). Resolved
  // (applied, negating whatever the term turns out to be) the moment
  // anything commits this term — see chooseOperation.
  pendingNegative: boolean;
  // Numbers and operators committed so far in the current expression
  // (or the current group, if parenStack isn't empty). Invariant:
  // terms.length === operators.length === termLabels.length (there is
  // always one operator "waiting" for the term currently being typed),
  // except at the very start, when all three are empty.
  terms: number[];
  operators: ChainableOperation[];
  termLabels: (string | null)[];
  // Enclosing groups not yet closed, outermost first. Pushed on "(",
  // popped on ")" or when backspacing out of an empty group.
  parenStack: ParenFrame[];
  // When true, the next digit/decimal press starts a new number instead
  // of appending to the one on screen (e.g. right after an operator,
  // a result, or an error).
  overwrite: boolean;
  // The live result of the *entire* expression typed so far — including
  // any enclosing groups — refreshed on every digit/decimal press (and
  // whenever a term is committed). null until there's something to
  // preview.
  preview: number | null;
  // Set once "=" succeeds; while set, the UI shows this as the big
  // number instead of the expression/preview.
  finalResult: number | null;
  error: string | null;
  // Only true while committing a term (operator, "=", or ")" that needs
  // a backend call) — never while a live-preview request is in flight,
  // so typing itself never feels blocked.
  isLoading: boolean;
}

const initialState: State = {
  currentInput: "0",
  currentInputLabel: null,
  pendingSqrt: false,
  pendingNegative: false,
  terms: [],
  operators: [],
  termLabels: [],
  parenStack: [],
  overwrite: true,
  preview: null,
  finalResult: null,
  error: null,
  isLoading: false,
};

// Like formatResult, but keeps a plain ASCII "-" instead of the
// Unicode minus sign. Used specifically for state.currentInput, which
// gets re-parsed via parseFloat elsewhere (e.g. the next operator
// pressed on a term restored from a closed group, a resolved √, or a
// backspace-undo) — parseFloat doesn't recognize "−" as a valid sign,
// so a Unicode-minus string silently parses to NaN. formatResult's
// Unicode minus is reserved for text that's only ever displayed, never
// parsed back: the visible expression, a group's literal label, the
// final result.
function numberToInputString(value: number): string {
  return Number.isFinite(value) ? Number(value.toPrecision(10)).toString() : String(value);
}

// Shared by the reducer (to compute its own next state) and the hook's
// input handlers (to know what to send to the live-preview request) so
// the "how does typing a digit change the current term" rule lives in
// exactly one place.
function appendDigit(currentInput: string, overwrite: boolean, digit: string): string {
  if (overwrite || currentInput === "0") {
    return digit;
  }
  return currentInput + digit;
}

function appendDecimal(currentInput: string, overwrite: boolean): string {
  if (overwrite) {
    return "0.";
  }
  return currentInput.includes(".") ? currentInput : currentInput + ".";
}

// Negates a resolved value (and, if it has one, prefixes its label)
// when a negative sign is pending — shared by every place that resolves
// "what's the current term worth" (resolveCurrentTerm, and the
// synchronous fast paths in chooseOperation/equals/closeParen that
// bypass it). A null label (an ordinary typed number) is left null:
// formatResult already renders the negated value with the correct sign,
// so there's nothing a label would add.
function applyPendingNegative(
  pendingNegative: boolean,
  value: number,
  label: string | null,
): { value: number; label: string | null } {
  if (!pendingNegative) {
    return { value, label };
  }
  return { value: -value, label: label !== null ? `−${label}` : null };
}

// What a level looks like right after committing one more term —
// returned by commitResolvedTerm/chooseOperation so a caller that needs
// the *result* (not just the side-effecting dispatch) can use it
// directly, instead of reading hook state that's still the pre-commit
// closure value at that point in the same call (see inputDigit's
// implicit-multiply case, for a digit typed right after a closed group).
interface CommittedLevel {
  terms: number[];
  operators: ChainableOperation[];
  termLabels: (string | null)[];
}

interface BackspaceResult {
  currentInput: string;
  currentInputLabel: string | null;
  pendingSqrt: boolean;
  pendingNegative: boolean;
  overwrite: boolean;
  terms: number[];
  operators: ChainableOperation[];
  termLabels: (string | null)[];
  parenStack: ParenFrame[];
}

// Computes what backspace should do next, so the reducer and the
// preview-refresh logic in the hook agree on exactly one rule: peel
// back whatever's "freshest" — a digit being typed, then a pending √
// prefix, then a pending negative sign, then the last committed
// term+operator, then step out of the current group. A closed group's
// (or resolved √'s) value is removed as one unit (not digit by digit
// back into it) since its original keystrokes aren't kept around
// separately from its literal label.
function computeBackspace(state: State): BackspaceResult {
  const {
    currentInput,
    currentInputLabel,
    pendingSqrt,
    pendingNegative,
    overwrite,
    terms,
    operators,
    termLabels,
    parenStack,
  } = state;

  if (currentInputLabel !== null) {
    return {
      currentInput: "0",
      currentInputLabel: null,
      pendingSqrt: false,
      pendingNegative: false,
      overwrite: true,
      terms,
      operators,
      termLabels,
      parenStack,
    };
  }

  if (!overwrite) {
    const trimmed = currentInput.slice(0, -1);
    return trimmed === ""
      ? {
          currentInput: "0",
          currentInputLabel: null,
          pendingSqrt,
          pendingNegative,
          overwrite: true,
          terms,
          operators,
          termLabels,
          parenStack,
        }
      : {
          currentInput: trimmed,
          currentInputLabel: null,
          pendingSqrt,
          pendingNegative,
          overwrite: false,
          terms,
          operators,
          termLabels,
          parenStack,
        };
  }

  if (pendingSqrt) {
    return {
      currentInput,
      currentInputLabel,
      pendingSqrt: false,
      pendingNegative,
      overwrite,
      terms,
      operators,
      termLabels,
      parenStack,
    };
  }

  if (pendingNegative) {
    return {
      currentInput,
      currentInputLabel,
      pendingSqrt,
      pendingNegative: false,
      overwrite,
      terms,
      operators,
      termLabels,
      parenStack,
    };
  }

  // A negative power base ("−2^…") is stored as a synthetic leading
  // "0, subtract" pair ahead of the real (positive) base — see
  // chooseOperation's COMMIT_NEGATIVE_POWER_BASE branch for why.
  // Backspacing out of the exponent should undo that whole pair as one
  // step, landing back on a pending sign over the base ("−2"), not
  // surface the synthetic 0 as if it were a real, editable term.
  const isSyntheticNegativePowerBase =
    operators.length === 2 && operators[0] === "subtract" && termLabels[0] === "" && terms[0] === 0;
  if (isSyntheticNegativePowerBase) {
    return {
      currentInput: numberToInputString(terms[1]),
      currentInputLabel: termLabels[1],
      pendingSqrt: false,
      pendingNegative: true,
      overwrite: false,
      terms: [],
      operators: [],
      termLabels: [],
      parenStack,
    };
  }

  if (operators.length > 0) {
    return {
      currentInput: numberToInputString(terms[terms.length - 1]),
      currentInputLabel: termLabels[termLabels.length - 1],
      pendingSqrt: false,
      pendingNegative: false,
      overwrite: false,
      terms: terms.slice(0, -1),
      operators: operators.slice(0, -1),
      termLabels: termLabels.slice(0, -1),
      parenStack,
    };
  }

  if (parenStack.length > 0) {
    const frame = parenStack[parenStack.length - 1];
    return {
      currentInput: "0",
      currentInputLabel: null,
      pendingSqrt: false,
      pendingNegative: false,
      overwrite: true,
      terms: frame.terms,
      operators: frame.operators,
      termLabels: frame.termLabels,
      parenStack: parenStack.slice(0, -1),
    };
  }

  return {
    currentInput,
    currentInputLabel,
    pendingSqrt,
    pendingNegative,
    overwrite,
    terms,
    operators,
    termLabels,
    parenStack,
  };
}

type Action =
  | { type: "INPUT_DIGIT"; digit: string }
  | { type: "INPUT_DECIMAL" }
  | { type: "APPLY_BACKSPACE"; next: BackspaceResult }
  | { type: "CLEAR" }
  | { type: "PUSH_PENDING_SQRT" }
  | { type: "TOGGLE_PENDING_NEGATIVE" }
  | { type: "REPLACE_PENDING_OPERATOR"; operator: ChainableOperation }
  | { type: "COMMIT_NEGATIVE_POWER_BASE"; base: number }
  | { type: "OPEN_PAREN"; sqrtOnClose?: boolean }
  | {
      type: "CLOSE_PAREN";
      terms: number[];
      operators: ChainableOperation[];
      termLabels: (string | null)[];
      value: number;
      label: string;
    }
  | { type: "COMMIT_FIRST_OPERATOR"; terms: number[]; termLabels: (string | null)[]; operator: ChainableOperation }
  | {
      type: "OPERATOR_APPLIED";
      terms: number[];
      termLabels: (string | null)[];
      operator: ChainableOperation;
      result: number;
    }
  | { type: "EXPRESSION_FINALIZED"; result: number }
  | { type: "IMMEDIATE_APPLIED"; result: number; label: string | null }
  | { type: "PREVIEW_UPDATED"; result: number }
  | { type: "PREVIEW_CLEARED" }
  | { type: "CALCULATE_START" }
  | { type: "CALCULATE_ERROR"; message: string };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "INPUT_DIGIT": {
      if (state.finalResult !== null) {
        return { ...initialState, currentInput: action.digit, overwrite: false };
      }
      return {
        ...state,
        currentInput: appendDigit(state.currentInput, state.overwrite, action.digit),
        currentInputLabel: null,
        overwrite: false,
        error: null,
      };
    }

    case "INPUT_DECIMAL": {
      if (state.finalResult !== null) {
        return { ...initialState, currentInput: "0.", overwrite: false };
      }
      return {
        ...state,
        currentInput: appendDecimal(state.currentInput, state.overwrite),
        currentInputLabel: null,
        overwrite: false,
        error: null,
      };
    }

    // preview is deliberately cleared here (not merely left as-is): it
    // reflected whatever expression existed *before* the backspace,
    // which may no longer be the one on screen. A fresh one is
    // refreshed right after if there's still something to preview.
    case "APPLY_BACKSPACE":
      return { ...state, ...action.next, preview: null, error: null };

    case "CLEAR":
      return initialState;

    case "PUSH_PENDING_SQRT":
      return { ...state, pendingSqrt: true, error: null };

    case "TOGGLE_PENDING_NEGATIVE":
      return { ...state, pendingNegative: !state.pendingNegative, error: null };

    // Swaps the operator waiting for its operand without touching what's
    // already committed — pressing a different operator (chooseOperation
    // was pressed while nothing had been typed for the pending term yet,
    // except "−", which doubles as a sign instead) almost certainly means
    // "actually, I meant this one," not "commit a meaningless 0, then
    // also do this."
    case "REPLACE_PENDING_OPERATOR":
      return {
        ...state,
        operators: [...state.operators.slice(0, -1), action.operator],
        currentInput: "0",
        currentInputLabel: null,
        pendingSqrt: false,
        pendingNegative: false,
        overwrite: true,
        error: null,
      };

    // A negative number used as a power base ("−2^4") needs the sign to
    // apply *after* the power resolves, not to the base itself —
    // standard precedence: "−2^4" reads −(2^4) = −16, not (−2)^4 = 16
    // (which is what an explicitly parenthesized "(−2)^4" means
    // instead). There's no way to express "negate the result of just
    // this ^ pair" using the flat terms/operators array the backend's
    // tier evaluator already handles correctly, *except* by writing it
    // exactly the way the arithmetic itself would: "0 − 2^4" — power
    // still resolves before subtract, giving the right precedence for
    // free. termLabels[0] is "" (not null) specifically so it renders
    // as nothing rather than a literal "0" — renderTerms shows the
    // *label*, so the synthetic term stays invisible and only its
    // operator symbol ("−") shows, reproducing "−2^4" exactly as typed.
    case "COMMIT_NEGATIVE_POWER_BASE":
      return {
        ...state,
        terms: [0, action.base],
        operators: ["subtract", "power"],
        termLabels: ["", null],
        currentInput: "0",
        currentInputLabel: null,
        pendingSqrt: false,
        pendingNegative: false,
        overwrite: true,
        finalResult: null,
        isLoading: false,
        error: null,
      };

    case "OPEN_PAREN": {
      const base = state.finalResult !== null ? initialState : state;
      return {
        ...base,
        parenStack: [
          ...base.parenStack,
          {
            terms: base.terms,
            operators: base.operators,
            termLabels: base.termLabels,
            sqrtOnClose: action.sqrtOnClose ?? false,
          },
        ],
        terms: [],
        operators: [],
        termLabels: [],
        currentInput: "0",
        currentInputLabel: null,
        pendingSqrt: false,
        pendingNegative: false,
        overwrite: true,
        preview: null,
        error: null,
      };
    }

    // overwrite: true, same as COMMIT_FIRST_OPERATOR/OPERATOR_APPLIED/
    // IMMEDIATE_APPLIED — the closed group's value is a sealed term, not
    // raw digits a keystroke should extend. Previously left false here
    // by mistake: a digit typed right after closing a group (e.g. "2"
    // after "(9+1)") appended onto the group's own numeric value instead
    // of starting a fresh term, reading as "102" rather than "2" — the
    // same "start fresh" behavior a digit typed after a resolved √
    // already has.
    case "CLOSE_PAREN":
      return {
        ...state,
        terms: action.terms,
        operators: action.operators,
        termLabels: action.termLabels,
        parenStack: state.parenStack.slice(0, -1),
        currentInput: numberToInputString(action.value),
        currentInputLabel: action.label,
        pendingSqrt: false,
        pendingNegative: false,
        overwrite: true,
        isLoading: false,
        error: null,
      };

    // The very first operator in an expression (or group) has nothing
    // to combine with yet, so it's just remembered — no backend call.
    // This also covers continuing from a just-finalized result
    // (finalResult gets cleared here, transitioning back into "typing").
    case "COMMIT_FIRST_OPERATOR":
      return {
        ...state,
        terms: action.terms,
        termLabels: action.termLabels,
        operators: [action.operator],
        currentInput: "0",
        currentInputLabel: null,
        pendingSqrt: false,
        pendingNegative: false,
        overwrite: true,
        finalResult: null,
        isLoading: false,
        error: null,
      };

    // A later operator means the term just typed completes a pair the
    // backend can evaluate; the new operator starts waiting for the
    // next term. Preview isn't set from this action's own result: that
    // would be the *inner* level's value only, ignoring any enclosing
    // groups — chooseOperation refreshes it separately afterward with
    // the full nested value.
    case "OPERATOR_APPLIED":
      return {
        ...state,
        terms: action.terms,
        termLabels: action.termLabels,
        operators: [...state.operators, action.operator],
        currentInput: "0",
        currentInputLabel: null,
        pendingSqrt: false,
        pendingNegative: false,
        overwrite: true,
        isLoading: false,
      };

    // "=" evaluates the whole expression and starts fresh, keeping only
    // the result on screen so the user can continue chaining from it.
    case "EXPRESSION_FINALIZED":
      return { ...initialState, finalResult: action.result };

    // sqrt's postfix mode and percentage's in-place mode both land here:
    // the number on screen is replaced by the transform's result, with
    // an optional label (e.g. "√16") so sqrt's origin stays visible —
    // percentage passes label: null, since "9 × 0.45" already shows
    // exactly what will be multiplied without needing one.
    case "IMMEDIATE_APPLIED":
      return {
        ...state,
        currentInput: numberToInputString(action.result),
        currentInputLabel: action.label,
        pendingSqrt: false,
        pendingNegative: false,
        overwrite: true,
        finalResult: null,
        isLoading: false,
      };

    case "PREVIEW_UPDATED":
      return { ...state, preview: action.result };

    // A live-preview request resolved to nothing meaningful (e.g.
    // closing a bare, unenclosed group with nothing around it to
    // propagate through) — cleared quietly, as opposed to CALCULATE_ERROR
    // below, which is what an *invalid* live preview (e.g. a negative √
    // radicand, mid-typing) surfaces instead: those show the real error
    // message immediately, not just silently disappear, since — unlike
    // an in-progress division by zero that a few more digits could still
    // fix — a negative radicand only gets more invalid the more is typed.
    case "PREVIEW_CLEARED":
      return { ...state, preview: null };

    case "CALCULATE_START":
      return { ...state, isLoading: true, error: null };

    // Deliberately leaves currentInput/overwrite/pendingSqrt/
    // pendingNegative untouched: the term that caused the error (e.g.
    // the 0 in "9÷0") stays visible and editable — via backspace —
    // instead of being silently hidden, so the user can see exactly
    // what needs fixing.
    case "CALCULATE_ERROR":
      return { ...state, isLoading: false, error: action.message };

    default:
      return state;
  }
}

function toErrorMessage(err: unknown): string {
  if (err instanceof CalculatorApiError) {
    return err.message;
  }
  return "Unexpected error. Please try again.";
}

// Combines a value with one enclosing group's own terms/operators, then
// continues outward through however many more groups enclose *that* —
// e.g. typing "5" inside "9×(...)" propagates through exactly one
// frame; typing inside a doubly-nested group propagates through two.
// Frames with no operators of their own (a group opened as the very
// first keystroke, with nothing before it) just pass the value through
// unchanged — there's nothing there yet to combine it with. A frame
// queued for √ (see openParen) gets that applied *before* combining —
// e.g. typing "1" inside "√(−1×(1" needs √ applied to the −1×1 it's
// building toward, live, not just once the user explicitly closes both
// groups — a negative value here correctly rejects, surfacing as a
// preview error the same way any other invalid preview does.
async function propagateOutward(value: number, parenStack: ParenFrame[]): Promise<number> {
  let current = value;
  for (let i = parenStack.length - 1; i >= 0; i--) {
    const frame = parenStack[i];
    if (frame.sqrtOnClose) {
      current = await calculate("sqrt", [current]);
    }
    if (frame.operators.length === 0) {
      continue;
    }
    current = await evaluateExpression([...frame.terms, current], frame.operators);
  }
  return current;
}

// Combines a single resolved leaf value (e.g. a √ or in-place-% result,
// which hasn't been combined with anything yet) with the current level's
// own terms/operators, then propagates the result outward through every
// enclosing group. Shared by refreshPreview (which additionally resolves
// a pending √ on the raw input first) and refreshPreviewFromLeaf (which
// starts from a value that's already resolved).
async function evaluateAndPropagate(
  leaf: number,
  terms: number[],
  operators: ChainableOperation[],
  parenStack: ParenFrame[],
): Promise<number> {
  const levelValue = operators.length === 0 ? leaf : await evaluateExpression([...terms, leaf], operators);
  return propagateOutward(levelValue, parenStack);
}

// useCalculator owns all calculator state and talks to the backend for
// every actual computation. The user types a full expression, optionally
// with parenthesized groups (e.g. 5 + (2 * (3 + 1))) and √ prefixes
// (e.g. 9 + √9); the live preview reflects the *entire* expression —
// propagated outward through every enclosing group — on every keystroke,
// once there's an operator anywhere in the stack to combine with. Every
// request (preview, committing a term, closing a group, finalizing) is
// stamped with a monotonically increasing id; a response is only
// applied if it's still the most recent one issued, so a slow request
// from a few keystrokes ago can never clobber more recent state.
// Committing a term (operator, "=", ")") disables the keypad for its
// duration — see resolveCurrentTerm below — which doubles as the guard
// against that commit itself racing with newer typing.
export function useCalculator() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const requestIdRef = useRef(0);

  // The full live-preview pipeline for a term still being typed: resolve
  // any pending √ on the raw input, combine with the current level's own
  // terms/operators (if any), then propagate outward through every
  // enclosing group. Used by every digit/decimal keystroke and by
  // backspace — never by the "commit" paths (chooseOperation, equals,
  // closeParen), which already have an authoritative value in hand and
  // use refreshPreviewFromValue instead, to avoid re-evaluating it.
  const refreshPreview = useCallback(
    (
      rawInput: string,
      pendingSqrt: boolean,
      pendingNegative: boolean,
      terms: number[],
      operators: ChainableOperation[],
      parenStack: ParenFrame[],
    ) => {
      const requestId = ++requestIdRef.current;
      (async () => {
        let leaf = parseFloat(rawInput);
        // A pending sign negates the radicand, not the root's result —
        // "√" then "−" then "9" previews what sqrt(-9) would be (an
        // error, same as typing it in one shot), not -(√9). See
        // resolveCurrentTerm for the full reasoning.
        if (pendingSqrt) {
          leaf = await calculate("sqrt", [pendingNegative ? -leaf : leaf]);
        } else if (pendingNegative) {
          leaf = -leaf;
        }
        return evaluateAndPropagate(leaf, terms, operators, parenStack);
      })().then(
        (result) => {
          if (requestId === requestIdRef.current) {
            dispatch({ type: "PREVIEW_UPDATED", result });
          }
        },
        (err) => {
          if (requestId === requestIdRef.current) {
            dispatch({ type: "CALCULATE_ERROR", message: toErrorMessage(err) });
          }
        },
      );
    },
    [],
  );

  // Like refreshPreview, but starting from a leaf value that's already
  // been resolved (e.g. sqrt's postfix transform, or percentage's
  // in-place transform) rather than parsed from raw input — still needs
  // combining with the current level's own terms/operators before it can
  // propagate outward.
  const refreshPreviewFromLeaf = useCallback(
    (leaf: number, terms: number[], operators: ChainableOperation[], parenStack: ParenFrame[]) => {
      const requestId = ++requestIdRef.current;
      evaluateAndPropagate(leaf, terms, operators, parenStack).then(
        (result) => {
          if (requestId === requestIdRef.current) {
            dispatch({ type: "PREVIEW_UPDATED", result });
          }
        },
        (err) => {
          if (requestId === requestIdRef.current) {
            dispatch({ type: "CALCULATE_ERROR", message: toErrorMessage(err) });
          }
        },
      );
    },
    [],
  );

  // Like refreshPreview, but starting from a value that's already been
  // authoritatively computed for the *current level* (e.g. by
  // chooseOperation's own commit call), so it only needs to propagate
  // outward — not re-evaluate the current level from scratch.
  const refreshPreviewFromValue = useCallback((value: number, parenStack: ParenFrame[]) => {
    const requestId = ++requestIdRef.current;
    propagateOutward(value, parenStack).then(
      (result) => {
        if (requestId === requestIdRef.current) {
          dispatch({ type: "PREVIEW_UPDATED", result });
        }
      },
      (err) => {
        if (requestId === requestIdRef.current) {
          dispatch({ type: "CALCULATE_ERROR", message: toErrorMessage(err) });
        }
      },
    );
  }, []);

  const hasAnythingToPreview = state.pendingSqrt || state.operators.length > 0 || state.parenStack.length > 0;

  // Resolves what the term currently on screen is actually worth right
  // now — applying a pending √ prefix first, if one is active — so
  // every place that commits the current term (chooseOperation, equals,
  // closeParen, and openParen's implicit-multiply check) agrees on the
  // same value and the same display label.
  const resolveCurrentTerm = useCallback(async (): Promise<{ value: number; label: string | null }> => {
    if (state.finalResult !== null) {
      return { value: state.finalResult, label: null };
    }
    if (state.pendingSqrt) {
      // A pending sign negates the radicand — "√" then "−" then "9"
      // builds sqrt(-9), which correctly errors, the same as typing
      // "√-9" in a calculator with a ± key would — not -(√9). "−" is
      // the only way to type a negative number at all here, so it has
      // to attach to the number actually being typed (what's under the
      // root), not to a result that doesn't exist yet.
      const radicand = state.pendingNegative ? -parseFloat(state.currentInput) : parseFloat(state.currentInput);
      const value = await calculate("sqrt", [radicand]);
      const label = `√${state.pendingNegative ? "−" : ""}${state.currentInput}`;
      return { value, label };
    }
    return applyPendingNegative(state.pendingNegative, parseFloat(state.currentInput), state.currentInputLabel);
  }, [
    state.finalResult,
    state.pendingSqrt,
    state.pendingNegative,
    state.currentInput,
    state.currentInputLabel,
  ]);

  // "25%" then "=" (or ")"), with nothing typed for %'s second operand.
  // Chained percentage needs a real one ("50% of 10"), but used bare
  // it's dangling — finalizing normally would send a phantom 0 as that
  // operand ("25% of 0" = 0), not "just 25%". True for both equals and
  // closeParen, so it's computed once and shared.
  const isBareTrailingPercentage =
    state.finalResult === null &&
    !state.pendingSqrt &&
    state.overwrite &&
    state.currentInput === "0" &&
    state.currentInputLabel === null &&
    !state.pendingNegative &&
    state.operators.at(-1) === "percentage";

  // Resolves a dangling trailing "%" by treating it as already resolved
  // in place — the same fixed second operand (1) applyPercentage's own
  // in-place mode already uses, for the same reason — combined with
  // whatever terms/operators came before it, if any (e.g. "9+25%" reads
  // as 9 + 0.25).
  const resolveBareTrailingPercentage = useCallback(async (): Promise<number> => {
    const lastIndex = state.operators.length - 1;
    const resolvedTerm = await calculate("percentage", [state.terms[lastIndex], 1]);
    const remainingTerms = state.terms.slice(0, lastIndex);
    const remainingOperators = state.operators.slice(0, lastIndex);
    return remainingOperators.length === 0
      ? resolvedTerm
      : evaluateExpression([...remainingTerms, resolvedTerm], remainingOperators);
  }, [state.terms, state.operators]);

  // Commits a resolved term (value + optional label) as the operand for
  // `operator`. Split out of chooseOperation so the common case — no
  // pending √ to resolve — can skip straight here without an extra
  // microtask turn first (see chooseOperation below for why that gap
  // matters). Returns the committed level, or null if the commit failed
  // (the error is already dispatched either way).
  const commitResolvedTerm = useCallback(
    async (
      operator: ChainableOperation,
      value: number,
      label: string | null,
    ): Promise<CommittedLevel | null> => {
      const newTerms = [...state.terms, value];
      const newTermLabels = [...state.termLabels, label];
      const newOperators = [...state.operators, operator];

      if (state.operators.length === 0) {
        requestIdRef.current++;
        dispatch({ type: "COMMIT_FIRST_OPERATOR", terms: newTerms, termLabels: newTermLabels, operator });
        return { terms: newTerms, operators: newOperators, termLabels: newTermLabels };
      }

      const requestId = ++requestIdRef.current;
      dispatch({ type: "CALCULATE_START" });
      try {
        const result = await evaluateExpression(newTerms, state.operators);
        if (requestId === requestIdRef.current) {
          dispatch({ type: "OPERATOR_APPLIED", terms: newTerms, termLabels: newTermLabels, operator, result });
          refreshPreviewFromValue(result, state.parenStack);
        }
        return { terms: newTerms, operators: newOperators, termLabels: newTermLabels };
      } catch (err) {
        if (requestId === requestIdRef.current) {
          dispatch({ type: "CALCULATE_ERROR", message: toErrorMessage(err) });
        }
        return null;
      }
    },
    [state.terms, state.termLabels, state.operators, state.parenStack, refreshPreviewFromValue],
  );

  const chooseOperation = useCallback(
    async (operator: ChainableOperation): Promise<CommittedLevel | null> => {
      // Nothing has been typed yet for the term this operator would
      // apply to. "−" here is the only way to type a negative number
      // (there's no dedicated ± key), so it doubles as a sign instead of
      // committing a meaningless 0 and starting yet another subtraction
      // — e.g. "4×" then "−" then "4" means 4×(−4), not "4×0−4". Also
      // true with a √ prefix already pending ("√" then "−" then "4"
      // means √(−4), an error — not √0 subtract 4): the sign still
      // attaches to whatever's about to be typed, √ or no √.
      const canToggleNegativeSign =
        state.finalResult === null &&
        state.overwrite &&
        state.currentInput === "0" &&
        state.currentInputLabel === null;

      if (canToggleNegativeSign) {
        if (operator === "subtract") {
          dispatch({ type: "TOGGLE_PENDING_NEGATIVE" });
          return null;
        }
        if (state.operators.length > 0) {
          dispatch({ type: "REPLACE_PENDING_OPERATOR", operator });
          return null;
        }
        // No pending operator to replace (this is the very first
        // keystroke, or right after "("/a result) — falls through to
        // the commit path below, unaffected.
      }

      // The base of a power is fully typed (pendingNegative, but no
      // longer "fresh" — canToggleNegativeSign above already handles
      // the fresh/toggle case) and "^" is the very first operator for
      // this level. See COMMIT_NEGATIVE_POWER_BASE for why this needs
      // its own path instead of the usual commit. Doesn't apply with a
      // √ prefix also pending — that's a negative *radicand* instead
      // (resolveCurrentTerm handles it), a different combination
      // entirely from a plain negative power base.
      if (
        state.finalResult === null &&
        !state.pendingSqrt &&
        state.pendingNegative &&
        state.operators.length === 0 &&
        operator === "power"
      ) {
        const base = parseFloat(state.currentInput);
        requestIdRef.current++;
        dispatch({ type: "COMMIT_NEGATIVE_POWER_BASE", base });
        return { terms: [0, base], operators: ["subtract", "power"], termLabels: ["", null] };
      }

      // Nothing needs resolving over the network here — commit
      // synchronously. This matters: routing every operator press
      // through `await resolveCurrentTerm()` (an async function call,
      // which always costs at least one microtask turn even when it has
      // nothing to await) opens a brief gap where fast keyboard input
      // can outrun the resulting re-render, e.g. typing "9-3" fast
      // enough for the "3" to land before isLoading has flipped back to
      // false.
      if (!state.pendingSqrt) {
        const { value, label } =
          state.finalResult !== null
            ? { value: state.finalResult, label: null }
            : applyPendingNegative(state.pendingNegative, parseFloat(state.currentInput), state.currentInputLabel);
        return commitResolvedTerm(operator, value, label);
      }

      const requestId = ++requestIdRef.current;
      dispatch({ type: "CALCULATE_START" });

      let resolved: { value: number; label: string | null };
      try {
        resolved = await resolveCurrentTerm();
      } catch (err) {
        if (requestId === requestIdRef.current) {
          dispatch({ type: "CALCULATE_ERROR", message: toErrorMessage(err) });
        }
        return null;
      }
      if (requestId !== requestIdRef.current) {
        return null;
      }

      return commitResolvedTerm(operator, resolved.value, resolved.label);
    },
    [
      state.finalResult,
      state.overwrite,
      state.pendingSqrt,
      state.pendingNegative,
      state.currentInput,
      state.currentInputLabel,
      state.operators,
      resolveCurrentTerm,
      commitResolvedTerm,
    ],
  );

  // A closed group's label always reads "(...)" (see closeParen); a
  // resolved √'s always reads "√...". Only a closed group should trigger
  // the implicit-× treatment below — a resolved √ deliberately keeps its
  // existing "start fresh, clear the label" behavior instead (see the
  // "still lets a digit typed afterward start a fresh number, clearing
  // the √ label" test).
  const isClosedGroupLabel = state.currentInputLabel !== null && state.currentInputLabel.startsWith("(");

  const inputDigit = useCallback(
    (digit: string) => {
      // A closed group's value (e.g. "(9+3)") is showing — a digit here
      // means "multiply by a new term", the same implicit-× convention
      // openParen already uses for "(": without this, the digit would
      // either replace the group entirely (losing "(9+3)" from the
      // expression) or, before that, concatenate onto its numeric value
      // ("(9+3)" + "4" reading as 94). Not awaited — same reason as
      // applySqrt's own backend call: this needs to stay synchronous
      // (void, not a Promise), since it's called directly from a
      // keydown/onClick handler and from `act()` in tests without
      // awaiting it.
      if (state.finalResult === null && isClosedGroupLabel) {
        chooseOperation("multiply").then((committed) => {
          if (committed === null) {
            return;
          }
          dispatch({ type: "INPUT_DIGIT", digit });
          // state.parenStack is untouched by an implicit multiply (only
          // openParen/closeParen change it), so the pre-commit closure
          // value is still accurate here — unlike terms/operators,
          // which commitResolvedTerm's return value provides instead of
          // relying on (still stale, by the time this runs) hook state.
          refreshPreview(digit, false, false, committed.terms, committed.operators, state.parenStack);
        });
        return;
      }

      dispatch({ type: "INPUT_DIGIT", digit });

      if (state.finalResult === null && hasAnythingToPreview) {
        const newInput = appendDigit(state.currentInput, state.overwrite, digit);
        refreshPreview(
          newInput,
          state.pendingSqrt,
          state.pendingNegative,
          state.terms,
          state.operators,
          state.parenStack,
        );
      }
    },
    [
      state.finalResult,
      isClosedGroupLabel,
      hasAnythingToPreview,
      state.currentInput,
      state.overwrite,
      state.pendingSqrt,
      state.pendingNegative,
      state.terms,
      state.operators,
      state.parenStack,
      chooseOperation,
      refreshPreview,
    ],
  );

  const inputDecimal = useCallback(() => {
    // Same reasoning as inputDigit: a closed group's value can't be
    // extended by "."; treat it as the start of a new term multiplied
    // in, keeping the group visible.
    if (state.finalResult === null && isClosedGroupLabel) {
      chooseOperation("multiply").then((committed) => {
        if (committed === null) {
          return;
        }
        dispatch({ type: "INPUT_DECIMAL" });
        // The reducer starts the fresh term from "0" (overwrite: true),
        // same input appendDecimal would see for any other fresh term.
        refreshPreview(appendDecimal("0", true), false, false, committed.terms, committed.operators, state.parenStack);
      });
      return;
    }

    dispatch({ type: "INPUT_DECIMAL" });

    if (state.finalResult === null && hasAnythingToPreview) {
      const newInput = appendDecimal(state.currentInput, state.overwrite);
      refreshPreview(
        newInput,
        state.pendingSqrt,
        state.pendingNegative,
        state.terms,
        state.operators,
        state.parenStack,
      );
    }
  }, [
    state.finalResult,
    isClosedGroupLabel,
    hasAnythingToPreview,
    state.currentInput,
    state.overwrite,
    state.pendingSqrt,
    state.pendingNegative,
    state.terms,
    state.operators,
    state.parenStack,
    chooseOperation,
    refreshPreview,
  ]);

  const backspace = useCallback(() => {
    if (state.finalResult !== null) {
      return;
    }

    const next = computeBackspace(state);
    dispatch({ type: "APPLY_BACKSPACE", next });

    // Matches hasAnythingToPreview's own rule: a bare pending negative
    // sign alone doesn't warrant a preview call any more than a bare
    // plain number does (no backend computation is needed to know what
    // "−4" or "4" is worth) — only pendingSqrt actually needs one.
    if (next.pendingSqrt || next.operators.length > 0 || next.parenStack.length > 0) {
      refreshPreview(
        next.currentInput,
        next.pendingSqrt,
        next.pendingNegative,
        next.terms,
        next.operators,
        next.parenStack,
      );
    }
  }, [state, refreshPreview]);

  const openParen = useCallback(async () => {
    // Right after a result, "(" always starts fresh — same convention as
    // typing a digit there (an operator is what continues from a result;
    // see chooseOperation).
    if (state.finalResult !== null) {
      dispatch({ type: "OPEN_PAREN" });
      return;
    }

    // "√" then "(" with nothing typed for the radicand yet: the group
    // about to open *is* the radicand — √ applies to its value once it
    // closes (see closeParen/finishClosingParen), not to today's
    // placeholder "0" the way pressing any other key here would (that
    // used to send a real sqrt(0) call and multiply by the new group,
    // e.g. "√0×(...").
    const isPendingSqrtFresh =
      state.pendingSqrt &&
      state.overwrite &&
      state.currentInput === "0" &&
      state.currentInputLabel === null &&
      !state.pendingNegative;
    if (isPendingSqrtFresh) {
      dispatch({ type: "OPEN_PAREN", sqrtOnClose: true });
      return;
    }

    const isFreshTerm =
      state.overwrite && state.currentInput === "0" && state.currentInputLabel === null && !state.pendingSqrt;
    if (!isFreshTerm) {
      // A number (or a just-closed group, or a resolved √) is already
      // sitting here, e.g. "9(" or "(2+3)(" — treated as multiplication,
      // exactly as if × had been pressed explicitly, before the new
      // group opens.
      await chooseOperation("multiply");
    }

    dispatch({ type: "OPEN_PAREN" });
  }, [
    state.finalResult,
    state.overwrite,
    state.currentInput,
    state.currentInputLabel,
    state.pendingSqrt,
    state.pendingNegative,
    chooseOperation,
  ]);

  // Finishes closing the current group given its resolved value+label:
  // builds the group's literal text, restores the outer terms/operators,
  // and refreshes the preview. Shared by closeParen's two paths below.
  const finishClosingParen = useCallback(
    async (value: number, label: string | null, requestId: number) => {
      const frame = state.parenStack[state.parenStack.length - 1];
      // "√(" queued a root to apply to this exact group — captured in
      // the display too: "√(9×√9)", the same "√" prefix the user typed
      // before the "(", not folded into the parens.
      const sqrtPrefix = frame.sqrtOnClose ? "√" : "";
      // Captured now, from the same value/label just resolved: the
      // literal text of everything typed inside this group, e.g.
      // "(9×√9)" — this is what stays on screen once the group closes,
      // instead of collapsing to just its computed value.
      const groupLabel = `${sqrtPrefix}(${renderLevel({
        terms: state.terms,
        operators: state.operators,
        termLabels: state.termLabels,
        currentInput: formatResult(value),
        currentInputLabel: label,
        pendingSqrt: false,
        pendingNegative: false,
        overwrite: false,
      })})`;

      const finish = async (innerValue: number) => {
        // The group's own value resolves first; √, if queued, applies
        // to *that* — √(3×3) = √9 = 3, not something touched mid-way.
        // A negative value here correctly errors, same as typing a
        // negative radicand directly (resolveCurrentTerm).
        let finalValue = innerValue;
        if (frame.sqrtOnClose) {
          try {
            finalValue = await calculate("sqrt", [innerValue]);
          } catch (err) {
            if (requestId === requestIdRef.current) {
              dispatch({ type: "CALCULATE_ERROR", message: toErrorMessage(err) });
            }
            return;
          }
          if (requestId !== requestIdRef.current) {
            return;
          }
        }

        dispatch({
          type: "CLOSE_PAREN",
          terms: frame.terms,
          operators: frame.operators,
          termLabels: frame.termLabels,
          value: finalValue,
          label: groupLabel,
        });
        // Only worth a preview if there's actually an enclosing operator
        // or a further-out group to combine with — closing a bare,
        // top-level "(...)" has nothing around it to propagate through,
        // and dispatching one anyway would just echo the same number
        // back as a "preview" of itself, left stale on screen (and
        // never cleared) once the next digit starts a fresh term.
        if (frame.operators.length > 0 || state.parenStack.length > 1) {
          // frame's own √, if it had one, was just applied above to get
          // finalValue — propagateOutward would otherwise apply it
          // *again* while combining with this same frame (it doesn't
          // know it was already handled), squaring the root by mistake.
          const parenStackForPreview = frame.sqrtOnClose
            ? [...state.parenStack.slice(0, -1), { ...frame, sqrtOnClose: false }]
            : state.parenStack;
          refreshPreviewFromValue(finalValue, parenStackForPreview);
        } else {
          dispatch({ type: "PREVIEW_CLEARED" });
        }
      };

      if (state.operators.length === 0) {
        await finish(value);
        return;
      }

      try {
        const result = await evaluateExpression([...state.terms, value], state.operators);
        if (requestId === requestIdRef.current) {
          await finish(result);
        }
      } catch (err) {
        if (requestId === requestIdRef.current) {
          dispatch({ type: "CALCULATE_ERROR", message: toErrorMessage(err) });
        }
      }
    },
    [state.terms, state.operators, state.termLabels, state.parenStack, refreshPreviewFromValue],
  );

  const closeParen = useCallback(async () => {
    if (state.parenStack.length === 0) {
      return;
    }

    if (isBareTrailingPercentage) {
      const requestId = ++requestIdRef.current;
      dispatch({ type: "CALCULATE_START" });
      const frame = state.parenStack[state.parenStack.length - 1];
      // Nothing was typed for %'s second operand, so the group's
      // literal text is just whatever's already on screen — "(25%)",
      // not "(25%1)" — built straight from the raw, untouched state
      // (renderLevel already knows to hide an untouched trailing
      // placeholder). Same "√(" prefix as finishClosingParen if one's
      // queued for this group — "√(25%)".
      const groupLabel = `${frame.sqrtOnClose ? "√" : ""}(${renderLevel({
        terms: state.terms,
        operators: state.operators,
        termLabels: state.termLabels,
        currentInput: state.currentInput,
        currentInputLabel: state.currentInputLabel,
        pendingSqrt: false,
        pendingNegative: false,
        overwrite: state.overwrite,
      })})`;
      try {
        const resolved = await resolveBareTrailingPercentage();
        const value = frame.sqrtOnClose ? await calculate("sqrt", [resolved]) : resolved;
        if (requestId === requestIdRef.current) {
          dispatch({
            type: "CLOSE_PAREN",
            terms: frame.terms,
            operators: frame.operators,
            termLabels: frame.termLabels,
            value,
            label: groupLabel,
          });
          if (frame.operators.length > 0 || state.parenStack.length > 1) {
            // Same reasoning as finishClosingParen: frame's own √, if
            // any, was already applied above to get value.
            const parenStackForPreview = frame.sqrtOnClose
              ? [...state.parenStack.slice(0, -1), { ...frame, sqrtOnClose: false }]
              : state.parenStack;
            refreshPreviewFromValue(value, parenStackForPreview);
          } else {
            dispatch({ type: "PREVIEW_CLEARED" });
          }
        }
      } catch (err) {
        if (requestId === requestIdRef.current) {
          dispatch({ type: "CALCULATE_ERROR", message: toErrorMessage(err) });
        }
      }
      return;
    }

    // See chooseOperation for why the pendingSqrt check matters: it
    // skips an unnecessary microtask turn for the common case.
    if (!state.pendingSqrt) {
      const requestId = ++requestIdRef.current;
      dispatch({ type: "CALCULATE_START" });
      const { value, label } = applyPendingNegative(
        state.pendingNegative,
        parseFloat(state.currentInput),
        state.currentInputLabel,
      );
      await finishClosingParen(value, label, requestId);
      return;
    }

    const requestId = ++requestIdRef.current;
    dispatch({ type: "CALCULATE_START" });

    let resolved: { value: number; label: string | null };
    try {
      resolved = await resolveCurrentTerm();
    } catch (err) {
      if (requestId === requestIdRef.current) {
        dispatch({ type: "CALCULATE_ERROR", message: toErrorMessage(err) });
      }
      return;
    }
    if (requestId !== requestIdRef.current) {
      return;
    }

    await finishClosingParen(resolved.value, resolved.label, requestId);
  }, [
    state.parenStack,
    state.pendingSqrt,
    state.pendingNegative,
    state.currentInput,
    state.currentInputLabel,
    state.terms,
    state.operators,
    state.termLabels,
    state.overwrite,
    isBareTrailingPercentage,
    resolveBareTrailingPercentage,
    refreshPreviewFromValue,
    resolveCurrentTerm,
    finishClosingParen,
  ]);

  // Resolves the current term all the way out to a single number: the
  // innermost level first (bare trailing "%", a pending √, a pending
  // sign, or just a plain number — whichever applies), then walks
  // outward through every still-open group, applying any √ queued for
  // it before folding it into whatever encloses *that*. Used only by
  // equals — closeParen closes one level at a time instead (via
  // finishClosingParen), since each group's own literal text needs to
  // stay visible rather than collapsing straight to a final number.
  const resolveFullyForFinalize = useCallback(async (): Promise<number> => {
    let current: number;
    if (isBareTrailingPercentage) {
      current = await resolveBareTrailingPercentage();
    } else {
      const resolved = await resolveCurrentTerm();
      current =
        state.operators.length === 0
          ? resolved.value
          : await evaluateExpression([...state.terms, resolved.value], state.operators);
    }

    for (let i = state.parenStack.length - 1; i >= 0; i--) {
      const frame = state.parenStack[i];
      if (frame.sqrtOnClose) {
        current = await calculate("sqrt", [current]);
      }
      if (frame.operators.length > 0) {
        current = await evaluateExpression([...frame.terms, current], frame.operators);
      }
    }

    return current;
  }, [
    isBareTrailingPercentage,
    resolveBareTrailingPercentage,
    resolveCurrentTerm,
    state.terms,
    state.operators,
    state.parenStack,
  ]);

  const equals = useCallback(async () => {
    // Nothing pending anywhere — a bare number sitting on screen, or
    // right after a previous result — has nothing to finalize.
    if (state.operators.length === 0 && state.parenStack.length === 0) {
      return;
    }

    const requestId = ++requestIdRef.current;
    dispatch({ type: "CALCULATE_START" });
    try {
      // Auto-closes every group still open at every level along the
      // way — "=" (or Enter) should always produce a result or a clear
      // error, never just sit there because a ")" was never typed (the
      // live preview already shows what it *would* be; this is what
      // actually commits it so the answer is usable for another
      // operation, the same as pressing "=" on any other expression).
      const result = await resolveFullyForFinalize();
      if (requestId === requestIdRef.current) {
        dispatch({ type: "EXPRESSION_FINALIZED", result });
      }
    } catch (err) {
      if (requestId === requestIdRef.current) {
        dispatch({ type: "CALCULATE_ERROR", message: toErrorMessage(err) });
      }
    }
  }, [state.operators, state.parenStack, resolveFullyForFinalize]);

  // sqrt is dual-mode, matching the two orders a person actually types
  // it in:
  // - Postfix (number first): with something already on screen, √
  //   transforms it immediately in place — "16" then √ becomes "√16" —
  //   wrapping whatever was already showing (a plain number, or another
  //   label, so √ of a closed group reads "√(2+3)", and this composes
  //   with itself: a second √ on "√9" becomes "√√9").
  // - Prefix (√ first): with nothing typed yet for the current term, √
  //   just marks that the next digits typed go under a root — the
  //   number itself is resolved later, by resolveCurrentTerm, at
  //   whichever commit point comes next (an operator, "=", or ")").
  const applySqrt = useCallback(() => {
    const isFreshTerm =
      state.finalResult === null &&
      state.overwrite &&
      state.currentInput === "0" &&
      state.currentInputLabel === null;
    if (isFreshTerm) {
      dispatch({ type: "PUSH_PENDING_SQRT" });
      return;
    }

    const { value, label: innerLabel } =
      state.finalResult !== null
        ? { value: state.finalResult, label: formatResult(state.finalResult) }
        : applyPendingNegative(
            state.pendingNegative,
            parseFloat(state.currentInput),
            state.currentInputLabel ?? state.currentInput,
          );
    const label = `√${innerLabel}`;

    const requestId = ++requestIdRef.current;
    dispatch({ type: "CALCULATE_START" });
    calculate("sqrt", [value]).then(
      (result) => {
        if (requestId === requestIdRef.current) {
          dispatch({ type: "IMMEDIATE_APPLIED", result, label });
          // result is just this term's own value — still needs combining
          // with the current level's terms/operators (e.g. the "9×" in
          // "9×√16") before it can propagate outward, hence
          // refreshPreviewFromLeaf rather than refreshPreviewFromValue.
          // Only worth it if there's actually an enclosing operator or
          // group to combine with, though — a bare "√16" has nothing to
          // propagate through, and dispatching one anyway would just
          // echo "4" back as a "preview" of itself, left stale on
          // screen (the exposed `preview` state is not otherwise
          // cleared by digit/decimal input) once the next digit starts
          // a fresh term.
          if (state.operators.length > 0 || state.parenStack.length > 0) {
            refreshPreviewFromLeaf(result, state.terms, state.operators, state.parenStack);
          } else {
            dispatch({ type: "PREVIEW_CLEARED" });
          }
        }
      },
      (err) => {
        if (requestId === requestIdRef.current) {
          dispatch({ type: "CALCULATE_ERROR", message: toErrorMessage(err) });
        }
      },
    );
  }, [
    state.finalResult,
    state.overwrite,
    state.currentInput,
    state.currentInputLabel,
    state.pendingNegative,
    state.terms,
    state.operators,
    state.parenStack,
    refreshPreviewFromLeaf,
  ]);

  // "%" is dual-mode too, matching how physical calculators use it:
  // - Nothing pending yet (operators.length === 0): it behaves as the
  //   "percent of" operator, e.g. typing 50, then %, then 10 computes
  //   50% of 10 = 5 — the same chaining flow as +, ×, etc.
  // - A pending operator already exists: it transforms the number being
  //   typed in place, e.g. "9 × 45%" becomes "9 × 0.45" — because at
  //   that point "45% of ???" has no second number to apply to yet, and
  //   treating it as a plain value/100 conversion is what every
  //   physical calculator does here. Unlike sqrt, this doesn't get its
  //   own display label — "9 × 0.45" already shows exactly what will be
  //   multiplied, so a label would be redundant.
  const applyPercentage = useCallback(async () => {
    if (state.operators.length === 0) {
      await chooseOperation("percentage");
      return;
    }

    const requestId = ++requestIdRef.current;
    dispatch({ type: "CALCULATE_START" });
    try {
      const input = state.pendingNegative ? -parseFloat(state.currentInput) : parseFloat(state.currentInput);
      const result = await calculate("percentage", [input, 1]);
      if (requestId === requestIdRef.current) {
        dispatch({ type: "IMMEDIATE_APPLIED", result, label: null });
        // Same reasoning as applySqrt: result is just this term's own
        // value (e.g. the 0.45 in "9×45%"), not yet combined with the
        // pending "9×".
        refreshPreviewFromLeaf(result, state.terms, state.operators, state.parenStack);
      }
    } catch (err) {
      if (requestId === requestIdRef.current) {
        dispatch({ type: "CALCULATE_ERROR", message: toErrorMessage(err) });
      }
    }
  }, [
    state.operators,
    state.currentInput,
    state.pendingNegative,
    state.terms,
    state.parenStack,
    chooseOperation,
    refreshPreviewFromLeaf,
  ]);

  const clear = useCallback(() => dispatch({ type: "CLEAR" }), []);

  // Physical keyboard support: the calculator has no other focusable
  // controls competing for input, so a single window-level listener is
  // enough. Disabled while a commit is in flight, mirroring the
  // on-screen keypad's disabled state.
  useEffect(() => {
    if (state.isLoading) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key >= "0" && event.key <= "9") {
        inputDigit(event.key);
        return;
      }
      switch (event.key) {
        case ".":
          inputDecimal();
          break;
        case "+":
          void chooseOperation("add");
          break;
        case "-":
          void chooseOperation("subtract");
          break;
        case "*":
        case "x":
        case "X":
          void chooseOperation("multiply");
          break;
        case "/":
          event.preventDefault();
          void chooseOperation("divide");
          break;
        case "^":
          void chooseOperation("power");
          break;
        case "%":
          void applyPercentage();
          break;
        case "(":
          void openParen();
          break;
        case ")":
          void closeParen();
          break;
        case "Enter":
        case "=":
          event.preventDefault();
          void equals();
          break;
        case "Backspace":
          backspace();
          break;
        case "Escape":
        case "Delete":
          clear();
          break;
        default:
          break;
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    state.isLoading,
    inputDigit,
    inputDecimal,
    chooseOperation,
    applyPercentage,
    openParen,
    closeParen,
    equals,
    backspace,
    clear,
  ]);

  return {
    // The full expression typed so far (e.g. "9×7+1-6÷6" or, with a
    // group, "5+(9×9)", or with a √ prefix, "9+√9"), shown as the
    // primary text while composing it.
    expression: buildExpressionText({
      parenStack: state.parenStack,
      terms: state.terms,
      operators: state.operators,
      termLabels: state.termLabels,
      currentInput: state.currentInput,
      currentInputLabel: state.currentInputLabel,
      pendingSqrt: state.pendingSqrt,
      pendingNegative: state.pendingNegative,
      overwrite: state.overwrite,
    }),
    // The live running total of the *whole* expression (including any
    // enclosing groups), shown as a small "= …" line below the
    // expression, hidden once "=" has produced a final result. Prefers
    // the propagated chain total (state.preview) when there's a pending
    // operator or group to combine with; otherwise, if the number on
    // screen has a label (e.g. "√9" or "(2+3)"), falls back to showing
    // its own value.
    preview:
      state.finalResult !== null
        ? null
        : state.preview !== null
          ? formatResult(state.preview)
          : state.currentInputLabel !== null
            ? toDisplayMinus(state.currentInput)
            : null,
    // Set once "=" succeeds; the UI shows this as the big number
    // instead of the expression.
    result: state.finalResult !== null ? formatResult(state.finalResult) : null,
    error: state.error,
    isLoading: state.isLoading,
    // The operator currently waiting for its next term, shown
    // highlighted on the keypad.
    activeOperation: state.operators.at(-1) ?? null,
    // True while a √ prefix is pending, so the √ key can show the same
    // "engaged" highlight a pending operator gets.
    sqrtPending: state.pendingSqrt,
    // True while a negative sign is pending, so the − key can show that
    // same "engaged" highlight — it's not acting as the subtract
    // operator right now.
    negativePending: state.pendingNegative,
    inputDigit,
    inputDecimal,
    backspace,
    clear,
    openParen,
    closeParen,
    chooseOperation,
    equals,
    applySqrt,
    applyPercentage,
  };
}
