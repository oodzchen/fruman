import {
  getDefaultTerrainRenderLayer,
  normalizeRenderLayer,
} from '../renderLayers'
import {
  type TerrainResolvedLayerView,
  getTerrainLayerViews,
} from './TerrainDataUtils'
import {
  getTerrainMaterialTagByCode,
  getTerrainMaterialTagById,
  isSolidTerrainCode,
} from './TerrainMaterialRegistry'
import type {
  TerrainCollisionRect,
  TerrainDataLike,
  TerrainMaterialTag,
} from './TerrainTypes'

export class TerrainCollisionBuilder {
  static buildRectangles(terrain: TerrainDataLike): TerrainCollisionRect[] {
    const sourceLayers = getTerrainLayerViews(terrain)
    if (sourceLayers.length === 0) {
      return []
    }
    const cellTags = new Map<
      number,
      { materialTag: TerrainMaterialTag; renderLayer: number }
    >()

    for (let layerIndex = 0; layerIndex < sourceLayers.length; layerIndex++) {
      const layer: TerrainResolvedLayerView = sourceLayers[layerIndex]
      const chunkSize = layer.chunkSize
      const offsetCellX = layer.offsetCellX
      const offsetCellY = layer.offsetCellY
      const layerMaterialTag = layer.materialId
        ? getTerrainMaterialTagById(layer.materialId)
        : null
      const layerRenderLayer = layer.materialId
        ? normalizeRenderLayer(
            layer.renderLayer,
            getDefaultTerrainRenderLayer(layer.materialId)
          )
        : normalizeRenderLayer(layer.renderLayer, 0)

      for (let chunkIndex = 0; chunkIndex < layer.chunks.length; chunkIndex++) {
        const chunk = layer.chunks[chunkIndex]
        const cells = chunk.cells
        const baseCellX = offsetCellX + chunk.chunkX * chunkSize
        const baseCellY = offsetCellY + chunk.chunkY * chunkSize
        for (let cellIndex = 0; cellIndex < cells.length; cellIndex++) {
          const code = cells[cellIndex] | 0
          if (!isSolidTerrainCode(code)) {
            continue
          }
          const materialTag =
            layerMaterialTag ?? getTerrainMaterialTagByCode(code)
          if (!materialTag) {
            continue
          }
          cellTags.set(
            packTerrainCollisionCell(
              baseCellX + (cellIndex % chunkSize),
              baseCellY + Math.floor(cellIndex / chunkSize)
            ),
            {
              materialTag,
              renderLayer: layerRenderLayer,
            }
          )
        }
      }
    }

    if (cellTags.size === 0) {
      return []
    }

    const groupedCells = new Map<string, Set<number>>()
    cellTags.forEach((entry, packedCell) => {
      const key = `${entry.materialTag}:${entry.renderLayer}`
      let cells = groupedCells.get(key)
      if (!cells) {
        cells = new Set<number>()
        groupedCells.set(key, cells)
      }
      cells.add(packedCell)
    })

    const rects: TerrainCollisionRect[] = []
    groupedCells.forEach((cells, key) => {
      const separatorIndex = key.lastIndexOf(':')
      const materialTag = key.slice(0, separatorIndex) as TerrainMaterialTag
      const renderLayer = Number.parseInt(key.slice(separatorIndex + 1), 10) | 0
      this.appendPackedCellRectangles(rects, cells, materialTag, renderLayer)
    })
    return rects
  }

  private static appendPackedCellRectangles(
    target: TerrainCollisionRect[],
    occupiedCells: ReadonlySet<number>,
    materialTag: TerrainMaterialTag,
    renderLayer: number
  ): void {
    if (occupiedCells.size === 0) {
      return
    }

    const remaining = new Set<number>(occupiedCells)
    const orderedCells = Array.from(remaining)
    orderedCells.sort(comparePackedTerrainCollisionCells)
    for (let i = 0; i < orderedCells.length; i++) {
      const startKey = orderedCells[i]
      if (!remaining.has(startKey)) {
        continue
      }
      const startCellX = unpackTerrainCollisionCellX(startKey)
      const startCellY = unpackTerrainCollisionCellY(startKey)
      let widthCells = 1
      while (
        remaining.has(
          packTerrainCollisionCell(startCellX + widthCells, startCellY)
        )
      ) {
        widthCells += 1
      }

      let heightCells = 1
      let canExtend = true
      while (canExtend) {
        const nextRowY = startCellY + heightCells
        for (let offsetX = 0; offsetX < widthCells; offsetX++) {
          if (
            !remaining.has(
              packTerrainCollisionCell(startCellX + offsetX, nextRowY)
            )
          ) {
            canExtend = false
            break
          }
        }
        if (canExtend) {
          heightCells += 1
        }
      }

      for (let offsetY = 0; offsetY < heightCells; offsetY++) {
        for (let offsetX = 0; offsetX < widthCells; offsetX++) {
          remaining.delete(
            packTerrainCollisionCell(startCellX + offsetX, startCellY + offsetY)
          )
        }
      }

      target.push({
        cellX: startCellX,
        cellY: startCellY,
        widthCells,
        heightCells,
        renderLayer,
        materialTag,
      })
    }
  }
}

function packTerrainCollisionCell(cellX: number, cellY: number): number {
  const packedX = (cellX + 32768) & 0xffff
  const packedY = (cellY + 32768) & 0xffff
  return (packedX << 16) | packedY
}

function unpackTerrainCollisionCellX(packedCell: number): number {
  return ((packedCell >>> 16) & 0xffff) - 32768
}

function unpackTerrainCollisionCellY(packedCell: number): number {
  return (packedCell & 0xffff) - 32768
}

function comparePackedTerrainCollisionCells(a: number, b: number): number {
  const ay = unpackTerrainCollisionCellY(a)
  const by = unpackTerrainCollisionCellY(b)
  if (ay !== by) {
    return ay - by
  }
  return unpackTerrainCollisionCellX(a) - unpackTerrainCollisionCellX(b)
}
