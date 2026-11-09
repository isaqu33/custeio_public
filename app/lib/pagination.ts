// Calculate the total number of pages for a given record count and page size.
// Returns 0 for an empty result set (so the UI can render "no pages" cleanly)
// and falls back to 0 if limit is non-positive.
export function totalPages(total: number, limit: number): number {
  if (limit <= 0) return 0;
  return Math.ceil(total / limit);
}

export function visiblePageWindow(current: number, total: number): (number | string)[] {
  const pages: (number | string)[] = [];
  if (total <= 7) {
    for (let i = 1; i <= total; i += 1) pages.push(i);
  } else if (current <= 4) {
    pages.push(1, 2, 3, 4, 5, '...', total);
  } else if (current >= total - 3) {
    pages.push(1, '...', total - 4, total - 3, total - 2, total - 1, total);
  } else {
    pages.push(1, '...', current - 1, current, current + 1, '...', total);
  }
  return pages;
}
