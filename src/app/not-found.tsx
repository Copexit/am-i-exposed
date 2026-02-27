import Link from "next/link";
import { ArrowLeft } from "lucide-react";

export default function NotFound() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center px-4 py-16 text-center">
      <p className="text-7xl font-bold text-muted/30 tabular-nums">404</p>
      <h1 className="mt-4 text-xl font-semibold text-foreground">Page not found</h1>
      <p className="mt-2 text-sm text-muted max-w-sm">
        The page you are looking for does not exist or has been moved.
      </p>
      <Link
        href="/"
        className="mt-6 inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-bitcoin/10 border border-bitcoin/20 hover:border-bitcoin/40 text-bitcoin/80 hover:text-bitcoin transition-all text-sm"
      >
        <ArrowLeft size={14} />
        Back to scanner
      </Link>
    </div>
  );
}
