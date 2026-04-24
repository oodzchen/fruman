import {
  getDefaultTerrainRenderLayer,
  normalizeRenderLayer,
} from '../renderLayers'
import { TerrainCollisionBuilder } from './TerrainCollisionBuilder'
import {
  type TerrainResolvedLayerView,
  getTerrainLayerViews,
} from './TerrainDataUtils'
import {
  getTerrainMaterialCodeById,
  getTerrainMaterialTagByCode,
  getTerrainMaterialTagById,
} from './TerrainMaterialRegistry'
import {
  computeFlatPolygonBounds,
  intersectFlatPolygon,
} from './TerrainPolygonUtils'
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
      this.appendLayerPolygons(polygons, layers[layerIndex], terrain.cellSize)
    }
    return polygons
  }

  static buildLayerPolygons(
    layer: TerrainResolvedLayerView,
    cellSize: number
  ): VoronoiCollisionPolygon[] {
    const polygons: VoronoiCollisionPolygon[] = []
    this.appendLayerPolygons(polygons, layer, cellSize)
    return polygons
  }

  private static appendLayerPolygons(
    target: VoronoiCollisionPolygon[],
    layer: TerrainResolvedLayerView,
    cellSize: number
  ): void {
    const renderLayer = layer.materialId
      ? normalizeRenderLayer(
          layer.renderLayer,
          getDefaultTerrainRenderLayer(layer.materialId)
        )
      : normalizeRenderLayer(layer.renderLayer, 0)
    const hasContourClip =
      !!layer.contourClipPoints && layer.contourClipPoints.length >= 6
    if (hasContourClip) {
      this.appendContourClippedRectPolygons(target, layer, cellSize)
      return
    }

    const build = getVoronoiLayerBuild(layer, cellSize, {
      clipContour: false,
    })
    for (let cellIndex = 0; cellIndex < build.cells.length; cellIndex++) {
      const cell = build.cells[cellIndex]
      const materialTag = layer.materialId
        ? getTerrainMaterialTagById(layer.materialId)
        : getTerrainMaterialTagByCode(cell.materialCode)
      if (!materialTag || materialTag === 'foliage') {
        continue
      }
      this.appendPolygon(
        target,
        materialTag,
        renderLayer,
        cell.materialCode,
        cell.points
      )
    }
  }

  private static appendContourClippedRectPolygons(
    target: VoronoiCollisionPolygon[],
    layer: TerrainResolvedLayerView,
    cellSize: number
  ): void {
    const contourPoints = layer.contourClipPoints
    if (!contourPoints || contourPoints.length < 6) {
      return
    }

    const rects = TerrainCollisionBuilder.buildLayerRectangles(layer)
    if (rects.length === 0) {
      return
    }

    const defaultMaterialCode = layer.materialId
      ? getTerrainMaterialCodeById(layer.materialId)
      : 0
    const offsetX = layer.offsetXUnits
    const offsetY = layer.offsetYUnits

    for (let rectIndex = 0; rectIndex < rects.length; rectIndex++) {
      const rect = rects[rectIndex]
      if (rect.materialTag === 'foliage') {
        continue
      }
      const minX = rect.cellX * cellSize + offsetX
      const minY = rect.cellY * cellSize + offsetY
      const maxX = minX + rect.widthCells * cellSize
      const maxY = minY + rect.heightCells * cellSize
      const rectPolygon = [minX, minY, maxX, minY, maxX, maxY, minX, maxY]
      const clippedPolygons = intersectFlatPolygon(rectPolygon, contourPoints)
      for (
        let polygonIndex = 0;
        polygonIndex < clippedPolygons.length;
        polygonIndex++
      ) {
        this.appendPolygon(
          target,
          rect.materialTag,
          rect.renderLayer,
          defaultMaterialCode,
          clippedPolygons[polygonIndex]
        )
      }
    }
  }

  private static appendPolygon(
    target: VoronoiCollisionPolygon[],
    materialTag: NonNullable<VoronoiCollisionPolygon['materialTag']>,
    renderLayer: number,
    materialCode: number,
    points: readonly number[]
  ): void {
    const bounds = computeFlatPolygonBounds(points)
    if (!bounds) {
      return
    }
    target.push({
      materialTag,
      renderLayer,
      materialCode,
      centerX: (bounds.minX + bounds.maxX) * 0.5,
      centerY: (bounds.minY + bounds.maxY) * 0.5,
      halfWidth: (bounds.maxX - bounds.minX) * 0.5,
      halfHeight: (bounds.maxY - bounds.minY) * 0.5,
      points: points.slice(),
    })
  }
}
