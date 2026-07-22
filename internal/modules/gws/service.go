package gws

import "context"

// Service is the Wails-bound face of gws mutations: widgets call these
// directly (no fetch pipeline) and then refresh(). Context is
// context.Background() since Wails-bound methods receive no context from JS.
type Service struct{ run jsonRunner }

func NewService() *Service { return &Service{run: runGwsJSON} }

// ArchiveEmail removes the INBOX label (message stays searchable, leaves the
// inbox).
func (s *Service) ArchiveEmail(id string) error {
	var out map[string]any
	return s.run(context.Background(), []string{
		"gmail", "users", "messages", "modify",
		"--params", jsonArg(map[string]any{"userId": "me", "id": id}),
		"--json", jsonArg(map[string]any{"removeLabelIds": []string{"INBOX"}}),
	}, &out)
}

// MarkEmailRead removes the UNREAD label.
func (s *Service) MarkEmailRead(id string) error {
	var out map[string]any
	return s.run(context.Background(), []string{
		"gmail", "users", "messages", "modify",
		"--params", jsonArg(map[string]any{"userId": "me", "id": id}),
		"--json", jsonArg(map[string]any{"removeLabelIds": []string{"UNREAD"}}),
	}, &out)
}

// TrashEmail moves a message to Trash (reversible in Gmail for 30 days).
func (s *Service) TrashEmail(id string) error {
	var out map[string]any
	return s.run(context.Background(), []string{
		"gmail", "users", "messages", "trash",
		"--params", jsonArg(map[string]any{"userId": "me", "id": id}),
	}, &out)
}

// SetTaskCompleted flips a task's completion state.
func (s *Service) SetTaskCompleted(tasklist, taskID string, completed bool) error {
	return setTaskCompleted(context.Background(), s.run, tasklist, taskID, completed)
}
