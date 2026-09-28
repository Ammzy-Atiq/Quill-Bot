/**
 * Aho–Corasick multi-pattern matcher over UTF-16 code units.
 * Build once (O(total pattern length)), then search any text in O(text + matches).
 */
export interface AcMatch {
  /** Index of the pattern in the array given to the constructor. */
  pattern: number;
  /** Start offset (inclusive) in the searched text. */
  start: number;
  /** End offset (exclusive). */
  end: number;
}

export class AhoCorasick {
  private readonly goto: Array<Map<number, number>> = [new Map()];
  private readonly fail: number[] = [0];
  private readonly output: number[][] = [[]];
  private readonly lengths: number[];

  constructor(patterns: readonly string[]) {
    this.lengths = patterns.map((p) => p.length);
    patterns.forEach((pattern, index) => {
      if (pattern.length === 0) return;
      let state = 0;
      for (let i = 0; i < pattern.length; i++) {
        const code = pattern.charCodeAt(i);
        let next = this.goto[state]!.get(code);
        if (next === undefined) {
          next = this.goto.length;
          this.goto.push(new Map());
          this.fail.push(0);
          this.output.push([]);
          this.goto[state]!.set(code, next);
        }
        state = next;
      }
      this.output[state]!.push(index);
    });

    const queue: number[] = [];
    for (const next of this.goto[0]!.values()) {
      this.fail[next] = 0;
      queue.push(next);
    }
    for (let head = 0; head < queue.length; head++) {
      const state = queue[head]!;
      for (const [code, next] of this.goto[state]!) {
        queue.push(next);
        let f = this.fail[state]!;
        while (f !== 0 && !this.goto[f]!.has(code)) f = this.fail[f]!;
        const target = this.goto[f]!.get(code);
        this.fail[next] = target !== undefined && target !== next ? target : 0;
        this.output[next]!.push(...this.output[this.fail[next]!]!);
      }
    }
  }

  get stateCount(): number {
    return this.goto.length;
  }

  search(text: string): AcMatch[] {
    const matches: AcMatch[] = [];
    let state = 0;
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i);
      while (state !== 0 && !this.goto[state]!.has(code)) state = this.fail[state]!;
      state = this.goto[state]!.get(code) ?? 0;
      for (const pattern of this.output[state]!) {
        const length = this.lengths[pattern]!;
        matches.push({ pattern, start: i + 1 - length, end: i + 1 });
      }
    }
    return matches;
  }
}
