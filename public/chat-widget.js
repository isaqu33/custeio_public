/**
 * RayAI Chat Widget - Embeddable chat for client websites
 * Security: origin validation, config sanitization, scoped closure, validated colors
 */
(function () {
  'use strict';

  const WIDGET_ID = 'my-ai-chat-widget';
  // Docked-panel geometry. PANEL_WIDTH is the target column width; below
  // PUSH_MIN_WIDTH the panel overlays full-width instead of pushing the page.
  const PANEL_WIDTH = 420;
  const PUSH_MIN_WIDTH = 768;

  let iframe = null;
  let toggleButton = null;
  let widgetConfig = {};
  let widgetOrigin = '';
  let jobIdForClient = '';

  const DEFAULTS = {
    headerTitle: 'Radiology AI Assistant',
    welcomeMessage: '',
    primaryColor: '#2563eb',
    backgroundColor: '#f9fafb',
    buttonColor: '#2563eb',
    toggleIcon: 'chat',
    displayMode: 'push',
    initialState: 'minimized',
    logoUrl: '',
  };

  const DISPLAY_MODES = ['push', 'overlay'];
  const INITIAL_STATES = ['minimized', 'opened'];

  // Toggle-button icons keyed by preset name (must match CHAT_TOGGLE_ICONS in the
  // app). Stroke SVGs so a single white stroke recolors cleanly on any button.
  function strokeSvg(paths) {
    return (
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="26" height="26"' +
      ' fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
      paths +
      '</svg>'
    );
  }

  const ICON_SVGS = {
    chat: strokeSvg('<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>'),
    message: strokeSvg('<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>'),
    stethoscope: strokeSvg(
      '<path d="M4.8 2.3A.3.3 0 1 0 5 2H4a2 2 0 0 0-2 2v5a6 6 0 0 0 6 6 6 6 0 0 0 6-6V4a2 2 0 0 0-2-2h-1a.2.2 0 1 0 .3.3"/><path d="M8 15v1a6 6 0 0 0 12 0v-4"/><circle cx="20" cy="10" r="2"/>',
    ),
    sparkles: strokeSvg(
      '<path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3z"/>',
    ),
    activity: strokeSvg('<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>'),
  };

  // --- Validation ---

  const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
  function safeColor(value, fallback) {
    return typeof value === 'string' && HEX_COLOR.test(value) ? value : fallback;
  }
  function safeIcon(value) {
    return Object.prototype.hasOwnProperty.call(ICON_SVGS, value) ? value : DEFAULTS.toggleIcon;
  }
  function safeDisplayMode(value) {
    return DISPLAY_MODES.indexOf(value) !== -1 ? value : DEFAULTS.displayMode;
  }
  function safeInitialState(value) {
    return INITIAL_STATES.indexOf(value) !== -1 ? value : DEFAULTS.initialState;
  }

  function sanitizeUrl(url) {
    if (!url || typeof url !== 'string') return null;
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
      return parsed.origin;
    } catch {
      return null;
    }
  }

  function validateConfig(config) {
    if (!config || typeof config !== 'object') {
      console.error('[RayPilotWidget] Config must be an object.');
      return false;
    }
    if (!config.baseUrl || !sanitizeUrl(config.baseUrl)) {
      console.error('[RayPilotWidget] baseUrl is required and must be a valid HTTP/HTTPS URL.');
      return false;
    }
    return true;
  }

  // Normalize a branding object (from config.branding or the server) into a frozen,
  // validated shape. Colors are coerced to #hex, icon to a known preset.
  function normalizeBranding(raw) {
    const b = raw && typeof raw === 'object' ? raw : {};
    return Object.freeze({
      headerTitle:
        typeof b.headerTitle === 'string' ? b.headerTitle.slice(0, 80) : DEFAULTS.headerTitle,
      welcomeMessage:
        typeof b.welcomeMessage === 'string'
          ? b.welcomeMessage.slice(0, 280)
          : DEFAULTS.welcomeMessage,
      primaryColor: safeColor(b.primaryColor, DEFAULTS.primaryColor),
      backgroundColor: safeColor(b.backgroundColor, DEFAULTS.backgroundColor),
      buttonColor: safeColor(b.buttonColor, DEFAULTS.buttonColor),
      toggleIcon: safeIcon(b.toggleIcon),
      displayMode: safeDisplayMode(b.displayMode),
      initialState: safeInitialState(b.initialState),
      logoUrl: typeof b.logoUrl === 'string' && sanitizeUrl(b.logoUrl) ? b.logoUrl : '',
    });
  }

  // Branding comes from config.branding when the host provides it (e.g. our test
  // viewer), otherwise we fetch it by API token from the app. Never throws.
  async function resolveBranding(config, baseUrl) {
    if (config.branding) return normalizeBranding(config.branding);
    if (config.apiToken) {
      try {
        const res = await fetch(
          baseUrl + '/api/chat-widget/branding?token=' + encodeURIComponent(config.apiToken),
          { method: 'GET' },
        );
        if (res.ok) {
          const json = await res.json();
          if (json && json.done && json.data) return normalizeBranding(json.data);
        }
      } catch {
        /* fall through to defaults */
      }
    }
    return normalizeBranding(null);
  }

  // --- Core ---

  async function initialization(config) {
    if (iframe) {
      console.log('[RayPilotWidget] Already initialized. Call resetWidget() first.');
      return;
    }
    if (!validateConfig(config)) return;

    const baseUrl = config.baseUrl.replace(/\/+$/, '');
    const branding = await resolveBranding(config, baseUrl);
    if (iframe) return; // a concurrent call won the race while we awaited

    widgetConfig = Object.freeze({
      baseUrl: baseUrl,
      // The org API token, forwarded to the iframe so the chat UI can call the
      // token-authed message API same-origin. It is posted only to our own
      // widgetOrigin (never the host page), so it stays within our domain.
      apiToken: config.apiToken || undefined,
      idcontext: config.idcontext || undefined,
      // A host that explicitly passes initialState wins; otherwise fall back to the
      // org's branding default (set in the admin Chat branding modal).
      initialState: config.initialState || branding.initialState || 'minimized',
      branding: branding,
      userInfo: config.userInfo ? Object.freeze({ ...config.userInfo }) : undefined,
    });
    widgetOrigin = sanitizeUrl(widgetConfig.baseUrl);

    // Create iframe
    iframe = document.createElement('iframe');
    iframe.id = WIDGET_ID;
    iframe.sandbox = 'allow-scripts allow-forms allow-popups allow-same-origin';
    iframe.allow = '';
    iframe.referrerPolicy = 'strict-origin';
    // Docked as a full-height panel on the right edge (Gemini-style side panel). It
    // starts slid off-screen (translateX 100%) and animates in on open. Rather than
    // overlay the host page, opening pushes the page aside (a right margin on <html>)
    // so the panel becomes part of the layout — the page reflows into the remaining
    // width. Closing is driven from inside the widget (an X in its header posts
    // `closeWidget`), so no floating button overlaps the column.
    iframe.style.cssText =
      'position:fixed;top:0;right:0;height:100vh;width:' +
      PANEL_WIDTH +
      'px;max-width:100vw;border:none;border-radius:0;display:block;z-index:9999;box-shadow:-2px 0 24px rgba(0,0,0,0.18);transform:translateX(100%);transition:transform 0.28s ease;pointer-events:none;background-color:' +
      branding.backgroundColor +
      ';';
    iframe.src = widgetConfig.baseUrl + '/chat-widget';

    iframe.onload = function () {
      iframe.contentWindow.postMessage(
        { type: 'initChatWidget', config: widgetConfig },
        widgetOrigin,
      );
      if (widgetConfig.initialState === 'minimized') {
        closeWidget();
      } else {
        openWidget();
      }
    };

    document.body.appendChild(iframe);

    // Launcher button — opens the panel. Hidden while the panel is open (the panel
    // has its own in-header close), so it never overlaps the docked column.
    toggleButton = document.createElement('button');
    toggleButton.innerHTML = ICON_SVGS[branding.toggleIcon];
    toggleButton.setAttribute('aria-label', 'Open chat widget');
    toggleButton.style.cssText =
      'position:fixed;bottom:20px;right:20px;z-index:10000;width:56px;height:56px;border:none;cursor:pointer;border-radius:50%;box-shadow:0 4px 16px rgba(0,0,0,0.25);background-color:' +
      branding.buttonColor +
      ';display:flex;justify-content:center;align-items:center;';

    toggleButton.onclick = openWidget;

    document.body.appendChild(toggleButton);
  }

  // The org can force plain overlay (no page reflow) for sites whose fixed layout
  // doesn't shift cleanly.
  function isOverlayMode() {
    return !!(widgetConfig.branding && widgetConfig.branding.displayMode === 'overlay');
  }

  // Only push the host page aside when the org allows it AND there's room. On narrow
  // screens the panel would eat the whole viewport, so it overlays full-width instead
  // of pushing the page to zero width.
  function canPushPage() {
    return !isOverlayMode() && window.innerWidth >= PUSH_MIN_WIDTH;
  }

  // Width the panel actually occupies (capped at the viewport on small screens).
  function panelWidthPx() {
    return Math.min(PANEL_WIDTH, window.innerWidth);
  }

  // Slide the docked panel in and hide the launcher. When there's room, reflow the
  // host page to the panel's left (margin on <html>) so it reads as part of the
  // layout rather than an overlay — the panel closes itself via its in-header X.
  function openWidget() {
    if (iframe) {
      iframe.style.transform = 'translateX(0)';
      iframe.style.pointerEvents = 'auto';
    }
    if (toggleButton) toggleButton.style.display = 'none';
    if (canPushPage()) {
      document.documentElement.style.transition = 'margin-right 0.28s ease';
      document.documentElement.style.marginRight = panelWidthPx() + 'px';
    }
  }

  // Slide the panel back off-screen, release the page reflow, and bring the launcher
  // back.
  function closeWidget() {
    if (iframe) {
      iframe.style.transform = 'translateX(100%)';
      iframe.style.pointerEvents = 'none';
    }
    if (toggleButton) toggleButton.style.display = 'flex';
    document.documentElement.style.marginRight = '';
  }

  function removeWidget() {
    // Release any page reflow first, so tearing the widget down never leaves the
    // host page shifted.
    document.documentElement.style.marginRight = '';
    if (iframe && iframe.parentNode) {
      iframe.parentNode.removeChild(iframe);
      iframe = null;
    }
    if (toggleButton && toggleButton.parentNode) {
      toggleButton.parentNode.removeChild(toggleButton);
      toggleButton = null;
    }
  }

  function resetWidget() {
    removeWidget();
    widgetConfig = {};
    widgetOrigin = '';
    jobIdForClient = '';
  }

  // --- Message handler with origin validation ---

  function handleIncomingMessages(event) {
    if (!widgetOrigin || event.origin !== widgetOrigin) return;
    // The widget announces readiness once its own message listener is live. Re-send
    // the config in response: the iframe.onload post above can land before the
    // widget (a React app) has registered its listener, and that first post is then
    // lost — this closes that race deterministically.
    if (event.data && event.data.type === 'widgetReady' && iframe && widgetConfig.baseUrl) {
      iframe.contentWindow.postMessage(
        { type: 'initChatWidget', config: widgetConfig },
        widgetOrigin,
      );
      return;
    }
    if (event.data && event.data.type === 'updateJobId' && typeof event.data.jobId === 'string') {
      jobIdForClient = event.data.jobId;
    }
    // The panel's in-header X asks us to dismiss it back to the launcher button.
    if (event.data && event.data.type === 'closeWidget') {
      closeWidget();
    }
  }

  window.addEventListener('message', handleIncomingMessages);

  // --- Public API (read-only) ---

  const api = {
    initialization: initialization,
    removeWidget: removeWidget,
    resetWidget: resetWidget,
    get jobIdForClient() {
      return jobIdForClient;
    },
  };

  Object.defineProperty(window, 'RayPilotWidget', {
    value: Object.freeze(api),
    writable: false,
    configurable: false,
  });

  if (typeof exports !== 'undefined') {
    exports.default = api;
  }
})();
