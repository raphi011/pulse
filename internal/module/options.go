package module

import "context"

// FieldOption is one selectable option for an asyncEnum/asyncMultiEnum
// config field.
type FieldOption struct {
	Value string `json:"value"`
	Label string `json:"label"`
}

// OptionsProvider resolves the current options for a single asyncEnum or
// asyncMultiEnum field (e.g. fetching Jira boards for a "board" field).
type OptionsProvider func(ctx context.Context) ([]FieldOption, error)

// OptionsSource is implemented by modules that expose asyncEnum/
// asyncMultiEnum fields; the returned map is keyed by ConfigField.OptionsKey.
type OptionsSource interface {
	FieldOptions() map[string]OptionsProvider
}
