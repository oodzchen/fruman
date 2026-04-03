import type { MapPlacedShape } from '../editorMapTypes'
import { getDefaultShapeRenderLayer, isRenderLayerMatch } from '../renderLayers'

export class ShapeRenderer {
  static drawShapes(
    ctx: CanvasRenderingContext2D,
    shapes: MapPlacedShape[],
    objectKind: 'ground' | 'obstacle',
    pixelsPerMeter: number,
    options: {
      fillStyle: string | CanvasPattern
      strokeStyle?: string
      lineWidth?: number
      drawStroke?: boolean
      renderLayer?: number
    }
  ): void {
    ctx.fillStyle = options.fillStyle
    if (options.strokeStyle) {
      ctx.strokeStyle = options.strokeStyle
    }
    if (options.lineWidth !== undefined) {
      ctx.lineWidth = options.lineWidth
    }

    for (let i = 0; i < shapes.length; i++) {
      const placedShape = shapes[i]
      if (placedShape.objectKind !== objectKind) {
        continue
      }
      if (
        options.renderLayer !== undefined &&
        !isRenderLayerMatch(
          placedShape.renderLayer,
          options.renderLayer,
          getDefaultShapeRenderLayer()
        )
      ) {
        continue
      }

      const shape = placedShape.shape
      if (shape.kind === 'rect') {
        this.drawRect(ctx, shape, pixelsPerMeter, options.drawStroke)
      } else if (shape.kind === 'circle') {
        this.drawCircle(ctx, shape, pixelsPerMeter, options.drawStroke)
      } else if (shape.kind === 'polygon') {
        this.drawPolygon(ctx, shape, pixelsPerMeter, options.drawStroke)
      }
    }
  }

  private static drawRect(
    ctx: CanvasRenderingContext2D,
    shape: {
      center: { x: number; y: number }
      halfWidth: number
      halfHeight: number
      rotationRad: number
    },
    pixelsPerMeter: number,
    drawStroke?: boolean
  ): void {
    const centerX = shape.center.x
    const centerY = shape.center.y
    const halfWidth = shape.halfWidth
    const halfHeight = shape.halfHeight
    const rotation = shape.rotationRad

    ctx.save()
    ctx.translate(centerX * pixelsPerMeter, centerY * pixelsPerMeter)
    ctx.rotate(rotation)
    ctx.fillRect(
      -halfWidth * pixelsPerMeter,
      -halfHeight * pixelsPerMeter,
      halfWidth * 2 * pixelsPerMeter,
      halfHeight * 2 * pixelsPerMeter
    )
    if (drawStroke) {
      ctx.strokeRect(
        -halfWidth * pixelsPerMeter,
        -halfHeight * pixelsPerMeter,
        halfWidth * 2 * pixelsPerMeter,
        halfHeight * 2 * pixelsPerMeter
      )
    }
    ctx.restore()
  }

  private static drawCircle(
    ctx: CanvasRenderingContext2D,
    shape: { center: { x: number; y: number }; radius: number },
    pixelsPerMeter: number,
    drawStroke?: boolean
  ): void {
    const centerX = shape.center.x
    const centerY = shape.center.y
    const radius = shape.radius

    ctx.beginPath()
    ctx.arc(
      centerX * pixelsPerMeter,
      centerY * pixelsPerMeter,
      radius * pixelsPerMeter,
      0,
      Math.PI * 2
    )
    ctx.fill()
    if (drawStroke) {
      ctx.stroke()
    }
  }

  private static drawPolygon(
    ctx: CanvasRenderingContext2D,
    shape: { points: number[] },
    pixelsPerMeter: number,
    drawStroke?: boolean
  ): void {
    const points = shape.points

    if (points.length < 6) {
      return
    }

    ctx.beginPath()
    for (let j = 0; j < points.length; j += 2) {
      const x = points[j]
      const y = points[j + 1]
      const px = x * pixelsPerMeter
      const py = y * pixelsPerMeter
      if (j === 0) {
        ctx.moveTo(px, py)
      } else {
        ctx.lineTo(px, py)
      }
    }
    ctx.closePath()
    ctx.fill()
    if (drawStroke) {
      ctx.stroke()
    }
  }
}
