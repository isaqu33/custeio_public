import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Check, Copy, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { showErrorToast, showSuccessToast } from '@/app/lib/toast';
import { copyToClipboard } from '@/app/lib/copy-to-clipboard';
import { Button } from './ui/button';

type SavedTokenCopy = {
  title: string;
  description: string;
  copy: string;
  acknowledge: string;
};

export function AlertToken({
  stateOpen,
  tokenView,
  onClose,
  copy,
}: {
  stateOpen: boolean;
  tokenView: string;
  onClose: () => void;
  /** This "shown once" reveal dialog is reused for any secret shown exactly
   * once (an invite token today); the caller supplies its own copy. */
  copy: SavedTokenCopy;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    // This is the only moment the raw token exists in the UI, so a silent
    // clipboard failure would lose it for good — report it instead.
    const copied = await copyToClipboard(tokenView);
    if (!copied) {
      showErrorToast();
      return;
    }
    setCopied(true);
    showSuccessToast();
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <AlertDialog
      open={stateOpen}
      onOpenChange={(isOpen) => {
        if (!isOpen) onClose();
      }}
    >
      <AlertDialogContent className="border-2 border-yellow-500">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <TriangleAlert className="size-5 text-yellow-500" />
            {copy.title}
          </AlertDialogTitle>
          <AlertDialogDescription className="pt-2">{copy.description}</AlertDialogDescription>
        </AlertDialogHeader>

        {/* Token display area */}
        <div className="group my-4 flex items-center justify-between rounded-lg border border-slate-700 bg-slate-900 p-4">
          <code className="break-all font-mono text-sm text-yellow-400">{tokenView}</code>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => void handleCopy()}
            title={copy.copy}
            className="ml-2 shrink-0 text-slate-400 hover:text-white"
          >
            {copied ? <Check className="size-4 text-green-500" /> : <Copy className="size-4" />}
          </Button>
        </div>

        <AlertDialogFooter>
          <AlertDialogAction
            onClick={onClose}
            className="bg-yellow-600 text-white hover:bg-yellow-700"
          >
            {copy.acknowledge}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
