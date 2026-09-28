"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/** Renders children only once the placeholder scrolls near the viewport. */
export function WhenVisible({ children, minHeight }: { children: ReactNode; minHeight: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || shown) return;
    const io = new IntersectionObserver(([e]) => { if (e?.isIntersecting) setShown(true); }, { rootMargin: "300px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [shown]);
  return <div ref={ref} style={shown ? undefined : { minHeight }}>{shown ? children : null}</div>;
}
