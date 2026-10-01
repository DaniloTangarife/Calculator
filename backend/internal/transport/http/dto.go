package http

// calculateRequest is the JSON body expected by POST /api/v1/calculate.
type calculateRequest struct {
	Operation string    `json:"operation"`
	Operands  []float64 `json:"operands"`
}

// evaluateRequest is the JSON body expected by POST /api/v1/evaluate.
// operators[i] applies between numbers[i] and numbers[i+1].
type evaluateRequest struct {
	Numbers   []float64 `json:"numbers"`
	Operators []string  `json:"operators"`
}

// calculateResponse is the JSON body returned on a successful calculation.
type calculateResponse struct {
	Result float64 `json:"result"`
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
