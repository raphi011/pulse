// Package jira ports frontend/legacy-modules/jira: a single JQL-query widget
// via jira-cli (process-model CLI; auth classified by regex; browse URLs
// built from the server: key in jira-cli's own config file).
package jira

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"

	"pulse/internal/cli"
)

var authPattern = regexp.MustCompile(`(?i)needs a Jira API token|unauthorized|401|invalid credentials`)

// runner is the injectable jira-cli seam: returns stdout.
type runner func(ctx context.Context, args []string) (string, error)

func runJira(ctx context.Context, args []string) (string, error) {
	stdout, _, err := cli.Run(ctx, "jira", args, cli.Options{
		NotAuthPattern: authPattern,
		NotAuthMessage: "Not authenticated — run `jira init`",
	})
	return stdout, err
}

func jiraJSON[T any](ctx context.Context, run runner, args []string) (T, error) {
	var out T
	stdout, err := run(ctx, append(args, "--raw"))
	if err != nil {
		return out, err
	}
	if err := json.Unmarshal([]byte(stdout), &out); err != nil {
		return out, &cli.Error{Kind: cli.KindFailed, Message: "jira returned unexpected output"}
	}
	return out, nil
}

type Module struct {
	run        runner
	readConfig func() ([]byte, error)

	mu           sync.Mutex
	cachedServer string
	cachedAt     time.Time
}

func New() *Module { return &Module{run: runJira, readConfig: readJiraConfig} }

func readJiraConfig() ([]byte, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return nil, err
	}
	return os.ReadFile(filepath.Join(home, ".config", ".jira", ".config.yml"))
}

const serverTTL = 5 * time.Minute

var serverRe = regexp.MustCompile(`(?m)^server:\s*(\S+)`)

// serverURL is the Jira base URL from jira-cli's config (`server:`). Cached
// with a TTL rather than for the process lifetime: a `jira init` to a
// different server self-heals within minutes instead of requiring a restart.
func (m *Module) serverURL() (string, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.cachedServer != "" && time.Since(m.cachedAt) < serverTTL {
		return m.cachedServer, nil
	}
	text, err := m.readConfig()
	if err != nil {
		return "", err
	}
	match := serverRe.FindSubmatch(text)
	if match == nil {
		return "", errors.New("could not find `server:` in jira-cli config — run `jira init`")
	}
	server := strings.TrimSuffix(strings.Trim(string(match[1]), `"'`), "/")
	m.cachedServer = server
	m.cachedAt = time.Now()
	return server, nil
}
