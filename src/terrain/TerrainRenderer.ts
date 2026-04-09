import { Graphics } from 'pixi.js'

import {
  getDefaultTerrainRenderLayer,
  isRenderLayerMatch,
} from '../renderLayers'
import type { TerrainResolvedLayerView } from './TerrainDataUtils'
import { getTerrainLayerViews } from './TerrainDataUtils'
import {
  appendTerrainCellPath,
  getTerrainPaletteIndex,
} from './TerrainGeometry'
import { getTerrainMaterialByCode } from './TerrainMaterialRegistry'
import type { TerrainDataLike } from './TerrainTypes'
import { getVoronoiLayerBuild } from './VoronoiBuilder'

export interface TerrainDrawOptions {
  drawStroke?: boolean
  renderLayer?: number
  shouldDrawLayer?: (layer: TerrainResolvedLayerView) => boolean
  getLayerPixelOffset?: (
    layer: TerrainResolvedLayerView
  ) => { x: number; y: number } | null
}

interface TerrainVisibleCellBounds {
  minCellX: number
  minCellY: number
  maxCellX: number
  maxCellY: number
}

export class TerrainRenderer {
  static createPixiTerrainGraphics(
    terrain: TerrainDataLike,
    cellSizeUnits: number,
    options: TerrainDrawOptions = {}
  ): Graphics[] {
    const chunkSize = terrain.chunkSize
    if (chunkSize <= 0) {
      return []
    }

    const result: Graphics[] = []
    const drawStroke = options.drawStroke === true
    const targetLayer = options.renderLayer
    const shouldDrawLayer = options.shouldDrawLayer
    const getLayerPixelOffset = options.getLayerPixelOffset
    const layers = getTerrainLayerViews(terrain)

    for (let layerIndex = 0; layerIndex < layers.length; layerIndex++) {
      const layer = layers[layerIndex]
      const resolvedLayer =
        layer.renderLayer !== undefined
          ? layer.renderLayer
          : layer.materialId
            ? getDefaultTerrainRenderLayer(layer.materialId)
            : 0
      if (
        targetLayer !== undefined &&
        !isRenderLayerMatch(layer.renderLayer, targetLayer, resolvedLayer)
      ) {
        continue
      }
      if (shouldDrawLayer && !shouldDrawLayer(layer)) {
        continue
      }

      const layerPixelOffset = getLayerPixelOffset?.(layer)
      const offsetX =
        layer.version >= 4
          ? (layerPixelOffset?.x ?? 0)
          : layer.offsetCellX * cellSizeUnits + (layerPixelOffset?.x ?? 0)
      const offsetY =
        layer.version >= 4
          ? (layerPixelOffset?.y ?? 0)
          : layer.offsetCellY * cellSizeUnits + (layerPixelOffset?.y ?? 0)
      const zIndex = resolvedLayer * 10
      const fillGraphics = new Map<string, Graphics>()
      const strokeGraphics = drawStroke ? new Map<string, Graphics>() : null

      const getFillGraphics = (color: string): Graphics => {
        const cached = fillGraphics.get(color)
        if (cached) {
          return cached
        }
        const graphics = new Graphics()
        graphics.position.set(offsetX, offsetY)
        graphics.zIndex = zIndex
        fillGraphics.set(color, graphics)
        result.push(graphics)
        return graphics
      }

      const getStrokeGraphics = (color: string): Graphics => {
        if (!strokeGraphics) {
          return getFillGraphics(color)
        }
        const cached = strokeGraphics.get(color)
        if (cached) {
          return cached
        }
        const graphics = new Graphics()
        graphics.position.set(offsetX, offsetY)
        graphics.zIndex = zIndex
        strokeGraphics.set(color, graphics)
        result.push(graphics)
        return graphics
      }

      if (layer.version >= 4) {
        this.appendVoronoiPixiLayer(
          result,
          layer,
          cellSizeUnits,
          drawStroke,
          getFillGraphics,
          getStrokeGraphics
        )
      } else {
        this.appendGridPixiLayer(
          result,
          layer,
          chunkSize,
          cellSizeUnits,
          drawStroke,
          getFillGraphics,
          getStrokeGraphics
        )
      }
    }

    return result
  }

  static drawTerrain(
    ctx: CanvasRenderingContext2D,
    terrain: TerrainDataLike,
    cellSizeUnits: number,
    options: TerrainDrawOptions = {}
  ): void {
    const chunkSize = terrain.chunkSize
    if (chunkSize <= 0) {
      return
    }

    const drawStroke = options.drawStroke === true
    const targetLayer = options.renderLayer
    const shouldDrawLayer = options.shouldDrawLayer
    const getLayerPixelOffset = options.getLayerPixelOffset
    const layers = getTerrainLayerViews(terrain)
    for (let layerIndex = 0; layerIndex < layers.length; layerIndex++) {
      const layer = layers[layerIndex]
      if (
        targetLayer !== undefined &&
        !isRenderLayerMatch(
          layer.renderLayer,
          targetLayer,
          layer.materialId ? getDefaultTerrainRenderLayer(layer.materialId) : 0
        )
      ) {
        continue
      }
      if (shouldDrawLayer && !shouldDrawLayer(layer)) {
        continue
      }
      const layerPixelOffset = getLayerPixelOffset?.(layer)
      if (layer.version >= 4) {
        ctx.save()
        if (layerPixelOffset) {
          ctx.translate(layerPixelOffset.x, layerPixelOffset.y)
        }
        this.drawSingleLayer(ctx, layer, chunkSize, cellSizeUnits, drawStroke)
        ctx.restore()
      } else {
        ctx.save()
        ctx.translate(
          layer.offsetCellX * cellSizeUnits + (layerPixelOffset?.x ?? 0),
          layer.offsetCellY * cellSizeUnits + (layerPixelOffset?.y ?? 0)
        )
        this.drawSingleLayer(ctx, layer, chunkSize, cellSizeUnits, drawStroke)
        ctx.restore()
      }
    }
  }

  private static drawSingleLayer(
    ctx: CanvasRenderingContext2D,
    terrain: TerrainDataLike,
    chunkSize: number,
    cellSizeUnits: number,
    drawStroke: boolean
  ): void {
    if (terrain.chunks.length === 0) {
      return
    }
    if (terrain.version >= 4) {
      this.drawVoronoiLayer(ctx, terrain, cellSizeUnits, drawStroke)
      return
    }
    const randomSeed = terrain.randomSeed | 0
    const visibleBounds = this.getVisibleCellBounds(ctx, cellSizeUnits)
    for (let chunkIndex = 0; chunkIndex < terrain.chunks.length; chunkIndex++) {
      const chunk = terrain.chunks[chunkIndex]
      const chunkBaseX = chunk.chunkX * chunkSize
      const chunkBaseY = chunk.chunkY * chunkSize
      if (
        visibleBounds &&
        (chunkBaseX > visibleBounds.maxCellX ||
          chunkBaseY > visibleBounds.maxCellY ||
          chunkBaseX + chunkSize - 1 < visibleBounds.minCellX ||
          chunkBaseY + chunkSize - 1 < visibleBounds.minCellY)
      ) {
        continue
      }
      const cells = chunk.cells
      const localStartX = visibleBounds
        ? Math.max(0, visibleBounds.minCellX - chunkBaseX)
        : 0
      const localEndX = visibleBounds
        ? Math.min(chunkSize - 1, visibleBounds.maxCellX - chunkBaseX)
        : chunkSize - 1
      const localStartY = visibleBounds
        ? Math.max(0, visibleBounds.minCellY - chunkBaseY)
        : 0
      const localEndY = visibleBounds
        ? Math.min(chunkSize - 1, visibleBounds.maxCellY - chunkBaseY)
        : chunkSize - 1
      for (let localY = localStartY; localY <= localEndY; localY++) {
        const rowOffset = localY * chunkSize
        for (let localX = localStartX; localX <= localEndX; localX++) {
          const cellIndex = rowOffset + localX
          const materialCode = cells[cellIndex] | 0
          if (materialCode <= 0) {
            continue
          }
          const material = getTerrainMaterialByCode(materialCode)
          if (!material) {
            continue
          }
          const cellX = chunkBaseX + localX
          const cellY = chunkBaseY + localY
          const paletteIndex = getTerrainPaletteIndex(
            randomSeed,
            cellX,
            cellY,
            materialCode,
            material.fillPalette.length
          )
          ctx.beginPath()
          appendTerrainCellPath(ctx, cellX, cellY, cellSizeUnits, randomSeed)
          ctx.fillStyle = material.fillPalette[paletteIndex]
          ctx.fill()
          if (drawStroke) {
            ctx.strokeStyle = material.strokeColor
            ctx.stroke()
          }
        }
      }
    }
  }

  private static drawVoronoiLayer(
    ctx: CanvasRenderingContext2D,
    terrain: TerrainDataLike,
    cellSizeUnits: number,
    drawStroke: boolean
  ): void {
    const randomSeed = terrain.randomSeed | 0
    const visibleBounds = this.getVisibleCellBounds(ctx, cellSizeUnits)
    const build = getVoronoiLayerBuild(
      terrain as TerrainResolvedLayerView,
      cellSizeUnits
    )
    for (let cellIndex = 0; cellIndex < build.cells.length; cellIndex++) {
      const cell = build.cells[cellIndex]
      if (
        visibleBounds &&
        (cell.minCellX > visibleBounds.maxCellX ||
          cell.minCellY > visibleBounds.maxCellY ||
          cell.maxCellX < visibleBounds.minCellX ||
          cell.maxCellY < visibleBounds.minCellY)
      ) {
        continue
      }
      const material = getTerrainMaterialByCode(cell.materialCode)
      if (!material) {
        continue
      }
      const paletteIndex = getTerrainPaletteIndex(
        randomSeed,
        cell.localCellX,
        cell.localCellY,
        cell.materialCode,
        material.fillPalette.length
      )
      const points = cell.points
      if (points.length < 6) {
        continue
      }
      ctx.beginPath()
      ctx.moveTo(points[0], points[1])
      for (let pointIndex = 2; pointIndex < points.length; pointIndex += 2) {
        ctx.lineTo(points[pointIndex], points[pointIndex + 1])
      }
      ctx.closePath()
      ctx.fillStyle = material.fillPalette[paletteIndex]
      ctx.fill()
      if (drawStroke) {
        ctx.strokeStyle = material.strokeColor
        ctx.stroke()
      }
    }
  }

  private static appendGridPixiLayer(
    _result: Graphics[],
    terrain: TerrainDataLike,
    chunkSize: number,
    cellSizeUnits: number,
    drawStroke: boolean,
    getFillGraphics: (color: string) => Graphics,
    getStrokeGraphics: (color: string) => Graphics
  ): void {
    const randomSeed = terrain.randomSeed | 0
    for (let chunkIndex = 0; chunkIndex < terrain.chunks.length; chunkIndex++) {
      const chunk = terrain.chunks[chunkIndex]
      const chunkBaseX = chunk.chunkX * chunkSize
      const chunkBaseY = chunk.chunkY * chunkSize
      const cells = chunk.cells
      for (let localY = 0; localY < chunkSize; localY++) {
        const rowOffset = localY * chunkSize
        for (let localX = 0; localX < chunkSize; localX++) {
          const cellIndex = rowOffset + localX
          const materialCode = cells[cellIndex] | 0
          if (materialCode <= 0) {
            continue
          }
          const material = getTerrainMaterialByCode(materialCode)
          if (!material) {
            continue
          }
          const cellX = chunkBaseX + localX
          const cellY = chunkBaseY + localY
          const paletteIndex = getTerrainPaletteIndex(
            randomSeed,
            cellX,
            cellY,
            materialCode,
            material.fillPalette.length
          )
          const fillGraphics = getFillGraphics(
            material.fillPalette[paletteIndex]
          )
          appendTerrainCellPath(
            fillGraphics,
            cellX,
            cellY,
            cellSizeUnits,
            randomSeed
          )
          fillGraphics.fill(material.fillPalette[paletteIndex])
          if (drawStroke) {
            const strokeGraphics = getStrokeGraphics(material.strokeColor)
            appendTerrainCellPath(
              strokeGraphics,
              cellX,
              cellY,
              cellSizeUnits,
              randomSeed
            )
            strokeGraphics.stroke({ color: material.strokeColor, width: 1 })
          }
        }
      }
    }
  }

  private static appendVoronoiPixiLayer(
    _result: Graphics[],
    terrain: TerrainDataLike,
    cellSizeUnits: number,
    drawStroke: boolean,
    getFillGraphics: (color: string) => Graphics,
    getStrokeGraphics: (color: string) => Graphics
  ): void {
    const randomSeed = terrain.randomSeed | 0
    const build = getVoronoiLayerBuild(
      terrain as TerrainResolvedLayerView,
      cellSizeUnits
    )
    for (let cellIndex = 0; cellIndex < build.cells.length; cellIndex++) {
      const cell = build.cells[cellIndex]
      const material = getTerrainMaterialByCode(cell.materialCode)
      if (!material) {
        continue
      }
      const paletteIndex = getTerrainPaletteIndex(
        randomSeed,
        cell.localCellX,
        cell.localCellY,
        cell.materialCode,
        material.fillPalette.length
      )
      const points = cell.points
      if (points.length < 6) {
        continue
      }
      const fillColor = material.fillPalette[paletteIndex]
      const fillGraphics = getFillGraphics(fillColor)
      fillGraphics.moveTo(points[0], points[1])
      for (let pointIndex = 2; pointIndex < points.length; pointIndex += 2) {
        fillGraphics.lineTo(points[pointIndex], points[pointIndex + 1])
      }
      fillGraphics.closePath()
      fillGraphics.fill(fillColor)

      if (drawStroke) {
        const strokeGraphics = getStrokeGraphics(material.strokeColor)
        strokeGraphics.moveTo(points[0], points[1])
        for (let pointIndex = 2; pointIndex < points.length; pointIndex += 2) {
          strokeGraphics.lineTo(points[pointIndex], points[pointIndex + 1])
        }
        strokeGraphics.closePath()
        strokeGraphics.stroke({ color: material.strokeColor, width: 1 })
      }
    }
  }

  private static getVisibleCellBounds(
    ctx: CanvasRenderingContext2D,
    cellSizeUnits: number
  ): TerrainVisibleCellBounds | null {
    if (!(cellSizeUnits > 0)) {
      return null
    }
    const transform = ctx.getTransform()
    const determinant = transform.a * transform.d - transform.b * transform.c
    if (Math.abs(determinant) < 0.000001) {
      return null
    }

    const invA = transform.d / determinant
    const invB = -transform.b / determinant
    const invC = -transform.c / determinant
    const invD = transform.a / determinant
    const invE =
      (transform.c * transform.f - transform.d * transform.e) / determinant
    const invF =
      (transform.b * transform.e - transform.a * transform.f) / determinant

    const width = ctx.canvas.width
    const height = ctx.canvas.height
    const x0 = invE
    const y0 = invF
    const x1 = invA * width + invE
    const y1 = invB * width + invF
    const x2 = invC * height + invE
    const y2 = invD * height + invF
    const x3 = invA * width + invC * height + invE
    const y3 = invB * width + invD * height + invF

    const minX = Math.min(x0, x1, x2, x3)
    const maxX = Math.max(x0, x1, x2, x3)
    const minY = Math.min(y0, y1, y2, y3)
    const maxY = Math.max(y0, y1, y2, y3)
    const padding = 1

    return {
      minCellX: Math.floor(minX / cellSizeUnits) - padding,
      minCellY: Math.floor(minY / cellSizeUnits) - padding,
      maxCellX: Math.ceil(maxX / cellSizeUnits) + padding,
      maxCellY: Math.ceil(maxY / cellSizeUnits) + padding,
    }
  }
}
