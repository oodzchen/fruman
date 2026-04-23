import {
  getDefaultTerrainRenderLayer,
  normalizeRenderLayer,
} from '../renderLayers'
import { getTerrainLayerViews } from './TerrainDataUtils'
import {
  getTerrainMaterialTagByCode,
  getTerrainMaterialTagById,
} from './TerrainMaterialRegistry'
import { computeFlatPolygonBounds } from './TerrainPolygonUtils'
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
      const hasContourClip =
        !!layer.contourClipPoints && layer.contourClipPoints.length >= 6
      const build = getVoronoiLayerBuild(layer, terrain.cellSize, {
        clipContour: hasContourClip,
      })
      for (let cellIndex = 0; cellIndex < build.cells.length; cellIndex++) {
        const cell = build.cells[cellIndex]
        const materialTag = layer.materialId
          ? getTerrainMaterialTagById(layer.materialId)
          : getTerrainMaterialTagByCode(cell.materialCode)
        if (!materialTag || materialTag === 'foliage') {
          continue
        }
        const bounds = computeFlatPolygonBounds(cell.points)
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
