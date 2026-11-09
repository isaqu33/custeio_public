// Shared (server + client) definitions for the embeddable chat widget's per-org
// branding. Pure module — no server imports — so the schema, services, the admin
// modal, and the widget can all agree on the same shape, defaults, and validation.

export const CHAT_TOGGLE_ICONS = [
  'chat',
  'message',
  'stethoscope',
  'sparkles',
  'activity',
] as const;

export type ChatToggleIcon = (typeof CHAT_TOGGLE_ICONS)[number];

// How the docked panel coexists with the host page when opened:
// - `push`   — reflow the host page aside so the panel becomes part of the layout
//              (default; reads best on pages with normal-flow content).
// - `overlay`— float the panel over the page without shifting it (fallback for
//              sites whose fixed headers/layout don't reflow cleanly).
export const CHAT_DISPLAY_MODES = ['push', 'overlay'] as const;

export type ChatDisplayMode = (typeof CHAT_DISPLAY_MODES)[number];

// Whether the widget starts open (docked) or closed (just the launcher button)
// when the host page first loads. A host that passes `initialState` to the loader
// still overrides this per-embed; this is only the per-org default.
export const CHAT_INITIAL_STATES = ['minimized', 'opened'] as const;

export type ChatInitialState = (typeof CHAT_INITIAL_STATES)[number];

export type ChatWidgetBranding = {
  headerTitle: string;
  welcomeMessage: string;
  primaryColor: string;
  backgroundColor: string;
  buttonColor: string;
  toggleIcon: ChatToggleIcon;
  // Icon shown next to the header title when no company logo is uploaded. Same
  // preset set as the toggle button, but chosen independently.
  headerIcon: ChatToggleIcon;
  displayMode: ChatDisplayMode;
  initialState: ChatInitialState;
  logoUrl: string;
};

export const DEFAULT_CHAT_BRANDING: ChatWidgetBranding = {
  headerTitle: 'Radiology AI Assistant',
  welcomeMessage: '',
  primaryColor: '#2563eb',
  backgroundColor: '#f9fafb',
  buttonColor: '#2563eb',
  toggleIcon: 'chat',
  headerIcon: 'stethoscope',
  displayMode: 'push',
  initialState: 'minimized',
  logoUrl: '',
};

// Accept only #rgb / #rrggbb. Everything downstream injects these into CSS, so
// validating here closes the CSS-injection vector at the source.
const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

export function isHexColor(value: unknown): value is string {
  return typeof value === 'string' && HEX_COLOR.test(value);
}

export function safeHexColor(value: unknown, fallback: string): string {
  return isHexColor(value) ? value : fallback;
}

export function safeToggleIcon(value: unknown): ChatToggleIcon {
  return CHAT_TOGGLE_ICONS.includes(value as ChatToggleIcon)
    ? (value as ChatToggleIcon)
    : DEFAULT_CHAT_BRANDING.toggleIcon;
}

export function safeHeaderIcon(value: unknown): ChatToggleIcon {
  return CHAT_TOGGLE_ICONS.includes(value as ChatToggleIcon)
    ? (value as ChatToggleIcon)
    : DEFAULT_CHAT_BRANDING.headerIcon;
}

export function safeDisplayMode(value: unknown): ChatDisplayMode {
  return CHAT_DISPLAY_MODES.includes(value as ChatDisplayMode)
    ? (value as ChatDisplayMode)
    : DEFAULT_CHAT_BRANDING.displayMode;
}

export function safeInitialState(value: unknown): ChatInitialState {
  return CHAT_INITIAL_STATES.includes(value as ChatInitialState)
    ? (value as ChatInitialState)
    : DEFAULT_CHAT_BRANDING.initialState;
}
