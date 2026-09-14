// Display names: what people see, separate from the username friends use to find you.

export const MAX_NAME_LENGTH = 40

// Trims, collapses whitespace and drops invisible control characters; null when nothing is left.
export function cleanDisplayName(input) {
  const name = String(input ?? '')
    .replace(/[\p{Cc}\p{Cf}]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
  return name ? [...name].slice(0, MAX_NAME_LENGTH).join('') : null
}
