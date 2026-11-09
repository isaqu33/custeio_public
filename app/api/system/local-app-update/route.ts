import { AppFeature } from '@/app/lib/features';
import { parseRouteInput } from '@/app/lib/api-route';
import { HttpStatus } from '@/app/lib/http-status';
import { ApiErrorCode } from '@/app/lib/api-errors';
import { auth } from '@/app/lib/auth';
import { requireSystemAccess } from '@/app/lib/authorization';
import connectDB from '@/app/lib/connect-db';
import { withObservability } from '@/app/lib/observability';
import { localAppUpdate } from '@/app/lib/validations';
import SystemSettingsDB from '@/app/models/system-settings';
import { NextResponse } from 'next/server';

export const POST = withObservability<{}>(
  AppFeature.SYSTEM_LOCAL_APP_UPDATE,
  async (req, _ctx, { log }) => {
    try {
      const session = await auth();
      await requireSystemAccess(session);
      const input = await parseRouteInput(req, localAppUpdate);

      await connectDB();
      await SystemSettingsDB.updateOne(
        {},
        {
          $set: {
            gatewayUpdateEnabled: input.enabled,
            gatewayUpdateVersion: input.version,
            gatewayUpdateUrl: input.url,
            gatewayUpdateSha256: input.sha256,
            gatewayUpdateSignature: input.signature,
            gatewayUpdateRequired: input.required,
          },
        },
        { upsert: true },
      );

      return NextResponse.json({ done: true }, { status: HttpStatus.OK });
    } catch (err) {
      log.error({ err }, 'system local-app update failed');
      return NextResponse.json(
        { done: false, error: ApiErrorCode.INTERNAL_SERVER_ERROR },
        { status: HttpStatus.INTERNAL_SERVER_ERROR },
      );
    }
  },
);
