import { GRADIENT_COLORS } from "./svgConstants";

/**
 * Shared SVG <defs> for all chart components.
 * Renders glow filters, linear/radial gradients, and patterns.
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
      <filter id="glow-strong" x="-50%" y="-50%" width="200%" height="200%">
        <feGaussianBlur stdDeviation="5" result="blur" />
        <feMerge>
          <feMergeNode in="blur" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>

      {/* === Horizontal Linear Gradients (nodes) === */}
      <linearGradient id="grad-input">
        <stop offset="0%" stopColor={GRADIENT_COLORS.inputLight} />
        <stop offset="100%" stopColor={GRADIENT_COLORS.inputDark} />
      </linearGradient>
      <linearGradient id="grad-output">
        <stop offset="0%" stopColor={GRADIENT_COLORS.outputLight} />
        <stop offset="100%" stopColor={GRADIENT_COLORS.outputDark} />
      </linearGradient>
      <linearGradient id="grad-change">
        <stop offset="0%" stopColor={GRADIENT_COLORS.changeLight} />
        <stop offset="100%" stopColor={GRADIENT_COLORS.changeDark} />
      </linearGradient>
      <linearGradient id="grad-dust">
        <stop offset="0%" stopColor={GRADIENT_COLORS.dustLight} />
        <stop offset="100%" stopColor={GRADIENT_COLORS.dustDark} />
      </linearGradient>
      <linearGradient id="grad-fee">
        <stop offset="0%" stopColor={GRADIENT_COLORS.feeLight} />
        <stop offset="100%" stopColor={GRADIENT_COLORS.feeDark} />
      </linearGradient>

      {/* === Vertical Mixer Gradient === */}
      <linearGradient id="grad-mixer" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor={GRADIENT_COLORS.mixerLight} />
        <stop offset="100%" stopColor={GRADIENT_COLORS.mixerDark} />
      </linearGradient>

      {/* === CoinJoin Link Gradients (horizontal with opacity) === */}
      <linearGradient id="grad-cj-link-in">
        <stop offset="0%" stopColor="#f7931a" stopOpacity={0.3} />
        <stop offset="100%" stopColor="#28d065" stopOpacity={0.2} />
      </linearGradient>
      <linearGradient id="grad-cj-link-out">
        <stop offset="0%" stopColor="#28d065" stopOpacity={0.2} />
        <stop offset="100%" stopColor="#f7931a" stopOpacity={0.3} />
      </linearGradient>

      {/* === Waterfall Bar Gradients (vertical, subtle top-to-bottom) === */}
      <linearGradient id="grad-wf-base" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#9ca3af" stopOpacity={0.9} />
        <stop offset="100%" stopColor="#6b7280" stopOpacity={0.7} />
      </linearGradient>
      <linearGradient id="grad-wf-positive" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#34d399" stopOpacity={0.85} />
        <stop offset="100%" stopColor="#28d065" stopOpacity={0.7} />
      </linearGradient>
      <linearGradient id="grad-wf-critical" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#ef4444" stopOpacity={0.85} />
        <stop offset="100%" stopColor="#dc2626" stopOpacity={0.7} />
      </linearGradient>
      <linearGradient id="grad-wf-high" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#f97316" stopOpacity={0.85} />
        <stop offset="100%" stopColor="#ea580c" stopOpacity={0.7} />
      </linearGradient>
      <linearGradient id="grad-wf-medium" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#eab308" stopOpacity={0.85} />
        <stop offset="100%" stopColor="#ca8a04" stopOpacity={0.7} />
      </linearGradient>
      <linearGradient id="grad-wf-low" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.85} />
        <stop offset="100%" stopColor="#2563eb" stopOpacity={0.7} />
      </linearGradient>
      <linearGradient id="grad-wf-good" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#28d065" stopOpacity={0.85} />
        <stop offset="100%" stopColor="#16a34a" stopOpacity={0.7} />
      </linearGradient>

      {/* === Severity Ring Radial Gradients === */}
      <radialGradient id="grad-sev-critical">
        <stop offset="0%" stopColor="#f87171" />
        <stop offset="100%" stopColor="#ef4444" />
      </radialGradient>
      <radialGradient id="grad-sev-high">
        <stop offset="0%" stopColor="#fb923c" />
        <stop offset="100%" stopColor="#f97316" />
      </radialGradient>
      <radialGradient id="grad-sev-medium">
        <stop offset="0%" stopColor="#facc15" />
        <stop offset="100%" stopColor="#eab308" />
      </radialGradient>
      <radialGradient id="grad-sev-low">
        <stop offset="0%" stopColor="#60a5fa" />
        <stop offset="100%" stopColor="#3b82f6" />
      </radialGradient>
      <radialGradient id="grad-sev-good">
        <stop offset="0%" stopColor="#4ade80" />
        <stop offset="100%" stopColor="#28d065" />
      </radialGradient>

      {/* === Bubble Chart Radial Gradients (3D sphere lighting) === */}
      <radialGradient id="grad-bubble-normal" cx="35%" cy="35%" r="65%">
        <stop offset="0%" stopColor="#60a5fa" stopOpacity={0.35} />
        <stop offset="100%" stopColor="#1e3a5f" stopOpacity={0.15} />
      </radialGradient>
      <radialGradient id="grad-bubble-dust" cx="35%" cy="35%" r="65%">
        <stop offset="0%" stopColor="#f87171" stopOpacity={0.45} />
        <stop offset="100%" stopColor="#7f1d1d" stopOpacity={0.2} />
      </radialGradient>
      <radialGradient id="grad-bubble-unconf" cx="35%" cy="35%" r="65%">
        <stop offset="0%" stopColor="#fbbf24" stopOpacity={0.35} />
        <stop offset="100%" stopColor="#78350f" stopOpacity={0.15} />
      </radialGradient>

      {/* === Timeline Area Gradient (vertical fade) === */}
      <linearGradient id="grad-timeline-area" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#f7931a" stopOpacity={0.12} />
        <stop offset="100%" stopColor="#f7931a" stopOpacity={0} />
      </linearGradient>

      {/* === Enhanced Mixer Pattern === */}
      <pattern id="mixer-pattern-v2" patternUnits="userSpaceOnUse" width="8" height="8" patternTransform="rotate(45)">
        <line x1="0" y1="0" x2="0" y2="8" stroke="#28d065" strokeWidth="1.5" strokeOpacity="0.15" />
      </pattern>
    </defs>
  );
}
