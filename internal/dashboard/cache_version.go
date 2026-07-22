package dashboard

import (
	"context"
	"fmt"
)

// CacheVersion identifies the shape of every widget's cached Data payload.
// Bump it whenever any widget's Data payload shape changes; a mismatch
// against the stored pref wipes the disposable widget cache on boot.
const CacheVersion = 1

const cacheVersionPref = "cacheVersion"

// EnsureCacheVersion wipes the disposable widget cache when the payload shape
// version changed. Wipe-then-stamp: a crash between the two just re-wipes next boot.
//wails:ignore
func (s *Service) EnsureCacheVersion() error {
	ctx := context.Background()
	stored, err := s.store.Pref(ctx, cacheVersionPref, "")
	if err != nil {
		return err
	}
	if stored == fmt.Sprint(CacheVersion) {
		return nil
	}
	if err := s.store.CacheWipe(ctx); err != nil {
		return err
	}
	return s.store.SetPref(ctx, cacheVersionPref, fmt.Sprint(CacheVersion))
}
