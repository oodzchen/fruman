import { getTerrainLayerViews } from './TerrainDataUtils'
import {
  appendTerrainCellPath,
  getTerrainPaletteIndex,
} from './TerrainGeometry'
import { getTerrainMaterialByCode } from './TerrainMaterialRegistry'
import type { TerrainDataLike } from './TerrainTypes'

export interface TerrainDrawOptions {
  drawStroke?: boolean
}

interface TerrainVisibleCellBounds {
  minCellX: number
  minCellY: number
  maxCellX: number
  maxCellY: number
}

export class TerrainRenderer {
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
    const layers = getTerrainLayerViews(terrain)
    for (let layerIndex = 0; layerIndex < layers.length; layerIndex++) {
      const layer = layers[layerIndex]
      ctx.save()
      ctx.translate(
        layer.offsetCellX * cellSizeUnits,
        layer.offsetCellY * cellSizeUnits
      )
      this.drawSingleLayer(ctx, layer, chunkSize, cellSizeUnits, drawStroke)
      ctx.restore()
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
