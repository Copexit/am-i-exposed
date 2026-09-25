import { GRADIENT_COLORS } from "./svgConstants";
import { COLORS, HUES } from "@/lib/palette";

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
        <stop offset="0%" stopColor={COLORS.bitcoin} stopOpacity={0.5} />
        <stop offset="100%" stopColor={COLORS.severityGood} stopOpacity={0.35} />
      </linearGradient>
      <linearGradient id="grad-cj-link-out">
        <stop offset="0%" stopColor={COLORS.severityGood} stopOpacity={0.35} />
        <stop offset="100%" stopColor={COLORS.bitcoin} stopOpacity={0.5} />
      </linearGradient>

      {/* === Waterfall Bar Gradients (vertical, subtle top-to-bottom) === */}
      <linearGradient id="grad-wf-base" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor={HUES.gray400} stopOpacity={0.9} />
        <stop offset="100%" stopColor={HUES.gray500} stopOpacity={0.7} />
      </linearGradient>
      <linearGradient id="grad-wf-positive" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor={HUES.emerald400} stopOpacity={0.85} />
        <stop offset="100%" stopColor={COLORS.severityGood} stopOpacity={0.7} />
      </linearGradient>
      <linearGradient id="grad-wf-critical" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor={COLORS.severityCritical} stopOpacity={0.85} />
        <stop offset="100%" stopColor={HUES.red600} stopOpacity={0.7} />
      </linearGradient>
      <linearGradient id="grad-wf-high" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor={COLORS.severityHigh} stopOpacity={0.85} />
        <stop offset="100%" stopColor={HUES.orange600} stopOpacity={0.7} />
      </linearGradient>
      <linearGradient id="grad-wf-medium" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor={COLORS.severityMedium} stopOpacity={0.85} />
        <stop offset="100%" stopColor={HUES.yellow600} stopOpacity={0.7} />
      </linearGradient>
      <linearGradient id="grad-wf-low" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor={HUES.blue500} stopOpacity={0.85} />
        <stop offset="100%" stopColor={HUES.blue600} stopOpacity={0.7} />
      </linearGradient>
      <linearGradient id="grad-wf-good" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor={COLORS.severityGood} stopOpacity={0.85} />
        <stop offset="100%" stopColor={HUES.green600} stopOpacity={0.7} />
      </linearGradient>

      {/* === Severity Ring Radial Gradients === */}
      <radialGradient id="grad-sev-critical">
        <stop offset="0%" stopColor={HUES.red400} />
        <stop offset="100%" stopColor={COLORS.severityCritical} />
      </radialGradient>
      <radialGradient id="grad-sev-high">
        <stop offset="0%" stopColor={HUES.orange400} />
        <stop offset="100%" stopColor={COLORS.severityHigh} />
      </radialGradient>
      <radialGradient id="grad-sev-medium">
        <stop offset="0%" stopColor={HUES.yellow400} />
        <stop offset="100%" stopColor={COLORS.severityMedium} />
      </radialGradient>
      <radialGradient id="grad-sev-low">
        <stop offset="0%" stopColor={COLORS.severityLow} />
        <stop offset="100%" stopColor={HUES.blue500} />
      </radialGradient>
      <radialGradient id="grad-sev-good">
        <stop offset="0%" stopColor={HUES.green400} />
        <stop offset="100%" stopColor={COLORS.severityGood} />
      </radialGradient>

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

      {/* === Enhanced Mixer Pattern === */}
      <pattern id="mixer-pattern-v2" patternUnits="userSpaceOnUse" width="8" height="8" patternTransform="rotate(45)">
        <line x1="0" y1="0" x2="0" y2="8" stroke={COLORS.severityGood} strokeWidth="1.5" strokeOpacity={0.25} />
      </pattern>
    </defs>
  );
}
