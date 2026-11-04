import { Skeleton } from "@/components/ui/skeleton";

export function PageSkeleton() {
  return (
    <div className="px-3 md:px-4 py-3 flex flex-col gap-3" aria-busy="true" aria-label="加载中">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-16" />)}</div>
      <Skeleton className="h-72" />
    </div>
  );
}
