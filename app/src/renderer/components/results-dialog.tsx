import { Download, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useExportJob, useResults } from "@/hooks/use-jobs";
import { truncate } from "@/lib/utils";

interface ResultsDialogProps {
  jobId: string | null;
  jobName: string;
  onClose: () => void;
}

export function ResultsDialog({ jobId, jobName, onClose }: ResultsDialogProps) {
  const { data, isLoading, isError } = useResults(jobId);
  const exportJob = useExportJob();

  return (
    <Dialog open={!!jobId} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-h-[85vh] max-w-4xl flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="flex-row items-center justify-between gap-3 border-b px-5 py-4">
          <div className="flex items-center gap-3">
            <DialogTitle className="text-base">{jobName || "Scraped Results"}</DialogTitle>
            {data && <Badge variant="secondary">{data.total} rows</Badge>}
          </div>
          {jobId && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => exportJob.mutate(jobId)}
              disabled={exportJob.isPending}
            >
              {exportJob.isPending ? <Loader2 className="animate-spin" /> : <Download />}
              Export CSV
            </Button>
          )}
        </DialogHeader>

        <div className="flex-1 overflow-auto px-5 py-4">
          {isLoading && (
            <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
              <Loader2 className="mr-2 animate-spin" />
              Loading results…
            </div>
          )}

          {isError && (
            <div className="flex h-40 items-center justify-center text-sm text-destructive">
              Failed to load results.
            </div>
          )}

          {!isLoading && !isError && data && data.rows.length === 0 && (
            <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
              No results found for this job.
            </div>
          )}

          {!isLoading && data && data.rows.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  {data.columns.map((c) => (
                    <TableHead key={c} className="whitespace-nowrap text-xs">
                      {c}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.rows.map((row, i) => (
                  <TableRow key={i}>
                    {data.columns.map((_, j) => {
                      const val = row[j] != null ? String(row[j]) : "";
                      return (
                        <TableCell key={j} title={val} className="max-w-[240px] text-xs">
                          <span className="block truncate">{truncate(val, 80)}</span>
                        </TableCell>
                      );
                    })}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
