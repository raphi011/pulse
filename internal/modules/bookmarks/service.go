package bookmarks

import "context"

// Service is the Wails-bound face of the bookmarks repo: thin wrappers
// that supply context.Background() since Wails-bound methods receive no
// context from JS.
type Service struct{ repo *Repo }

func NewService(r *Repo) *Service { return &Service{repo: r} }

func (s *Service) List() ([]Bookmark, error) {
	return s.repo.List(context.Background())
}

func (s *Service) Add(title, url string) (Bookmark, error) {
	return s.repo.Add(context.Background(), title, url)
}

func (s *Service) Remove(id string) error {
	return s.repo.Remove(context.Background(), id)
}
