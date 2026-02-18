import { Github } from "lucide-react";

export function Footer() {
  return (
    <footer className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 px-4 py-5 text-sm text-muted border-t border-card-border max-w-6xl mx-auto w-full">
      <span className="font-medium text-foreground/60">am-i.exposed</span>
      <span className="text-muted/50">Your privacy. Diagnosed.</span>
      <span className="text-muted/50">100% client-side</span>
      <a
        href="https://github.com/Copexit/am-i-exposed"
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 text-muted/50 hover:text-foreground transition-colors"
      >
        <Github size={14} />
        GitHub
      </a>
    </footer>
  );
}
