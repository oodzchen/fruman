import { fabric } from 'fabric'

const fabricControlsUtils = (
  fabric as unknown as {
    controlsUtils: {
      renderCircleControl: (
        ctx: CanvasRenderingContext2D,
        left: number,
        top: number,
        styleOverride: unknown,
        fabricObject: fabric.Object
      ) => void
    }
  }
).controlsUtils

const fabricTransformPoint = (
  fabric.util as {
    transformPoint: (
      point: fabric.Point,
      matrix: number[],
      ignoreOffset?: boolean
    ) => fabric.Point
  }
).transformPoint

export type EditablePolygon = fabric.Polygon & {
  editorShape: 'ground-polygon'
}

interface EditorPolygonEditorContext {
  getCanvas: () => fabric.Canvas | null
  isPanning: () => boolean
  acquirePoint: (x: number, y: number) => fabric.Point
  releasePoint: (point: fabric.Point) => void
}

export class EditorPolygonEditor {
  private ctx: EditorPolygonEditorContext
  private scratchPoint = new fabric.Point(0, 0)
  private scratchPointB = new fabric.Point(0, 0)
  private scratchPointC = new fabric.Point(0, 0)
  private inverseMatrix: number[] = [1, 0, 0, 1, 0, 0]
  private controlMatrix: number[] = [1, 0, 0, 1, 0, 0]

  constructor(ctx: EditorPolygonEditorContext) {
    this.ctx = ctx
  }

  getScratchPoint() {
    return this.scratchPoint
  }

  getScratchPointB() {
    return this.scratchPointB
  }

  setupEditablePolygon(polygon: fabric.Polygon) {
    const editablePolygon = polygon as EditablePolygon
    editablePolygon.editorShape = 'ground-polygon'
    this.refreshEditablePolygonControls(editablePolygon)
  }

  handleEditablePolygonPointerDown(opt: fabric.IEvent<MouseEvent>) {
    const canvas = this.ctx.getCanvas()
    if (!canvas || this.ctx.isPanning()) {
      return
    }
    const evt = opt.e
    if (!evt.shiftKey && !evt.altKey) {
      return
    }
    const activeObject = canvas.getActiveObject()
    if (!this.isEditablePolygon(activeObject)) {
      return
    }
    if (evt.shiftKey) {
      this.addEditablePolygonPoint(activeObject, evt)
      evt.preventDefault()
      evt.stopPropagation()
      return
    }
    if (evt.altKey) {
      this.removeEditablePolygonPoint(activeObject, evt)
      evt.preventDefault()
      evt.stopPropagation()
    }
  }

  isEditablePolygon(object: fabric.Object | null): object is EditablePolygon {
    return (
      object instanceof fabric.Polygon &&
      (object as EditablePolygon).editorShape === 'ground-polygon'
    )
  }

  refreshEditablePolygonControls(polygon: EditablePolygon) {
    if (!polygon.points) {
      return
    }
    const controls: Record<string, fabric.Control> = Object.create(
      null
    ) as Record<string, fabric.Control>
    const defaultControls = fabric.Object.prototype.controls
    controls.tl = defaultControls.tl
    controls.tr = defaultControls.tr
    controls.bl = defaultControls.bl
    controls.br = defaultControls.br
    controls.mtr = defaultControls.mtr
    controls.ml = defaultControls.ml
    controls.mr = defaultControls.mr
    controls.mt = defaultControls.mt
    controls.mb = defaultControls.mb
    for (let i = 0; i < polygon.points.length; i++) {
      controls[`p${i}`] = this.createPolygonControl(polygon, i)
    }
    polygon.controls = controls
    polygon.setCoords()
  }

  setEditablePolygonPointFromCanvas(
    polygon: EditablePolygon,
    canvasX: number,
    canvasY: number,
    pointIndex: number
  ) {
    if (!polygon.points) {
      return
    }
    this.setLocalPointFromCanvas(polygon, canvasX, canvasY, this.scratchPointB)
    const point = polygon.points[pointIndex]
    point.x = this.scratchPointB.x + polygon.pathOffset.x
    point.y = this.scratchPointB.y + polygon.pathOffset.y
    polygon.dirty = true
    this.updateEditablePolygonBounds(polygon)
  }

  addEditablePolygonPoint(polygon: EditablePolygon, evt: MouseEvent) {
    if (!polygon.canvas || !polygon.points) {
      return
    }
    const pointer = polygon.canvas.getPointer(evt)
    this.setLocalPointFromCanvas(
      polygon,
      pointer.x,
      pointer.y,
      this.scratchPoint
    )
    const pointX = this.scratchPoint.x + polygon.pathOffset.x
    const pointY = this.scratchPoint.y + polygon.pathOffset.y
    const insertIndex = this.findNearestEdgeProjection(
      polygon.points,
      pointX,
      pointY,
      this.scratchPointB
    )
    this.insertPolygonPoint(
      polygon.points,
      insertIndex,
      this.scratchPointB.x,
      this.scratchPointB.y
    )
    polygon.dirty = true
    this.updateEditablePolygonBounds(polygon)
    this.refreshEditablePolygonControls(polygon)
    polygon.canvas.requestRenderAll()
  }

  removeEditablePolygonPoint(polygon: EditablePolygon, evt: MouseEvent) {
    if (!polygon.points || polygon.points.length <= 3 || !polygon.canvas) {
      return
    }
    const pointer = polygon.canvas.getPointer(evt)
    this.setLocalPointFromCanvas(
      polygon,
      pointer.x,
      pointer.y,
      this.scratchPoint
    )
    const pointX = this.scratchPoint.x + polygon.pathOffset.x
    const pointY = this.scratchPoint.y + polygon.pathOffset.y
    const removeIndex = this.findNearestPointIndex(
      polygon.points,
      pointX,
      pointY
    )
    this.removePolygonPoint(polygon.points, removeIndex)
    polygon.dirty = true
    this.updateEditablePolygonBounds(polygon)
    this.refreshEditablePolygonControls(polygon)
    polygon.canvas.requestRenderAll()
  }

  updateEditablePolygonBounds(polygon: fabric.Polygon) {
    if (!polygon.points) {
      return
    }
    let minX = polygon.points[0].x
    let minY = polygon.points[0].y
    let maxX = polygon.points[0].x
    let maxY = polygon.points[0].y
    for (let i = 1; i < polygon.points.length; i++) {
      const point = polygon.points[i]
      if (point.x < minX) minX = point.x
      if (point.y < minY) minY = point.y
      if (point.x > maxX) maxX = point.x
      if (point.y > maxY) maxY = point.y
    }
    const width = maxX - minX
    const height = maxY - minY
    const oldOffsetX = polygon.pathOffset.x
    const oldOffsetY = polygon.pathOffset.y
    const newOffsetX = minX + width * 0.5
    const newOffsetY = minY + height * 0.5
    const deltaX = newOffsetX - oldOffsetX
    const deltaY = newOffsetY - oldOffsetY
    if (deltaX !== 0 || deltaY !== 0) {
      const deltaPoint = this.scratchPointC
      deltaPoint.x = deltaX
      deltaPoint.y = deltaY
      const worldDelta = fabricTransformPoint(
        deltaPoint,
        polygon.calcTransformMatrix(),
        true
      )
      polygon.left = (polygon.left ?? 0) + worldDelta.x
      polygon.top = (polygon.top ?? 0) + worldDelta.y
    }
    polygon.width = width
    polygon.height = height
    polygon.pathOffset.x = newOffsetX
    polygon.pathOffset.y = newOffsetY
    polygon.setCoords()
  }

  ensurePolygonPointsLength(polygon: fabric.Polygon, length: number) {
    if (!polygon.points) {
      polygon.points = []
    }
    while (polygon.points.length < length) {
      polygon.points.push(
        this.ctx.acquirePoint(polygon.pathOffset.x, polygon.pathOffset.y)
      )
    }
    while (polygon.points.length > length) {
      const removed = polygon.points.pop()
      if (removed) {
        this.ctx.releasePoint(removed)
      }
    }
  }

  assignPolygonPoints(
    polygon: fabric.Polygon,
    points: ReadonlyArray<readonly [number, number]>
  ) {
    if (!polygon.points) {
      polygon.points = []
    }
    this.ensurePolygonPointsLength(polygon, points.length)
    const centerX = polygon.pathOffset.x
    const centerY = polygon.pathOffset.y
    for (let i = 0; i < points.length; i++) {
      const point = polygon.points[i]
      point.x = centerX + points[i][0]
      point.y = centerY + points[i][1]
    }
  }

  setLocalPointFromCanvas(
    polygon: fabric.Polygon,
    canvasX: number,
    canvasY: number,
    out: fabric.Point
  ) {
    const transform = polygon.calcTransformMatrix()
    this.invertTransform(transform, this.inverseMatrix)
    this.applyTransform(canvasX, canvasY, this.inverseMatrix, out)
  }

  applyTransform(x: number, y: number, matrix: number[], out: fabric.Point) {
    out.x = matrix[0] * x + matrix[2] * y + matrix[4]
    out.y = matrix[1] * x + matrix[3] * y + matrix[5]
  }

  findNearestEdgeProjection(
    points: fabric.Point[],
    x: number,
    y: number,
    out: fabric.Point
  ) {
    let nearestIndex = 0
    let nearestDistance = Number.POSITIVE_INFINITY
    let nearestX = points[0].x
    let nearestY = points[0].y
    const count = points.length
    for (let i = 0; i < count; i++) {
      const nextIndex = (i + 1) % count
      const p1 = points[i]
      const p2 = points[nextIndex]
      const dist = this.projectPointToSegment(
        x,
        y,
        p1.x,
        p1.y,
        p2.x,
        p2.y,
        this.scratchPointC
      )
      if (dist < nearestDistance) {
        nearestDistance = dist
        nearestIndex = i
        nearestX = this.scratchPointC.x
        nearestY = this.scratchPointC.y
      }
    }
    out.x = nearestX
    out.y = nearestY
    return nearestIndex
  }

  findNearestPointIndex(points: fabric.Point[], x: number, y: number) {
    let nearestIndex = 0
    let nearestDistance = Number.POSITIVE_INFINITY
    for (let i = 0; i < points.length; i++) {
      const p = points[i]
      const dx = x - p.x
      const dy = y - p.y
      const dist = dx * dx + dy * dy
      if (dist < nearestDistance) {
        nearestDistance = dist
        nearestIndex = i
      }
    }
    return nearestIndex
  }

  findNearestPointIndexWithin(
    points: fabric.Point[],
    x: number,
    y: number,
    maxDistanceSq: number
  ) {
    let nearestIndex = -1
    let nearestDistance = maxDistanceSq
    for (let i = 0; i < points.length; i++) {
      const p = points[i]
      const dx = x - p.x
      const dy = y - p.y
      const dist = dx * dx + dy * dy
      if (dist < nearestDistance) {
        nearestDistance = dist
        nearestIndex = i
      }
    }
    return nearestIndex
  }

  insertPolygonPoint(
    points: fabric.Point[],
    insertIndex: number,
    x: number,
    y: number
  ) {
    const newPoint = this.ctx.acquirePoint(x, y)
    points.length += 1
    for (let i = points.length - 1; i > insertIndex + 1; i--) {
      points[i] = points[i - 1]
    }
    points[insertIndex + 1] = newPoint
  }

  removePolygonPoint(points: fabric.Point[], removeIndex: number) {
    const removed = points[removeIndex]
    for (let i = removeIndex; i < points.length - 1; i++) {
      points[i] = points[i + 1]
    }
    points.length -= 1
    this.ctx.releasePoint(removed)
  }

  multiplyTransformMatrices(a: number[], b: number[], out: number[]) {
    const a0 = a[0]
    const a1 = a[1]
    const a2 = a[2]
    const a3 = a[3]
    const a4 = a[4]
    const a5 = a[5]
    const b0 = b[0]
    const b1 = b[1]
    const b2 = b[2]
    const b3 = b[3]
    const b4 = b[4]
    const b5 = b[5]
    out[0] = a0 * b0 + a2 * b1
    out[1] = a1 * b0 + a3 * b1
    out[2] = a0 * b2 + a2 * b3
    out[3] = a1 * b2 + a3 * b3
    out[4] = a0 * b4 + a2 * b5 + a4
    out[5] = a1 * b4 + a3 * b5 + a5
  }

  private createPolygonControl(polygon: EditablePolygon, index: number) {
    const controlPoint = new fabric.Point(0, 0)
    return new fabric.Control({
      positionHandler: (_dim, _finalMatrix, fabricObject) => {
        const poly = fabricObject as EditablePolygon
        if (!poly.points || !poly.canvas) {
          return controlPoint
        }
        const point = poly.points[index]
        if (!point) {
          return controlPoint
        }
        const vpt = poly.canvas.viewportTransform
        if (!vpt) {
          controlPoint.x = point.x
          controlPoint.y = point.y
          return controlPoint
        }
        this.multiplyTransformMatrices(
          vpt,
          poly.calcTransformMatrix(),
          this.controlMatrix
        )
        this.applyTransform(
          point.x - poly.pathOffset.x,
          point.y - poly.pathOffset.y,
          this.controlMatrix,
          controlPoint
        )
        return controlPoint
      },
      actionHandler: (eventData, transform) => {
        const poly = transform.target as EditablePolygon
        if (!poly.canvas || !poly.points) {
          return false
        }
        const pointer = poly.canvas.getPointer(eventData)
        this.setEditablePolygonPointFromCanvas(
          poly,
          pointer.x,
          pointer.y,
          index
        )
        poly.dirty = true
        poly.canvas.requestRenderAll()
        return true
      },
      render: fabricControlsUtils.renderCircleControl,
      cursorStyle: 'pointer',
      sizeX: 10,
      sizeY: 10,
      withConnection: false,
    })
  }

  private invertTransform(source: number[], out: number[]) {
    const a = source[0]
    const b = source[1]
    const c = source[2]
    const d = source[3]
    const e = source[4]
    const f = source[5]
    const det = a * d - b * c
    if (!det) {
      out[0] = 1
      out[1] = 0
      out[2] = 0
      out[3] = 1
      out[4] = 0
      out[5] = 0
      return
    }
    const invDet = 1 / det
    out[0] = d * invDet
    out[1] = -b * invDet
    out[2] = -c * invDet
    out[3] = a * invDet
    out[4] = (c * f - d * e) * invDet
    out[5] = (b * e - a * f) * invDet
  }

  private projectPointToSegment(
    px: number,
    py: number,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    out: fabric.Point
  ) {
    const vx = x2 - x1
    const vy = y2 - y1
    const wx = px - x1
    const wy = py - y1
    const c1 = vx * wx + vy * wy
    if (c1 <= 0) {
      out.x = x1
      out.y = y1
      return wx * wx + wy * wy
    }
    const c2 = vx * vx + vy * vy
    if (c2 <= c1) {
      const dx = px - x2
      const dy = py - y2
      out.x = x2
      out.y = y2
      return dx * dx + dy * dy
    }
    const t = c1 / c2
    const projX = x1 + t * vx
    const projY = y1 + t * vy
    out.x = projX
    out.y = projY
    const dx = px - projX
    const dy = py - projY
    return dx * dx + dy * dy
  }
}
