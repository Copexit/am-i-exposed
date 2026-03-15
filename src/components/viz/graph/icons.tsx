export function ExpandIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="15 3 21 3 21 9" /><polyline points="9 21 3 21 3 15" />
      <line x1="21" y1="3" x2="14" y2="10" /><line x1="3" y1="21" x2="10" y2="14" />
    </svg>
  );
}

export function CloseIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

export function HeatIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2c0 5-4 7-4 12a4 4 0 0 0 8 0c0-5-4-7-4-12z" />
    </svg>
  );
}

export function GraphIcon() {
  return (
    <svg className="w-4 h-4 shrink-0" viewBox="0 0 16 16" fill="none">
      <circle cx="4" cy="8" r="2" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="12" cy="4" r="2" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="12" cy="12" r="2" stroke="currentColor" strokeWidth="1.5" />
      <path d="M6 7l4-2M6 9l4 2" stroke="currentColor" strokeWidth="1" strokeOpacity="0.5" />
    </svg>
  );
}
