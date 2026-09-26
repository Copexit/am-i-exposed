export function SkeletonCards({ count }: { count: number }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      {Array.from({ length: count }, (_, i) => (
        <div
          key={i}
          className="h-44 rounded-xl border border-card-border bg-surface-elevated/30 animate-pulse"
        />
      ))}
    </div>
  );
}
