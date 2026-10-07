// Secret coins taken during the current attempt (src/gd/pendingCoins.ts).
//
// A coin picked up in an attempt shows at once, but it is not written to the
// save until the level is completed in normal mode. A death drops the buffer.
// The buffer holds ordinals (0-2), the same values save.recordCoin takes.

export class PendingCoins {
  private readonly taken = new Set<number>();

  /** Record a pickup. Returns false if this ordinal was already taken this attempt. */
  take(ord: number): boolean {
    if (this.taken.has(ord)) return false;
    this.taken.add(ord);
    return true;
  }

  /** The ordinals taken this attempt, in ascending order. */
  ordinals(): number[] {
    return [...this.taken].sort((a, b) => a - b);
  }

  /** Drop everything: a death, a restart, or a checkpoint rewind. */
  clear(): void {
    this.taken.clear();
  }
}
