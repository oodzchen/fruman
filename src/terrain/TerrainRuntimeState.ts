import {
  getDefaultTerrainRenderLayer,
  normalizeRenderLayer,
} from '../renderLayers'
import { TerrainChunkGrid } from './TerrainChunkGrid'
import {
  getTerrainMaterialByCode,
  getTerrainMaterialCodeById,
} from './TerrainMaterialRegistry'
import type { MapTerrainData, MapTerrainLayer } from './TerrainTypes'

const TERRAIN_DAMAGE_SCALE = 100
const DIRT_MATERIAL_CODE = getTerrainMaterialCodeById('dirt')
const GRASS_MATERIAL_CODE = getTerrainMaterialCodeById('grass')

export interface TerrainImpactRequest {
  worldX: number
  worldY: number
  radius: number
  impactPower: number
  renderLayer: number
}

export interface TerrainImpactResult {
  readonly destroyedCells1000: number[]
}

interface RuntimeTerrainLayerState {
  readonly layer: MapTerrainLayer
  readonly grid: TerrainChunkGrid
  readonly damageChunks: Map<string, Uint16Array>
  readonly resolvedRenderLayer: number
  readonly offsetX1000: number
  readonly offsetY1000: number
}

export interface RuntimeTerrainState {
  readonly terrain: MapTerrainData
  readonly layers: RuntimeTerrainLayerState[]
  readonly cellSize1000: number
  readonly chunkSize: number
}

export function createTerrainRuntimeState(
  terrain: MapTerrainData | undefined,
  pixelsPerMeter: number
): RuntimeTerrainState | null {
  if (
    !terrain ||
    !terrain.layers ||
    terrain.layers.length <= 0 ||
    !(terrain.cellSize > 0)
  ) {
    return null
  }

  const chunkSize = Math.max(1, terrain.chunkSize | 0)
  const cellSize1000 = Math.max(1, Math.round(terrain.cellSize * 1000))
  const layers = new Array<RuntimeTerrainLayerState>(terrain.layers.length)
  const pixelScale1000 =
    pixelsPerMeter > 0 ? Math.round(1000 / pixelsPerMeter) : 0

  for (let i = 0; i < terrain.layers.length; i++) {
    const layer = terrain.layers[i]
    const grid = new TerrainChunkGrid(chunkSize, terrain.randomSeed)
    grid.loadSerializedChunks(layer.chunks)
    layers[i] = {
      layer,
      grid,
      damageChunks: new Map<string, Uint16Array>(),
      resolvedRenderLayer: normalizeRenderLayer(
        layer.renderLayer,
        getDefaultTerrainRenderLayer(layer.materialId)
      ),
      offsetX1000: Math.round((layer.offsetXUnits ?? 0) * pixelScale1000),
      offsetY1000: Math.round((layer.offsetYUnits ?? 0) * pixelScale1000),
    }
  }

  return {
    terrain,
    layers,
    cellSize1000,
    chunkSize,
  }
}

export function applyTerrainImpactToRuntimeState(
  runtimeState: RuntimeTerrainState | null,
  request: TerrainImpactRequest,
  nextBuildRevision: () => number
): TerrainImpactResult | null {
  if (!runtimeState) {
    return null
  }

  const radius1000 = Math.max(1, Math.round(request.radius * 1000))
  const effectiveRadius1000 = Math.max(1, Math.floor((radius1000 * 3) / 4))
  const worldX1000 = Math.round(request.worldX * 1000)
  const worldY1000 = Math.round(request.worldY * 1000)
  const radiusSq1000 = effectiveRadius1000 * effectiveRadius1000
  let destroyedAnyCell = false
  const destroyedCells1000: number[] = []

  for (let i = 0; i < runtimeState.layers.length; i++) {
    const layerState = runtimeState.layers[i]
    if (layerState.resolvedRenderLayer !== (request.renderLayer | 0)) {
      continue
    }

    const layerWorldX1000 = worldX1000 - layerState.offsetX1000
    const layerWorldY1000 = worldY1000 - layerState.offsetY1000
    const minWorldCellX =
      Math.floor(
        (layerWorldX1000 - effectiveRadius1000) / runtimeState.cellSize1000
      ) - 1
    const maxWorldCellX =
      Math.floor(
        (layerWorldX1000 + effectiveRadius1000) / runtimeState.cellSize1000
      ) + 1
    const minWorldCellY =
      Math.floor(
        (layerWorldY1000 - effectiveRadius1000) / runtimeState.cellSize1000
      ) - 1
    const maxWorldCellY =
      Math.floor(
        (layerWorldY1000 + effectiveRadius1000) / runtimeState.cellSize1000
      ) + 1

    let layerDestroyed = false
    const destroyedLayerCells: number[] = []
    for (
      let worldCellY = minWorldCellY;
      worldCellY <= maxWorldCellY;
      worldCellY++
    ) {
      const localCellY = worldCellY - layerState.layer.offsetCellY
      for (
        let worldCellX = minWorldCellX;
        worldCellX <= maxWorldCellX;
        worldCellX++
      ) {
        const localCellX = worldCellX - layerState.layer.offsetCellX
        const materialCode = layerState.grid.getCellMaterialCode(
          localCellX,
          localCellY
        )
        if (materialCode <= 0) {
          continue
        }

        const material = getTerrainMaterialByCode(materialCode)
        if (
          !material ||
          !material.breakable ||
          request.impactPower < material.hardness
        ) {
          continue
        }

        const centerX1000 =
          worldCellX * runtimeState.cellSize1000 +
          (runtimeState.cellSize1000 >> 1) +
          layerState.offsetX1000
        const centerY1000 =
          worldCellY * runtimeState.cellSize1000 +
          (runtimeState.cellSize1000 >> 1) +
          layerState.offsetY1000
        const dx1000 = centerX1000 - worldX1000
        const dy1000 = centerY1000 - worldY1000
        const distanceSq1000 = dx1000 * dx1000 + dy1000 * dy1000
        if (distanceSq1000 > radiusSq1000) {
          continue
        }
        const weightedImpact = computeWeightedImpactPower(
          request.impactPower,
          distanceSq1000,
          radiusSq1000
        )
        if (weightedImpact <= 0) {
          continue
        }

        const nextDamage =
          getCellDamage(
            layerState,
            runtimeState.chunkSize,
            localCellX,
            localCellY
          ) + weightedImpact
        const cellHealth = material.hardness * TERRAIN_DAMAGE_SCALE
        if (nextDamage < cellHealth) {
          setCellDamage(
            layerState,
            runtimeState.chunkSize,
            localCellX,
            localCellY,
            nextDamage
          )
          continue
        }

        if (layerState.grid.setCellMaterialCode(localCellX, localCellY, 0)) {
          clearCellDamage(
            layerState,
            runtimeState.chunkSize,
            localCellX,
            localCellY
          )
          layerDestroyed = true
          destroyedAnyCell = true
          destroyedCells1000.push(centerX1000, centerY1000, materialCode)
          destroyedLayerCells.push(localCellX, localCellY)
        }
      }
    }

    if (layerDestroyed) {
      exposeGrassSubsurfaceBelowDestroyedCells(
        layerState,
        runtimeState.chunkSize,
        destroyedLayerCells
      )
      layerState.layer.chunks = layerState.grid.serializeChunks()
      layerState.layer.buildRevision = nextBuildRevision()
    }
  }

  if (!destroyedAnyCell) {
    return null
  }
  return { destroyedCells1000 }
}

function exposeGrassSubsurfaceBelowDestroyedCells(
  layerState: RuntimeTerrainLayerState,
  chunkSize: number,
  destroyedLayerCells: readonly number[]
): void {
  for (let i = 0; i < destroyedLayerCells.length; i += 2) {
    const localCellX = destroyedLayerCells[i]
    const exposedLocalCellY = destroyedLayerCells[i + 1] + 1
    if (
      layerState.grid.getCellMaterialCode(localCellX, exposedLocalCellY) !==
      GRASS_MATERIAL_CODE
    ) {
      continue
    }
    if (
      layerState.grid.setCellMaterialCode(
        localCellX,
        exposedLocalCellY,
        DIRT_MATERIAL_CODE
      )
    ) {
      clearCellDamage(layerState, chunkSize, localCellX, exposedLocalCellY)
    }
  }
}

function computeWeightedImpactPower(
  impactPower: number,
  distanceSq1000: number,
  radiusSq1000: number
): number {
  if (impactPower <= 0 || radiusSq1000 <= 0) {
    return 0
  }
  const remainingSq = radiusSq1000 - distanceSq1000
  if (remainingSq <= 0) {
    return 0
  }
  return Math.max(
    0,
    Math.floor(
      (impactPower * TERRAIN_DAMAGE_SCALE * remainingSq) / radiusSq1000
    )
  )
}

function getCellDamage(
  layerState: RuntimeTerrainLayerState,
  chunkSize: number,
  localCellX: number,
  localCellY: number
): number {
  const chunk = getDamageChunk(layerState, chunkSize, localCellX, localCellY)
  if (!chunk) {
    return 0
  }
  return chunk[getChunkCellIndex(localCellX, localCellY, chunkSize)] | 0
}

function setCellDamage(
  layerState: RuntimeTerrainLayerState,
  chunkSize: number,
  localCellX: number,
  localCellY: number,
  damage: number
): void {
  const chunkX = Math.floor(localCellX / chunkSize)
  const chunkY = Math.floor(localCellY / chunkSize)
  const key = getChunkKey(chunkX, chunkY)
  let chunk = layerState.damageChunks.get(key)
  if (!chunk) {
    chunk = new Uint16Array(chunkSize * chunkSize)
    layerState.damageChunks.set(key, chunk)
  }
  chunk[getChunkCellIndex(localCellX, localCellY, chunkSize)] = Math.max(
    0,
    Math.min(0xffff, damage | 0)
  )
}

function clearCellDamage(
  layerState: RuntimeTerrainLayerState,
  chunkSize: number,
  localCellX: number,
  localCellY: number
): void {
  const chunk = getDamageChunk(layerState, chunkSize, localCellX, localCellY)
  if (!chunk) {
    return
  }
  chunk[getChunkCellIndex(localCellX, localCellY, chunkSize)] = 0
}

function getDamageChunk(
  layerState: RuntimeTerrainLayerState,
  chunkSize: number,
  localCellX: number,
  localCellY: number
): Uint16Array | null {
  const chunkX = Math.floor(localCellX / chunkSize)
  const chunkY = Math.floor(localCellY / chunkSize)
  return layerState.damageChunks.get(getChunkKey(chunkX, chunkY)) ?? null
}

function getChunkCellIndex(
  localCellX: number,
  localCellY: number,
  chunkSize: number
): number {
  const localX = positiveModulo(localCellX, chunkSize)
  const localY = positiveModulo(localCellY, chunkSize)
  return localY * chunkSize + localX
}

function getChunkKey(chunkX: number, chunkY: number): string {
  return `${chunkX}:${chunkY}`
}

function positiveModulo(value: number, divisor: number): number {
  const modulo = value % divisor
  return modulo < 0 ? modulo + divisor : modulo
}
