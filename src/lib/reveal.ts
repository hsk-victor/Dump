export async function fetchRevealWindow<T extends { id: string }>(
  id: string,
  page: (offset: number) => Promise<{ items: T[]; hasMore: boolean }>,
) {
  const items: T[] = [];
  const seen = new Set<string>();
  for (let offset = 0; ; ) {
    const result = await page(offset);
    const fresh = result.items.filter((item) => !seen.has(item.id) && !!seen.add(item.id));
    items.push(...fresh);
    if (seen.has(id)) return { items, hasMore: result.hasMore };
    if (!result.hasMore || !fresh.length) return null;
    offset += result.items.length;
  }
}
