export default function Loading() {
  return (
    <div className="animate-pulse">
      <div className="mb-8">
        <div className="h-3 w-24 rounded bg-paper-deep" />
        <div className="mt-3 h-8 w-56 rounded bg-paper-deep" />
      </div>
      <div className="space-y-3">
        <div className="h-24 rounded-xl border border-line bg-card" />
        <div className="h-24 rounded-xl border border-line bg-card" />
        <div className="h-24 rounded-xl border border-line bg-card" />
      </div>
    </div>
  );
}
