import type {
  ApiErrorBody,
  CalculateResponse,
  ChainableOperation,
  OperationName,
} from "../types/calculator";

// Read at call time (not module load time) so tests can override it
// via import.meta.env without needing to reset modules.
function apiBaseUrl(): string {
  return import.meta.env.VITE_API_URL ?? "http://localhost:8080";
}

// CalculatorApiError carries the backend's machine-readable error code
// alongside a human-readable message, so callers can branch on `code`
// when they need to and always have `message` to show the user.
export class CalculatorApiError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "CalculatorApiError";
    this.code = code;
  }
}

// The backend's `message` is written for logs/API consumers ("division
// by zero"), not end users. `code` is the stable, machine-readable part
// of the contract specifically so the UI can own its own copy — mapped
// here instead of in the backend, so wording can change (or be
// localized) without a backend change. Any code not listed falls back
// to the backend's own message, so a new backend error code still shows
// *something* meaningful instead of nothing.
const FRIENDLY_ERROR_MESSAGES: Record<string, string> = {
  DIVISION_BY_ZERO: "Can't divide by zero",
  NEGATIVE_SQRT: "Can't take the square root of a negative number",
  INVALID_OPERAND: "That number is too large or not valid",
  UNKNOWN_OPERATION: "Unknown operation",
  INVALID_OPERAND_COUNT: "Wrong number of values for that operation",
  EXPRESSION_MALFORMED: "That expression isn't valid",
  OPERATOR_NOT_CHAINABLE: "That operator can't be used there",
  INVALID_JSON: "Something went wrong. Please try again.",
  INTERNAL_ERROR: "Something went wrong. Please try again.",
};

function friendlyMessage(code: string, backendMessage: string): string {
  return FRIENDLY_ERROR_MESSAGES[code] ?? backendMessage;
}

// Converts the backend's result back into a real JS number. A plain
// number passes through unchanged; the three sentinel strings (used
// because JSON has no number literal for them) become the actual
// Infinity/-Infinity/NaN values, which the rest of the app already
// knows how to display (formatResult) and re-parse (numberToInputString
// in useCalculator, since JS's own parseFloat understands "Infinity"
// and "-Infinity" natively).
function toNumber(result: CalculateResponse["result"]): number {
  switch (result) {
    case "Infinity":
      return Number.POSITIVE_INFINITY;
    case "-Infinity":
      return Number.NEGATIVE_INFINITY;
    case "NaN":
      return Number.NaN;
    default:
      return result;
  }
}

// The mirror image of toNumber, for the other half of the round trip:
// an operand can itself be Infinity/-Infinity (an earlier result that
// overflowed, now being operated on further — e.g. "4^1000" then
// "- 5"). JSON.stringify(Infinity) silently serializes to the JSON
// literal null, which the backend would otherwise decode as a bare 0,
// so a non-finite operand is sent as the same sentinel string the
// backend's own responses use instead of a raw JSON number.
function toOperand(value: number): number | "Infinity" | "-Infinity" | "NaN" {
  if (Number.isNaN(value)) return "NaN";
  if (value === Number.POSITIVE_INFINITY) return "Infinity";
  if (value === Number.NEGATIVE_INFINITY) return "-Infinity";
  return value;
}

// postJSON is the single place that knows how to talk to the backend:
// send a POST, parse its JSON body, and translate a non-2xx response
// (or a network failure) into a CalculatorApiError. Both calculate()
// and evaluateExpression() are thin wrappers around it.
async function postJSON<T>(path: string, body: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl()}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new CalculatorApiError(
      "NETWORK_ERROR",
      "Could not reach the calculator service. Check your connection and try again.",
    );
  }

  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    const errorBody = payload as ApiErrorBody | null;
    const code = errorBody?.error?.code ?? "UNKNOWN_ERROR";
    const backendMessage = errorBody?.error?.message ?? "Something went wrong. Please try again.";
    throw new CalculatorApiError(code, friendlyMessage(code, backendMessage));
  }

  return payload as T;
}

// calculate asks the backend to perform a single operation on operands
// and returns the numeric result. Used for sqrt, and for percentage
// when it's transforming the number on screen in place (see
// useCalculator) rather than acting as a chained operator.
export async function calculate(
  operation: OperationName,
  operands: number[],
): Promise<number> {
  const { result } = await postJSON<CalculateResponse>("/api/v1/calculate", {
    operation,
    operands: operands.map(toOperand),
  });
  return toNumber(result);
}

// evaluateExpression asks the backend to evaluate a chained expression
// (numbers combined by operators, operators[i] between numbers[i] and
// numbers[i+1]) respecting standard operator precedence.
export async function evaluateExpression(
  numbers: number[],
  operators: ChainableOperation[],
): Promise<number> {
  const { result } = await postJSON<CalculateResponse>("/api/v1/evaluate", {
    numbers: numbers.map(toOperand),
    operators,
  });
  return toNumber(result);
}
