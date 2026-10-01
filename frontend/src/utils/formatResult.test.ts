import { describe, expect, it } from "vitest";
import { formatResult } from "./formatResult";

describe("formatResult", () => {
  it("returns whole numbers without decimals", () => {
    expect(formatResult(5)).toBe("5");
  });

  it("trims floating point noise", () => {
    expect(formatResult(0.1 + 0.2)).toBe("0.3");
  });

  it("returns Error for NaN", () => {
    expect(formatResult(NaN)).toBe("Error");
  });

  it("shows the infinity symbol for an overflowing result, not an error", () => {
    expect(formatResult(Infinity)).toBe("∞");
    expect(formatResult(-Infinity)).toBe("−∞");
  });

  it("shows a negative result with the same minus sign used for the subtract operator, not a plain hyphen", () => {
    expect(formatResult(-16)).toBe("−16");
  });
});
