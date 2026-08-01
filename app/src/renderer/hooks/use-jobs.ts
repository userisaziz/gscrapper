import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { toast } from "sonner";
import { api, onEvent, type Job, type ResultsTable } from "@/lib/wails";

export const jobsQueryKey = ["jobs"] as const;

/** Job list with 5s polling + event-driven invalidation. */
export function useJobs(enabled: boolean) {
  const queryClient = useQueryClient();

  // Invalidate on Wails runtime events
  useEffect(() => {
    if (!enabled) return;
    const unsubs = [
      onEvent("job:status", () => queryClient.invalidateQueries({ queryKey: jobsQueryKey })),
      onEvent("job:completed", () => {
        toast.success("Job completed");
        queryClient.invalidateQueries({ queryKey: jobsQueryKey });
      }),
      onEvent("job:cancelled", () => {
        toast.info("Job cancelled");
        queryClient.invalidateQueries({ queryKey: jobsQueryKey });
      }),
    ];
    return () => unsubs.forEach((fn) => fn());
  }, [enabled, queryClient]);

  return useQuery<Job[]>({
    queryKey: jobsQueryKey,
    queryFn: async () => (await api.getJobs()) ?? [],
    enabled,
    refetchInterval: 5000,
  });
}

export function useDeleteJob() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteJob(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: jobsQueryKey });
      toast.success("Job deleted");
    },
    onError: (err) => toast.error(`Delete failed: ${err}`),
  });
}

export function useExportJob() {
  return useMutation({
    mutationFn: (id: string) => api.exportResults(id),
    onSuccess: (path) => toast.success(`Exported: ${path}`),
    onError: (err) => toast.error(`Export failed: ${err}`),
  });
}

export function useStartScrape() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (req: Parameters<typeof api.startScrape>[0]) =>
      api.startScrape(req),
    onSuccess: (job) => {
      toast.success(`Job "${job.name}" started`);
      queryClient.invalidateQueries({ queryKey: jobsQueryKey });
    },
  });
}

export function useResults(jobId: string | null) {
  return useQuery<ResultsTable>({
    queryKey: ["results", jobId],
    queryFn: () => api.getResults(jobId!),
    enabled: !!jobId,
  });
}
