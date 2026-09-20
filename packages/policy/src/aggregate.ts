/**
 * docs/04 — aggregation safety. Administrative views are aggregate by default with a minimum
 * cell size and complementary suppression, so totals cannot be differenced back to a person.
 */
export interface Cell {
  key: string;
  count: number;
  /** Optional numeric payload (e.g. mean grade) suppressed together with the count. */
  value?: number | null;
}

export interface SuppressedCell {
  key: string;
  count: number | null;
  value: number | null;
  suppressed: boolean;
  reason: 'below_minimum' | 'complementary' | null;
}

export interface SuppressionResult {
  cells: SuppressedCell[];
  total: number | null;
  minCellSize: number;
}

/**
 * Suppress every cell below `minCellSize`. If exactly one cell in a table is suppressed, the
 * total would reveal it, so the next-smallest cell is suppressed as well (complementary
 * suppression). The total is kept only when at least two cells are suppressed or none are.
 */
export function suppressCells(cells: ReadonlyArray<Cell>, minCellSize: number): SuppressionResult {
  const out: SuppressedCell[] = cells.map((c) => ({
    key: c.key,
    count: c.count,
    value: c.value ?? null,
    suppressed: false,
    reason: null,
  }));

  for (const c of out) {
    if (c.count !== null && c.count > 0 && c.count < minCellSize) {
      c.suppressed = true;
      c.reason = 'below_minimum';
    }
  }

  const suppressedCount = out.filter((c) => c.suppressed).length;
  if (suppressedCount === 1) {
    const candidates = out
      .filter((c) => !c.suppressed && (c.count ?? 0) > 0)
      .sort((a, b) => (a.count ?? 0) - (b.count ?? 0));
    const next = candidates[0];
    if (next) {
      next.suppressed = true;
      next.reason = 'complementary';
    }
  }

  const total = cells.reduce((s, c) => s + c.count, 0);
  const finalSuppressed = out.filter((c) => c.suppressed).length;
  for (const c of out) {
    if (c.suppressed) {
      c.count = null;
      c.value = null;
    }
  }

  // A total with exactly one suppressed cell leaks it; with a complementary cell it doesn't.
  const safeTotal = finalSuppressed === 0 || finalSuppressed >= 2 ? total : null;
  return { cells: out, total: safeTotal, minCellSize };
}

/** A single aggregate number is publishable only if it summarizes at least minCellSize people. */
export function publishable(n: number, minCellSize: number): boolean {
  return n === 0 || n >= minCellSize;
}

/**
 * Disproportionality index for equity monitoring (docs/02): the ratio of a subgroup's rate to the
 * overall rate. Returns null when either cell is below the minimum size.
 */
export function disproportionalityIndex(
  subgroup: { fired: number; population: number },
  overall: { fired: number; population: number },
  minCellSize: number,
): number | null {
  if (subgroup.population < minCellSize || overall.population < minCellSize) return null;
  if (overall.fired === 0 || overall.population === 0 || subgroup.population === 0) return null;
  const subRate = subgroup.fired / subgroup.population;
  const allRate = overall.fired / overall.population;
  return allRate === 0 ? null : subRate / allRate;
}
