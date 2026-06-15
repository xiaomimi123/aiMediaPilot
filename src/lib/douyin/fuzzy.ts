function bigrams(s: string): Set<string> {
  const grams = new Set<string>();
  const t = s.trim().toLowerCase();
  for (let i = 0; i < t.length - 1; i++) grams.add(t.slice(i, i + 2));
  return grams;
}

export function bigramDice(a: string, b: string): number {
  if (!a || !b) return 0;
  const A = bigrams(a);
  const B = bigrams(b);
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const g of A) if (B.has(g)) inter++;
  return (2 * inter) / (A.size + B.size);
}

export function filenameBasename(filename: string): string {
  return filename.replace(/\.[^.]+$/, '');
}
