package http

import (
	"log/slog"
	"net/http"
)

// NewRouter wires the handler into HTTP routes and applies the
// middleware chain (CORS -> logging -> panic recovery).
func NewRouter(handler *Handler, allowedOrigins []string, logger *slog.Logger) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("POST /api/v1/calculate", handler.Calculate)
	mux.HandleFunc("POST /api/v1/evaluate", handler.Evaluate)
	mux.HandleFunc("GET /api/v1/health", handler.Health)

	var wrapped http.Handler = mux
	wrapped = corsMiddleware(wrapped, allowedOrigins)
	wrapped = loggingMiddleware(wrapped, logger)
	wrapped = recoverMiddleware(wrapped, logger)

	return wrapped
}
