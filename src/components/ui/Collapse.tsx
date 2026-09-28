"use client";

import type { ReactNode } from "react";
import { motion, AnimatePresence } from "motion/react";

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
