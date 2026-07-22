package jira

import (
	"errors"
	"testing"
	"time"
)

func TestServerURLParsesAndCaches(t *testing.T) {
	reads := 0
	m := &Module{readConfig: func() ([]byte, error) {
		reads++
		return []byte("login: me@x.com\nserver: \"https://x.atlassian.net/\"\n"), nil
	}}
	got, err := m.serverURL()
	if err != nil {
		t.Fatal(err)
	}
	if got != "https://x.atlassian.net" {
		t.Errorf("serverURL = %q (quotes/trailing slash must be stripped)", got)
	}
	if _, err := m.serverURL(); err != nil {
		t.Fatal(err)
	}
	if reads != 1 {
		t.Errorf("config read %d times, want cached after first", reads)
	}
}

func TestServerURLTTLExpiry(t *testing.T) {
	reads := 0
	m := &Module{readConfig: func() ([]byte, error) {
		reads++
		return []byte("server: https://x.atlassian.net"), nil
	}}
	if _, err := m.serverURL(); err != nil {
		t.Fatal(err)
	}
	m.cachedAt = time.Now().Add(-6 * time.Minute)
	if _, err := m.serverURL(); err != nil {
		t.Fatal(err)
	}
	if reads != 2 {
		t.Errorf("expired cache should re-read, reads = %d", reads)
	}
}

func TestServerURLMissingKeyErrors(t *testing.T) {
	m := &Module{readConfig: func() ([]byte, error) { return []byte("login: me\n"), nil }}
	if _, err := m.serverURL(); err == nil {
		t.Fatal("want error when server: missing")
	}
}

func TestServerURLReadErrorPropagates(t *testing.T) {
	boom := errors.New("no config")
	m := &Module{readConfig: func() ([]byte, error) { return nil, boom }}
	if _, err := m.serverURL(); !errors.Is(err, boom) {
		t.Fatalf("want read error, got %v", err)
	}
}
