import { render, screen } from '@testing-library/react';
import { ChatMarkdown } from '@/components/chat-markdown';

// Reply text is pt-BR prose, as the model writes it.
/* cspell:disable */

describe('ChatMarkdown', () => {
  it('renders **bold** as bold instead of showing the asterisks', () => {
    render(<ChatMarkdown text="O achado é **relevante** aqui." />);
    expect(screen.getByText('relevante').tagName).toBe('STRONG');
    expect(screen.queryByText(/\*\*/)).not.toBeInTheDocument();
  });

  it('groups consecutive markers into one list', () => {
    render(<ChatMarkdown text={'Pontos:\n- primeiro\n- segundo'} />);
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent('primeiro');
    expect(screen.getByRole('list').tagName).toBe('UL');
  });

  it('keeps a numbered list numbered', () => {
    render(<ChatMarkdown text={'1. um\n2. dois'} />);
    expect(screen.getByRole('list').tagName).toBe('OL');
  });

  /**
   * Replies stream in token by token, so half a `**` pair is a normal state —
   * it must read as text, not swallow the rest of the answer.
   */
  it('leaves an unclosed pair alone while the reply is still streaming', () => {
    render(<ChatMarkdown text="Considere **congestão" />);
    expect(screen.getByText('Considere **congestão')).toBeInTheDocument();
  });

  it('does not render markup the model may echo back', () => {
    const { container } = render(<ChatMarkdown text={'<b>x</b> e [link](http://a.b)'} />);
    expect(container.querySelector('b')).toBeNull();
    expect(container.querySelector('a')).toBeNull();
    expect(screen.getByText(/<b>x<\/b> e \[link\]\(http:\/\/a\.b\)/)).toBeInTheDocument();
  });

  it('drops a heading marker but keeps the heading text', () => {
    render(<ChatMarkdown text={'## Resumo\ntexto'} />);
    expect(screen.getByText('Resumo')).toBeInTheDocument();
    expect(screen.queryByText(/#/)).not.toBeInTheDocument();
  });
});
/* cspell:enable */
