export const fadeUpVariants = {
  initial: { opacity: 0, y: 20 },
  animate: { opacity: 1, y: 0 },
};

export const fadeUpTransition = (delay = 0) => ({
  duration: 0.4,
  delay,
});
