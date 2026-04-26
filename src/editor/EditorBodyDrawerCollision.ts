import type { MapCharacterBodyCollisionShape } from '../editorMapTypes'
import {
  EDITOR_SELECTION_HANDLES,
  getPointerAngleDeg,
  getRotationDeltaDeg,
  isHorizontalSelectionHandle,
  isVerticalSelectionHandle,
  normalizeRotationDeg,
  rotateEditorLocalPoint,
} from './EditorBodyDrawerTransforms'
import type {
  EditorCanvasBounds,
  EditorCollisionRotateSession,
  EditorCollisionScaleSession,
  EditorCollisionShape,
  EditorCollisionShapeKind,
  EditorRotationHandle,
  EditorSelectionHandle,
} from './EditorBodyDrawerTypes'
import {
  MIN_COLLISION_HALF_EXTENT,
  MIN_COLLISION_RADIUS,
  SELECTION_HANDLE_HIT_SIZE,
  SELECTION_ROTATE_HANDLE_HIT_SIZE,
  SELECTION_ROTATE_HANDLE_OFFSET,
} from './EditorBodyDrawerTypes'

export function cloneCollisionShape(
  shape: EditorCollisionShape
): EditorCollisionShape {
  if (shape.kind === 'circle') {
    return {
      id: shape.id,
      kind: 'circle',
      centerX: shape.centerX,
      centerY: shape.centerY,
      radius: shape.radius,
    }
  }
  if (shape.kind === 'ellipse') {
    return {
      id: shape.id,
      kind: 'ellipse',
      centerX: shape.centerX,
      centerY: shape.centerY,
      radiusX: shape.radiusX,
      radiusY: shape.radiusY,
      rotationDeg: shape.rotationDeg,
    }
  }
  return {
    id: shape.id,
    kind: 'capsule',
    centerX: shape.centerX,
    centerY: shape.centerY,
    halfWidth: shape.halfWidth,
    halfHeight: shape.halfHeight,
    rotationDeg: shape.rotationDeg,
  }
}

export function copyCollisionShapesSnapshot(
  shapes: readonly EditorCollisionShape[]
): EditorCollisionShape[] {
  const snapshot = new Array<EditorCollisionShape>(shapes.length)
  for (let i = 0; i < shapes.length; i++) {
    snapshot[i] = cloneCollisionShape(shapes[i])
  }
  return snapshot
}

export function getNextCollisionShapeId(
  shapes: readonly EditorCollisionShape[]
): number {
  let maxShapeId = 0
  for (let i = 0; i < shapes.length; i++) {
    if (shapes[i].id > maxShapeId) {
      maxShapeId = shapes[i].id
    }
  }
  return maxShapeId + 1
}

export function getEditorCollisionShapeRotationDeg(
  shape: EditorCollisionShape
): number {
  if (shape.kind === 'circle') {
    return 0
  }
  return normalizeRotationDeg(shape.rotationDeg)
}

export function getEditorCollisionShapeHalfWidth(
  shape: EditorCollisionShape
): number {
  if (shape.kind === 'circle') {
    return shape.radius
  }
  return shape.kind === 'ellipse' ? shape.radiusX : shape.halfWidth
}

export function getEditorCollisionShapeHalfHeight(
  shape: EditorCollisionShape
): number {
  if (shape.kind === 'circle') {
    return shape.radius
  }
  return shape.kind === 'ellipse' ? shape.radiusY : shape.halfHeight
}

export function getCollisionShapeLocalPoint(
  shape: EditorCollisionShape,
  worldX: number,
  worldY: number
): { x: number; y: number } {
  const rotationDeg = getEditorCollisionShapeRotationDeg(shape)
  return rotateEditorLocalPoint(
    worldX - shape.centerX,
    worldY - shape.centerY,
    -rotationDeg
  )
}

export function getCollisionShapeSelectionHandleLocalPoint(
  shape: EditorCollisionShape,
  handle: EditorSelectionHandle
): { x: number; y: number } {
  const halfWidth = getEditorCollisionShapeHalfWidth(shape)
  const halfHeight = getEditorCollisionShapeHalfHeight(shape)
  const centerX = 0
  const centerY = 0
  if (handle === 'n') return { x: centerX, y: -halfHeight }
  if (handle === 'ne') return { x: halfWidth, y: -halfHeight }
  if (handle === 'e') return { x: halfWidth, y: centerY }
  if (handle === 'se') return { x: halfWidth, y: halfHeight }
  if (handle === 's') return { x: centerX, y: halfHeight }
  if (handle === 'sw') return { x: -halfWidth, y: halfHeight }
  if (handle === 'w') return { x: -halfWidth, y: centerY }
  return { x: -halfWidth, y: -halfHeight }
}

export function getCollisionShapeSelectionHandleCenter(
  shape: EditorCollisionShape,
  handle: EditorSelectionHandle
): { x: number; y: number } {
  const localPoint = getCollisionShapeSelectionHandleLocalPoint(shape, handle)
  const rotated = rotateEditorLocalPoint(
    localPoint.x,
    localPoint.y,
    getEditorCollisionShapeRotationDeg(shape)
  )
  return {
    x: shape.centerX + rotated.x,
    y: shape.centerY + rotated.y,
  }
}

export function getCollisionShapeRotationHandleCenter(
  shape: EditorCollisionShape
): { x: number; y: number } {
  const localPoint = rotateEditorLocalPoint(
    0,
    -getEditorCollisionShapeHalfHeight(shape) - SELECTION_ROTATE_HANDLE_OFFSET,
    getEditorCollisionShapeRotationDeg(shape)
  )
  return {
    x: shape.centerX + localPoint.x,
    y: shape.centerY + localPoint.y,
  }
}

export function traceCollisionShapeSelectionFrame(
  ctx: CanvasRenderingContext2D,
  shape: EditorCollisionShape
) {
  const corners = [
    rotateEditorLocalPoint(
      -getEditorCollisionShapeHalfWidth(shape),
      -getEditorCollisionShapeHalfHeight(shape),
      getEditorCollisionShapeRotationDeg(shape)
    ),
    rotateEditorLocalPoint(
      getEditorCollisionShapeHalfWidth(shape),
      -getEditorCollisionShapeHalfHeight(shape),
      getEditorCollisionShapeRotationDeg(shape)
    ),
    rotateEditorLocalPoint(
      getEditorCollisionShapeHalfWidth(shape),
      getEditorCollisionShapeHalfHeight(shape),
      getEditorCollisionShapeRotationDeg(shape)
    ),
    rotateEditorLocalPoint(
      -getEditorCollisionShapeHalfWidth(shape),
      getEditorCollisionShapeHalfHeight(shape),
      getEditorCollisionShapeRotationDeg(shape)
    ),
  ]
  ctx.beginPath()
  ctx.moveTo(shape.centerX + corners[0].x, shape.centerY + corners[0].y)
  for (let i = 1; i < corners.length; i++) {
    ctx.lineTo(shape.centerX + corners[i].x, shape.centerY + corners[i].y)
  }
  ctx.closePath()
}

export function buildMapCollisionShapeFromEditor(
  shape: EditorCollisionShape
): MapCharacterBodyCollisionShape {
  if (shape.kind === 'circle') {
    return {
      kind: 'circle',
      center: {
        x: shape.centerX,
        y: shape.centerY,
      },
      radius: shape.radius,
    }
  }
  if (shape.kind === 'ellipse') {
    return {
      kind: 'ellipse',
      center: {
        x: shape.centerX,
        y: shape.centerY,
      },
      radiusX: shape.radiusX,
      radiusY: shape.radiusY,
      rotationDeg: shape.rotationDeg,
    }
  }
  return {
    kind: 'capsule',
    center: {
      x: shape.centerX,
      y: shape.centerY,
    },
    halfWidth: shape.halfWidth,
    halfHeight: shape.halfHeight,
    rotationDeg: shape.rotationDeg,
  }
}

export function createEditorCollisionShapeFromMap(
  shape: MapCharacterBodyCollisionShape,
  id: number,
  centerX: number,
  centerY: number,
  facing: number
): EditorCollisionShape {
  if (shape.kind === 'circle') {
    return {
      id,
      kind: 'circle',
      centerX: centerX + Math.round(shape.center.x * facing),
      centerY: centerY + Math.round(shape.center.y),
      radius: Math.max(MIN_COLLISION_RADIUS, Math.round(shape.radius)),
    }
  }
  if (shape.kind === 'ellipse') {
    return {
      id,
      kind: 'ellipse',
      centerX: centerX + Math.round(shape.center.x * facing),
      centerY: centerY + Math.round(shape.center.y),
      radiusX: Math.max(MIN_COLLISION_RADIUS, Math.round(shape.radiusX)),
      radiusY: Math.max(MIN_COLLISION_RADIUS, Math.round(shape.radiusY)),
      rotationDeg: Math.round(
        normalizeRotationDeg((shape.rotationDeg ?? 0) * facing)
      ),
    }
  }
  return {
    id,
    kind: 'capsule',
    centerX: centerX + Math.round(shape.center.x * facing),
    centerY: centerY + Math.round(shape.center.y),
    halfWidth: Math.max(MIN_COLLISION_HALF_EXTENT, Math.round(shape.halfWidth)),
    halfHeight: Math.max(
      MIN_COLLISION_HALF_EXTENT,
      Math.round(shape.halfHeight)
    ),
    rotationDeg: Math.round(
      normalizeRotationDeg((shape.rotationDeg ?? 0) * facing)
    ),
  }
}

export function getCollisionShapeBounds(
  shape: EditorCollisionShape
): EditorCanvasBounds {
  if (shape.kind === 'circle') {
    return {
      minX: shape.centerX - shape.radius,
      minY: shape.centerY - shape.radius,
      maxX: shape.centerX + shape.radius,
      maxY: shape.centerY + shape.radius,
    }
  }
  if (shape.kind === 'ellipse') {
    const rotationRad = (shape.rotationDeg * Math.PI) / 180
    const cos = Math.cos(rotationRad)
    const sin = Math.sin(rotationRad)
    const extentX = Math.sqrt(
      shape.radiusX * shape.radiusX * cos * cos +
        shape.radiusY * shape.radiusY * sin * sin
    )
    const extentY = Math.sqrt(
      shape.radiusX * shape.radiusX * sin * sin +
        shape.radiusY * shape.radiusY * cos * cos
    )
    return {
      minX: shape.centerX - extentX,
      minY: shape.centerY - extentY,
      maxX: shape.centerX + extentX,
      maxY: shape.centerY + extentY,
    }
  }
  const rotationRad = (shape.rotationDeg * Math.PI) / 180
  const cos = Math.cos(rotationRad)
  const sin = Math.sin(rotationRad)
  const halfWidth = shape.halfWidth
  const halfHeight = shape.halfHeight
  const extentX = Math.abs(halfWidth * cos) + Math.abs(halfHeight * sin)
  const extentY = Math.abs(halfWidth * sin) + Math.abs(halfHeight * cos)
  return {
    minX: shape.centerX - extentX,
    minY: shape.centerY - extentY,
    maxX: shape.centerX + extentX,
    maxY: shape.centerY + extentY,
  }
}

export function traceEditorCollisionShape(
  ctx: CanvasRenderingContext2D,
  shape: EditorCollisionShape
) {
  if (shape.kind === 'circle') {
    ctx.beginPath()
    ctx.arc(shape.centerX, shape.centerY, shape.radius, 0, Math.PI * 2)
    return
  }
  if (shape.kind === 'ellipse') {
    ctx.beginPath()
    ctx.ellipse(
      shape.centerX,
      shape.centerY,
      shape.radiusX,
      shape.radiusY,
      (shape.rotationDeg * Math.PI) / 180,
      0,
      Math.PI * 2
    )
    return
  }
  const radius = Math.min(shape.halfWidth, shape.halfHeight)
  const left = -shape.halfWidth
  const top = -shape.halfHeight
  const width = shape.halfWidth * 2
  const height = shape.halfHeight * 2
  ctx.save()
  ctx.translate(shape.centerX, shape.centerY)
  ctx.rotate((shape.rotationDeg * Math.PI) / 180)
  ctx.beginPath()
  ctx.moveTo(left + radius, top)
  ctx.lineTo(left + width - radius, top)
  ctx.arc(left + width - radius, top + radius, radius, -Math.PI / 2, 0)
  ctx.lineTo(left + width, top + height - radius)
  ctx.arc(left + width - radius, top + height - radius, radius, 0, Math.PI / 2)
  ctx.lineTo(left + radius, top + height)
  ctx.arc(left + radius, top + height - radius, radius, Math.PI / 2, Math.PI)
  ctx.lineTo(left, top + radius)
  ctx.arc(left + radius, top + radius, radius, Math.PI, 1.5 * Math.PI)
  ctx.closePath()
  ctx.restore()
}

export function isPointInsideCollisionShape(
  shape: EditorCollisionShape,
  pointX: number,
  pointY: number
): boolean {
  if (shape.kind === 'circle') {
    const dx = pointX - shape.centerX
    const dy = pointY - shape.centerY
    return dx * dx + dy * dy <= shape.radius * shape.radius
  }
  if (shape.kind === 'ellipse') {
    const localPoint = getCollisionShapeLocalPoint(shape, pointX, pointY)
    const radiusX = Math.max(1, shape.radiusX)
    const radiusY = Math.max(1, shape.radiusY)
    return (
      localPoint.x * localPoint.x * radiusY * radiusY +
        localPoint.y * localPoint.y * radiusX * radiusX <=
      radiusX * radiusX * radiusY * radiusY
    )
  }
  const localPoint = getCollisionShapeLocalPoint(shape, pointX, pointY)
  const dx = Math.abs(localPoint.x)
  const dy = Math.abs(localPoint.y)
  if (dx > shape.halfWidth || dy > shape.halfHeight) {
    return false
  }
  const radius = Math.min(shape.halfWidth, shape.halfHeight)
  const innerWidth = shape.halfWidth - radius
  const innerHeight = shape.halfHeight - radius
  if (dx <= innerWidth || dy <= innerHeight) {
    return true
  }
  const rx = dx - innerWidth
  const ry = dy - innerHeight
  return rx * rx + ry * ry <= radius * radius
}

export function getCollisionShapeAtPoint(
  shapes: readonly EditorCollisionShape[],
  pointX: number,
  pointY: number
): EditorCollisionShape | null {
  for (let i = shapes.length - 1; i >= 0; i--) {
    const shape = shapes[i]
    if (isPointInsideCollisionShape(shape, pointX, pointY)) {
      return shape
    }
  }
  return null
}

export function isCollisionShapeRotatable(
  shape: EditorCollisionShape | null
): boolean {
  return !!shape && shape.kind !== 'circle'
}

export function getCollisionShapeSelectionHandleAtPoint(
  pointX: number,
  pointY: number,
  shape: EditorCollisionShape | null,
  viewportScale: number
): EditorSelectionHandle | null {
  if (!shape) {
    return null
  }
  const hitRadius = Math.max(
    2,
    Math.round(SELECTION_HANDLE_HIT_SIZE / Math.max(1, viewportScale * 2))
  )
  for (let i = 0; i < EDITOR_SELECTION_HANDLES.length; i++) {
    const center = getCollisionShapeSelectionHandleCenter(
      shape,
      EDITOR_SELECTION_HANDLES[i]
    )
    if (
      Math.abs(pointX - center.x) <= hitRadius &&
      Math.abs(pointY - center.y) <= hitRadius
    ) {
      return EDITOR_SELECTION_HANDLES[i]
    }
  }
  return null
}

export function getCollisionShapeRotationHandleAtPoint(
  pointX: number,
  pointY: number,
  shape: EditorCollisionShape | null,
  viewportScale: number
): EditorRotationHandle | null {
  if (!shape || !isCollisionShapeRotatable(shape)) {
    return null
  }
  const center = getCollisionShapeRotationHandleCenter(shape)
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

export function beginCollisionShapeScale(
  shape: EditorCollisionShape,
  handle: EditorSelectionHandle,
  pointerX: number,
  pointerY: number
): EditorCollisionScaleSession {
  const localHandle = getCollisionShapeSelectionHandleLocalPoint(shape, handle)
  const localPointer = getCollisionShapeLocalPoint(shape, pointerX, pointerY)
  return {
    shapeId: shape.id,
    handle,
    centerX: shape.centerX,
    centerY: shape.centerY,
    rotationDeg: getEditorCollisionShapeRotationDeg(shape),
    handleOffsetLocalX: localPointer.x - localHandle.x,
    handleOffsetLocalY: localPointer.y - localHandle.y,
    initialShape: cloneCollisionShape(shape),
  }
}

export function applyCollisionShapeScale(
  shape: EditorCollisionShape,
  session: EditorCollisionScaleSession,
  pointX: number,
  pointY: number
) {
  const localPointer = rotateEditorLocalPoint(
    pointX - session.centerX,
    pointY - session.centerY,
    -session.rotationDeg
  )
  const resolvedLocalX = localPointer.x - session.handleOffsetLocalX
  const resolvedLocalY = localPointer.y - session.handleOffsetLocalY
  const useHorizontal = isHorizontalSelectionHandle(session.handle)
  const useVertical = isVerticalSelectionHandle(session.handle)
  if (shape.kind === 'circle') {
    const nextRadiusX = useHorizontal
      ? Math.max(MIN_COLLISION_RADIUS, Math.round(Math.abs(resolvedLocalX)))
      : session.initialShape.kind === 'circle'
        ? session.initialShape.radius
        : MIN_COLLISION_RADIUS
    const nextRadiusY = useVertical
      ? Math.max(MIN_COLLISION_RADIUS, Math.round(Math.abs(resolvedLocalY)))
      : session.initialShape.kind === 'circle'
        ? session.initialShape.radius
        : MIN_COLLISION_RADIUS
    shape.radius =
      useHorizontal && useVertical
        ? Math.max(nextRadiusX, nextRadiusY)
        : useHorizontal
          ? nextRadiusX
          : nextRadiusY
    return
  }
  if (shape.kind === 'ellipse' && session.initialShape.kind === 'ellipse') {
    shape.radiusX = useHorizontal
      ? Math.max(MIN_COLLISION_RADIUS, Math.round(Math.abs(resolvedLocalX)))
      : session.initialShape.radiusX
    shape.radiusY = useVertical
      ? Math.max(MIN_COLLISION_RADIUS, Math.round(Math.abs(resolvedLocalY)))
      : session.initialShape.radiusY
    shape.rotationDeg = session.initialShape.rotationDeg
    return
  }
  if (shape.kind === 'capsule' && session.initialShape.kind === 'capsule') {
    shape.halfWidth = useHorizontal
      ? Math.max(
          MIN_COLLISION_HALF_EXTENT,
          Math.round(Math.abs(resolvedLocalX))
        )
      : session.initialShape.halfWidth
    shape.halfHeight = useVertical
      ? Math.max(
          MIN_COLLISION_HALF_EXTENT,
          Math.round(Math.abs(resolvedLocalY))
        )
      : session.initialShape.halfHeight
    shape.rotationDeg = session.initialShape.rotationDeg
  }
}

export function beginCollisionShapeRotate(
  shape: EditorCollisionShape,
  pointerX: number,
  pointerY: number
): EditorCollisionRotateSession {
  return {
    shapeId: shape.id,
    centerX: shape.centerX,
    centerY: shape.centerY,
    startAngleDeg: getPointerAngleDeg(
      pointerX,
      pointerY,
      shape.centerX,
      shape.centerY
    ),
    initialRotationDeg: getEditorCollisionShapeRotationDeg(shape),
  }
}

export function applyCollisionShapeRotate(
  shape: EditorCollisionShape,
  session: EditorCollisionRotateSession,
  pointX: number,
  pointY: number
) {
  if (shape.kind === 'circle') {
    return
  }
  const currentAngleDeg = getPointerAngleDeg(
    pointX,
    pointY,
    session.centerX,
    session.centerY
  )
  const deltaDeg = getRotationDeltaDeg(session.startAngleDeg, currentAngleDeg)
  shape.rotationDeg = Math.round(
    normalizeRotationDeg(session.initialRotationDeg + deltaDeg)
  )
}

export function createCollisionShapeFromDrag(
  kind: EditorCollisionShapeKind,
  shapeId: number,
  startX: number,
  startY: number,
  endX: number,
  endY: number
): EditorCollisionShape {
  const minX = Math.min(startX, endX)
  const maxX = Math.max(startX, endX)
  const minY = Math.min(startY, endY)
  const maxY = Math.max(startY, endY)
  const centerX = Math.round((minX + maxX) * 0.5)
  const centerY = Math.round((minY + maxY) * 0.5)
  if (kind === 'circle') {
    const halfWidth = Math.max(
      MIN_COLLISION_RADIUS,
      Math.round((maxX - minX) * 0.5)
    )
    const halfHeight = Math.max(
      MIN_COLLISION_RADIUS,
      Math.round((maxY - minY) * 0.5)
    )
    return {
      id: shapeId,
      kind: 'circle',
      centerX,
      centerY,
      radius: Math.max(halfWidth, halfHeight),
    }
  }
  if (kind === 'ellipse') {
    return {
      id: shapeId,
      kind: 'ellipse',
      centerX,
      centerY,
      radiusX: Math.max(MIN_COLLISION_RADIUS, Math.round((maxX - minX) * 0.5)),
      radiusY: Math.max(MIN_COLLISION_RADIUS, Math.round((maxY - minY) * 0.5)),
      rotationDeg: 0,
    }
  }
  return {
    id: shapeId,
    kind: 'capsule',
    centerX,
    centerY,
    halfWidth: Math.max(
      MIN_COLLISION_HALF_EXTENT,
      Math.round((maxX - minX) * 0.5)
    ),
    halfHeight: Math.max(
      MIN_COLLISION_HALF_EXTENT,
      Math.round((maxY - minY) * 0.5)
    ),
    rotationDeg: 0,
  }
}

export function assignCollisionShape(
  target: EditorCollisionShape,
  source: EditorCollisionShape
) {
  if (target.kind === 'circle' && source.kind === 'circle') {
    target.centerX = source.centerX
    target.centerY = source.centerY
    target.radius = source.radius
    return
  }
  if (target.kind === 'ellipse' && source.kind === 'ellipse') {
    target.centerX = source.centerX
    target.centerY = source.centerY
    target.radiusX = source.radiusX
    target.radiusY = source.radiusY
    target.rotationDeg = source.rotationDeg
    return
  }
  if (target.kind === 'capsule' && source.kind === 'capsule') {
    target.centerX = source.centerX
    target.centerY = source.centerY
    target.halfWidth = source.halfWidth
    target.halfHeight = source.halfHeight
    target.rotationDeg = source.rotationDeg
  }
}

export function serializeCollisionShapes(
  shapes: readonly EditorCollisionShape[],
  centerX: number,
  centerY: number,
  editorFacing: number
): MapCharacterBodyCollisionShape[] {
  const result = new Array<MapCharacterBodyCollisionShape>(shapes.length)
  for (let i = 0; i < shapes.length; i++) {
    const shape = shapes[i]
    if (shape.kind === 'circle') {
      result[i] = {
        kind: 'circle',
        center: {
          x: Math.round((shape.centerX - centerX) * editorFacing),
          y: Math.round(shape.centerY - centerY),
        },
        radius: shape.radius,
      }
      continue
    }
    if (shape.kind === 'ellipse') {
      result[i] = {
        kind: 'ellipse',
        center: {
          x: Math.round((shape.centerX - centerX) * editorFacing),
          y: Math.round(shape.centerY - centerY),
        },
        radiusX: shape.radiusX,
        radiusY: shape.radiusY,
        rotationDeg: Math.round(
          normalizeRotationDeg(shape.rotationDeg * editorFacing)
        ),
      }
      continue
    }
    result[i] = {
      kind: 'capsule',
      center: {
        x: Math.round((shape.centerX - centerX) * editorFacing),
        y: Math.round(shape.centerY - centerY),
      },
      halfWidth: shape.halfWidth,
      halfHeight: shape.halfHeight,
      rotationDeg: Math.round(
        normalizeRotationDeg(shape.rotationDeg * editorFacing)
      ),
    }
  }
  return result
}
