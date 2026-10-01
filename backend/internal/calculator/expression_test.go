package calculator_test

import (
	"errors"
	"math"
	"testing"

	"calculator-backend/internal/calculator"
)

func newEvaluator() *calculator.ExpressionEvaluator {
	return calculator.NewExpressionEvaluator(calculator.NewRegistry())
}

func TestExpressionEvaluator_Evaluate(t *testing.T) {
	tests := []struct {
		name      string
		numbers   []float64
		operators []string
		want      float64
	}{
		{
			name:      "precedence over left-to-right: 9 + 8*8/4 - 1",
			numbers:   []float64{9, 8, 8, 4, 1},
			operators: []string{"add", "multiply", "divide", "subtract"},
			want:      24,
		},
		{
			name:      "single number, no operators",
			numbers:   []float64{42},
			operators: nil,
			want:      42,
		},
		{
			name:      "power binds tighter than multiply",
			numbers:   []float64{2, 3, 2},
			operators: []string{"multiply", "power"},
			want:      18, // 2 * (3^2)
		},
		{
			name:      "same-tier operators evaluate left to right",
			numbers:   []float64{20, 2, 5},
			operators: []string{"divide", "multiply"},
			want:      50, // (20/2)*5
		},
		{
			name:      "chain of only additions and subtractions",
			numbers:   []float64{10, 3, 2},
			operators: []string{"subtract", "add"},
			want:      9,
		},
		{
			name:      "percentage: 50% of 10",
			numbers:   []float64{50, 10},
			operators: []string{"percentage"},
			want:      5,
		},
		{
			name:      "percentage shares multiply/divide's precedence tier",
			numbers:   []float64{9, 50, 10},
			operators: []string{"add", "percentage"},
			want:      14, // 9 + (50% of 10) = 9 + 5
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := newEvaluator().Evaluate(tt.numbers, tt.operators)
			if err != nil {
				t.Fatalf("Evaluate() unexpected error: %v", err)
			}
			if math.Abs(got-tt.want) > 1e-9 {
				t.Fatalf("Evaluate() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestExpressionEvaluator_Errors(t *testing.T) {
	tests := []struct {
		name      string
		numbers   []float64
		operators []string
		wantErr   error
	}{
		{"empty expression", nil, nil, calculator.ErrMalformedExpression},
		{"one operator too many", []float64{1, 2}, []string{"add", "add"}, calculator.ErrMalformedExpression},
		{"one operator too few", []float64{1, 2, 3}, []string{"add"}, calculator.ErrMalformedExpression},
		{"sqrt is not chainable", []float64{9, 4}, []string{"sqrt"}, calculator.ErrOperatorNotChainable},
		{"unknown operator", []float64{9, 4}, []string{"modulo"}, calculator.ErrOperatorNotChainable},
		{"division by zero propagates mid-expression", []float64{9, 1, 0}, []string{"add", "divide"}, calculator.ErrDivisionByZero},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := newEvaluator().Evaluate(tt.numbers, tt.operators)
			if !errors.Is(err, tt.wantErr) {
				t.Fatalf("Evaluate() error = %v, want %v", err, tt.wantErr)
			}
		})
	}
}
