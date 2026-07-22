package cli

import (
	"context"
	"errors"
	"regexp"
	"testing"
	"time"
)

func kindOf(t *testing.T, err error) ErrorKind {
	t.Helper()
	var ce *Error
	if !errors.As(err, &ce) {
		t.Fatalf("want *cli.Error, got %T: %v", err, err)
	}
	return ce.Kind
}

func TestRunSuccess(t *testing.T) {
	out, _, err := Run(context.Background(), "sh", []string{"-c", "echo hi"}, Options{})
	if err != nil {
		t.Fatal(err)
	}
	if out != "hi\n" {
		t.Fatalf("stdout = %q", out)
	}
}

func TestRunNotFound(t *testing.T) {
	_, _, err := Run(context.Background(), "definitely-not-a-real-binary-xyz", nil, Options{})
	if k := kindOf(t, err); k != KindNotFound {
		t.Fatalf("kind = %s", k)
	}
}

func TestRunAuthPattern(t *testing.T) {
	_, _, err := Run(context.Background(), "sh", []string{"-c", "echo 'please run auth login' >&2; exit 1"},
		Options{NotAuthPattern: regexp.MustCompile(`auth login`), NotAuthMessage: "Not authenticated with gh"})
	if k := kindOf(t, err); k != KindAuth {
		t.Fatalf("kind = %s", k)
	}
	var ce *Error
	errors.As(err, &ce)
	if ce.Message != "Not authenticated with gh" {
		t.Fatalf("message = %q", ce.Message)
	}
}

func TestRunNonZeroExitIsFailedWithStderrMessage(t *testing.T) {
	_, _, err := Run(context.Background(), "sh", []string{"-c", "echo boom >&2; exit 3"}, Options{})
	var ce *Error
	if !errors.As(err, &ce) || ce.Kind != KindFailed || ce.Message != "boom" {
		t.Fatalf("got %v", err)
	}
}

func TestRunTimeout(t *testing.T) {
	start := time.Now()
	_, _, err := Run(context.Background(), "sleep", []string{"5"}, Options{Timeout: 100 * time.Millisecond})
	if k := kindOf(t, err); k != KindTimeout {
		t.Fatalf("kind = %s", k)
	}
	if time.Since(start) > 2*time.Second {
		t.Fatal("timeout did not kill the process promptly")
	}
}

func TestRunCarriesStdoutOnFailure(t *testing.T) {
	_, _, err := Run(context.Background(), "sh", []string{"-c", `echo '{"error":{"code":404}}'; exit 1`}, Options{})
	var ce *Error
	if !errors.As(err, &ce) || ce.Stdout == "" {
		t.Fatalf("failed exit must carry stdout for RunJSON, got %v", err)
	}
}
