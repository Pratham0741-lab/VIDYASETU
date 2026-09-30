/**
 * Structural diff of two scheme configs (Phase 14 loose ends, Part A), for
 * reviewing what a new version changes. Arrays of objects that carry an `id`
 * (rules, benefits) are matched by id, so reordering is not a change and a
 * path reads rules[id=category_match].params.allowed_categories; other arrays
 * are compared by position.
 */
export interface ConfigChange {
  path: string;
  change: 'added' | 'removed' | 'changed';
  from?: unknown;
  to?: unknown;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const keyedById = (v: unknown[]): Map<string, unknown> | null => {
  if (!v.every((x) => isRecord(x) && typeof x.id === 'string')) return null;
  const ids = v.map((x) => (x as { id: string }).id);
  if (new Set(ids).size !== ids.length) return null;
  return new Map(v.map((x) => [(x as { id: string }).id, x]));
};

export function diffConfigs(from: unknown, to: unknown, path = 'config'): ConfigChange[] {
  if (JSON.stringify(from) === JSON.stringify(to)) return [];
  if (isRecord(from) && isRecord(to)) {
    const keys = [...new Set([...Object.keys(from), ...Object.keys(to)])].sort();
    return keys.flatMap((k) => {
      const p = `${path}.${k}`;
      if (!(k in to)) return [{ path: p, change: 'removed' as const, from: from[k] }];
      if (!(k in from)) return [{ path: p, change: 'added' as const, to: to[k] }];
      return diffConfigs(from[k], to[k], p);
    });
  }
  if (Array.isArray(from) && Array.isArray(to)) {
    const a = keyedById(from);
    const b = keyedById(to);
    if (a && b) {
      const ids = [...new Set([...a.keys(), ...b.keys()])];
      return ids.flatMap((id) => {
        const p = `${path}[id=${id}]`;
        if (!b.has(id)) return [{ path: p, change: 'removed' as const, from: a.get(id) }];
        if (!a.has(id)) return [{ path: p, change: 'added' as const, to: b.get(id) }];
        return diffConfigs(a.get(id), b.get(id), p);
      });
    }
    const n = Math.max(from.length, to.length);
    return Array.from({ length: n }, (_, i) => i).flatMap((i) => {
      const p = `${path}[${i}]`;
      if (i >= to.length) return [{ path: p, change: 'removed' as const, from: from[i] }];
      if (i >= from.length) return [{ path: p, change: 'added' as const, to: to[i] }];
      return diffConfigs(from[i], to[i], p);
    });
  }
  return [{ path, change: 'changed', from, to }];
}
