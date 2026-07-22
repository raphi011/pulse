package gws

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
)

func TestFetchTasksNormalizesAndPreservesOrder(t *testing.T) {
	resp := `{"items":[
	  {"id":"t2","title":"Second","status":"needsAction","webViewLink":"https://tasks/t2"},
	  {"id":"t1","title":"First","status":"completed","completed":"2026-07-20T10:00:00Z","due":"2026-07-21"}
	]}`
	var sawParams string
	run := func(ctx context.Context, args []string, out any) error {
		sawParams = args[len(args)-1]
		return json.Unmarshal([]byte(resp), out)
	}
	got, err := fetchTasks(context.Background(), run,
		tasksConfig{Tasklist: "@default", ShowCompleted: true, CompletedMaxAge: "All time", Limit: 25})
	if err != nil {
		t.Fatal(err)
	}
	// API returns manual (`position`) order — preserve it.
	if len(got.Tasks) != 2 || got.Tasks[0].ID != "t2" {
		t.Fatalf("order not preserved: %+v", got.Tasks)
	}
	if !got.Tasks[1].Completed || got.Tasks[1].CompletedAt != "2026-07-20T10:00:00Z" {
		t.Errorf("completed normalize wrong: %+v", got.Tasks[1])
	}
	// showCompleted drives showHidden too (completed tasks are hidden by default).
	if !strings.Contains(sawParams, `"showCompleted":true`) || !strings.Contains(sawParams, `"showHidden":true`) {
		t.Errorf("params = %s", sawParams)
	}
}

func TestSetTaskCompletedPatchSemantics(t *testing.T) {
	var bodies []string
	run := func(ctx context.Context, args []string, out any) error {
		bodies = append(bodies, args[len(args)-1])
		return nil
	}
	if err := setTaskCompleted(context.Background(), run, "@default", "t1", true); err != nil {
		t.Fatal(err)
	}
	if err := setTaskCompleted(context.Background(), run, "@default", "t1", false); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(bodies[0], `"status":"completed"`) {
		t.Errorf("complete body = %s", bodies[0])
	}
	// Un-completing must send completed:null so the timestamp clears under patch semantics.
	if !strings.Contains(bodies[1], `"completed":null`) || !strings.Contains(bodies[1], `"needsAction"`) {
		t.Errorf("uncomplete body = %s", bodies[1])
	}
}
