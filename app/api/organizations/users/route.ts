import { AppFeature } from '@/app/lib/features';
import type { LeanDoc } from '@/app/lib/mongoose-types';
import { HttpStatus } from '@/app/lib/http-status';
import { parseRouteInput } from '@/app/lib/api-route';
import {
  getAuthorizedOrganizationIds,
  requireOrganizationAccess,
  requireSystemAccess,
} from '@/app/lib/authorization';
import connectDB from '@/app/lib/connect-db';
import { protectedAccountFilter } from '@/app/lib/protected-account';
import { requireAuth } from '@/app/lib/errors';
import { withObservability } from '@/app/lib/observability';
import { totalPages } from '@/app/lib/pagination';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import OrganizationDB from '../../../models/organizations';
import UsersDB from '../../../models/users';

const getOrganizationUsersQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  q: z.string().max(200).default(''),
  currentOrganizationId: z.string().min(1),
});

async function handler(req: Request) {
  const session = await requireAuth();
  // Platform administration: the pages this backs all live under `/system`,
  // which is System/Support only. Repeated here because the layout guard
  // shapes the UI and this shapes the request.
  await requireSystemAccess(session);
  // Exclude users already in this organization from search
  const { page, limit, q, currentOrganizationId } = await parseRouteInput(
    req,
    getOrganizationUsersQuerySchema,
  );

  await connectDB();
  await requireOrganizationAccess(session, currentOrganizationId);
  const authorizedOrganizationIds = await getAuthorizedOrganizationIds(session);

  const query: Record<string, unknown> = {
    // Keeps the platform bootstrap account out of the org's user picker.
    ...protectedAccountFilter(),
    $and: [
      { organizationIds: { $ne: currentOrganizationId } },
      {
        $or: [
          { organizationIds: { $size: 0 } },
          { organizationIds: { $in: authorizedOrganizationIds } },
        ],
      },
    ],
  };

  if (q) {
    query.$or = [{ name: { $regex: q, $options: 'i' } }, { email: { $regex: q, $options: 'i' } }];
  }

  const skip = (page - 1) * limit;

  const [users, total] = await Promise.all([
    UsersDB.find(query)
      .populate({
        path: 'organizationIds',
        model: OrganizationDB,
        select: 'name',
      })
      .sort({ _id: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    UsersDB.countDocuments(query),
  ]);

  return NextResponse.json(
    {
      data: users.map((doc: LeanDoc) => {
        const organizations = doc.organizationIds as { name?: string }[] | undefined;
        return {
          ...doc,
          _id: String(doc._id),
          organizationNames: organizations?.map((e) => e.name).join(', ') || 'No Organization',
        };
      }),
      total,
      page,
      totalPages: totalPages(total, limit),
      done: true,
      message: 'OK',
    },
    { status: HttpStatus.OK },
  );
}

export const GET = withObservability<{}>(AppFeature.ORGANIZATIONS_GET_USERS, handler);
export const POST = withObservability<{}>(AppFeature.ORGANIZATIONS_GET_USERS, handler);
