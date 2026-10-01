package calculator_test

import (
	"errors"
	"math"
	"testing"

	"calculator-backend/internal/calculator"
)

func TestRegistry_Operations(t *testing.T) {
	registry := calculator.NewRegistry()

	tests := []struct {
		name     string
		opName   string
		operands []float64
		want     float64
		wantErr  error
	}{
		{"add positive numbers", "add", []float64{2, 3}, 5, nil},
		{"add negative numbers", "add", []float64{-2, -3}, -5, nil},
		{"subtract", "subtract", []float64{5, 3}, 2, nil},
		{"subtract resulting in negative", "subtract", []float64{3, 5}, -2, nil},
		{"multiply", "multiply", []float64{4, 3}, 12, nil},
		{"multiply by zero", "multiply", []float64{4, 0}, 0, nil},
		{"divide", "divide", []float64{10, 2}, 5, nil},
		{"divide by zero", "divide", []float64{10, 0}, 0, calculator.ErrDivisionByZero},
		{"power", "power", []float64{2, 10}, 1024, nil},
		{"power by zero exponent", "power", []float64{5, 0}, 1, nil},
		{"sqrt", "sqrt", []float64{16}, 4, nil},
		{"sqrt of zero", "sqrt", []float64{0}, 0, nil},
		{"sqrt of negative number", "sqrt", []float64{-4}, 0, calculator.ErrNegativeSqrt},
		{"percentage", "percentage", []float64{20, 50}, 10, nil},
		{"percentage of zero", "percentage", []float64{50, 0}, 0, nil},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			op, ok := registry.Get(tt.opName)
			if !ok {
				t.Fatalf("operation %q not found in registry", tt.opName)
			}

			got, err := op.Apply(tt.operands)

			if !errors.Is(err, tt.wantErr) {
				t.Fatalf("Apply(%v) error = %v, want %v", tt.operands, err, tt.wantErr)
			}
			if tt.wantErr == nil && !almostEqual(got, tt.want) {
				t.Fatalf("Apply(%v) = %v, want %v", tt.operands, got, tt.want)
			}
		})
	}
}

func TestRegistry_OperandCounts(t *testing.T) {
	registry := calculator.NewRegistry()

	tests := []struct {
		opName string
		want   int
	}{
		{"add", 2},
		{"subtract", 2},
		{"multiply", 2},
		{"divide", 2},
		{"power", 2},
		{"sqrt", 1},
		{"percentage", 2},
	}

	for _, tt := range tests {
		t.Run(tt.opName, func(t *testing.T) {
			op, ok := registry.Get(tt.opName)
			if !ok {
				t.Fatalf("operation %q not found in registry", tt.opName)
			}
			if got := op.OperandCount(); got != tt.want {
				t.Fatalf("OperandCount() = %d, want %d", got, tt.want)
			}
		})
	}
}

func TestRegistry_UnknownOperation(t *testing.T) {
	registry := calculator.NewRegistry()

	if _, ok := registry.Get("modulo"); ok {
		t.Fatal("expected unknown operation \"modulo\" to not be found")
	}
}

func almostEqual(a, b float64) bool {
	return math.Abs(a-b) < 1e-9
}
