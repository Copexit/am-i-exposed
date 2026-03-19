interface SpinnerProps {
  size?: "sm" | "md" | "lg";
  /** Border-top color class (default "border-t-bitcoin") */
  color?: string;
  className?: string;
  label?: string;
}

const sizeClasses = {
  sm: "h-4 w-4 border-2",
  md: "h-5 w-5 border-2",
  lg: "h-8 w-8 border-3",
};

export function Spinner({
  size = "md",
  color = "border-t-bitcoin",
  className = "",
  label = "Loading",
}: SpinnerProps) {
  return (
    <span
      className={`inline-block rounded-full border-muted/30 ${color} animate-spin
        ${sizeClasses[size]} ${className}`}
      role="status"
      aria-label={label}
    />
  );
}
