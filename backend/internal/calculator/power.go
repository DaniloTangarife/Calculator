package calculator

import "math"

type powerOperation struct{}

func (powerOperation) Name() string      { return "power" }
func (powerOperation) OperandCount() int { return 2 }

// Apply raises operands[0] to the power of operands[1].
func (powerOperation) Apply(operands []float64) (float64, error) {
	return math.Pow(operands[0], operands[1]), nil
}
