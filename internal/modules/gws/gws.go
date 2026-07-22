// Package gws ports frontend/legacy-modules/gws: Gmail, Calendar, Chat,
// Drive, Tasks and Next-meeting widgets via the gws CLI. gws is a
// payload-model CLI: it prints Google API errors as {"error":{code,message}}
// on stdout, sometimes with exit 0 — the body is authoritative, not the exit
// status (cli.RunJSONInto handles the mapping; 401/403 → auth).
package gws

import (
	"context"
	"encoding/json"

	"pulse/internal/cli"
)

// jsonRunner is the injectable gws seam: runs a gws command and decodes its
// JSON body into out.
type jsonRunner func(ctx context.Context, args []string, out any) error

func extractGwsError(body map[string]any) *cli.APIError {
	e, ok := body["error"].(map[string]any)
	if !ok {
		return nil
	}
	apiErr := &cli.APIError{}
	if c, ok := e["code"].(float64); ok {
		apiErr.Code = int(c)
	}
	if m, ok := e["message"].(string); ok {
		apiErr.Message = m
	}
	return apiErr
}

func runGwsJSON(ctx context.Context, args []string, out any) error {
	return cli.RunJSONInto(ctx, "gws", args, extractGwsError, cli.Options{
		NotAuthMessage: "Not authenticated — run `gws auth login`",
	}, out)
}

// jsonArg marshals a --params/--json argument value (matches the TS
// JSON.stringify call sites).
func jsonArg(v any) string {
	b, _ := json.Marshal(v)
	return string(b)
}
