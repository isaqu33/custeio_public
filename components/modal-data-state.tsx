type ModalDataStateProps = {
  loadingMessage: string;
  errorMessage?: string | null;
  emptyMessage?: string;
  isLoading: boolean;
  hasData: boolean;
};

export function ModalDataState({
  loadingMessage,
  errorMessage,
  emptyMessage,
  isLoading,
  hasData,
}: ModalDataStateProps) {
  if (isLoading) {
    return (
      <div className="flex h-[400px] items-center justify-center">
        <div className="size-10 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        <p className="ml-3 text-sm text-muted-foreground">{loadingMessage}</p>
      </div>
    );
  }

  if (errorMessage) {
    return (
      <div className="flex h-[400px] items-center justify-center">
        <p className="text-sm text-muted-foreground">{errorMessage}</p>
      </div>
    );
  }

  if (!hasData && emptyMessage) {
    return (
      <div className="flex h-[400px] items-center justify-center">
        <p className="text-sm text-muted-foreground">{emptyMessage}</p>
      </div>
    );
  }

  return null;
}
