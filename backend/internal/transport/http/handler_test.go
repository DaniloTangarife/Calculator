package http_test

import (
	"errors"
	"io"
	"log/slog"
	"math"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"calculator-backend/internal/calculator"
	"calculator-backend/internal/service"
	transporthttp "calculator-backend/internal/transport/http"
)

// stubCalculator lets handler tests control exactly what the use case
// returns, including errors the real service would never produce
// (e.g. an unmapped error), without needing a real registry.
type stubCalculator struct {
	result float64
	err    error
}

func (s stubCalculator) Calculate(_ string, _ []float64) (float64, error) {
	return s.result, s.err
}

func (s stubCalculator) EvaluateExpression(_ []float64, _ []string) (float64, error) {
	return s.result, s.err
}

func testLogger() *slog.Logger {
	return slog.New(slog.NewTextHandler(io.Discard, nil))
}

func TestHandler_Calculate(t *testing.T) {
	tests := []struct {
		name       string
		body       string
		stub       stubCalculator
		wantStatus int
		wantBody   string
	}{
		{
			name:       "successful calculation",
			body:       `{"operation":"add","operands":[2,3]}`,
			stub:       stubCalculator{result: 5},
			wantStatus: http.StatusOK,
			wantBody:   `{"result":5}`,
		},
		{
			name:       "malformed json returns 400",
			body:       `{not-json`,
			stub:       stubCalculator{},
			wantStatus: http.StatusBadRequest,
			wantBody:   `"code":"INVALID_JSON"`,
		},
		{
			name:       "division by zero maps to 400",
			body:       `{"operation":"divide","operands":[1,0]}`,
			stub:       stubCalculator{err: calculator.ErrDivisionByZero},
			wantStatus: http.StatusBadRequest,
			wantBody:   `"code":"DIVISION_BY_ZERO"`,
		},
		{
			name:       "negative sqrt maps to 400",
			body:       `{"operation":"sqrt","operands":[-4]}`,
			stub:       stubCalculator{err: calculator.ErrNegativeSqrt},
			wantStatus: http.StatusBadRequest,
			wantBody:   `"code":"NEGATIVE_SQRT"`,
		},
		{
			name:       "unknown operation maps to 400",
			body:       `{"operation":"modulo","operands":[1,2]}`,
			stub:       stubCalculator{err: service.ErrUnknownOperation},
			wantStatus: http.StatusBadRequest,
			wantBody:   `"code":"UNKNOWN_OPERATION"`,
		},
		{
			name:       "invalid operand count maps to 400",
			body:       `{"operation":"add","operands":[1]}`,
			stub:       stubCalculator{err: service.ErrInvalidOperandCount},
			wantStatus: http.StatusBadRequest,
			wantBody:   `"code":"INVALID_OPERAND_COUNT"`,
		},
		{
			name:       "invalid operand maps to 400",
			body:       `{"operation":"add","operands":[1,2]}`,
			stub:       stubCalculator{err: service.ErrInvalidOperand},
			wantStatus: http.StatusBadRequest,
			wantBody:   `"code":"INVALID_OPERAND"`,
		},
		{
			name:       "unmapped error defaults to 500",
			body:       `{"operation":"add","operands":[1,2]}`,
			stub:       stubCalculator{err: errors.New("boom")},
			wantStatus: http.StatusInternalServerError,
			wantBody:   `"code":"INTERNAL_ERROR"`,
		},
		{
			name:       "a result that overflows float64 serializes as the string Infinity, not a failed encode",
			body:       `{"operation":"power","operands":[4,1000]}`,
			stub:       stubCalculator{result: math.Inf(1)},
			wantStatus: http.StatusOK,
			wantBody:   `{"result":"Infinity"}`,
		},
		{
			name:       "a negative overflow serializes as the string -Infinity",
			body:       `{"operation":"power","operands":[-4,1001]}`,
			stub:       stubCalculator{result: math.Inf(-1)},
			wantStatus: http.StatusOK,
			wantBody:   `{"result":"-Infinity"}`,
		},
		{
			name:       "an undefined result (e.g. Infinity - Infinity) serializes as the string NaN",
			body:       `{"operation":"add","operands":[1,2]}`,
			stub:       stubCalculator{result: math.NaN()},
			wantStatus: http.StatusOK,
			wantBody:   `{"result":"NaN"}`,
		},
		{
			name:       "an operand sent as the string -Infinity decodes to a real negative-infinite operand",
			body:       `{"operation":"add","operands":["-Infinity",5]}`,
			stub:       stubCalculator{result: math.Inf(-1)},
			wantStatus: http.StatusOK,
			wantBody:   `{"result":"-Infinity"}`,
		},
		{
			name:       "an operand that's neither a number nor a known sentinel string is rejected as malformed JSON",
			body:       `{"operation":"add","operands":["banana",1]}`,
			stub:       stubCalculator{},
			wantStatus: http.StatusBadRequest,
			wantBody:   `"code":"INVALID_JSON"`,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			handler := transporthttp.NewHandler(tt.stub, testLogger())

			req := httptest.NewRequest(http.MethodPost, "/api/v1/calculate", strings.NewReader(tt.body))
			rec := httptest.NewRecorder()

			handler.Calculate(rec, req)

			if rec.Code != tt.wantStatus {
				t.Fatalf("status = %d, want %d (body: %s)", rec.Code, tt.wantStatus, rec.Body.String())
			}
			if !strings.Contains(rec.Body.String(), tt.wantBody) {
				t.Fatalf("body = %s, want it to contain %s", rec.Body.String(), tt.wantBody)
			}
		})
	}
}

func TestHandler_Evaluate(t *testing.T) {
	tests := []struct {
		name       string
		body       string
		stub       stubCalculator
		wantStatus int
		wantBody   string
	}{
		{
			name:       "successful expression",
			body:       `{"numbers":[9,8,8,4,1],"operators":["add","multiply","divide","subtract"]}`,
			stub:       stubCalculator{result: 24},
			wantStatus: http.StatusOK,
			wantBody:   `{"result":24}`,
		},
		{
			name:       "malformed json returns 400",
			body:       `{not-json`,
			stub:       stubCalculator{},
			wantStatus: http.StatusBadRequest,
			wantBody:   `"code":"INVALID_JSON"`,
		},
		{
			name:       "malformed expression maps to 400",
			body:       `{"numbers":[1,2],"operators":["add","add"]}`,
			stub:       stubCalculator{err: calculator.ErrMalformedExpression},
			wantStatus: http.StatusBadRequest,
			wantBody:   `"code":"EXPRESSION_MALFORMED"`,
		},
		{
			name:       "non-chainable operator maps to 400",
			body:       `{"numbers":[9,4],"operators":["sqrt"]}`,
			stub:       stubCalculator{err: calculator.ErrOperatorNotChainable},
			wantStatus: http.StatusBadRequest,
			wantBody:   `"code":"OPERATOR_NOT_CHAINABLE"`,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			handler := transporthttp.NewHandler(tt.stub, testLogger())

			req := httptest.NewRequest(http.MethodPost, "/api/v1/evaluate", strings.NewReader(tt.body))
			rec := httptest.NewRecorder()

			handler.Evaluate(rec, req)

			if rec.Code != tt.wantStatus {
				t.Fatalf("status = %d, want %d (body: %s)", rec.Code, tt.wantStatus, rec.Body.String())
			}
			if !strings.Contains(rec.Body.String(), tt.wantBody) {
				t.Fatalf("body = %s, want it to contain %s", rec.Body.String(), tt.wantBody)
			}
		})
	}
}

func TestHandler_Health(t *testing.T) {
	handler := transporthttp.NewHandler(stubCalculator{}, testLogger())

	req := httptest.NewRequest(http.MethodGet, "/api/v1/health", nil)
	rec := httptest.NewRecorder()

	handler.Health(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusOK)
	}
	if !strings.Contains(rec.Body.String(), `"status":"ok"`) {
		t.Fatalf("body = %s, want it to contain status ok", rec.Body.String())
	}
}

// Regression: continuing a chained expression from an infinite earlier
// result (e.g. 4^1000, then "- 5") used to silently use 0 for that
// operand instead — JS's JSON.stringify(Infinity) serializes to the
// JSON literal null, which decoded as a bare 0. The frontend now sends
// the same "Infinity"/"-Infinity" sentinel strings the backend's own
// responses use, so this exercises the real service end to end
// (decode -> compute -> encode), not a stub, to prove the whole round
// trip actually stays infinite.
func TestHandler_Evaluate_ContinuesFromInfinityOperand(t *testing.T) {
	realService := service.NewCalculatorService(calculator.NewRegistry())
	handler := transporthttp.NewHandler(realService, testLogger())

	req := httptest.NewRequest(http.MethodPost, "/api/v1/evaluate",
		strings.NewReader(`{"numbers":["Infinity",5],"operators":["subtract"]}`))
	rec := httptest.NewRecorder()

	handler.Evaluate(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d (body: %s)", rec.Code, http.StatusOK, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), `{"result":"Infinity"}`) {
		t.Fatalf("body = %s, want it to contain {\"result\":\"Infinity\"}", rec.Body.String())
	}
}
