import { NextResponse } from 'next/server';
import type { ApiErrorCode } from './api-errors';
import type { HttpStatus } from './http-status';

export function ok<T extends object>(body: T, status: HttpStatus = 200) {
  return NextResponse.json(body, { status });
}

export function done<T extends object>(body?: T, status: HttpStatus = 200) {
  return NextResponse.json({ done: true, ...(body ?? {}) }, { status });
}

export function fail(error: ApiErrorCode, status: HttpStatus, extra?: Record<string, unknown>) {
  return NextResponse.json({ done: false, error, ...(extra ?? {}) }, { status });
}
