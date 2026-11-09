export function TableLoadingOverlay() {
  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center rounded-md bg-white/10 backdrop-blur-sm">
      <div className="size-10 animate-spin rounded-full border-2 border-primary border-t-transparent" />
    </div>
  );
}
