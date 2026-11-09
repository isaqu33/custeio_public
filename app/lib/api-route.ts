import { z } from 'zod';

export async function parseRouteInput<T extends z.ZodTypeAny>(
  req: Request,
  schema: T,
): Promise<z.infer<T>> {
  const url = new URL(req.url);
  const queryObject = Object.fromEntries(url.searchParams.entries());

  if (req.method === 'GET') {
    return schema.parse(queryObject);
  }

  const body = await req.json().catch(() => ({}));
  return schema.parse(body);
}
