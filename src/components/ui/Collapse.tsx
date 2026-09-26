"use client";

import { useState, type ReactNode } from "react";
import { motion, AnimatePresence } from "motion/react";
import { ChevronRight } from "lucide-react";
import { fadeUpVariants, fadeUpTransition } from "../results/animations";

/** Height/opacity expand-collapse for disclosure panels. */
export function Collapse({
  open,
  duration = 0.2,
  initial,
  children,
}: {
  open: boolean;
  duration?: number;
  /** Passed to AnimatePresence: false skips the enter animation on first mount. */
  initial?: boolean;
  children: ReactNode;
}) {
  return (
    <AnimatePresence initial={initial}>
      {open && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration }}
          className="overflow-hidden"
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** Fade-up section with a labelled chevron toggle over a collapsible body. */
export function CollapsibleSection({
  label,
  delay,
  defaultOpen = false,
  children,
}: {
  label: ReactNode;
  delay: number;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <motion.div
      {...fadeUpVariants}
      transition={fadeUpTransition(delay)}
      className="w-full"
    >
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-1 py-2 text-left group cursor-pointer"
        aria-expanded={open}
      >
        <ChevronRight
          size={14}
          className={`text-muted transition-transform duration-200 ${open ? "rotate-90" : ""}`}
        />
        <span className="text-sm font-medium text-muted uppercase tracking-wider">
          {label}
        </span>
      </button>
      <Collapse open={open} duration={0.25} initial={false}>
        {children}
      </Collapse>
    </motion.div>
  );
}
