// Shared whiteboard: strokes everyone in the room draws over the video. The board logic is pure;
// drawStroke takes any CanvasRenderingContext2D.
//
// Points are stored relative to the video's picture (0..1), so a drawing covers the same part of
// the picture on every screen, whatever its size.

export const COLORS = ['#ffffff', '#1a1a1a', '#ff4d4d', '#ff9f1c', '#ffe14d', '#3ddc84', '#4da3ff', '#c77dff']
// An eraser stroke is a stroke in this "colour": it wipes out whatever was drawn under it before.
export const ERASER = 'erase'
// Line widths as a fraction of the picture's height.
export const BRUSH_SIZES = [0.004, 0.008, 0.016, 0.032]
const ERASER_SCALE = 3 // the eraser is wider than a pen of the same size
export const MAX_COORDINATES = 2048
export const MAX_STROKES = 256

export const createBoard = () => ({strokes: new Map(), clearedAt: 0, revision: 0})
export const orderedStrokes = (board) => [...board.strokes.values()].sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))

const isCoordinateList = (list) => Array.isArray(list) && list.length <= MAX_COORDINATES && list.length % 2 === 0 && list.every((v) => Number.isFinite(v) && Math.abs(v) <= 4)

// Strokes arrive in chunks while someone draws. `offset` is the index of the chunk's first
// coordinate, so a repeated chunk changes nothing. Returns the stroke, or null if rejected.
export function addStrokeChunk(board, {id, color, size, at, offset = 0, points} = {}) {
  if (typeof id !== 'string' || id.length > 100 || !id.length || !Number.isSafeInteger(at) || at >= 2 ** 48 || !(COLORS.includes(color) || color === ERASER) || !Number.isInteger(size) || !BRUSH_SIZES[size]) return null
  if (!(at > board.clearedAt) || !Number.isInteger(offset) || offset < 0 || offset % 2 || !isCoordinateList(points)) return null
  const existing = board.strokes.get(id)
  if (existing && (existing.at !== at || existing.color !== color || existing.size !== size)) return null
  if (offset > (existing?.points.length ?? 0)) return null
  board.revision = Math.max(board.revision, at)
  if (!existing && board.strokes.size >= MAX_STROKES) {
    const last = orderedStrokes(board).at(-1)
    if (at > last.at || (at === last.at && id >= last.id)) return null
    board.strokes.delete(last.id)
  }
  const stroke = existing || {id, color, size, at, points: []}
  board.strokes.set(id, stroke)
  const end = Math.min(offset + points.length, MAX_COORDINATES)
  // Repeated/overlapping chunks cannot rewrite previously accepted coordinates.
  for (let i = Math.max(offset, stroke.points.length); i < end; i++) stroke.points[i] = points[i - offset]
  return stroke
}

// Removes every stroke started at or before `at`. Every app applies the same rule, so boards agree
// even when clocks differ a little.
export function clearBoard(board, at) {
  if (!Number.isSafeInteger(at) || at < 0 || at >= 2 ** 48) return
  board.revision = Math.max(board.revision, at)
  board.clearedAt = Math.max(board.clearedAt, at)
  for (const [id, stroke] of board.strokes) if (stroke.at <= board.clearedAt) board.strokes.delete(id)
}

export const boardSnapshot = (board) => ({clearedAt: board.clearedAt, strokes: orderedStrokes(board)})

// Someone joining gets a snapshot from everyone already in the room; merging is idempotent.
export function mergeSnapshot(board, snapshot) {
  clearBoard(board, Number(snapshot?.clearedAt) || 0)
  for (const stroke of Array.isArray(snapshot?.strokes) ? snapshot.strokes.slice(0, MAX_STROKES) : []) addStrokeChunk(board, {...stroke, offset: 0})
}

// Where the picture sits inside the stage with object-fit: contain; the whole stage without video.
export function pictureRect(stageWidth, stageHeight, videoWidth, videoHeight) {
  if (!videoWidth || !videoHeight) return {x: 0, y: 0, width: stageWidth, height: stageHeight}
  const scale = Math.min(stageWidth / videoWidth, stageHeight / videoHeight)
  const width = videoWidth * scale
  const height = videoHeight * scale
  return {x: (stageWidth - width) / 2, y: (stageHeight - height) / 2, width, height}
}

// Draws a stroke from coordinate index `from` onwards, joined to the point before it.
export function drawStroke(ctx, stroke, rect, from = 0) {
  const {points} = stroke
  const start = Math.max(0, Math.min(from, points.length) - 2)
  if (points.length - start < 2) return
  const x = (i) => rect.x + points[i] * rect.width
  const y = (i) => rect.y + points[i + 1] * rect.height
  const erasing = stroke.color === ERASER
  ctx.globalCompositeOperation = erasing ? 'destination-out' : 'source-over'
  ctx.strokeStyle = erasing ? '#000000' : stroke.color
  ctx.lineWidth = Math.max(1, BRUSH_SIZES[stroke.size] * (erasing ? ERASER_SCALE : 1) * rect.height)
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.beginPath()
  ctx.moveTo(x(start), y(start))
  // A single point still leaves a dot.
  if (points.length - start === 2) ctx.lineTo(x(start) + 0.01, y(start))
  for (let i = start + 2; i < points.length; i += 2) ctx.lineTo(x(i), y(i))
  ctx.stroke()
}
