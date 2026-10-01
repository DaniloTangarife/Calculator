import { describe, expect, it } from "vitest";
import { buildExpressionText, type ExpressionRenderState, type ParenFrame } from "./buildExpression";

function state(overrides: Partial<ExpressionRenderState>): ExpressionRenderState {
  return {
    parenStack: [],
    terms: [],
    operators: [],
    termLabels: [],
    currentInput: "0",
    currentInputLabel: null,
    pendingSqrt: false,
    pendingNegative: false,
    overwrite: true,
    ...overrides,
  };
}

describe("buildExpressionText", () => {
  it("shows the idle placeholder before anything is typed", () => {
    expect(buildExpressionText(state({}))).toBe("0");
  });

  it("shows the number being typed for the first term", () => {
    expect(buildExpressionText(state({ currentInput: "42", overwrite: false }))).toBe("42");
  });

  it("does not show a trailing 0 placeholder right after an operator", () => {
    expect(
      buildExpressionText(state({ terms: [9], operators: ["multiply"], termLabels: [null] })),
    ).toBe("9×");
  });

  it("shows a deliberately typed 0 for the next term", () => {
    expect(
      buildExpressionText(
        state({ terms: [9], operators: ["multiply"], termLabels: [null], overwrite: false }),
      ),
    ).toBe("9×0");
  });

  it("builds the full expression as each term is typed", () => {
    expect(
      buildExpressionText(
        state({
          terms: [9, 8],
          operators: ["add", "multiply"],
          termLabels: [null, null],
          currentInput: "8",
          overwrite: false,
        }),
      ),
    ).toBe("9+8×8");
  });

  it("reproduces the reference example: 9×7+1-6÷6", () => {
    expect(
      buildExpressionText(
        state({
          terms: [9, 7, 1, 6],
          operators: ["multiply", "add", "subtract", "divide"],
          termLabels: [null, null, null, null],
          currentInput: "6",
          overwrite: false,
        }),
      ),
    ).toBe("9×7+1−6÷6");
  });

  it("shows a closed group's literal contents, not its collapsed value", () => {
    expect(
      buildExpressionText(
        state({
          terms: [9],
          operators: ["add"],
          termLabels: [null],
          currentInput: "81",
          currentInputLabel: "(9×9)",
          overwrite: false,
        }),
      ),
    ).toBe("9+(9×9)");
  });

  it("shows a still-open group with a trailing ( and the idle placeholder inside", () => {
    const parenStack: ParenFrame[] = [{ terms: [9], operators: ["add"], termLabels: [null], sqrtOnClose: false }];
    expect(buildExpressionText(state({ parenStack }))).toBe("9+(0");
  });

  it("renders nested open groups, one ( per level, with literal content preserved", () => {
    const parenStack: ParenFrame[] = [
      { terms: [5], operators: ["add"], termLabels: [null], sqrtOnClose: false },
      { terms: [2], operators: ["multiply"], termLabels: [null], sqrtOnClose: false },
    ];
    expect(
      buildExpressionText(
        state({
          parenStack,
          terms: [3],
          operators: ["add"],
          termLabels: [null],
          currentInput: "1",
          overwrite: false,
        }),
      ),
    ).toBe("5+(2×(3+1");
  });

  it("keeps a previously closed group's literal text visible as a term inside another group", () => {
    const parenStack: ParenFrame[] = [{ terms: [5], operators: ["add"], termLabels: [null], sqrtOnClose: false }];
    expect(
      buildExpressionText(
        state({
          parenStack,
          terms: [2],
          operators: ["multiply"],
          termLabels: [null],
          currentInput: "4",
          currentInputLabel: "(3+1)",
          overwrite: false,
        }),
      ),
    ).toBe("5+(2×(3+1)");
  });

  it("shows a pending √ as a prefix over the idle placeholder", () => {
    expect(buildExpressionText(state({ pendingSqrt: true }))).toBe("√0");
  });

  it("shows a pending √ growing with each digit typed", () => {
    expect(buildExpressionText(state({ pendingSqrt: true, currentInput: "9", overwrite: false }))).toBe(
      "√9",
    );
  });

  it("shows a pending √ after a committed term too", () => {
    expect(
      buildExpressionText(
        state({ terms: [9], operators: ["add"], termLabels: [null], pendingSqrt: true }),
      ),
    ).toBe("9+√0");
  });

  it("shows a pending negative sign as a prefix over the idle placeholder", () => {
    expect(buildExpressionText(state({ pendingNegative: true }))).toBe("−0");
  });

  it("shows a pending negative sign growing with each digit typed", () => {
    expect(
      buildExpressionText(state({ pendingNegative: true, currentInput: "4", overwrite: false })),
    ).toBe("−4");
  });

  it("wraps a pending negative sign in parens once something precedes it, e.g. 4×(−4 while typing", () => {
    expect(
      buildExpressionText(
        state({
          terms: [4],
          operators: ["multiply"],
          termLabels: [null],
          pendingNegative: true,
          currentInput: "4",
          overwrite: false,
        }),
      ),
    ).toBe("4×(−4)");
  });

  it("wraps a committed negative term in parens, e.g. 4×(−4)×", () => {
    expect(
      buildExpressionText(
        state({ terms: [4, -4], operators: ["multiply", "multiply"], termLabels: [null, null] }),
      ),
    ).toBe("4×(−4)×");
  });

  it("shows a pending sign after a pending √, not before it — the radicand is negative, not the root: √−9", () => {
    expect(
      buildExpressionText(
        state({ pendingNegative: true, pendingSqrt: true, currentInput: "9", overwrite: false }),
      ),
    ).toBe("√−9");
  });

  it("shows a √ queued to apply to a still-open group", () => {
    const parenStack: ParenFrame[] = [
      { terms: [], operators: [], termLabels: [], sqrtOnClose: true },
    ];
    expect(buildExpressionText(state({ parenStack }))).toBe("√(0");
  });
});
