/**
 * Anchor helpers. Heading-to-slug conventions live with the anchor resolver;
 * this module only normalizes the fragment found in a reference.
 */

/** Decode percent escapes, compose accents (NFC) and lowercase a link fragment. */
export function normalizeFragment(raw: string): string {
  let value = raw.trim();
  try {
    value = decodeURIComponent(value);
  } catch {
    // Malformed escape: keep the fragment as written.
  }
  return value.normalize('NFC').toLowerCase();
}
