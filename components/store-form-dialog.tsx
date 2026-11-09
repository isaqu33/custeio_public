'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
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
import type { PosStoreProvider, Store } from './data-table-organization-stores';

// Only Alloy is wired up today — we hold the account and API access. The
// others are the other major Brazilian food-service POS platforms, reserved
// for planned expansion; picking one here just isn't offered yet.
const LIVE_PROVIDERS: readonly PosStoreProvider[] = ['alloy'];
const ALL_PROVIDERS: readonly PosStoreProvider[] = [
  'alloy',
  'consumer',
  'saipos',
  'grandchef',
  'anota_ai',
];

function formatCNPJ(value: string) {
  const digits = value.replace(/\D/g, '').slice(0, 14);
  return digits
    .replace(/^(\d{2})(\d)/, '$1.$2')
    .replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d)/, '.$1/$2')
    .replace(/(\d{4})(\d)/, '$1-$2');
}

/** Add a new Loja (1 CNPJ = 1 Alloy account), or edit an existing one. CNPJ,
 * provider and external id are the loja's identity (cnpj is the unique index
 * in Stores), so they're locked once a store exists — only the mutable
 * business fields (name, legal name, WhatsApp, key, image) can change. */
export function StoreFormDialog({
  organizationId,
  store,
  open,
  onOpenChange,
  onSaved,
}: {
  organizationId: string;
  store?: Store;
  open: boolean;
  onOpenChange: (_open: boolean) => void;
  onSaved: () => Promise<void> | void;
}) {
  const copy = useCopy().system.organizations.stores;
  const isEdit = Boolean(store);
  const [isLoading, setIsLoading] = useState(false);
  const [cnpj, setCnpj] = useState(store?.cnpj ?? '');
  const [legalName, setLegalName] = useState(store?.legalName ?? '');
  const [name, setName] = useState(store?.name ?? '');
  const [whatsappNumber, setWhatsappNumber] = useState(store?.whatsappNumber ?? '');
  const [provider, setProvider] = useState<PosStoreProvider>(store?.provider ?? 'alloy');
  const [externalId, setExternalId] = useState(store?.externalId ?? '');
  const [apiKey, setApiKey] = useState('');
  const [imageUrl, setImageUrl] = useState(store?.imageUrl ?? '');

  const handleSave = async () => {
    setIsLoading(true);
    try {
      if (isEdit && store) {
        await apiFetch(endpointFor(AppFeature.ORGANIZATIONS_UPDATE_STORE), {
          method: 'POST',
          body: {
            id: store._id,
            name: name.trim(),
            legalName: legalName.trim(),
            whatsappNumber: whatsappNumber.trim(),
            imageUrl: imageUrl.trim(),
            // Blank means "leave the stored key as-is" — never overwrite it
            // with an accidental empty value.
            ...(apiKey.trim() && { apiKey: apiKey.trim() }),
          },
          cache: 'no-store',
        });
      } else {
        await apiFetch(endpointFor(AppFeature.ORGANIZATIONS_CREATE_STORE), {
          method: 'POST',
          body: {
            organizationId,
            cnpj: cnpj.trim(),
            name: name.trim(),
            provider,
            externalId: externalId.trim(),
            ...(legalName.trim() && { legalName: legalName.trim() }),
            ...(whatsappNumber.trim() && { whatsappNumber: whatsappNumber.trim() }),
            ...(apiKey.trim() && { apiKey: apiKey.trim() }),
            ...(imageUrl.trim() && { imageUrl: imageUrl.trim() }),
          },
          cache: 'no-store',
        });
      }
      showSuccessToast();
      await onSaved();
      onOpenChange(false);
    } catch (err) {
      if (!(err instanceof ApiError)) throw err;
      showApiErrorToast(err, { CONFLICT: copy.duplicateCnpj });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? copy.editTitle : copy.addTitle}</DialogTitle>
          <DialogDescription>
            {isEdit ? copy.editDescription : copy.addDescription}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="store-name">{copy.nameRequired}</Label>
            <Input
              id="store-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={copy.namePlaceholder}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="store-cnpj">{copy.cnpjRequired}</Label>
            <Input
              id="store-cnpj"
              value={cnpj}
              onChange={(e) => setCnpj(formatCNPJ(e.target.value))}
              placeholder={copy.cnpjPlaceholder}
              disabled={isEdit}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="store-legal-name">{copy.legalNameOptional}</Label>
            <Input
              id="store-legal-name"
              value={legalName}
              onChange={(e) => setLegalName(e.target.value)}
              placeholder={copy.legalNamePlaceholder}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="store-whatsapp">{copy.whatsappNumberOptional}</Label>
            <Input
              id="store-whatsapp"
              value={whatsappNumber}
              onChange={(e) => setWhatsappNumber(e.target.value)}
              placeholder={copy.whatsappNumberPlaceholder}
            />
          </div>

          <div className="space-y-2">
            <Label>{copy.provider}</Label>
            <Select
              value={provider}
              onValueChange={(value) => setProvider(value as PosStoreProvider)}
              disabled={isEdit}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ALL_PROVIDERS.map((value) => (
                  <SelectItem key={value} value={value} disabled={!LIVE_PROVIDERS.includes(value)}>
                    {copy.providerLabels[value]}
                    {!LIVE_PROVIDERS.includes(value) ? ` — ${copy.comingSoon}` : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="store-external-id">{copy.externalIdRequired}</Label>
            <Input
              id="store-external-id"
              value={externalId}
              onChange={(e) => setExternalId(e.target.value)}
              placeholder={copy.externalIdPlaceholder}
              disabled={isEdit}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="store-api-key">{copy.apiKeyOptional}</Label>
            <Input
              id="store-api-key"
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={isEdit ? copy.apiKeyPlaceholderEdit : copy.apiKeyPlaceholder}
              autoComplete="off"
            />
            <p className="text-xs text-muted-foreground">{copy.apiKeyHint}</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="store-image-url">{copy.imageUrlOptional}</Label>
            <Input
              id="store-image-url"
              value={imageUrl}
              onChange={(e) => setImageUrl(e.target.value)}
              placeholder={copy.imageUrlPlaceholder}
            />
            <p className="text-xs text-muted-foreground">{copy.imageUrlHint}</p>
          </div>
        </div>

        <DialogFooter>
          <Button
            onClick={() => void handleSave()}
            disabled={
              isLoading || (!isEdit && (!name.trim() || !cnpj.trim() || !externalId.trim()))
            }
            className="w-full"
          >
            {copy.save}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
