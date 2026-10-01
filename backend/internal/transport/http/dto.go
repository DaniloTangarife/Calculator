package http

import (
	"encoding/json"
	"fmt"
	"math"
)

// calculateRequest is the JSON body expected by POST /api/v1/calculate.
type calculateRequest struct {
	Operation string         `json:"operation"`
	Operands  []operandValue `json:"operands"`
}

// evaluateRequest is the JSON body expected by POST /api/v1/evaluate.
// operators[i] applies between numbers[i] and numbers[i+1].
type evaluateRequest struct {
	Numbers   []operandValue `json:"numbers"`
	Operators []string       `json:"operators"`
}

// operandValue decodes like a plain float64, but also accepts the same
// three sentinel strings resultValue sends out ("Infinity", "-Infinity",
// "NaN") in place of a JSON number. This is the mirror image of
// resultValue: it's what lets the frontend send back an earlier result
// that overflowed (e.g. continuing "4^1000" with "- 5") as that same
// sentinel string, instead of it silently becoming 0 — JS's own
// JSON.stringify(Infinity) already serializes to the JSON literal null,
// which Go would otherwise decode as a bare 0.
type operandValue float64

func (o *operandValue) UnmarshalJSON(data []byte) error {
	var asFloat float64
	if err := json.Unmarshal(data, &asFloat); err == nil {
		*o = operandValue(asFloat)
		return nil
	}

	var asString string
	if err := json.Unmarshal(data, &asString); err != nil {
		return fmt.Errorf("operand must be a number or one of \"Infinity\"/\"-Infinity\"/\"NaN\"")
	}

	switch asString {
	case "Infinity":
		*o = operandValue(math.Inf(1))
	case "-Infinity":
		*o = operandValue(math.Inf(-1))
	case "NaN":
		*o = operandValue(math.NaN())
	default:
		return fmt.Errorf("invalid operand: %q", asString)
	}
	return nil
}

// toFloats converts decoded operands to the plain []float64 the
// calculator/service layers deal in, so the sentinel-string decoding
// above stays an HTTP-layer concern.
func toFloats(values []operandValue) []float64 {
	floats := make([]float64, len(values))
	for i, v := range values {
		floats[i] = float64(v)
	}
	return floats
}

// calculateResponse is the JSON body returned on a successful calculation.
type calculateResponse struct {
	Result resultValue `json:"result"`
}

// resultValue serializes like a plain float64, except for the three
// values the JSON number grammar can't represent: +Inf, -Inf and NaN.
// A calculation can legitimately produce one of these (e.g. 4^1000
// overflows float64's range) without the request itself being invalid,
// so instead of failing to encode the response, these three serialize
// as the same strings JS's own Number.prototype.toString() uses for
// them ("Infinity", "-Infinity", "NaN") — a convention the frontend
// already understands how to convert back into a real number.
type resultValue float64

func (r resultValue) MarshalJSON() ([]byte, error) {
	switch {
	case math.IsNaN(float64(r)):
		return json.Marshal("NaN")
	case math.IsInf(float64(r), 1):
		return json.Marshal("Infinity")
	case math.IsInf(float64(r), -1):
		return json.Marshal("-Infinity")
	default:
		return json.Marshal(float64(r))
	}
}

// errorResponse is the JSON body returned whenever a request fails.
// Every error goes through this same shape so clients only need one
// parsing path regardless of what went wrong.
type errorResponse struct {
	Error errorBody `json:"error"`
}

type errorBody struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}
