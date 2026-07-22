package module_test

import (
	"testing"

	"pulse/internal/module"
)

func TestDecodeConfigRoundTripsTypedStruct(t *testing.T) {
	type cfg struct {
		Query string   `json:"query"`
		Limit int      `json:"limit"`
		Tags  []string `json:"tags"`
	}
	got, err := module.DecodeConfig[cfg](map[string]any{
		"query": "is:unread", "limit": 15.0, "tags": []any{"a", "b"},
	})
	if err != nil {
		t.Fatalf("DecodeConfig: %v", err)
	}
	if got.Query != "is:unread" || got.Limit != 15 || len(got.Tags) != 2 {
		t.Fatalf("unexpected decode: %+v", got)
	}
}

func TestDecodeConfigNilMapYieldsZeroValue(t *testing.T) {
	type cfg struct {
		Limit int `json:"limit"`
	}
	got, err := module.DecodeConfig[cfg](nil)
	if err != nil {
		t.Fatalf("DecodeConfig(nil): %v", err)
	}
	if got.Limit != 0 {
		t.Fatalf("want zero value, got %+v", got)
	}
}
