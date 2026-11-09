import { fireEvent, render, screen } from '@testing-library/react';
import { UiDensityProvider, useUiDensity } from '@/components/ui-density';

function DensityToggle() {
  const { isCompact, toggleDensity } = useUiDensity();
  return (
    <button type="button" onClick={toggleDensity}>
      {isCompact ? 'Comfortable Mode' : 'Compact Mode'}
    </button>
  );
}

describe('UI density', () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.classList.remove('compact');
  });

  it('applies persisted compact density on mount', () => {
    window.localStorage.setItem('rayai-ui-density', 'compact');

    render(<UiDensityProvider />);

    expect(document.documentElement).toHaveClass('compact');
  });

  it('leaves the comfortable default alone when nothing is stored', () => {
    render(<UiDensityProvider />);

    expect(document.documentElement).not.toHaveClass('compact');
  });

  it('toggles compact density and persists it', () => {
    render(<DensityToggle />);

    fireEvent.click(screen.getByRole('button', { name: 'Compact Mode' }));

    expect(window.localStorage.getItem('rayai-ui-density')).toBe('compact');
    expect(document.documentElement).toHaveClass('compact');
    expect(screen.getByRole('button', { name: 'Comfortable Mode' })).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: 'Comfortable Mode' }));

    expect(window.localStorage.getItem('rayai-ui-density')).toBe('comfortable');
    expect(document.documentElement).not.toHaveClass('compact');
  });

  it('ignores an unrecognized stored value and stays comfortable', () => {
    window.localStorage.setItem('rayai-ui-density', 'cozy');

    render(<UiDensityProvider />);

    expect(document.documentElement).not.toHaveClass('compact');
  });
});
