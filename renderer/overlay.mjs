// Small controls drawn straight over the video (the playlist tab) pick black or white from what's
// behind them.

// The part of the media (in its own pixels) under `target`; both boxes are in stage pixels, and
// `rect` is where the picture sits (pictureRect). Null when the target is over the letterbox.
export function sourceRegion(target, rect, naturalWidth, naturalHeight) {
  const left = Math.max(target.x, rect.x)
  const right = Math.min(target.x + target.width, rect.x + rect.width)
  const top = Math.max(target.y, rect.y)
  const bottom = Math.min(target.y + target.height, rect.y + rect.height)
  if (right <= left || bottom <= top || !naturalWidth || !naturalHeight || !rect.width || !rect.height) return null
  const scaleX = naturalWidth / rect.width
  const scaleY = naturalHeight / rect.height
  return {sx: (left - rect.x) * scaleX, sy: (top - rect.y) * scaleY, sw: (right - left) * scaleX, sh: (bottom - top) * scaleY}
}

// 0 (black) to 1 (white) for RGBA pixels; transparent pixels count as the black stage.
export function averageLuminance(rgba) {
  let sum = 0
  const count = Math.floor(rgba.length / 4)
  for (let i = 0; i < count * 4; i += 4) {
    sum += ((0.2126 * rgba[i] + 0.7152 * rgba[i + 1] + 0.0722 * rgba[i + 2]) * rgba[i + 3]) / 255
  }
  return count ? Math.round((sum / count / 255) * 1e4) / 1e4 : 0
}

// 'dark' means a black control. The gap between thresholds keeps it from flickering over grey.
export const toneFor = (luminance, previous = 'light') => (luminance > 0.62 ? 'dark' : luminance < 0.45 ? 'light' : previous)
