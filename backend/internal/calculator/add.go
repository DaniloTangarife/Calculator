package calculator

type addOperation struct{}

func (addOperation) Name() string      { return "add" }
func (addOperation) OperandCount() int { return 2 }

func (addOperation) Apply(operands []float64) (float64, error) {
	return operands[0] + operands[1], nil
}
