import { fabric } from 'fabric'

import type {
  EditablePolygon,
  EditorPolygonEditor,
} from './EditorPolygonEditor'
import type { ShapeResetData } from './types'

interface EditorShapeManagerContext {
  polygonEditor: EditorPolygonEditor
  isEditablePolygon: (obj: fabric.Object) => obj is EditablePolygon
}

export class EditorShapeManager {
  private ctx: EditorShapeManagerContext
  private shapeResetMap = new Map<fabric.Object, ShapeResetData>()

  constructor(ctx: EditorShapeManagerContext) {
    this.ctx = ctx
  }

  registerShapeResetData(object: fabric.Object, data: ShapeResetData) {
    this.shapeResetMap.set(object, data)
  }

  getShapeResetData(object: fabric.Object): ShapeResetData | undefined {
    return this.shapeResetMap.get(object)
  }

  deleteShapeResetData(object: fabric.Object) {
    this.shapeResetMap.delete(object)
  }

  clearAllShapeResetData() {
    this.shapeResetMap.clear()
  }

  resetShape(target: fabric.Object) {
    const data = this.shapeResetMap.get(target)
    if (!data) {
      return
    }
    if (data.kind === 'rect' && target.type === 'rect') {
      const rect = target as fabric.Rect
      rect.width = data.width
      rect.height = data.height
      rect.scaleX = 1
      rect.scaleY = 1
      rect.setCoords()
      return
    }
    if (data.kind === 'circle' && target.type === 'circle') {
      const circle = target as fabric.Circle
      circle.radius = data.radius
      circle.scaleX = 1
      circle.scaleY = 1
      circle.setCoords()
      return
    }
    if (
      (data.kind === 'polygon' || data.kind === 'triangle') &&
      target.type === 'polygon'
    ) {
      const polygon = target as fabric.Polygon
      this.ctx.polygonEditor.assignPolygonPoints(polygon, data.points)
      polygon.scaleX = 1
      polygon.scaleY = 1
      this.ctx.polygonEditor.updateEditablePolygonBounds(
        polygon as EditablePolygon
      )
      if (this.ctx.isEditablePolygon(polygon)) {
        this.ctx.polygonEditor.refreshEditablePolygonControls(polygon)
      }
    }
  }

  makeSquare(target: fabric.Object) {
    if (target.type !== 'rect') {
      return
    }
    const rect = target as fabric.Rect
    const width = (rect.width ?? 0) * (rect.scaleX ?? 1)
    const height = (rect.height ?? 0) * (rect.scaleY ?? 1)
    const size = Math.max(width, height)
    rect.width = size
    rect.height = size
    rect.scaleX = 1
    rect.scaleY = 1
    rect.setCoords()
  }

  makeEquilateralTriangle(target: fabric.Object) {
    if (target.type !== 'polygon') {
      return
    }
    const polygon = target as fabric.Polygon
    const data = this.shapeResetMap.get(polygon)
    if (!data || data.kind !== 'triangle') {
      return
    }
    const width = (polygon.width ?? 0) * (polygon.scaleX ?? 1)
    const height = (polygon.height ?? 0) * (polygon.scaleY ?? 1)
    const size = Math.max(width, (2 / Math.sqrt(3)) * height)
    const halfSide = size * 0.5
    const triHeight = size * Math.sqrt(3) * 0.5
    const centerX = polygon.pathOffset.x
    const centerY = polygon.pathOffset.y
    this.ctx.polygonEditor.ensurePolygonPointsLength(polygon, 3)
    const p0 = polygon.points![0]
    const p1 = polygon.points![1]
    const p2 = polygon.points![2]
    p0.x = centerX - halfSide
    p0.y = centerY + triHeight / 3
    p1.x = centerX + halfSide
    p1.y = centerY + triHeight / 3
    p2.x = centerX
    p2.y = centerY - (2 * triHeight) / 3
    polygon.scaleX = 1
    polygon.scaleY = 1
    this.ctx.polygonEditor.updateEditablePolygonBounds(
      polygon as EditablePolygon
    )
    if (this.ctx.isEditablePolygon(polygon)) {
      this.ctx.polygonEditor.refreshEditablePolygonControls(polygon)
    }
  }
}
