package cli

import (
	"context"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
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

func writeFakeBin(t *testing.T, dir, name, script string) {
	t.Helper()
	path := filepath.Join(dir, name)
	if err := os.WriteFile(path, []byte(script), 0o755); err != nil {
		t.Fatal(err)
	}
}

func TestLookPathIn(t *testing.T) {
	dir := t.TempDir()
	writeFakeBin(t, dir, "fakebin", "#!/bin/sh\necho found\n")

	t.Run("found on path list", func(t *testing.T) {
		got, err := lookPathIn(dir, "fakebin")
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		want := filepath.Join(dir, "fakebin")
		if got != want {
			t.Fatalf("got %q, want %q", got, want)
		}
	})

	t.Run("not found when absent from path list", func(t *testing.T) {
		other := t.TempDir()
		_, err := lookPathIn(other, "fakebin")
		if !errors.Is(err, exec.ErrNotFound) {
			t.Fatalf("got %v, want exec.ErrNotFound", err)
		}
	})

	t.Run("relative path passes through unchanged", func(t *testing.T) {
		got, err := lookPathIn(dir, "./x")
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if got != "./x" {
			t.Fatalf("got %q, want %q", got, "./x")
		}
	})

	t.Run("absolute path passes through unchanged", func(t *testing.T) {
		got, err := lookPathIn(dir, "/usr/bin/x")
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if got != "/usr/bin/x" {
			t.Fatalf("got %q, want %q", got, "/usr/bin/x")
		}
	})
}

func TestRunFindsBinaryOnlyOnToolPath(t *testing.T) {
	dir := t.TempDir()
	writeFakeBin(t, dir, "fakebin", "#!/bin/sh\necho found\n")

	original := toolPath
	toolPath = dir
	t.Cleanup(func() { toolPath = original })

	out, _, err := Run(context.Background(), "fakebin", nil, Options{})
	if err != nil {
		t.Fatal(err)
	}
	if out != "found\n" {
		t.Fatalf("stdout = %q", out)
	}
}
