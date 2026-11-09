/**
 * @jest-environment node
 */
export {};

import {
  findSystemAccessLoss,
  isLastActiveSystemAccount,
  nextSystemLevelForToggle,
} from '@/app/lib/services/system-access';

const ACTOR = '665f735a90788d97f5a76311';
const TARGET = '665f735a90788d97f5a76322';
const OTHER = '665f735a90788d97f5a76333';

function usersModel(
  overrides: {
    systemLevel?: ('system' | 'support')[];
    othersWithAccess?: number;
  } = {},
) {
  return {
    findById: jest.fn().mockReturnValue({
      select: () => ({
        lean: jest.fn().mockResolvedValue({ systemLevel: overrides.systemLevel ?? [] }),
      }),
    }),
    countDocuments: jest.fn().mockResolvedValue(overrides.othersWithAccess ?? 0),
  };
}

describe('nextSystemLevelForToggle', () => {
  it('clears access when the toggle turns off', async () => {
    const result = await nextSystemLevelForToggle(usersModel(), TARGET, false);
    expect(result).toEqual([]);
  });

  it('grants support — never system — for an account with no access yet', async () => {
    const result = await nextSystemLevelForToggle(usersModel({ systemLevel: [] }), TARGET, true);
    expect(result).toEqual(['support']);
  });

  it('leaves an existing system-level account at system, not downgraded to support', async () => {
    const result = await nextSystemLevelForToggle(
      usersModel({ systemLevel: ['system'] }),
      TARGET,
      true,
    );
    expect(result).toEqual(['system']);
  });
});

describe('findSystemAccessLoss', () => {
  it('allows granting access', async () => {
    const result = await findSystemAccessLoss(usersModel(), {
      targetUserId: TARGET,
      actorUserId: ACTOR,
      nextHasSystemAccess: true,
    });
    expect(result).toBeNull();
  });

  it('allows clearing access the target never had', async () => {
    const result = await findSystemAccessLoss(usersModel({ systemLevel: [] }), {
      targetUserId: TARGET,
      actorUserId: ACTOR,
      nextHasSystemAccess: false,
    });
    expect(result).toBeNull();
  });

  it('refuses the caller removing their own access', async () => {
    const result = await findSystemAccessLoss(usersModel({ systemLevel: ['support'] }), {
      targetUserId: ACTOR,
      actorUserId: ACTOR,
      nextHasSystemAccess: false,
    });
    expect(result).toBe('self');
  });

  it('refuses removing the last account with access', async () => {
    const result = await findSystemAccessLoss(
      usersModel({ systemLevel: ['support'], othersWithAccess: 0 }),
      { targetUserId: TARGET, actorUserId: ACTOR, nextHasSystemAccess: false },
    );
    expect(result).toBe('last');
  });

  it('allows removing access when another account still has it', async () => {
    const result = await findSystemAccessLoss(
      usersModel({ systemLevel: ['support'], othersWithAccess: 1 }),
      { targetUserId: OTHER, actorUserId: ACTOR, nextHasSystemAccess: false },
    );
    expect(result).toBeNull();
  });
});

describe('isLastActiveSystemAccount', () => {
  it('is true for the only active account with system access', async () => {
    const result = await isLastActiveSystemAccount(
      usersModel({ systemLevel: ['support'], othersWithAccess: 0 }),
      TARGET,
    );
    expect(result).toBe(true);
  });

  it('is false while another active account still has system access', async () => {
    const result = await isLastActiveSystemAccount(
      usersModel({ systemLevel: ['support'], othersWithAccess: 1 }),
      TARGET,
    );
    expect(result).toBe(false);
  });

  it('is false for a tenant user, who carries no system access to lose', async () => {
    const result = await isLastActiveSystemAccount(
      usersModel({ systemLevel: [], othersWithAccess: 0 }),
      TARGET,
    );
    expect(result).toBe(false);
  });

  it('does not count deactivated accounts as remaining administrators', async () => {
    const model = usersModel({ systemLevel: ['support'], othersWithAccess: 1 });
    await isLastActiveSystemAccount(model, TARGET);
    expect(model.countDocuments).toHaveBeenCalledWith(
      expect.objectContaining({ disabledAt: null }),
    );
  });
});
