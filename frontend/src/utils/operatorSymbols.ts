import type { ChainableOperation } from "../types/calculator";

// The symbol shown inline inside the typed expression (e.g. "9×7").
// Kept separate from the keypad's own button labels: "power"'s button
// reads "xʸ" for a nicer keycap, but "^" is the plain-text convention
// once it's part of a typed expression like "2^3".
export const OPERATOR_SYMBOLS: Record<ChainableOperation, string> = {
  add: "+",
  subtract: "−",
  multiply: "×",
  divide: "÷",
  power: "^",
  percentage: "%",
};
