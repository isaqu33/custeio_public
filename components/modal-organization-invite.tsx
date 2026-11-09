'use client';

import { useState } from 'react';
import { Ban, Eye, Send } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { apiFetch, ApiError } from '@/app/lib/api-client';
import { AppFeature, endpointFor } from '@/app/lib/features';
import { showApiErrorToast, showErrorToast, showSuccessToast } from '@/app/lib/toast';
import { useCopy } from '@/app/lib/i18n/client';
import { AlertToken } from './alert-token-organization';

type RouterLike = {
  refresh: () => void;
};

// What the owner actually opens. Built in the browser so it always carries the
// origin the operator is on, with no dependency on an env var being set.
function claimLinkFor(token: string): string {
  return `${window.location.origin}/claim/${token}`;
}

/**
 * Generates a fresh invite for the organization, on demand — not at creation
 * time, so a claim credential doesn't sit around unused from the moment an org
 * exists. See ORGANIZATIONS_GENERATE_INVITE_TOKEN. What is shown is the claim
 * link (`/claim/<token>`) the owner opens, not the bare token.
 *
 * Once one exists, this swaps to viewing the current link again (the token is
 * stored in plaintext by design, see ORGANIZATIONS_VIEW_INVITE_TOKEN) or
 * revoking it.
 */
export default function ModalOrganizationInvite({
  id,
  hasPendingInvite,
  router,
}: {
  id: string;
  hasPendingInvite: boolean;
  router: RouterLike;
}) {
  const fullCopy = useCopy();
  const copy = fullCopy.system.organizations.invite;
  const [isLoading, setIsLoading] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [tokenCopy, setTokenCopy] = useState<{ title: string; description: string } | null>(null);

  const handleGenerate = async () => {
    setIsLoading(true);
    try {
      const result = await apiFetch<{ done: boolean; data: { inviteToken: string } }>(
        endpointFor(AppFeature.ORGANIZATIONS_GENERATE_INVITE_TOKEN),
        { method: 'POST', body: { id }, cache: 'no-store' },
      );
      if (!result.done) {
        showErrorToast();
        return;
      }
      setTokenCopy({ title: copy.savedTitle, description: copy.savedDescription });
      setToken(claimLinkFor(result.data.inviteToken));
      router.refresh();
    } catch (err) {
      if (!(err instanceof ApiError)) throw err;
      showApiErrorToast(err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleView = async () => {
    setIsLoading(true);
    try {
      const result = await apiFetch<{ done: boolean; data: { inviteToken: string } }>(
        endpointFor(AppFeature.ORGANIZATIONS_VIEW_INVITE_TOKEN),
        { method: 'POST', body: { id }, cache: 'no-store' },
      );
      if (!result.done) {
        showErrorToast();
        return;
      }
      setTokenCopy({ title: copy.viewTitle, description: copy.viewDescription });
      setToken(claimLinkFor(result.data.inviteToken));
    } catch (err) {
      if (!(err instanceof ApiError)) throw err;
      showApiErrorToast(err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleRevoke = async () => {
    try {
      await apiFetch(endpointFor(AppFeature.ORGANIZATIONS_REVOKE_INVITE_TOKEN), {
        method: 'POST',
        body: { id },
        cache: 'no-store',
      });
      showSuccessToast();
      router.refresh();
    } catch (err) {
      if (!(err instanceof ApiError)) throw err;
      showApiErrorToast(err);
    }
  };

  if (!hasPendingInvite) {
    return (
      <>
        <Button
          variant="ghost"
          size="icon"
          className="size-10 rounded-full md:size-8"
          title={copy.generate}
          disabled={isLoading}
          onClick={() => void handleGenerate()}
        >
          <Send className="size-3.5" />
        </Button>
        <AlertToken
          stateOpen={token !== null}
          tokenView={token ?? ''}
          onClose={() => setToken(null)}
          copy={{
            title: tokenCopy?.title ?? copy.savedTitle,
            description: tokenCopy?.description ?? copy.savedDescription,
            copy: copy.copy,
            acknowledge: copy.acknowledge,
          }}
        />
      </>
    );
  }

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        className="size-10 rounded-full md:size-8"
        title={copy.view}
        disabled={isLoading}
        onClick={() => void handleView()}
      >
        <Eye className="size-3.5" />
      </Button>

      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="size-10 rounded-full md:size-8"
            title={copy.revoke}
          >
            <Ban className="size-3.5" />
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{copy.revokeQuestion}</AlertDialogTitle>
            <AlertDialogDescription>{copy.revokeDescription}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{fullCopy.common.no}</AlertDialogCancel>
            <AlertDialogAction onClick={() => void handleRevoke()}>
              {fullCopy.common.yes}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertToken
        stateOpen={token !== null}
        tokenView={token ?? ''}
        onClose={() => setToken(null)}
        copy={{
          title: tokenCopy?.title ?? copy.viewTitle,
          description: tokenCopy?.description ?? copy.viewDescription,
          copy: copy.copy,
          acknowledge: copy.acknowledge,
        }}
      />
    </>
  );
}
