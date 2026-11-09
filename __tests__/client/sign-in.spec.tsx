import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import SignIn from '@/components/sign-in';
import { DICTIONARIES } from '@/app/lib/i18n/dictionary';

const signInMock = jest.fn();
const showErrorToastMock = jest.fn();
const pushMock = jest.fn();
const refreshMock = jest.fn();

// pt-BR on purpose: the login screen used to hard-code English strings, so this
// also proves nothing here reads from a frozen dictionary.
const copy = DICTIONARIES['pt-BR'];

jest.mock('@/app/lib/i18n/client', () => ({
  useCopy: () => jest.requireActual('@/app/lib/i18n/dictionary').DICTIONARIES['pt-BR'],
}));
jest.mock('@/app/lib/toast', () => ({
  showErrorToast: (...args: unknown[]) => showErrorToastMock(...args),
}));
jest.mock('next-auth/react', () => ({
  signIn: (...args: unknown[]) => signInMock(...args),
}));
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock, refresh: refreshMock }),
}));

function type(field: HTMLElement, value: string) {
  fireEvent.change(field, { target: { value } });
}

function fillEmailAndContinue(email: string) {
  type(screen.getByLabelText(copy.account.email), email);
  fireEvent.click(screen.getByRole('button', { name: copy.auth.continue }));
}

/** Advances to step 2 and waits for it — the step change is async (form.trigger). */
async function goToPasswordStep(email: string) {
  fillEmailAndContinue(email);
  return screen.findByLabelText(copy.account.password);
}

describe('SignIn', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    signInMock.mockResolvedValue({ error: undefined });
  });

  it('asks for the password only after the email is accepted', async () => {
    render(<SignIn />);

    // Step 1 must not expose the password field — that is the whole point of
    // splitting the form.
    expect(screen.queryByLabelText(copy.account.password)).not.toBeInTheDocument();

    expect(await goToPasswordStep('doctor@clinic.example')).toBeInTheDocument();
    expect(screen.queryByLabelText(copy.account.email)).not.toBeInTheDocument();
  });

  it('refuses to advance on an email the browser already rejects', async () => {
    render(<SignIn />);

    // `type="email"` means the browser's own constraint validation runs first and
    // blocks the submit, so zod never sees this value and no schema message appears.
    // What matters is that the step does not advance.
    fillEmailAndContinue('not-an-email');
    await waitFor(() => expect(signInMock).not.toHaveBeenCalled());

    expect(screen.queryByLabelText(copy.account.password)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: copy.auth.continue })).toBeInTheDocument();
  });

  it('shows the schema message for an email the browser lets through', async () => {
    render(<SignIn />);

    // `a@b` satisfies the native check but not the schema, so this is the path where
    // our own message is the one the user actually reads.
    fillEmailAndContinue('a@b');

    expect(await screen.findByText(copy.validation.invalidEmail)).toBeInTheDocument();
    expect(screen.queryByLabelText(copy.account.password)).not.toBeInTheDocument();
  });

  it('goes back to the email step and keeps what was typed', async () => {
    render(<SignIn />);

    await goToPasswordStep('doctor@clinic.example');
    fireEvent.click(screen.getByRole('button', { name: copy.auth.backToEmail }));

    const emailField = await screen.findByLabelText(copy.account.email);
    expect(emailField).toHaveValue('doctor@clinic.example');
  });

  it('signs in with the trimmed email and navigates on success', async () => {
    render(<SignIn />);

    type(await goToPasswordStep('  doctor@clinic.example  '), 'sup3r-secret');
    fireEvent.click(screen.getByRole('button', { name: copy.auth.signIn }));

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/'));
    expect(signInMock).toHaveBeenCalledWith('credentials', {
      redirect: false,
      Email: 'doctor@clinic.example',
      Password: 'sup3r-secret',
      callbackUrl: '/',
    });
  });

  it('shows the failure in the card, not only in a toast', async () => {
    // The old screen only fired a toast, which is gone by the time the user looks
    // back at the form. The message now stays next to the password field.
    signInMock.mockResolvedValue({ error: 'CredentialsSignin' });
    render(<SignIn />);

    type(await goToPasswordStep('doctor@clinic.example'), 'wrong');
    fireEvent.click(screen.getByRole('button', { name: copy.auth.signIn }));

    expect(await screen.findByRole('alert')).toHaveTextContent(copy.auth.invalidCredentials);
    expect(showErrorToastMock).toHaveBeenCalledWith(copy.auth.invalidCredentials);
    expect(pushMock).not.toHaveBeenCalled();
  });
});
