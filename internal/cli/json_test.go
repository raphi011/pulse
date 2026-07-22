package cli

import (
	"context"
	"errors"
	"regexp"
	"testing"
)

// gws-style extractor: {"error":{"code":N,"message":"…"}} inside the body.
func extractGws(body map[string]any) *APIError {
	e, ok := body["error"].(map[string]any)
	if !ok {
		return nil
	}
	code, _ := e["code"].(float64)
	msg, _ := e["message"].(string)
	return &APIError{Code: int(code), Message: msg}
}

func run(t *testing.T, script string) (map[string]any, error) {
	t.Helper()
	return RunJSON(context.Background(), "sh", []string{"-c", script}, extractGws,
		Options{NotAuthMessage: "Not authenticated with gws"})
}

func TestRunJSONSuccess(t *testing.T) {
	body, err := run(t, `echo '{"items":[1,2]}'`)
	if err != nil || body["items"] == nil {
		t.Fatalf("body=%v err=%v", body, err)
	}
}

func TestRunJSONEmbeddedAuthErrorWithZeroExit(t *testing.T) {
	_, err := run(t, `echo '{"error":{"code":401,"message":"unauthorized"}}'`)
	var ce *Error
	if !errors.As(err, &ce) || ce.Kind != KindAuth || ce.Message != "Not authenticated with gws" {
		t.Fatalf("got %v", err)
	}
}

func TestRunJSONEmbeddedPlainErrorBecomesFailed(t *testing.T) {
	_, err := run(t, `echo '{"error":{"code":500,"message":"server broke"}}'`)
	var ce *Error
	if !errors.As(err, &ce) || ce.Kind != KindFailed || ce.Message != "server broke" {
		t.Fatalf("got %v", err)
	}
}

func TestRunJSONNonJSONOutputIsFailed(t *testing.T) {
	_, err := run(t, `echo 'not json'`)
	var ce *Error
	if !errors.As(err, &ce) || ce.Kind != KindFailed {
		t.Fatalf("got %v", err)
	}
}

func TestRunJSONProcessErrorWithUnparseableBodyKeepsProcessClassification(t *testing.T) {
	_, err := RunJSON(context.Background(), "sh",
		[]string{"-c", `echo 'garbage'; echo 'please auth login' >&2; exit 1`}, extractGws,
		Options{NotAuthPattern: mustRe(`auth login`), NotAuthMessage: "Not authenticated"})
	var ce *Error
	if !errors.As(err, &ce) || ce.Kind != KindAuth {
		t.Fatalf("got %v", err)
	}
}

func TestRunJSONNonZeroExitWithCleanBodyIsStillFailure(t *testing.T) {
	_, err := run(t, `echo '{"fine":true}'; exit 1`)
	if err == nil {
		t.Fatal("non-zero exit with no embedded error must not be returned as success")
	}
}

func mustRe(s string) *regexp.Regexp { return regexp.MustCompile(s) }
