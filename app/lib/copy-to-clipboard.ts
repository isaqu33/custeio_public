/**
 * Copies text to the clipboard, with a fallback for non-secure contexts.
 *
 * `navigator.clipboard` is only defined in a secure context — HTTPS or
 * localhost. Reaching the dev server over a LAN IP (or any plain-HTTP host) is
 * neither, so the property is `undefined` and calling `.writeText` on it throws.
 * The legacy `execCommand('copy')` path still works there, so try the modern API
 * first and fall back instead of failing in front of the user.
 *
 * Returns whether the text made it to the clipboard, so callers can show the
 * right toast rather than assuming success.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Permission denied or a blocked context — try the legacy path below.
  }
  return copyWithExecCommand(text);
}

function copyWithExecCommand(text: string): boolean {
  if (typeof document === 'undefined') return false;
  const textarea = document.createElement('textarea');
  textarea.value = text;
  // Keep it out of view and out of the tab order, and avoid the scroll jump that
  // a focused off-screen element causes on iOS.
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.top = '0';
  textarea.style.left = '-9999px';

  const host = clipboardHostElement();
  const previouslyFocused = document.activeElement as HTMLElement | null;
  host.appendChild(textarea);
  try {
    textarea.focus();
    textarea.select();
    textarea.setSelectionRange(0, text.length);
    // A focus trap can pull focus back before the command runs, and
    // `execCommand` then reports success while copying nothing. Checking who
    // actually holds focus is the only way to tell the caller the truth.
    if (document.activeElement !== textarea) return false;
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    host.removeChild(textarea);
    previouslyFocused?.focus?.();
  }
}

/**
 * Where to park the temporary textarea.
 *
 * Radix dialogs trap focus: a textarea appended to `document.body` while a
 * dialog is open gets focus yanked away before the copy happens, which is
 * exactly the case that matters here — the raw token is shown inside an
 * AlertDialog and the embed snippet inside the System dialog. Mounting it
 * *inside* the open dialog keeps it within the trap.
 */
function clipboardHostElement(): HTMLElement {
  const active = document.activeElement as HTMLElement | null;
  const trapped = active?.closest?.('[role="dialog"], [role="alertdialog"]');
  if (trapped instanceof HTMLElement) return trapped;
  const openDialog = document.querySelector(
    '[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]',
  );
  return openDialog instanceof HTMLElement ? openDialog : document.body;
}
