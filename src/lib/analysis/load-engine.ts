/** Lazily loads the analysis engine (its own chunk). Repeat calls share one module. */
export const loadEngine = () => import("./engine");
