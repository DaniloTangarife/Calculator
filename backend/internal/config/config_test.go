package config_test

import (
	"reflect"
	"testing"

	"calculator-backend/internal/config"
)

func TestLoad_Defaults(t *testing.T) {
	cfg := config.Load()

	if cfg.Port != "8080" {
		t.Errorf("Port = %q, want %q", cfg.Port, "8080")
	}
	if want := []string{"http://localhost:5173"}; !reflect.DeepEqual(cfg.AllowedOrigins, want) {
		t.Errorf("AllowedOrigins = %v, want %v", cfg.AllowedOrigins, want)
	}
}

func TestLoad_FromEnv(t *testing.T) {
	t.Setenv("PORT", "9090")
	t.Setenv("ALLOWED_ORIGINS", "http://a.test,http://b.test")

	cfg := config.Load()

	if cfg.Port != "9090" {
		t.Errorf("Port = %q, want %q", cfg.Port, "9090")
	}
	if want := []string{"http://a.test", "http://b.test"}; !reflect.DeepEqual(cfg.AllowedOrigins, want) {
		t.Errorf("AllowedOrigins = %v, want %v", cfg.AllowedOrigins, want)
	}
}
