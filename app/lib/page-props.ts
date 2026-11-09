export type SearchParamsValue = string | string[] | undefined;

export type SearchParams = Record<string, SearchParamsValue>;

// Next 15+: searchParams is a Promise in Server Components. Pages must
// `await props.searchParams` before passing the resolved object to the
// helpers below.
export type AppPageProps = {
  searchParams?: Promise<SearchParams>;
};

export function getSearchParamString(
  params: SearchParams | undefined,
  key: string,
  fallback = '',
): string {
  const value = params?.[key];
  if (Array.isArray(value)) return value[0] ?? fallback;
  return value ?? fallback;
}

export function getSearchParamNumber(
  params: SearchParams | undefined,
  key: string,
  fallback: number,
): number {
  const raw = getSearchParamString(params, key, String(fallback));
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}
