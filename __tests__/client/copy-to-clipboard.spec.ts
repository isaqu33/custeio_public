import { copyToClipboard } from '@/app/lib/copy-to-clipboard';

const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');

function setClipboard(value: unknown) {
  Object.defineProperty(navigator, 'clipboard', {
    value,
    configurable: true,
    writable: true,
  });
}

afterEach(() => {
  document.body.innerHTML = '';
  if (originalClipboard) Object.defineProperty(navigator, 'clipboard', originalClipboard);
  else setClipboard(undefined);
});

describe('copyToClipboard', () => {
  it('uses the async clipboard API when the context is secure', async () => {
    const writeText = jest.fn().mockResolvedValue(undefined);
    setClipboard({ writeText });

    await expect(copyToClipboard('snippet')).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith('snippet');
  });

  it('falls back to execCommand when navigator.clipboard is undefined', async () => {
    // Plain HTTP over a LAN IP: the property does not exist at all.
    setClipboard(undefined);
    const execCommand = jest.fn(() => true);
    document.execCommand = execCommand;

    await expect(copyToClipboard('snippet')).resolves.toBe(true);
    expect(execCommand).toHaveBeenCalledWith('copy');
  });

  it('mounts the scratch textarea inside an open dialog so a focus trap cannot steal it', async () => {
    setClipboard(undefined);
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('data-state', 'open');
    document.body.appendChild(dialog);

    let hostTag = '';
    document.execCommand = jest.fn(() => {
      hostTag = (document.activeElement as HTMLElement).parentElement?.getAttribute('role') ?? '';
      return true;
    });

    await copyToClipboard('snippet');
    expect(hostTag).toBe('dialog');
  });

  it('reports failure when focus is stolen before the copy runs', async () => {
    setClipboard(undefined);
    const execCommand = jest.fn(() => true);
    document.execCommand = execCommand;
    const thief = document.createElement('input');
    document.body.appendChild(thief);
    document.addEventListener('focusin', (event) => {
      if (event.target !== thief) thief.focus();
    });

    await expect(copyToClipboard('snippet')).resolves.toBe(false);
    expect(execCommand).not.toHaveBeenCalled();
  });

  it('leaves no scratch element behind', async () => {
    setClipboard(undefined);
    document.execCommand = jest.fn(() => true);

    await copyToClipboard('snippet');
    expect(document.querySelectorAll('textarea')).toHaveLength(0);
  });
});
