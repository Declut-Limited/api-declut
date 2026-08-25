export interface Trend {
  status: 'productive' | 'warning';
  result: string;
}

// Percentage-based cards (Revenue, Transaction volume) — `phrase` lets each call site match its own wording ("8.1% increase" vs "12% vs prior period").
export function pctTrend(
  current: number,
  prior: number,
  higherIsBetter: boolean,
  phrase: (pct: number, direction: 'increase' | 'decrease') => string,
): Trend {
  if (prior === 0) {
    if (current === 0) {
      return { status: 'productive', result: 'No change vs prior period' };
    }
    return {
      status: higherIsBetter ? 'productive' : 'warning',
      result: 'New this period',
    };
  }
  const pct = Math.round((Math.abs(current - prior) / prior) * 1000) / 10;
  const direction: 'increase' | 'decrease' =
    current >= prior ? 'increase' : 'decrease';
  const improved = higherIsBetter ? current >= prior : current <= prior;
  return {
    status: improved ? 'productive' : 'warning',
    result: phrase(pct, direction),
  };
}

// Plain-count cards (new users, new listings) — "{value} {periodLabel}" (e.g. "840 this week"), matches the mock exactly, no invented words.
export function countTrend(
  value: number,
  periodLabel: string,
  prior: number,
  higherIsBetter: boolean,
): Trend {
  const improved = higherIsBetter ? value >= prior : value <= prior;
  return {
    status: improved ? 'productive' : 'warning',
    result: `${value} ${periodLabel}`,
  };
}

// "Needs attention" cards (disputes, stalled transactions) — a real overdue-count, not a trend.
export function breachTrend(count: number, label: string): Trend {
  return {
    status: count > 0 ? 'warning' : 'productive',
    result: `${count} ${label}`,
  };
}
