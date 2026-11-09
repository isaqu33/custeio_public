/**
 * @jest-environment node
 */
export {};

import {
  addOrganizationAdmin,
  removeOrganizationAdmin,
} from '@/app/lib/services/organization-admin';

function deps(
  overrides: {
    organizationExists?: boolean;
    matchedCount?: number;
    userName?: string | null;
  } = {},
) {
  const linkUserToOrganization = jest
    .fn()
    .mockResolvedValue({ matchedCount: overrides.matchedCount ?? 1 });

  return {
    organizationExists: async () => overrides.organizationExists ?? true,
    linkUserToOrganization,
    getUserName: async () => overrides.userName ?? null,
  };
}

const INPUT = { organizationId: 'org-1', userId: 'user-1' };

describe('organization admin service', () => {
  it('returns not found when the organization does not exist', async () => {
    const result = await addOrganizationAdmin(deps({ organizationExists: false }), INPUT);

    expect(result.done).toBe(false);
    if (result.done) throw new Error('expected error');
    expect(result.status).toBe(404);
  });

  it('returns not found when the user does not exist', async () => {
    const result = await addOrganizationAdmin(deps({ matchedCount: 0 }), INPUT);

    expect(result.done).toBe(false);
    if (result.done) throw new Error('expected error');
    expect(result.status).toBe(404);
  });

  it('links the user to the organization', async () => {
    const d = deps({ userName: 'Alice' });

    const result = await addOrganizationAdmin(d, INPUT);

    expect(result.done).toBe(true);
    if (!result.done) throw new Error('expected success');
    expect(result.message).toContain('Alice');
    expect(d.linkUserToOrganization).toHaveBeenCalledWith('org-1', 'user-1');
  });

  it('removeOrganizationAdmin returns not found when the user was not linked', async () => {
    const result = await removeOrganizationAdmin(
      { unlinkUserFromOrganization: async () => false },
      { organizationId: 'org-1', userId: 'user-1' },
    );

    expect(result.done).toBe(false);
    if (result.done) throw new Error('expected error');
    expect(result.status).toBe(404);
  });

  it('removeOrganizationAdmin drops the organization from the user scope', async () => {
    const unlinkUserFromOrganization = jest.fn().mockResolvedValue(true);

    const result = await removeOrganizationAdmin(
      { unlinkUserFromOrganization },
      { organizationId: 'org-1', userId: 'user-1' },
    );

    expect(result.done).toBe(true);
    expect(unlinkUserFromOrganization).toHaveBeenCalledWith('org-1', 'user-1');
  });
});
