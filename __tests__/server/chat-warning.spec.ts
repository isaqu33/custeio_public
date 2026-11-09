import { splitLeadingWarning } from '@/app/lib/chat-warning';

/* cspell:disable */
describe('splitLeadingWarning', () => {
  it('returns the whole content as body when there is no warning marker', () => {
    expect(splitLeadingWarning('Laudo normal, sem avisos.')).toEqual({
      warning: null,
      body: 'Laudo normal, sem avisos.',
    });
  });

  it('lifts a leading ⚠️ line, separated by a blank line, into the warning', () => {
    const notice = '⚠️ Análise parcial: 3 de 40 lotes de imagens não puderam ser processados.';
    const report = 'Resumo Executivo: ...\nAchados: ...';
    const { warning, body } = splitLeadingWarning(`${notice}\n\n${report}`);
    expect(warning).toBe(notice);
    expect(body).toBe(report);
  });

  it('treats content that is only a warning as all-warning, empty body', () => {
    expect(splitLeadingWarning('⚠️ Falha total.')).toEqual({
      warning: '⚠️ Falha total.',
      body: '',
    });
  });

  it('does not mistake a mid-text ⚠️ for a banner', () => {
    const content = 'Achado crítico ⚠️ presente no lobo superior.';
    expect(splitLeadingWarning(content)).toEqual({ warning: null, body: content });
  });
});
/* cspell:enable */
