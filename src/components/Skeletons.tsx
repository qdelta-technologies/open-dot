/** Placeholder shown while a dot's data loads: the same layout as the chat page, with soft shimmering shapes. */
export function DotPageSkeleton({ missing = false, what = "dot" }: { missing?: boolean; what?: string }) {
  if (missing) {
    return <div className="flex flex-1 items-center justify-center text-body-sm text-foreground/45">This {what} doesn&apos;t exist.</div>;
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col" role="status" aria-busy="true" aria-label="Loading">
      {/* top bar */}
      <div className="flex h-14 shrink-0 items-center gap-2 border-b border-black/[0.08] px-2 sm:px-4 dark:border-white/[0.08]">
        <div className="skeleton size-9 rounded-lg md:hidden" />
        <div className="skeleton h-9 w-9 rounded-full sm:w-28" />
        <div className="ml-auto flex items-center gap-2">
          <div className="skeleton h-8 w-28 rounded-lg sm:w-44" />
          <div className="skeleton size-8 rounded-lg" />
          <div className="skeleton hidden size-8 rounded-lg min-[400px]:block" />
          <div className="skeleton size-8 rounded-lg" />
          <div className="skeleton size-8 rounded-lg" />
        </div>
      </div>

      {/* messages */}
      <div className="min-h-0 flex-1 overflow-hidden">
        <div className="mx-auto w-full max-w-[820px] space-y-8 px-4 py-10 sm:px-6 xl:max-w-[920px] 2xl:max-w-[1040px]">
          <div className="skeleton ml-auto h-12 w-2/5 rounded-3xl" />
          <div className="space-y-2.5">
            <div className="skeleton h-3.5 w-[92%] rounded-md" />
            <div className="skeleton h-3.5 w-[78%] rounded-md" />
            <div className="skeleton h-3.5 w-[55%] rounded-md" />
          </div>
          <div className="skeleton ml-auto h-12 w-1/4 rounded-3xl" />
          <div className="space-y-2.5">
            <div className="skeleton h-3.5 w-[85%] rounded-md" />
            <div className="skeleton h-3.5 w-[64%] rounded-md" />
          </div>
        </div>
      </div>

      {/* typing box */}
      <div className="mx-auto w-full max-w-[820px] px-4 pb-4 sm:px-6 sm:pb-6 xl:max-w-[920px] 2xl:max-w-[1040px]">
        <div className="skeleton h-[58px] w-full rounded-full" />
      </div>
    </div>
  );
}
