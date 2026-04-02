import { getTerrainLayerViews } from './TerrainDataUtils'
import { isSolidTerrainCode } from './TerrainMaterialRegistry'
import type { TerrainCollisionRect, TerrainDataLike } from './TerrainTypes'

export class TerrainCollisionBuilder {
  static buildRectangles(terrain: TerrainDataLike): TerrainCollisionRect[] {
    const layers = getTerrainLayerViews(terrain)
    if (layers.length === 0) {
      return this.buildSingleLayerRectangles(terrain)
    }
    if (layers.length === 1) {
      return this.offsetRectangles(
        this.buildSingleLayerRectangles(layers[0]),
        layers[0].offsetCellX,
        layers[0].offsetCellY
      )
    }
    const occupiedCells = new Set<number>()
    for (let layerIndex = 0; layerIndex < layers.length; layerIndex++) {
      const layer = layers[layerIndex]
      const chunkSize = layer.chunkSize
      for (let chunkIndex = 0; chunkIndex < layer.chunks.length; chunkIndex++) {
        const chunk = layer.chunks[chunkIndex]
        const cells = chunk.cells
        const baseCellX = layer.offsetCellX + chunk.chunkX * chunkSize
        const baseCellY = layer.offsetCellY + chunk.chunkY * chunkSize
        for (let cellIndex = 0; cellIndex < cells.length; cellIndex++) {
          if (!isSolidTerrainCode(cells[cellIndex] | 0)) {
            continue
          }
          occupiedCells.add(
            packTerrainCollisionCell(
              baseCellX + (cellIndex % chunkSize),
              baseCellY + Math.floor(cellIndex / chunkSize)
            )
          )
        }
      }
    }
    return this.buildPackedCellRectangles(occupiedCells)
  }

  private static buildSingleLayerRectangles(
    terrain: TerrainDataLike
  ): TerrainCollisionRect[] {
    const rects: TerrainCollisionRect[] = []
    const chunkSize = terrain.chunkSize
    if (chunkSize <= 0) {
      return rects
    }

    for (let chunkIndex = 0; chunkIndex < terrain.chunks.length; chunkIndex++) {
      const chunk = terrain.chunks[chunkIndex]
      const cells = chunk.cells
      if (cells.length === 0) {
        continue
      }
      const visited = new Uint8Array(chunkSize * chunkSize)
      for (let localY = 0; localY < chunkSize; localY++) {
        for (let localX = 0; localX < chunkSize; localX++) {
          const startIndex = localY * chunkSize + localX
          if (visited[startIndex] !== 0) {
            continue
          }
          if (!isSolidTerrainCode(cells[startIndex] | 0)) {
            continue
          }

          let widthCells = 1
          while (localX + widthCells < chunkSize) {
            const testIndex = startIndex + widthCells
            if (visited[testIndex] !== 0) {
              break
            }
            if (!isSolidTerrainCode(cells[testIndex] | 0)) {
              break
            }
            widthCells += 1
          }

          let heightCells = 1
          while (localY + heightCells < chunkSize) {
            let rowSolid = true
            const rowOffset = (localY + heightCells) * chunkSize + localX
            for (let offsetX = 0; offsetX < widthCells; offsetX++) {
              const testIndex = rowOffset + offsetX
              if (visited[testIndex] !== 0) {
                rowSolid = false
                break
              }
              if (!isSolidTerrainCode(cells[testIndex] | 0)) {
                rowSolid = false
                break
              }
            }
            if (!rowSolid) {
              break
            }
            heightCells += 1
          }

          for (let markY = 0; markY < heightCells; markY++) {
            const rowOffset = (localY + markY) * chunkSize + localX
            for (let markX = 0; markX < widthCells; markX++) {
              visited[rowOffset + markX] = 1
            }
          }

          rects.push({
            cellX: chunk.chunkX * chunkSize + localX,
            cellY: chunk.chunkY * chunkSize + localY,
            widthCells,
            heightCells,
          })
        }
      }
    }

    return rects
  }

  private static buildPackedCellRectangles(
    occupiedCells: ReadonlySet<number>
  ): TerrainCollisionRect[] {
    const rects: TerrainCollisionRect[] = []
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

      rects.push({
        cellX: startCellX,
        cellY: startCellY,
        widthCells,
        heightCells,
      })
    }
    return rects
  }

  private static offsetRectangles(
    rects: TerrainCollisionRect[],
    offsetCellX: number,
    offsetCellY: number
  ): TerrainCollisionRect[] {
    if (offsetCellX === 0 && offsetCellY === 0) {
      return rects
    }
    for (let i = 0; i < rects.length; i++) {
      rects[i].cellX += offsetCellX
      rects[i].cellY += offsetCellY
    }
    return rects
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
