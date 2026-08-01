import { Download, Eye, Loader2, MessageSquare, Plus, RefreshCw, Search, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { ResultsDialog } from "@/components/results-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useDeleteJob, useExportJob, useJobs } from "@/hooks/use-jobs";
import { api } from "@/lib/wails";
import type { Job } from "@/lib/wails";
import type { View } from "@/lib/navigation";
import { relativeTime, truncate } from "@/lib/utils";

function StatusBadge({ status }: { status: string }) {
  const variant =
    status === "completed"
      ? "success"
      : status === "running" || status === "pending"
        ? "warning"
        : status === "failed" || status === "error"
          ? "destructive"
          : status === "cancelled"
            ? "outline"
            : "secondary";
  return <Badge variant={variant}>{status}</Badge>;
}

export function JobsView({ onNavigate }: { onNavigate: (view: View) => void }) {
  const { data: jobs, isLoading, refetch, isFetching } = useJobs(true);
  const deleteJob = useDeleteJob();
  const exportJob = useExportJob();

  const [resultsJob, setResultsJob] = useState<Job | null>(null);
  const [reviewsTracked, setReviewsTracked] = useState<number | null>(null);

  // Total reviews tracked across monitored jobs — shown as a small indicator
  // on jobs that had review monitoring enabled.
  useEffect(() => {
    api
      .getReviewStats()
      .then((s) => setReviewsTracked(s.total))
      .catch(() => setReviewsTracked(null));
  }, [jobs]);

  const handleDelete = (id: string) => {
    if (window.confirm("Delete this job?")) deleteJob.mutate(id);
  };

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between border-b px-6 py-4">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Jobs</h1>
          <p className="text-xs text-muted-foreground">
            {jobs?.length ?? 0} scrape job{(jobs?.length ?? 0) === 1 ? "" : "s"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
            {isFetching ? <Loader2 className="animate-spin" /> : <RefreshCw />}
            Refresh
          </Button>
          <Button size="sm" onClick={() => onNavigate("map")}>
            <Plus />
            New Scrape
          </Button>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-auto px-6 py-5">
        {isLoading ? (
          <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
            <Loader2 className="mr-2 animate-spin" />
            Loading jobs…
          </div>
        ) : !jobs || jobs.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-muted">
              <Search className="h-6 w-6 text-muted-foreground" />
            </div>
            <p className="text-sm font-medium">No jobs yet</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Configure a scrape and hit Start.
            </p>
            <Button size="sm" className="mt-4" onClick={() => onNavigate("map")}>
              <Plus />
              Start your first scrape
            </Button>
          </div>
        ) : (
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="text-xs">Name</TableHead>
                  <TableHead className="text-xs">Date</TableHead>
                  <TableHead className="text-xs">Status</TableHead>
                  <TableHead className="text-xs">Keywords</TableHead>
                  <TableHead className="text-right text-xs">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {jobs.map((job) => {
                  const keywords = job.data?.keywords ?? [];
                  const isCompleted = job.status === "completed";
                  return (
                    <TableRow key={job.id}>
                      <TableCell className="font-medium">{job.name || "Untitled"}</TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {relativeTime(job.date)}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1.5">
                          <StatusBadge status={job.status} />
                          {job.data?.monitor_reviews && (
                            <Badge
                              variant="secondary"
                              className="gap-1 text-[10px]"
                              title="Review monitoring enabled for this job"
                            >
                              <MessageSquare className="h-3 w-3" />
                              {reviewsTracked !== null ? `${reviewsTracked} tracked` : "reviews"}
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="max-w-[220px] text-muted-foreground">
                        <span className="block truncate">
                          {truncate(keywords.slice(0, 2).join(", "), 40)}
                          {keywords.length > 2 ? "…" : ""}
                        </span>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center justify-end gap-1">
                          {isCompleted && (
                            <>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 text-muted-foreground hover:text-foreground"
                                title="View results"
                                onClick={() => setResultsJob(job)}
                              >
                                <Eye className="h-3.5 w-3.5" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 text-muted-foreground hover:text-foreground"
                                title="Export CSV"
                                onClick={() => exportJob.mutate(job.id)}
                                disabled={exportJob.isPending}
                              >
                                <Download className="h-3.5 w-3.5" />
                              </Button>
                            </>
                          )}
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-muted-foreground hover:text-destructive"
                            title="Delete job"
                            onClick={() => handleDelete(job.id)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      <ResultsDialog
        jobId={resultsJob?.id ?? null}
        jobName={resultsJob?.name ?? ""}
        onClose={() => setResultsJob(null)}
      />
    </div>
  );
}
