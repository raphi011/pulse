package module

import (
	"encoding/json"
	"errors"
	"testing"
)

func f64(v float64) *float64 { return &v }

var sysFields = []ConfigField{
	{Key: "sampleIntervalSeconds", Label: "Sample interval (seconds)", Kind: FieldNumber, Default: 2.0, Min: f64(1), Max: f64(10)},
	{Key: "historySeconds", Label: "History window (seconds)", Kind: FieldNumber, Default: 120.0, Min: f64(30), Max: f64(600)},
}

func TestValidateBackfillsDefaults(t *testing.T) {
	got, err := ValidateConfig(sysFields, json.RawMessage(`{}`))
	if err != nil {
		t.Fatal(err)
	}
	if got["sampleIntervalSeconds"] != 2.0 || got["historySeconds"] != 120.0 {
		t.Fatalf("got %v", got)
	}
}

func TestValidateRejectsOutOfRange(t *testing.T) {
	_, err := ValidateConfig(sysFields, json.RawMessage(`{"sampleIntervalSeconds": 99}`))
	if !errors.Is(err, ErrInvalidConfig) {
		t.Fatalf("got %v", err)
	}
}

func TestValidateRejectsBelowMin(t *testing.T) {
	_, err := ValidateConfig(sysFields, json.RawMessage(`{"sampleIntervalSeconds": 0}`))
	if !errors.Is(err, ErrInvalidConfig) {
		t.Fatalf("got %v", err)
	}
}

func TestValidateAcceptsWithinRange(t *testing.T) {
	got, err := ValidateConfig(sysFields, json.RawMessage(`{"sampleIntervalSeconds": 5, "historySeconds": 300}`))
	if err != nil {
		t.Fatal(err)
	}
	if got["sampleIntervalSeconds"] != 5.0 || got["historySeconds"] != 300.0 {
		t.Fatalf("got %v", got)
	}
}

func TestValidateRejectsWrongType(t *testing.T) {
	_, err := ValidateConfig(sysFields, json.RawMessage(`{"sampleIntervalSeconds": "five"}`))
	if !errors.Is(err, ErrInvalidConfig) {
		t.Fatalf("got %v", err)
	}
}

func TestValidateString(t *testing.T) {
	fields := []ConfigField{{Key: "query", Label: "Query", Kind: FieldString, Default: "is:open"}}

	got, err := ValidateConfig(fields, json.RawMessage(`{"query": "is:closed"}`))
	if err != nil {
		t.Fatal(err)
	}
	if got["query"] != "is:closed" {
		t.Fatalf("got %v", got)
	}

	_, err = ValidateConfig(fields, json.RawMessage(`{"query": 42}`))
	if !errors.Is(err, ErrInvalidConfig) {
		t.Fatalf("got %v", err)
	}
}

func TestValidateBoolean(t *testing.T) {
	fields := []ConfigField{{Key: "showClosed", Label: "Show closed", Kind: FieldBoolean, Default: false}}

	got, err := ValidateConfig(fields, json.RawMessage(`{"showClosed": true}`))
	if err != nil {
		t.Fatal(err)
	}
	if got["showClosed"] != true {
		t.Fatalf("got %v", got)
	}

	_, err = ValidateConfig(fields, json.RawMessage(`{"showClosed": "yes"}`))
	if !errors.Is(err, ErrInvalidConfig) {
		t.Fatalf("got %v", err)
	}
}

func TestValidateStringList(t *testing.T) {
	fields := []ConfigField{{Key: "repos", Label: "Repos", Kind: FieldStringList}}

	got, err := ValidateConfig(fields, json.RawMessage(`{"repos": ["a", "b"]}`))
	if err != nil {
		t.Fatal(err)
	}
	list, ok := got["repos"].([]string)
	if !ok || len(list) != 2 || list[0] != "a" || list[1] != "b" {
		t.Fatalf("got %v", got)
	}

	_, err = ValidateConfig(fields, json.RawMessage(`{"repos": ["a", 1]}`))
	if !errors.Is(err, ErrInvalidConfig) {
		t.Fatalf("got %v", err)
	}

	_, err = ValidateConfig(fields, json.RawMessage(`{"repos": "not-a-list"}`))
	if !errors.Is(err, ErrInvalidConfig) {
		t.Fatalf("got %v", err)
	}
}

func TestValidateEnum(t *testing.T) {
	fields := []ConfigField{{Key: "sort", Label: "Sort", Kind: FieldEnum, Options: []string{"asc", "desc"}, Default: "asc"}}

	got, err := ValidateConfig(fields, json.RawMessage(`{"sort": "desc"}`))
	if err != nil {
		t.Fatal(err)
	}
	if got["sort"] != "desc" {
		t.Fatalf("got %v", got)
	}

	_, err = ValidateConfig(fields, json.RawMessage(`{"sort": "sideways"}`))
	if !errors.Is(err, ErrInvalidConfig) {
		t.Fatalf("got %v", err)
	}
}

func TestValidateAsyncEnum(t *testing.T) {
	fields := []ConfigField{{Key: "board", Label: "Board", Kind: FieldAsyncEnum, OptionsKey: "boards"}}

	got, err := ValidateConfig(fields, json.RawMessage(`{"board": "board-1"}`))
	if err != nil {
		t.Fatal(err)
	}
	if got["board"] != "board-1" {
		t.Fatalf("got %v", got)
	}

	_, err = ValidateConfig(fields, json.RawMessage(`{"board": 1}`))
	if !errors.Is(err, ErrInvalidConfig) {
		t.Fatalf("got %v", err)
	}
}

func TestValidateAsyncMultiEnum(t *testing.T) {
	fields := []ConfigField{{Key: "labels", Label: "Labels", Kind: FieldAsyncMultiEnum, OptionsKey: "labels"}}

	got, err := ValidateConfig(fields, json.RawMessage(`{"labels": ["bug", "urgent"]}`))
	if err != nil {
		t.Fatal(err)
	}
	list, ok := got["labels"].([]string)
	if !ok || len(list) != 2 {
		t.Fatalf("got %v", got)
	}

	_, err = ValidateConfig(fields, json.RawMessage(`{"labels": [1, 2]}`))
	if !errors.Is(err, ErrInvalidConfig) {
		t.Fatalf("got %v", err)
	}
}

func TestValidateUnknownKeyStripped(t *testing.T) {
	fields := []ConfigField{{Key: "query", Label: "Query", Kind: FieldString, Default: "is:open"}}

	got, err := ValidateConfig(fields, json.RawMessage(`{"query": "is:closed", "bogus": "value"}`))
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := got["bogus"]; ok {
		t.Fatalf("expected unknown key stripped, got %v", got)
	}
	if len(got) != 1 {
		t.Fatalf("got %v", got)
	}
}

func TestValidateEmptyFieldsEmptyRaw(t *testing.T) {
	got, err := ValidateConfig(nil, json.RawMessage(`{}`))
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 0 {
		t.Fatalf("got %v", got)
	}
}

func TestValidateEmptyFieldsNilRaw(t *testing.T) {
	got, err := ValidateConfig(nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 0 {
		t.Fatalf("got %v", got)
	}
}

func TestValidateNonObjectRaw(t *testing.T) {
	_, err := ValidateConfig(sysFields, json.RawMessage(`[1,2,3]`))
	if !errors.Is(err, ErrInvalidConfig) {
		t.Fatalf("got %v", err)
	}

	_, err = ValidateConfig(sysFields, json.RawMessage(`"just a string"`))
	if !errors.Is(err, ErrInvalidConfig) {
		t.Fatalf("got %v", err)
	}
}

func TestDefaultConfig(t *testing.T) {
	fields := []ConfigField{
		{Key: "a", Kind: FieldNumber, Default: 1.0},
		{Key: "b", Kind: FieldString},
	}
	got := DefaultConfig(fields)
	if got["a"] != 1.0 {
		t.Fatalf("got %v", got)
	}
	if _, ok := got["b"]; ok {
		t.Fatalf("field with no default should not appear, got %v", got)
	}
}
