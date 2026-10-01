// Operators that can be chained in a single expression (e.g.
// 9 + 8 * 8 / 4 - 1), each with a well-defined precedence. percentage
// ("a% of b") behaves as a binary operator here too, at the same
// precedence as multiply/divide — see useCalculator's dual-mode "%" key
// for when it's used this way versus as an in-place value/100 transform.
export type ChainableOperation =
  | "add"
  | "subtract"
  | "multiply"
  | "divide"
  | "power"
  | "percentage";

// Applied immediately to the number currently on screen, outside the
// chained-expression flow (see useCalculator) — sqrt only takes one
// operand, so it can never act as a binary operator the way percentage
// sometimes does.
export type ImmediateOperation = "sqrt";

export type OperationName = ChainableOperation | ImmediateOperation;

export interface CalculateRequest {
  operation: OperationName;
  operands: number[];
}

export interface EvaluateRequest {
  numbers: number[];
  operators: ChainableOperation[];
}

export interface CalculateResponse {
  result: number;
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
  };
}
