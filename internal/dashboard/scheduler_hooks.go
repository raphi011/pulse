package dashboard

import "context"

const autoRefreshPref = "autoRefresh"

// kicker is the scheduler-facing seam: main.go attaches the real
// *scheduler.Scheduler, tests attach a fake counter. Kept as a
// structurally-typed interface (rather than importing internal/scheduler)
// so this package stays dependency-free of the scheduler package.
type kicker interface{ Kick() }

// AttachScheduler wires k so RefreshAll can trigger an immediate refresh
// round. Optional: RefreshAll is a no-op until this is called (main.go
// calls it once at startup, after both the service and scheduler exist).
//
//wails:ignore
func (s *Service) AttachScheduler(k kicker) {
	s.scheduler = k
}

// AutoRefresh reports the "autoRefresh" pref, defaulting to off — matching
// today's localStorage default.
func (s *Service) AutoRefresh() (bool, error) {
	v, err := s.store.Pref(context.Background(), autoRefreshPref, "0")
	if err != nil {
		return false, err
	}
	return v == "1", nil
}

// SetAutoRefresh persists the "autoRefresh" pref.
func (s *Service) SetAutoRefresh(enabled bool) error {
	v := "0"
	if enabled {
		v = "1"
	}
	return s.store.SetPref(context.Background(), autoRefreshPref, v)
}

// RefreshAll triggers an immediate scheduler round via the attached kicker.
// No-op when no scheduler has been attached (e.g. in tests that don't call
// AttachScheduler).
func (s *Service) RefreshAll() {
	if s.scheduler != nil {
		s.scheduler.Kick()
	}
}

// RefreshableWidgetIDs returns the ids of every non-hidden widget whose
// type resolves to a manifest in the registry and is marked Refreshable.
// This is the scheduler's ListWidgets func.
func (s *Service) RefreshableWidgetIDs(ctx context.Context) ([]string, error) {
	widgets, err := s.store.Widgets(ctx)
	if err != nil {
		return nil, err
	}
	ids := []string{}
	for _, w := range widgets {
		if w.Hidden {
			continue
		}
		manifest, ok := s.registry.Manifest(w.Type)
		if !ok || !manifest.Refreshable {
			continue
		}
		ids = append(ids, w.ID)
	}
	return ids, nil
}
