import { toObjectId } from '@/app/lib/mongo-id';
import { hasHumanSystemAccess, type SystemLevel } from '@/app/lib/system-levels';
import type UsersDB from '@/app/models/users';

type UsersModel = Pick<typeof UsersDB, 'findById' | 'countDocuments'>;

/**
 * The `systemLevel` an update should end up with, given the toggle's next value.
 *
 * `'system'` — the full platform bypass — can never be newly granted through
 * the Users screen; only `scripts/dev/grant-system-access.ts` mints it. Turning
 * the toggle on for anyone who does not already hold `'system'` grants
 * `'support'` instead. An account that already holds `'system'` keeps it while
 * the toggle stays on: this route only ever widens access under that ceiling,
 * never silently downgrades a level it could not itself have granted.
 */
export async function nextSystemLevelForToggle(
  usersModel: UsersModel,
  userId: string,
  hasSystemAccess: boolean,
): Promise<SystemLevel[]> {
  if (!hasSystemAccess) return [];
  const user = await usersModel
    .findById(toObjectId(userId))
    .select('systemLevel')
    .lean<{ systemLevel?: SystemLevel[] } | null>();
  return user?.systemLevel?.includes('system') ? ['system'] : ['support'];
}

/**
 * Whether clearing a user's system access would lock the caller out or leave
 * the install with nobody who can administer it.
 *
 * Two refusals:
 *
 * - `'self'` — the caller demoting themselves. They are one save away from
 *   losing the very screen they are standing on.
 * - `'last'` — removing the access from the last account that holds it, which
 *   would leave nobody able to administer the install.
 *
 * Both are one-way doors through the UI; `scripts/dev/grant-system-access.ts`
 * is the recovery hatch. Returns `null` for every other edit, including one
 * that keeps or grants access.
 */
export async function findSystemAccessLoss(
  usersModel: UsersModel,
  input: { targetUserId: string; actorUserId: string; nextHasSystemAccess: boolean },
): Promise<'self' | 'last' | null> {
  if (input.nextHasSystemAccess) return null;

  const target = await usersModel
    .findById(toObjectId(input.targetUserId))
    .select('systemLevel')
    .lean<{ systemLevel?: SystemLevel[] } | null>();
  if (!target || !hasHumanSystemAccess(target.systemLevel)) return null;

  if (input.targetUserId === input.actorUserId) return 'self';

  return (await countOtherActiveSystemAccounts(usersModel, input.targetUserId)) === 0
    ? 'last'
    : null;
}

/**
 * Accounts other than `targetUserId` that hold system access and are not
 * deactivated. A deactivated account cannot sign in, so it does not count as
 * someone able to administer the install.
 */
function countOtherActiveSystemAccounts(usersModel: UsersModel, targetUserId: string) {
  return usersModel.countDocuments({
    _id: { $ne: toObjectId(targetUserId) },
    'systemLevel.0': { $exists: true },
    // `null` matches both an explicit null and a missing field.
    disabledAt: null,
  });
}

/**
 * Whether deactivating this user would leave the install with no active
 * account holding system access — the same one-way door as clearing the
 * access, reached by a different button. Non-system users are never "last".
 */
export async function isLastActiveSystemAccount(
  usersModel: UsersModel,
  targetUserId: string,
): Promise<boolean> {
  const target = await usersModel
    .findById(toObjectId(targetUserId))
    .select('systemLevel')
    .lean<{ systemLevel?: SystemLevel[] } | null>();
  if (!target || !hasHumanSystemAccess(target.systemLevel)) return false;
  return (await countOtherActiveSystemAccounts(usersModel, targetUserId)) === 0;
}
