// Package http adapts the calculator use case to HTTP: decoding
// requests, encoding responses, and mapping domain/service errors to
// status codes. It knows nothing about arithmetic itself.
package http

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"

	"calculator-backend/internal/calculator"
	"calculator-backend/internal/service"
)

// Calculator is the use case this handler depends on. Depending on an
// interface (instead of *service.CalculatorService directly) keeps the
// handler testable with a stub, without needing a real registry.
type Calculator interface {
	Calculate(operation string, operands []float64) (float64, error)
	EvaluateExpression(numbers []float64, operators []string) (float64, error)
}

// Handler exposes the calculator use case over HTTP.
type Handler struct {
	calculator Calculator
	logger     *slog.Logger
}

// NewHandler creates a Handler backed by calc, logging unexpected
// errors through logger.
func NewHandler(calc Calculator, logger *slog.Logger) *Handler {
	return &Handler{calculator: calc, logger: logger}
}

// Calculate handles POST /api/v1/calculate.
func (h *Handler) Calculate(w http.ResponseWriter, r *http.Request) {
	var req calculateRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_JSON", "request body is not valid JSON")
		return
	}

	result, err := h.calculator.Calculate(req.Operation, toFloats(req.Operands))
	if err != nil {
		h.writeCalculationError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, calculateResponse{Result: resultValue(result)})
}

// Evaluate handles POST /api/v1/evaluate: a chained expression such as
// "9 + 8 * 8 / 4 - 1", evaluated with standard operator precedence.
func (h *Handler) Evaluate(w http.ResponseWriter, r *http.Request) {
	var req evaluateRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_JSON", "request body is not valid JSON")
		return
	}

	result, err := h.calculator.EvaluateExpression(toFloats(req.Numbers), req.Operators)
	if err != nil {
		h.writeCalculationError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, calculateResponse{Result: resultValue(result)})
}

// Health handles GET /api/v1/health, used by orchestrators and Docker
// healthchecks to know the service is up.
func (h *Handler) Health(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

// writeCalculationError maps a service/domain error to an HTTP status
// and a stable machine-readable code. Anything not explicitly
// recognized is treated as an internal error and its details are
// logged but not leaked to the client.
func (h *Handler) writeCalculationError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, calculator.ErrDivisionByZero):
		writeError(w, http.StatusBadRequest, "DIVISION_BY_ZERO", err.Error())
	case errors.Is(err, calculator.ErrNegativeSqrt):
		writeError(w, http.StatusBadRequest, "NEGATIVE_SQRT", err.Error())
	case errors.Is(err, service.ErrUnknownOperation):
		writeError(w, http.StatusBadRequest, "UNKNOWN_OPERATION", err.Error())
	case errors.Is(err, service.ErrInvalidOperandCount):
		writeError(w, http.StatusBadRequest, "INVALID_OPERAND_COUNT", err.Error())
	case errors.Is(err, service.ErrInvalidOperand):
		writeError(w, http.StatusBadRequest, "INVALID_OPERAND", err.Error())
	case errors.Is(err, calculator.ErrMalformedExpression):
		writeError(w, http.StatusBadRequest, "EXPRESSION_MALFORMED", err.Error())
	case errors.Is(err, calculator.ErrOperatorNotChainable):
		writeError(w, http.StatusBadRequest, "OPERATOR_NOT_CHAINABLE", err.Error())
	default:
		h.logger.Error("unexpected calculation error", "error", err)
		writeError(w, http.StatusInternalServerError, "INTERNAL_ERROR", "unexpected error")
	}
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

func writeError(w http.ResponseWriter, status int, code, message string) {
	writeJSON(w, status, errorResponse{Error: errorBody{Code: code, Message: message}})
}
