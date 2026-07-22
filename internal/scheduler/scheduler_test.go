package scheduler

import (
	"context"
	"io"
	"log/slog"
	"sync/atomic"
	"testing"
	"time"
)

// silenceLogs redirects the default slog logger to discard output for the
// duration of a test, so panic-recovery logging in these tests doesn't
// spam stderr.
func silenceLogs(t *testing.T) {
	t.Helper()
	prev := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(io.Discard, nil)))
	t.Cleanup(func() { slog.SetDefault(prev) })
}

// pollUntil polls cond every few ms until it returns true or the deadline
// elapses, failing the test if the deadline is hit first.
func pollUntil(t *testing.T, deadline time.Duration, cond func() bool) {
	t.Helper()
	end := time.Now().Add(deadline)
	for time.Now().Before(end) {
		if cond() {
			return
		}
		time.Sleep(2 * time.Millisecond)
	}
	if !cond() {
		t.Fatalf("condition not met within %s", deadline)
	}
}

func TestScheduler_RefreshesAllListedWidgets(t *testing.T) {
	silenceLogs(t)

	ids := []string{"a", "b", "c"}
	var counts [3]int64

	cfg := Config{
		Interval: 20 * time.Millisecond,
		ListWidgets: func(ctx context.Context) ([]string, error) {
			return ids, nil
		},
		Refresh: func(ctx context.Context, widgetID string) {
			for i, id := range ids {
				if id == widgetID {
					atomic.AddInt64(&counts[i], 1)
				}
			}
		},
		Enabled: func(ctx context.Context) bool { return true },
	}

	s := New(cfg)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	go s.Run(ctx)

	pollUntil(t, 2*time.Second, func() bool {
		for i := range counts {
			if atomic.LoadInt64(&counts[i]) == 0 {
				return false
			}
		}
		return true
	})
}

func TestScheduler_DisabledSkipsTicksButKickRefreshes(t *testing.T) {
	silenceLogs(t)

	var count int64

	cfg := Config{
		Interval: 20 * time.Millisecond,
		ListWidgets: func(ctx context.Context) ([]string, error) {
			return []string{"a"}, nil
		},
		Refresh: func(ctx context.Context, widgetID string) {
			atomic.AddInt64(&count, 1)
		},
		Enabled: func(ctx context.Context) bool { return false },
	}

	s := New(cfg)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	go s.Run(ctx)

	// Wait ~5 intervals; ticks must never refresh while disabled.
	time.Sleep(5 * 20 * time.Millisecond)
	if got := atomic.LoadInt64(&count); got != 0 {
		t.Fatalf("expected 0 refreshes while disabled, got %d", got)
	}

	// Kick must refresh regardless of Enabled.
	s.Kick()
	pollUntil(t, 2*time.Second, func() bool {
		return atomic.LoadInt64(&count) > 0
	})
}

func TestScheduler_PanicInRefreshDoesNotStopLoop(t *testing.T) {
	silenceLogs(t)

	var round int64
	var count int64

	cfg := Config{
		Interval: 20 * time.Millisecond,
		ListWidgets: func(ctx context.Context) ([]string, error) {
			return []string{"a"}, nil
		},
		Refresh: func(ctx context.Context, widgetID string) {
			r := atomic.AddInt64(&round, 1)
			if r == 1 {
				panic("boom")
			}
			atomic.AddInt64(&count, 1)
		},
		Enabled: func(ctx context.Context) bool { return true },
	}

	s := New(cfg)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	go s.Run(ctx)

	// First round panics; subsequent rounds must still fire and keep the
	// counter rising.
	pollUntil(t, 2*time.Second, func() bool {
		return atomic.LoadInt64(&count) > 0
	})

	firstSeen := atomic.LoadInt64(&count)
	pollUntil(t, 2*time.Second, func() bool {
		return atomic.LoadInt64(&count) > firstSeen
	})
}

func TestScheduler_CancelStopsLoop(t *testing.T) {
	silenceLogs(t)

	var count int64

	cfg := Config{
		Interval: 20 * time.Millisecond,
		ListWidgets: func(ctx context.Context) ([]string, error) {
			return []string{"a"}, nil
		},
		Refresh: func(ctx context.Context, widgetID string) {
			atomic.AddInt64(&count, 1)
		},
		Enabled: func(ctx context.Context) bool { return true },
	}

	s := New(cfg)
	ctx, cancel := context.WithCancel(context.Background())

	done := make(chan struct{})
	go func() {
		s.Run(ctx)
		close(done)
	}()

	// Let a few rounds happen, then cancel.
	pollUntil(t, 2*time.Second, func() bool {
		return atomic.LoadInt64(&count) > 0
	})
	cancel()

	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("Run did not return after ctx cancellation")
	}

	snapshot := atomic.LoadInt64(&count)
	time.Sleep(5 * 20 * time.Millisecond)
	if got := atomic.LoadInt64(&count); got != snapshot {
		t.Fatalf("expected count to stay at %d after cancel, got %d", snapshot, got)
	}
}

func TestScheduler_OverlappingRoundsPrevented(t *testing.T) {
	silenceLogs(t)

	var inFlight int64
	var maxInFlight int64

	updateMax := func(v int64) {
		for {
			cur := atomic.LoadInt64(&maxInFlight)
			if v <= cur {
				return
			}
			if atomic.CompareAndSwapInt64(&maxInFlight, cur, v) {
				return
			}
		}
	}

	cfg := Config{
		Interval: 10 * time.Millisecond,
		ListWidgets: func(ctx context.Context) ([]string, error) {
			return []string{"a"}, nil
		},
		Refresh: func(ctx context.Context, widgetID string) {
			n := atomic.AddInt64(&inFlight, 1)
			updateMax(n)
			time.Sleep(100 * time.Millisecond)
			atomic.AddInt64(&inFlight, -1)
		},
		Enabled: func(ctx context.Context) bool { return true },
	}

	s := New(cfg)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	go s.Run(ctx)

	// Let several fast ticks fire while a slow refresh is in flight.
	time.Sleep(300 * time.Millisecond)
	cancel()

	if got := atomic.LoadInt64(&maxInFlight); got > 1 {
		t.Errorf("expected at most 1 concurrent round, observed max in-flight %d", got)
	}
}
