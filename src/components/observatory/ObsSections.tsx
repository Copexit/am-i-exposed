"use client";

import { useEffect, useState, type ReactNode } from "react";

/** One page section. Later tasks mount their component as `children` in place of the skeleton. */
export function Section({ id, title, lead, hideTitle, describedBy, children }: { id: string; title: string; lead?: string; hideTitle?: boolean; describedBy?: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} aria-describedby={describedBy} className={hideTitle ? "" : "space-y-5 pt-2"}>
      {hideTitle ? (
        <h2 id={`${id}-title`} className="sr-only">{title}</h2>
      ) : (
        <div className="space-y-1.5 max-w-2xl">
          <h2 id={`${id}-title`} className="text-xl sm:text-[22px] font-semibold tracking-tight text-foreground text-balance">{title}</h2>
          {lead && <p className="text-sm text-muted leading-relaxed">{lead}</p>}
        </div>
      )}
      {children}
    </section>
  );
}

/** Sticky in-page chips; highlights the section in view. `aside` sits at the right end (the search, from 1024 px). */
export function SubNav({ label, items, aside }: { label: string; items: { id: string; label: string }[]; aside?: ReactNode }) {
  const [active, setActive] = useState(items[0]?.id);
  const ids = items.map((i) => i.id).join(",");
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const list = ids.split(",");
    // The last section may be too short to reach the observed band: at the page bottom it is the active one.
    const atBottom = () => window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4;
    const io = new IntersectionObserver(
      (entries) => {
        if (atBottom()) return setActive(list.at(-1));
        const top = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (top) setActive(top.target.id);
      },
      { rootMargin: "-120px 0px -60% 0px" },
    );
    for (const id of list) {
      const el = document.getElementById(id);
      if (el) io.observe(el);
    }
    const onScroll = () => { if (atBottom()) setActive(list.at(-1)); };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => { io.disconnect(); window.removeEventListener("scroll", onScroll); };
  }, [ids]);

  return (
    <nav
      aria-label={label}
      className="sticky top-[var(--header-h,56px)] z-30 mb-3 -mx-4 sm:-mx-6 lg:-mx-8 px-4 sm:px-6 lg:px-8 py-0.5 bg-background/85 backdrop-blur border-b border-hairline"
    >
      <div className="flex items-center justify-between gap-6">
        <ul className="flex min-w-0 gap-1 overflow-x-auto no-scrollbar">
          {items.map((s) => (
            <li key={s.id}>
              <a
                href={`#${s.id}`}
                onClick={(e) => {
                  e.preventDefault();
                  const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
                  document.getElementById(s.id)?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
                }}
                aria-current={active === s.id ? "true" : undefined}
                className={`inline-flex items-center min-h-10 px-3 rounded-md text-sm whitespace-nowrap transition-colors duration-200 ${active === s.id ? "bg-surface-2 text-foreground" : "text-muted hover:text-foreground"}`}
              >
                {s.label}
              </a>
            </li>
          ))}
        </ul>
        {aside}
      </div>
    </nav>
  );
}
