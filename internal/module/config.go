package module

import "encoding/json"

// DecodeConfig round-trips a validated config map into a typed struct.
// Modules call it at the top of Fetch to get their typed config; the map has
// already passed ValidateConfig, so failures here are programming errors.
func DecodeConfig[T any](config map[string]any) (T, error) {
	var out T
	raw, err := json.Marshal(config)
	if err != nil {
		return out, err
	}
	if err := json.Unmarshal(raw, &out); err != nil {
		return out, err
	}
	return out, nil
}
