import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="px-4 py-3 flex flex-col gap-3" aria-busy="true" aria-label="加载中">
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-6 w-48" />
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-2">
        <Skeleton className="h-24 col-span-2 xl:col-span-1" />
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
        <Skeleton className="h-24 hidden xl:block" />
      </div>
      <Skeleton className="h-48" />
      <Skeleton className="h-64" />
    </div>
  );
}
