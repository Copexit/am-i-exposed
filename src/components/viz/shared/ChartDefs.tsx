import { COLORS, HUES } from "@/lib/palette";

/**
 * Shared SVG <defs> for all chart components.
 * Renders glow filters and the bubble / timeline gradients.
 * Place inside each <svg> element - gradient IDs are SVG-scoped.
 */
export function ChartDefs() {
  return (
    <defs>
      {/* === Glow Filters === */}
      <filter id="glow-subtle" x="-50%" y="-50%" width="200%" height="200%">
        <feGaussianBlur stdDeviation="2" result="blur" />
        <feMerge>
          <feMergeNode in="blur" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>
      <filter id="glow-medium" x="-50%" y="-50%" width="200%" height="200%">
        <feGaussianBlur stdDeviation="3.5" result="blur" />
        <feMerge>
          <feMergeNode in="blur" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>
      {/* === Bubble Chart Radial Gradients (3D sphere lighting) === */}
      <radialGradient id="grad-bubble-normal" cx="35%" cy="35%" r="65%">
        <stop offset="0%" stopColor={COLORS.severityLow} stopOpacity={0.5} />
        <stop offset="100%" stopColor={HUES.blue300} stopOpacity={0.25} />
      </radialGradient>
      <radialGradient id="grad-bubble-dust" cx="35%" cy="35%" r="65%">
        <stop offset="0%" stopColor={HUES.red400} stopOpacity={0.55} />
        <stop offset="100%" stopColor={HUES.red300} stopOpacity={0.3} />
      </radialGradient>
      <radialGradient id="grad-bubble-unconf" cx="35%" cy="35%" r="65%">
        <stop offset="0%" stopColor={HUES.amber400} stopOpacity={0.5} />
        <stop offset="100%" stopColor={HUES.amber300} stopOpacity={0.25} />
      </radialGradient>

      {/* === Timeline Area Gradient (vertical fade) === */}
      <linearGradient id="grad-timeline-area" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor={COLORS.bitcoin} stopOpacity={0.2} />
        <stop offset="100%" stopColor={COLORS.bitcoin} stopOpacity={0} />
      </linearGradient>

    </defs>
  );
}
