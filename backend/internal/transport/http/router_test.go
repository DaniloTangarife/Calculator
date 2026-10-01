package http_test

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"calculator-backend/internal/calculator"
	"calculator-backend/internal/service"
	transporthttp "calculator-backend/internal/transport/http"
)

// end-to-end wiring test: real service + real registry behind the
// router, to make sure the pieces are assembled correctly.
func newTestRouter() http.Handler {
	svc := service.NewCalculatorService(calculator.NewRegistry())
	handler := transporthttp.NewHandler(svc, testLogger())
	return transporthttp.NewRouter(handler, []string{"http://localhost:5173"}, testLogger())
}

func TestRouter_CalculateEndToEnd(t *testing.T) {
	router := newTestRouter()

	req := httptest.NewRequest(http.MethodPost, "/api/v1/calculate", strings.NewReader(`{"operation":"multiply","operands":[6,7]}`))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()

	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d (body: %s)", rec.Code, http.StatusOK, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), `"result":42`) {
		t.Fatalf("body = %s, want it to contain result 42", rec.Body.String())
	}
}

func TestRouter_EvaluateEndToEnd(t *testing.T) {
	router := newTestRouter()

	req := httptest.NewRequest(http.MethodPost, "/api/v1/evaluate", strings.NewReader(`{"numbers":[9,8,8,4,1],"operators":["add","multiply","divide","subtract"]}`))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()

	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d (body: %s)", rec.Code, http.StatusOK, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), `"result":24`) {
		t.Fatalf("body = %s, want it to contain result 24", rec.Body.String())
	}
}

func TestRouter_MethodNotAllowed(t *testing.T) {
	router := newTestRouter()

	req := httptest.NewRequest(http.MethodGet, "/api/v1/calculate", nil)
	rec := httptest.NewRecorder()

	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusMethodNotAllowed)
	}
}

func TestRouter_CORSPreflight(t *testing.T) {
	router := newTestRouter()

	req := httptest.NewRequest(http.MethodOptions, "/api/v1/calculate", nil)
	req.Header.Set("Origin", "http://localhost:5173")
	rec := httptest.NewRecorder()

	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusNoContent)
	}
	if got := rec.Header().Get("Access-Control-Allow-Origin"); got != "http://localhost:5173" {
		t.Fatalf("Access-Control-Allow-Origin = %q, want %q", got, "http://localhost:5173")
	}
}
