// Short-form Naira for dashboard cards, e.g. 48200000 -> "₦48.2M".
export function formatNairaShort(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) return `₦${(value / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000) return `₦${(value / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `₦${(value / 1_000).toFixed(1)}K`;
  return `₦${value.toFixed(0)}`;
}

// Full, comma-grouped Naira — no abbreviation.
export function formatNairaFull(value: number): string {
  return `₦${Math.round(value).toLocaleString('en-NG')}`;
}
