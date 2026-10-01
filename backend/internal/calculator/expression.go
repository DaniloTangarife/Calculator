package calculator

import (
	"errors"
	"fmt"
)

// Domain errors specific to chained expressions.
var (
	ErrMalformedExpression  = errors.New("expression must contain at least one number, with exactly one fewer operator than numbers")
	ErrOperatorNotChainable = errors.New("operator cannot be used in a chained expression")
)

// precedence defines how tightly each chainable operator binds; higher
// values bind first. Only binary infix operators participate in chained
// expressions — sqrt is unary and has no entry here; it's applied
// directly to a single value instead, through Registry.Get. percentage
// ("a% of b") is a binary operator too, and mathematically is a
// multiplication (a/100 * b), so it shares multiply/divide's tier.
var precedence = map[string]int{
	"power":      3,
	"multiply":   2,
	"divide":     2,
	"percentage": 2,
	"add":        1,
	"subtract":   1,
}

const (
	lowestPrecedence  = 1
	highestPrecedence = 3
)

// ExpressionEvaluator evaluates a left-to-right sequence of numbers and
// operators (e.g. 9 + 8 * 8 / 4 - 1) respecting standard operator
// precedence: power before multiply/divide before add/subtract, left to
// right within the same tier. Parentheses are not supported — the
// keypad has no way to enter them, so a full expression parser would be
// complexity this project doesn't need yet.
type ExpressionEvaluator struct {
	registry *Registry
}

// NewExpressionEvaluator creates an ExpressionEvaluator backed by registry.
func NewExpressionEvaluator(registry *Registry) *ExpressionEvaluator {
	return &ExpressionEvaluator{registry: registry}
}

// Evaluate computes the result of numbers combined by operators, where
// operators[i] applies between numbers[i] and numbers[i+1]. len(numbers)
// must equal len(operators)+1.
func (e *ExpressionEvaluator) Evaluate(numbers []float64, operators []string) (float64, error) {
	if len(numbers) == 0 || len(numbers) != len(operators)+1 {
		return 0, ErrMalformedExpression
	}

	for _, name := range operators {
		if _, ok := precedence[name]; !ok {
			return 0, fmt.Errorf("%w: %q", ErrOperatorNotChainable, name)
		}
	}

	nums := append([]float64(nil), numbers...)
	ops := append([]string(nil), operators...)

	for level := highestPrecedence; level >= lowestPrecedence; level-- {
		i := 0
		for i < len(ops) {
			if precedence[ops[i]] != level {
				i++
				continue
			}

			op, _ := e.registry.Get(ops[i]) // guaranteed present: every precedence key is a registered operation
			result, err := op.Apply([]float64{nums[i], nums[i+1]})
			if err != nil {
				return 0, err
			}

			nums[i] = result
			nums = append(nums[:i+1], nums[i+2:]...)
			ops = append(ops[:i], ops[i+1:]...)
		}
	}

	return nums[0], nil
}
