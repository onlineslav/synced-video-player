// Text subtitles drawn over the video by each person's own app. Pure functions only.

export const activeCues = (cues, time) => cues.filter((cue) => cue.start <= time && time < cue.end)

const ALLOWED_TAGS = new Set(['b', 'i', 'u'])
const ENTITIES = {amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0', lrm: '\u200e', rlm: '\u200f'}
const escapeHtml = (text) => text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

// WebVTT cue text to HTML, keeping bold, italic and underline and nothing else.
export function cueHtml(text) {
  return text
    .split(/(<\/?[a-z][^>]*>)/i)
    .map((part, i) => {
      if (i % 2 === 0) return escapeHtml(part.replace(/&(\w+);/g, (entity, name) => ENTITIES[name] ?? entity))
      const [, slash, name] = part.match(/^<(\/?)([a-z]+)/i)
      return ALLOWED_TAGS.has(name.toLowerCase()) ? `<${slash}${name.toLowerCase()}>` : ''
    })
    .join('')
    .replace(/\n/g, '<br>')
}

export const captionHtml = (cues, time) =>
  activeCues(cues, time)
    .map((cue) => cueHtml(cue.text))
    .join('<br>')
