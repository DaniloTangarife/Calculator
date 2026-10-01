import { afterEach, describe, expect, it, vi } from "vitest";
import { CalculatorApiError, calculate, evaluateExpression } from "./calculatorApi";

function mockFetchOnce(status: number, body: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(body),
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("calculate", () => {
  it("returns the numeric result on success", async () => {
    mockFetchOnce(200, { result: 8 });

    const result = await calculate("add", [5, 3]);

    expect(result).toBe(8);
  });

  it("sends the operation and operands as the request body", async () => {
    mockFetchOnce(200, { result: 8 });

    await calculate("add", [5, 3]);

    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toContain("/api/v1/calculate");
    expect(JSON.parse(options.body)).toEqual({ operation: "add", operands: [5, 3] });
  });

  it("throws a CalculatorApiError with the backend's code and a user-friendly message on a 4xx response", async () => {
    mockFetchOnce(400, { error: { code: "DIVISION_BY_ZERO", message: "division by zero" } });

    await expect(calculate("divide", [1, 0])).rejects.toMatchObject({
      code: "DIVISION_BY_ZERO",
      message: "Can't divide by zero",
    });
  });

  it("falls back to the backend's own message for an error code with no friendly mapping", async () => {
    mockFetchOnce(400, { error: { code: "SOME_FUTURE_CODE", message: "backend-provided detail" } });

    await expect(calculate("divide", [1, 0])).rejects.toMatchObject({
      code: "SOME_FUTURE_CODE",
      message: "backend-provided detail",
    });
  });

  it("throws a CalculatorApiError when the network request itself fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("network down")));

    await expect(calculate("add", [1, 2])).rejects.toBeInstanceOf(CalculatorApiError);
  });
});

describe("evaluateExpression", () => {
  it("returns the numeric result on success", async () => {
    mockFetchOnce(200, { result: 24 });

    const result = await evaluateExpression([9, 8, 8, 4, 1], ["add", "multiply", "divide", "subtract"]);

    expect(result).toBe(24);
  });

  it("sends numbers and operators as the request body", async () => {
    mockFetchOnce(200, { result: 17 });

    await evaluateExpression([9, 8], ["add"]);

    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toContain("/api/v1/evaluate");
    expect(JSON.parse(options.body)).toEqual({ numbers: [9, 8], operators: ["add"] });
  });

  it("throws a CalculatorApiError with the backend's code and a user-friendly message on a 4xx response", async () => {
    mockFetchOnce(400, { error: { code: "EXPRESSION_MALFORMED", message: "bad expression" } });

    await expect(evaluateExpression([1], ["add", "add"])).rejects.toMatchObject({
      code: "EXPRESSION_MALFORMED",
      message: "That expression isn't valid",
    });
  });
});
