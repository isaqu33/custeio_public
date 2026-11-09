import { TableCell, TableRow } from '@/components/ui/table';

export function TableEmptyStateRow({ colSpan, message }: { colSpan: number; message: string }) {
  return (
    <TableRow>
      <TableCell colSpan={colSpan} className="h-24 text-center text-muted-foreground">
        {message}
      </TableCell>
    </TableRow>
  );
}
