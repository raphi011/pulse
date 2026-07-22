// Package cli spawns integration CLIs (gh, jira, gws, …) and classifies their
// failures so widgets can render actionable error states.
package cli

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

type ErrorKind string

const (
	KindNotFound ErrorKind = "not-found"
	KindAuth     ErrorKind = "auth"
	KindTimeout  ErrorKind = "timeout"
	KindFailed   ErrorKind = "failed"
)

type Error struct {
	Kind    ErrorKind
	Message string
	Stderr  string
	Stdout  string
}

func (e *Error) Error() string { return e.Message }

type Options struct {
	NotAuthPattern *regexp.Regexp
	NotAuthMessage string
	Timeout        time.Duration // 0 → 20s
}

// A Finder-launched .app inherits only the minimal system PATH, so prepend the
// common Homebrew/system dirs where gh/jira/node live, plus bun's global bin
// (where gws installs).
var toolPath = defaultToolPath()

func defaultToolPath() string {
	base := "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
	if home, err := os.UserHomeDir(); err == nil {
		base += ":" + filepath.Join(home, ".bun", "bin")
	}
	return base
}

// lookPathIn resolves a bare binary name against an explicit colon-separated
// path list (exec.LookPath consults the process PATH, which a Finder-launched
// .app doesn't control). Names containing a path separator pass through as-is.
func lookPathIn(pathList, bin string) (string, error) {
	if strings.ContainsRune(bin, os.PathSeparator) {
		return bin, nil
	}
	for _, dir := range filepath.SplitList(pathList) {
		if dir == "" {
			continue
		}
		candidate := filepath.Join(dir, bin)
		info, err := os.Stat(candidate)
		if err != nil || info.IsDir() {
			continue
		}
		if info.Mode()&0o111 != 0 {
			return candidate, nil
		}
	}
	return "", fmt.Errorf("%q: %w", bin, exec.ErrNotFound)
}

func authMessage(opts Options) string {
	if opts.NotAuthMessage != "" {
		return opts.NotAuthMessage
	}
	return "Not authenticated"
}

// Run spawns bin with an arg vector (no shell interpolation) and returns
// stdout/stderr. Failures are always *Error with a classified Kind.
func Run(ctx context.Context, bin string, args []string, opts Options) (string, string, error) {
	timeout := opts.Timeout
	if timeout == 0 {
		timeout = 20 * time.Second
	}
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	resolved, lookErr := lookPathIn(toolPath, bin)
	if lookErr != nil {
		return "", "", &Error{Kind: KindNotFound, Message: fmt.Sprintf("%s not found — install it", bin)}
	}

	cmd := exec.CommandContext(ctx, resolved, args...)
	cmd.Env = append(os.Environ(), "PATH="+toolPath)
	var stdout, stderr bytes.Buffer
	cmd.Stdout, cmd.Stderr = &stdout, &stderr

	err := cmd.Run()
	if err == nil {
		return stdout.String(), stderr.String(), nil
	}
	if ctx.Err() == context.DeadlineExceeded {
		return "", "", &Error{Kind: KindTimeout, Message: fmt.Sprintf("%s timed out after %gs", bin, timeout.Seconds())}
	}
	var exitErr *exec.ExitError
	if errors.As(err, &exitErr) {
		se, so := stderr.String(), stdout.String()
		if opts.NotAuthPattern != nil && opts.NotAuthPattern.MatchString(se) {
			return "", "", &Error{Kind: KindAuth, Message: authMessage(opts), Stderr: se, Stdout: so}
		}
		msg := strings.TrimSpace(se)
		if msg == "" {
			msg = fmt.Sprintf("%s exited with code %d", bin, exitErr.ExitCode())
		}
		return "", "", &Error{Kind: KindFailed, Message: msg, Stderr: se, Stdout: so}
	}
	// Spawn failure: missing binary → not-found, anything else → failed.
	if errors.Is(err, exec.ErrNotFound) || errors.Is(err, os.ErrNotExist) {
		return "", "", &Error{Kind: KindNotFound, Message: fmt.Sprintf("%s not found — install it", bin)}
	}
	return "", "", &Error{Kind: KindFailed, Message: err.Error()}
}
