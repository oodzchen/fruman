import { Color, Container, Geometry, Mesh, Texture } from 'pixi.js'

import {
  getDefaultTerrainRenderLayer,
  isRenderLayerMatch,
} from '../renderLayers'
import type { TerrainResolvedLayerView } from './TerrainDataUtils'
import { getTerrainLayerViews } from './TerrainDataUtils'
import {
  appendTerrainCellPath,
  getTerrainPaletteIndex,
  mixHash,
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

class TerrainGeometryBuilder {
  private vertices: number[] = []
  private indices: number[] = []

  addPolygon(points: number[]): void {
    const startIdx = this.vertices.length / 2
    const count = points.length / 2
    if (count < 3) return

    for (let i = 0; i < points.length; i++) {
      this.vertices.push(points[i])
    }

    // Triangle fan triangulation (works for convex polygons like Voronoi cells)
    for (let i = 1; i < count - 1; i++) {
      this.indices.push(startIdx, startIdx + i, startIdx + i + 1)
    }
  }

  build(): Geometry | null {
    if (this.vertices.length === 0) return null
    return new Geometry({
      attributes: {
        aPosition: new Float32Array(this.vertices),
        aUV: new Float32Array(this.vertices.length), // Dummy UVs
      },
      indexBuffer: new Uint32Array(this.indices),
    })
  }
}

export class TerrainRenderer {
  static createPixiTerrainGraphics(
    terrain: TerrainDataLike,
    cellSizeUnits: number,
    options: TerrainDrawOptions = {}
  ): Container[] {
    const chunkSize = terrain.chunkSize
    if (chunkSize <= 0) {
      return []
    }

    const result: Container[] = []
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

      const fillBuilders = new Map<string, TerrainGeometryBuilder>()

      if (layer.version >= 4) {
        this.collectVoronoiGeometries(fillBuilders, layer, cellSizeUnits)
      } else {
        this.collectGridGeometries(
          fillBuilders,
          layer,
          chunkSize,
          cellSizeUnits
        )
      }

      for (const [colorStr, builder] of fillBuilders) {
        const geometry = builder.build()
        if (geometry) {
          const mesh = new Mesh({
            geometry,
            texture: Texture.WHITE,
          })
          mesh.tint = new Color(colorStr).toNumber()
          mesh.position.set(offsetX, offsetY)
          mesh.zIndex = zIndex
          result.push(mesh)
        }
      }
    }

    return result
  }

  private static collectGridGeometries(
    builders: Map<string, TerrainGeometryBuilder>,
    terrain: TerrainDataLike,
    chunkSize: number,
    cellSizeUnits: number
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
          const color = material.fillPalette[paletteIndex]
          let builder = builders.get(color)
          if (!builder) {
            builder = new TerrainGeometryBuilder()
            builders.set(color, builder)
          }
          const points = this.getGridCellPoints(
            cellX,
            cellY,
            cellSizeUnits,
            randomSeed
          )
          builder.addPolygon(points)
        }
      }
    }
  }

  private static collectVoronoiGeometries(
    builders: Map<string, TerrainGeometryBuilder>,
    terrain: TerrainDataLike,
    cellSizeUnits: number
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
      const color = material.fillPalette[paletteIndex]
      let builder = builders.get(color)
      if (!builder) {
        builder = new TerrainGeometryBuilder()
        builders.set(color, builder)
      }
      builder.addPolygon(cell.points as number[])
    }
  }

  private static getGridCellPoints(
    cellX: number,
    cellY: number,
    cellSizeUnits: number,
    randomSeed: number
  ): number[] {
    const size = Math.max(1, cellSizeUnits)
    const half = size * 0.5
    const baseX = cellX * size
    const baseY = cellY * size
    const cornerJitter = Math.max(1, Math.floor(size / 8))
    const edgeJitter = Math.max(1, Math.floor(size / 10))

    const hashOffset = (
      s: number,
      a: number,
      b: number,
      c: number,
      span: number
    ) => {
      const val = mixHash(
        mixHash(s) ^
          Math.imul(mixHash(a), 0x9e3779b1) ^
          Math.imul(mixHash(b), 0x85ebca6b) ^
          Math.imul(mixHash(c), 0xc2b2ae35)
      )
      const max = span * 2 + 1
      return (val % max) - span
    }

    const tlX = baseX + hashOffset(randomSeed, cellX, cellY, 0, cornerJitter)
    const tlY = baseY + hashOffset(randomSeed, cellX, cellY, 1, cornerJitter)
    const trX =
      baseX + size + hashOffset(randomSeed, cellX + 1, cellY, 0, cornerJitter)
    const trY =
      baseY + hashOffset(randomSeed, cellX + 1, cellY, 1, cornerJitter)
    const brX =
      baseX +
      size +
      hashOffset(randomSeed, cellX + 1, cellY + 1, 0, cornerJitter)
    const brY =
      baseY +
      size +
      hashOffset(randomSeed, cellX + 1, cellY + 1, 1, cornerJitter)
    const blX =
      baseX + hashOffset(randomSeed, cellX, cellY + 1, 0, cornerJitter)
    const blY =
      baseY + size + hashOffset(randomSeed, cellX, cellY + 1, 1, cornerJitter)

    const topMidX = baseX + half
    const topMidY = baseY + hashOffset(randomSeed, cellX, cellY, 2, edgeJitter)
    const rightMidX =
      baseX + size + hashOffset(randomSeed, cellX + 1, cellY, 3, edgeJitter)
    const rightMidY = baseY + half
    const bottomMidX = baseX + half
    const bottomMidY =
      baseY + size + hashOffset(randomSeed, cellX, cellY + 1, 2, edgeJitter)
    const leftMidX = baseX + hashOffset(randomSeed, cellX, cellY, 3, edgeJitter)
    const leftMidY = baseY + half

    return [
      tlX,
      tlY,
      topMidX,
      topMidY,
      trX,
      trY,
      rightMidX,
      rightMidY,
      brX,
      brY,
      bottomMidX,
      bottomMidY,
      blX,
      blY,
      leftMidX,
      leftMidY,
    ]
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
    const layerPixelOffset = options.layerPixelOffset
    if (layer.version >= 4) {
      ctx.save()
      if (layerPixelOffset) {
        ctx.translate(layerPixelOffset.x, layerPixelOffset.y)
      }
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
    ctx.translate(
      layer.offsetCellX * cellSizeUnits + (layerPixelOffset?.x ?? 0),
      layer.offsetCellY * cellSizeUnits + (layerPixelOffset?.y ?? 0)
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
