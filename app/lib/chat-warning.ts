// Presentation helpers shared by the chat widget. Kept framework-free (no React,
// no lucide) so they are unit-testable in the node jest environment.

// The medical-liability line shown under every conversation, mirroring the
// "AI can make mistakes" footers general-purpose assistants carry — but phrased
// for a clinical reader. Portuguese, matching the laudo language.
export const AI_DISCLAIMER =
  // cspell:disable-next-line
  'A IA pode cometer erros e este conteúdo é apenas uma sugestão — confira informações importantes e não use como substituto da avaliação de um profissional de saúde.';

// The analysis worker prepends a leading "⚠️ …" line (separated by a blank line)
// to the laudo when the analysis was partial (see withPartialNotice in
// process-analysis.ts). Split it off so the widget can render it as a styled
// banner instead of raw text. Degrades gracefully: content without the marker
// returns wholly as `body` with no `warning`.
export function splitLeadingWarning(content: string): { warning: string | null; body: string } {
  if (!content.startsWith('⚠️')) return { warning: null, body: content };
  const idx = content.indexOf('\n\n');
  if (idx === -1) return { warning: content.trim(), body: '' };
  return { warning: content.slice(0, idx).trim(), body: content.slice(idx + 2) };
}
