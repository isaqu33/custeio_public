import { ApiErrorCode } from '@/app/lib/api-errors';
import { toObjectId } from '@/app/lib/mongo-id';

type AddAdminDeps = {
  organizationExists: (_organizationId: string) => Promise<boolean>;
  linkUserToOrganization: (
    _organizationId: string,
    _userId: string,
  ) => Promise<{ matchedCount: number }>;
  getUserName: (_userId: string) => Promise<string | null>;
};

type RemoveAdminDeps = {
  unlinkUserFromOrganization: (_organizationId: string, _userId: string) => Promise<boolean>;
};

/** Links a user to an organization. Server-side because hiding the action in
 * the dialog does not stop a direct API call. */
export async function addOrganizationAdmin(
  deps: AddAdminDeps,
  input: { organizationId: string; userId: string },
) {
  const { organizationId, userId } = input;
  const organizationExists = await deps.organizationExists(organizationId);
  if (!organizationExists) {
    return { done: false as const, status: 404, error: ApiErrorCode.NOT_FOUND };
  }

  const linkResult = await deps.linkUserToOrganization(organizationId, userId);
  if (linkResult.matchedCount === 0) {
    return { done: false as const, status: 404, error: ApiErrorCode.NOT_FOUND };
  }

  const userName = await deps.getUserName(userId);
  return {
    done: true as const,
    status: 200,
    message: `User ${userName ?? userId} linked successfully.`,
  };
}

export async function removeOrganizationAdmin(
  deps: RemoveAdminDeps,
  input: { organizationId: string; userId: string },
) {
  const { organizationId, userId } = input;
  const userFound = await deps.unlinkUserFromOrganization(organizationId, userId);
  if (!userFound) {
    return { done: false as const, status: 404, error: ApiErrorCode.NOT_FOUND };
  }
  return { done: true as const, status: 200, message: 'Admin removed successfully.' };
}

export function createOrganizationAdminDeps(models: {
  OrganizationsDB: {
    exists: (_query: { _id: ReturnType<typeof toObjectId> }) => Promise<unknown>;
  };
  UsersDB: {
    updateOne: (
      _query: { _id: ReturnType<typeof toObjectId> },
      _update: { $addToSet: { organizationIds: ReturnType<typeof toObjectId> } },
    ) => Promise<{ matchedCount: number }>;
    findById: (_id: ReturnType<typeof toObjectId>) => {
      select: (_s: string) => { lean: <T>() => Promise<T> };
    };
    findByIdAndUpdate: (
      _id: string,
      _update: { $pull: { organizationIds: ReturnType<typeof toObjectId> } },
    ) => Promise<unknown>;
  };
}) {
  const { OrganizationsDB, UsersDB } = models;
  return {
    organizationExists: async (organizationId: string) =>
      Boolean(await OrganizationsDB.exists({ _id: toObjectId(organizationId) })),
    linkUserToOrganization: async (organizationId: string, userId: string) =>
      UsersDB.updateOne(
        { _id: toObjectId(userId) },
        { $addToSet: { organizationIds: toObjectId(organizationId) } },
      ),
    getUserName: async (userId: string) => {
      const user = await UsersDB.findById(toObjectId(userId))
        .select('name')
        .lean<{ name?: string } | null>();
      return user?.name ?? null;
    },
    unlinkUserFromOrganization: async (organizationId: string, userId: string) =>
      Boolean(
        await UsersDB.findByIdAndUpdate(userId, {
          $pull: { organizationIds: toObjectId(organizationId) },
        }),
      ),
  };
}
