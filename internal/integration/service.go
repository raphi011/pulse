package integration

import (
	"context"
	"sync"
	"time"

	"pulse/internal/db"
	"pulse/internal/module"
)

const healthTTL = 30 * time.Second

type cachedHealth struct {
	at     time.Time
	health Health
}

type flight struct {
	done   chan struct{}
	health Health
}

// Service is the Wails-bound integrations service. All bound methods use
// context.Background() — Wails invokes them directly.
type Service struct {
	store        *db.Store
	registry     *module.Registry
	integrations []Integration

	mu       sync.Mutex
	cache    map[string]cachedHealth
	inflight map[string]*flight
}

func NewService(store *db.Store, reg *module.Registry, integrations []Integration) *Service {
	return &Service{
		store: store, registry: reg, integrations: integrations,
		cache: map[string]cachedHealth{}, inflight: map[string]*flight{},
	}
}

// probeClaim is the outcome of synchronously staking a claim on an
// integration's health: either a fresh cache hit, a follower waiting on
// someone else's in-flight probe, or the leader who must run the probe.
type probeClaim struct {
	id       string
	cached   *Health
	flight   *flight
	isLeader bool
}

// claim resolves the cache/in-flight state under the lock and returns
// immediately — no CLI call or other I/O happens here. Splitting this out
// from resolve lets Statuses call it before any slow work (DB reads,
// goroutine dispatch), removing the deterministic delay a DB read would
// otherwise insert between two concurrent callers reaching this check (see
// Statuses' doc comment for the reproduction). That closes the window that
// was actually observed, but doesn't make the two claim() calls atomic with
// each other — a nanoscale scheduling window between them still exists in
// principle, it's just no longer stretched wide enough by I/O to hit.
func (s *Service) claim(id string, force bool) probeClaim {
	s.mu.Lock()
	defer s.mu.Unlock()
	if !force {
		if c, ok := s.cache[id]; ok && time.Since(c.at) < healthTTL {
			h := c.health
			return probeClaim{id: id, cached: &h}
		}
	}
	if f, ok := s.inflight[id]; ok {
		return probeClaim{id: id, flight: f}
	}
	f := &flight{done: make(chan struct{})}
	s.inflight[id] = f
	return probeClaim{id: id, flight: f, isLeader: true}
}

// abortClaims releases every leader claim in claims without probing or
// caching: it deletes the leader's in-flight entry (so the next Statuses
// call re-probes fresh instead of finding a poisoned cache row) and wakes
// any followers already parked on <-c.flight.done with a zero-value Health
// carrying an explanatory Detail, rather than leaving them blocked forever.
// Used when Statuses can't proceed past the claim phase (e.g. the widgets
// DB read failed) and must give back every claim it just took.
func (s *Service) abortClaims(claims []probeClaim) {
	s.mu.Lock()
	for _, c := range claims {
		if c.isLeader {
			c.flight.health = Health{Detail: "integration status probe aborted before running: widgets query failed"}
			delete(s.inflight, c.id)
		}
	}
	s.mu.Unlock()
	for _, c := range claims {
		if c.isLeader {
			close(c.flight.done)
		}
	}
}

// resolve runs the actual (possibly slow) work for a claim: a follower just
// waits on the leader's channel; the leader runs the probe, caches the
// result, and wakes any followers.
func (s *Service) resolve(ctx context.Context, integ Integration, c probeClaim) Health {
	if c.cached != nil {
		return *c.cached
	}
	if !c.isLeader {
		<-c.flight.done
		return c.flight.health
	}
	health := probeHealth(ctx, integ)
	c.flight.health = health

	s.mu.Lock()
	s.cache[integ.ID] = cachedHealth{at: time.Now(), health: health}
	delete(s.inflight, integ.ID)
	s.mu.Unlock()
	close(c.flight.done)
	return health
}

func (s *Service) prefKey(id string) string { return "integration." + id + ".enabled" }

func (s *Service) override(ctx context.Context, id string) (*bool, error) {
	v, err := s.store.Pref(ctx, s.prefKey(id), "")
	if err != nil {
		return nil, err
	}
	switch v {
	case "true":
		t := true
		return &t, nil
	case "false":
		f := false
		return &f, nil
	}
	return nil, nil
}

func (s *Service) typesFor(id string) map[string]bool {
	types := map[string]bool{}
	for _, m := range s.registry.Manifests() {
		if m.Integration == id {
			types[m.Type] = true
		}
	}
	return types
}

// Statuses resolves every integration: health (cached/deduped, probed
// concurrently so a hung CLI doesn't block the others), enable override,
// and how many widgets it owns.
func (s *Service) Statuses(force bool) ([]Status, error) {
	ctx := context.Background()

	// Claim cache/in-flight state for every integration synchronously and
	// before any DB I/O: two concurrent Statuses calls (e.g. two widgets
	// both requesting a refresh) must dedup their probes against each
	// other, and sqlite serializes concurrent reads/writes on the same
	// connection — if the widgets query below ran first, the second
	// caller's query alone could take long enough that the first
	// caller's whole probe-and-cleanup cycle finishes before the second
	// ever reaches the in-flight check, defeating the dedup entirely.
	claims := make([]probeClaim, len(s.integrations))
	for i, integ := range s.integrations {
		claims[i] = s.claim(integ.ID, force)
	}

	widgets, err := s.store.Widgets(ctx)
	if err != nil {
		// Every claim above must be given back: a leader claim left in
		// s.inflight with a never-closed done channel would wedge every
		// future Statuses call for that integration behind <-c.flight.done
		// forever, turning one transient DB error into a permanent hang.
		s.abortClaims(claims)
		return nil, err
	}

	statuses := make([]Status, len(s.integrations))
	errs := make([]error, len(s.integrations))
	var wg sync.WaitGroup
	for i, integ := range s.integrations {
		wg.Add(1)
		go func() {
			defer wg.Done()
			health := s.resolve(ctx, integ, claims[i])
			override, err := s.override(ctx, integ.ID)
			if err != nil {
				errs[i] = err
				return
			}
			types := s.typesFor(integ.ID)
			count := 0
			for _, w := range widgets {
				if types[w.Type] {
					count++
				}
			}
			statuses[i] = Status{
				ID: integ.ID, Name: integ.Name, Tool: integ.Tool,
				Health:      health,
				Override:    override,
				Enabled:     resolveEnabled(integ.Tool != nil, health.Installed, override),
				WidgetCount: count,
			}
		}()
	}
	wg.Wait()
	for _, err := range errs {
		if err != nil {
			return nil, err
		}
	}
	return statuses, nil
}

// Enable stores a true override.
func (s *Service) Enable(id string) error {
	return s.store.SetPref(context.Background(), s.prefKey(id), "true")
}

// DisableResult: ConfirmRequired > 0 means nothing was changed and the
// caller must retry with deleteWidgets=true after user confirmation.
type DisableResult struct {
	ConfirmRequired int `json:"confirmRequired"`
	Deleted         int `json:"deleted"`
}

// Disable turns an integration off. Its widgets are deleted (cache rows
// cascade); if any exist and deleteWidgets is false, the call reports
// ConfirmRequired instead of changing anything.
func (s *Service) Disable(id string, deleteWidgets bool) (DisableResult, error) {
	ctx := context.Background()
	widgets, err := s.store.Widgets(ctx)
	if err != nil {
		return DisableResult{}, err
	}
	types := s.typesFor(id)
	victims := []string{}
	for _, w := range widgets {
		if types[w.Type] {
			victims = append(victims, w.ID)
		}
	}
	if len(victims) > 0 && !deleteWidgets {
		return DisableResult{ConfirmRequired: len(victims)}, nil
	}
	if err := s.store.RemoveWidgetsAndSetPref(ctx, victims, s.prefKey(id), "false"); err != nil {
		return DisableResult{}, err
	}
	return DisableResult{Deleted: len(victims)}, nil
}
