'use client';

import { useState } from 'react';
import { CreditCard } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { apiFetch, ApiError } from '@/app/lib/api-client';
import { AppFeature, endpointFor } from '@/app/lib/features';
import { showApiErrorToast, showSuccessToast } from '@/app/lib/toast';
import { useCopy } from '@/app/lib/i18n/client';

type RouterLike = {
  refresh: () => void;
};

type BillingStatus = 'up_to_date' | 'past_due';

/** Manual billing record — there is no Asaas integration yet (see
 * docs/features/organizations.md). Lets Support track/override billing state
 * and note an Asaas customer id by hand until that integration exists. */
export default function ModalOrganizationBilling({
  id,
  billingStatus,
  asaasCustomerId,
  router,
}: {
  id: string;
  billingStatus: BillingStatus;
  asaasCustomerId?: string;
  router: RouterLike;
}) {
  const copy = useCopy().system.organizations.billing;
  const [open, setOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [status, setStatus] = useState<BillingStatus>(billingStatus);
  const [customerId, setCustomerId] = useState(asaasCustomerId ?? '');

  // This component's own DialogTrigger opens it (unlike a dialog opened from
  // an external row action), so — unlike that one — onOpenChange really does
  // fire here on open, which is what lets this resync from the latest props
  // instead of whatever was last typed.
  const handleOpenChange = (newOpen: boolean) => {
    if (newOpen) {
      setStatus(billingStatus);
      setCustomerId(asaasCustomerId ?? '');
    }
    setOpen(newOpen);
  };

  const handleSave = async () => {
    setIsLoading(true);
    try {
      await apiFetch(endpointFor(AppFeature.ORGANIZATIONS_UPDATE_BILLING), {
        method: 'POST',
        body: { id, billingStatus: status, asaasCustomerId: customerId.trim() },
        cache: 'no-store',
      });
      showSuccessToast();
      router.refresh();
      setOpen(false);
    } catch (err) {
      if (!(err instanceof ApiError)) throw err;
      showApiErrorToast(err);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="size-10 rounded-full md:size-8"
          title={copy.open}
        >
          <CreditCard className="size-3.5" />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{copy.title}</DialogTitle>
          <DialogDescription>{copy.description}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>{copy.billingStatusLabel}</Label>
            <Select value={status} onValueChange={(value) => setStatus(value as BillingStatus)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="up_to_date">{copy.statusLabels.up_to_date}</SelectItem>
                <SelectItem value="past_due">{copy.statusLabels.past_due}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="org-asaas-customer-id">{copy.asaasCustomerIdLabel}</Label>
            <Input
              id="org-asaas-customer-id"
              value={customerId}
              onChange={(e) => setCustomerId(e.target.value)}
              placeholder={copy.asaasCustomerIdPlaceholder}
            />
          </div>
        </div>

        <DialogFooter>
          <Button onClick={() => void handleSave()} disabled={isLoading} className="w-full">
            {copy.save}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
