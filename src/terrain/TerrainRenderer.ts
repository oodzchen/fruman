import { Container, Sprite, Texture } from 'pixi.js'

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
  clipVoronoiContoursOnCanvas?: boolean
}

export interface TerrainLayerDrawOptions {
  drawStroke?: boolean
  layerPixelOffset?: { x: number; y: number } | null
  clipVoronoiContoursOnCanvas?: boolean
}

interface TerrainVisibleCellBounds {
  minCellX: number
  minCellY: number
  maxCellX: number
  maxCellY: number
}

interface TerrainPixelBounds {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

export class TerrainRenderer {
  private static readonly TERRAIN_SPRITE_PADDING_PX = 4

  static createPixiTerrainGraphics(
    terrain: TerrainDataLike,
    cellSizeUnits: number,
    options: TerrainDrawOptions = {}
  ): Container[] {
    if (terrain.chunkSize <= 0) {
      return []
    }

    const result: Container[] = []
    const targetLayer = options.renderLayer
    const shouldDrawLayer = options.shouldDrawLayer
    const getLayerPixelOffset = options.getLayerPixelOffset
    const layers = getTerrainLayerViews(terrain)

    for (let layerIndex = 0; layerIndex < layers.length; layerIndex++) {
      const layer = layers[layerIndex]
      const resolvedLayer = this.getResolvedRenderLayer(layer)
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
      const sprite = this.createPixiTerrainLayerGraphic(layer, cellSizeUnits, {
        drawStroke: options.drawStroke,
        layerPixelOffset,
        clipVoronoiContoursOnCanvas: options.clipVoronoiContoursOnCanvas,
      })
      if (!sprite) {
        continue
      }
      sprite.zIndex = resolvedLayer * 10
      result.push(sprite)
    }

    return result
  }

  static createPixiTerrainLayerGraphic(
    layer: TerrainResolvedLayerView,
    cellSizeUnits: number,
    options: TerrainLayerDrawOptions = {}
  ): Sprite | null {
    const bounds = this.getLayerPixelBounds(
      layer,
      cellSizeUnits,
      options.layerPixelOffset
    )
    if (!bounds) {
      return null
    }
    const width = Math.max(1, bounds.maxX - bounds.minX)
    const height = Math.max(1, bounds.maxY - bounds.minY)
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      return null
    }
    ctx.translate(-bounds.minX, -bounds.minY)
    this.drawLayerView(ctx, layer, cellSizeUnits, options)
    const sprite = new Sprite(Texture.from(canvas))
    sprite.x = bounds.minX
    sprite.y = bounds.minY
    return sprite
  }

  static createPixiTerrainChunkGraphic(
    layer: TerrainResolvedLayerView,
    chunkIndex: number,
    cellSizeUnits: number,
    options: TerrainLayerDrawOptions = {}
  ): Sprite | null {
    if (layer.version >= 4) {
      return this.createPixiTerrainLayerGraphic(layer, cellSizeUnits, options)
    }
    const chunk = layer.chunks[chunkIndex]
    if (!chunk || !this.hasChunkContent(chunk.cells)) {
      return null
    }
    const bounds = this.getGridChunkPixelBounds(
      layer,
      chunkIndex,
      cellSizeUnits,
      options.layerPixelOffset
    )
    if (!bounds) {
      return null
    }
    const width = Math.max(1, bounds.maxX - bounds.minX)
    const height = Math.max(1, bounds.maxY - bounds.minY)
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      return null
    }
    ctx.translate(-bounds.minX, -bounds.minY)
    ctx.save()
    this.applyLayerBaseTranslation(
      ctx,
      layer,
      cellSizeUnits,
      options.layerPixelOffset
    )
    this.drawGridChunk(
      ctx,
      layer,
      chunkIndex,
      cellSizeUnits,
      options.drawStroke === true
    )
    ctx.restore()
    const sprite = new Sprite(Texture.from(canvas))
    sprite.x = bounds.minX
    sprite.y = bounds.minY
    return sprite
  }

  private static getResolvedRenderLayer(
    layer: TerrainResolvedLayerView
  ): number {
    return layer.renderLayer !== undefined
      ? layer.renderLayer
      : layer.materialId
        ? getDefaultTerrainRenderLayer(layer.materialId)
        : 0
  }

  private static applyLayerBaseTranslation(
    ctx: CanvasRenderingContext2D,
    layer: TerrainResolvedLayerView,
    cellSizeUnits: number,
    layerPixelOffset: { x: number; y: number } | null | undefined
  ): void {
    if (layer.version >= 4) {
      ctx.translate(layerPixelOffset?.x ?? 0, layerPixelOffset?.y ?? 0)
      return
    }
    ctx.translate(
      layer.offsetCellX * cellSizeUnits +
        layer.offsetXUnits +
        (layerPixelOffset?.x ?? 0),
      layer.offsetCellY * cellSizeUnits +
        layer.offsetYUnits +
        (layerPixelOffset?.y ?? 0)
    )
  }

  private static hasChunkContent(cells: ArrayLike<number>): boolean {
    for (let i = 0; i < cells.length; i++) {
      if ((cells[i] | 0) > 0) {
        return true
      }
    }
    return false
  }

  private static getGridChunkPixelBounds(
    layer: TerrainResolvedLayerView,
    chunkIndex: number,
    cellSizeUnits: number,
    layerPixelOffset: { x: number; y: number } | null | undefined
  ): TerrainPixelBounds | null {
    const chunk = layer.chunks[chunkIndex]
    const chunkSize = layer.chunkSize | 0
    if (!chunk || chunkSize <= 0) {
      return null
    }
    const padding = TerrainRenderer.TERRAIN_SPRITE_PADDING_PX
    const offsetX =
      layer.offsetCellX * cellSizeUnits +
      layer.offsetXUnits +
      (layerPixelOffset?.x ?? 0)
    const offsetY =
      layer.offsetCellY * cellSizeUnits +
      layer.offsetYUnits +
      (layerPixelOffset?.y ?? 0)
    const minX =
      Math.floor(offsetX + chunk.chunkX * chunkSize * cellSizeUnits) - padding
    const minY =
      Math.floor(offsetY + chunk.chunkY * chunkSize * cellSizeUnits) - padding
    const maxX =
      Math.ceil(offsetX + (chunk.chunkX + 1) * chunkSize * cellSizeUnits) +
      padding
    const maxY =
      Math.ceil(offsetY + (chunk.chunkY + 1) * chunkSize * cellSizeUnits) +
      padding
    return { minX, minY, maxX, maxY }
  }

  private static getLayerPixelBounds(
    layer: TerrainResolvedLayerView,
    cellSizeUnits: number,
    layerPixelOffset: { x: number; y: number } | null | undefined
  ): TerrainPixelBounds | null {
    if (layer.version >= 4) {
      return this.getVoronoiLayerPixelBounds(
        layer,
        cellSizeUnits,
        layerPixelOffset
      )
    }
    return this.getGridLayerPixelBounds(layer, cellSizeUnits, layerPixelOffset)
  }

  private static getGridLayerPixelBounds(
    layer: TerrainResolvedLayerView,
    cellSizeUnits: number,
    layerPixelOffset: { x: number; y: number } | null | undefined
  ): TerrainPixelBounds | null {
    const chunkSize = layer.chunkSize | 0
    const chunkCount = layer.chunks.length
    if (chunkSize <= 0 || chunkCount <= 0) {
      return null
    }

    let minChunkX = layer.chunks[0].chunkX | 0
    let minChunkY = layer.chunks[0].chunkY | 0
    let maxChunkX = minChunkX
    let maxChunkY = minChunkY
    for (let chunkIndex = 1; chunkIndex < chunkCount; chunkIndex++) {
      const chunk = layer.chunks[chunkIndex]
      const chunkX = chunk.chunkX | 0
      const chunkY = chunk.chunkY | 0
      if (chunkX < minChunkX) {
        minChunkX = chunkX
      }
      if (chunkY < minChunkY) {
        minChunkY = chunkY
      }
      if (chunkX > maxChunkX) {
        maxChunkX = chunkX
      }
      if (chunkY > maxChunkY) {
        maxChunkY = chunkY
      }
    }

    const padding = TerrainRenderer.TERRAIN_SPRITE_PADDING_PX
    const offsetX =
      layer.offsetCellX * cellSizeUnits +
      layer.offsetXUnits +
      (layerPixelOffset?.x ?? 0)
    const offsetY =
      layer.offsetCellY * cellSizeUnits +
      layer.offsetYUnits +
      (layerPixelOffset?.y ?? 0)
    const minX =
      Math.floor(offsetX + minChunkX * chunkSize * cellSizeUnits) - padding
    const minY =
      Math.floor(offsetY + minChunkY * chunkSize * cellSizeUnits) - padding
    const maxX =
      Math.ceil(offsetX + (maxChunkX + 1) * chunkSize * cellSizeUnits) + padding
    const maxY =
      Math.ceil(offsetY + (maxChunkY + 1) * chunkSize * cellSizeUnits) + padding
    return { minX, minY, maxX, maxY }
  }

  private static getVoronoiLayerPixelBounds(
    layer: TerrainResolvedLayerView,
    cellSizeUnits: number,
    layerPixelOffset: { x: number; y: number } | null | undefined
  ): TerrainPixelBounds | null {
    const padding = TerrainRenderer.TERRAIN_SPRITE_PADDING_PX
    const offsetX = layerPixelOffset?.x ?? 0
    const offsetY = layerPixelOffset?.y ?? 0

    if (layer.contourClipPoints && layer.contourClipPoints.length >= 6) {
      return this.getFlatPolygonPixelBounds(
        layer.contourClipPoints,
        offsetX,
        offsetY,
        padding
      )
    }

    const build = getVoronoiLayerBuild(layer, cellSizeUnits)
    if (build.cells.length <= 0) {
      return null
    }
    if (!Number.isFinite(build.minX) || !Number.isFinite(build.minY)) {
      return null
    }

    return {
      minX: Math.floor(build.minX + offsetX) - padding,
      minY: Math.floor(build.minY + offsetY) - padding,
      maxX: Math.ceil(build.maxX + offsetX) + padding,
      maxY: Math.ceil(build.maxY + offsetY) + padding,
    }
  }

  private static getFlatPolygonPixelBounds(
    points: readonly number[],
    offsetX: number,
    offsetY: number,
    padding: number
  ): TerrainPixelBounds | null {
    if (points.length < 6) {
      return null
    }

    let minX = points[0]
    let minY = points[1]
    let maxX = minX
    let maxY = minY
    for (let index = 2; index < points.length; index += 2) {
      const x = points[index]
      const y = points[index + 1]
      if (x < minX) {
        minX = x
      }
      if (y < minY) {
        minY = y
      }
      if (x > maxX) {
        maxX = x
      }
      if (y > maxY) {
        maxY = y
      }
    }

    return {
      minX: Math.floor(minX + offsetX) - padding,
      minY: Math.floor(minY + offsetY) - padding,
      maxX: Math.ceil(maxX + offsetX) + padding,
      maxY: Math.ceil(maxY + offsetY) + padding,
    }
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
      this.drawLayerView(ctx, layer, cellSizeUnits, {
        drawStroke,
        layerPixelOffset: getLayerPixelOffset?.(layer),
        clipVoronoiContoursOnCanvas: options.clipVoronoiContoursOnCanvas,
      })
    }
  }

  static drawLayerView(
    ctx: CanvasRenderingContext2D,
    layer: TerrainResolvedLayerView,
    cellSizeUnits: number,
    options: TerrainLayerDrawOptions = {}
  ): void {
    const chunkSize = layer.chunkSize
    if (chunkSize <= 0) {
      return
    }
    const drawStroke = options.drawStroke === true
    if (layer.version >= 4) {
      ctx.save()
      this.applyLayerBaseTranslation(
        ctx,
        layer,
        cellSizeUnits,
        options.layerPixelOffset
      )
      this.drawSingleLayer(
        ctx,
        layer,
        chunkSize,
        cellSizeUnits,
        drawStroke,
        options.clipVoronoiContoursOnCanvas !== false
      )
      ctx.restore()
      return
    }
    ctx.save()
    this.applyLayerBaseTranslation(
      ctx,
      layer,
      cellSizeUnits,
      options.layerPixelOffset
    )
    this.drawSingleLayer(
      ctx,
      layer,
      chunkSize,
      cellSizeUnits,
      drawStroke,
      false
    )
    ctx.restore()
  }

  private static drawSingleLayer(
    ctx: CanvasRenderingContext2D,
    terrain: TerrainDataLike,
    chunkSize: number,
    cellSizeUnits: number,
    drawStroke: boolean,
    clipVoronoiContoursOnCanvas: boolean
  ): void {
    if (terrain.chunks.length === 0) {
      return
    }
    if (terrain.version >= 4) {
      this.drawVoronoiLayer(
        ctx,
        terrain as TerrainResolvedLayerView,
        cellSizeUnits,
        drawStroke,
        clipVoronoiContoursOnCanvas
      )
      return
    }
    const randomSeed = terrain.randomSeed | 0
    const visibleBounds = this.getVisibleCellBounds(ctx, cellSizeUnits)
    for (let chunkIndex = 0; chunkIndex < terrain.chunks.length; chunkIndex++) {
      this.drawGridChunk(
        ctx,
        terrain as TerrainResolvedLayerView,
        chunkIndex,
        cellSizeUnits,
        drawStroke,
        visibleBounds,
        randomSeed
      )
    }
  }

  private static drawGridChunk(
    ctx: CanvasRenderingContext2D,
    terrain: TerrainResolvedLayerView,
    chunkIndex: number,
    cellSizeUnits: number,
    drawStroke: boolean,
    visibleBounds?: TerrainVisibleCellBounds | null,
    randomSeedValue?: number
  ): void {
    const chunk = terrain.chunks[chunkIndex]
    const chunkSize = terrain.chunkSize | 0
    if (!chunk || chunkSize <= 0) {
      return
    }
    const chunkBaseX = chunk.chunkX * chunkSize
    const chunkBaseY = chunk.chunkY * chunkSize
    if (
      visibleBounds &&
      (chunkBaseX > visibleBounds.maxCellX ||
        chunkBaseY > visibleBounds.maxCellY ||
        chunkBaseX + chunkSize - 1 < visibleBounds.minCellX ||
        chunkBaseY + chunkSize - 1 < visibleBounds.minCellY)
    ) {
      return
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
    const randomSeed = randomSeedValue ?? terrain.randomSeed | 0

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

  private static drawVoronoiLayer(
    ctx: CanvasRenderingContext2D,
    terrain: TerrainResolvedLayerView,
    cellSizeUnits: number,
    drawStroke: boolean,
    clipVoronoiContoursOnCanvas: boolean
  ): void {
    const randomSeed = terrain.randomSeed | 0
    const visibleBounds = this.getVisibleCellBounds(ctx, cellSizeUnits)
    const useCanvasClip =
      clipVoronoiContoursOnCanvas &&
      !!terrain.contourClipPoints &&
      terrain.contourClipPoints.length >= 6
    const build = getVoronoiLayerBuild(terrain, cellSizeUnits, {
      clipContour: !useCanvasClip,
    })
    if (useCanvasClip && terrain.contourClipPoints) {
      ctx.save()
      this.appendFlatPolygonPath(ctx, terrain.contourClipPoints)
      ctx.clip()
    }
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
    if (useCanvasClip) {
      ctx.restore()
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

  private static appendFlatPolygonPath(
    ctx: CanvasRenderingContext2D,
    points: readonly number[]
  ): void {
    if (points.length < 6) {
      return
    }
    ctx.beginPath()
    ctx.moveTo(points[0], points[1])
    for (let i = 2; i < points.length; i += 2) {
      ctx.lineTo(points[i], points[i + 1])
    }
    ctx.closePath()
  }
}
