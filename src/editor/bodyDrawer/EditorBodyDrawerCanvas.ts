import { readAlphaBounds } from './EditorBodyDrawerGeometry'
import type {
  EditorCanvasBounds,
  EditorCanvasSnapshot,
  EditorCanvasState,
} from './EditorBodyDrawerTypes'
import { DRAW_WORLD_SIZE } from './EditorBodyDrawerTypes'

export function createEditorCanvasState(
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D
): EditorCanvasState {
  return {
    canvas,
    ctx,
    bounds: null,
    boundsDirty: false,
  }
}

export function createLayerCanvas(): {
  canvas: HTMLCanvasElement
  ctx: CanvasRenderingContext2D | null
} {
  const canvas = document.createElement('canvas')
  canvas.width = DRAW_WORLD_SIZE
  canvas.height = DRAW_WORLD_SIZE
  return {
    canvas,
    ctx: canvas.getContext('2d'),
  }
}

export function cloneBounds(
  bounds: EditorCanvasBounds | null
): EditorCanvasBounds | null {
  if (!bounds) {
    return null
  }
  return {
    minX: bounds.minX,
    minY: bounds.minY,
    maxX: bounds.maxX,
    maxY: bounds.maxY,
  }
}

export function createBoundsFromRect(
  x: number,
  y: number,
  width: number,
  height: number
): EditorCanvasBounds | null {
  if (width <= 0 || height <= 0) {
    return null
  }
  const minX = Math.max(0, Math.min(DRAW_WORLD_SIZE - 1, Math.round(x)))
  const minY = Math.max(0, Math.min(DRAW_WORLD_SIZE - 1, Math.round(y)))
  const maxX = Math.max(
    minX,
    Math.min(DRAW_WORLD_SIZE - 1, minX + Math.max(1, Math.round(width)) - 1)
  )
  const maxY = Math.max(
    minY,
    Math.min(DRAW_WORLD_SIZE - 1, minY + Math.max(1, Math.round(height)) - 1)
  )
  return { minX, minY, maxX, maxY }
}

export function mergeBounds(
  target: EditorCanvasBounds | null,
  source: EditorCanvasBounds | null
): EditorCanvasBounds | null {
  if (!source) {
    return target
  }
  if (!target) {
    return cloneBounds(source)
  }
  if (source.minX < target.minX) {
    target.minX = source.minX
  }
  if (source.minY < target.minY) {
    target.minY = source.minY
  }
  if (source.maxX > target.maxX) {
    target.maxX = source.maxX
  }
  if (source.maxY > target.maxY) {
    target.maxY = source.maxY
  }
  return target
}

export function expandBoundsForStroke(
  bounds: EditorCanvasBounds | null,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  brushSize: number
): EditorCanvasBounds {
  const radius = Math.max(1, Math.ceil(brushSize * 0.5))
  const minX = Math.max(0, Math.min(fromX, toX) - radius)
  const minY = Math.max(0, Math.min(fromY, toY) - radius)
  const maxX = Math.min(DRAW_WORLD_SIZE - 1, Math.max(fromX, toX) + radius)
  const maxY = Math.min(DRAW_WORLD_SIZE - 1, Math.max(fromY, toY) + radius)
  if (!bounds) {
    return { minX, minY, maxX, maxY }
  }
  if (minX < bounds.minX) {
    bounds.minX = minX
  }
  if (minY < bounds.minY) {
    bounds.minY = minY
  }
  if (maxX > bounds.maxX) {
    bounds.maxX = maxX
  }
  if (maxY > bounds.maxY) {
    bounds.maxY = maxY
  }
  return bounds
}

export function translateBounds(
  bounds: EditorCanvasBounds | null,
  offsetX: number,
  offsetY: number
): EditorCanvasBounds | null {
  if (!bounds) {
    return null
  }
  return createBoundsFromRect(
    bounds.minX + offsetX,
    bounds.minY + offsetY,
    bounds.maxX + 1 - bounds.minX,
    bounds.maxY + 1 - bounds.minY
  )
}

export function resolveCanvasBounds(
  ctx: CanvasRenderingContext2D,
  bounds: EditorCanvasBounds | null,
  boundsDirty: boolean
): { bounds: EditorCanvasBounds | null; dirty: boolean } {
  if (!boundsDirty) {
    return { bounds, dirty: false }
  }
  const nextBounds = readAlphaBounds(ctx, DRAW_WORLD_SIZE)
  return { bounds: nextBounds, dirty: false }
}

export function captureCanvasSnapshot(
  ctx: CanvasRenderingContext2D,
  bounds: EditorCanvasBounds | null,
  boundsDirty: boolean
): {
  snapshot: EditorCanvasSnapshot
  bounds: EditorCanvasBounds | null
} {
  const resolved = resolveCanvasBounds(ctx, bounds, boundsDirty)
  if (!resolved.bounds) {
    return {
      snapshot: { bounds: null, image: null },
      bounds: null,
    }
  }
  const width = resolved.bounds.maxX + 1 - resolved.bounds.minX
  const height = resolved.bounds.maxY + 1 - resolved.bounds.minY
  return {
    snapshot: {
      bounds: cloneBounds(resolved.bounds),
      image: ctx.getImageData(
        resolved.bounds.minX,
        resolved.bounds.minY,
        width,
        height
      ),
    },
    bounds: resolved.bounds,
  }
}

export function applyCanvasSnapshot(
  ctx: CanvasRenderingContext2D,
  snapshot: EditorCanvasSnapshot
): EditorCanvasBounds | null {
  ctx.clearRect(0, 0, DRAW_WORLD_SIZE, DRAW_WORLD_SIZE)
  if (snapshot.bounds && snapshot.image) {
    ctx.putImageData(snapshot.image, snapshot.bounds.minX, snapshot.bounds.minY)
  }
  return cloneBounds(snapshot.bounds)
}

export function drawScaledCanvasSnapshot(
  ctx: CanvasRenderingContext2D,
  scratchCanvas: HTMLCanvasElement,
  snapshot: EditorCanvasSnapshot | null,
  targetBounds: EditorCanvasBounds | null
): EditorCanvasBounds | null {
  ctx.clearRect(0, 0, DRAW_WORLD_SIZE, DRAW_WORLD_SIZE)
  if (!snapshot?.bounds || !snapshot.image || !targetBounds) {
    return null
  }
  const sourceWidth = snapshot.bounds.maxX + 1 - snapshot.bounds.minX
  const sourceHeight = snapshot.bounds.maxY + 1 - snapshot.bounds.minY
  const outputCtx = getScratchContext(scratchCanvas, sourceWidth, sourceHeight)
  if (!outputCtx) {
    return null
  }
  const targetWidth = targetBounds.maxX + 1 - targetBounds.minX
  const targetHeight = targetBounds.maxY + 1 - targetBounds.minY
  outputCtx.clearRect(0, 0, sourceWidth, sourceHeight)
  outputCtx.putImageData(snapshot.image, 0, 0)
  ctx.save()
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(
    scratchCanvas,
    0,
    0,
    sourceWidth,
    sourceHeight,
    targetBounds.minX,
    targetBounds.minY,
    targetWidth,
    targetHeight
  )
  ctx.restore()
  return cloneBounds(targetBounds)
}

export function drawRotatedCanvasSnapshot(
  ctx: CanvasRenderingContext2D,
  scratchCanvas: HTMLCanvasElement,
  snapshot: EditorCanvasSnapshot | null,
  centerX: number,
  centerY: number,
  rotationDeg: number
): EditorCanvasBounds | null {
  ctx.clearRect(0, 0, DRAW_WORLD_SIZE, DRAW_WORLD_SIZE)
  if (!snapshot?.bounds || !snapshot.image) {
    return null
  }
  const sourceWidth = snapshot.bounds.maxX + 1 - snapshot.bounds.minX
  const sourceHeight = snapshot.bounds.maxY + 1 - snapshot.bounds.minY
  const outputCtx = getScratchContext(scratchCanvas, sourceWidth, sourceHeight)
  if (!outputCtx) {
    return null
  }
  outputCtx.clearRect(0, 0, sourceWidth, sourceHeight)
  outputCtx.putImageData(snapshot.image, 0, 0)
  ctx.save()
  ctx.imageSmoothingEnabled = false
  ctx.translate(centerX, centerY)
  ctx.rotate((rotationDeg * Math.PI) / 180)
  ctx.drawImage(
    scratchCanvas,
    snapshot.bounds.minX - centerX,
    snapshot.bounds.minY - centerY,
    sourceWidth,
    sourceHeight
  )
  ctx.restore()
  return readAlphaBounds(ctx, DRAW_WORLD_SIZE)
}

function getScratchContext(
  scratchCanvas: HTMLCanvasElement,
  width: number,
  height: number
): CanvasRenderingContext2D | null {
  scratchCanvas.width = width
  scratchCanvas.height = height
  return scratchCanvas.getContext('2d')
}
