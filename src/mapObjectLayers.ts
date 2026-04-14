import type {
  EditorMapData,
  EditorTreeNode,
  EditorTreeObjectType,
} from './editorMapTypes'
import {
  getDefaultShapeRenderLayer,
  getDefaultTerrainRenderLayer,
  normalizeRenderLayer,
} from './renderLayers'
import { inferTerrainMaterialId } from './terrain/TerrainDataUtils'

export interface MapObjectLayerLookup {
  playerLayer: number
  npcLayers: number[]
  weaponLayers: number[]
  checkpointLayers: number[]
  hookAnchorLayers: number[]
  sunPickupSmallLayers: number[]
  sunPickupLargeLayers: number[]
  expOrbLayers: number[]
}

function getDefaultObjectLayer(): number {
  return getDefaultShapeRenderLayer()
}

function getNodeLayer(node: EditorTreeNode | undefined): number {
  return normalizeRenderLayer(node?.renderLayer, getDefaultObjectLayer())
}

export function buildMapObjectLayerLookup(
  map: EditorMapData | null | undefined
): MapObjectLayerLookup {
  const lookup: MapObjectLayerLookup = {
    playerLayer: getDefaultObjectLayer(),
    npcLayers: [],
    weaponLayers: [],
    checkpointLayers: [],
    hookAnchorLayers: [],
    sunPickupSmallLayers: [],
    sunPickupLargeLayers: [],
    expOrbLayers: [],
  }
  const tree = map?.editorTree
  if (!tree) {
    return lookup
  }
  const nodes = tree.nodes
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]
    const layer = getNodeLayer(node)
    const index = node.index ?? -1
    let type: EditorTreeObjectType = node.type
    if (type === 'enemy') {
      type = 'npc'
    }
    if (type === 'player') {
      lookup.playerLayer = layer
      continue
    }
    if (index < 0) {
      continue
    }
    if (type === 'npc') {
      lookup.npcLayers[index] = layer
    } else if (type === 'weapon') {
      lookup.weaponLayers[index] = layer
    } else if (type === 'checkpoint') {
      lookup.checkpointLayers[index] = layer
    } else if (type === 'hookAnchor') {
      lookup.hookAnchorLayers[index] = layer
    } else if (type === 'sunPickupSmall') {
      lookup.sunPickupSmallLayers[index] = layer
    } else if (type === 'sunPickupLarge') {
      lookup.sunPickupLargeLayers[index] = layer
    } else if (type === 'expOrb') {
      lookup.expOrbLayers[index] = layer
    }
  }
  return lookup
}

function pushUniqueLayer(out: number[], value: number): void {
  for (let i = 0; i < out.length; i++) {
    if (out[i] === value) {
      return
    }
    if (out[i] > value) {
      out.splice(i, 0, value)
      return
    }
  }
  out.push(value)
}

export function collectStaticRenderLayers(
  map: EditorMapData | null | undefined
): number[] {
  const layers: number[] = []
  if (!map) {
    return layers
  }
  for (let i = 0; i < map.shapes.length; i++) {
    pushUniqueLayer(
      layers,
      normalizeRenderLayer(map.shapes[i].renderLayer, getDefaultObjectLayer())
    )
  }
  const terrainLayers = map.terrain?.layers
  if (terrainLayers) {
    for (let i = 0; i < terrainLayers.length; i++) {
      const terrainLayer = terrainLayers[i]
      pushUniqueLayer(
        layers,
        normalizeRenderLayer(
          terrainLayer.renderLayer,
          getDefaultTerrainRenderLayer(terrainLayer.materialId)
        )
      )
    }
  } else if ((map.terrain?.chunks.length ?? 0) > 0) {
    pushUniqueLayer(
      layers,
      getDefaultTerrainRenderLayer(inferTerrainMaterialId(map.terrain!.chunks))
    )
  }
  return layers
}

export function collectCollisionLayers(
  map: EditorMapData | null | undefined,
  lookup: MapObjectLayerLookup
): number[] {
  const layers: number[] = []
  pushUniqueLayer(layers, lookup.playerLayer)
  if (!map) {
    return layers
  }
  for (let i = 0; i < map.shapes.length; i++) {
    pushUniqueLayer(
      layers,
      normalizeRenderLayer(map.shapes[i].renderLayer, getDefaultObjectLayer())
    )
  }
  const terrainLayers = map.terrain?.layers
  if (terrainLayers) {
    for (let i = 0; i < terrainLayers.length; i++) {
      const terrainLayer = terrainLayers[i]
      pushUniqueLayer(
        layers,
        normalizeRenderLayer(
          terrainLayer.renderLayer,
          getDefaultTerrainRenderLayer(terrainLayer.materialId)
        )
      )
    }
  } else if ((map.terrain?.chunks.length ?? 0) > 0) {
    pushUniqueLayer(
      layers,
      getDefaultTerrainRenderLayer(inferTerrainMaterialId(map.terrain!.chunks))
    )
  }
  for (let i = 0; i < map.npcs.length; i++) {
    pushUniqueLayer(
      layers,
      normalizeRenderLayer(lookup.npcLayers[i], getDefaultObjectLayer())
    )
  }
  const weapons = map.weapons ?? []
  for (let i = 0; i < weapons.length; i++) {
    pushUniqueLayer(
      layers,
      normalizeRenderLayer(lookup.weaponLayers[i], getDefaultObjectLayer())
    )
  }
  const sunPickups = map.sunPickups ?? []
  for (let i = 0; i < sunPickups.length; i++) {
    const pickup = sunPickups[i]
    pushUniqueLayer(
      layers,
      normalizeRenderLayer(
        pickup.isLarge
          ? lookup.sunPickupLargeLayers[i]
          : lookup.sunPickupSmallLayers[i],
        getDefaultObjectLayer()
      )
    )
  }
  const expOrbs = map.expOrbs ?? []
  for (let i = 0; i < expOrbs.length; i++) {
    pushUniqueLayer(
      layers,
      normalizeRenderLayer(lookup.expOrbLayers[i], getDefaultObjectLayer())
    )
  }
  return layers
}
