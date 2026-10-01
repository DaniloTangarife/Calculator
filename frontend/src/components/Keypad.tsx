import type { ChainableOperation } from "../types/calculator";

interface KeypadProps {
  onDigit: (digit: string) => void;
  onDecimal: () => void;
  onBackspace: () => void;
  onClear: () => void;
  onOpenParen: () => void;
  onCloseParen: () => void;
  onOperation: (operation: ChainableOperation) => void;
  onSqrt: () => void;
  onPercentage: () => void;
  onEquals: () => void;
  activeOperation: ChainableOperation | null;
  sqrtPending: boolean;
  negativePending: boolean;
  disabled: boolean;
}

type ButtonConfig =
  | { kind: "digit"; label: string; value: string }
  | { kind: "decimal" }
  | { kind: "backspace" }
  | { kind: "clear" }
  | { kind: "open-paren" }
  | { kind: "close-paren" }
  | { kind: "equals" }
  | { kind: "sqrt" }
  | { kind: "percentage" }
  | { kind: "operation"; label: string; operation: ChainableOperation; ariaLabel: string };

// Declaring the keypad as data instead of repeating near-identical JSX
// per button keeps it easy to scan and easy to extend with one more entry.
const LAYOUT: ButtonConfig[] = [
  { kind: "clear" },
  { kind: "backspace" },
  { kind: "open-paren" },
  { kind: "close-paren" },

  { kind: "sqrt" },
  { kind: "operation", label: "xʸ", operation: "power", ariaLabel: "Power" },
  { kind: "percentage" },
  { kind: "operation", label: "÷", operation: "divide", ariaLabel: "Divide" },

  { kind: "digit", label: "7", value: "7" },
  { kind: "digit", label: "8", value: "8" },
  { kind: "digit", label: "9", value: "9" },
  { kind: "operation", label: "×", operation: "multiply", ariaLabel: "Multiply" },

  { kind: "digit", label: "4", value: "4" },
  { kind: "digit", label: "5", value: "5" },
  { kind: "digit", label: "6", value: "6" },
  { kind: "operation", label: "−", operation: "subtract", ariaLabel: "Subtract" },

  { kind: "digit", label: "1", value: "1" },
  { kind: "digit", label: "2", value: "2" },
  { kind: "digit", label: "3", value: "3" },
  { kind: "operation", label: "+", operation: "add", ariaLabel: "Add" },

  { kind: "digit", label: "00", value: "00" },
  { kind: "digit", label: "0", value: "0" },
  { kind: "decimal" },
  { kind: "equals" },
];

export function Keypad({
  onDigit,
  onDecimal,
  onBackspace,
  onClear,
  onOpenParen,
  onCloseParen,
  onOperation,
  onSqrt,
  onPercentage,
  onEquals,
  activeOperation,
  sqrtPending,
  negativePending,
  disabled,
}: KeypadProps) {
  return (
    <div className="keypad">
      {LAYOUT.map((button, index) => {
        switch (button.kind) {
          case "digit":
            return (
              <button
                key={index}
                type="button"
                className="key key-digit"
                disabled={disabled}
                onClick={() => onDigit(button.value)}
              >
                {button.label}
              </button>
            );
          case "decimal":
            return (
              <button
                key={index}
                type="button"
                className="key key-digit"
                disabled={disabled}
                aria-label="Decimal point"
                onClick={onDecimal}
              >
                .
              </button>
            );
          case "backspace":
            return (
              <button
                key={index}
                type="button"
                className="key key-digit"
                disabled={disabled}
                aria-label="Backspace"
                onClick={onBackspace}
              >
                {"⌫"}
              </button>
            );
          case "open-paren":
            return (
              <button
                key={index}
                type="button"
                className="key key-digit"
                disabled={disabled}
                aria-label="Open parenthesis"
                onClick={onOpenParen}
              >
                (
              </button>
            );
          case "close-paren":
            return (
              <button
                key={index}
                type="button"
                className="key key-digit"
                disabled={disabled}
                aria-label="Close parenthesis"
                onClick={onCloseParen}
              >
                )
              </button>
            );
          case "clear":
            return (
              <button
                key={index}
                type="button"
                className="key key-clear"
                disabled={disabled}
                onClick={onClear}
              >
                C
              </button>
            );
          case "equals":
            return (
              <button
                key={index}
                type="button"
                className="key key-equals"
                disabled={disabled}
                aria-label="Equals"
                onClick={onEquals}
              >
                =
              </button>
            );
          case "sqrt":
            // √ is dual-mode too (see useCalculator's applySqrt): press
            // it before typing a number and it stays "engaged" — same
            // highlight as a pending operator — until a digit resolves it.
            return (
              <button
                key={index}
                type="button"
                className={`key key-operation${sqrtPending ? " key-operation-active" : ""}`}
                disabled={disabled}
                aria-label="Square root"
                onClick={onSqrt}
              >
                {"√"}
              </button>
            );
          case "percentage":
            // % is dual-mode (see useCalculator's applyPercentage): it
            // can end up "active" and pending a second number just like
            // a regular operator, so it gets the same highlight.
            return (
              <button
                key={index}
                type="button"
                className={`key key-operation${activeOperation === "percentage" ? " key-operation-active" : ""}`}
                disabled={disabled}
                aria-label="Percentage"
                onClick={onPercentage}
              >
                %
              </button>
            );
          case "operation": {
            // Subtract is dual-mode too (see useCalculator's
            // chooseOperation): pressed with nothing typed yet for the
            // current term, it's the only way to type a negative number
            // (there's no dedicated ± key) and stays "engaged" — same
            // highlight as a pending operator — until a digit resolves
            // it, instead of acting as the subtract operator.
            const isActive =
              activeOperation === button.operation || (button.operation === "subtract" && negativePending);
            return (
              <button
                key={index}
                type="button"
                className={`key key-operation${isActive ? " key-operation-active" : ""}`}
                disabled={disabled}
                aria-label={button.ariaLabel}
                onClick={() => onOperation(button.operation)}
              >
                {button.label}
              </button>
            );
          }
        }
      })}
    </div>
  );
}
