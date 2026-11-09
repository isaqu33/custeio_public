import { getCopy } from '@/app/lib/i18n/dictionary';
import { DEFAULT_LOCALE, normalizeLocale } from '@/app/lib/i18n/locales';
import { ptBR } from '@/app/lib/i18n/pt-br';
import type { AppCopy } from '@/app/lib/i18n/en-us';
import { formatCopy } from '@/app/lib/i18n/format';
import { createProfileFormSchema } from '@/components/edit-profile-modal/schema';
import { createUserSchema, updateUserSchema } from '@/components/modal-controller-user/schema';

describe('i18n dictionaries', () => {
  it('uses pt-BR as the default locale', () => {
    expect(DEFAULT_LOCALE).toBe('pt-BR');
    expect(normalizeLocale('unknown')).toBe('pt-BR');
  });

  it('returns Portuguese copy for pt-BR', () => {
    expect(getCopy('pt-BR').account.language).toBe('Idioma');
  });

  it('keeps derived dictionaries aligned to the en-US source shape', () => {
    const derived: AppCopy = ptBR;
    expect(derived.account.title).toBe('Editar perfil');
  });

  it('formats named placeholders in localized copy', () => {
    expect(formatCopy(getCopy('pt-BR').organizationWorkspace.selectedCount, { count: 3 })).toBe(
      '3 organizações',
    );
  });

  it('leaves placeholders untouched when no value is supplied', () => {
    expect(formatCopy(getCopy('en-US').organizationWorkspace.selectedCount, {})).toBe(
      '{count} organizations',
    );
  });

  it('creates localized profile validation messages', () => {
    const result = createProfileFormSchema(getCopy('pt-BR')).safeParse({
      username: 'A',
      userEmail: 'bad-email',
      password: '123',
      confirmPassword: '456',
      language: 'pt-BR',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((issue) => issue.message)).toEqual(
        expect.arrayContaining([
          'O nome deve ter pelo menos 2 caracteres.',
          'E-mail inválido',
          'A senha deve ter pelo menos 8 caracteres',
          'As senhas não conferem',
        ]),
      );
    }
  });

  it('accepts only supported locales in the profile schema', () => {
    const parsed = createProfileFormSchema(getCopy('en-US')).safeParse({
      username: 'Valid Name',
      userEmail: 'user@example.com',
      language: 'fr-FR',
    });

    expect(parsed.success).toBe(false);
  });
});

describe('user form schemas', () => {
  it('localizes create-user validation messages', () => {
    const result = createUserSchema(getCopy('pt-BR')).safeParse({
      username: 'A',
      userEmail: 'nope',
      password: '123',
      confirmPassword: '',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((issue) => issue.message)).toEqual(
        expect.arrayContaining([
          'O nome deve ter pelo menos 2 caracteres.',
          'E-mail inválido',
          'A senha deve ter pelo menos 8 caracteres',
          'A confirmação de senha é obrigatória',
        ]),
      );
    }
  });

  it('rejects mismatched passwords in the active language', () => {
    const result = createUserSchema(getCopy('pt-BR')).safeParse({
      username: 'Valid Name',
      userEmail: 'user@example.com',
      password: 'longenough1',
      confirmPassword: 'different1',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((issue) => issue.message)).toContain('As senhas não conferem');
    }
  });

  it('keeps the update schema free of password rules', () => {
    const result = updateUserSchema(getCopy('en-US')).safeParse({
      username: 'Valid Name',
      userEmail: 'user@example.com',
    });

    expect(result.success).toBe(true);
  });
});
