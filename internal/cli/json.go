package cli

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
)

type APIError struct {
	Code    int
	Message string
}

// RunJSON is for CLIs that wrap a REST API and report errors *inside* the JSON
// body on stdout — sometimes with a zero exit code (e.g. gws returns an HTTP
// 401 as exit 0). The body is authoritative, not the exit status. 401/403 map
// to an auth failure; any other embedded error becomes "failed". A process
// failure whose body holds no recognizable error stays authoritative.
func RunJSON(ctx context.Context, bin string, args []string, extract func(map[string]any) *APIError, opts Options) (map[string]any, error) {
	stdout, _, runErr := Run(ctx, bin, args, opts)
	var procErr *Error
	if runErr != nil {
		if !errors.As(runErr, &procErr) || procErr.Stdout == "" {
			return nil, runErr
		}
		stdout = procErr.Stdout // parse the carried body; it may hold a richer API error
	}

	var body map[string]any
	if err := json.Unmarshal([]byte(stdout), &body); err != nil || body == nil {
		if procErr != nil {
			return nil, procErr
		}
		return nil, &Error{Kind: KindFailed, Message: fmt.Sprintf("%s returned non-JSON output", bin)}
	}

	if apiErr := extract(body); apiErr != nil {
		if apiErr.Code == 401 || apiErr.Code == 403 {
			return nil, &Error{Kind: KindAuth, Message: authMessage(opts)}
		}
		msg := strings.TrimSpace(apiErr.Message)
		if msg == "" {
			msg = strings.TrimSpace(fmt.Sprintf("%s error %d", bin, apiErr.Code))
		}
		return nil, &Error{Kind: KindFailed, Message: msg}
	}
	if procErr != nil {
		return nil, procErr
	}
	return body, nil
}

// RunJSONInto re-marshals the validated body into a typed struct.
func RunJSONInto(ctx context.Context, bin string, args []string, extract func(map[string]any) *APIError, opts Options, out any) error {
	body, err := RunJSON(ctx, bin, args, extract, opts)
	if err != nil {
		return err
	}
	raw, err := json.Marshal(body)
	if err != nil {
		return &Error{Kind: KindFailed, Message: err.Error()}
	}
	if err := json.Unmarshal(raw, out); err != nil {
		return &Error{Kind: KindFailed, Message: fmt.Sprintf("%s returned unexpected output", bin)}
	}
	return nil
}
