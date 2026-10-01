// Package calculator contains the calculator's core business rules:
// the arithmetic operations themselves, independent of how they are
// invoked (HTTP, CLI, tests, etc.).
package calculator

// Operation represents a single arithmetic operation that can be applied
// to a fixed number of operands. Each operation knows how many operands
// it needs and how to validate its own domain-specific constraints
// (e.g. division by zero), keeping that knowledge in one place instead
// of scattered across callers.
type Operation interface {
	// Name returns the operation's unique identifier, e.g. "add".
	Name() string
	// OperandCount returns how many operands this operation expects.
	OperandCount() int
	// Apply executes the operation. Callers must pass exactly
	// OperandCount() operands; implementations do not re-check the
	// count, since that is the caller's responsibility (see service.CalculatorService).
	Apply(operands []float64) (float64, error)
}
