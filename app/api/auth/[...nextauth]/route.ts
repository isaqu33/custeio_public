import { handlers } from '@/app/lib/auth'; // Referring to the auth.ts we just created
import { getClientIpFromHeaders } from '@/app/lib/client-ip';
import { HttpStatus } from '@/app/lib/http-status';
import { ApiErrorCode } from '@/app/lib/api-errors';
import { rateLimit } from '@/app/lib/rate-limit';
import { env } from '@/app/lib/env';
import { NextRequest, NextResponse } from 'next/server';

function getIp(req: Request): string {
  return getClientIpFromHeaders(req.headers);
}

export async function GET(req: NextRequest) {
  if (await rateLimit('auth.nextauth.get', getIp(req), env.APP_RATE_LIMIT_AUTH_PER_MIN)) {
    return NextResponse.json(
      { done: false, error: ApiErrorCode.TOO_MANY_REQUESTS },
      { status: HttpStatus.TOO_MANY_REQUESTS },
    );
  }
  return handlers.GET(req);
}

export async function POST(req: NextRequest) {
  if (await rateLimit('auth.nextauth.post', getIp(req), env.APP_RATE_LIMIT_AUTH_PER_MIN)) {
    return NextResponse.json(
      { done: false, error: ApiErrorCode.TOO_MANY_REQUESTS },
      { status: HttpStatus.TOO_MANY_REQUESTS },
    );
  }
  return handlers.POST(req);
}
