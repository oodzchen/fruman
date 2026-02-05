import { fabric } from 'fabric'

import {
  GROUND_CIRCLE_OPTIONS,
  GROUND_EDITABLE_POLYGON_OPTIONS,
  GROUND_RECT_OPTIONS,
  GROUND_TRIANGLE_OPTIONS,
  OBSTACLE_CIRCLE_OPTIONS,
  OBSTACLE_EDITABLE_POLYGON_OPTIONS,
  OBSTACLE_RECT_OPTIONS,
  OBSTACLE_TRIANGLE_OPTIONS,
  POLYGON_POINT_DATA,
  TRIANGLE_POINT_DATA,
  createEditablePolygonPoints,
  createTrianglePoints,
} from './EditorConstants'
import type {
  EditablePolygon,
  EditorPolygonEditor,
} from './EditorPolygonEditor'
import type { GroundShapeType, ObjectType } from './types'
import type { ShapeResetData } from './types'

interface EditorShapeManagerContext {
  polygonEditor: EditorPolygonEditor
  isEditablePolygon: (obj: fabric.Object) => obj is EditablePolygon
  getCanvas: () => fabric.Canvas | null
  getViewportCenter: () => { x: number; y: number }
  applyGroundPatternToObject: (obj: fabric.Object) => void
  applyObstaclePatternToObject: (obj: fabric.Object) => void
  registerEditorObject: (type: ObjectType, object: fabric.Object) => void
  handleCanvasSelection: (object: fabric.Object) => void
}

export class EditorShapeManager {
  private ctx: EditorShapeManagerContext
  private shapeResetMap = new Map<fabric.Object, ShapeResetData>()

  constructor(ctx: EditorShapeManagerContext) {
    this.ctx = ctx
  }

  createGroundShape(
    shape: GroundShapeType,
    centerX?: number,
    centerY?: number
  ) {
    this.createShape(shape, 'ground', centerX, centerY)
  }

  createObstacleShape(
    shape: GroundShapeType,
    centerX?: number,
    centerY?: number
  ) {
    this.createShape(shape, 'obstacle', centerX, centerY)
  }

  private createShape(
    shape: GroundShapeType,
    type: 'ground' | 'obstacle',
    centerX?: number,
    centerY?: number
  ) {
    const canvas = this.ctx.getCanvas()
    if (!canvas) {
      // console.warn('[shape-manager] Fabric canvas not ready')
      return
    }

    const center = this.ctx.getViewportCenter()
    const resolvedX = centerX ?? center.x
    const resolvedY = centerY ?? center.y
    let shapeObject: fabric.Object | null = null

    const isGround = type === 'ground'
    const rectOptions = isGround ? GROUND_RECT_OPTIONS : OBSTACLE_RECT_OPTIONS
    const circleOptions = isGround
      ? GROUND_CIRCLE_OPTIONS
      : OBSTACLE_CIRCLE_OPTIONS
    const triangleOptions = isGround
      ? GROUND_TRIANGLE_OPTIONS
      : OBSTACLE_TRIANGLE_OPTIONS
    const polygonOptions = isGround
      ? GROUND_EDITABLE_POLYGON_OPTIONS
      : OBSTACLE_EDITABLE_POLYGON_OPTIONS

    // Hardcoded ObjectType values
    const ObjectTypeGround = 'ground' as ObjectType
    const ObjectTypeObstacle = 'obstacle' as ObjectType
    const objectType = isGround ? ObjectTypeGround : ObjectTypeObstacle

    switch (shape) {
      case 'rect':
        shapeObject = new fabric.Rect(rectOptions)
        this.registerShapeResetData(shapeObject, {
          kind: 'rect',
          width: rectOptions.width ?? 0,
          height: rectOptions.height ?? 0,
        })
        break
      case 'circle':
        shapeObject = new fabric.Circle(circleOptions)
        this.registerShapeResetData(shapeObject, {
          kind: 'circle',
          radius: circleOptions.radius ?? 0,
        })
        break
      case 'triangle':
        shapeObject = new fabric.Polygon(
          createTrianglePoints(),
          triangleOptions
        )
        this.registerShapeResetData(shapeObject, {
          kind: 'triangle',
          points: TRIANGLE_POINT_DATA,
        })
        break
      case 'polygon': {
        const polygon = new fabric.Polygon(
          createEditablePolygonPoints(),
          polygonOptions
        )
        this.ctx.polygonEditor.setupEditablePolygon(polygon)
        this.registerShapeResetData(polygon, {
          kind: 'polygon',
          points: POLYGON_POINT_DATA,
        })
        shapeObject = polygon
        break
      }
      default:
        break
    }

    if (!shapeObject) {
      // console.warn('[shape-manager] shape object not created', shape)
      return
    }

    if (isGround) {
      this.ctx.applyGroundPatternToObject(shapeObject)
    } else {
      this.ctx.applyObstaclePatternToObject(shapeObject)
    }

    shapeObject.left = resolvedX
    shapeObject.top = resolvedY
    shapeObject.setCoords()
    canvas.add(shapeObject)
    this.ctx.registerEditorObject(objectType, shapeObject)
    canvas.setActiveObject(shapeObject)
    this.ctx.handleCanvasSelection(shapeObject)
    canvas.renderAll()
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
