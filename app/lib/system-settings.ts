// Custeio's brand is fixed: there is no per-install white-labeling, so there is no admin screen
// (nor a database-backed override) for it either. Primary is the brand teal
// (matches the logo's connectors); secondary/accent are its pale tints for
// hover and subtle fills. Consumed directly by the auth and protected layouts
// to build the `--brand-*` CSS custom properties on `<html>`.
export const DEFAULT_BRAND_PALETTE = {
  light: { primary: '#0C7C8C', secondary: '#E4F0F2', accent: '#D8EAEC' },
  dark: { primary: '#22A5B0', secondary: '#1B2E31', accent: '#152528' },
} as const;
