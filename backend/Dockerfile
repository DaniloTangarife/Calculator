# ---- build stage ----
FROM golang:1.23-alpine AS builder
WORKDIR /app

COPY go.mod ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -o /out/calculator-api ./cmd/api

# ---- run stage ----
FROM alpine:3.20
RUN adduser -D -u 10001 appuser
COPY --from=builder /out/calculator-api /usr/local/bin/calculator-api

USER appuser
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=3s --retries=3 \
  CMD wget --spider -q http://localhost:8080/api/v1/health || exit 1

ENTRYPOINT ["calculator-api"]
