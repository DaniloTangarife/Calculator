package calculator

type multiplyOperation struct{}

func (multiplyOperation) Name() string      { return "multiply" }
func (multiplyOperation) OperandCount() int { return 2 }

func (multiplyOperation) Apply(operands []float64) (float64, error) {
	return operands[0] * operands[1], nil
}
