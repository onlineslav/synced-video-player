// UI scale. The whole page is scaled by Electron's zoom factor, so the video scales with it.
// Electron's default menu owns Ctrl+-/Ctrl+Plus, but its zoom-in accelerator is the "+" character,
// which needs Ctrl+Shift+= on a US keyboard: main/zoom.js takes the keys over and sends steps here.
export const MIN_ZOOM = 0.5
export const MAX_ZOOM = 2
export const DEFAULT_ZOOM = 1
// Only the keyboard and the -/+ of a step move in jumps. The slider and the box are free.
export const ZOOM_STEPS = [0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2]

const round = (factor) => Math.round(factor * 100) / 100

// Anything unusable (an old saved value, a half-typed box) resets rather than shrinking to nothing.
export function clampZoom(value) {
  const factor = Number(value)
  if (!Number.isFinite(factor) || factor <= 0) return DEFAULT_ZOOM
  return round(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, factor)))
}

// What someone typed in the percent box: "125", "125%", "125 %". A small number is read as a
// factor, so 1.5 means 150% rather than clamping down to the minimum.
export function parseZoom(text) {
  const number = Number(String(text).replace('%', '').trim())
  if (!Number.isFinite(number) || number <= 0) return null
  return clampZoom(number < 5 ? number : number / 100)
}

// direction: 1 to the next step up, -1 to the next one down, 0 back to 100%.
export function stepZoom(current, direction) {
  if (!direction) return DEFAULT_ZOOM
  const from = clampZoom(current)
  const next = direction > 0
    ? ZOOM_STEPS.find((step) => step > from + 0.001)
    : [...ZOOM_STEPS].reverse().find((step) => step < from - 0.001)
  return next ?? from
}

export const zoomPercent = (factor) => Math.round(clampZoom(factor) * 100)
export const formatZoom = (factor) => `${zoomPercent(factor)}%`
