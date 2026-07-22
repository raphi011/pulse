/** One selectable option for an async config dropdown. */
export type FieldOption = { value: string; label: string };

type Provider = () => Promise<FieldOption[]>;

const registry = new Map<string, Provider>();

/** Register the live-options source for a config field's `optionsKey`. */
export function registerFieldOptions(key: string, provider: Provider): void {
  if (registry.has(key)) throw new Error(`Field options already registered: ${key}`);
  registry.set(key, provider);
}

export function getFieldOptionsProvider(key: string): Provider | undefined {
  return registry.get(key);
}

export function __clearFieldOptionsRegistry(): void {
  registry.clear();
}
