# Full-Stack Calculator

A calculator application with a Go REST API backend and a React + TypeScript
frontend. All arithmetic is performed server-side; the frontend is
responsible only for input, display, and talking to the API.

## Table of Contents

- [Overview](#overview)
- [Prerequisites](#prerequisites)
- [Project Structure](#project-structure)
- [Running the Project](#running-the-project)
- [API Reference](#api-reference)
- [Tests & Coverage](#tests--coverage)
- [Design Decisions & Assumptions](#design-decisions--assumptions)
- [Possible Improvements](#possible-improvements)

## Overview

The project is a monorepo with two independently deployable pieces:

```
┌─────────────────────┐        HTTP/JSON        ┌──────────────────────────┐
│  frontend (React)   │ ───────────────────────▶ │  backend (Go REST API)  │
│  Vite + TypeScript  │ ◀─────────────────────── │  net/http, no framework │
└─────────────────────┘                          └──────────────────────────┘
```

**Backend** — a single Go service with three layers, each with one
responsibility and depending only on the layer below it:

- `internal/transport/http` — decodes requests, encodes responses, maps
  errors to HTTP status codes. Knows nothing about arithmetic.
- `internal/service` — validates input at the boundary (unknown operation,
  wrong operand count, non-finite numbers) and delegates to the domain.
- `internal/calculator` — the arithmetic rules themselves: an `Operation`
  interface with one implementation per operation (Strategy pattern), a
  `Registry` that looks operations up by name, and an `ExpressionEvaluator`
  that evaluates a chained expression (e.g. `9 + 8 * 8 / 4 - 1`) respecting
  standard operator precedence.

This keeps the domain logic (`calculator`) completely free of HTTP
concerns and easy to unit test, while the HTTP handler can be tested with a
stub instead of a real service. There's no ORM, no database, and no
framework: a calculator's state is just "the current input," so none of
that machinery would pay for itself here (see
[Design Decisions](#design-decisions--assumptions)).

**Frontend** — a small component tree driven by one custom hook:

- `hooks/useCalculator` — all calculator state (a `useReducer`) and the
  async calls to the backend. This is where the "what happens when you
  press a key" logic lives: building up a chained expression
  (`terms`/`operators`), optionally with parenthesized groups
  (`parenStack`), live-previewing it on every keystroke, backspace, and
  a `window` `keydown` listener for physical-keyboard input (see
  [Design Decisions](#design-decisions--assumptions)).
- `components/Calculator` — composes `Display` and `Keypad`. `Display`
  shows an error inline, in the same small line the live preview uses,
  instead of a separate alert banner (see
  [Design Decisions](#design-decisions--assumptions)).
- `services/calculatorApi` — the only place that knows the backend's URL
  and JSON shape.

No client-side state management library, no CSS framework, no client-side
arithmetic: the requirement is that the **backend** computes results, so
the frontend's job is strictly UI state and one HTTP call per operation.

## Prerequisites

| Tool           | Version used in this project |
| -------------- | ----------------------------- |
| Go             | 1.23+                         |
| Node.js        | 22+ (20+ should also work)    |
| npm            | 10+                            |
| Docker         | 24+ with Compose v2 (`docker compose`) |

You only need Go and Node installed if you want to run the services
**outside** Docker. Running everything with Docker Compose only requires
Docker itself.

## Project Structure

```
.
├── backend/                 # Go REST API
│   ├── cmd/api/              # main.go — wires everything together
│   ├── internal/
│   │   ├── calculator/       # domain: Operation interface + implementations
│   │   ├── service/          # input validation + orchestration
│   │   ├── transport/http/   # handlers, routing, middleware, DTOs
│   │   └── config/           # environment-based configuration
│   └── Dockerfile
├── frontend/                 # React + TypeScript (Vite)
│   ├── src/
│   │   ├── components/       # Calculator, Display, Keypad
│   │   ├── hooks/             # useCalculator (state + API orchestration)
│   │   ├── services/          # calculatorApi (fetch wrapper)
│   │   ├── types/              # shared TS types
│   │   └── utils/               # formatResult, buildExpressionText, operator symbols
│   └── Dockerfile
├── docker-compose.yml         # runs both services together
└── .github/workflows/          # CI: backend, frontend, docker build
```

## Running the Project

### Option A — Docker Compose (recommended, runs both services)

```bash
docker compose up --build
```

- Backend: http://localhost:8080
- Frontend: http://localhost:5173

Stop with `docker compose down`.

### Option B — Backend and frontend locally

**Backend** (from `backend/`):

```bash
go run ./cmd/api
```

The server listens on `:8080` by default. Configuration is read from
environment variables (see [Configuration](#configuration)) — nothing is
hardcoded.

**Frontend** (from `frontend/`):

```bash
npm install
cp .env.example .env   # sets VITE_API_URL=http://localhost:8080
npm run dev
```

The dev server runs on http://localhost:5173 and proxies API calls
directly to `VITE_API_URL` from the browser (no dev proxy needed since the
backend already sends permissive-but-explicit CORS headers for that
origin).

### Keyboard shortcuts

The calculator also accepts physical-keyboard input (no field needs to be
focused first):

| Key(s)                    | Action                          |
| -------------------------- | -------------------------------- |
| `0`-`9`, `.`                | Digits, decimal point            |
| `+` `-` `*` or `x` `/` `^`  | add, subtract, multiply, divide, power |
| `%`                         | Percentage (same as the `%` key) |
| `(` `)`                     | Open / close a group             |
| `Enter` or `=`               | Equals                           |
| `Backspace`                  | Delete the last character        |
| `Escape` or `Delete`         | Clear (same as `C`)              |

### Configuration

The backend reads two environment variables, both optional:

| Variable          | Default                   | Purpose                              |
| ------------------ | -------------------------- | ------------------------------------- |
| `PORT`              | `8080`                      | HTTP port the server listens on       |
| `ALLOWED_ORIGINS`   | `http://localhost:5173`     | Comma-separated list of CORS origins  |

The frontend reads one build-time variable:

| Variable          | Default                   | Purpose                    |
| ------------------ | -------------------------- | --------------------------- |
| `VITE_API_URL`      | `http://localhost:8080`     | Base URL of the backend API |

## API Reference

### `POST /api/v1/calculate`

Request body:

```json
{ "operation": "add", "operands": [2, 3] }
```

| Operation     | Operand count | Semantics                         |
| ------------- | -------------- | ---------------------------------- |
| `add`          | 2              | `a + b`                             |
| `subtract`     | 2              | `a - b`                             |
| `multiply`     | 2              | `a * b`                             |
| `divide`       | 2              | `a / b`                             |
| `power`        | 2              | `a ^ b`                             |
| `sqrt`         | 1              | `√a`                                 |
| `percentage`   | 2              | `a% of b`, e.g. `[20, 50] → 10`. The UI's `%` key calls this directly (as a chained operator, via `/evaluate`) when it's acting as "percent of"; it only calls `/calculate` with `[value, 1]` for its other mode, transforming a number in place as `value/100` — see [Design Decisions](#design-decisions--assumptions). |

Success response (`200 OK`):

```json
{ "result": 5 }
```

Error response (`4xx`/`5xx`), same shape for every error:

```json
{ "error": { "code": "DIVISION_BY_ZERO", "message": "division by zero" } }
```

| HTTP status | `code`                    | When                                      |
| ----------- | -------------------------- | ------------------------------------------ |
| 400          | `INVALID_JSON`              | Request body isn't valid JSON              |
| 400          | `UNKNOWN_OPERATION`         | `operation` isn't one of the table above   |
| 400          | `INVALID_OPERAND_COUNT`     | Wrong number of values in `operands`       |
| 400          | `INVALID_OPERAND`           | An operand is `NaN` or `Infinity`          |
| 400          | `DIVISION_BY_ZERO`          | `divide` with a zero second operand        |
| 400          | `NEGATIVE_SQRT`             | `sqrt` of a negative number                |
| 500          | `INTERNAL_ERROR`            | Anything unexpected (logged server-side)   |

### `POST /api/v1/evaluate`

Evaluates a chained expression — a sequence of numbers and the operators
between them — respecting standard operator precedence (power, then
multiply/divide, then add/subtract, left to right within a tier).
`operators[i]` applies between `numbers[i]` and `numbers[i+1]`, so
`numbers` must always have exactly one more entry than `operators`. Only
`add`, `subtract`, `multiply`, `divide`, `power` and `percentage` are
valid here (percentage shares multiply/divide's precedence tier, since
`a% of b` is a multiplication) — `sqrt` is applied through
`/api/v1/calculate` instead, since it only ever takes one operand.

This endpoint itself has no notion of parentheses — the **frontend**
resolves a parenthesized group into a single number (via its own call to
this same endpoint) before ever including it here. See "Parentheses
without a backend parser" below.

Request body:

```json
{ "numbers": [9, 8, 8, 4, 1], "operators": ["add", "multiply", "divide", "subtract"] }
```

Success response (`200 OK`), same shape as `/calculate`:

```json
{ "result": 24 }
```

Error responses reuse the codes above, plus two specific to this endpoint:

| HTTP status | `code`                       | When                                                  |
| ----------- | ----------------------------- | ------------------------------------------------------ |
| 400          | `EXPRESSION_MALFORMED`         | `numbers` is empty, or its length isn't `operators.length + 1` |
| 400          | `OPERATOR_NOT_CHAINABLE`       | An operator isn't one of the six chainable ones above |

### `GET /api/v1/health`

Used by the Docker healthcheck and Compose's `depends_on: condition:
service_healthy`. Returns `200 OK` with `{ "status": "ok" }`.

### cURL examples

```bash
# Addition
curl -X POST http://localhost:8080/api/v1/calculate \
  -H "Content-Type: application/json" \
  -d '{"operation": "add", "operands": [2, 3]}'
# → {"result":5}

# Division by zero
curl -X POST http://localhost:8080/api/v1/calculate \
  -H "Content-Type: application/json" \
  -d '{"operation": "divide", "operands": [10, 0]}'
# → {"error":{"code":"DIVISION_BY_ZERO","message":"division by zero"}}

# Square root (unary)
curl -X POST http://localhost:8080/api/v1/calculate \
  -H "Content-Type: application/json" \
  -d '{"operation": "sqrt", "operands": [16]}'
# → {"result":4}

# Percentage: 20% of 50 (single call)
curl -X POST http://localhost:8080/api/v1/calculate \
  -H "Content-Type: application/json" \
  -d '{"operation": "percentage", "operands": [20, 50]}'
# → {"result":10}

# Percentage as a chained operator: 50% of 10
curl -X POST http://localhost:8080/api/v1/evaluate \
  -H "Content-Type: application/json" \
  -d '{"numbers": [50, 10], "operators": ["percentage"]}'
# → {"result":5}

# Chained expression with operator precedence: 9 + 8*8/4 - 1
curl -X POST http://localhost:8080/api/v1/evaluate \
  -H "Content-Type: application/json" \
  -d '{"numbers": [9, 8, 8, 4, 1], "operators": ["add", "multiply", "divide", "subtract"]}'
# → {"result":24}

# Malformed expression (2 numbers need exactly 1 operator, not 2)
curl -X POST http://localhost:8080/api/v1/evaluate \
  -H "Content-Type: application/json" \
  -d '{"numbers": [1, 2], "operators": ["add", "add"]}'
# → {"error":{"code":"EXPRESSION_MALFORMED","message":"..."}}

# Unknown operation
curl -X POST http://localhost:8080/api/v1/calculate \
  -H "Content-Type: application/json" \
  -d '{"operation": "modulo", "operands": [5, 2]}'
# → {"error":{"code":"UNKNOWN_OPERATION","message":"unknown operation: \"modulo\""}}

# Health check
curl http://localhost:8080/api/v1/health
# → {"status":"ok"}
```

A ready-to-import Postman collection is not included to keep the
deliverable small; the cURL commands above cover every endpoint and error
case and can be pasted directly into Postman's "Import raw text" option.

## Tests & Coverage

### Backend

```bash
cd backend
go test ./... -cover                              # run tests with a coverage summary
go test ./... -coverprofile=coverage.out           # write a coverage profile
go tool cover -html=coverage.out                    # open an HTML coverage report
```

Current coverage: 100% in `calculator`, `service` and `config`; ~97% in
`transport/http` (the only uncovered lines are unreachable `default`
branches). `cmd/api` (the wiring in `main.go`) is intentionally untested —
see [Design Decisions](#design-decisions--assumptions).

### Frontend

```bash
cd frontend
npm run test              # run once
npm run test:watch        # watch mode
npm run test:coverage      # run with coverage, HTML report under coverage/index.html
npm run typecheck          # tsc, no emit
npm run lint                # oxlint
```

Tests cover the pure logic (`formatResult`, `buildExpressionText`), the
API client (`calculatorApi`, with `fetch` mocked), the state machine
(`useCalculator`, with the API client mocked and a real precedence
evaluator as the mock's implementation — including tests for the live
preview propagating through nested parenthesized groups, both `√` modes,
backspace, and the dual-mode `%` operator), and integration tests on
`Calculator` that simulate real clicks and physical-keyboard input and
assert on what's rendered, including the error path. 106 tests, ~88%
coverage.

## Design Decisions & Assumptions

### Backend

- **No database.** A calculator's only state is "the number currently on
  screen." Persistence (e.g. a calculation history) isn't required and
  would trade scope for speculative value — see
  [Possible Improvements](#possible-improvements).
- **One endpoint per concern, not one per operation.** `POST
  /api/v1/calculate` takes an `operation` field instead of a dedicated
  route per operation, and `POST /api/v1/evaluate` handles chained
  expressions separately. Adding an operation only touches the
  `calculator` package, never the router.
- **Strategy pattern for operations, applied narrowly.** Each operation
  implements a small `Operation` interface and registers itself by name
  in a `Registry`. This keeps operation-specific rules (e.g. `sqrt`'s
  negative-input check) next to the operation itself instead of in a
  growing `switch`, and makes each operation trivially unit-testable in
  isolation.
- **No DI framework, ORM, or router library.** The three-layer wiring is
  ~15 lines in `main.go`; Go's standard `net/http.ServeMux` (1.22+)
  already supports method-specific routes, so a router library would add
  a dependency without adding capability.
- **Errors as values, mapped once.** Domain and validation errors are
  plain `errors.New` values; only the HTTP handler maps them to status
  codes and machine-readable `code` strings (via `errors.Is`). Anything
  unrecognized falls through to a generic `500 INTERNAL_ERROR`, logged
  server-side but never leaked to the client.
- **Operator precedence via a precedence-tier loop, not a general
  parser.** `ExpressionEvaluator` repeatedly collapses the highest
  remaining precedence tier (power, then multiply/divide/percentage,
  then add/subtract) over plain slices. With only three tiers and no
  parentheses at this endpoint — the frontend resolves those before
  calling it, see below — a full parser would be unneeded complexity.
- **`main.go` has no tests.** It's pure wiring with no branching logic;
  the correctness that matters lives in `service`, `calculator`, and the
  HTTP handler, which are fully tested.

### Frontend

- **`useReducer`, not Redux/Zustand.** All calculator state fits in one
  component's state tree with no cross-cutting concerns (no auth, no
  shared cache), so a reducer colocated in a single hook is enough.
- **The frontend never computes results itself.** Every operation —
  including simple addition — goes through the backend's `/calculate` or
  `/evaluate` endpoints, matching the requirement that the backend owns
  the arithmetic.
- **The live preview updates on every keystroke**, not just when an
  operator is pressed, including through nested parentheses and a
  pending `√` or sign. Responses are stamped with a monotonically
  increasing request ID so a slow, stale response can never overwrite
  newer state; typing itself is never blocked waiting on one.
- **Parentheses are resolved entirely in the frontend, with zero backend
  changes.** A stack of "enclosing expression" frames is maintained
  client-side; closing a group makes one more call to the same
  `/evaluate` endpoint and folds the result back into the outer level. A
  closed group keeps its literal typed text visible (`5+(2+3)`, not
  `5+(5)`) via a small display label kept alongside each term, so what's
  on screen always matches what was typed — the value used for
  computation is unaffected either way.
- **`√` and `%` are dual-mode, matching how people actually type on a
  physical calculator.** `√` can be pressed before or after the number
  it applies to; `%` acts as a chaining "percent of" operator (`50%`
  then `10` → `5`) or an in-place transform (`9×45%` → `9×0.45`)
  depending on whether an operator is already pending.
- **A number directly touching `(` or a closed group is implicit
  multiplication** (`9(2)` reads `9×2`), reusing the same commit path an
  explicit `×` press would, rather than a separate code path. The `×` is
  always shown explicitly rather than hidden, which is simpler and
  clearer for anyone not already fluent in bare-juxtaposition notation.
- **Errors show inline, in the live-preview line, not as a separate
  alert banner.** The term that caused the error is left visible and
  editable (via backspace) instead of being reset. The frontend owns the
  user-facing error copy, mapping each backend `code` to a short,
  plain-language message — the backend's own `message` field is for
  logs/API consumers — so wording can evolve independently of the API.
- **Plain CSS, no UI/styling library.** One component tree, a handful of
  classes, mobile-first with a single media query — a CSS framework
  would be pure overhead at this scope.

## Possible Improvements

Left out deliberately to keep the delivered scope focused and easy to
review:

- Persist calculation history — would need a `CalculationHistory` entity
  and a lightweight store (e.g. SQLite), not a full RDBMS for this scope.
- OpenAPI/Swagger spec generated from the handler, served at `/docs`.
- Structured request IDs / tracing for easier debugging in production.
- Rate limiting on the API.
- i18n for the error messages shown in the UI — the `code` → message
  mapping in `calculatorApi.ts` is already the seam where this would
  plug in.
- Re-entering a closed group for granular editing via backspace, instead
  of only removing it as one unit.
- Hiding the `×` for implicit multiplication (`9(2)` instead of
  `9×(2)`) — purely cosmetic.
