package calculator

type percentageOperation struct{}

func (percentageOperation) Name() string      { return "percentage" }
func (percentageOperation) OperandCount() int { return 2 }

// Apply computes operands[0] percent of operands[1].
// Example: Apply([20, 50]) = 10, i.e. "20% of 50 is 10".
func (percentageOperation) Apply(operands []float64) (float64, error) {
	return (operands[0] / 100) * operands[1], nil
}
