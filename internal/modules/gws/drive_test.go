package gws

import (
	"context"
	"encoding/json"
	"testing"
)

func TestCategorize(t *testing.T) {
	cases := map[string]string{
		"application/vnd.google-apps.document":     "docs",
		"application/vnd.google-apps.spreadsheet":  "sheets",
		"application/vnd.google-apps.presentation": "slides",
		"application/pdf":                          "other",
		"":                                         "other",
	}
	for mime, want := range cases {
		if got := categorize(mime); got != want {
			t.Errorf("categorize(%q) = %q, want %q", mime, got, want)
		}
	}
}

func TestFetchDriveReturnsAllStarredUnfiltered(t *testing.T) {
	resp := `{"files":[
	  {"id":"f1","name":"Doc","mimeType":"application/vnd.google-apps.document",
	   "modifiedTime":"2026-07-20T10:00:00Z","webViewLink":"https://docs/f1","iconLink":"https://icon/1"},
	  {"id":"f2","mimeType":"application/pdf"}
	]}`
	run := func(ctx context.Context, args []string, out any) error {
		return json.Unmarshal([]byte(resp), out)
	}
	got, err := fetchDrive(context.Background(), run, driveConfig{Limit: 25})
	if err != nil {
		t.Fatal(err)
	}
	if len(got.Files) != 2 {
		t.Fatalf("want 2 files (widget filters, fetch doesn't), got %d", len(got.Files))
	}
	if got.Files[0].Category != "docs" || got.Files[1].Name != "(untitled)" || got.Files[1].Category != "other" {
		t.Errorf("normalize wrong: %+v", got.Files)
	}
}
