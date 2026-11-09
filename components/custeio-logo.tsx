import * as React from 'react';

// Built-in Custeio brand mark, inlined as SVG so the "Custe" wordmark can
// inherit the surrounding text color via `currentColor` (an <img src=".svg">
// can't — it would render the wordmark in the file's own ink and vanish on a
// dark sidebar).
//
// The mark is a hamburger whose layers are bars of a bar chart: each layer is
// an ingredient cost, and the stack is the cost of the sandwich. The top layer
// is shorter than the one below it so the stack also reads as a chart. The
// teal and amber are fixed colors (they hold on both grounds); only the
// wordmark follows the theme — see CusteioLogo. Gradient ids are namespaced to
// avoid colliding with any other inlined copy on the page.

const BUN_GRAD = 'cs-logo-bun';
const AMBER_GRAD = 'cs-logo-amber';

// Shared <defs>. Rendered once per component instance; the ids are stable so a
// second instance on the page just reuses the first definition.
function MarkGradients() {
  return (
    <defs>
      <linearGradient id={BUN_GRAD} x1="0" y1="0" x2="1" y2="1">
        <stop stopColor="#0C7C8C" />
        <stop offset="1" stopColor="#17B9A6" />
      </linearGradient>
      <linearGradient id={AMBER_GRAD} x1="0" y1="0" x2="1" y2="1">
        <stop stopColor="#F59E0B" />
        <stop offset="1" stopColor="#FCD34D" />
      </linearGradient>
    </defs>
  );
}

// The burger itself, drawn in the 0..64 box. Sized by the caller.
function MarkArtwork() {
  return (
    <>
      <path d="M5 26 C5 7 59 7 59 26 Z" fill={`url(#${BUN_GRAD})`} />
      <rect x="5" y="30" width="38" height="8" rx="4" fill={`url(#${AMBER_GRAD})`} />
      <rect x="5" y="41" width="54" height="8" rx="4" fill="#0C7C8C" />
      <path d="M5 52 H59 V54 C59 58 56 60 52 60 H12 C8 60 5 58 5 54 Z" fill={`url(#${BUN_GRAD})`} />
    </>
  );
}

// The burger mark only — used on the collapsed icon rail, where the wordmark
// has no room. Sized by the caller (width/height via className/props).
export function CusteioMark({ className, ...props }: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 64 64" fill="none" className={className} aria-hidden="true" {...props}>
      <MarkGradients />
      <MarkArtwork />
    </svg>
  );
}

// Full horizontal lockup: mark + "Custeio". "Custe" uses currentColor and "io"
// the --custeio-wordmark token, so the pair holds on the dark sidebar and the
// near-white one alike.
export function CusteioLogo({ className, ...props }: React.SVGProps<SVGSVGElement>) {
  return (
    // The mark keeps its native 0..64 geometry; the viewBox is padded on the
    // left and right so the lockup has the same optical inset as the collapsed
    // mark under the shared `h-11` sidebar header.
    <svg
      viewBox="-2 0 183 64"
      fill="none"
      className={className}
      role="img"
      aria-label="Custeio"
      {...props}
    >
      <MarkGradients />
      <MarkArtwork />
      <text
        x="74"
        y="41.5"
        fontFamily="system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif"
        fontWeight="800"
        fontSize="30"
        letterSpacing="-1.3"
      >
        {/* Both halves follow the surface rather than fixed literals: the
            sidebar is near-white in the light theme and near-black in dark.
            "Custe" tracks the sidebar foreground; "io" reads the theme
            token, which resolves to a darker brand teal on light and a
            lighter teal on dark. */}
        <tspan fill="currentColor">Custe</tspan>
        <tspan fill="hsl(var(--custeio-wordmark))">io</tspan>
      </text>
    </svg>
  );
}
