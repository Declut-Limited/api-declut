// Escapes regex metacharacters in user-supplied search input before it's
// used to build a RegExp for a Mongo query — a raw search string could
// otherwise throw on invalid regex syntax or match more broadly than intended.
export function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
