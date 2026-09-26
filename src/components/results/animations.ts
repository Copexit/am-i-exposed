export const fadeUpVariants = {
  initial: { opacity: 0, y: 20 },
  animate: { opacity: 1, y: 0 },
};

export const fadeUpTransition = (delay = 0) => ({
  duration: 0.4,
  delay,
});

/** Slide-up entrance for standalone result views (destination check, wallet audit). */
export const resultEnterMotion = {
  initial: { opacity: 0, y: 10 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.3, ease: [0.4, 0, 0.2, 1] as const },
};

/** Blur-in swap for keyed children of AnimatePresence (page views, loading states). */
export const blurInMotion = {
  initial: { opacity: 0, y: 10, filter: "blur(4px)" },
  animate: { opacity: 1, y: 0, filter: "blur(0px)" },
  exit: { opacity: 0, y: 10, filter: "blur(4px)" },
  transition: { duration: 0.3, ease: [0.4, 0, 0.2, 1] as const },
};
