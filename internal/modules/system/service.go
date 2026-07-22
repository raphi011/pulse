package system

// Service is the Wails-bound face of the sampler; the webview polls Stats()
// on its own interval (it must pause on document.hidden, which only the
// frontend can observe).
type Service struct{ monitor *Monitor }

func NewService(m *Monitor) *Service { return &Service{monitor: m} }

func (s *Service) Stats() (Payload, error) { return s.monitor.Sample() }
