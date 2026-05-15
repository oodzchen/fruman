import { Container, Sprite, Texture } from 'pixi.js'

import {
  getDefaultTerrainRenderLayer,
  isRenderLayerMatch,
} from '../renderLayers'
import type { TerrainResolvedLayerView } from './TerrainDataUtils'
import {
  getTerrainChunkMaterialCodes,
  getTerrainLayerViews,
} from './TerrainDataUtils'
import {
  appendTerrainCellPath,
  getTerrainPaletteIndex,
} from './TerrainGeometry'
import { getTerrainMaterialByCode } from './TerrainMaterialRegistry'
import type { TerrainDataLike, TerrainMaterialDefinition } from './TerrainTypes'
import { getVoronoiLayerBuild } from './VoronoiBuilder'
import type { VoronoiRenderCell } from './VoronoiTypes'

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

type TerrainChunkView = TerrainResolvedLayerView['chunks'][number]
type TerrainChunkLookup = Map<number, Map<number, TerrainChunkView>>

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
    if (!chunk || !this.hasChunkContent(getTerrainChunkMaterialCodes(chunk))) {
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
      this.shouldDrawCellStroke(layer, options.drawStroke),
      null,
      undefined,
      this.createGridChunkLookup(layer)
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
    const drawStroke = this.shouldDrawCellStroke(layer, options.drawStroke)
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
    const chunkLookup = this.createGridChunkLookup(
      terrain as TerrainResolvedLayerView
    )
    for (let chunkIndex = 0; chunkIndex < terrain.chunks.length; chunkIndex++) {
      this.drawGridChunk(
        ctx,
        terrain as TerrainResolvedLayerView,
        chunkIndex,
        cellSizeUnits,
        drawStroke,
        visibleBounds,
        randomSeed,
        chunkLookup
      )
    }
  }

  private static shouldDrawCellStroke(
    layer: TerrainResolvedLayerView,
    drawStroke: boolean | undefined
  ): boolean {
    return drawStroke === true && layer.cellStroke === true
  }

  private static drawGridChunk(
    ctx: CanvasRenderingContext2D,
    terrain: TerrainResolvedLayerView,
    chunkIndex: number,
    cellSizeUnits: number,
    drawStroke: boolean,
    visibleBounds?: TerrainVisibleCellBounds | null,
    randomSeedValue?: number,
    chunkLookup?: TerrainChunkLookup | null
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

    const cells = getTerrainChunkMaterialCodes(chunk)
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
        const fillPalette = this.getMaterialFillPalette(material)
        const paletteIndex = getTerrainPaletteIndex(
          randomSeed,
          cellX,
          cellY,
          materialCode,
          fillPalette.length
        )
        ctx.beginPath()
        appendTerrainCellPath(ctx, cellX, cellY, cellSizeUnits, randomSeed)
        ctx.fillStyle = fillPalette[paletteIndex]
        ctx.fill()
        if (this.shouldDrawMaterialSurface(material)) {
          const aboveMaterialCode = this.getGridAboveMaterialCode(
            chunk,
            cells,
            localX,
            localY,
            cellIndex,
            chunkSize,
            chunkLookup
          )
          if (aboveMaterialCode <= 0) {
            this.fillCurrentTerrainPathSurface(ctx, material, paletteIndex)
          }
        }
        if (drawStroke) {
          ctx.strokeStyle = this.getMaterialStrokeColor(material)
          ctx.stroke()
        }
      }
    }
  }

  private static getMaterialFillPalette(
    material: TerrainMaterialDefinition
  ): TerrainMaterialDefinition['fillPalette'] {
    return material.subsurfacePalette ?? material.fillPalette
  }

  private static getMaterialStrokeColor(
    material: TerrainMaterialDefinition
  ): string {
    return material.subsurfaceStrokeColor ?? material.strokeColor
  }

  private static shouldDrawMaterialSurface(
    material: TerrainMaterialDefinition
  ): boolean {
    return material.subsurfacePalette !== undefined
  }

  private static fillCurrentTerrainPathSurface(
    ctx: CanvasRenderingContext2D,
    material: TerrainMaterialDefinition,
    paletteIndex: number
  ): void {
    ctx.fillStyle = material.fillPalette[paletteIndex]
    ctx.fill()
  }

  private static getGridAboveMaterialCode(
    chunk: TerrainChunkView,
    cells: ArrayLike<number>,
    localX: number,
    localY: number,
    cellIndex: number,
    chunkSize: number,
    chunkLookup: TerrainChunkLookup | null | undefined
  ): number {
    if (localY > 0) {
      return cells[cellIndex - chunkSize] | 0
    }
    const aboveChunk = chunkLookup
      ? this.getChunkLookupValue(
          chunkLookup,
          chunk.chunkX | 0,
          chunk.chunkY - 1
        )
      : undefined
    if (!aboveChunk) {
      return 0
    }
    const aboveCells = getTerrainChunkMaterialCodes(aboveChunk)
    return aboveCells[(chunkSize - 1) * chunkSize + localX] | 0
  }

  private static createGridChunkLookup(
    layer: TerrainResolvedLayerView
  ): TerrainChunkLookup | null {
    if (layer.chunks.length === 0) {
      return null
    }
    const lookup: TerrainChunkLookup = new Map()
    for (let i = 0; i < layer.chunks.length; i++) {
      const chunk = layer.chunks[i]
      this.setChunkLookupValue(
        lookup,
        chunk.chunkX | 0,
        chunk.chunkY | 0,
        chunk
      )
    }
    return lookup
  }

  private static setChunkLookupValue(
    lookup: TerrainChunkLookup,
    chunkX: number,
    chunkY: number,
    chunk: TerrainChunkView
  ): void {
    let row = lookup.get(chunkX)
    if (!row) {
      row = new Map<number, TerrainChunkView>()
      lookup.set(chunkX, row)
    }
    row.set(chunkY, chunk)
  }

  private static getChunkLookupValue(
    lookup: TerrainChunkLookup,
    chunkX: number,
    chunkY: number
  ): TerrainChunkView | undefined {
    return lookup.get(chunkX)?.get(chunkY)
  }

  private static shouldDrawVoronoiCellSurface(
    cell: VoronoiRenderCell,
    contourClipPoints: readonly number[] | undefined
  ): boolean {
    return (
      cell.aboveMaterialCode <= 0 ||
      (!!contourClipPoints &&
        this.doesCellTouchTopFacingContourEdge(cell, contourClipPoints))
    )
  }

  private static doesCellTouchTopFacingContourEdge(
    cell: VoronoiRenderCell,
    contourPoints: readonly number[]
  ): boolean {
    if (contourPoints.length < 6) {
      return false
    }

    let x0 = contourPoints[contourPoints.length - 2]
    let y0 = contourPoints[contourPoints.length - 1]
    for (
      let pointIndex = 0;
      pointIndex < contourPoints.length;
      pointIndex += 2
    ) {
      const x1 = contourPoints[pointIndex]
      const y1 = contourPoints[pointIndex + 1]
      if (
        this.isTopFacingContourEdge(x0, y0, x1, y1, contourPoints) &&
        this.doSegmentBoundsTouchCell(x0, y0, x1, y1, cell) &&
        this.doesSegmentTouchFlatPolygon(x0, y0, x1, y1, cell.points)
      ) {
        return true
      }
      x0 = x1
      y0 = y1
    }
    return false
  }

  private static isTopFacingContourEdge(
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    contourPoints: readonly number[]
  ): boolean {
    if (x0 === x1) {
      return false
    }
    const midX = (x0 + x1) / 2
    const midY = (y0 + y1) / 2
    return (
      this.isPointInFlatPolygon(midX, midY + 1, contourPoints) &&
      !this.isPointInFlatPolygon(midX, midY - 1, contourPoints)
    )
  }

  private static isPointInFlatPolygon(
    x: number,
    y: number,
    points: readonly number[]
  ): boolean {
    let inside = false
    let previousX = points[points.length - 2]
    let previousY = points[points.length - 1]
    for (let pointIndex = 0; pointIndex < points.length; pointIndex += 2) {
      const nextX = points[pointIndex]
      const nextY = points[pointIndex + 1]
      const intersects = nextY > y !== previousY > y
      if (
        intersects &&
        x < ((previousX - nextX) * (y - nextY)) / (previousY - nextY) + nextX
      ) {
        inside = !inside
      }
      previousX = nextX
      previousY = nextY
    }
    return inside
  }

  private static doSegmentBoundsTouchCell(
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    cell: VoronoiRenderCell
  ): boolean {
    const minX = Math.min(x0, x1)
    const maxX = Math.max(x0, x1)
    const minY = Math.min(y0, y1)
    const maxY = Math.max(y0, y1)
    return !(
      maxX < cell.minX ||
      minX > cell.maxX ||
      maxY < cell.minY ||
      minY > cell.maxY
    )
  }

  private static doesSegmentTouchFlatPolygon(
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    points: readonly number[]
  ): boolean {
    if (points.length < 6) {
      return false
    }
    let px0 = points[points.length - 2]
    let py0 = points[points.length - 1]
    for (let pointIndex = 0; pointIndex < points.length; pointIndex += 2) {
      const px1 = points[pointIndex]
      const py1 = points[pointIndex + 1]
      if (this.doLineSegmentsTouch(x0, y0, x1, y1, px0, py0, px1, py1)) {
        return true
      }
      px0 = px1
      py0 = py1
    }
    return (
      this.isPointInFlatPolygon(x0, y0, points) ||
      this.isPointInFlatPolygon(x1, y1, points)
    )
  }

  private static doLineSegmentsTouch(
    ax0: number,
    ay0: number,
    ax1: number,
    ay1: number,
    bx0: number,
    by0: number,
    bx1: number,
    by1: number
  ): boolean {
    const a0 = this.computeOrientation(ax0, ay0, ax1, ay1, bx0, by0)
    const a1 = this.computeOrientation(ax0, ay0, ax1, ay1, bx1, by1)
    const b0 = this.computeOrientation(bx0, by0, bx1, by1, ax0, ay0)
    const b1 = this.computeOrientation(bx0, by0, bx1, by1, ax1, ay1)
    return (
      this.areOrientationSignsOppositeOrZero(a0, a1) &&
      this.areOrientationSignsOppositeOrZero(b0, b1) &&
      this.doSegmentBoundsTouch(ax0, ay0, ax1, ay1, bx0, by0, bx1, by1)
    )
  }

  private static areOrientationSignsOppositeOrZero(
    a: number,
    b: number
  ): boolean {
    return a === 0 || b === 0 || a < 0 !== b < 0
  }

  private static doSegmentBoundsTouch(
    ax0: number,
    ay0: number,
    ax1: number,
    ay1: number,
    bx0: number,
    by0: number,
    bx1: number,
    by1: number
  ): boolean {
    return !(
      Math.max(ax0, ax1) < Math.min(bx0, bx1) ||
      Math.min(ax0, ax1) > Math.max(bx0, bx1) ||
      Math.max(ay0, ay1) < Math.min(by0, by1) ||
      Math.min(ay0, ay1) > Math.max(by0, by1)
    )
  }

  private static computeOrientation(
    ax: number,
    ay: number,
    bx: number,
    by: number,
    cx: number,
    cy: number
  ): number {
    return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax)
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
      const fillPalette = this.getMaterialFillPalette(material)
      const paletteIndex = getTerrainPaletteIndex(
        randomSeed,
        cell.localCellX,
        cell.localCellY,
        cell.materialCode,
        fillPalette.length
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
      ctx.fillStyle = fillPalette[paletteIndex]
      ctx.fill()
      if (this.shouldDrawMaterialSurface(material)) {
        if (
          this.shouldDrawVoronoiCellSurface(cell, terrain.contourClipPoints)
        ) {
          this.fillCurrentTerrainPathSurface(ctx, material, paletteIndex)
        }
      }
      if (drawStroke) {
        ctx.strokeStyle = this.getMaterialStrokeColor(material)
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
