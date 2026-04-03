import { getTerrainMaterialTagById } from './terrain/TerrainMaterialRegistry'
import type { TerrainMaterialId } from './terrain/TerrainTypes'

export const RENDER_LAYER_DEFAULT = 0
export const RENDER_LAYER_FOREGROUND = 1

export function normalizeRenderLayer(
  renderLayer: number | undefined,
  fallback: number
): number {
  if (typeof renderLayer !== 'number' || !Number.isFinite(renderLayer)) {
    return fallback
  }
  return renderLayer | 0
}

export function isRenderLayerMatch(
  renderLayer: number | undefined,
  targetLayer: number,
  fallback: number
): boolean {
  return normalizeRenderLayer(renderLayer, fallback) === targetLayer
}

export function getDefaultTerrainRenderLayer(
  materialId: TerrainMaterialId
): number {
  return getTerrainMaterialTagById(materialId) === 'foliage'
    ? RENDER_LAYER_FOREGROUND
    : RENDER_LAYER_DEFAULT
}

export function getDefaultShapeRenderLayer(): number {
  return RENDER_LAYER_DEFAULT
}
