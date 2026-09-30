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

- **No database.** A calculator's only state is "the number currently on
  screen." Adding persistence (e.g. a calculation history) would need a
  `CalculationHistory` entity and a store, but nothing in the requirements
  asks for it, and building it would trade scope for speculative value.
  It's listed under [Possible Improvements](#possible-improvements)
  instead of implemented.
- **One endpoint, not one per operation.** `POST /api/v1/calculate` with an
  `operation` field is simpler for the frontend to call generically and
  keeps the route table from growing every time an operation is added —
  adding an operation only touches the `calculator` package, never the
  router.
- **Strategy pattern for operations, applied narrowly.** Each operation
  implements a two-method `Operation` interface and registers itself by
  name. This is the one place a design pattern earns its keep here:
  it's what lets `sqrt`'s "negative input" rule live next to `sqrt` instead
  of in a growing `switch` statement in the service layer, and it's what
  makes the operations trivially unit-testable in isolation.
- **No dependency-injection framework, no ORM, no router library.** The
  three-layer wiring happens by hand in 15 lines of `main.go`; Go's
  standard `net/http.ServeMux` (1.22+) already supports method-specific
  routes (`"POST /api/v1/calculate"`), so a router library would add a
  dependency without adding capability.
- **Errors as values, mapped once.** Domain errors (`calculator.ErrDivisionByZero`,
  `calculator.ErrNegativeSqrt`) and input errors (`service.ErrUnknownOperation`,
  etc.) are plain `errors.New` values. The HTTP handler is the **only**
  place that maps them to status codes and machine-readable `code`
  strings, via `errors.Is`. Every error not explicitly recognized falls
  through to a generic `500 INTERNAL_ERROR` — its details are logged
  server-side but never leaked to the client.
- **`%` is dual-mode, matching what physical calculators do.** With no
  operator already pending, it behaves as the "percent of" operator —
  type `50`, press `%`, type `10`, get `5` — going through the same
  chaining flow (`chooseOperation`) as `+`/`×`/etc., since `percentage`
  is a registered chainable operator (`a% of b`, same precedence tier as
  multiply/divide, since it's a multiplication). With an operator
  already pending, though, there's no second number for "percent of" to
  apply to yet, so it instead transforms the number being typed in place
  — `9 × 45%` becomes `9 × 0.45` — exactly like `sqrt`. Trying to make
  `%` a single uniform infix operator (so `9 × 45%` would need to parse
  as `9 × (45% of ???)`) doesn't correspond to how anyone actually reads
  that expression; the two-mode rule matches the two things people
  actually type.
- **Chained expressions respect operator precedence via a precedence-tier
  loop, not a general parser.** `POST /api/v1/evaluate` evaluates `power`
  before `multiply`/`divide` before `add`/`subtract`, left to right
  within a tier — standard PEMDAS. `ExpressionEvaluator` does this by
  repeatedly collapsing the highest remaining precedence tier over plain
  slices, rather than a shunting-yard/Pratt parser: with only three
  precedence tiers and no parentheses *at this endpoint* (see below),
  the simpler loop is exactly as correct and meaningfully easier to read
  and test.
- **The live preview updates on every keystroke**, once there's at least
  one operator, a pending `√`, or an open group to combine with — not
  just when an operator is pressed. An earlier version only re-evaluated
  per completed operator, to avoid evaluating against a placeholder
  second operand (e.g. showing `9*0=0` for an instant after pressing `*`,
  before the next digit is typed). The fix that keeps per-keystroke
  updates *without* that flashing: only ever evaluate what's actually
  been typed — never on the operator keystroke itself, only on
  digit/decimal keystrokes once a term exists to combine with. Because
  this now fires a request per keystroke, responses are stamped with a
  monotonically increasing request id and a stale one (from a few
  keystrokes ago, arriving late) is discarded rather than overwriting
  newer state — see the "ignores a stale preview response" test in
  `useCalculator.test.ts`. Typing is never blocked waiting for a
  response; only committing a term (operator, `=`, or `)`) briefly
  disables the keypad.
- **The live preview propagates outward through every enclosing group,
  not just the innermost one.** Typing `9×(3+5` needs to preview `72`
  (the whole expression), not `8` (just the open group's own subtotal).
  `refreshPreview` first resolves the current level's own value (a
  pending `√`, then combining with that level's terms/operators, if
  any), then `propagateOutward` folds that value into each enclosing
  `parenStack` frame in turn, outermost last. A frame with no operator of
  its own (a group opened as the very first keystroke) just passes the
  value through unchanged. This is also why typing the very first digit
  right after `(` already shows a preview — `parenStack.length > 0` is
  by itself enough reason to ask for one, even before anything exists at
  the new, inner level to combine with.
- **`equals` refuses to finalize while a group is still open.** `9×(3+5`
  followed by `=` would otherwise have nowhere to fold the open group's
  value back into — the `9×` context would simply be discarded. `equals`
  is a no-op in that state; the user has to close every open `(` first,
  same as a physical calculator.
- **Parentheses, without a backend parser — and keeping their literal
  text.** The keypad's `(`/`)` push and pop a stack of "enclosing
  expression" frames in the frontend; on `)`, the group's contents are
  evaluated with the *same* `/api/v1/evaluate` call as everything else,
  so arbitrarily nested groups (`5+(2*(3+1))`) work with zero backend
  changes. Unlike an earlier version of this, closing a group does
  **not** collapse it to just its value — `5+(2+3)` still reads
  `5+(2+3)` once closed, not `5+(5)`, because the user should be able to
  look at (or later backspace) exactly what they typed. This needed one
  more piece of state than the value alone: each term carries an
  optional display label (`termLabels`, parallel to `terms`) — `null`
  for an ordinary number, or a literal string like `"(2+3)"` for a term
  that came from a closed group. `buildExpressionText` renders the
  label when present and the plain number otherwise; the *value* used
  for actual computation is unaffected either way, so nothing about the
  math changes — only what's displayed.
- **A number directly touching `(` or a closed group is implicit
  multiplication, in both directions** — `9(2)` means `9×2`, `(2+3)(4+5)`
  means `(2+3)×(4+5)`, and `(9+3)4` (a digit typed right after a group
  closes) means `(9+3)×4`. `openParen` detects the "(" direction (the
  current term isn't in its untouched "just typed an operator" state)
  and calls the same `chooseOperation("multiply")` an explicit `×` press
  would, *before* opening the new group. `inputDigit`/`inputDecimal`
  detect the other direction: when the term on screen is a *closed
  group's* value specifically (its label starts with `"("` — a resolved
  √'s label starts with `"√"` instead, see below for why that case is
  deliberately different), a digit does the same implicit multiply
  first, then starts the new term — reusing 100% of the existing
  chaining machinery rather than inventing a separate code path either
  way. One deliberate simplification: the `×` is always shown explicitly
  (`9×(2)`, `(9+3)×4`), never hidden (`9(2)`, `(9+3)4`) — hiding it would
  need a second per-operator "was this implicit" flag purely for that
  one cosmetic difference, and an explicit `×` is arguably clearer
  anyway for anyone not already fluent in bare-juxtaposition notation.
  This needed one fix along the way: `overwrite` was left `false` after
  closing a group (everywhere else a fresh sealed term appears — a new
  operator, a finalized result, a resolved √ — it's `true`), so a digit
  typed there used to concatenate onto the group's own numeric value
  (`(9+1)` + `2` reading as `102`) before implicit multiplication was
  wired in to intercept it first.
- **`√` is dual-mode too, matching the two orders people actually type
  it in.** Postfix (number first, `16` then `√`) transforms what's
  already on screen immediately, the same way `%`'s in-place mode does —
  it reuses the `currentInputLabel` mechanism, setting the label to
  `"√" +` whatever was already on screen (a plain number or another
  label, so `√` of a closed group reads `√(2+3)`, and `√` twice reads
  `√√9`), while the *value* used for computation is unaffected. Prefix
  (`√` first, with nothing typed yet) instead just sets a `pendingSqrt`
  flag and lets the next digits build the radicand as typed — `√9` reads
  as `√9` while it's still being typed, not just once resolved — with
  the actual `sqrt` call deferred to whichever commit point comes next
  (an operator, `=`, or `)`), via the same `resolveCurrentTerm` helper
  all three of those already use to read "what's the current term
  worth." Backspace on a pending `√` just clears the flag, same priority
  level as undoing an un-committed digit. Unlike a closed group, a digit
  typed right after a *resolved* √ starts a fresh term instead of
  implicitly multiplying — `√16` then `7` reads `7`, not `√16×7`. A √
  result reads more like "I'm done with that, here's my next number"
  than a group's value does; `inputDigit`/`inputDecimal` distinguish the
  two purely by the label's leading character (`"("` vs `"√"`), since
  that's already an unambiguous, always-accurate signal for which
  operation produced it.
- **`−` doubles as a negative sign, since there's no dedicated ± key.**
  Pressed with nothing typed yet for the current term (`chooseOperation`'s
  `canToggleNegativeSign` check — the same "fresh term" condition used
  elsewhere, e.g. `openParen`'s implicit-multiply check), it sets a
  `pendingNegative` flag instead of committing an operand: `4×` then `−`
  reads `4×−`, and the next digits build the negative number, resolved
  (negated) at whichever commit point comes next — the same
  prefix-then-resolve-later shape `pendingSqrt` already has, down to
  reusing `resolveCurrentTerm` and backspace's undo-in-typing-order
  priority. Pressing `−` again before any digit toggles it back off,
  standing in for a ± key without adding one. Previously, `−` pressed
  here always meant "commit the current term (usually a placeholder 0)
  and start subtracting" — so `4×−4` read as `4×0−4 = −4`, not `4×(−4) =
  −16`. Every *other* operator pressed the same way (nothing typed yet,
  an operator already pending) instead **replaces** the pending operator
  — `9×` then `+` becomes `9+`, not `9×0+` — since unlike `−`, none of
  them double as a sign; changing your mind about which operator to use
  is the only sensible reading. `pendingNegative` composes with
  `pendingSqrt` in either order, always meaning the same thing: the
  *radicand* is negative, not the root's result — `√` then `−` then `9`
  reads `√−9` (an error, same as typing a negative number would
  anywhere else), not `−√9 = −3`. `−` attaches to whatever's about to
  be typed, √ pending or not, so `resolveCurrentTerm` negates *before*
  calling `sqrt`, not after; `renderLevel` shows the sign right after
  `√` for the same reason, not in front of it.
- **`√` then `(` attaches the root to the group that's about to open,
  instead of resolving `√0` immediately and multiplying by it.**
  Pressed with nothing typed for the radicand yet, `openParen` pushes a
  `ParenFrame` marked `sqrtOnClose: true` rather than treating the
  moment as "fresh term, so an implicit × before this new group" (what
  every *other* case of "something's already here, then `(`" means) —
  the group *is* the radicand. `finishClosingParen` checks that flag
  once the matching `)` closes: the group's own value resolves first
  (respecting everything typed inside it, negative signs included, so
  `√(−1)` correctly errors the same way `√−1` does), *then* `√` applies
  to that result, `calculate("sqrt", …)` folding it into one sealed
  term — `√(3)` — the same way a resolved `√9` already does. This is
  also what makes `√(3)(3)` (`√` applies to just the first group, then
  implicit-× picks up from there: `√3 × 3`) and `√(3(3))` (a second `(`
  opened *before* the first closes is implicit multiplication *inside*
  the still-open radicand instead: `√(3×3)`) resolve to different
  values from the same three digits typed in each — the flag lives on
  whichever specific frame the `√` was queued against, not as a global
  "a root is pending" switch, so nesting doesn't confuse the two.
- **A live-preview error shows the real message immediately, not just
  once a commit key is pressed.** `refreshPreview`/`refreshPreviewFromLeaf`/
  `refreshPreviewFromValue` used to swallow a failed preview into a
  quiet `PREVIEW_CLEARED` — reasonable for something like `9÷0` that a
  few more digits could still turn into `9÷0.5`, but wrong for a
  negative √ radicand, which only gets more invalid the longer it's
  typed. All three now dispatch `CALCULATE_ERROR` on failure instead,
  reusing the same `error` field a failed commit already sets (and the
  same reducer cases — `INPUT_DIGIT`, `OPEN_PAREN`, etc. — that already
  clear it). This is also what `propagateOutward` needed fixing for
  first: it only combined a value with each enclosing frame's own
  terms/operators, never checking that frame's `sqrtOnClose` — so
  `√(−1×(1` (still fully open, nothing closed yet) propagated straight
  past the queued √ and previewed a plain (wrong) number instead of
  erroring. One subtlety this introduced: `finishClosingParen` and
  `closeParen`'s bare-`%` path both apply a frame's √ once, explicitly,
  to get the value they dispatch — if their own follow-up preview call
  handed `propagateOutward` that *same* frame unchanged, it would apply
  that √ a second time. Both pass it a shallow copy with `sqrtOnClose`
  forced to `false` for that one already-handled frame instead.
- **`equals` auto-closes every group still open, instead of refusing to
  finalize at all.** Pressing "=" (or Enter) used to require every `(`
  to be explicitly closed first — reasonable in theory (there's nowhere
  obvious to fold an open group's value into), but in practice it meant
  "=" could silently do nothing while the live preview kept showing a
  perfectly good number, with no way to actually commit it for another
  operation. `resolveFullyForFinalize` now walks outward through
  `state.parenStack` the same way `propagateOutward` already does for
  the live preview — applying each frame's queued √ before folding it
  into what encloses it — and `equals` uses *that* to finalize, rather
  than blocking. `closeParen` (explicit `)`) is unaffected: it still
  closes exactly one level at a time, keeping each group's own literal
  text visible, which is the whole reason it doesn't just reuse this.
- **A negative power base keeps standard precedence: `−2^4` = `−16`,
  not `(−2)^4` = `16`.** Mathematically, unary minus binds *looser*
  than `^` unless it's explicitly grouped — `−2^4` reads `−(2^4)`, the
  sign applying to the power's result, not its base. There's no way to
  tell the backend's flat terms/operators evaluator "negate just this
  `^` pair" directly, so `chooseOperation` writes the arithmetic out the
  way it would actually be done by hand instead: a synthetic leading
  `0, subtract` pair ahead of the (positive) base — `evaluateExpression`
  already resolves `power` before `subtract`, so `[0, 2, 4]` with
  `["subtract", "power"]` gives the right precedence for free, no
  backend change needed. The synthetic `0`'s `termLabels` entry is `""`
  (not `null`) specifically so it renders as nothing — `renderTerms`
  shows the *label*, so only its operator symbol (`−`) is visible,
  reproducing `−2^4` exactly as typed rather than `0−2^4`. Backspacing
  out of the exponent undoes this pair as one atomic step (detected by
  that same `""` sentinel), landing back on a pending sign over the base
  rather than surfacing the synthetic `0` as an editable term. This
  doesn't generalize to `−(…)`: pressing `−` then `(` isn't specially
  handled — the sign is silently dropped and the group opens normally —
  since parenthesized sub-expressions can't be collapsed into a single
  synthetic term the same way a two-number `^` pair can.
- **`state.currentInput` stays parseFloat-safe (plain ASCII `-`), even
  though every *displayed* negative number uses the proper minus sign
  (`−`, matching the operators).** `parseFloat` doesn't recognize `−` as
  a valid sign — it returns `NaN` for it — so a Unicode-minus string
  stored in `currentInput` would silently break the next operation on
  it (closing `(−2)` then pressing `^` sent `NaN`, which serializes to
  JSON `null`, which Go quietly reads back as `0` — the base for `^`
  became `0` instead of `-2`; regression from the display fix itself,
  caught while implementing the precedence rule above).
  `numberToInputString` keeps the two concerns separate: display text
  (the expression, a group's literal label, the final result) always
  goes through `formatResult`'s Unicode minus, while anything that
  might get `parseFloat`'d again later — closing a group, resolving a
  postfix √ or in-place `%`, restoring a term via backspace — goes
  through `numberToInputString`'s plain ASCII one instead. The one
  place raw `currentInput` reaches the user directly (no overriding
  label — a bare typed number, or a resolved in-place `%` with no
  label of its own) converts back to `−` right before display, via
  `toDisplayMinus`, rather than storing it pre-converted.
- **A bare, trailing `%` resolves to a plain decimal, not "n% of a
  phantom 0."** Chained percentage needs a real second operand (`50%`
  then `10` means `50% of 10`), but pressed alone — `25%` then `=` or
  `)`, nothing typed for that operand — finalizing normally would send
  an implicit `0` as it (`25% of 0` = `0`). `isBareTrailingPercentage`
  catches this in both `equals` and `closeParen`, resolving it the same
  way `applyPercentage`'s own in-place mode already does — the fixed
  operand `1`, giving `25%` = `0.25` — combined with whatever terms
  came before it, if any (`9+25%` = `9.25`). `closeParen`'s literal
  group text needs its own care here too: it can't reuse the resolved
  value for display (that would show a phantom "`(25%1)`"), so it
  builds the label from the raw, untouched state directly instead —
  `renderLevel` already knows to hide an untyped trailing placeholder,
  giving the correct `(25%)`.
- **Errors show inline, in the live-preview line, not as a separate
  alert banner.** A failed `=`/operator/`)` shows its message where the
  numeric preview would otherwise go (e.g. "9÷0" stays visible as the
  big line, with "Can't divide by zero" underneath), instead of a loud
  red box. The term that caused it is deliberately left untouched (not
  reset to a placeholder) so it's exactly clear what needs fixing — and
  can be corrected with backspace rather than only by retyping it from
  scratch.
- **The frontend owns user-facing error copy; the backend's `message`
  is for logs/API consumers.** `calculatorApi.ts` maps each `code`
  (`DIVISION_BY_ZERO`, `NEGATIVE_SQRT`, etc.) to a short, plain-language
  string ("Can't divide by zero") shown in the UI, instead of surfacing
  the backend's own wording ("division by zero") directly. `code` is
  the stable part of the API contract specifically so the two can
  evolve independently — wording, tone, or a future translation can
  change without touching the backend, and an error code the frontend
  doesn't recognize yet still falls back to the backend's message
  instead of showing nothing.
- **Every place that changes the number on screen also refreshes the
  live preview, not just digit/decimal keystrokes.** `applySqrt`'s
  postfix mode and `applyPercentage`'s in-place mode both change what's
  on screen without going through `inputDigit`/`inputDecimal`, so each
  explicitly triggers its own refresh afterward — otherwise the preview
  line could show a stale number left over from before the change (e.g.
  `9 × 45` briefly previews `405`; pressing `%` turns `45` into `0.45`
  in the expression, and the preview needs its own refresh to catch up
  to `4.05`, or it would keep showing the now-wrong `405`). Because
  these two hand `refreshPreviewFromLeaf` a value that's only this
  term's own result — not yet combined with the current level's pending
  operator — it's a different entry point than `chooseOperation`/
  `closeParen` use (`refreshPreviewFromValue`, for a value that's
  already been combined with the current level via a real
  `evaluateExpression` call); both end by propagating outward through
  any enclosing groups the same way.
- **Backspace peels back one "thing" at a time, in the same order it was
  typed.** With nothing typed for the current term, it first clears a
  pending `√` prefix if one is active (so `√` then backspace goes back
  to a plain, un-prefixed term); only then does it undo the last
  operator and restore its term (and its label, if it had one) for
  further editing; with nothing left in the current group either, it
  steps back out of that group (undoing the matching `(`) rather than
  doing nothing. A closed group is removed as a single unit rather than
  character by character — re-entering it for granular editing (rather
  than just showing its text) would need the group's inner
  terms/operators/labels kept around after closing, not just its label
  and value; left as a possible improvement if that granularity turns
  out to matter in practice. It also always clears the live preview
  (rather than leaving whatever was there before), since a backspace can
  drop `operators.length` back to zero — where a leftover preview from
  before the undo would be stale — and lets the usual per-keystroke
  refresh mechanism put a correct one back if there's still a chain to
  preview.
- **`main.go` has no tests.** It's pure wiring (construct dependencies,
  start a server, wait for a signal) with no branching logic — the
  correctness that matters is in `service`, `calculator` and the HTTP
  handler, which are fully tested; testing `main` itself would mean
  spinning up a real server for no additional confidence.
- **Frontend: `useReducer`, not Redux/Zustand.** All calculator state fits
  in one component's state tree and has no cross-cutting concerns (no
  auth, no shared cache), so a reducer colocated in a single hook is
  enough. A global store would add a dependency and boilerplate without
  solving a problem this app has.
- **Frontend never computes results itself.** Even for something as simple
  as addition, the actual arithmetic always goes through the backend
  `calculate()` call — this matches the requirement that the backend
  exposes and owns the calculator operations, and keeps the two layers'
  responsibilities honest.
- **Plain CSS, no UI/styling library.** One component, a handful of
  classes, mobile-first with a single small media query — a CSS framework
  would be pure overhead at this scope.

## Possible Improvements

Left out deliberately to keep the delivered scope focused and easy to
review; listed here rather than half-implemented:

- Persist calculation history (would need a `CalculationHistory` entity —
  sketched in the pull request description — and a lightweight store such
  as SQLite; not a full RDBMS for this scope).
- OpenAPI/Swagger spec generated from the handler, served at `/docs`.
- Structured request IDs / tracing for easier debugging in production.
- Rate limiting on the API.
- i18n for the error messages shown in the UI (the `code` → message
  mapping in `calculatorApi.ts` is already the seam where this would
  plug in).
- Re-entering a closed group for granular editing via backspace, instead
  of only removing it as one unit — would need its inner
  terms/operators/labels kept around after closing (see
  [Design Decisions](#design-decisions--assumptions)).
- Hide the `×` for implicit multiplication (`9(2)` instead of `9×(2)`)
  — would need a per-operator "was this implicit" flag purely for that
  cosmetic difference (see [Design Decisions](#design-decisions--assumptions)).
#   C a l c u l a t o r  
 