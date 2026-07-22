package integration

import (
	"context"
	"encoding/json"
	"errors"
	"path/filepath"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"pulse/internal/cli"
	"pulse/internal/db"
	"pulse/internal/module"
)

type manifestOnly struct{ manifests []module.Manifest }

func (m manifestOnly) Manifests() []module.Manifest { return m.manifests }
func (manifestOnly) Fetch(ctx context.Context, widgetType string, config map[string]any) (any, error) {
	return nil, nil
}

func testService(t *testing.T, integrations ...Integration) (*Service, *db.Store) {
	t.Helper()
	d, err := db.Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { d.Close() })
	if err := db.Migrate(d); err != nil {
		t.Fatal(err)
	}
	store := db.NewStore(d)
	reg, err := module.NewRegistry(manifestOnly{manifests: []module.Manifest{
		{Type: "github.prs", Integration: "github", Refreshable: true},
		{Type: "system.stats"},
	}})
	if err != nil {
		t.Fatal(err)
	}
	return NewService(store, reg, integrations), store
}

func TestProbeClassification(t *testing.T) {
	ok := probeHealth(context.Background(), Integration{Probe: func(ctx context.Context) error { return nil }})
	if !ok.Installed || ok.Authed != true {
		t.Errorf("healthy = %+v", ok)
	}
	notFound := probeHealth(context.Background(), Integration{Probe: func(ctx context.Context) error {
		return &cli.Error{Kind: cli.KindNotFound, Message: "gh not found — install it"}
	}})
	if notFound.Installed || notFound.Authed != false || notFound.Detail == "" {
		t.Errorf("not-found = %+v", notFound)
	}
	authFail := probeHealth(context.Background(), Integration{Probe: func(ctx context.Context) error {
		return errors.New("401")
	}})
	if !authFail.Installed || authFail.Authed != false {
		t.Errorf("auth-fail = %+v", authFail)
	}
	noAuth := probeHealth(context.Background(), Integration{NoAuth: true, Probe: func(ctx context.Context) error { return nil }})
	if noAuth.Authed != "n/a" {
		t.Errorf("noAuth healthy = %+v", noAuth)
	}
	noAuthFail := probeHealth(context.Background(), Integration{NoAuth: true, Probe: func(ctx context.Context) error {
		return errors.New("boom")
	}})
	if !noAuthFail.Installed || noAuthFail.Authed != "n/a" || noAuthFail.Detail == "" {
		t.Errorf("noAuth fail = %+v", noAuthFail)
	}
}

func TestStatusesCachesWithTTLAndForce(t *testing.T) {
	var probes atomic.Int32
	svc, _ := testService(t, Integration{
		ID: "github", Name: "GitHub", Tool: &Tool{Bin: "gh"},
		Probe: func(ctx context.Context) error { probes.Add(1); return nil },
	})
	if _, err := svc.Statuses(false); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.Statuses(false); err != nil {
		t.Fatal(err)
	}
	if got := probes.Load(); got != 1 {
		t.Errorf("probes = %d, want 1 (TTL cache)", got)
	}
	if _, err := svc.Statuses(true); err != nil {
		t.Fatal(err)
	}
	if got := probes.Load(); got != 2 {
		t.Errorf("probes = %d, want 2 after force", got)
	}
}

func TestStatusesDedupsConcurrentProbes(t *testing.T) {
	var probes atomic.Int32
	gate := make(chan struct{})
	svc, _ := testService(t, Integration{
		ID: "github", Name: "GitHub", Tool: &Tool{Bin: "gh"},
		Probe: func(ctx context.Context) error { probes.Add(1); <-gate; return nil },
	})
	var wg sync.WaitGroup
	for range 2 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if _, err := svc.Statuses(true); err != nil {
				t.Error(err)
			}
		}()
	}
	// Let both goroutines reach resolve's probe call before releasing it.
	for probes.Load() == 0 {
	}
	close(gate)
	wg.Wait()
	if got := probes.Load(); got != 1 {
		t.Errorf("probes = %d, want 1 (in-flight dedup)", got)
	}
}

// TestStatusesReleasesLeaderClaimsWhenWidgetsFails guards against a leaked
// leader claim: Statuses takes cache/in-flight claims for every integration
// before reading widgets, and must give them back if that read fails, or
// every later Statuses call for that integration wedges forever behind
// <-c.flight.done.
func TestStatusesReleasesLeaderClaimsWhenWidgetsFails(t *testing.T) {
	var probes atomic.Int32
	integ := Integration{
		ID: "github", Name: "GitHub", Tool: &Tool{Bin: "gh"},
		Probe: func(ctx context.Context) error { probes.Add(1); return nil },
	}
	reg, err := module.NewRegistry(manifestOnly{manifests: []module.Manifest{
		{Type: "github.prs", Integration: "github", Refreshable: true},
	}})
	if err != nil {
		t.Fatal(err)
	}

	d, err := db.Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Migrate(d); err != nil {
		t.Fatal(err)
	}
	store := db.NewStore(d)
	if err := d.Close(); err != nil { // force every subsequent store.Widgets() to fail
		t.Fatal(err)
	}

	svc := NewService(store, reg, []Integration{integ})

	if _, err := svc.Statuses(false); err == nil {
		t.Fatal("Statuses with a closed DB: want error, got nil")
	}
	if got := probes.Load(); got != 0 {
		t.Errorf("probes = %d, want 0 (a widgets-read failure must abort before any probe runs)", got)
	}

	// Swap in a working store (whitebox: same package). A leaked leader
	// claim from the call above would wedge this one behind
	// <-c.flight.done forever instead of probing fresh.
	d2, err := db.Open(filepath.Join(t.TempDir(), "test2.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { d2.Close() })
	if err := db.Migrate(d2); err != nil {
		t.Fatal(err)
	}
	svc.store = db.NewStore(d2)

	done := make(chan struct{})
	var statuses []Status
	var statusesErr error
	go func() {
		statuses, statusesErr = svc.Statuses(false)
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("Statuses hung after a prior widgets-read error — a leader claim was never released")
	}
	if statusesErr != nil {
		t.Fatalf("Statuses after recovery: %v", statusesErr)
	}
	if got := probes.Load(); got != 1 {
		t.Errorf("probes = %d, want 1 (fresh probe, not a poisoned cache entry from the aborted call)", got)
	}
	if len(statuses) != 1 || !statuses[0].Health.Installed || statuses[0].Health.Authed != true {
		t.Errorf("statuses = %+v", statuses)
	}
}

// TestAbortClaimsSetsAuthedFalse guards the follower-visible Health that
// abortClaims hands out: it must carry a typed Authed (false), matching the
// documented boolean | "n/a" contract, not a nil that serializes as null.
func TestAbortClaimsSetsAuthedFalse(t *testing.T) {
	svc := &Service{cache: map[string]cachedHealth{}, inflight: map[string]*flight{}}
	f := &flight{done: make(chan struct{})}
	svc.inflight["github"] = f
	claims := []probeClaim{{id: "github", flight: f, isLeader: true}}

	svc.abortClaims(claims)

	if f.health.Authed != false {
		t.Errorf("aborted Health.Authed = %#v, want false", f.health.Authed)
	}
	if _, stillInflight := svc.inflight["github"]; stillInflight {
		t.Error("aborted leader claim was not released from inflight")
	}
}

func TestResolveEnabled(t *testing.T) {
	tr, fa := true, false
	cases := []struct {
		hasTool, installed bool
		override           *bool
		want               bool
	}{
		{true, true, nil, true},
		{true, false, nil, false}, // tool missing → auto-disabled
		{false, false, nil, true}, // no tool concept → enabled
		{true, false, &tr, true},  // override wins
		{true, true, &fa, false},
	}
	for i, c := range cases {
		if got := resolveEnabled(c.hasTool, c.installed, c.override); got != c.want {
			t.Errorf("case %d: got %v", i, got)
		}
	}
}

func TestDisableConfirmFlowAndWidgetCount(t *testing.T) {
	svc, store := testService(t, Integration{
		ID: "github", Name: "GitHub", Tool: &Tool{Bin: "gh"},
		Probe: func(ctx context.Context) error { return nil },
	})
	ctx := context.Background()
	if err := store.AddWidget(ctx, db.Widget{ID: "w1", Type: "github.prs", TabID: "default", Config: json.RawMessage(`{}`)}); err != nil {
		t.Fatal(err)
	}

	statuses, err := svc.Statuses(false)
	if err != nil {
		t.Fatal(err)
	}
	if statuses[0].WidgetCount != 1 {
		t.Errorf("widgetCount = %d", statuses[0].WidgetCount)
	}

	res, err := svc.Disable("github", false)
	if err != nil {
		t.Fatal(err)
	}
	if res.ConfirmRequired != 1 || res.Deleted != 0 {
		t.Fatalf("res = %+v, want confirm required", res)
	}
	if widgets, _ := store.Widgets(ctx); len(widgets) != 1 {
		t.Fatal("widgets must survive an unconfirmed disable")
	}

	res, err = svc.Disable("github", true)
	if err != nil {
		t.Fatal(err)
	}
	if res.Deleted != 1 {
		t.Fatalf("res = %+v", res)
	}
	if widgets, _ := store.Widgets(ctx); len(widgets) != 0 {
		t.Fatal("widgets must be deleted on confirmed disable")
	}

	statuses, err = svc.Statuses(false)
	if err != nil {
		t.Fatal(err)
	}
	if statuses[0].Enabled || statuses[0].Override == nil || *statuses[0].Override != false {
		t.Errorf("post-disable status = %+v", statuses[0])
	}

	if err := svc.Enable("github"); err != nil {
		t.Fatal(err)
	}
	statuses, _ = svc.Statuses(false)
	if !statuses[0].Enabled {
		t.Errorf("post-enable status = %+v", statuses[0])
	}
}
