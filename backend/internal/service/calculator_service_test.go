package service_test

import (
	"errors"
	"math"
	"testing"

	"calculator-backend/internal/calculator"
	"calculator-backend/internal/service"
)

func newService() *service.CalculatorService {
	return service.NewCalculatorService(calculator.NewRegistry())
}

func TestCalculatorService_Calculate_Success(t *testing.T) {
	svc := newService()

	tests := []struct {
		name      string
		operation string
		operands  []float64
		want      float64
	}{
		{"add", "add", []float64{2, 3}, 5},
		{"subtract", "subtract", []float64{10, 4}, 6},
		{"multiply", "multiply", []float64{6, 7}, 42},
		{"divide", "divide", []float64{20, 4}, 5},
		{"power", "power", []float64{2, 8}, 256},
		{"sqrt", "sqrt", []float64{81}, 9},
		{"percentage", "percentage", []float64{50, 200}, 100},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := svc.Calculate(tt.operation, tt.operands)
			if err != nil {
				t.Fatalf("Calculate() unexpected error: %v", err)
			}
			if math.Abs(got-tt.want) > 1e-9 {
				t.Fatalf("Calculate() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestCalculatorService_Calculate_Errors(t *testing.T) {
	svc := newService()

	tests := []struct {
		name      string
		operation string
		operands  []float64
		wantErr   error
	}{
		{"unknown operation", "modulo", []float64{2, 3}, service.ErrUnknownOperation},
		{"too few operands", "add", []float64{2}, service.ErrInvalidOperandCount},
		{"too many operands", "sqrt", []float64{4, 5}, service.ErrInvalidOperandCount},
		{"no operands at all", "add", nil, service.ErrInvalidOperandCount},
		{"NaN operand", "add", []float64{math.NaN(), 1}, service.ErrInvalidOperand},
		{"positive infinity operand", "add", []float64{math.Inf(1), 1}, service.ErrInvalidOperand},
		{"negative infinity operand", "add", []float64{math.Inf(-1), 1}, service.ErrInvalidOperand},
		{"division by zero propagates from domain", "divide", []float64{1, 0}, calculator.ErrDivisionByZero},
		{"negative sqrt propagates from domain", "sqrt", []float64{-9}, calculator.ErrNegativeSqrt},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := svc.Calculate(tt.operation, tt.operands)
			if !errors.Is(err, tt.wantErr) {
				t.Fatalf("Calculate() error = %v, want %v", err, tt.wantErr)
			}
		})
	}
}

func TestCalculatorService_EvaluateExpression_Success(t *testing.T) {
	svc := newService()

	got, err := svc.EvaluateExpression([]float64{9, 8, 8, 4, 1}, []string{"add", "multiply", "divide", "subtract"})
	if err != nil {
		t.Fatalf("EvaluateExpression() unexpected error: %v", err)
	}
	if math.Abs(got-24) > 1e-9 {
		t.Fatalf("EvaluateExpression() = %v, want 24", got)
	}
}

func TestCalculatorService_EvaluateExpression_Errors(t *testing.T) {
	svc := newService()

	tests := []struct {
		name      string
		numbers   []float64
		operators []string
		wantErr   error
	}{
		{"malformed expression", []float64{1, 2}, []string{"add", "add"}, calculator.ErrMalformedExpression},
		{"non-chainable operator", []float64{9, 4}, []string{"sqrt"}, calculator.ErrOperatorNotChainable},
		{"NaN operand", []float64{math.NaN(), 1}, []string{"add"}, service.ErrInvalidOperand},
		{"division by zero mid expression", []float64{9, 1, 0}, []string{"add", "divide"}, calculator.ErrDivisionByZero},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := svc.EvaluateExpression(tt.numbers, tt.operators)
			if !errors.Is(err, tt.wantErr) {
				t.Fatalf("EvaluateExpression() error = %v, want %v", err, tt.wantErr)
			}
		})
	}
}
