package calculator

type divideOperation struct{}

func (divideOperation) Name() string      { return "divide" }
func (divideOperation) OperandCount() int { return 2 }

func (divideOperation) Apply(operands []float64) (float64, error) {
	if operands[1] == 0 {
		return 0, ErrDivisionByZero
	}
	return operands[0] / operands[1], nil
}
