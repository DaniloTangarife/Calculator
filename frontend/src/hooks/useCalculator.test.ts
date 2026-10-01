import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useCalculator } from "./useCalculator";
import { CalculatorApiError, calculate, evaluateExpression } from "../services/calculatorApi";
import type { ChainableOperation } from "../types/calculator";

vi.mock("../services/calculatorApi", async () => {
  const actual = await vi.importActual<typeof import("../services/calculatorApi")>(
    "../services/calculatorApi",
  );
  return { ...actual, calculate: vi.fn(), evaluateExpression: vi.fn() };
});

const mockedCalculate = vi.mocked(calculate);
const mockedEvaluate = vi.mocked(evaluateExpression);

// Both mocks are shared module-level singletons across every test in this
// file; without resetting them, a failed assertion mid-test can leave
// queued mockResolvedValueOnce values unconsumed, which then leak into
// (and corrupt) the next test.
beforeEach(() => {
  mockedCalculate.mockReset();
  mockedEvaluate.mockReset();
});

// A real precedence evaluator, used as the mock's implementation so
// tests can assert on what the UI shows without having to predict the
// exact number/order of backend calls a given key sequence produces
// (typing now fires a live-preview call per keystroke on top of each
// operator's own authoritative call — an implementation detail these
// tests shouldn't be coupled to).
function realEvaluate(numbers: number[], operators: ChainableOperation[]): number {
  const apply = (a: number, op: ChainableOperation, b: number): number => {
    switch (op) {
      case "add":
        return a + b;
      case "subtract":
        return a - b;
      case "multiply":
        return a * b;
      case "divide":
        return a / b;
      case "power":
        return a ** b;
      case "percentage":
        return (a / 100) * b;
    }
  };

  const nums = [...numbers];
  const ops = [...operators];
  for (const tier of [["power"], ["multiply", "divide", "percentage"], ["add", "subtract"]] as const) {
    let i = 0;
    while (i < ops.length) {
      if ((tier as readonly string[]).includes(ops[i])) {
        nums[i] = apply(nums[i], ops[i], nums[i + 1]);
        nums.splice(i + 1, 1);
        ops.splice(i, 1);
      } else {
        i++;
      }
    }
  }
  return nums[0];
}

describe("useCalculator", () => {
  it("starts idle: expression '0', no preview, no result", () => {
    const { result } = renderHook(() => useCalculator());

    expect(result.current.expression).toBe("0");
    expect(result.current.preview).toBeNull();
    expect(result.current.result).toBeNull();
    expect(result.current.activeOperation).toBeNull();
  });

  it("builds the expression as digits are typed", () => {
    const { result } = renderHook(() => useCalculator());

    act(() => result.current.inputDigit("4"));
    act(() => result.current.inputDigit("2"));

    expect(result.current.expression).toBe("42");
  });

  it("only allows a single decimal point per term", () => {
    const { result } = renderHook(() => useCalculator());

    act(() => result.current.inputDigit("3"));
    act(() => result.current.inputDecimal());
    act(() => result.current.inputDigit("1"));
    act(() => result.current.inputDecimal());
    act(() => result.current.inputDigit("4"));

    expect(result.current.expression).toBe("3.14");
  });

  it("resets to idle on clear", () => {
    const { result } = renderHook(() => useCalculator());

    act(() => result.current.inputDigit("9"));
    act(() => result.current.clear());

    expect(result.current.expression).toBe("0");
    expect(result.current.activeOperation).toBeNull();
  });

  it("shows the operator in the expression without a trailing placeholder, and makes no backend call yet", async () => {
    const { result } = renderHook(() => useCalculator());

    act(() => result.current.inputDigit("9"));
    await act(async () => result.current.chooseOperation("add"));

    expect(mockedEvaluate).not.toHaveBeenCalled();
    expect(result.current.expression).toBe("9+");
    expect(result.current.preview).toBeNull();
    expect(result.current.activeOperation).toBe("add");
  });

  it("does nothing on equals when there is no pending operator", async () => {
    const { result } = renderHook(() => useCalculator());

    act(() => result.current.inputDigit("7"));
    await act(async () => result.current.equals());

    expect(mockedEvaluate).not.toHaveBeenCalled();
    expect(result.current.expression).toBe("7");
  });

  it("shows sqrt as '√9', not just the answer, with the value already previewed", async () => {
    mockedCalculate.mockResolvedValueOnce(4);
    const { result } = renderHook(() => useCalculator());

    act(() => result.current.inputDigit("1"));
    act(() => result.current.inputDigit("6"));
    await act(async () => result.current.applySqrt());

    expect(mockedCalculate).toHaveBeenCalledWith("sqrt", [16]);
    expect(result.current.expression).toBe("√16");
    expect(result.current.preview).toBe("4");
  });

  it("wraps whatever was already on screen, e.g. sqrt of a closed group: √(9)", async () => {
    mockedEvaluate.mockResolvedValueOnce(9); // closing (9)
    mockedCalculate.mockResolvedValueOnce(3); // sqrt
    const { result } = renderHook(() => useCalculator());

    await act(async () => result.current.openParen());
    act(() => result.current.inputDigit("9"));
    await act(async () => result.current.closeParen());
    await act(async () => result.current.applySqrt());

    expect(mockedCalculate).toHaveBeenCalledWith("sqrt", [9]);
    expect(result.current.expression).toBe("√(9)");
    expect(result.current.preview).toBe("3");
  });

  it("still lets a digit typed afterward start a fresh number, clearing the √ label", async () => {
    mockedCalculate.mockResolvedValueOnce(4);
    const { result } = renderHook(() => useCalculator());

    act(() => result.current.inputDigit("1"));
    act(() => result.current.inputDigit("6"));
    await act(async () => result.current.applySqrt());
    act(() => result.current.inputDigit("7"));

    expect(result.current.expression).toBe("7");
  });

  it("surfaces the backend's error message on equals, keeping the offending term visible", async () => {
    mockedEvaluate.mockRejectedValue(new CalculatorApiError("DIVISION_BY_ZERO", "Can't divide by zero"));
    const { result } = renderHook(() => useCalculator());

    act(() => result.current.inputDigit("9"));
    await act(async () => result.current.chooseOperation("divide"));
    act(() => result.current.inputDigit("0"));
    await act(async () => result.current.equals());

    await waitFor(() => expect(result.current.error).toBe("Can't divide by zero"));
    // The "0" that caused the error stays visible, not hidden — the
    // user should be able to see exactly what to fix.
    expect(result.current.expression).toBe("9÷0");

    act(() => result.current.inputDigit("7"));
    expect(result.current.expression).toBe("9÷7");
    expect(result.current.error).toBeNull();
  });

  describe("negative numbers (− doubles as a sign)", () => {
    it("starts a pending negative sign when − is pressed with nothing typed yet, without committing an operator", async () => {
      const { result } = renderHook(() => useCalculator());

      await act(async () => result.current.chooseOperation("subtract"));

      expect(result.current.expression).toBe("−0");
      expect(result.current.negativePending).toBe(true);
      expect(result.current.activeOperation).toBeNull();
    });

    it("builds a negative number as digits are typed", async () => {
      const { result } = renderHook(() => useCalculator());

      await act(async () => result.current.chooseOperation("subtract"));
      act(() => result.current.inputDigit("4"));

      expect(result.current.expression).toBe("−4");
      expect(result.current.negativePending).toBe(true);
    });

    it("toggles the sign back off when − is pressed again before any digit", async () => {
      const { result } = renderHook(() => useCalculator());

      await act(async () => result.current.chooseOperation("subtract"));
      await act(async () => result.current.chooseOperation("subtract"));

      expect(result.current.expression).toBe("0");
      expect(result.current.negativePending).toBe(false);
    });

    it("multiplies by a negative number correctly: 4×−4=−16 (regression: − used to commit a 0 first, giving −4 instead)", async () => {
      // A live preview is also requested as the "4" is typed, so this
      // needs to tolerate more than one call, not just the one that
      // actually commits via equals.
      mockedEvaluate.mockResolvedValue(-16);
      const { result } = renderHook(() => useCalculator());

      act(() => result.current.inputDigit("4"));
      await act(async () => result.current.chooseOperation("multiply"));
      await act(async () => result.current.chooseOperation("subtract"));
      expect(result.current.expression).toBe("4×(−0)");

      act(() => result.current.inputDigit("4"));
      expect(result.current.expression).toBe("4×(−4)");

      await act(async () => result.current.equals());

      expect(mockedEvaluate).toHaveBeenCalledWith([4, -4], ["multiply"]);
      expect(result.current.result).toBe("−16");
    });

    it("replaces the pending operator instead of committing 0 when a different operator follows: 9×+ becomes 9+", async () => {
      const { result } = renderHook(() => useCalculator());

      act(() => result.current.inputDigit("9"));
      await act(async () => result.current.chooseOperation("multiply"));
      await act(async () => result.current.chooseOperation("add"));

      expect(mockedEvaluate).not.toHaveBeenCalled();
      expect(result.current.expression).toBe("9+");
      expect(result.current.activeOperation).toBe("add");
    });

    it("does not replace the pending operator once a digit has been typed for the next term", async () => {
      mockedEvaluate.mockResolvedValue(0); // live preview calls, value unused by this test
      const { result } = renderHook(() => useCalculator());

      act(() => result.current.inputDigit("9"));
      await act(async () => result.current.chooseOperation("multiply"));
      act(() => result.current.inputDigit("5"));
      await act(async () => result.current.chooseOperation("add"));

      expect(result.current.expression).toBe("9×5+");
    });

    it("clears a pending negative sign on backspace, same priority as a pending √", async () => {
      const { result } = renderHook(() => useCalculator());

      await act(async () => result.current.chooseOperation("subtract"));
      act(() => result.current.backspace());

      expect(result.current.expression).toBe("0");
      expect(result.current.negativePending).toBe(false);
    });

    it("lets further operations continue correctly on a negative value restored from a closed group (regression: (−2)^4 sent NaN to the backend, since parseFloat can't read back the Unicode minus sign)", async () => {
      mockedEvaluate.mockResolvedValue(16); // (-2)^4
      const { result } = renderHook(() => useCalculator());

      await act(async () => result.current.openParen());
      await act(async () => result.current.chooseOperation("subtract"));
      act(() => result.current.inputDigit("2"));
      await act(async () => result.current.closeParen());
      expect(result.current.expression).toBe("(−2)");

      await act(async () => result.current.chooseOperation("power"));
      act(() => result.current.inputDigit("4"));
      await act(async () => result.current.equals());

      expect(mockedEvaluate).toHaveBeenCalledWith([-2, 4], ["power"]);
      expect(result.current.result).toBe("16");
    });

    it("keeps standard math precedence for a negative power base: −2^4 = −16, not (−2)^4 = 16 (unlike an explicitly parenthesized base, a bare leading sign resolves after the power, not before)", async () => {
      mockedEvaluate.mockImplementation(async (numbers, operators) => realEvaluate(numbers, operators));
      const { result } = renderHook(() => useCalculator());

      await act(async () => result.current.chooseOperation("subtract"));
      act(() => result.current.inputDigit("2"));
      await act(async () => result.current.chooseOperation("power"));
      expect(result.current.expression).toBe("−2^");

      act(() => result.current.inputDigit("4"));
      expect(result.current.expression).toBe("−2^4");
      await waitFor(() => expect(result.current.preview).toBe("−16"));

      await act(async () => result.current.equals());
      expect(result.current.result).toBe("−16");
    });

    it("undoes a negative power base as one atomic step on backspace, restoring the pending sign instead of surfacing the synthetic 0", async () => {
      const { result } = renderHook(() => useCalculator());

      await act(async () => result.current.chooseOperation("subtract"));
      act(() => result.current.inputDigit("2"));
      await act(async () => result.current.chooseOperation("power"));
      expect(result.current.expression).toBe("−2^");

      act(() => result.current.backspace());

      expect(result.current.expression).toBe("−2");
      expect(result.current.negativePending).toBe(true);
    });

    it("transforms a negative number in place with percentage too: 9×−45% becomes 9×(−0.45)", async () => {
      mockedCalculate.mockResolvedValueOnce(-0.45); // -45 -> -45/100
      mockedEvaluate.mockResolvedValue(0); // live preview calls, value unused by this test
      const { result } = renderHook(() => useCalculator());

      act(() => result.current.inputDigit("9"));
      await act(async () => result.current.chooseOperation("multiply"));
      await act(async () => result.current.chooseOperation("subtract"));
      act(() => result.current.inputDigit("4"));
      act(() => result.current.inputDigit("5"));
      await act(async () => result.current.applyPercentage());

      expect(mockedCalculate).toHaveBeenCalledWith("percentage", [-45, 1]);
      expect(result.current.expression).toBe("9×(−0.45)");
    });
  });

  describe("sqrt (dual mode)", () => {
    it("starts a pending √ when pressed with nothing typed yet, without any backend call", () => {
      const { result } = renderHook(() => useCalculator());

      act(() => result.current.applySqrt());

      expect(mockedCalculate).not.toHaveBeenCalled();
      expect(result.current.expression).toBe("√0");
      expect(result.current.sqrtPending).toBe(true);
    });

    it("shows a live preview of the radicand as digits are typed after a pending √", async () => {
      mockedCalculate.mockResolvedValue(3); // sqrt(9), fires on every keystroke while pending
      const { result } = renderHook(() => useCalculator());

      act(() => result.current.applySqrt());
      act(() => result.current.inputDigit("9"));

      expect(result.current.expression).toBe("√9");
      expect(result.current.sqrtPending).toBe(true);
      await waitFor(() => expect(result.current.preview).toBe("3"));
    });

    it("resolves a pending √ when an operator is pressed next: √9+1=4", async () => {
      // A live preview is also requested on every keystroke while √ is
      // pending, so these need to tolerate more than one call, not just
      // the one that actually commits the term.
      mockedCalculate.mockResolvedValue(3); // sqrt(9)
      mockedEvaluate.mockResolvedValue(4); // 3+1
      const { result } = renderHook(() => useCalculator());

      await act(async () => result.current.applySqrt());
      act(() => result.current.inputDigit("9"));
      await act(async () => result.current.chooseOperation("add"));

      expect(mockedCalculate).toHaveBeenCalledWith("sqrt", [9]);
      expect(result.current.expression).toBe("√9+");
      expect(result.current.sqrtPending).toBe(false);
      expect(result.current.activeOperation).toBe("add");

      act(() => result.current.inputDigit("1"));
      await act(async () => result.current.equals());

      expect(mockedEvaluate).toHaveBeenCalledWith([3, 1], ["add"]);
      expect(result.current.result).toBe("4");
    });

    it("resolves a pending √ when closing a group, using the resolved value (not just its label): (√9)×2=6", async () => {
      mockedCalculate.mockResolvedValue(3); // sqrt(9)
      mockedEvaluate.mockResolvedValue(6); // 3*2
      const { result } = renderHook(() => useCalculator());

      await act(async () => result.current.openParen());
      await act(async () => result.current.applySqrt());
      act(() => result.current.inputDigit("9"));
      expect(result.current.expression).toBe("(√9");

      await act(async () => result.current.closeParen());
      expect(result.current.expression).toBe("(√9)");

      await act(async () => result.current.chooseOperation("multiply"));
      act(() => result.current.inputDigit("2"));
      await act(async () => result.current.equals());

      expect(mockedEvaluate).toHaveBeenCalledWith([3, 2], ["multiply"]);
      expect(result.current.result).toBe("6");
    });

    it("resolves a pending √ on equals when chained with a prior operator: 9+√9=12", async () => {
      mockedCalculate.mockResolvedValue(3); // sqrt(9)
      mockedEvaluate.mockResolvedValue(12); // 9+3
      const { result } = renderHook(() => useCalculator());

      act(() => result.current.inputDigit("9"));
      await act(async () => result.current.chooseOperation("add"));
      await act(async () => result.current.applySqrt());
      act(() => result.current.inputDigit("9"));
      expect(result.current.expression).toBe("9+√9");

      await act(async () => result.current.equals());

      expect(mockedCalculate).toHaveBeenCalledWith("sqrt", [9]);
      expect(mockedEvaluate).toHaveBeenCalledWith([9, 3], ["add"]);
      expect(result.current.result).toBe("12");
    });

    it("lets − attach to the radicand while √ is pending, errors correctly instead of resolving √0 and subtracting (regression: √ then − used to send a real sqrt(0) call and commit it as a subtract operand)", async () => {
      mockedCalculate.mockRejectedValue(
        new CalculatorApiError("NEGATIVE_SQRT", "Can't take the square root of a negative number"),
      );
      const { result } = renderHook(() => useCalculator());

      act(() => result.current.applySqrt());
      await act(async () => result.current.chooseOperation("subtract"));
      expect(result.current.expression).toBe("√−0");
      expect(mockedCalculate).not.toHaveBeenCalled();

      act(() => result.current.inputDigit("1"));
      expect(result.current.expression).toBe("√−1");

      await act(async () => result.current.equals());
      expect(mockedEvaluate).not.toHaveBeenCalled();
    });

    it("errors on equals for a negative radicand typed via √ then −: √−1 = Error", async () => {
      mockedCalculate.mockRejectedValue(
        new CalculatorApiError("NEGATIVE_SQRT", "Can't take the square root of a negative number"),
      );
      const { result } = renderHook(() => useCalculator());

      act(() => result.current.inputDigit("9"));
      await act(async () => result.current.chooseOperation("add"));
      act(() => result.current.applySqrt());
      await act(async () => result.current.chooseOperation("subtract"));
      act(() => result.current.inputDigit("1"));
      expect(result.current.expression).toBe("9+√−1");

      await act(async () => result.current.equals());

      expect(mockedCalculate).toHaveBeenCalledWith("sqrt", [-1]);
      await waitFor(() =>
        expect(result.current.error).toBe("Can't take the square root of a negative number"),
      );
      expect(result.current.result).toBeNull();
    });

    it("attaches √ to a group opened right after it, instead of resolving √0 and multiplying: √(−1) = Error", async () => {
      mockedCalculate.mockRejectedValue(
        new CalculatorApiError("NEGATIVE_SQRT", "Can't take the square root of a negative number"),
      );
      const { result } = renderHook(() => useCalculator());

      act(() => result.current.applySqrt());
      await act(async () => result.current.openParen());
      expect(result.current.expression).toBe("√(0");
      await act(async () => result.current.chooseOperation("subtract"));
      act(() => result.current.inputDigit("1"));
      expect(result.current.expression).toBe("√(−1");

      await act(async () => result.current.closeParen());

      expect(mockedCalculate).toHaveBeenCalledWith("sqrt", [-1]);
      await waitFor(() =>
        expect(result.current.error).toBe("Can't take the square root of a negative number"),
      );
    });

    it("shows a negative-radicand error live, as soon as it's typed, not just once a commit key is pressed (regression: the live preview used to swallow this error and just show nothing)", async () => {
      mockedCalculate.mockRejectedValue(
        new CalculatorApiError("NEGATIVE_SQRT", "Can't take the square root of a negative number"),
      );
      const { result } = renderHook(() => useCalculator());

      act(() => result.current.applySqrt());
      await act(async () => result.current.chooseOperation("subtract"));
      act(() => result.current.inputDigit("1"));
      expect(result.current.expression).toBe("√−1");

      await waitFor(() =>
        expect(result.current.error).toBe("Can't take the square root of a negative number"),
      );
    });

    it("shows a negative-radicand error live for a nested, still-open group too, not only once both ')' are pressed (regression: previewed as the wrong plain number − Error only appeared after the outer group closed)", async () => {
      mockedCalculate.mockImplementation(async (_op, operands) => {
        if (operands[0] < 0) {
          throw new CalculatorApiError("NEGATIVE_SQRT", "Can't take the square root of a negative number");
        }
        return Math.sqrt(operands[0]);
      });
      mockedEvaluate.mockImplementation(async (numbers, operators) => realEvaluate(numbers, operators));
      const { result } = renderHook(() => useCalculator());

      act(() => result.current.applySqrt());
      await act(async () => result.current.openParen());
      await act(async () => result.current.chooseOperation("subtract"));
      act(() => result.current.inputDigit("1"));
      await act(async () => result.current.chooseOperation("multiply"));
      await act(async () => result.current.openParen());
      act(() => result.current.inputDigit("1"));
      expect(result.current.expression).toBe("√(−1×(1");

      // −1×1 = −1, and √ is queued on the *outer* group — this should
      // already be a live error, not a stale "=−1" preview that only
      // turns into Error once both ")" are explicitly pressed.
      await waitFor(() =>
        expect(result.current.error).toBe("Can't take the square root of a negative number"),
      );
      expect(result.current.preview).toBeNull();
    });

    it("differentiates √(3)(3) (√ applies to just the first group, then multiplies) from √(3(3)) (√ applies to the whole nested content)", async () => {
      mockedCalculate.mockImplementation(async (_op, operands) => Math.sqrt(operands[0]));
      mockedEvaluate.mockImplementation(async (numbers, operators) => realEvaluate(numbers, operators));

      // √(3)(3) = √3 × 3
      const first = renderHook(() => useCalculator());
      act(() => first.result.current.applySqrt());
      await act(async () => first.result.current.openParen());
      act(() => first.result.current.inputDigit("3"));
      await act(async () => first.result.current.closeParen());
      expect(first.result.current.expression).toBe("√(3)");

      await act(async () => first.result.current.openParen());
      act(() => first.result.current.inputDigit("3"));
      await act(async () => first.result.current.closeParen());
      expect(first.result.current.expression).toBe("√(3)×(3)");

      await act(async () => first.result.current.equals());
      expect(Number(first.result.current.result)).toBeCloseTo(Math.sqrt(3) * 3, 5);

      // √(3(3)) = √(3×3) = √9 = 3
      const second = renderHook(() => useCalculator());
      act(() => second.result.current.applySqrt());
      await act(async () => second.result.current.openParen());
      act(() => second.result.current.inputDigit("3"));
      await act(async () => second.result.current.openParen());
      act(() => second.result.current.inputDigit("3"));
      await act(async () => second.result.current.closeParen());
      await act(async () => second.result.current.closeParen());

      expect(second.result.current.expression).toBe("√(3×(3))");
      // Same fallback a bare "√16" already relies on: with nothing
      // enclosing it, the resolved value previews as itself.
      expect(second.result.current.preview).toBe("3");

      // Confirm the resolved *value* is really 3 (not just the label),
      // by chaining one more operator off of it.
      await act(async () => second.result.current.chooseOperation("add"));
      act(() => second.result.current.inputDigit("0"));
      await act(async () => second.result.current.equals());
      expect(second.result.current.result).toBe("3");
    });
  });

  describe("percentage (dual mode)", () => {
    it("transforms the number in place (value/100) when an operator is already pending", async () => {
      mockedCalculate.mockResolvedValueOnce(0.45); // 45 -> 45/100
      // Typing "4" then "5" each fire a live-preview call (9*4, 9*45).
      mockedEvaluate.mockResolvedValue(0);
      const { result } = renderHook(() => useCalculator());

      act(() => result.current.inputDigit("9"));
      await act(async () => result.current.chooseOperation("multiply"));
      act(() => result.current.inputDigit("4"));
      act(() => result.current.inputDigit("5"));
      await act(async () => result.current.applyPercentage());

      expect(mockedCalculate).toHaveBeenCalledWith("percentage", [45, 1]);
      expect(result.current.expression).toBe("9×0.45");
    });

    it("acts as the 'percent of' operator when nothing is pending yet: 50% of 10 = 5", async () => {
      mockedEvaluate.mockImplementation(async (numbers, operators) => realEvaluate(numbers, operators));
      const { result } = renderHook(() => useCalculator());

      act(() => result.current.inputDigit("5"));
      act(() => result.current.inputDigit("0"));
      await act(async () => result.current.applyPercentage());

      expect(mockedCalculate).not.toHaveBeenCalled();
      expect(result.current.expression).toBe("50%");
      expect(result.current.activeOperation).toBe("percentage");

      act(() => result.current.inputDigit("1"));
      act(() => result.current.inputDigit("0"));
      await waitFor(() => expect(result.current.preview).toBe("5"));

      await act(async () => result.current.equals());
      expect(result.current.result).toBe("5");
    });

    it("resolves a bare, standalone percentage on equals: 25% = 0.25, not 25% of a phantom 0", async () => {
      mockedCalculate.mockResolvedValueOnce(0.25); // 25 -> 25/100
      const { result } = renderHook(() => useCalculator());

      act(() => result.current.inputDigit("2"));
      act(() => result.current.inputDigit("5"));
      await act(async () => result.current.applyPercentage());
      expect(result.current.expression).toBe("25%");

      await act(async () => result.current.equals());

      expect(mockedCalculate).toHaveBeenCalledWith("percentage", [25, 1]);
      expect(mockedEvaluate).not.toHaveBeenCalled();
      expect(result.current.result).toBe("0.25");
    });

    it("resolves a bare trailing percentage combined with an earlier term: 9+25% = 9.25", async () => {
      mockedCalculate.mockResolvedValueOnce(0.25); // 25 -> 25/100
      // A live preview is also requested as "25" is typed, so this
      // needs to tolerate more than one call, not just the one that
      // actually commits via equals.
      mockedEvaluate.mockResolvedValue(9.25); // 9 + 0.25
      const { result } = renderHook(() => useCalculator());

      act(() => result.current.inputDigit("9"));
      await act(async () => result.current.chooseOperation("add"));
      act(() => result.current.inputDigit("2"));
      act(() => result.current.inputDigit("5"));
      await act(async () => result.current.applyPercentage());

      await act(async () => result.current.equals());

      expect(mockedEvaluate).toHaveBeenCalledWith([9, 0.25], ["add"]);
      expect(result.current.result).toBe("9.25");
    });

    it("resolves a bare trailing percentage when closing a group: (25%) = 0.25, literal text stays just '(25%)'", async () => {
      mockedCalculate.mockResolvedValueOnce(0.25); // 25 -> 25/100
      const { result } = renderHook(() => useCalculator());

      await act(async () => result.current.openParen());
      act(() => result.current.inputDigit("2"));
      act(() => result.current.inputDigit("5"));
      await act(async () => result.current.applyPercentage());
      expect(result.current.expression).toBe("(25%");

      await act(async () => result.current.closeParen());

      expect(mockedCalculate).toHaveBeenCalledWith("percentage", [25, 1]);
      expect(mockedEvaluate).not.toHaveBeenCalled();
      expect(result.current.expression).toBe("(25%)");

      await act(async () => result.current.chooseOperation("multiply"));
      act(() => result.current.inputDigit("2"));
      mockedEvaluate.mockResolvedValueOnce(0.5); // 0.25*2
      await act(async () => result.current.equals());
      expect(result.current.result).toBe("0.5");
    });
  });

  describe("live preview", () => {
    beforeEach(() => {
      mockedEvaluate.mockImplementation(async (numbers, operators) => realEvaluate(numbers, operators));
    });

    it("shows a preview as soon as the first pair is complete, without pressing another operator", async () => {
      const { result } = renderHook(() => useCalculator());

      act(() => result.current.inputDigit("9"));
      await act(async () => result.current.chooseOperation("multiply"));
      expect(result.current.preview).toBeNull();

      act(() => result.current.inputDigit("9"));
      await waitFor(() => expect(result.current.preview).toBe("81"));
    });

    it("updates the preview on every digit typed for a later term too, without pressing the next operator", async () => {
      const { result } = renderHook(() => useCalculator());

      act(() => result.current.inputDigit("9"));
      await act(async () => result.current.chooseOperation("multiply"));
      act(() => result.current.inputDigit("9"));
      await waitFor(() => expect(result.current.preview).toBe("81"));

      await act(async () => result.current.chooseOperation("subtract"));
      act(() => result.current.inputDigit("5"));
      await waitFor(() => expect(result.current.preview).toBe("76"));
    });

    it("reproduces 9×7+1-6÷6=63, following operator precedence at every step", async () => {
      const { result } = renderHook(() => useCalculator());

      act(() => result.current.inputDigit("9"));
      await act(async () => result.current.chooseOperation("multiply"));
      act(() => result.current.inputDigit("7"));
      await waitFor(() => expect(result.current.preview).toBe("63"));

      await act(async () => result.current.chooseOperation("add"));
      act(() => result.current.inputDigit("1"));
      await waitFor(() => expect(result.current.preview).toBe("64"));

      await act(async () => result.current.chooseOperation("subtract"));
      act(() => result.current.inputDigit("6"));
      await waitFor(() => expect(result.current.preview).toBe("58"));

      await act(async () => result.current.chooseOperation("divide"));
      act(() => result.current.inputDigit("6"));
      await waitFor(() => expect(result.current.preview).toBe("63"));

      expect(result.current.expression).toBe("9×7+1−6÷6");

      await act(async () => result.current.equals());
      expect(result.current.result).toBe("63");
      expect(result.current.preview).toBeNull();
      expect(result.current.activeOperation).toBeNull();
    });

    it("lets the user continue chaining from the previous result after equals", async () => {
      const { result } = renderHook(() => useCalculator());

      act(() => result.current.inputDigit("2"));
      await act(async () => result.current.chooseOperation("add"));
      act(() => result.current.inputDigit("3"));
      await waitFor(() => expect(result.current.preview).toBe("5"));
      await act(async () => result.current.equals());
      expect(result.current.result).toBe("5");

      await act(async () => result.current.chooseOperation("multiply"));
      expect(result.current.result).toBeNull();
      expect(result.current.expression).toBe("5×");
      expect(result.current.activeOperation).toBe("multiply");
    });

    it("refreshes a stale preview after applying percentage mid-chain (regression: 9*45%)", async () => {
      mockedCalculate.mockResolvedValueOnce(0.45); // 45 -> 45/100
      const { result } = renderHook(() => useCalculator());

      act(() => result.current.inputDigit("9"));
      await act(async () => result.current.chooseOperation("multiply"));
      act(() => result.current.inputDigit("4"));
      act(() => result.current.inputDigit("5"));
      // Before pressing %, the preview reflects 9*45 — this is the
      // stale value that must NOT still be shown once % is pressed.
      await waitFor(() => expect(result.current.preview).toBe("405"));

      await act(async () => result.current.applyPercentage());

      expect(mockedCalculate).toHaveBeenCalledWith("percentage", [45, 1]);
      expect(result.current.expression).toBe("9×0.45");
      await waitFor(() => expect(result.current.preview).toBe("4.05"));
    });

    it("shows a live preview while typing directly inside an open group: 9×(5 → 45", async () => {
      const { result } = renderHook(() => useCalculator());

      act(() => result.current.inputDigit("9"));
      await act(async () => result.current.chooseOperation("multiply"));
      await act(async () => result.current.openParen());
      act(() => result.current.inputDigit("5"));

      await waitFor(() => expect(result.current.preview).toBe("45"));
    });

    it("previews the full propagated expression while typing inside a group, not just the group's own subtotal: 9×(3+5 → 72", async () => {
      const { result } = renderHook(() => useCalculator());

      act(() => result.current.inputDigit("9"));
      await act(async () => result.current.chooseOperation("multiply"));
      await act(async () => result.current.openParen());
      act(() => result.current.inputDigit("3"));
      await act(async () => result.current.chooseOperation("add"));
      act(() => result.current.inputDigit("5"));

      await waitFor(() => expect(result.current.preview).toBe("72")); // 9 * (3+5)
    });

    it("ignores a stale preview response that resolves after a newer one was already applied", async () => {
      const { result } = renderHook(() => useCalculator());

      act(() => result.current.inputDigit("9"));
      await act(async () => result.current.chooseOperation("add"));

      // Simulate typing "1" then "2" in quick succession, where the
      // first request resolves *after* the second one.
      let resolveFirst!: (value: number) => void;
      mockedEvaluate.mockImplementationOnce(
        () => new Promise((resolve) => (resolveFirst = resolve)),
      );
      act(() => result.current.inputDigit("1"));

      mockedEvaluate.mockImplementationOnce(async (numbers, operators) => realEvaluate(numbers, operators));
      act(() => result.current.inputDigit("2"));
      await waitFor(() => expect(result.current.preview).toBe("21")); // 9 + 12

      act(() => resolveFirst(10)); // 9 + 1, arriving late
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(result.current.preview).toBe("21"); // unchanged: the late response was discarded
    });
  });

  describe("backspace", () => {
    it("removes the last digit typed", () => {
      const { result } = renderHook(() => useCalculator());

      act(() => result.current.inputDigit("1"));
      act(() => result.current.inputDigit("2"));
      act(() => result.current.inputDigit("3"));
      act(() => result.current.backspace());

      expect(result.current.expression).toBe("12");
    });

    it("reverts to 0 once the last digit of a term is removed", () => {
      const { result } = renderHook(() => useCalculator());

      act(() => result.current.inputDigit("7"));
      act(() => result.current.backspace());

      expect(result.current.expression).toBe("0");
    });

    it("does nothing at the very start", () => {
      const { result } = renderHook(() => useCalculator());

      act(() => result.current.backspace());

      expect(result.current.expression).toBe("0");
    });

    it("undoes the last operator and restores its term for editing once the current term is empty", async () => {
      const { result } = renderHook(() => useCalculator());

      act(() => result.current.inputDigit("9"));
      await act(async () => result.current.chooseOperation("multiply"));
      expect(result.current.expression).toBe("9×");

      act(() => result.current.backspace());

      expect(result.current.expression).toBe("9");
      expect(result.current.activeOperation).toBeNull();
    });

    it("removes a closed group's value in one step", async () => {
      mockedEvaluate.mockImplementation(async (numbers, operators) => realEvaluate(numbers, operators));
      const { result } = renderHook(() => useCalculator());

      act(() => result.current.inputDigit("9"));
      await act(async () => result.current.chooseOperation("add"));
      await act(async () => result.current.openParen());
      act(() => result.current.inputDigit("2"));
      await act(async () => result.current.chooseOperation("add"));
      act(() => result.current.inputDigit("3"));
      await act(async () => result.current.closeParen());
      expect(result.current.expression).toBe("9+(2+3)");

      act(() => result.current.backspace());

      expect(result.current.expression).toBe("9+");
    });
  });

  describe("parentheses", () => {
    beforeEach(() => {
      mockedEvaluate.mockImplementation(async (numbers, operators) => realEvaluate(numbers, operators));
    });

    it("opens a group showing a trailing ( with the idle placeholder inside", async () => {
      const { result } = renderHook(() => useCalculator());

      await act(async () => result.current.openParen());

      expect(result.current.expression).toBe("(0");
    });

    // Pressing "(" mid-number is implicit multiplication, not a no-op —
    // see the "implicit multiplication before (" describe block below.

    it("closes a bare number group without any backend call", async () => {
      const { result } = renderHook(() => useCalculator());

      await act(async () => result.current.openParen());
      act(() => result.current.inputDigit("5"));
      await act(async () => result.current.closeParen());

      expect(mockedEvaluate).not.toHaveBeenCalled();
      expect(result.current.expression).toBe("(5)");
    });

    it("keeps the group's literal contents visible once closed, instead of collapsing to its value", async () => {
      const { result } = renderHook(() => useCalculator());

      act(() => result.current.inputDigit("9"));
      await act(async () => result.current.chooseOperation("add"));
      await act(async () => result.current.openParen());
      act(() => result.current.inputDigit("2"));
      await act(async () => result.current.chooseOperation("multiply"));
      act(() => result.current.inputDigit("3"));
      await act(async () => result.current.closeParen());

      expect(result.current.expression).toBe("9+(2×3)");
      await waitFor(() => expect(result.current.preview).toBe("15")); // 9 + (2*3)

      await act(async () => result.current.equals());
      expect(result.current.result).toBe("15");
    });

    it("evaluates nested groups correctly and keeps their literal text: 5+(2*(3+1)) = 13", async () => {
      const { result } = renderHook(() => useCalculator());

      act(() => result.current.inputDigit("5"));
      await act(async () => result.current.chooseOperation("add"));
      await act(async () => result.current.openParen());
      act(() => result.current.inputDigit("2"));
      await act(async () => result.current.chooseOperation("multiply"));
      await act(async () => result.current.openParen());
      act(() => result.current.inputDigit("3"));
      await act(async () => result.current.chooseOperation("add"));
      act(() => result.current.inputDigit("1"));
      await act(async () => result.current.closeParen());
      expect(result.current.expression).toBe("5+(2×(3+1)");

      await act(async () => result.current.closeParen());
      expect(result.current.expression).toBe("5+(2×(3+1))");

      await act(async () => result.current.equals());
      expect(result.current.result).toBe("13");
    });

    it("is a no-op when there is no open group to close", async () => {
      const { result } = renderHook(() => useCalculator());

      act(() => result.current.inputDigit("9"));
      await act(async () => result.current.closeParen());

      expect(mockedEvaluate).not.toHaveBeenCalled();
      expect(result.current.expression).toBe("9");
    });

    it("auto-closes every still-open group on equals instead of sitting there with just a live preview (regression: '=' used to be a no-op with any group left open)", async () => {
      const { result } = renderHook(() => useCalculator());

      act(() => result.current.inputDigit("9"));
      await act(async () => result.current.chooseOperation("multiply"));
      await act(async () => result.current.openParen());
      act(() => result.current.inputDigit("3"));
      await act(async () => result.current.chooseOperation("add"));
      act(() => result.current.inputDigit("5"));
      expect(result.current.expression).toBe("9×(3+5");
      await waitFor(() => expect(result.current.preview).toBe("72"));

      await act(async () => result.current.equals());

      expect(result.current.result).toBe("72");
      // The finalized result can be chained into another operation,
      // exactly like any other equals — this is the actual point.
      await act(async () => result.current.chooseOperation("add"));
      act(() => result.current.inputDigit("8"));
      await act(async () => result.current.equals());
      expect(result.current.result).toBe("80");
    });

    it("auto-closes nested groups on equals too, applying a queued √ along the way", async () => {
      mockedCalculate.mockImplementation(async (_op, operands) => Math.sqrt(operands[0]));
      const { result } = renderHook(() => useCalculator());

      act(() => result.current.applySqrt());
      await act(async () => result.current.openParen());
      await act(async () => result.current.chooseOperation("subtract"));
      act(() => result.current.inputDigit("1"));
      await act(async () => result.current.chooseOperation("multiply"));
      await act(async () => result.current.openParen());
      act(() => result.current.inputDigit("1"));
      await act(async () => result.current.chooseOperation("subtract"));
      act(() => result.current.inputDigit("1"));
      expect(result.current.expression).toBe("√(−1×(1−1");

      await act(async () => result.current.equals());

      // √(−1×(1−1)) = √(−1×0) = √0 = 0.
      expect(result.current.result).toBe("0");
    });

    it("treats a digit typed right after closing a group as implicit multiplication, keeping the group visible (regression: (9+1) then 2 must not read as 102, nor discard the group down to just 2)", async () => {
      mockedEvaluate.mockImplementation(async (numbers, operators) => realEvaluate(numbers, operators));
      const { result } = renderHook(() => useCalculator());

      await act(async () => result.current.openParen());
      act(() => result.current.inputDigit("9"));
      await act(async () => result.current.chooseOperation("add"));
      act(() => result.current.inputDigit("1"));
      await act(async () => result.current.closeParen());
      expect(result.current.expression).toBe("(9+1)");

      await act(async () => result.current.inputDigit("2"));

      expect(result.current.expression).toBe("(9+1)×2");
      await waitFor(() => expect(result.current.preview).toBe("20"));

      await act(async () => result.current.equals());
      expect(result.current.result).toBe("20");
    });

    it("still lets a digit typed after a resolved √ start a fresh number (unlike a closed group)", async () => {
      mockedCalculate.mockResolvedValueOnce(4); // sqrt(16)
      const { result } = renderHook(() => useCalculator());

      act(() => result.current.inputDigit("1"));
      act(() => result.current.inputDigit("6"));
      await act(async () => result.current.applySqrt());
      expect(result.current.expression).toBe("√16");

      act(() => result.current.inputDigit("7"));

      expect(result.current.expression).toBe("7");
      expect(mockedEvaluate).not.toHaveBeenCalled();
    });

    it("does not leave a stale preview once a fresh digit replaces a resolved √ (regression: √16=4 then 7 must not still show '=4')", async () => {
      mockedCalculate.mockResolvedValueOnce(4); // sqrt(16)
      const { result } = renderHook(() => useCalculator());

      act(() => result.current.inputDigit("1"));
      act(() => result.current.inputDigit("6"));
      await act(async () => result.current.applySqrt());
      expect(result.current.preview).toBe("4");

      act(() => result.current.inputDigit("7"));

      expect(result.current.expression).toBe("7");
      expect(result.current.preview).toBeNull();
    });

    it("also treats a decimal point typed right after closing a group as implicit multiplication: (9+1). = (9+1)×0.", async () => {
      mockedEvaluate.mockImplementation(async (numbers, operators) => realEvaluate(numbers, operators));
      const { result } = renderHook(() => useCalculator());

      await act(async () => result.current.openParen());
      act(() => result.current.inputDigit("9"));
      await act(async () => result.current.chooseOperation("add"));
      act(() => result.current.inputDigit("1"));
      await act(async () => result.current.closeParen());

      await act(async () => result.current.inputDecimal());

      expect(result.current.expression).toBe("(9+1)×0.");
    });
  });

  describe("implicit multiplication before (", () => {
    beforeEach(() => {
      mockedEvaluate.mockImplementation(async (numbers, operators) => realEvaluate(numbers, operators));
    });

    it("treats a number directly followed by ( as multiplication: 9(2) = 18", async () => {
      const { result } = renderHook(() => useCalculator());

      act(() => result.current.inputDigit("9"));
      await act(async () => result.current.openParen());
      expect(result.current.expression).toBe("9×(0");

      act(() => result.current.inputDigit("2"));
      await act(async () => result.current.closeParen());
      expect(result.current.expression).toBe("9×(2)");

      await act(async () => result.current.equals());
      expect(result.current.result).toBe("18");
    });

    it("also applies right after a closed group: (2+3)(4+5) = 45", async () => {
      const { result } = renderHook(() => useCalculator());

      await act(async () => result.current.openParen());
      act(() => result.current.inputDigit("2"));
      await act(async () => result.current.chooseOperation("add"));
      act(() => result.current.inputDigit("3"));
      await act(async () => result.current.closeParen());

      await act(async () => result.current.openParen());
      act(() => result.current.inputDigit("4"));
      await act(async () => result.current.chooseOperation("add"));
      act(() => result.current.inputDigit("5"));
      await act(async () => result.current.closeParen());

      expect(result.current.expression).toBe("(2+3)×(4+5)");

      await act(async () => result.current.equals());
      expect(result.current.result).toBe("45");
    });

    it("does not insert a multiply right after an explicit operator or at the very start", async () => {
      const { result } = renderHook(() => useCalculator());

      await act(async () => result.current.openParen());
      expect(result.current.expression).toBe("(0");
      act(() => result.current.inputDigit("2"));
      await act(async () => result.current.chooseOperation("add"));
      await act(async () => result.current.openParen());

      expect(result.current.expression).toBe("(2+(0");
    });

    it("starts fresh (no multiply) when ( is pressed right after a final result", async () => {
      const { result } = renderHook(() => useCalculator());

      act(() => result.current.inputDigit("2"));
      await act(async () => result.current.chooseOperation("add"));
      act(() => result.current.inputDigit("3"));
      await act(async () => result.current.equals());
      expect(result.current.result).toBe("5");

      await act(async () => result.current.openParen());
      expect(result.current.expression).toBe("(0");
    });
  });
});
