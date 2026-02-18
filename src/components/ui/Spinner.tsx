interface SpinnerProps {
  size?: "sm" | "md" | "lg";
  className?: string;
}

const sizeClasses = {
  sm: "h-4 w-4 border-2",
  md: "h-5 w-5 border-2",
  lg: "h-8 w-8 border-3",
};

export function Spinner({ size = "md", className = "" }: SpinnerProps) {
  return (
    <span
      className={`inline-block rounded-full border-muted/30 border-t-bitcoin animate-spin
        ${sizeClasses[size]} ${className}`}
      role="status"
      aria-label="Loading"
    />
  );
}
