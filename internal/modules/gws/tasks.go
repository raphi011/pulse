package gws

import "context"

type gTask struct {
	ID          string `json:"id"`
	Title       string `json:"title"`
	Notes       string `json:"notes"`
	Status      string `json:"status"` // "needsAction" | "completed"
	Due         string `json:"due"`
	Completed   string `json:"completed"` // RFC3339, present only on completed tasks
	WebViewLink string `json:"webViewLink"`
}

// TaskItem mirrors the TS TaskItem payload shape.
type TaskItem struct {
	ID          string `json:"id"`
	Title       string `json:"title"`
	Notes       string `json:"notes,omitempty"`
	Due         string `json:"due"`
	Completed   bool   `json:"completed"`
	CompletedAt string `json:"completedAt,omitempty"`
	URL         string `json:"url"`
}
type TasksData struct {
	Tasks []TaskItem `json:"tasks"`
}

type tasksConfig struct {
	Tasklist        string `json:"tasklist"`
	ShowCompleted   bool   `json:"showCompleted"`
	CompletedMaxAge string `json:"completedMaxAge"`
	Limit           int    `json:"limit"`
}

func normalizeTask(t gTask) TaskItem {
	title := t.Title
	if title == "" {
		title = "(no title)"
	}
	return TaskItem{
		ID: t.ID, Title: title, Notes: t.Notes, Due: t.Due,
		Completed: t.Status == "completed", CompletedAt: t.Completed, URL: t.WebViewLink,
	}
}

func fetchTasks(ctx context.Context, run jsonRunner, cfg tasksConfig) (TasksData, error) {
	var resp struct {
		Items []gTask `json:"items"`
	}
	if err := run(ctx, []string{
		"tasks", "tasks", "list",
		"--params", jsonArg(map[string]any{
			"tasklist":      cfg.Tasklist,
			"maxResults":    cfg.Limit,
			"showCompleted": cfg.ShowCompleted,
			"showHidden":    cfg.ShowCompleted, // completed tasks are hidden by default
		}),
	}, &resp); err != nil {
		return TasksData{}, err
	}
	// The API returns items in manual (`position`) order — preserve it.
	tasks := make([]TaskItem, 0, len(resp.Items))
	for _, t := range resp.Items {
		tasks = append(tasks, normalizeTask(t))
	}
	return TasksData{Tasks: tasks}, nil
}

// setTaskCompleted flips a task's completion via `gws tasks tasks patch`.
// Un-completing sends completed:null so the timestamp clears under patch
// semantics.
func setTaskCompleted(ctx context.Context, run jsonRunner, tasklist, taskID string, completed bool) error {
	var body map[string]any
	if completed {
		body = map[string]any{"status": "completed"}
	} else {
		body = map[string]any{"status": "needsAction", "completed": nil}
	}
	var out map[string]any
	return run(ctx, []string{
		"tasks", "tasks", "patch",
		"--params", jsonArg(map[string]any{"tasklist": tasklist, "task": taskID}),
		"--json", jsonArg(body),
	}, &out)
}
