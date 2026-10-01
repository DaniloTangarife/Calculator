package calculator

import "errors"

// Domain errors: failures that come from the arithmetic rules themselves,
// as opposed to malformed input (which is the service layer's concern).
var (
	ErrDivisionByZero = errors.New("division by zero")
	ErrNegativeSqrt   = errors.New("cannot compute the square root of a negative number")
)
