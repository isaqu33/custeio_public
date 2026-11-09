'use client';

import { useCallback, useEffect, useState } from 'react';

const DENSITY_STORAGE_KEY = 'custeio-ui-density';
const COMPACT_CLASS = 'compact';

type UiDensity = 'comfortable' | 'compact';

function readStoredDensity(): UiDensity {
  if (typeof window === 'undefined') return 'comfortable';
  return window.localStorage.getItem(DENSITY_STORAGE_KEY) === 'compact' ? 'compact' : 'comfortable';
}

/**
 * Compact mode is a single class on <html>; `globals.css` drops the root font
 * size there, and because the design system sizes everything in rem the whole
 * UI scales down with it. No per-component overrides needed.
 */
function applyDensity(density: UiDensity) {
  if (typeof document === 'undefined') return;
  document.documentElement.classList.toggle(COMPACT_CLASS, density === 'compact');
}

export function useUiDensity() {
  const [density, setDensity] = useState<UiDensity>(() => readStoredDensity());

  useEffect(() => {
    applyDensity(density);
  }, [density]);

  const toggleDensity = useCallback(() => {
    setDensity((current) => {
      const next = current === 'compact' ? 'comfortable' : 'compact';
      window.localStorage.setItem(DENSITY_STORAGE_KEY, next);
      applyDensity(next);
      return next;
    });
  }, []);

  return {
    density,
    isCompact: density === 'compact',
    toggleDensity,
  };
}

/**
 * Renders nothing — it exists so the persisted density is reapplied on every
 * full page load, before the user opens the menu that owns the toggle.
 */
export function UiDensityProvider() {
  useEffect(() => {
    applyDensity(readStoredDensity());
  }, []);

  return null;
}
