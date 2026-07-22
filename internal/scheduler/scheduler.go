// Package scheduler owns interval refresh for every refreshable widget: the
// Go port of use-widget-data's setInterval + auto-refresh-context. It is a
// pure package — no Wails, no db imports — with all behavior injected via
// Config funcs.
package scheduler

import (
	"context"
	"log/slog"
	"sync"
	"time"
)

// Config supplies the behavior the scheduler drives. All funcs must be safe
// to call concurrently with themselves (Refresh is called once per widget
// per round, concurrently).
type Config struct {
	Interval    time.Duration                               // 0 → 5 * time.Minute
	ListWidgets func(ctx context.Context) ([]string, error) // ids of refreshable, non-hidden widgets
	Refresh     func(ctx context.Context, widgetID string)  // errors are already cached rows; no return
	Enabled     func(ctx context.Context) bool              // pref-backed toggle
}

// Scheduler owns interval refresh for every refreshable widget: the port of
// use-widget-data's setInterval + auto-refresh-context. 5-minute interval,
// user-toggleable, with a "refresh everything now" kick.
type Scheduler struct {
	cfg  Config
	kick chan struct{}
	busy sync.Mutex // held for the duration of a refresh round
}

// New constructs a Scheduler from cfg, defaulting Interval to 5 minutes
// when unset.
func New(cfg Config) *Scheduler {
	if cfg.Interval == 0 {
		cfg.Interval = 5 * time.Minute
	}
	return &Scheduler{cfg: cfg, kick: make(chan struct{}, 1)}
}

// Kick triggers an immediate refresh round, regardless of Enabled. If a
// kick is already queued, this is a no-op.
func (s *Scheduler) Kick() {
	select {
	case s.kick <- struct{}{}:
	default: // a kick is already queued
	}
}

// Run blocks until ctx is cancelled, driving refresh rounds on every tick
// (when Enabled) and on every Kick. Call it in a goroutine.
func (s *Scheduler) Run(ctx context.Context) {
	t := time.NewTicker(s.cfg.Interval)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			if s.cfg.Enabled(ctx) {
				s.round(ctx)
			}
		case <-s.kick:
			s.round(ctx)
		}
	}
}

// round lists widgets and refreshes them concurrently, one goroutine per
// widget, each wrapped in a panic recovery. Overlapping rounds are
// prevented: a round already in flight makes this call a no-op.
func (s *Scheduler) round(ctx context.Context) {
	if !s.busy.TryLock() {
		return // previous round still in flight
	}
	defer s.busy.Unlock()

	ids, err := s.cfg.ListWidgets(ctx)
	if err != nil {
		slog.Error("scheduler: list widgets", "err", err)
		return
	}
	var wg sync.WaitGroup
	for _, id := range ids {
		wg.Add(1)
		go func() {
			defer wg.Done()
			defer func() {
				if r := recover(); r != nil {
					slog.Error("scheduler: refresh panicked", "widget", id, "panic", r)
				}
			}()
			s.cfg.Refresh(ctx, id)
		}()
	}
	wg.Wait()
}
