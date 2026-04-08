import { type FillInput, Graphics } from 'pixi.js'

import type { MapPlacedShape } from '../editorMapTypes'
import {
  getDefaultShapeRenderLayer,
  isRenderLayerMatch,
  normalizeRenderLayer,
} from '../renderLayers'
import type { RenderContext2D } from './RenderContext2D'

export class ShapeRenderer {
  static drawShapes(
    ctx: RenderContext2D,
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
    ctx: RenderContext2D,
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
    ctx: RenderContext2D,
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
    ctx: RenderContext2D,
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

  static createPixiShapeGraphics(
    shapes: MapPlacedShape[],
    objectKind: 'ground' | 'obstacle',
    pixelsPerMeter: number,
    options: {
      fill: FillInput
      strokeColor?: string
      strokeWidth?: number
      drawStroke?: boolean
    }
  ): Graphics[] {
    const result: Graphics[] = []
    const layerMap = new Map<number, Graphics>()

    for (let i = 0; i < shapes.length; i++) {
      const placedShape = shapes[i]
      if (placedShape.objectKind !== objectKind) {
        continue
      }

      const layer = normalizeRenderLayer(
        placedShape.renderLayer,
        getDefaultShapeRenderLayer()
      )

      let g = layerMap.get(layer)
      if (!g) {
        g = new Graphics()
        g.zIndex = layer * 10 + (objectKind === 'obstacle' ? 1 : 0)
        layerMap.set(layer, g)
        result.push(g)
      }

      const shape = placedShape.shape
      if (shape.kind === 'rect') {
        this.drawPixiRect(g, shape, pixelsPerMeter, options)
      } else if (shape.kind === 'circle') {
        this.drawPixiCircle(g, shape, pixelsPerMeter, options)
      } else if (shape.kind === 'polygon') {
        this.drawPixiPolygon(g, shape, pixelsPerMeter, options)
      }
    }

    return result
  }

  private static drawPixiRect(
    g: Graphics,
    shape: {
      center: { x: number; y: number }
      halfWidth: number
      halfHeight: number
      rotationRad: number
    },
    pixelsPerMeter: number,
    options: {
      fill: FillInput
      strokeColor?: string
      strokeWidth?: number
      drawStroke?: boolean
    }
  ): void {
    const cx = shape.center.x * pixelsPerMeter
    const cy = shape.center.y * pixelsPerMeter
    const hw = shape.halfWidth * pixelsPerMeter
    const hh = shape.halfHeight * pixelsPerMeter
    const rotation = shape.rotationRad

    if (rotation === 0) {
      g.rect(cx - hw, cy - hh, hw * 2, hh * 2)
    } else {
      const cos = Math.cos(rotation)
      const sin = Math.sin(rotation)
      g.poly(
        [
          cx + -hw * cos - -hh * sin,
          cy + -hw * sin + -hh * cos,
          cx + hw * cos - -hh * sin,
          cy + hw * sin + -hh * cos,
          cx + hw * cos - hh * sin,
          cy + hw * sin + hh * cos,
          cx + -hw * cos - hh * sin,
          cy + -hw * sin + hh * cos,
        ],
        true
      )
    }
    g.fill(options.fill)
    if (options.drawStroke && options.strokeColor) {
      g.stroke({ color: options.strokeColor, width: options.strokeWidth ?? 2 })
    }
  }

  private static drawPixiCircle(
    g: Graphics,
    shape: { center: { x: number; y: number }; radius: number },
    pixelsPerMeter: number,
    options: {
      fill: FillInput
      strokeColor?: string
      strokeWidth?: number
      drawStroke?: boolean
    }
  ): void {
    const cx = shape.center.x * pixelsPerMeter
    const cy = shape.center.y * pixelsPerMeter
    const r = shape.radius * pixelsPerMeter

    g.circle(cx, cy, r)
    g.fill(options.fill)
    if (options.drawStroke && options.strokeColor) {
      g.stroke({ color: options.strokeColor, width: options.strokeWidth ?? 2 })
    }
  }

  private static drawPixiPolygon(
    g: Graphics,
    shape: { points: number[] },
    pixelsPerMeter: number,
    options: {
      fill: FillInput
      strokeColor?: string
      strokeWidth?: number
      drawStroke?: boolean
    }
  ): void {
    const points = shape.points
    if (points.length < 6) {
      return
    }

    const scaled: number[] = []
    for (let j = 0; j < points.length; j += 2) {
      scaled.push(points[j] * pixelsPerMeter, points[j + 1] * pixelsPerMeter)
    }
    g.poly(scaled, true)
    g.fill(options.fill)
    if (options.drawStroke && options.strokeColor) {
      g.stroke({ color: options.strokeColor, width: options.strokeWidth ?? 2 })
    }
  }
}
