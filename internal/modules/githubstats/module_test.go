package githubstats

import "testing"

func TestManifests(t *testing.T) {
	ms := New().Manifests()
	if len(ms) != 2 || ms[0].Type != SummaryType || ms[1].Type != HeatmapType {
		t.Fatalf("Manifests = %+v", ms)
	}
	if ms[0].Integration != "github" || !ms[0].Refreshable {
		t.Errorf("summary manifest wrong: %+v", ms[0])
	}
	tf := ms[0].ConfigFields[0]
	if tf.Key != "timeframe" || len(tf.Options) != 4 || tf.Default != "30d" {
		t.Errorf("timeframe field wrong: %+v", tf)
	}
	if len(ms[1].ConfigFields) != 0 {
		t.Errorf("heatmap should have no config fields: %+v", ms[1].ConfigFields)
	}
}
