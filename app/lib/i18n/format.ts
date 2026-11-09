/**
 * Replaces named placeholders in localized copy strings.
 *
 * This helper intentionally stays small: dictionaries use simple tokens like
 * `{count}` and `{name}` so copy remains framework-independent and easy to
 * validate in tests.
 */
export function formatCopy(
  template: string,
  values: Record<string, string | number | boolean | null | undefined>,
) {
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, key: string) => {
    const value = values[key];
    return value === null || value === undefined ? match : String(value);
  });
}
