// Package config reads runtime configuration from the environment so
// deployment settings (port, allowed origins) never need a code change.
package config

import (
	"os"
	"strings"
)

// Config holds every environment-provided setting the server needs.
type Config struct {
	// Port the HTTP server listens on.
	Port string
	// AllowedOrigins is the list of origins allowed by CORS.
	AllowedOrigins []string
}

// Load builds a Config from environment variables, falling back to
// sensible local-development defaults when they are not set.
func Load() Config {
	return Config{
		Port:           getEnv("PORT", "8080"),
		AllowedOrigins: strings.Split(getEnv("ALLOWED_ORIGINS", "http://localhost:5173"), ","),
	}
}

func getEnv(key, fallback string) string {
	if value, ok := os.LookupEnv(key); ok && value != "" {
		return value
	}
	return fallback
}
