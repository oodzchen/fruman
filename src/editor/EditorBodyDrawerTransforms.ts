import type {
  EditorCanvasBounds,
  EditorRotationHandle,
  EditorSelectionHandle,
} from './EditorBodyDrawerTypes'
import {
  DRAW_WORLD_SIZE,
  SELECTION_HANDLE_HIT_SIZE,
  SELECTION_MIN_SIZE,
  SELECTION_ROTATE_HANDLE_HIT_SIZE,
  SELECTION_ROTATE_HANDLE_OFFSET,
} from './EditorBodyDrawerTypes'

export interface EditorBodyDrawerPoint {
  x: number
  y: number
}

export const EDITOR_SELECTION_HANDLES: readonly EditorSelectionHandle[] = [
  'nw',
  'n',
  'ne',
  'e',
  'se',
  's',
  'sw',
  'w',
]

export function normalizeRotationDeg(rotationDeg: number): number {
  let normalized = Math.round(rotationDeg) % 360
  if (normalized > 180) {
    normalized -= 360
  } else if (normalized <= -180) {
    normalized += 360
  }
  return normalized
}

export function getPointerAngleDeg(
  pointX: number,
  pointY: number,
  centerX: number,
  centerY: number
): number {
  return Math.round(
    (Math.atan2(pointY - centerY, pointX - centerX) * 180) / Math.PI
  )
}

export function getRotationDeltaDeg(
  startDeg: number,
  currentDeg: number
): number {
  return normalizeRotationDeg(currentDeg - startDeg)
}

export function rotateEditorLocalPoint(
  localX: number,
  localY: number,
  rotationDeg: number
): EditorBodyDrawerPoint {
  if (rotationDeg === 0) {
    return { x: localX, y: localY }
  }
  const rotationRad = (rotationDeg * Math.PI) / 180
  const cos = Math.cos(rotationRad)
  const sin = Math.sin(rotationRad)
  return {
    x: localX * cos - localY * sin,
    y: localX * sin + localY * cos,
  }
}

export function getSelectionHandleCenter(
  bounds: EditorCanvasBounds,
  handle: EditorSelectionHandle
): EditorBodyDrawerPoint {
  const centerX = Math.round((bounds.minX + bounds.maxX) * 0.5)
  const centerY = Math.round((bounds.minY + bounds.maxY) * 0.5)
  if (handle === 'n') return { x: centerX, y: bounds.minY }
  if (handle === 'ne') return { x: bounds.maxX, y: bounds.minY }
  if (handle === 'e') return { x: bounds.maxX, y: centerY }
  if (handle === 'se') return { x: bounds.maxX, y: bounds.maxY }
  if (handle === 's') return { x: centerX, y: bounds.maxY }
  if (handle === 'sw') return { x: bounds.minX, y: bounds.maxY }
  if (handle === 'w') return { x: bounds.minX, y: centerY }
  return { x: bounds.minX, y: bounds.minY }
}

export function getSelectionRotationHandleCenter(
  bounds: EditorCanvasBounds
): EditorBodyDrawerPoint {
  const centerX = Math.round((bounds.minX + bounds.maxX) * 0.5)
  return {
    x: centerX,
    y: bounds.minY - SELECTION_ROTATE_HANDLE_OFFSET,
  }
}

export function getSelectionHandleAtPoint(
  pointX: number,
  pointY: number,
  bounds: EditorCanvasBounds | null,
  viewportScale: number
): EditorSelectionHandle | null {
  if (!bounds) {
    return null
  }
  const hitRadius = Math.max(
    2,
    Math.round(SELECTION_HANDLE_HIT_SIZE / Math.max(1, viewportScale * 2))
  )
  for (let i = 0; i < EDITOR_SELECTION_HANDLES.length; i++) {
    const handle = EDITOR_SELECTION_HANDLES[i]
    const center = getSelectionHandleCenter(bounds, handle)
    if (
      Math.abs(pointX - center.x) <= hitRadius &&
      Math.abs(pointY - center.y) <= hitRadius
    ) {
      return handle
    }
  }
  return null
}

export function getSelectionRotationHandleAtPoint(
  pointX: number,
  pointY: number,
  bounds: EditorCanvasBounds | null,
  viewportScale: number
): EditorRotationHandle | null {
  if (!bounds) {
    return null
  }
  const center = getSelectionRotationHandleCenter(bounds)
  const hitRadius = Math.max(
    2,
    Math.round(
      SELECTION_ROTATE_HANDLE_HIT_SIZE / Math.max(1, viewportScale * 2)
    )
  )
  return Math.abs(pointX - center.x) <= hitRadius &&
    Math.abs(pointY - center.y) <= hitRadius
    ? 'rotate'
    : null
}

export function getScaledBoundsFromHandle(
  initialBounds: EditorCanvasBounds,
  handle: EditorSelectionHandle,
  centerX: number,
  centerY: number,
  pointX: number,
  pointY: number
): EditorCanvasBounds {
  const initialHalfWidth = Math.max(
    1,
    Math.round((initialBounds.maxX - initialBounds.minX) * 0.5)
  )
  const initialHalfHeight = Math.max(
    1,
    Math.round((initialBounds.maxY - initialBounds.minY) * 0.5)
  )
  const useHorizontal = isHorizontalSelectionHandle(handle)
  const useVertical = isVerticalSelectionHandle(handle)
  const halfWidth = useHorizontal
    ? Math.max(SELECTION_MIN_SIZE, Math.abs(pointX - centerX))
    : initialHalfWidth
  const halfHeight = useVertical
    ? Math.max(SELECTION_MIN_SIZE, Math.abs(pointY - centerY))
    : initialHalfHeight
  const normalizedMinX = Math.max(0, centerX - halfWidth)
  const normalizedMinY = Math.max(0, centerY - halfHeight)
  const normalizedMaxX = Math.min(DRAW_WORLD_SIZE - 1, centerX + halfWidth)
  const normalizedMaxY = Math.min(DRAW_WORLD_SIZE - 1, centerY + halfHeight)
  return {
    minX: normalizedMinX,
    minY: normalizedMinY,
    maxX: Math.max(normalizedMinX + 1, normalizedMaxX),
    maxY: Math.max(normalizedMinY + 1, normalizedMaxY),
  }
}

export function isHorizontalSelectionHandle(
  handle: EditorSelectionHandle
): boolean {
  return (
    handle === 'e' ||
    handle === 'w' ||
    handle === 'ne' ||
    handle === 'nw' ||
    handle === 'se' ||
    handle === 'sw'
  )
}

export function isVerticalSelectionHandle(
  handle: EditorSelectionHandle
): boolean {
  return (
    handle === 'n' ||
    handle === 's' ||
    handle === 'ne' ||
    handle === 'nw' ||
    handle === 'se' ||
    handle === 'sw'
  )
}
