package service

import "errors"

// Input errors: failures caused by what the caller asked for, as
// opposed to the arithmetic rules themselves (see the calculator package).
var (
	ErrUnknownOperation    = errors.New("unknown operation")
	ErrInvalidOperandCount = errors.New("invalid number of operands")
	ErrInvalidOperand      = errors.New("operand must be a finite number")
)
