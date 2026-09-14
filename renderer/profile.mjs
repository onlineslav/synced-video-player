// Display names: what people see, separate from the username friends use to find you.

export const MAX_NAME_LENGTH = 40

// Trims, collapses whitespace and drops invisible control characters; null when nothing is left.
export function cleanText(input, maxLength) {
  const text = String(input ?? '')
    .replace(/[\p{Cc}\p{Cf}]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
  return text ? [...text].slice(0, maxLength).join('') : null
}

export const cleanDisplayName = (input) => cleanText(input, MAX_NAME_LENGTH)
