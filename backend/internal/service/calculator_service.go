// Package service orchestrates the calculator's use case: validate the
// caller's input at the boundary, then delegate the actual arithmetic to
// the calculator package.
package service

import (
	"fmt"
	"math"

	"calculator-backend/internal/calculator"
)

// CalculatorService validates a requested operation and its operands,
// then executes it. It depends only on calculator.Registry, which is
// enough to keep this type honest and fast to test: the operations it
// delegates to are pure functions, so exercising it against the real
// registry is still a true unit test.
type CalculatorService struct {
	registry  *calculator.Registry
	evaluator *calculator.ExpressionEvaluator
}

// NewCalculatorService creates a CalculatorService backed by registry.
func NewCalculatorService(registry *calculator.Registry) *CalculatorService {
	return &CalculatorService{
		registry:  registry,
		evaluator: calculator.NewExpressionEvaluator(registry),
	}
}

// Calculate validates operationName and operands, then executes the
// operation. Validation happens here (the boundary between untrusted
// input and the domain) so individual operations can assume their
// inputs are well-formed.
func (s *CalculatorService) Calculate(operationName string, operands []float64) (float64, error) {
	op, ok := s.registry.Get(operationName)
	if !ok {
		return 0, fmt.Errorf("%w: %q", ErrUnknownOperation, operationName)
	}

	if len(operands) != op.OperandCount() {
		return 0, fmt.Errorf("%w: %q expects %d operand(s), got %d",
			ErrInvalidOperandCount, op.Name(), op.OperandCount(), len(operands))
	}

	if err := rejectNaN(operands); err != nil {
		return 0, err
	}

	return op.Apply(operands)
}

// EvaluateExpression validates numbers at the boundary (the same rule
// Calculate applies), then delegates precedence handling to
// calculator.ExpressionEvaluator, which owns the rest of the validation
// (operand/operator count, chainable operators).
func (s *CalculatorService) EvaluateExpression(numbers []float64, operators []string) (float64, error) {
	if err := rejectNaN(numbers); err != nil {
		return 0, err
	}
	return s.evaluator.Evaluate(numbers, operators)
}

// rejectNaN rejects NaN operands only, not +/-Infinity: an earlier
// result can legitimately be infinite (e.g. 4^1000 overflows float64),
// and the user should be able to keep operating on it — ∞ - 5 is still
// ∞, not a blocked operation. NaN has no such legitimate origin here,
// so it's still treated as invalid input.
func rejectNaN(operands []float64) error {
	for _, operand := range operands {
		if math.IsNaN(operand) {
			return fmt.Errorf("%w: got %v", ErrInvalidOperand, operand)
		}
	}
	return nil
}
