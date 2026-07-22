package module

import (
	"encoding/json"
	"errors"
	"fmt"
)

// ErrInvalidConfig is the sentinel wrapped by every validation failure;
// callers should check it with errors.Is.
var ErrInvalidConfig = errors.New("invalid config")

func invalid(key, why string) error {
	return fmt.Errorf("%w: field %q %s", ErrInvalidConfig, key, why)
}

// normalizeValue coerces numeric defaults to float64 so a backfilled default
// and a JSON-decoded value are always the same Go type for FieldNumber.
func normalizeValue(f ConfigField, v any) any {
	if f.Kind != FieldNumber {
		return v
	}
	switch n := v.(type) {
	case int:
		return float64(n)
	case int32:
		return float64(n)
	case int64:
		return float64(n)
	case float32:
		return float64(n)
	default:
		return v
	}
}

// DefaultConfig builds a config map from each field's default, skipping
// fields with no default.
func DefaultConfig(fields []ConfigField) map[string]any {
	out := map[string]any{}
	for _, f := range fields {
		if f.Default != nil {
			out[f.Key] = normalizeValue(f, f.Default)
		}
	}
	return out
}

// ValidateConfig ports Zod safeParse semantics: missing keys backfill from
// defaults, present keys type-check (numbers honor Min/Max, enums honor
// Options), unknown keys are stripped. Returns the normalized config.
func ValidateConfig(fields []ConfigField, raw json.RawMessage) (map[string]any, error) {
	in := map[string]any{}
	if len(raw) > 0 {
		if err := json.Unmarshal(raw, &in); err != nil {
			return nil, fmt.Errorf("%w: not a JSON object", ErrInvalidConfig)
		}
	}
	out := map[string]any{}
	for _, f := range fields {
		v, ok := in[f.Key]
		if !ok {
			if f.Default != nil {
				out[f.Key] = normalizeValue(f, f.Default)
			}
			continue
		}
		checked, err := checkField(f, v)
		if err != nil {
			return nil, err
		}
		out[f.Key] = checked
	}
	return out, nil
}

func checkField(f ConfigField, v any) (any, error) {
	switch f.Kind {
	case FieldString, FieldAsyncEnum:
		s, ok := v.(string)
		if !ok {
			return nil, invalid(f.Key, "must be a string")
		}
		return s, nil
	case FieldNumber:
		n, ok := v.(float64)
		if !ok {
			return nil, invalid(f.Key, "must be a number")
		}
		if f.Min != nil && n < *f.Min {
			return nil, invalid(f.Key, fmt.Sprintf("must be >= %g", *f.Min))
		}
		if f.Max != nil && n > *f.Max {
			return nil, invalid(f.Key, fmt.Sprintf("must be <= %g", *f.Max))
		}
		return n, nil
	case FieldBoolean:
		b, ok := v.(bool)
		if !ok {
			return nil, invalid(f.Key, "must be a boolean")
		}
		return b, nil
	case FieldStringList, FieldAsyncMultiEnum:
		arr, ok := v.([]any)
		if !ok {
			return nil, invalid(f.Key, "must be a string list")
		}
		out := make([]string, 0, len(arr))
		for _, item := range arr {
			s, ok := item.(string)
			if !ok {
				return nil, invalid(f.Key, "must contain only strings")
			}
			out = append(out, s)
		}
		return out, nil
	case FieldEnum:
		s, ok := v.(string)
		if !ok {
			return nil, invalid(f.Key, "must be a string")
		}
		for _, o := range f.Options {
			if o == s {
				return s, nil
			}
		}
		return nil, invalid(f.Key, "is not a valid option")
	default:
		return nil, invalid(f.Key, "has unknown kind "+string(f.Kind))
	}
}
