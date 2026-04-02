import { getTerrainMaterialByCode } from './TerrainMaterialRegistry'
import type {
  TerrainDataLike,
  TerrainLayerLike,
  TerrainMaterialId,
} from './TerrainTypes'

export interface TerrainResolvedLayerView extends TerrainDataLike {
  offsetCellX: number
  offsetCellY: number
  materialId?: TerrainMaterialId
  layers?: undefined
}

export function hasTerrainContent(
  terrain: TerrainDataLike | null | undefined
): boolean {
  if (!terrain) {
    return false
  }
  if (terrain.layers && terrain.layers.length > 0) {
    for (let i = 0; i < terrain.layers.length; i++) {
      if (terrain.layers[i].chunks.length > 0) {
        return true
      }
    }
  }
  return terrain.chunks.length > 0
}

export function getTerrainLayerViews(
  terrain: TerrainDataLike
): TerrainResolvedLayerView[] {
  if (terrain.layers && terrain.layers.length > 0) {
    const layers = new Array<TerrainResolvedLayerView>(terrain.layers.length)
    for (let i = 0; i < terrain.layers.length; i++) {
      const layer = terrain.layers[i]
      layers[i] = createLayerView(terrain, layer)
    }
    return layers
  }
  if (terrain.chunks.length === 0) {
    return []
  }
  return [
    {
      version: terrain.version,
      cellSize: terrain.cellSize,
      chunkSize: terrain.chunkSize,
      randomSeed: terrain.randomSeed,
      chunks: terrain.chunks,
      offsetCellX: 0,
      offsetCellY: 0,
    },
  ]
}

export function inferTerrainMaterialId(
  chunks: ReadonlyArray<{ cells: ArrayLike<number> }>
): TerrainMaterialId {
  const counts = new Map<TerrainMaterialId, number>()
  let bestMaterialId: TerrainMaterialId = 'dirt'
  let bestCount = 0
  for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
    const cells = chunks[chunkIndex].cells
    for (let cellIndex = 0; cellIndex < cells.length; cellIndex++) {
      const code = cells[cellIndex] | 0
      if (code <= 0) {
        continue
      }
      const material = getTerrainMaterialByCode(code)
      if (!material) {
        continue
      }
      const nextCount = (counts.get(material.id) ?? 0) + 1
      counts.set(material.id, nextCount)
      if (nextCount > bestCount) {
        bestCount = nextCount
        bestMaterialId = material.id
      }
    }
  }
  return bestMaterialId
}

function createLayerView(
  terrain: TerrainDataLike,
  layer: TerrainLayerLike
): TerrainResolvedLayerView {
  return {
    version: terrain.version,
    cellSize: terrain.cellSize,
    chunkSize: terrain.chunkSize,
    randomSeed: terrain.randomSeed,
    chunks: layer.chunks,
    offsetCellX: layer.offsetCellX | 0,
    offsetCellY: layer.offsetCellY | 0,
    materialId: layer.materialId,
  }
}
