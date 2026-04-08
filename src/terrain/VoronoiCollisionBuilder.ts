import {
  getDefaultTerrainRenderLayer,
  normalizeRenderLayer,
} from '../renderLayers'
import { getTerrainLayerViews } from './TerrainDataUtils'
import {
  getTerrainMaterialTagByCode,
  getTerrainMaterialTagById,
} from './TerrainMaterialRegistry'
import type { TerrainDataLike } from './TerrainTypes'
import { getVoronoiLayerBuild } from './VoronoiBuilder'
import type { VoronoiCollisionPolygon } from './VoronoiTypes'

export class VoronoiCollisionBuilder {
  static buildPolygons(terrain: TerrainDataLike): VoronoiCollisionPolygon[] {
    const layers = getTerrainLayerViews(terrain)
    if (layers.length === 0) {
      return []
    }
    const polygons: VoronoiCollisionPolygon[] = []
    for (let layerIndex = 0; layerIndex < layers.length; layerIndex++) {
      const layer = layers[layerIndex]
      const renderLayer = layer.materialId
        ? normalizeRenderLayer(
            layer.renderLayer,
            getDefaultTerrainRenderLayer(layer.materialId)
          )
        : normalizeRenderLayer(layer.renderLayer, 0)
      const build = getVoronoiLayerBuild(layer, terrain.cellSize)
      for (let cellIndex = 0; cellIndex < build.cells.length; cellIndex++) {
        const cell = build.cells[cellIndex]
        const materialTag = layer.materialId
          ? getTerrainMaterialTagById(layer.materialId)
          : getTerrainMaterialTagByCode(cell.materialCode)
        if (!materialTag || materialTag === 'foliage') {
          continue
        }
        const bounds = computePolygonBounds(cell.points)
        if (!bounds) {
          continue
        }
        polygons.push({
          materialTag,
          renderLayer,
          materialCode: cell.materialCode,
          centerX: (bounds.minX + bounds.maxX) * 0.5,
          centerY: (bounds.minY + bounds.maxY) * 0.5,
          halfWidth: (bounds.maxX - bounds.minX) * 0.5,
          halfHeight: (bounds.maxY - bounds.minY) * 0.5,
          points: cell.points.slice(),
        })
      }
    }
    return polygons
  }
}

function computePolygonBounds(points: readonly number[]): {
  minX: number
  minY: number
  maxX: number
  maxY: number
} | null {
  if (points.length < 6) {
    return null
  }
  let minX = points[0]
  let minY = points[1]
  let maxX = minX
  let maxY = minY
  for (let i = 2; i < points.length; i += 2) {
    const x = points[i]
    const y = points[i + 1]
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
  }
  return { minX, minY, maxX, maxY }
}
