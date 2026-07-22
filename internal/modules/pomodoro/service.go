package pomodoro

import (
	"context"
	"time"

	"github.com/google/uuid"
	"github.com/wailsapp/wails/v3/pkg/services/notifications"
)

// notifier is the seam over the Wails notifications service; tests fake it.
type notifier interface {
	CheckNotificationAuthorization() (bool, error)
	RequestNotificationAuthorization() (bool, error)
	SendNotification(options notifications.NotificationOptions) error
}

// Service is the Wails-bound face of the pomodoro module: session-log CRUD
// for the frontend engine, plus native notifications.
type Service struct {
	repo   *Repo
	notify notifier
}

func NewService(r *Repo, n notifier) *Service { return &Service{repo: r, notify: n} }

// AddSession records one completed work block (finishedAt: epoch millis).
func (s *Service) AddSession(finishedAt int64) error {
	return s.repo.AddSession(context.Background(), finishedAt)
}

// CountToday returns completed work blocks since local midnight.
func (s *Service) CountToday() (int, error) {
	return s.repo.CountToday(context.Background(), time.Now())
}

// Notify fires a native notification for a phase ending, lazily requesting
// permission on first use. Returns false (never errors) when permission is
// denied or delivery fails — the widget shows an in-card hint but keeps
// timing.
func (s *Service) Notify(title, body string) bool {
	granted, err := s.notify.CheckNotificationAuthorization()
	if err != nil {
		return false
	}
	if !granted {
		granted, err = s.notify.RequestNotificationAuthorization()
		if err != nil || !granted {
			return false
		}
	}
	return s.notify.SendNotification(notifications.NotificationOptions{
		ID: uuid.NewString(), Title: title, Body: body,
	}) == nil
}
