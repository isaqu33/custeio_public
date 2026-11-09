import { NextResponse } from 'next/server';
import { HttpStatus } from '@/app/lib/http-status';
import { ApiErrorCode } from '@/app/lib/api-errors';
import { rateLimit } from '@/app/lib/rate-limit';
import { env } from '@/app/lib/env';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(req: Request) {
  const ip = req.headers.get('x-forwarded-for')?.split(',').at(0)?.trim() || 'unknown';
  if (await rateLimit('health.live', ip, env.APP_RATE_LIMIT_HEALTH_PER_MIN)) {
    return NextResponse.json(
      { status: 'fail', error: ApiErrorCode.TOO_MANY_REQUESTS },
      { status: HttpStatus.TOO_MANY_REQUESTS },
    );
  }
  return NextResponse.json(
    {
      status: 'ok',
      timestamp: new Date().toISOString(),
    },
    { status: HttpStatus.OK },
  );
}
