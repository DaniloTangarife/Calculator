package calculator

// Registry looks up an Operation by its name. It is the single place
// that knows about every supported operation: adding a new one means
// implementing Operation and adding it to newOperations, with no
// changes required anywhere else (open/closed).
type Registry struct {
	operations map[string]Operation
}

// NewRegistry builds a Registry pre-loaded with every operation the
// calculator supports.
func NewRegistry() *Registry {
	ops := []Operation{
		addOperation{},
		subtractOperation{},
		multiplyOperation{},
		divideOperation{},
		powerOperation{},
		sqrtOperation{},
		percentageOperation{},
	}

	indexed := make(map[string]Operation, len(ops))
	for _, op := range ops {
		indexed[op.Name()] = op
	}

	return &Registry{operations: indexed}
}

// Get returns the operation registered under name, if any.
func (r *Registry) Get(name string) (Operation, bool) {
	op, ok := r.operations[name]
	return op, ok
}
