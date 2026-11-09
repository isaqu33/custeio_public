'use client';

import { useState } from 'react';

/**
 * Keeps an editable copy of filter values whose real owner is the URL.
 *
 * Filters are applied by navigating, so the server hands the applied values back
 * as props. Seeding `useState` from those props once means the controls stop
 * following the URL: after Back/Forward the table reloads with different results
 * while the inputs keep showing the previous filter, so the page describes a
 * query it is not running. Clearing had the mirror problem — the inputs went
 * blank while the listing fell back to its default range.
 *
 * The resync happens during render, which is React's documented alternative to
 * an effect for "adjust state when a prop changes", and is what the codebase's
 * `react-hooks/set-state-in-effect` rule pushes you toward. It compares values
 * rather than object identity, so a `router.refresh()` — same applied filters,
 * new object — leaves a half-typed draft alone.
 *
 * Ported from the sibling worklist so both apps behave identically here.
 */
export function useFilterDraft<T extends Record<string, string>>(applied: T) {
  const [draft, setDraft] = useState(applied);
  const [lastApplied, setLastApplied] = useState(applied);

  if (!haveSameValues(lastApplied, applied)) {
    setLastApplied(applied);
    setDraft(applied);
  }

  function setField<K extends keyof T>(key: K, value: T[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  return { draft, setField, setDraft };
}

function haveSameValues<T extends Record<string, string>>(left: T, right: T) {
  const keys = Object.keys(left) as (keyof T)[];
  if (keys.length !== Object.keys(right).length) return false;
  return keys.every((key) => left[key] === right[key]);
}
