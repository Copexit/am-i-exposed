import Link from "next/link";
import { Github } from "lucide-react";

export function Footer() {
  return (
    <footer className="flex flex-col sm:flex-row flex-wrap items-center justify-center gap-x-4 gap-y-2 px-6 sm:px-4 py-5 text-sm text-muted border-t border-card-border max-w-6xl mx-auto w-full">
      <span className="font-medium text-foreground/60">am-i.exposed</span>
      <span className="text-muted">Your privacy. Diagnosed.</span>
      <Link
        href="/methodology"
        className="text-muted hover:text-foreground transition-colors py-2"
      >
        Methodology
      </Link>
      <a
        href="https://github.com/Copexit/am-i-exposed"
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 text-muted hover:text-foreground transition-colors py-2"
      >
        <Github size={14} />
        GitHub
      </a>
    </footer>
  );
}
