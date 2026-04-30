import { normalizeRenderLayer } from './renderLayers'

export type CollisionLayerKind =
  | 'ground'
  | 'player'
  | 'enemy'
  | 'obstacle'
  | 'weapon'
  | 'rope'

const COLLISION_KIND_ORDER: readonly CollisionLayerKind[] = [
  'ground',
  'player',
  'enemy',
  'obstacle',
  'weapon',
  'rope',
]

const KIND_COUNT = COLLISION_KIND_ORDER.length
const MAX_COLLISION_LAYER_SLOTS = 5
const DEFAULT_LAYER = 0

const collisionCategories: Record<CollisionLayerKind, number[]> = {
  ground: [],
  player: [],
  enemy: [],
  obstacle: [],
  weapon: [],
  rope: [],
}

let configuredLayers: number[] = [DEFAULT_LAYER]
let anyGroundMask = 0
let anyPlayerMask = 0
let anyEnemyMask = 0
let anyObstacleMask = 0

function findKindIndex(kind: CollisionLayerKind): number {
  for (let i = 0; i < KIND_COUNT; i++) {
    if (COLLISION_KIND_ORDER[i] === kind) {
      return i
    }
  }
  return 0
}

function getLayerSlot(layer: number): number {
  const normalized = normalizeRenderLayer(layer, DEFAULT_LAYER)
  for (let i = 0; i < configuredLayers.length; i++) {
    if (configuredLayers[i] === normalized) {
      return i
    }
  }
  return 0
}

function getCategory(kind: CollisionLayerKind, layer: number): number {
  const slot = getLayerSlot(layer)
  return collisionCategories[kind][slot] ?? collisionCategories[kind][0] ?? 0
}

function getCombinedMask(
  layer: number,
  kinds: readonly CollisionLayerKind[]
): number {
  let mask = 0
  for (let i = 0; i < kinds.length; i++) {
    mask = (mask | getCategory(kinds[i], layer)) >>> 0
  }
  return mask >>> 0
}

export function configureCollisionLayers(layerValues: readonly number[]): void {
  const normalizedLayers: number[] = []
  for (let i = 0; i < layerValues.length; i++) {
    const layer = normalizeRenderLayer(layerValues[i], DEFAULT_LAYER)
    let exists = false
    for (let j = 0; j < normalizedLayers.length; j++) {
      if (normalizedLayers[j] === layer) {
        exists = true
        break
      }
    }
    if (!exists) {
      normalizedLayers.push(layer)
    }
  }
  if (normalizedLayers.length === 0) {
    normalizedLayers.push(DEFAULT_LAYER)
  }
  normalizedLayers.sort((a, b) => a - b)
  if (normalizedLayers.length > MAX_COLLISION_LAYER_SLOTS) {
    throw new Error(
      `Too many active collision layers: ${normalizedLayers.length}. Max supported is ${MAX_COLLISION_LAYER_SLOTS}.`
    )
  }
  configuredLayers = normalizedLayers
  anyGroundMask = 0
  anyPlayerMask = 0
  anyEnemyMask = 0
  anyObstacleMask = 0
  for (let slot = 0; slot < configuredLayers.length; slot++) {
    const baseBit = slot * KIND_COUNT
    for (let kindIndex = 0; kindIndex < KIND_COUNT; kindIndex++) {
      const kind = COLLISION_KIND_ORDER[kindIndex]
      collisionCategories[kind][slot] = (1 << (baseBit + kindIndex)) >>> 0
    }
    anyGroundMask = (anyGroundMask | collisionCategories.ground[slot]) >>> 0
    anyPlayerMask = (anyPlayerMask | collisionCategories.player[slot]) >>> 0
    anyEnemyMask = (anyEnemyMask | collisionCategories.enemy[slot]) >>> 0
    anyObstacleMask =
      (anyObstacleMask | collisionCategories.obstacle[slot]) >>> 0
  }
  for (
    let slot = configuredLayers.length;
    slot < MAX_COLLISION_LAYER_SLOTS;
    slot++
  ) {
    for (let kindIndex = 0; kindIndex < KIND_COUNT; kindIndex++) {
      const kind = COLLISION_KIND_ORDER[kindIndex]
      collisionCategories[kind][slot] = 0
    }
  }
}

export function getConfiguredCollisionLayers(): readonly number[] {
  return configuredLayers
}

export function getCollisionLayerValue(layer: number | undefined): number {
  return normalizeRenderLayer(layer, DEFAULT_LAYER)
}

export function getGroundCollisionCategory(layer: number): number {
  return getCategory('ground', layer)
}

export function getPlayerCollisionCategory(layer: number): number {
  return getCategory('player', layer)
}

export function getEnemyCollisionCategory(layer: number): number {
  return getCategory('enemy', layer)
}

export function getObstacleCollisionCategory(layer: number): number {
  return getCategory('obstacle', layer)
}

export function getWeaponCollisionCategory(layer: number): number {
  return getCategory('weapon', layer)
}

export function getRopeCollisionCategory(layer: number): number {
  return getCategory('rope', layer)
}

export function getGroundCollisionMask(layer: number): number {
  return getCombinedMask(layer, ['player', 'enemy', 'weapon'])
}

export function getObstacleCollisionMask(layer: number): number {
  return getCombinedMask(layer, ['player', 'enemy', 'weapon', 'rope'])
}

export function getPlayerCollisionMask(layer: number, rolling = false): number {
  return getCombinedMask(
    layer,
    rolling
      ? ['ground', 'obstacle', 'player']
      : ['ground', 'obstacle', 'player', 'enemy']
  )
}

export function getEnemyCollisionMask(layer: number): number {
  return getCombinedMask(layer, [
    'ground',
    'obstacle',
    'player',
    'enemy',
    'rope',
  ])
}

export function getWeaponCollisionMask(layer: number): number {
  return getCombinedMask(layer, ['ground', 'obstacle', 'rope'])
}

export function getRopeCollisionMask(layer: number): number {
  return getCombinedMask(layer, ['obstacle', 'enemy', 'weapon'])
}

export function getEnvironmentCollisionMask(layer: number): number {
  return getCombinedMask(layer, ['ground', 'obstacle'])
}

export function isGroundCollisionCategory(bits: number): boolean {
  return ((bits >>> 0) & anyGroundMask) !== 0
}

export function isCharacterCollisionCategory(bits: number): boolean {
  const characterMask = (anyPlayerMask | anyEnemyMask) >>> 0
  return ((bits >>> 0) & characterMask) !== 0
}

export function isObstacleCollisionCategory(bits: number): boolean {
  return ((bits >>> 0) & anyObstacleMask) !== 0
}

configureCollisionLayers([DEFAULT_LAYER])
