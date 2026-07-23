// Package apppath resolves where pulse.db lives: com.pulse.dashboard's
// app-data directory.
package apppath

import (
	"os"
	"path/filepath"
)

// DBPath returns the path to pulse.db inside com.pulse.dashboard's app-data
// directory (darwin: ~/Library/Application Support), creating the directory
// if it doesn't already exist.
func DBPath() (string, error) {
	cfg, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	dir := filepath.Join(cfg, "com.pulse.dashboard")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	return filepath.Join(dir, "pulse.db"), nil
}
