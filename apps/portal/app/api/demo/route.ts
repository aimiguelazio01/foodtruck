import { demoLinks } from '../../lib';

// Read on every request: the addresses come from the operator's .env, not from the build.
export const dynamic = 'force-dynamic';

export function GET() {
  const links = demoLinks(process.env.PLATFORM_DEMO_CUSTOMER_URL, process.env.PLATFORM_DEMO_MANAGEMENT_URL);
  return Response.json(links ?? {}, { headers: { 'Cache-Control': 'no-store' } });
}
