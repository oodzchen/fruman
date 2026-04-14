import { getTerrainMaterialTagById } from './terrain/TerrainMaterialRegistry'
import type { TerrainMaterialId } from './terrain/TerrainTypes'

export const RENDER_LAYER_DEFAULT = 0
export const RENDER_LAYER_FOREGROUND = 1

// 场景深度分组：layer < 0 为远景，layer >= 100 为近景，其余为中景
export const SCENE_DEPTH_FOREGROUND_MIN = 100

export type SceneDepthGroup = 'background' | 'midground' | 'foreground'

export function getSceneDepthGroup(layer: number): SceneDepthGroup {
  if (layer < 0) return 'background'
  if (layer >= SCENE_DEPTH_FOREGROUND_MIN) return 'foreground'
  return 'midground'
}

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
