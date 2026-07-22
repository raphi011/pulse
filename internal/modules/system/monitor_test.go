package system

import (
	"encoding/json"
	"testing"
	"time"
)

func TestSampleReportsPlausibleValues(t *testing.T) {
	m := NewMonitor()
	first, err := m.Sample()
	if err != nil {
		t.Fatal(err)
	}
	if first.MemTotalBytes == 0 || first.MemUsedBytes > first.MemTotalBytes {
		t.Fatalf("memory implausible: %+v", first)
	}
	time.Sleep(250 * time.Millisecond)
	second, err := m.Sample()
	if err != nil {
		t.Fatal(err)
	}
	if second.CPUPercent < 0 || second.CPUPercent > 100 {
		t.Fatalf("cpu%% out of range: %v", second.CPUPercent)
	}
	if second.NetRxBytesPerSec < 0 || second.NetTxBytesPerSec < 0 {
		t.Fatalf("negative net rate: %+v", second)
	}
}

// Pins the camelCase keys the TS SystemStatsPayload type depends on.
func TestPayloadJSONKeys(t *testing.T) {
	m := NewMonitor()
	p, _ := m.Sample()
	raw, _ := json.Marshal(p)
	var keys map[string]any
	json.Unmarshal(raw, &keys)
	for _, k := range []string{"cpuPercent", "memUsedBytes", "memTotalBytes", "netRxBytesPerSec", "netTxBytesPerSec"} {
		if _, ok := keys[k]; !ok {
			t.Fatalf("missing key %s in %s", k, raw)
		}
	}
	if len(keys) != 5 {
		t.Fatalf("unexpected extra keys: %s", raw)
	}
}
