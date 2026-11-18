import { Skeleton } from "@/components/ui/skeleton";

export default function AppLoading() {
  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <Skeleton className="h-2.5 w-24" />
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-3 w-80" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((key) => (
          <Skeleton key={key} className="h-[120px] rounded-[12px]" />
        ))}
      </div>
      <div className="grid gap-4 xl:grid-cols-12">
        <Skeleton className="h-[320px] rounded-[12px] xl:col-span-8" />
        <Skeleton className="h-[320px] rounded-[12px] xl:col-span-4" />
      </div>
      <Skeleton className="h-[300px] rounded-[12px]" />
    </div>
  );
}
