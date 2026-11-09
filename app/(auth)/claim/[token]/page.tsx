import Link from 'next/link';
import { CusteioLogo } from '@/components/custeio-logo';
import { ClaimForm } from '@/components/claim-form';
import { getServerCopyForSession } from '@/app/lib/i18n/server';
import { findClaimableOrganization } from '@/app/lib/services/organization-claim';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';

/**
 * PUBLIC. Where the owner of a new organization lands from the invite link.
 *
 * A bad link renders the same "invalid" card whether the token never existed,
 * was revoked, was already used or expired — telling those apart would help
 * someone probing for tokens. The `(auth)` layout already bounces a signed-in
 * visitor to `/`, so an operator testing a link should use a private window.
 */
export default async function ClaimPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const copy = await getServerCopyForSession(null);
  const organization = await findClaimableOrganization(token);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-8 bg-background px-6 py-10">
      <CusteioLogo className="h-14 w-auto max-w-full text-foreground" />
      {organization ? (
        <ClaimForm token={token} organizationName={organization.name} />
      ) : (
        <Card className="w-full max-w-sm">
          <CardHeader className="space-y-2">
            <CardTitle className="text-lg font-bold">{copy.claim.invalidTitle}</CardTitle>
            <CardDescription>{copy.claim.invalidDescription}</CardDescription>
          </CardHeader>
          <CardFooter>
            <Button asChild variant="outline" className="w-full">
              <Link href="/login">{copy.claim.backToLogin}</Link>
            </Button>
          </CardFooter>
        </Card>
      )}
    </main>
  );
}
