'use client';

// Typing a word to confirm, for the one screen in the product where a save is a
// clinical decision.
//
// Every other setting here is reversible by editing it back. A prompt is too,
// but the reports written in between are not: they were sent to a doctor and
// signed under instructions nobody reviewed. The friction is the point — it is
// there to convert a save made in passing into one made on purpose.

import * as React from 'react';
import { TriangleAlert } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useCopy } from '@/app/lib/i18n/client';

export function ConfirmPromptChange({
  open,
  onOpenChange,
  onConfirm,
  saving,
  /** What is about to change, in words — one line per prompt the admin edited. */
  changing,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  saving: boolean;
  changing: string[];
}) {
  const copy = useCopy().system.prompts.confirm;
  const [typed, setTyped] = React.useState('');
  const matches = typed.trim().toUpperCase() === copy.keyword.toUpperCase();

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        // Reset on close rather than in an effect — the codebase enforces
        // `react-hooks/set-state-in-effect`, and a dialog reopened with the word
        // still typed would defeat the whole point of typing it.
        if (!next) setTyped('');
        onOpenChange(next);
      }}
    >
      <AlertDialogContent className="border-2 border-amber-500">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <TriangleAlert className="size-5 text-amber-500" />
            {copy.title}
          </AlertDialogTitle>
          <AlertDialogDescription>{copy.body}</AlertDialogDescription>
        </AlertDialogHeader>

        {changing.length > 0 ? (
          <div className="rounded-md border bg-muted/40 p-3">
            <p className="text-xs font-medium uppercase text-muted-foreground">{copy.changing}</p>
            <ul className="mt-1 list-disc pl-5 text-sm">
              {changing.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="space-y-2">
          <p className="text-sm">
            {copy.prompt.split('{keyword}')[0]}
            <code className="rounded bg-muted px-1 font-mono font-semibold">{copy.keyword}</code>
            {copy.prompt.split('{keyword}')[1]}
          </p>
          <Input
            data-e2e-id="prompts-confirm-word"
            value={typed}
            autoComplete="off"
            placeholder={copy.placeholder}
            onChange={(event) => setTyped(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && matches && !saving) onConfirm();
            }}
          />
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel disabled={saving}>{copy.cancel}</AlertDialogCancel>
          <Button
            type="button"
            data-e2e-id="prompts-confirm"
            variant="destructive"
            disabled={!matches || saving}
            onClick={onConfirm}
          >
            {copy.confirm}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
