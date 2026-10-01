import { Display } from "./Display";
import { Keypad } from "./Keypad";
import { useCalculator } from "../hooks/useCalculator";

export function Calculator() {
  const calculator = useCalculator();

  return (
    <div className="calculator">
      <Display
        expression={calculator.expression}
        preview={calculator.preview}
        result={calculator.result}
        error={calculator.error}
      />
      <Keypad
        onDigit={calculator.inputDigit}
        onDecimal={calculator.inputDecimal}
        onBackspace={calculator.backspace}
        onClear={calculator.clear}
        onOpenParen={calculator.openParen}
        onCloseParen={calculator.closeParen}
        onOperation={calculator.chooseOperation}
        onSqrt={calculator.applySqrt}
        onPercentage={calculator.applyPercentage}
        onEquals={calculator.equals}
        activeOperation={calculator.activeOperation}
        sqrtPending={calculator.sqrtPending}
        negativePending={calculator.negativePending}
        disabled={calculator.isLoading}
      />
    </div>
  );
}
