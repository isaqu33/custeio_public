/**
 * @jest-environment node
 */

import { BadRequestError, UnauthorizedError, requireAuth } from '@/app/lib/errors';
import { formatBytes } from '@/app/lib/format-bytes';
import { totalPages } from '@/app/lib/pagination';
import {
  createOrganization,
  createStore,
  getExams,
  passwordChange,
  safeSearchRegex,
} from '@/app/lib/validations';

jest.mock('@/app/lib/auth', () => ({
  auth: jest.fn(),
}));

describe('server lib core', () => {
  describe('pagination', () => {
    it('computes total pages', () => {
      expect(totalPages(0, 20)).toBe(0);
      expect(totalPages(1, 20)).toBe(1);
      expect(totalPages(21, 20)).toBe(2);
    });

    it('returns 0 for non-positive limit', () => {
      expect(totalPages(100, 0)).toBe(0);
      expect(totalPages(100, -1)).toBe(0);
    });
  });

  describe('formatBytes', () => {
    it('names the unit a file manager would show', () => {
      expect(formatBytes(512)).toBe('512 B');
      expect(formatBytes(2048)).toBe('2 KB');
      expect(formatBytes(5 * 1024 * 1024)).toBe('5 MB');
      expect(formatBytes(2 * 1024 ** 3)).toBe('2 GB');
    });

    it('keeps one decimal below 10 and drops it above', () => {
      expect(formatBytes(1.5 * 1024 ** 3)).toBe('1.5 GB');
      expect(formatBytes(24 * 1024 ** 2)).toBe('24 MB');
    });

    // The size hint renders before a file is picked, so a zero must not read
    // as "NaN undefined" next to the upload button.
    it('degrades to 0 B rather than NaN', () => {
      expect(formatBytes(0)).toBe('0 B');
      expect(formatBytes(Number.NaN)).toBe('0 B');
      expect(formatBytes(-1)).toBe('0 B');
    });
  });

  describe('validations', () => {
    it('escapes regex chars in search', () => {
      expect(safeSearchRegex('  a+b(c)  ')).toBe('a\\+b\\(c\\)');
    });

    it('requires only a name on organization create', () => {
      const parsed = createOrganization.parse({ name: 'Burger House' });
      expect(parsed.name).toBe('Burger House');
    });

    it('accepts an optional legal name and WhatsApp number on store create', () => {
      const parsed = createStore.parse({
        organizationId: '507f1f77bcf86cd799439011',
        cnpj: '11222333000181',
        name: 'Loja Centro',
        whatsappNumber: '11999999999',
        provider: 'alloy',
        externalId: 'loja-1',
      });
      expect(parsed.legalName).toBeUndefined();
      expect(parsed.whatsappNumber).toBe('11999999999');
    });

    it('requires a valid CNPJ on store create', () => {
      expect(() =>
        createStore.parse({
          organizationId: '507f1f77bcf86cd799439011',
          cnpj: '',
          name: 'Loja Centro',
          provider: 'alloy',
          externalId: 'loja-1',
        }),
      ).toThrow();
    });

    it('validates password confirmation', () => {
      expect(() =>
        passwordChange.parse({ newPassword: '12345678', confirmPassword: '87654321' }),
      ).toThrow('Passwords do not match.');
    });

    it('coerces paging defaults for exams query', () => {
      const parsed = getExams.parse({});
      expect(parsed.page).toBe(1);
      expect(parsed.limit).toBe(20);
      expect(parsed.searchType).toBe('name');
      expect(parsed.period).toBe('15');
    });
  });

  describe('errors/auth guard', () => {
    it('creates typed http errors', () => {
      const err = new BadRequestError('Invalid input');
      expect(err.status).toBe(400);
      expect(err.message).toBe('Invalid input');
      expect(err.name).toBe('BadRequestError');
    });

    it('throws unauthorized when session is missing', async () => {
      const { auth } = await import('@/app/lib/auth');
      (auth as jest.Mock).mockResolvedValueOnce(null);

      await expect(requireAuth()).rejects.toBeInstanceOf(UnauthorizedError);
    });
  });
});
