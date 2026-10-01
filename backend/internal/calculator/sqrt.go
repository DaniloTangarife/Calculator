package calculator

import "math"

type sqrtOperation struct{}

func (sqrtOperation) Name() string      { return "sqrt" }
func (sqrtOperation) OperandCount() int { return 1 }

func (sqrtOperation) Apply(operands []float64) (float64, error) {
	if operands[0] < 0 {
		return 0, ErrNegativeSqrt
	}
	return math.Sqrt(operands[0]), nil
}
