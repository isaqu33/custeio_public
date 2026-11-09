'use client';

import { Plus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useCopy } from '@/app/lib/i18n/client';
import type { RecipeIngredientOption } from '@/app/lib/services/products';
import { InternalUseDialog, type OutflowMode } from '@/components/internal-use-dialog';
import { Button } from '@/components/ui/button';

/** The "Registrar consumo" button of the Consumo interno page and the dialog it opens. */
export function InternalUseActions({
  mode = 'use',
  storeId,
  options,
  people,
}: {
  mode?: OutflowMode;
  storeId: string;
  options: RecipeIngredientOption[];
  people: string[];
}) {
  const copy = useCopy().internalUse;
  const router = useRouter();
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus className="mr-2 size-4" />
        {mode === 'waste' ? copy.waste.register : copy.register}
      </Button>
      {/* Mounted per opening: a new request id for each entry. */}
      {open ? (
        <InternalUseDialog
          mode={mode}
          storeId={storeId}
          options={options}
          people={people}
          open={open}
          onOpenChange={setOpen}
          onSaved={() => router.refresh()}
        />
      ) : null}
    </>
  );
}
