package pomodoro

import (
	"errors"
	"testing"

	"github.com/wailsapp/wails/v3/pkg/services/notifications"
)

type fakeNotifier struct {
	authorized bool
	requestOK  bool
	requestErr error
	sendErr    error
	sent       []notifications.NotificationOptions
	requested  int
}

func (f *fakeNotifier) CheckNotificationAuthorization() (bool, error) { return f.authorized, nil }
func (f *fakeNotifier) RequestNotificationAuthorization() (bool, error) {
	f.requested++
	return f.requestOK, f.requestErr
}
func (f *fakeNotifier) SendNotification(o notifications.NotificationOptions) error {
	f.sent = append(f.sent, o)
	return f.sendErr
}

func TestNotifySendsWhenAuthorized(t *testing.T) {
	n := &fakeNotifier{authorized: true}
	s := NewService(nil, n)
	if !s.Notify("Pomodoro done", "take a break") {
		t.Fatal("want true")
	}
	if len(n.sent) != 1 || n.sent[0].Title != "Pomodoro done" || n.sent[0].ID == "" {
		t.Errorf("sent = %+v", n.sent)
	}
}

func TestNotifyLazilyRequestsPermission(t *testing.T) {
	n := &fakeNotifier{authorized: false, requestOK: true}
	s := NewService(nil, n)
	if !s.Notify("t", "b") {
		t.Fatal("want true after granted request")
	}
	if n.requested != 1 {
		t.Errorf("requested %d times", n.requested)
	}
}

func TestNotifyDeniedOrFailingReturnsFalse(t *testing.T) {
	denied := &fakeNotifier{authorized: false, requestOK: false}
	if NewService(nil, denied).Notify("t", "b") {
		t.Error("denied must return false")
	}
	reqErr := &fakeNotifier{authorized: false, requestErr: errors.New("boom")}
	if NewService(nil, reqErr).Notify("t", "b") {
		t.Error("request error must return false")
	}
	sendErr := &fakeNotifier{authorized: true, sendErr: errors.New("boom")}
	if NewService(nil, sendErr).Notify("t", "b") {
		t.Error("send error must return false")
	}
}

func TestModuleManifest(t *testing.T) {
	ms := New().Manifests()
	if len(ms) != 1 || ms[0].Type != TimerType || ms[0].Refreshable {
		t.Fatalf("Manifests = %+v", ms)
	}
	if len(ms[0].ConfigFields) != 4 {
		t.Errorf("want 4 number fields, got %+v", ms[0].ConfigFields)
	}
}
