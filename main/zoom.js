// Electron's default menu already binds Ctrl+- to zoom out, but its zoom-in accelerator is
// CommandOrControl+Plus, which on a US keyboard means Ctrl+Shift+=: Ctrl+= does nothing. Take both
// keys (and Ctrl+wheel) over here. preventDefault stops the menu accelerator, so the renderer owns
// the scale, remembers it and shows it in Settings.
function zoomDirection(input) {
  const modifier = process.platform === 'darwin' ? input.meta : input.control
  if (input.type !== 'keyDown' || !modifier || input.alt) return null
  if (['=', '+', 'Add'].includes(input.key) || input.code === 'NumpadAdd') return 1
  if (['-', '_', 'Subtract'].includes(input.key) || input.code === 'NumpadSubtract') return -1
  if (input.key === '0' || input.code === 'Numpad0') return 0
  return null
}

function watchZoom(contents) {
  contents.on('before-input-event', (event, input) => {
    const direction = zoomDirection(input)
    if (direction === null) return
    event.preventDefault()
    contents.send('zoom:step', direction)
  })
  // Ctrl+wheel and pinch only ask; nothing changes until the renderer sends the new factor back.
  contents.on('zoom-changed', (_event, towards) => contents.send('zoom:step', towards === 'in' ? 1 : -1))
}

// The renderer decides the scale; this only keeps a stray value from making the window unusable.
const zoomFactor = (factor) => Math.min(3, Math.max(0.25, Number(factor) || 1))

module.exports = {watchZoom, zoomDirection, zoomFactor}
