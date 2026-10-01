package calculator

type subtractOperation struct{}

func (subtractOperation) Name() string      { return "subtract" }
func (subtractOperation) OperandCount() int { return 2 }

func (subtractOperation) Apply(operands []float64) (float64, error) {
	return operands[0] - operands[1], nil
}
