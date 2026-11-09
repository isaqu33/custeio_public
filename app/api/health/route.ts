import { NextResponse } from 'next/server';
import { HttpStatus } from '@/app/lib/http-status';
import { ApiErrorCode } from '@/app/lib/api-errors';
import { checkReadiness } from '@/app/lib/health';
import { rateLimit } from '@/app/lib/rate-limit';
import { env } from '@/app/lib/env';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(req: Request) {
  const ip = req.headers.get('x-forwarded-for')?.split(',').at(0)?.trim() || 'unknown';
  if (await rateLimit('health', ip, env.APP_RATE_LIMIT_HEALTH_PER_MIN)) {
    return NextResponse.json(
      { status: 'fail', error: ApiErrorCode.TOO_MANY_REQUESTS },
      { status: HttpStatus.TOO_MANY_REQUESTS },
    );
  }
  const { body, statusCode } = await checkReadiness();
  return NextResponse.json(body, { status: statusCode });
}
