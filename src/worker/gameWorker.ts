import Box2DFactory from 'box2d3-wasm'
import {
  decomp,
  isSimple,
  makeCCW,
  quickDecomp,
  removeCollinearPoints,
  removeDuplicatePoints,
} from 'poly-decomp-es'

import {
  PLAYER_BODY_PROFILE_INDEX,
  getCharacterBloodColor,
  getCharacterBodyColor,
  getCharacterEyeOffsetX,
  getCharacterEyeOffsetY,
  getNpcBodyProfileIndex,
  hasRenderableBodyProfile,
} from '../characterBodyProfile'
import {
  CHARACTER_DEFAULT_DATA,
  CHECKPOINT_TREE_TOP_COLOR_INACTIVE,
  CHECKPOINT_TREE_TRUNK_COLOR_INACTIVE,
  DEBUG_DRAW_BREAKABLE_CRATE_HEALTH,
  DEBUG_DRAW_CAMERA,
  DEBUG_DRAW_PLAYER_COLLISION_SHAPE,
  DEBUG_DRAW_SENSORS,
  DEBUG_DRAW_SOUND,
  DEFAULT_CAMERA_ZOOM,
  DEFAULT_CHECKPOINT_RENDER_RADIUS,
  DEFAULT_GRAPPLE_ANCHOR_RENDER_RADIUS,
  DEFAULT_GRAPPLE_RANGE,
  DEFAULT_GRAVITY,
  DEFAULT_GROUND_FRICTION,
  DEFAULT_HIT_SHAKE_DURATION_MS,
  DEFAULT_HIT_SHAKE_INTENSITY,
  DEFAULT_OBSTACLE_FRICTION,
  DEFAULT_PLAYER_FOV_RAD,
  DEFAULT_PLAYER_MAX_HEALTH,
  DEFAULT_PLAYER_MAX_POSTURE,
  DEFAULT_PLAYER_MAX_TOUGHNESS,
  DEFAULT_PLAYER_RADIUS,
  DEFAULT_WEAPON_CORNER_RADIUS,
  ENEMY_HEARING_RANGE_MULTIPLIER,
  EXP_TABLE,
  FALL_DAMAGE_KINETIC_FATAL,
  FALL_DAMAGE_KINETIC_THRESHOLD,
  FALL_DAMAGE_KINETIC_TO_HEALTH_DIVISOR,
  GRAPPLE_ANCHOR_BORDER_COLOR,
  GRAPPLE_ANCHOR_COLOR,
  GRAPPLE_ANCHOR_HIGHLIGHT_BORDER_COLOR,
  GRAPPLE_ANCHOR_HIGHLIGHT_COLOR,
  GRAPPLE_LONG_PRESS_MS,
  IMPACT_LEVEL_KNOCKBACK,
  PLAYER_MAX_LEVEL,
  PLAYER_WEIGHT_REFERENCE,
  SOUND_DB_SWORD_HIT_OBSTACLE,
  SOUND_RANGE_MULTIPLIER_WEAPON,
  WEAPON_DEFAULT_DATA,
} from '../constants'
import { ArrowPools } from '../ecs/ArrowPools'
import type { ImpactLevel } from '../ecs/AttackMoveData'
import {
  getDefaultAttackMovesetIdForWeaponType,
  getDefaultNormalAttackMovesetId,
  getUltimateMovesetIdForWeaponType,
  isNormalAttackMovesetId,
  normalizeNpcAttackMoves,
} from '../ecs/AttackMoveRegistry'
import {
  CheckpointComponent,
  DEFAULT_SKILL_MAX_CHARGES,
  ExpOrbComponent,
  Faction,
  GrappleAnchorComponent,
  GrappleTargetComponent,
  PhysicsComponent,
  RenderComponent,
  StatsComponent,
  SunPickupComponent,
  TerrainDebrisComponent,
  TransformComponent,
  ULTIMATE_COOLDOWN_MS,
} from '../ecs/Component'
import { componentRegistry } from '../ecs/ComponentRegistry'
import type { Entity } from '../ecs/Entity'
import { SkeletalSegmentManager } from '../ecs/SkeletalSegmentManager'
import { SpatialHash } from '../ecs/SpatialHash'
import { SpineSegmentManager } from '../ecs/SpineSegmentManager'
import { World } from '../ecs/World'
import {
  type NpcSpawnConfig,
  applyWeaponSizeLevel,
  createNpc,
  createPlayer,
  createWeapon,
} from '../ecs/factories/PlayerFactory'
import { ArrowSystem } from '../ecs/systems/ArrowSystem'
import { CheckpointSystem } from '../ecs/systems/CheckpointSystem'
import { ExpOrbSystem } from '../ecs/systems/ExpOrbSystem'
import { FollowSystem } from '../ecs/systems/FollowSystem'
import { GrappleSystem } from '../ecs/systems/GrappleSystem'
import { InteractionSystem } from '../ecs/systems/InteractionSystem'
import { MovementSystem } from '../ecs/systems/MovementSystem'
import { NpcAISystem } from '../ecs/systems/NpcAISystem'
import { PhysicsSystem } from '../ecs/systems/PhysicsSystem'
import { SoundSystem } from '../ecs/systems/SoundSystem'
import { type EffectsEmitter, StatsSystem } from '../ecs/systems/StatsSystem'
import { SunPickupSystem } from '../ecs/systems/SunPickupSystem'
import { TargetingSystem } from '../ecs/systems/TargetingSystem'
import {
  type BreakableObstacleHit,
  type ObstacleCollider,
  WeaponSystem,
} from '../ecs/systems/WeaponSystem'
import type {
  EditorMapData,
  MapEnvironmentObject,
  MapNpc,
  MapNpcWeapon,
  MapPlacedShape,
} from '../editorMapTypes'
import { createEnvironmentCrateLayout } from '../environmentCrateUtils'
import {
  DEFAULT_ENVIRONMENT_SCALE_PERMILLE,
  getEnvironmentRotationDeg,
  getEnvironmentScaleXPermille,
  getEnvironmentScaleYPermille,
} from '../environmentTransformUtils'
import {
  type MapObjectLayerLookup,
  buildMapObjectLayerLookup,
  collectCollisionLayers,
} from '../mapObjectLayers'
import { isWeaponDropItemType } from '../npcDropUtils'
import {
  configureCollisionLayers,
  getCollisionLayerValue,
  getGroundCollisionCategory,
  getGroundCollisionMask,
  getObstacleCollisionCategory,
  getObstacleCollisionMask,
  getWeaponCollisionCategory,
  getWeaponCollisionMask,
  isCharacterCollisionCategory,
  isGroundCollisionCategory,
  isObstacleCollisionCategory,
} from '../physicsLayers'
import {
  type PlayerUpgradeStat,
  clampPlayerLevel,
  clampPlayerUpgradeLevel,
  getPlayerDerivedMaxHealth,
  getPlayerDerivedMaxToughness,
  isPlayerUpgradeStatMaxed,
  setPlayerUpgradeLevel,
} from '../playerUpgrade'
import type {
  SaveCheckpointState,
  SaveData,
  SaveGroundSunPickupState,
  SaveGroundWeaponState,
  SaveNpcState,
  SavePlayerState,
  SaveWeaponSlotState,
} from '../saveTypes'
import {
  isSkeletalCombatReady,
  isSkeletalWeaponAttacking,
} from '../skeletalAnimation'
import { ensureDefaultMap } from '../storage'
import { TerrainCollisionBuilder } from '../terrain/TerrainCollisionBuilder'
import { hasTerrainContent } from '../terrain/TerrainDataUtils'
import {
  getTerrainMaterialByCode,
  getTerrainMaterialById,
} from '../terrain/TerrainMaterialRegistry'
import { initializeTerrainPolygonUtils } from '../terrain/TerrainPolygonUtils'
import {
  type TerrainImpactResult,
  applyTerrainImpactToRuntimeState,
  createTerrainRuntimeState,
} from '../terrain/TerrainRuntimeState'
import type { RuntimeTerrainState } from '../terrain/TerrainRuntimeState'
import type {
  MapTerrainData,
  TerrainMaterialId,
  TerrainMaterialTag,
} from '../terrain/TerrainTypes'
import { VoronoiCollisionBuilder } from '../terrain/VoronoiCollisionBuilder'
import type {
  MainModule,
  NpcType,
  WeaponType,
  WeaponVisualType,
  b2BodyId,
  b2Hull,
  b2Polygon,
  b2Rot,
  b2ShapeId,
} from '../types'
import {
  getDefaultPlayerAmmoForWeaponType,
  isAmmoLimitedWeaponType,
  isRangedWeaponType,
  normalizeWeaponType,
  normalizeWeaponTypeAndSizeLevel,
  resolveWeaponStatsForSize,
} from '../weaponTypeUtils'
import {
  ENTITY_STRIDE,
  FLAGS,
  MAX_ENTITIES,
  OFFSETS,
  WEAPON_TYPES,
} from './binaryProtocol'
import {
  EFFECTS_BASE_OFFSET,
  EFFECT_OFFSETS,
  EFFECT_STRIDE,
  EFFECT_TYPES,
  MAX_EFFECTS,
  MAX_ROPE_POINTS,
  ROPE_POINTS_BASE_OFFSET,
  SOUND_EFFECT_FLAGS,
  SOUND_IDS,
  STATE_BUFFER_FLOATS,
} from './effectsProtocol'
import type {
  CameraDebugData,
  MainToWorkerMessage,
  SensorDebugData,
  SoundListenerDebugData,
  SoundWaveDebugData,
  WorkerDebugMessage,
  WorkerPerfSnapshotMessage,
  WorkerPlayerLevelUpMessage,
  WorkerSaveResponseMessage,
  WorkerSpineCollisionData,
  WorkerStateMessage,
} from './protocol'

// Worker global scope
const ctx: Worker = self as unknown as Worker

const activeCheckpointSavePosition: SaveCheckpointState = { x: 0, y: 0 }

let box2d: MainModule
let worldId: ReturnType<MainModule['b2CreateWorld']>
let world: World
let spatialHash: SpatialHash
let playerEntity: Entity
let npcEntity: Entity | null = null

let physicsSystem: PhysicsSystem
let movementSystem: MovementSystem
let statsSystem: StatsSystem
let weaponSystem: WeaponSystem
let arrowSystem: ArrowSystem
let npcAISystem: NpcAISystem
let followSystem: FollowSystem
let soundSystem: SoundSystem
let targetingSystem: TargetingSystem
let interactionSystem: InteractionSystem
let checkpointSystem: CheckpointSystem
let grappleSystem: GrappleSystem
let arrowPools: ArrowPools
let sunPickupSystem: SunPickupSystem
let expOrbSystem: ExpOrbSystem
let spineSegmentManager: SpineSegmentManager
let skeletalSegmentManager: SkeletalSegmentManager

const checkpointActivatedMessage = { type: 'checkpoint_activated' } as const
const checkpointSleepMessage = { type: 'checkpoint_sleep' } as const
const playerDeadMessage = { type: 'player_dead' } as const
const DEBUG_FORCE_PLAYER_LEVEL = 0
const spineCollisionDataByNpcType = new Map<NpcType, WorkerSpineCollisionData>()

function isPositiveNumber(value: number | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

function buildSegmentedProxyMetrics(
  collisionData: WorkerSpineCollisionData,
  bodyProfile: MapNpc['bodyProfile'] | undefined,
  radius: number
): {
  halfWidth: number
  halfHeight: number
  offsetY: number
} | null {
  const profileScale = isPositiveNumber(bodyProfile?.spineScale)
    ? bodyProfile.spineScale
    : collisionData.spineScale
  const scale =
    isPositiveNumber(collisionData.spineScale) && isPositiveNumber(profileScale)
      ? profileScale / collisionData.spineScale
      : 1
  const halfWidth = collisionData.proxyHalfWidth * scale
  const topY = radius + collisionData.proxyTopY * scale
  const bottomY = radius
  const height = bottomY - topY
  if (!(halfWidth > 0) || !(height > 0)) {
    return null
  }
  return {
    halfWidth,
    halfHeight: height * 0.5,
    offsetY: (topY + bottomY) * 0.5,
  }
}

function buildPlayerLevelUpMessage(
  previousLevel?: number
): WorkerPlayerLevelUpMessage | null {
  if (!playerEntity?.level) {
    return null
  }
  const currentLevel = playerEntity.level.level
  const resolvedPreviousLevel =
    typeof previousLevel === 'number' &&
    Number.isFinite(previousLevel) &&
    previousLevel > 0
      ? clampPlayerLevel(previousLevel)
      : currentLevel
  return {
    type: 'player_level_up',
    previousLevel: resolvedPreviousLevel,
    level: currentLevel,
    pendingPoints: playerEntity.level.pendingUpgradePoints,
    previousMaxHealth: playerEntity.stats?.maxHealth ?? 0,
    currentMaxHealth: playerEntity.stats?.maxHealth ?? 0,
    attackLevel: playerEntity.level.attackLevel,
    defenseLevel: playerEntity.level.defenseLevel,
    agilityLevel: playerEntity.level.agilityLevel,
    toughnessLevel: playerEntity.level.toughnessLevel,
  }
}

let groundShapeIds: b2ShapeId[] = []
let activeMapData: EditorMapData | null = null
let activeMapLayerLookup: MapObjectLayerLookup = buildMapObjectLayerLookup(null)
let defaultMapData: EditorMapData | null = null
let isMapPreview = false
let isThumbnailCameraCapture = false
let runtimeTerrainState: RuntimeTerrainState | null = null
let runtimeTerrainBuildRevision = 1
let terrainBodyIds: b2BodyId[] = []
let standableSurfaces: ObstacleCollider[] = []
let obstacles: {
  bodyId: b2BodyId
  mainShapeId: b2ShapeId
  capBodyId: b2BodyId
  capShapeId: b2ShapeId
  centerX: number
  centerY: number
  width: number
  height: number
  rotationRad?: number
  renderLayer: number
  materialId?: TerrainMaterialId
  materialTag: TerrainMaterialTag
  breakableId?: number
  breakableHitProxy?: boolean
  radius?: number
  vertices?: { x: number; y: number }[]
  worldVertices?: { x: number; y: number }[]
}[] = []

interface BreakableCratePlankRuntime {
  crateId: number
  entity: Entity | null
  bodyId: b2BodyId
  shapeId: b2ShapeId
  obstacleIndex: number
  localCenterX: number
  localCenterY: number
  centerX: number
  centerY: number
  halfWidth: number
  halfHeight: number
  rotationRad: number
  debrisVariant: number
}

interface BreakableCrateRuntime {
  id: number
  envIndex: number
  seed: number
  renderLayer: number
  destroyed: boolean
  health: number
  bodyId: b2BodyId
  centerX: number
  centerY: number
  rotationRad: number
  isGrounded: boolean
  wasGrounded: boolean
  fallTrackingActive: boolean
  fallDamageIgnoreUntilMs: number
  maxFallVelocity1000: number
  fallStartY1000: number
  fallContactCount: number
  fallSolidContactCount: number
  sleepSynced: boolean
  hitObstacleIndex: number
  hitLocalCenterX: number
  hitLocalCenterY: number
  hitHalfWidth: number
  hitHalfHeight: number
  planks: BreakableCratePlankRuntime[]
}

interface BreakableCrateBreakRequest {
  crateId: number
  impactX: number
  impactY: number
  impactLevel: ImpactLevel
  sourceEntityId: number
}

const WOOD_MATERIAL = getTerrainMaterialById('wood')
let nextBreakableCrateId = 1
const breakableCrates = new Map<number, BreakableCrateRuntime>()
const breakableCratePlanksByShapeId = new Map<
  b2ShapeId,
  BreakableCratePlankRuntime
>()
const brokenEnvironmentIndices = new Set<number>()
const pendingBreakableCrateBreaks: BreakableCrateBreakRequest[] = []
const pendingBreakableCrateBreakIds = new Set<number>()
const fallImpactEntityIds: number[] = []
const fallImpactCrateIds: number[] = []
const fallImpactWeaponHit: {
  attackDamage: number
  postureDamage: number
  toughnessDamage: number
  impactLevel: ImpactLevel
  knockbackDirectionX: number
  knockbackDirectionY: number
} = {
  attackDamage: 0,
  postureDamage: 0,
  toughnessDamage: 0,
  impactLevel: 'small',
  knockbackDirectionX: 0,
  knockbackDirectionY: 1,
}
const fallImpactHitSource = { x: 0, y: 0 }
let fallImpactImpulseVec: InstanceType<MainModule['b2Vec2']> | null = null
let fallImpactDirectionX = 0
let fallImpactDirectionY = 1

let isPaused = false
let ultimateFlashRemainingMs = 0
const ULTIMATE_FLASH_DURATION_MS = 250
let loopInterval: ReturnType<typeof setInterval>

let tempSetTransformVec: InstanceType<MainModule['b2Vec2']> | null = null
let tempZeroVec: InstanceType<MainModule['b2Vec2']> | null = null
let tempSetTransformRot: b2Rot | null = null

const PLAYER_PERSISTENT_ID = 'player'
let nextPersistentNpcId = 1
const TARGET_FPS = 60
const TIME_STEP = 1 / TARGET_FPS
const FIXED_STEP_MS = Math.floor(TIME_STEP * 1000)
let playTimeMs = 0
const BOX2D_MAX_POLYGON_VERTICES = 8
const DECOMP_POINT_EPSILON = 0.0001
const DECOMP_TRIANGLE_AREA_EPSILON = 0.000001
const MAX_TERRAIN_DEBRIS_PER_IMPACT = 10
const MAX_TERRAIN_DEBRIS_ACTIVE = 96
const TERRAIN_DEBRIS_LIFETIME_MS = 1100
const TERRAIN_DEBRIS_FADE_START_MS = 700
const CRATE_RETAINED_DEBRIS_MIN_COUNT = 2
const CRATE_RETAINED_DEBRIS_MAX_COUNT = 3
const CRATE_RETAINED_DEBRIS_LIFETIME_MS = 180000
const CRATE_RETAINED_DEBRIS_FADE_DURATION_MS = 1200
const CRATE_RETAINED_DEBRIS_LINEAR_DAMPING = 0.06
const CRATE_RETAINED_DEBRIS_ANGULAR_DAMPING = 0.14
const CRATE_RETAINED_DEBRIS_ANGULAR_BASE1000 = 2600
const CRATE_RETAINED_DEBRIS_ANGULAR_RANGE1000 = 2600
const BREAKABLE_CRATE_MAX_HEALTH = 2
const BREAKABLE_CRATE_IMPACT_DAMAGE_SMALL = 1
const BREAKABLE_CRATE_IMPACT_DAMAGE_LARGE = 2
const BREAKABLE_CRATE_SPAWN_FALL_DAMAGE_GRACE_MS = 500
const FALL_IMPACT_CONTACT_NORMAL_Y_MIN = 0.2
const FALL_IMPACT_EMBED_TOLERANCE1000 = 150
const FALL_IMPACT_LARGE_DISTANCE1000 = 10000
const FALL_IMPACT_EXTREME_DISTANCE1000 = 16000
const FALL_IMPACT_SOURCE_UNSTICK_SIDE_VELOCITY1000 = 700
const FALL_IMPACT_SOURCE_UNSTICK_UP_VELOCITY1000 = 1600
const FALL_IMPACT_TARGET_UNSTICK_VELOCITY1000 = 900
const DEFAULT_BREAKABLE_CRATE_LINEAR_DAMPING = 0.6
const DEFAULT_BREAKABLE_CRATE_ANGULAR_DAMPING = 1.8
const DEFAULT_BREAKABLE_CRATE_DENSITY = 3.6
const DEFAULT_BREAKABLE_CRATE_FRICTION = 25.6
const DEFAULT_BREAKABLE_CRATE_RESTITUTION = 0.02
let breakableCrateLinearDamping = DEFAULT_BREAKABLE_CRATE_LINEAR_DAMPING
let breakableCrateAngularDamping = DEFAULT_BREAKABLE_CRATE_ANGULAR_DAMPING
let breakableCrateDensity = DEFAULT_BREAKABLE_CRATE_DENSITY
let breakableCrateFriction = DEFAULT_BREAKABLE_CRATE_FRICTION
let breakableCrateRestitution = DEFAULT_BREAKABLE_CRATE_RESTITUTION
const TERRAIN_DEBRIS_MIN_SIZE1000 = 140
const TERRAIN_DEBRIS_SIZE_RANGE1000 = 160
const TERRAIN_DEBRIS_BASE_SPEED1000 = 3400
const TERRAIN_DEBRIS_SPEED_RANGE1000 = 2200
const TERRAIN_DEBRIS_UPWARD_SPEED1000 = 3600
const TERRAIN_DEBRIS_UPWARD_RANGE1000 = 1600
const TERRAIN_DEBRIS_ANGULAR_BASE1000 = 5000
const TERRAIN_DEBRIS_ANGULAR_RANGE1000 = 4500
const TERRAIN_DEBRIS_OUTER_OFFSET_MIN1000 = 260
const TERRAIN_DEBRIS_OUTER_OFFSET_MAX1000 = 900
const TERRAIN_DEBRIS_OUTER_SPEED_BONUS1000 = 2600
const TERRAIN_DEBRIS_OUTER_UPWARD_BONUS1000 = 1400
const TERRAIN_DEBRIS_SPAWN_LIFT1000 = 120

const STATE_BUFFER_BYTES = STATE_BUFFER_FLOATS * Float32Array.BYTES_PER_ELEMENT
const supportsSharedArrayBuffer =
  typeof SharedArrayBuffer !== 'undefined' && self.crossOriginIsolated

let sharedStateBuffer: SharedArrayBuffer | null = null
let stateBuffer: Float32Array<ArrayBufferLike> = new Float32Array(
  STATE_BUFFER_FLOATS
)
const stateBufferViews: Float32Array[] = []
let effectsCount = 0
const SPARK_COLOR_INT = 0xfff4a8

type DecompPoint = [number, number]
type DecompPolygon = DecompPoint[]
const decompPointPool: DecompPoint[] = []
const decompScratchPolygon: DecompPolygon = []

function acquireDecompPoint(x: number, y: number): DecompPoint {
  const point = decompPointPool.pop() ?? [0, 0]
  point[0] = x
  point[1] = y
  return point
}

function resetDecompScratchPolygon(): void {
  for (let i = 0; i < decompScratchPolygon.length; i++) {
    decompPointPool.push(decompScratchPolygon[i])
  }
  decompScratchPolygon.length = 0
}

function refreshActiveMapCollisionLayers(): void {
  activeMapLayerLookup = buildMapObjectLayerLookup(activeMapData)
  configureCollisionLayers(
    collectCollisionLayers(activeMapData, activeMapLayerLookup)
  )
}

function getIndexedLayer(layers: readonly number[], index: number): number {
  return getCollisionLayerValue(layers[index])
}

function getPlayerRenderLayer(): number {
  return getCollisionLayerValue(activeMapLayerLookup.playerLayer)
}

function getNpcRenderLayer(index: number): number {
  return getIndexedLayer(activeMapLayerLookup.npcLayers, index)
}

function getWeaponRenderLayer(index: number): number {
  return getIndexedLayer(activeMapLayerLookup.weaponLayers, index)
}

function getCheckpointRenderLayer(index: number): number {
  return getIndexedLayer(activeMapLayerLookup.checkpointLayers, index)
}

function getHookAnchorRenderLayer(index: number): number {
  return getIndexedLayer(activeMapLayerLookup.hookAnchorLayers, index)
}

function getSunPickupRenderLayer(index: number, isLarge: boolean): number {
  return getIndexedLayer(
    isLarge
      ? activeMapLayerLookup.sunPickupLargeLayers
      : activeMapLayerLookup.sunPickupSmallLayers,
    index
  )
}

function getExpOrbRenderLayer(index: number): number {
  return getIndexedLayer(activeMapLayerLookup.expOrbLayers, index)
}

function buildRuntimeEnvironmentObjects(
  envObjects: readonly MapEnvironmentObject[] | undefined
): MapEnvironmentObject[] | undefined {
  if (!envObjects || envObjects.length === 0) {
    return envObjects ? [] : undefined
  }
  const nextObjects = new Array<MapEnvironmentObject>(envObjects.length)
  for (let i = 0; i < envObjects.length; i++) {
    const obj = envObjects[i]
    if (obj.type === 'crate' || brokenEnvironmentIndices.has(i)) {
      nextObjects[i] = { ...obj, hidden: true }
    } else {
      nextObjects[i] = obj
    }
  }
  return nextObjects
}

function buildRuntimeMapData(
  map: EditorMapData | null | undefined
): EditorMapData | null {
  if (!map) {
    return null
  }
  return {
    ...map,
    environmentObjects: buildRuntimeEnvironmentObjects(map.environmentObjects),
  }
}

function areBodyIdsEqual(a: b2BodyId, b: b2BodyId): boolean {
  return (
    a.index1 === b.index1 &&
    a.world0 === b.world0 &&
    a.generation === b.generation
  )
}

function hasNumberValue(values: readonly number[], value: number): boolean {
  for (let i = 0; i < values.length; i++) {
    if (values[i] === value) {
      return true
    }
  }
  return false
}

function getBreakableCrateByBodyId(
  bodyId: b2BodyId
): BreakableCrateRuntime | undefined {
  for (const crate of breakableCrates.values()) {
    if (!crate.destroyed && areBodyIdsEqual(crate.bodyId, bodyId)) {
      return crate
    }
  }
  return undefined
}

function getBreakableCrateByShapeId(
  shapeId: b2ShapeId
): BreakableCrateRuntime | undefined {
  const plank = breakableCratePlanksByShapeId.get(shapeId)
  if (!plank) {
    return undefined
  }
  const crate = breakableCrates.get(plank.crateId)
  return crate && !crate.destroyed ? crate : undefined
}

function getDamageableEntityByBodyId(
  bodyId: b2BodyId,
  skippedEntityId: number
): Entity | undefined {
  const entities = world.getEntities()
  for (let i = 0; i < entities.length; i++) {
    const entity = entities[i]
    if (
      entity.id === skippedEntityId ||
      !entity.physics ||
      !entity.stats ||
      entity.stats.isDead
    ) {
      continue
    }
    if (areBodyIdsEqual(entity.physics.bodyId, bodyId)) {
      return entity
    }
  }
  return undefined
}

function getFallImpactLevel(fallDistance1000: number): ImpactLevel {
  if (fallDistance1000 >= FALL_IMPACT_EXTREME_DISTANCE1000) {
    return 'extreme'
  }
  if (fallDistance1000 >= FALL_IMPACT_LARGE_DISTANCE1000) {
    return 'large'
  }
  return 'medium'
}

function updateFallImpactDirection(
  targetX: number,
  targetY: number,
  impactX: number,
  impactY: number
): void {
  const dirX = targetX - impactX
  const dirY = Math.abs(targetY - impactY)
  const distance = Math.hypot(dirX, dirY)
  if (distance > 0) {
    fallImpactDirectionX = dirX / distance
    fallImpactDirectionY = dirY / distance
    return
  }
  fallImpactDirectionX = 0
  fallImpactDirectionY = 1
}

function isValidFallImpactTargetPosition(
  impactY: number,
  targetCenterY: number,
  targetHalfHeight: number
): boolean {
  const targetBottomY = targetCenterY + targetHalfHeight
  const embedDepth1000 = Math.round((impactY - targetBottomY) * 1000)
  return embedDepth1000 <= FALL_IMPACT_EMBED_TOLERANCE1000
}

function getFallImpactImpulseVec(): InstanceType<MainModule['b2Vec2']> {
  if (!fallImpactImpulseVec) {
    fallImpactImpulseVec = new box2d.b2Vec2(0, 0)
  }
  return fallImpactImpulseVec
}

function applyFallImpactImpulseToBody(
  bodyId: b2BodyId,
  impactLevel: ImpactLevel
): void {
  const knockback = IMPACT_LEVEL_KNOCKBACK[impactLevel]
  if (knockback <= 0) {
    return
  }
  const { b2Body_ApplyLinearImpulseToCenter, b2Body_GetMass } = box2d
  const mass = b2Body_GetMass(bodyId)
  const impulseVec = getFallImpactImpulseVec()
  impulseVec.x = fallImpactDirectionX * knockback * 2 * mass
  impulseVec.y = fallImpactDirectionY * knockback * 2 * mass
  b2Body_ApplyLinearImpulseToCenter(bodyId, impulseVec, true)
}

function applyFallImpactTargetUnstickImpulse(bodyId: b2BodyId): void {
  const { b2Body_ApplyLinearImpulseToCenter, b2Body_GetMass } = box2d
  const mass = b2Body_GetMass(bodyId)
  const impulseVec = getFallImpactImpulseVec()
  impulseVec.x =
    (fallImpactDirectionX * FALL_IMPACT_TARGET_UNSTICK_VELOCITY1000 * mass) /
    1000
  impulseVec.y =
    (fallImpactDirectionY * FALL_IMPACT_TARGET_UNSTICK_VELOCITY1000 * mass) /
    1000
  b2Body_ApplyLinearImpulseToCenter(bodyId, impulseVec, true)
}

function applyFallImpactSourceUnstickImpulse(bodyId: b2BodyId): void {
  const { b2Body_ApplyLinearImpulseToCenter, b2Body_GetMass } = box2d
  const mass = b2Body_GetMass(bodyId)
  const impulseVec = getFallImpactImpulseVec()
  impulseVec.x =
    (-fallImpactDirectionX *
      FALL_IMPACT_SOURCE_UNSTICK_SIDE_VELOCITY1000 *
      mass) /
    1000
  impulseVec.y = -(FALL_IMPACT_SOURCE_UNSTICK_UP_VELOCITY1000 * mass) / 1000
  b2Body_ApplyLinearImpulseToCenter(bodyId, impulseVec, true)
}

function applyFallImpactDamageToEntity(
  entity: Entity,
  damage: number,
  impactX: number,
  impactY: number,
  impactLevel: ImpactLevel
): void {
  if (!statsSystem || !entity.stats || entity.stats.isDead) {
    return
  }
  fallImpactWeaponHit.attackDamage = damage
  fallImpactWeaponHit.impactLevel = impactLevel
  fallImpactWeaponHit.knockbackDirectionX = fallImpactDirectionX
  fallImpactWeaponHit.knockbackDirectionY = fallImpactDirectionY
  fallImpactHitSource.x = impactX
  fallImpactHitSource.y = impactY
  statsSystem.applyWeaponHit(entity, fallImpactWeaponHit, fallImpactHitSource)
}

function applyFallImpactTargetsFromBody(
  sourceBodyId: b2BodyId,
  damage: number,
  impactX: number,
  impactY: number,
  impactLevel: ImpactLevel,
  skippedEntityId: number,
  skippedCrateId: number,
  allowSourceCrateUnstick = false
): void {
  if (!box2d || damage < 0) {
    return
  }
  const {
    b2Body_GetContactCapacity,
    b2Body_GetContactData,
    b2Shape_GetBody,
    b2Shape_GetFilter,
  } = box2d
  const capacity = b2Body_GetContactCapacity(sourceBodyId)
  if (capacity <= 0) {
    return
  }

  fallImpactEntityIds.length = 0
  fallImpactCrateIds.length = 0
  const contactData = b2Body_GetContactData(sourceBodyId, capacity)
  for (let i = 0; i < contactData.length; i++) {
    const contact = contactData[i]
    const normalY = contact.manifold.normal.y
    const absNormalY = normalY < 0 ? -normalY : normalY
    if (absNormalY <= FALL_IMPACT_CONTACT_NORMAL_Y_MIN) {
      contact.delete()
      continue
    }

    const bodyA = b2Shape_GetBody(contact.shapeIdA)
    const bodyB = b2Shape_GetBody(contact.shapeIdB)
    const filterA = b2Shape_GetFilter(contact.shapeIdA)
    const filterB = b2Shape_GetFilter(contact.shapeIdB)
    let otherBody: b2BodyId | null = null
    let otherShapeId: b2ShapeId | null = null
    let otherCategory = 0
    if (areBodyIdsEqual(bodyA, sourceBodyId)) {
      otherBody = bodyB
      otherShapeId = contact.shapeIdB
      otherCategory = filterB.categoryBits
    } else if (areBodyIdsEqual(bodyB, sourceBodyId)) {
      otherBody = bodyA
      otherShapeId = contact.shapeIdA
      otherCategory = filterA.categoryBits
    }

    if (otherBody) {
      if (isObstacleCollisionCategory(otherCategory)) {
        const targetCrate =
          getBreakableCrateByBodyId(otherBody) ||
          (otherShapeId ? getBreakableCrateByShapeId(otherShapeId) : undefined)
        if (
          targetCrate &&
          targetCrate.id !== skippedCrateId &&
          !hasNumberValue(fallImpactCrateIds, targetCrate.id)
        ) {
          fallImpactCrateIds.push(targetCrate.id)
          updateFallImpactDirection(
            targetCrate.centerX,
            targetCrate.centerY,
            impactX,
            impactY
          )
          if (damage > 0) {
            applyFallImpactImpulseToBody(targetCrate.bodyId, impactLevel)
            applyBreakableCrateDamage(
              targetCrate.id,
              damage,
              impactX,
              impactY,
              impactLevel,
              skippedEntityId
            )
            if (targetCrate.health > 0 && allowSourceCrateUnstick) {
              applyFallImpactSourceUnstickImpulse(sourceBodyId)
            }
          } else if (allowSourceCrateUnstick) {
            applyFallImpactTargetUnstickImpulse(targetCrate.bodyId)
            applyFallImpactSourceUnstickImpulse(sourceBodyId)
          }
        }
      } else if (isCharacterCollisionCategory(otherCategory) && damage > 0) {
        const targetEntity = getDamageableEntityByBodyId(
          otherBody,
          skippedEntityId
        )
        if (
          targetEntity &&
          targetEntity.transform &&
          isValidFallImpactTargetPosition(
            impactY,
            targetEntity.transform.y,
            targetEntity.render?.radius ?? DEFAULT_PLAYER_RADIUS
          ) &&
          !hasNumberValue(fallImpactEntityIds, targetEntity.id)
        ) {
          fallImpactEntityIds.push(targetEntity.id)
          updateFallImpactDirection(
            targetEntity.transform.x,
            targetEntity.transform.y,
            impactX,
            impactY
          )
          applyFallImpactDamageToEntity(
            targetEntity,
            damage,
            impactX,
            impactY,
            impactLevel
          )
        }
      }
    }
    contact.delete()
  }
}

function queueBreakableCrateBreak(
  crateId: number,
  impactX: number,
  impactY: number,
  impactLevel: ImpactLevel,
  sourceEntityId: number
): void {
  const crate = breakableCrates.get(crateId)
  if (!crate || crate.destroyed) {
    return
  }
  detachBreakableCrateGrappleTethers(crate)
  if (pendingBreakableCrateBreakIds.has(crateId)) {
    return
  }
  pendingBreakableCrateBreakIds.add(crateId)
  pendingBreakableCrateBreaks.push({
    crateId,
    impactX,
    impactY,
    impactLevel,
    sourceEntityId,
  })
}

function getBreakableCrateImpactDamage(impactLevel: ImpactLevel): number {
  return impactLevel === 'large' || impactLevel === 'extreme'
    ? BREAKABLE_CRATE_IMPACT_DAMAGE_LARGE
    : BREAKABLE_CRATE_IMPACT_DAMAGE_SMALL
}

function getBreakableCrateHitDamage(hit: BreakableObstacleHit): number {
  const weaponDamage = hit.weapon?.attackDamage
  if (weaponDamage !== undefined && weaponDamage > 0) {
    return Math.max(1, Math.trunc(weaponDamage))
  }
  return getBreakableCrateImpactDamage(hit.impactLevel)
}

function emitBreakableCrateHitFeedback(
  crate: BreakableCrateRuntime,
  impactX: number,
  impactY: number
): void {
  const dirX = crate.centerX >= impactX ? 1 : -1

  for (let i = 0; i < crate.planks.length; i++) {
    const stats = crate.planks[i].entity?.stats
    if (!stats) {
      continue
    }
    stats.hitShakeElapsedMs = 0
    stats.hitShakeDurationMs = DEFAULT_HIT_SHAKE_DURATION_MS
    stats.hitShakeIntensity = DEFAULT_HIT_SHAKE_INTENSITY
    stats.hitShakeDirectionX = dirX
  }

  effectsEmitter.playSoundAt(SOUND_IDS.BODY_HIT, impactX, impactY)
}

function getBreakableCrateDebugStats(
  crate: BreakableCrateRuntime
): StatsComponent | undefined {
  if (!DEBUG_DRAW_BREAKABLE_CRATE_HEALTH) {
    return undefined
  }
  return crate.planks[0]?.entity?.stats
}

function syncBreakableCrateDebugStats(crate: BreakableCrateRuntime): void {
  const stats = getBreakableCrateDebugStats(crate)
  if (!stats) {
    return
  }
  stats.maxHealth = BREAKABLE_CRATE_MAX_HEALTH
  stats.health = crate.health
}

function applyBreakableCrateDamage(
  crateId: number,
  damage: number,
  impactX: number,
  impactY: number,
  impactLevel: ImpactLevel,
  sourceEntityId = 0
): void {
  const crate = breakableCrates.get(crateId)
  if (!crate || crate.destroyed || pendingBreakableCrateBreakIds.has(crateId)) {
    return
  }

  const damageValue = Math.max(1, Math.trunc(damage))
  crate.health -= damageValue
  const debugStats = getBreakableCrateDebugStats(crate)
  if (debugStats) {
    debugStats.maxHealth = BREAKABLE_CRATE_MAX_HEALTH
    debugStats.health = Math.max(0, crate.health)
    debugStats.healthBarTimerMs = 3000
    debugStats.pendingDamageTextValue += damageValue
    debugStats.pendingDamageTextToken += 1
  }
  if (crate.health <= 0) {
    crate.health = 0
    queueBreakableCrateBreak(
      crateId,
      impactX,
      impactY,
      impactLevel,
      sourceEntityId
    )
    return
  }

  emitBreakableCrateHitFeedback(crate, impactX, impactY)
}

function detachBreakableCrateGrappleTethers(
  crate: BreakableCrateRuntime
): void {
  if (!grappleSystem) {
    return
  }

  for (let i = 0; i < crate.planks.length; i++) {
    const plankEntity = crate.planks[i].entity
    if (plankEntity) {
      grappleSystem.detachTetherTarget(plankEntity.id)
    }
  }
}

function handleBreakableObstacleHit(hit: BreakableObstacleHit): void {
  const crateId = hit.obstacle.breakableId
  if (crateId === undefined) {
    return
  }
  applyBreakableCrateDamage(
    crateId,
    getBreakableCrateHitDamage(hit),
    hit.impactX,
    hit.impactY,
    hit.impactLevel,
    hit.attacker?.id ?? 0
  )
}

function handleEntityFallImpact(
  entity: Entity,
  damage: number,
  fallDistance1000: number
): void {
  if (
    !entity.physics ||
    !entity.transform ||
    damage < 0 ||
    fallDistance1000 <= 0
  ) {
    return
  }
  const sourceRadius = entity.render?.radius ?? DEFAULT_PLAYER_RADIUS
  const impactLevel = getFallImpactLevel(fallDistance1000)
  applyFallImpactTargetsFromBody(
    entity.physics.bodyId,
    damage,
    entity.transform.x,
    entity.transform.y + sourceRadius,
    impactLevel,
    entity.id,
    0,
    true
  )
}

// Helper for color parsing (simple cache)
const colorCache = new Map<string, number>()
function parseColor(color: string): number {
  if (colorCache.has(color)) return colorCache.get(color)!
  if (color.startsWith('#')) {
    const hex = color.slice(1)
    const val = parseInt(hex, 16)
    colorCache.set(color, val)
    return val
  }
  return 0
}

function getWeaponTypeId(weaponType: string | undefined): number {
  switch (weaponType) {
    case 'spear':
      return WEAPON_TYPES.SPEAR
    case 'hammer':
      return WEAPON_TYPES.BIG_HAMMER
    case 'bow':
      return WEAPON_TYPES.BOW
    case 'grape':
      return WEAPON_TYPES.GRAPE
    case 'hook':
      return WEAPON_TYPES.HOOK
    case 'bomb':
      return WEAPON_TYPES.BOMB
    case 'arrow':
      return WEAPON_TYPES.ARROW
    case 'grapeShot':
      return WEAPON_TYPES.GRAPE_SHOT
    case 'sword':
    default:
      return WEAPON_TYPES.SWORD
  }
}

function queueEffect(
  type: number,
  x: number,
  y: number,
  color: number,
  radius: number,
  renderLayer: number = 0
): void {
  if (effectsCount >= MAX_EFFECTS) {
    if (type !== EFFECT_TYPES.SOUND) return
    const base = EFFECTS_BASE_OFFSET + (MAX_EFFECTS - 1) * EFFECT_STRIDE
    stateBuffer[base + EFFECT_OFFSETS.TYPE] = type
    stateBuffer[base + EFFECT_OFFSETS.X] = x
    stateBuffer[base + EFFECT_OFFSETS.Y] = y
    stateBuffer[base + EFFECT_OFFSETS.COLOR] = color
    stateBuffer[base + EFFECT_OFFSETS.RADIUS] = radius
    stateBuffer[base + EFFECT_OFFSETS.RENDER_LAYER] = renderLayer
    return
  }
  const base = EFFECTS_BASE_OFFSET + effectsCount * EFFECT_STRIDE
  stateBuffer[base + EFFECT_OFFSETS.TYPE] = type
  stateBuffer[base + EFFECT_OFFSETS.X] = x
  stateBuffer[base + EFFECT_OFFSETS.Y] = y
  stateBuffer[base + EFFECT_OFFSETS.COLOR] = color
  stateBuffer[base + EFFECT_OFFSETS.RADIUS] = radius
  stateBuffer[base + EFFECT_OFFSETS.RENDER_LAYER] = renderLayer
  effectsCount += 1
}

const SUN_COLOR_INT = 0xffd700
const CHECKPOINT_PULSE_COLOR_INT = 0xffea5c
const CHECKPOINT_LEAF_CENTER_Y_NUMERATOR = 3
const CHECKPOINT_LEAF_CENTER_Y_DENOMINATOR = 4
const CHECKPOINT_PULSE_RADIUS_NUMERATOR = 11
const CHECKPOINT_PULSE_RADIUS_DENOMINATOR = 4

const effectsEmitter: EffectsEmitter = {
  emitSpark: (x, y) => {
    queueEffect(EFFECT_TYPES.SPARK, x, y, SPARK_COLOR_INT, 0)
  },
  emitParrySpark: (x, y, directionRad) => {
    queueEffect(EFFECT_TYPES.PARRY_SPARK, x, y, SPARK_COLOR_INT, directionRad)
  },
  emitBlood: (x, y, color) => {
    queueEffect(EFFECT_TYPES.BLOOD, x, y, color, 0)
  },
  emitDeath: (x, y, color, radius) => {
    queueEffect(EFFECT_TYPES.DEATH, x, y, color, radius)
  },
  emitHeal: (x, y, renderLayer = 0) => {
    queueEffect(EFFECT_TYPES.HEAL, x, y, SUN_COLOR_INT, 0, renderLayer)
  },
  emitCheckpointPulse: (x, y, radius, renderLayer = 0) => {
    queueEffect(
      EFFECT_TYPES.CHECKPOINT_PULSE,
      x,
      y,
      CHECKPOINT_PULSE_COLOR_INT,
      radius,
      renderLayer
    )
  },
  emitHammerCritHit: (x, y) => {
    queueEffect(EFFECT_TYPES.CRIT_BURST, x, y, 0, 0)
  },
  emitBombExplosion: (x, y, radius, renderLayer = 0) => {
    queueEffect(EFFECT_TYPES.BOMB_EXPLOSION, x, y, 0, radius, renderLayer)
  },
  emitCameraShake: (x, y, intensity, durationMs) => {
    queueEffect(EFFECT_TYPES.CAMERA_SHAKE, x, y, intensity, durationMs)
  },
  playSound: (soundId, playbackRate = 1.0, ignoreGlobalTimeScale = false) => {
    queueEffect(
      EFFECT_TYPES.SOUND,
      Number.NaN,
      Number.NaN,
      soundId,
      playbackRate,
      ignoreGlobalTimeScale ? SOUND_EFFECT_FLAGS.IGNORE_TIME_SCALE : 0
    )
  },
  playSoundAt: (
    soundId,
    x,
    y,
    playbackRate = 1.0,
    ignoreGlobalTimeScale = false
  ) => {
    queueEffect(
      EFFECT_TYPES.SOUND,
      x,
      y,
      soundId,
      playbackRate,
      ignoreGlobalTimeScale ? SOUND_EFFECT_FLAGS.IGNORE_TIME_SCALE : 0
    )
  },
}

// Game State needed for logic
let prevKeys = new Set<string>()
let currKeys = new Set<string>()
let prevMouseButtons = new Set<number>()
let currMouseButtons = new Set<number>()
let rHoldMs = 0
let rHoldActive = false
let rHoldTriggered = false
let eUsedForUltimate = false
let lockCancelOnReleaseArmed = false
let lockSwitchAttemptedDuringHold = false
let lockSwitchMouseSwipeStartMs = -1
let lockSwitchMouseLastMoveMs = -1
let lockSwitchMouseSwipeAccumX = 0
let lockSwitchMouseSwipeAccumY = 0
let lockSwitchMouseSwipeConsumed = false
let canvasHeight = 0
let pixelsPerMeter = 50
let groundFriction = DEFAULT_GROUND_FRICTION
let obstacleFriction = DEFAULT_OBSTACLE_FRICTION
let groundTopY = 0
const GRAPPLE_TARGET_RANGE_SQ = DEFAULT_GRAPPLE_RANGE * DEFAULT_GRAPPLE_RANGE
const LOCK_SWITCH_MOUSE_SWIPE_THRESHOLD_PX = 30
const LOCK_SWITCH_MOUSE_SWIPE_WINDOW_MS = 180
const LOCK_SWITCH_MOUSE_IDLE_RESET_MS = 120
const LOCK_SWITCH_MOUSE_SWIPE_MIN_SPEED_PX_PER_SEC = 240

// Parameter buffer for async init
const pendingParams: Record<string, number> = {}

// Camera tracking logic (moved from Main to here to send correct camera pos)
const camera = { x: 0, y: 0 }
let zoom = DEFAULT_CAMERA_ZOOM
let requestedZoom = DEFAULT_CAMERA_ZOOM
let targetZoom = DEFAULT_CAMERA_ZOOM
let canvasWidth = 0
let isCameraLocked = false
let isTransitioning = false
let transitionStartTime = 0
let transitionStartCameraX = 0
let lastVelocityDirection = 0
let needsReturnToCenter = false
let lastUnlockTime = 0
let currentTime = 0
let outOfCenterTime = 0
let horizontalForceCenterAfterEmergency = false

// Vertical Camera State
let isVerticalCameraLocked = false
let isVerticalTransitioning = false
let verticalTransitionStartTime = 0
let verticalTransitionStartCameraY = 0
let verticalOutOfCenterTime = 0
let lastVerticalUnlockTime = 0
let initialPlayerScreenRatioY = 0.8
let verticalLookAheadOffsetY = 0
let verticalForceCenterAfterEmergency = false
let ultimateCameraActive = false
let ultimateCameraTargetX = 0
let ultimateCameraTargetY = 0
let ultimateCameraTargetZoom = DEFAULT_CAMERA_ZOOM
let timeScale1000 = 1000

const TRANSITION_DURATION = 3
const VERTICAL_TRANSITION_DURATION = 6
const UNLOCK_COOLDOWN = 0.2
const OUTSIDE_THIRD_RELOCK_DELAY = 0.15
const CAMERA_FORWARD_OFFSET = 0.67 // 2/3 角色宽度前向偏移
const HORIZONTAL_CENTER_UNLOCK_EPSILON_RATIO = 0.02
const VERTICAL_LOCK_SCREEN_RATIO = 0.5
const VERTICAL_FOLLOW_LERP = 0.08
const VERTICAL_CENTER_UNLOCK_EPSILON_RATIO = 0.02
const VERTICAL_LOOK_AHEAD_TIME = 0.18
const VERTICAL_LOOK_AHEAD_MAX = 1.2
const VERTICAL_LOOK_AHEAD_LERP = 0.2
const ULTIMATE_CAMERA_SCREEN_RATIO_Y = 0.62
const ULTIMATE_CAMERA_SWORD_ZOOM = 0.5
const ULTIMATE_CAMERA_SPEAR_ZOOM = 0.48
const ULTIMATE_CAMERA_HAMMER_ZOOM = 0.42
const HAMMER_ULTIMATE_CAMERA_FOCUS_OFFSET_Y = 4
const ASSASSINATION_CAMERA_ZOOM = 1.45
const ASSASSINATION_CAMERA_FOCUS_OFFSET_Y = 1
const DEFAULT_TIME_SCALE_1000 = 1000
const ASSASSINATION_TIME_SCALE_1000 = 250

// Reusable message object for sendState
const stateMessage: WorkerStateMessage = {
  type: 'state',
  entitiesBuffer: null as unknown as ArrayBuffer | SharedArrayBuffer,
  entityCount: 0,
  effectsCount: 0,
  ropePointCount: 0,
  camera: { x: 0, y: 0 },
  zoom: DEFAULT_CAMERA_ZOOM,
  timeScale1000: DEFAULT_TIME_SCALE_1000,
}

const debugMessage: WorkerDebugMessage = {
  type: 'debug',
  sensors: [],
  soundWaves: [],
  soundListeners: [],
  camera: null,
  spineCollisions: [],
}
const perfSnapshotMessage: WorkerPerfSnapshotMessage = {
  type: 'perf_snapshot',
  updateAvgUs: 0,
  updateMaxUs: 0,
  fixedAvgUs: 0,
  fixedMaxUs: 0,
  fixedStepsAvg100: 0,
  fixedStepsMax: 0,
  spatialHashAvgUs: 0,
  worldUpdateAvgUs: 0,
  pickupCollectAvgUs: 0,
  pickupUpdateAvgUs: 0,
  cleanupAvgUs: 0,
  cameraAvgUs: 0,
  sendStateAvgUs: 0,
  entityCount: 0,
  breakableCrateCount: 0,
  breakableCrateAwakeCount: 0,
  breakableCratePlankCount: 0,
  systemNames: [],
  systemAvgUs: [],
  systemMaxUs: [],
}
const debugSensors: SensorDebugData[] = []
const debugSoundWaves: SoundWaveDebugData[] = []
const debugSoundListeners: SoundListenerDebugData[] = []
const debugCameraData: CameraDebugData = {
  topLimitRatio: 1 - initialPlayerScreenRatioY,
  bottomLimitRatio: initialPlayerScreenRatioY,
  playerScreenY: 0,
  playerFeetY: 0,
  cameraY: 0,
  zoom: DEFAULT_CAMERA_ZOOM,
  isOutsideVerticalZone: false,
}
const emptySoundWaves: SoundWaveDebugData[] = []
const emptySoundListeners: SoundListenerDebugData[] = []
const emptySensors: SensorDebugData[] = []
const emptySpineCollisions: WorkerDebugMessage['spineCollisions'] = []
let hadSpineCollisionDebugLastFrame = false
const playerEntityView: Entity[] = []
const sunPickupEntityBuffer: Entity[] = []
const expOrbEntityBuffer: Entity[] = []
const workerPerfSystemNames: string[] = []
const workerPerfSystemTotalsUs: number[] = []
const workerPerfSystemMaxUs: number[] = []
let workerPerfWindowMs = 0
let workerPerfUpdateCount = 0
let workerPerfUpdateTotalUs = 0
let workerPerfUpdateMaxUs = 0
let workerPerfFixedCount = 0
let workerPerfFixedTotalUs = 0
let workerPerfFixedMaxUs = 0
let workerPerfFixedStepsTotal = 0
let workerPerfFixedStepsMax = 0
let workerPerfSpatialHashTotalUs = 0
let workerPerfWorldUpdateTotalUs = 0
let workerPerfPickupCollectTotalUs = 0
let workerPerfPickupUpdateTotalUs = 0
let workerPerfCleanupTotalUs = 0
let workerPerfCameraTotalUs = 0
let workerPerfSendStateCount = 0
let workerPerfSendStateTotalUs = 0

// Loop Logic
let lastTime = performance.now()
let accumulator = 0

async function init(width: number, height: number, ppm: number) {
  canvasWidth = width
  canvasHeight = height
  pixelsPerMeter = ppm

  await initializeTerrainPolygonUtils()

  const defaultMapResult = await ensureDefaultMap(width, height, ppm)
  defaultMapData = defaultMapResult.data
  activeMapData = defaultMapData
  isMapPreview = false
  isThumbnailCameraCapture = false

  initStateBuffers()

  box2d = await Box2DFactory()
  const { b2DefaultWorldDef, b2CreateWorld, b2Vec2 } = box2d

  const worldDef = b2DefaultWorldDef()
  worldDef.gravity = new b2Vec2(0, DEFAULT_GRAVITY)
  worldId = b2CreateWorld(worldDef)
  worldDef.delete()

  world = new World()
  spatialHash = new SpatialHash(5)

  registerComponents()
  refreshActiveMapCollisionLayers()

  // Setup Environment
  const groundHeight = 0.5
  const groundY = canvasHeight / pixelsPerMeter - groundHeight
  groundTopY = groundY - groundHeight
  createEnvironment()
  if (activeMapData) {
    const runtimeMapData = buildRuntimeMapData(activeMapData)
    if (runtimeMapData) {
      ctx.postMessage({
        type: 'map_data',
        map: runtimeMapData,
      })
    }
  }

  initializeSystems()
  syncWorkerPerfSystemBuffers()
  resetWorkerPerfWindow()
  npcEntity = null
  createPlayerAndWeapon(groundTopY, activeMapData)

  // Initialize camera to center on player
  if (activeMapData) {
    applyMapCamera(activeMapData)
  } else if (playerEntity && playerEntity.transform) {
    const centerX = canvasWidth / 2
    camera.x = playerEntity.transform.x - centerX / pixelsPerMeter

    // Vertical initialization: Camera at top (0), Player near bottom
    const canvasHeightInMeters = canvasHeight / pixelsPerMeter
    camera.y = canvasHeightInMeters - canvasHeightInMeters // Effectively 0

    initialPlayerScreenRatioY = 0.8

    isCameraLocked = true
  }
  Object.entries(pendingParams).forEach(([id, value]) => {
    updateParam(id, value)
  })

  // Start Loop
  lastTime = performance.now()
  accumulator = 0
  currentTime = 0
  clearInterval(loopInterval)
  loopInterval = setInterval(update, 1000 / TARGET_FPS)
}

async function reloadDefaultMap() {
  if (canvasWidth <= 0 || canvasHeight <= 0 || pixelsPerMeter <= 0) {
    return
  }
  const defaultMapResult = await ensureDefaultMap(
    canvasWidth,
    canvasHeight,
    pixelsPerMeter
  )
  defaultMapData = defaultMapResult.data
  if (!isMapPreview) {
    activeMapData = defaultMapData
  }
}

function initStateBuffers(): void {
  effectsCount = 0
  if (supportsSharedArrayBuffer) {
    sharedStateBuffer = new SharedArrayBuffer(STATE_BUFFER_BYTES)
    stateBuffer = new Float32Array(sharedStateBuffer)
    stateBufferViews.length = 0
    return
  }

  sharedStateBuffer = null
  stateBufferViews.length = 0
  for (let i = 0; i < 2; i++) {
    const buffer = new ArrayBuffer(STATE_BUFFER_BYTES)
    stateBufferViews.push(new Float32Array(buffer))
  }
  const initialView = stateBufferViews.pop()
  if (initialView) {
    stateBuffer = initialView
  }
}

function syncWorkerPerfSystemBuffers(): void {
  const systemNames = world.getSystemPerfNames()
  if (workerPerfSystemNames.length === systemNames.length) {
    return
  }
  workerPerfSystemNames.length = systemNames.length
  workerPerfSystemTotalsUs.length = systemNames.length
  workerPerfSystemMaxUs.length = systemNames.length
  for (let i = 0; i < systemNames.length; i++) {
    workerPerfSystemNames[i] = systemNames[i]
    workerPerfSystemTotalsUs[i] = 0
    workerPerfSystemMaxUs[i] = 0
  }
}

function resetWorkerPerfWindow(): void {
  workerPerfWindowMs = 0
  workerPerfUpdateCount = 0
  workerPerfUpdateTotalUs = 0
  workerPerfUpdateMaxUs = 0
  workerPerfFixedCount = 0
  workerPerfFixedTotalUs = 0
  workerPerfFixedMaxUs = 0
  workerPerfFixedStepsTotal = 0
  workerPerfFixedStepsMax = 0
  workerPerfSpatialHashTotalUs = 0
  workerPerfWorldUpdateTotalUs = 0
  workerPerfPickupCollectTotalUs = 0
  workerPerfPickupUpdateTotalUs = 0
  workerPerfCleanupTotalUs = 0
  workerPerfCameraTotalUs = 0
  workerPerfSendStateCount = 0
  workerPerfSendStateTotalUs = 0
  for (let i = 0; i < workerPerfSystemTotalsUs.length; i++) {
    workerPerfSystemTotalsUs[i] = 0
    workerPerfSystemMaxUs[i] = 0
  }
}

function postWorkerPerfSnapshot(entityCount: number): void {
  const systemAvgUs = perfSnapshotMessage.systemAvgUs
  const systemMaxUs = perfSnapshotMessage.systemMaxUs
  const systemNames = perfSnapshotMessage.systemNames
  let breakableCratePlankCount = 0
  let breakableCrateAwakeCount = 0
  for (const crate of breakableCrates.values()) {
    breakableCratePlankCount += crate.planks.length
    if (box2d?.b2Body_IsAwake(crate.bodyId)) {
      breakableCrateAwakeCount++
    }
  }
  const fixedCount = workerPerfFixedCount > 0 ? workerPerfFixedCount : 1
  const updateCount = workerPerfUpdateCount > 0 ? workerPerfUpdateCount : 1
  perfSnapshotMessage.updateAvgUs = Math.round(
    workerPerfUpdateTotalUs / updateCount
  )
  perfSnapshotMessage.updateMaxUs = workerPerfUpdateMaxUs
  perfSnapshotMessage.fixedAvgUs = Math.round(
    workerPerfFixedTotalUs / fixedCount
  )
  perfSnapshotMessage.fixedMaxUs = workerPerfFixedMaxUs
  perfSnapshotMessage.fixedStepsAvg100 = Math.round(
    (workerPerfFixedStepsTotal * 100) / updateCount
  )
  perfSnapshotMessage.fixedStepsMax = workerPerfFixedStepsMax
  perfSnapshotMessage.spatialHashAvgUs = Math.round(
    workerPerfSpatialHashTotalUs / fixedCount
  )
  perfSnapshotMessage.worldUpdateAvgUs = Math.round(
    workerPerfWorldUpdateTotalUs / fixedCount
  )
  perfSnapshotMessage.pickupCollectAvgUs = Math.round(
    workerPerfPickupCollectTotalUs / fixedCount
  )
  perfSnapshotMessage.pickupUpdateAvgUs = Math.round(
    workerPerfPickupUpdateTotalUs / fixedCount
  )
  perfSnapshotMessage.cleanupAvgUs = Math.round(
    workerPerfCleanupTotalUs / fixedCount
  )
  perfSnapshotMessage.cameraAvgUs = Math.round(
    workerPerfCameraTotalUs / fixedCount
  )
  perfSnapshotMessage.sendStateAvgUs = Math.round(
    workerPerfSendStateTotalUs /
      (workerPerfSendStateCount > 0 ? workerPerfSendStateCount : 1)
  )
  perfSnapshotMessage.entityCount = entityCount
  perfSnapshotMessage.breakableCrateCount = breakableCrates.size
  perfSnapshotMessage.breakableCrateAwakeCount = breakableCrateAwakeCount
  perfSnapshotMessage.breakableCratePlankCount = breakableCratePlankCount

  systemNames.length = workerPerfSystemNames.length
  systemAvgUs.length = workerPerfSystemNames.length
  systemMaxUs.length = workerPerfSystemNames.length
  for (let i = 0; i < workerPerfSystemNames.length; i++) {
    systemNames[i] = workerPerfSystemNames[i]
    systemAvgUs[i] = Math.round(workerPerfSystemTotalsUs[i] / fixedCount)
    systemMaxUs[i] = workerPerfSystemMaxUs[i]
  }
  ctx.postMessage(perfSnapshotMessage)
  resetWorkerPerfWindow()
}

function releaseStateBuffer(buffer: ArrayBuffer): void {
  if (sharedStateBuffer) return
  if (buffer.byteLength !== STATE_BUFFER_BYTES) return
  stateBufferViews.push(new Float32Array(buffer))
}

function registerComponents() {
  componentRegistry.registerComponent('Transform')
  componentRegistry.registerComponent('Physics')
  componentRegistry.registerComponent('Movement')
  componentRegistry.registerComponent('Input')
  componentRegistry.registerComponent('Render')
  componentRegistry.registerComponent('Stats')
  componentRegistry.registerComponent('Weapon')
  componentRegistry.registerComponent('WeaponSlots')
  componentRegistry.registerComponent('AttackSlots')
  componentRegistry.registerComponent('Arrow')
  componentRegistry.registerComponent('Faction')
  componentRegistry.registerComponent('NpcAI')
  componentRegistry.registerComponent('NpcDropTable')
  componentRegistry.registerComponent('Checkpoint')
  componentRegistry.registerComponent('Grapple')
  componentRegistry.registerComponent('GrappleAnchor')
  componentRegistry.registerComponent('GrappleTarget')
  componentRegistry.registerComponent('SolarEnergy')
  componentRegistry.registerComponent('SunPickup')
  componentRegistry.registerComponent('ExpOrb')
  componentRegistry.registerComponent('TerrainDebris')
  componentRegistry.registerComponent('Level')
  componentRegistry.registerComponent('Follow')
}

function initializeSystems() {
  statsSystem = new StatsSystem(box2d, worldId)
  statsSystem.setEffectsEmitter(effectsEmitter)
  statsSystem.setBloodEffectsEnabled(false)
  checkpointSystem = new CheckpointSystem()
  checkpointSystem.setCheckpointActivatedHandler(() => {
    if (isMapPreview) {
      return
    }
    ctx.postMessage(checkpointActivatedMessage)
  })
  checkpointSystem.setCheckpointSleepHandler(() => {
    ctx.postMessage(checkpointSleepMessage)
  })
  checkpointSystem.setCheckpointEnteredHandler((entity, _alreadyActive) => {
    if (!entity.transform) {
      return
    }
    const renderRadius = entity.render?.radius ?? 0
    const pulseY =
      entity.transform.y -
      (renderRadius * CHECKPOINT_LEAF_CENTER_Y_NUMERATOR) /
        CHECKPOINT_LEAF_CENTER_Y_DENOMINATOR
    const pulseRadius =
      (renderRadius * CHECKPOINT_PULSE_RADIUS_NUMERATOR) /
      CHECKPOINT_PULSE_RADIUS_DENOMINATOR
    effectsEmitter.emitCheckpointPulse(
      entity.transform.x,
      pulseY,
      pulseRadius,
      entity.render?.renderLayer ?? 0
    )
    if (
      playerEntity?.stats &&
      playerEntity.transform &&
      !playerEntity.stats.isDead
    ) {
      playerEntity.stats.health = playerEntity.stats.maxHealth
      effectsEmitter.emitHeal(
        playerEntity.transform.x,
        playerEntity.transform.y,
        playerEntity.render?.renderLayer ?? 0
      )
    }
    // 技能次数回满
    if (playerEntity?.attackSlots) {
      const skill = playerEntity.attackSlots.skill
      if (skill.skillId) {
        skill.chargesRemaining = skill.maxCharges
        if (playerEntity.weapon) {
          playerEntity.weapon.skillCharges = skill.maxCharges
        }
        if (playerEntity.weaponSlots) {
          const main = playerEntity.weaponSlots.main
          const secondary = playerEntity.weaponSlots.secondary
          if (main.skillId) main.skillCharges = DEFAULT_SKILL_MAX_CHARGES
          if (secondary.skillId)
            secondary.skillCharges = DEFAULT_SKILL_MAX_CHARGES
        }
      }
    }
  })
  checkpointSystem.setPlayerDeadHandler(() => {
    ctx.postMessage(playerDeadMessage)
  })
  soundSystem = new SoundSystem()
  npcAISystem = new NpcAISystem(box2d, worldId)
  followSystem = new FollowSystem()
  physicsSystem = new PhysicsSystem(box2d, worldId)
  movementSystem = new MovementSystem(box2d)
  grappleSystem = new GrappleSystem(world, box2d, worldId)
  spineSegmentManager = new SpineSegmentManager(box2d, worldId)
  skeletalSegmentManager = new SkeletalSegmentManager(box2d, worldId)
  weaponSystem = new WeaponSystem(box2d, statsSystem)
  arrowSystem = new ArrowSystem(box2d, statsSystem)
  arrowPools = new ArrowPools()
  interactionSystem = new InteractionSystem()
  statsSystem.setWeaponSystem(weaponSystem)
  statsSystem.setSoundSystem(soundSystem)
  npcAISystem.setWeaponSystem(weaponSystem)
  movementSystem.setSoundSystem(soundSystem)
  movementSystem.setStatsSystem(statsSystem)
  movementSystem.setFallImpactHandler(handleEntityFallImpact)
  physicsSystem.addAfterStepCallback(syncBreakableCrateRuntimes)
  grappleSystem.setStatsSystem(statsSystem)
  weaponSystem.setSoundSystem(soundSystem)
  weaponSystem.setBreakableObstacleHitHandler(handleBreakableObstacleHit)
  weaponSystem.setRopeHitHandler((hit) => grappleSystem.hitRopesInOBB(hit))
  weaponSystem.setRopeCircleHitHandler((hit) =>
    grappleSystem.hitRopesInCircle(hit)
  )
  arrowSystem.setSoundSystem(soundSystem)
  arrowSystem.setBreakableObstacleHitHandler(handleBreakableObstacleHit)
  arrowSystem.setRopeHitHandler((hit) => grappleSystem.hitRopesInOBB(hit))
  interactionSystem.setWeaponSystem(weaponSystem)
  interactionSystem.setCheckpointSystem(checkpointSystem)
  interactionSystem.setGrappleSystem(grappleSystem)
  sunPickupSystem = new SunPickupSystem()
  sunPickupSystem.setEffectsEmitter(effectsEmitter)
  expOrbSystem = new ExpOrbSystem()
  expOrbSystem.setEffectsEmitter(effectsEmitter)
  expOrbSystem.setLevelUpHandler((player) => {
    const previousLevel =
      player.level && player.level.level > 1 ? player.level.level - 1 : 1
    const previousMaxHealth =
      player.level && player.level.level > 1
        ? getPlayerDerivedMaxHealth(player.level.baseMaxHealth, previousLevel)
        : (player.stats?.maxHealth ?? 0)
    syncPlayerUpgradeState(player, true, false, true)
    emitPlayerLevelUpPrompt(previousMaxHealth, previousLevel)
  })
  statsSystem.onNpcDeath = (entity: Entity) => {
    dropNpcConfiguredLoot(entity)
  }
  statsSystem.onNpcVanish = (x: number, y: number, renderLayer: number = 0) => {
    const {
      b2DefaultBodyDef,
      b2CreateBody,
      b2BodyType,
      b2DefaultShapeDef,
      b2CreateCircleShape,
      b2Circle,
      b2Body_SetLinearVelocity,
    } = box2d
    const sun = world.createEntity()
    const t = new TransformComponent()
    t.x = x
    t.y = y
    sun.addComponent(t)

    const bodyDef = b2DefaultBodyDef()
    bodyDef.type = b2BodyType.b2_dynamicBody
    bodyDef.position.Set(x, y)
    bodyDef.linearDamping = 1.0
    bodyDef.motionLocks.angularZ = true
    const bodyId = b2CreateBody(worldId, bodyDef)

    const shapeDef = b2DefaultShapeDef()
    shapeDef.density = 0.3
    shapeDef.material.friction = 0.3
    shapeDef.material.restitution = 0.1
    shapeDef.filter.categoryBits = getWeaponCollisionCategory(renderLayer)
    shapeDef.filter.maskBits = getWeaponCollisionMask(renderLayer)

    const circle = new b2Circle()
    circle.center.Set(0, 0)
    circle.radius = 0.15
    b2CreateCircleShape(bodyId, shapeDef, circle)

    // 小幅抛物线初速：横向随机，向上弹起
    const vel = new box2d.b2Vec2(
      Math.random() * 4 - 2,
      -(8 + Math.random() * 4)
    )
    b2Body_SetLinearVelocity(bodyId, vel)
    vel.delete()
    bodyDef.delete()
    shapeDef.delete()
    circle.delete()

    const physics = new PhysicsComponent()
    physics.bodyId = bodyId
    sun.addComponent(physics)

    const sunRender = new RenderComponent()
    sunRender.visible = true
    sunRender.renderLayer = renderLayer
    sun.addComponent(sunRender)

    const p = new SunPickupComponent()
    p.isLarge = false
    p.pickupRadiusSq = 1
    sun.addComponent(p)
  }
  targetingSystem = new TargetingSystem(box2d, worldId)

  const entityLookup = world.getEntityById.bind(world)
  npcAISystem.setEntityLookup(entityLookup)
  movementSystem.setEntityLookup(entityLookup)
  spineSegmentManager.setEntityLookup(entityLookup)
  skeletalSegmentManager.setEntityLookup(entityLookup)
  targetingSystem.setEntityLookup(entityLookup)
  targetingSystem.setSpatialHash(spatialHash)
  weaponSystem.setEntityLookup(entityLookup)
  followSystem.setEntityLookup(entityLookup)
  weaponSystem.setSpineSegmentManager(spineSegmentManager)
  weaponSystem.setSkeletalSegmentManager(skeletalSegmentManager)

  for (const collisionData of spineCollisionDataByNpcType.values()) {
    spineSegmentManager.setCollisionData(collisionData)
  }

  // 关键：MovementSystem必须在PhysicsSystem之前执行
  // 这样施加的力才能在当前帧的b2World_Step中被处理
  world.addSystem(statsSystem)
  world.addSystem(checkpointSystem)
  world.addSystem(soundSystem)
  world.addSystem(npcAISystem)
  world.addSystem(followSystem)
  world.addSystem(movementSystem)
  world.addSystem(grappleSystem)
  world.addSystem(spineSegmentManager)
  world.addSystem(skeletalSegmentManager)
  world.addSystem(physicsSystem)
  world.addSystem(weaponSystem)
  world.addSystem(arrowSystem)
  world.addSystem(targetingSystem)
  world.addSystem(interactionSystem) // 交互系统在weaponSystem之后执行

  world.setComponentPool(arrowPools)
  weaponSystem.setObstacles(obstacles)
  arrowSystem.setObstacles(obstacles)
  weaponSystem.setStandableSurfaces(standableSurfaces)
  weaponSystem.setWorld(world, worldId, groundTopY)
  weaponSystem.setArrowPools(arrowPools)
  weaponSystem.setTerrainImpactCallback(handleTerrainImpact)
  weaponSystem.setViewportSize(
    canvasWidth / pixelsPerMeter,
    canvasHeight / pixelsPerMeter
  )
  arrowSystem.setSpatialHash(spatialHash)
  arrowSystem.setWorld(world)
  arrowSystem.setArrowPools(arrowPools)
  physicsSystem.addAfterStepCallback(() => {
    spineSegmentManager.syncAfterPhysics()
    skeletalSegmentManager.syncAfterPhysics()
  })
  syncWorkerPerfSystemBuffers()
}

function createGameNpc(
  x: number,
  y: number,
  groundY: number,
  npcType: NpcType,
  options?: NpcSpawnConfig
): Entity {
  const collisionData = spineCollisionDataByNpcType.get(npcType)
  const profileSpineKey = options?.bodyProfile?.spineKey
  const profileAnimationName = options?.bodyProfile?.spineAnimationName
  const segmentedCollision =
    npcType === 'caterpillar' &&
    collisionData !== undefined &&
    spineSegmentManager.hasDataForNpcType('caterpillar') &&
    (!profileSpineKey || profileSpineKey === collisionData.spineKey) &&
    (!profileAnimationName ||
      profileAnimationName === collisionData.animationName)
  const template =
    CHARACTER_DEFAULT_DATA[npcType as keyof typeof CHARACTER_DEFAULT_DATA] ??
    CHARACTER_DEFAULT_DATA.default
  const spawnRadius = options?.radius ?? template.radius
  const segmentedProxyMetrics =
    segmentedCollision && collisionData
      ? buildSegmentedProxyMetrics(
          collisionData,
          options?.bodyProfile,
          spawnRadius
        )
      : null
  const created = createNpc(world, box2d, worldId, x, y, groundY, npcType, {
    ...options,
    segmentedCollision,
    segmentedProxyHalfWidth: segmentedProxyMetrics?.halfWidth ?? 0,
    segmentedProxyHalfHeight: segmentedProxyMetrics?.halfHeight ?? 0,
    segmentedProxyOffsetY: segmentedProxyMetrics?.offsetY ?? 0,
  })
  if (segmentedCollision) {
    spineSegmentManager.createSegments(created, npcType)
  }
  if (created.render?.bodyProfile?.skeletalMode) {
    skeletalSegmentManager.createSegments(created)
  }
  return created
}

function createGround(): b2BodyId {
  const {
    b2DefaultBodyDef,
    b2CreateBody,
    b2MakeBox,
    b2DefaultShapeDef,
    b2CreatePolygonShape,
  } = box2d

  const groundHeight = 0.5
  const canvasHeightInMeters = canvasHeight / pixelsPerMeter
  const groundY = canvasHeightInMeters - groundHeight

  const groundDef = b2DefaultBodyDef()
  groundDef.position.Set(0, groundY)
  const bodyId = b2CreateBody(worldId, groundDef)

  const groundBox = b2MakeBox(50, groundHeight)
  const shapeDef = b2DefaultShapeDef()
  shapeDef.material.friction = groundFriction
  shapeDef.material.restitution = 0
  shapeDef.filter.categoryBits = getGroundCollisionCategory(0)
  shapeDef.filter.maskBits = getGroundCollisionMask(0)
  const shapeId = b2CreatePolygonShape(bodyId, shapeDef, groundBox)
  groundShapeIds.push(shapeId)

  groundDef.delete()
  groundBox.delete()
  shapeDef.delete()

  return bodyId
}

interface BoxObstacleConfig {
  type: 'box'
  x: number
  width: number
  height: number
}

interface PolygonObstacleConfig {
  type: 'polygon'
  x: number
  vertices: { x: number; y: number }[]
}

type ObstacleConfig = BoxObstacleConfig | PolygonObstacleConfig

function createObstacles() {
  const {
    b2DefaultBodyDef,
    b2CreateBody,
    b2MakeBox,
    b2DefaultShapeDef,
    b2CreatePolygonShape,
    b2ComputeHull,
    b2MakePolygon,
    b2Vec2,
  } = box2d

  const canvasHeightInMeters = canvasHeight / pixelsPerMeter
  const groundY = canvasHeightInMeters - 0.5
  obstacles = []

  const obstacleConfigs: ObstacleConfig[] = []

  // Cap parameters
  const CAP_TOTAL_HEIGHT = 0.1
  const CAP_HALF_HEIGHT = CAP_TOTAL_HEIGHT / 2

  obstacleConfigs.forEach((obs: ObstacleConfig) => {
    if (obs.type === 'polygon') {
      const bodyDef = b2DefaultBodyDef()
      // Place at ground level (groundY - 0.5 is the top surface of the ground box)
      bodyDef.position.Set(obs.x, groundY - 0.5)
      const bodyId = b2CreateBody(worldId, bodyDef)

      // Convert vertices to b2Vec2 array
      // Note: b2ComputeHull typically expects a pointer or typed array in WASM.
      // If we can't easily pass JS objects, we might need to alloc.
      // Trying the most likely working method for box2d-wasm (passing array of {x,y} or b2Vec2 objects).
      const points = obs.vertices.map((v) => new b2Vec2(v.x, v.y))
      const hull: b2Hull = b2ComputeHull(points)
      const polygon: b2Polygon = b2MakePolygon(hull, 0)

      const shapeDef = b2DefaultShapeDef()
      shapeDef.material.friction = obstacleFriction
      shapeDef.material.restitution = 0
      shapeDef.filter.categoryBits = getObstacleCollisionCategory(0)
      shapeDef.filter.maskBits = getObstacleCollisionMask(0)
      const shapeId = b2CreatePolygonShape(bodyId, shapeDef, polygon)

      // Clean up
      points.forEach((p) => p.delete())
      // hull and polygon are structs returned by value or pointer?
      // In box2d-wasm, usually if created via `new`, we delete.
      // b2ComputeHull returns a value struct in C++, so WASM likely returns a JS object wrapper.
      // Attempting delete to be safe, if it exists.

      interface MaybeDisposable {
        delete?: () => void
      }

      const disposableHull = hull as unknown as MaybeDisposable
      if (disposableHull.delete) disposableHull.delete()

      const disposablePolygon = polygon as unknown as MaybeDisposable
      if (disposablePolygon.delete) disposablePolygon.delete()

      // Calculate AABB for WeaponSystem
      let minX = 0,
        maxX = 0,
        minY = 0,
        maxY = 0
      obs.vertices.forEach((v) => {
        if (v.x < minX) minX = v.x
        if (v.x > maxX) maxX = v.x
        if (v.y < minY) minY = v.y
        if (v.y > maxY) maxY = v.y
      })

      const centerX = obs.x
      const centerY = groundY - 0.5
      const worldVertices = obs.vertices.map((vertex) => ({
        x: centerX + vertex.x,
        y: centerY + vertex.y,
      }))

      obstacles.push({
        bodyId,
        mainShapeId: shapeId,
        capBodyId: bodyId, // Use same body for cap for now (simplified for polygons)
        capShapeId: shapeId,
        centerX,
        centerY,
        width: Math.max(Math.abs(minX), Math.abs(maxX)),
        height: Math.abs(minY), // Height approx
        renderLayer: 0,
        materialTag: 'obstacle',
        vertices: obs.vertices,
        worldVertices,
      })

      bodyDef.delete()
      shapeDef.delete()
      return
    }

    // Box logic (existing)
    const originalHalfH = obs.height
    // Ensure obstacle is tall enough for the cap
    if (originalHalfH * 2 <= CAP_TOTAL_HEIGHT) {
      return
    }

    // Calculate split dimensions
    const baseTotalHeight = originalHalfH * 2 - CAP_TOTAL_HEIGHT
    const baseHalfHeight = baseTotalHeight / 2

    // Calculate positions
    const originalCenterY = groundY - originalHalfH
    const topY = originalCenterY - originalHalfH
    const bottomY = originalCenterY + originalHalfH

    // New Cap Center: Top + CapHalf
    const capY = topY + CAP_HALF_HEIGHT
    // New Base Center: Bottom - BaseHalf
    const baseY = bottomY - baseHalfHeight

    // 1. Create Cap (Top Surface with Friction)
    const capBodyDef = b2DefaultBodyDef()
    capBodyDef.position.Set(obs.x, capY)
    const capBodyId = b2CreateBody(worldId, capBodyDef)

    const capBox = b2MakeBox(obs.width, CAP_HALF_HEIGHT)
    const capShapeDef = b2DefaultShapeDef()
    capShapeDef.material.friction = obstacleFriction
    capShapeDef.material.restitution = 0
    capShapeDef.filter.categoryBits = getObstacleCollisionCategory(0)
    capShapeDef.filter.maskBits = getObstacleCollisionMask(0)
    const capShapeId = b2CreatePolygonShape(capBodyId, capShapeDef, capBox)

    // 2. Create Base (Sides with 0 Friction)
    const baseBodyDef = b2DefaultBodyDef()
    baseBodyDef.position.Set(obs.x, baseY)
    const baseBodyId = b2CreateBody(worldId, baseBodyDef)

    const baseBox = b2MakeBox(obs.width, baseHalfHeight)
    const baseShapeDef = b2DefaultShapeDef()
    baseShapeDef.material.friction = 0 // Vertical/Side friction 0
    baseShapeDef.material.restitution = 0
    baseShapeDef.filter.categoryBits = getObstacleCollisionCategory(0)
    baseShapeDef.filter.maskBits = getObstacleCollisionMask(0)
    const mainShapeId = b2CreatePolygonShape(baseBodyId, baseShapeDef, baseBox)

    obstacles.push({
      bodyId: baseBodyId,
      mainShapeId,
      capBodyId,
      capShapeId,
      centerX: obs.x,
      centerY: baseY,
      width: obs.width,
      height: baseHalfHeight,
      renderLayer: 0,
      materialTag: 'obstacle',
    })

    capBodyDef.delete()
    capBox.delete()
    capShapeDef.delete()
    baseBodyDef.delete()
    baseBox.delete()
    baseShapeDef.delete()
  })

  // Update weapon system obstacles
  if (weaponSystem) {
    weaponSystem.setObstacles(obstacles)
    arrowSystem.setObstacles(obstacles)
  }
}

function syncPlayerUpgradeState(
  entity: Entity | null | undefined,
  restoreHealth: boolean,
  restoreToughness: boolean,
  showHud: boolean
): void {
  if (!entity?.level || !entity.stats) {
    return
  }
  const level = entity.level
  if (DEBUG_FORCE_PLAYER_LEVEL > 0) {
    level.level = DEBUG_FORCE_PLAYER_LEVEL
    level.exp = 0
    level.pendingUpgradePoints = 0
  }
  level.level = clampPlayerLevel(level.level)
  level.exp =
    Number.isFinite(level.exp) && level.exp > 0 ? Math.round(level.exp) : 0
  level.pendingUpgradePoints =
    Number.isFinite(level.pendingUpgradePoints) &&
    level.pendingUpgradePoints > 0
      ? Math.round(level.pendingUpgradePoints)
      : 0
  level.attackLevel = clampPlayerUpgradeLevel(level.attackLevel)
  level.defenseLevel = clampPlayerUpgradeLevel(level.defenseLevel)
  level.agilityLevel = clampPlayerUpgradeLevel(level.agilityLevel)
  level.toughnessLevel = clampPlayerUpgradeLevel(level.toughnessLevel)

  const nextMaxHealth = getPlayerDerivedMaxHealth(
    level.baseMaxHealth,
    level.level
  )
  entity.stats.maxHealth = nextMaxHealth
  entity.stats.health = restoreHealth
    ? nextMaxHealth
    : Math.min(entity.stats.health, nextMaxHealth)
  if (showHud) {
    entity.stats.hudVisibleTimer = entity.stats.combatExitTimeout
  }

  const nextMaxToughness = getPlayerDerivedMaxToughness(
    level.baseMaxToughness,
    level
  )
  entity.stats.maxToughness = nextMaxToughness
  entity.stats.toughness = restoreToughness
    ? nextMaxToughness
    : Math.min(entity.stats.toughness, nextMaxToughness)

  if (entity.movement) {
    entity.movement.moveSpeed = entity.movement.baseMoveSpeed
  }
}

function emitPlayerLevelUpPrompt(
  previousMaxHealth?: number,
  previousLevel?: number
): void {
  const message = buildPlayerLevelUpMessage(previousLevel)
  if (!message) {
    return
  }
  if (
    typeof previousMaxHealth === 'number' &&
    Number.isFinite(previousMaxHealth) &&
    previousMaxHealth > 0
  ) {
    message.previousMaxHealth = previousMaxHealth
  }
  if (message.pendingPoints > 0) {
    isPaused = true
  }
  ctx.postMessage(message)
}

function applyPlayerUpgrade(stat: PlayerUpgradeStat): void {
  if (!playerEntity?.level) {
    return
  }
  const level = playerEntity.level
  if (level.pendingUpgradePoints <= 0) {
    return
  }
  if (isPlayerUpgradeStatMaxed(level, stat)) {
    emitPlayerLevelUpPrompt(undefined, level.level)
    return
  }
  switch (stat) {
    case 'attack':
      setPlayerUpgradeLevel(level, stat, level.attackLevel + 1)
      break
    case 'defense':
      setPlayerUpgradeLevel(level, stat, level.defenseLevel + 1)
      break
    case 'agility':
      setPlayerUpgradeLevel(level, stat, level.agilityLevel + 1)
      break
    case 'toughness':
      setPlayerUpgradeLevel(level, stat, level.toughnessLevel + 1)
      break
  }
  level.pendingUpgradePoints -= 1
  syncPlayerUpgradeState(playerEntity, false, stat === 'toughness', true)
  emitPlayerLevelUpPrompt(undefined, level.level)
}

function createEnvironment(): void {
  groundShapeIds.length = 0
  terrainBodyIds.length = 0
  standableSurfaces = []
  obstacles = []
  breakableCrates.clear()
  breakableCratePlanksByShapeId.clear()
  brokenEnvironmentIndices.clear()
  pendingBreakableCrateBreaks.length = 0
  pendingBreakableCrateBreakIds.clear()
  nextBreakableCrateId = 1
  runtimeTerrainState = null
  if (activeMapData) {
    createEnvironmentFromMap(activeMapData)
    createCheckpointsFromMap(activeMapData)
    createGrappleAnchorsFromMap(activeMapData)
    createSunPickupsFromMap(activeMapData)
    createExpOrbsFromMap(activeMapData)
  } else {
    createGround()
    createObstacles()
  }
  if (weaponSystem) {
    weaponSystem.setObstacles(obstacles)
    arrowSystem.setObstacles(obstacles)
    weaponSystem.setStandableSurfaces(standableSurfaces)
  }
}

function createEnvironmentFromMap(map: EditorMapData): void {
  const terrain = map.terrain
  if (terrain && hasTerrainContent(terrain)) {
    syncRuntimeTerrainState(terrain)
    createTerrainFromMap(terrain)
  }
  createBreakableCratesFromMap(map)
}

function createBreakableCratePlankEntity(
  plank: BreakableCratePlankRuntime,
  renderLayer: number,
  seedBase: number,
  plankIndex: number
): Entity | null {
  if (!world) {
    return null
  }
  const seed = hashTerrainDebrisSeed(
    Math.round(plank.centerX * 1000),
    Math.round(plank.centerY * 1000),
    (seedBase + plankIndex * 11) | 0
  )
  const entity = world.createEntity()
  const transform = new TransformComponent()
  transform.x = plank.centerX
  transform.y = plank.centerY
  transform.rotation = plank.rotationRad
  entity.addComponent(transform)

  const render = new RenderComponent()
  render.visible = true
  render.renderLayer = renderLayer
  render.radius = Math.max(plank.halfWidth, plank.halfHeight)
  render.color =
    WOOD_MATERIAL.fillPalette[(seed >>> 3) % WOOD_MATERIAL.fillPalette.length]
  render.borderColor = WOOD_MATERIAL.strokeColor
  entity.addComponent(render)

  const debris = new TerrainDebrisComponent()
  debris.width = plank.halfWidth * 2
  debris.height = plank.halfHeight * 2
  debris.variant = plank.debrisVariant
  debris.lifeMs = 0
  debris.elapsedMs = 0
  debris.fadeStartMs = 0
  debris.receivesWeaponImpulse = false
  entity.addComponent(debris)

  const stats = new StatsComponent()
  const isDebugHealthPlank =
    DEBUG_DRAW_BREAKABLE_CRATE_HEALTH && plankIndex === 0
  stats.maxHealth = isDebugHealthPlank ? BREAKABLE_CRATE_MAX_HEALTH : 0
  stats.health = isDebugHealthPlank ? BREAKABLE_CRATE_MAX_HEALTH : 0
  entity.addComponent(stats)

  const grappleTarget = new GrappleTargetComponent()
  grappleTarget.bodyId = plank.bodyId
  grappleTarget.shapeId = plank.shapeId
  grappleTarget.anchorLocalX = plank.localCenterX
  grappleTarget.anchorLocalY = plank.localCenterY
  grappleTarget.toughness = 0
  grappleTarget.canPull = true
  grappleTarget.canTether = true
  entity.addComponent(grappleTarget)
  return entity
}

function createBreakableCrateRuntimeBody(
  centerX: number,
  centerY: number,
  rotationRad: number,
  renderLayer: number,
  planks: readonly BreakableCratePlankRuntime[]
): b2BodyId {
  const {
    b2BodyType,
    b2DefaultBodyDef,
    b2CreateBody,
    b2Body_ApplyMassFromShapes,
    b2DefaultShapeDef,
    b2CreatePolygonShape,
    b2MakeOffsetBox,
    b2Vec2,
    b2Rot,
  } = box2d
  const bodyDef = b2DefaultBodyDef()
  bodyDef.type = b2BodyType.b2_dynamicBody
  bodyDef.position.Set(centerX, centerY)
  bodyDef.rotation.SetAngle(rotationRad)
  bodyDef.linearDamping = breakableCrateLinearDamping
  bodyDef.angularDamping = breakableCrateAngularDamping
  const bodyId = b2CreateBody(worldId, bodyDef)

  const shapeDef = b2DefaultShapeDef()
  shapeDef.density = breakableCrateDensity
  shapeDef.material.friction = breakableCrateFriction
  shapeDef.material.restitution = breakableCrateRestitution
  shapeDef.filter.categoryBits =
    getObstacleCollisionCategory(renderLayer) |
    getWeaponCollisionCategory(renderLayer)
  shapeDef.filter.maskBits =
    getObstacleCollisionMask(renderLayer) | getWeaponCollisionMask(renderLayer)

  const localCenter = new b2Vec2(0, 0)
  const localRotation = new b2Rot()
  localRotation.SetAngle(0)
  for (let i = 0; i < planks.length; i++) {
    const plank = planks[i]
    localCenter.Set(plank.localCenterX, plank.localCenterY)
    const box = b2MakeOffsetBox(
      plank.halfWidth,
      plank.halfHeight,
      localCenter,
      localRotation
    )
    plank.shapeId = b2CreatePolygonShape(bodyId, shapeDef, box)
    breakableCratePlanksByShapeId.set(plank.shapeId, plank)
    box.delete()
  }
  b2Body_ApplyMassFromShapes(bodyId)

  localCenter.delete()
  localRotation.delete()
  shapeDef.delete()
  bodyDef.delete()
  return bodyId
}

function applyBreakableCratePreBreakParams(): void {
  if (!box2d || breakableCrates.size === 0) {
    return
  }
  const {
    b2Body_SetLinearDamping,
    b2Body_SetAngularDamping,
    b2Shape_SetDensity,
    b2Shape_SetFriction,
    b2Shape_SetRestitution,
  } = box2d
  for (const crate of breakableCrates.values()) {
    if (crate.destroyed) {
      continue
    }
    b2Body_SetLinearDamping(crate.bodyId, breakableCrateLinearDamping)
    b2Body_SetAngularDamping(crate.bodyId, breakableCrateAngularDamping)
    for (let i = 0; i < crate.planks.length; i++) {
      const plank = crate.planks[i]
      b2Shape_SetDensity(
        plank.shapeId,
        breakableCrateDensity,
        i === crate.planks.length - 1
      )
      b2Shape_SetFriction(plank.shapeId, breakableCrateFriction)
      b2Shape_SetRestitution(plank.shapeId, breakableCrateRestitution)
    }
  }
}

function getBreakableCrateVelocityEnergy(maxFallVelocity1000: number): number {
  if (maxFallVelocity1000 <= 0) {
    return 0
  }
  return Math.trunc(
    (PLAYER_WEIGHT_REFERENCE * maxFallVelocity1000 * maxFallVelocity1000) /
      2000000
  )
}

function getBreakableCrateHeightEnergy(
  fallStartY1000: number,
  landingY1000: number
): number {
  const fallHeight1000 = landingY1000 - fallStartY1000
  if (fallHeight1000 <= 0) {
    return 0
  }
  return Math.trunc(
    (PLAYER_WEIGHT_REFERENCE * DEFAULT_GRAVITY * fallHeight1000) / 1000
  )
}

function getBreakableCrateFallDamage(
  maxFallVelocity1000: number,
  fallStartY1000: number,
  landingY1000: number
): number {
  const velocityEnergy = getBreakableCrateVelocityEnergy(maxFallVelocity1000)
  const heightEnergy = getBreakableCrateHeightEnergy(
    fallStartY1000,
    landingY1000
  )
  const kineticEnergy =
    velocityEnergy > heightEnergy ? velocityEnergy : heightEnergy
  if (kineticEnergy >= FALL_DAMAGE_KINETIC_FATAL) {
    return BREAKABLE_CRATE_MAX_HEALTH
  }
  if (kineticEnergy < FALL_DAMAGE_KINETIC_THRESHOLD) {
    return 0
  }
  const excessKinetic = kineticEnergy - FALL_DAMAGE_KINETIC_THRESHOLD
  return Math.max(
    1,
    Math.trunc(excessKinetic / FALL_DAMAGE_KINETIC_TO_HEALTH_DIVISOR)
  )
}

function isBreakableCrateGrounded(crate: BreakableCrateRuntime): boolean {
  const {
    b2Body_GetContactCapacity,
    b2Body_GetContactData,
    b2Shape_GetBody,
    b2Shape_GetFilter,
  } = box2d
  const capacity = b2Body_GetContactCapacity(crate.bodyId)
  if (capacity <= 0) {
    crate.fallContactCount = 0
    crate.fallSolidContactCount = 0
    return false
  }
  const contactData = b2Body_GetContactData(crate.bodyId, capacity)
  let grounded = false
  crate.fallContactCount = contactData.length
  crate.fallSolidContactCount = 0
  for (let i = 0; i < contactData.length; i++) {
    const contact = contactData[i]
    const normalY = contact.manifold.normal.y
    const absNormalY = normalY < 0 ? -normalY : normalY
    const filterA = b2Shape_GetFilter(contact.shapeIdA)
    const filterB = b2Shape_GetFilter(contact.shapeIdB)
    const categoryA = filterA.categoryBits
    const categoryB = filterB.categoryBits
    const bodyA = b2Shape_GetBody(contact.shapeIdA)
    const bodyB = b2Shape_GetBody(contact.shapeIdB)
    let otherCategory = 0
    if (areBodyIdsEqual(bodyA, crate.bodyId)) {
      otherCategory = categoryB
    } else if (areBodyIdsEqual(bodyB, crate.bodyId)) {
      otherCategory = categoryA
    }
    if (
      otherCategory !== 0 &&
      (isGroundCollisionCategory(otherCategory) ||
        isObstacleCollisionCategory(otherCategory) ||
        (isCharacterCollisionCategory(otherCategory) &&
          absNormalY > FALL_IMPACT_CONTACT_NORMAL_Y_MIN))
    ) {
      crate.fallSolidContactCount += 1
      grounded = true
    }
    contact.delete()
  }
  return grounded
}

function updateBreakableCrateFallDamage(
  crate: BreakableCrateRuntime,
  velocityY1000: number
): void {
  const grounded = isBreakableCrateGrounded(crate)
  const wasGrounded = crate.wasGrounded
  crate.isGrounded = grounded
  crate.wasGrounded = grounded
  const ignoreSpawnFallDamage = playTimeMs < crate.fallDamageIgnoreUntilMs

  if (ignoreSpawnFallDamage) {
    if (grounded) {
      if (crate.fallTrackingActive) {
        box2d.b2Body_SetBullet(crate.bodyId, false)
      }
      crate.fallTrackingActive = false
      crate.maxFallVelocity1000 = 0
      crate.fallStartY1000 = 0
      return
    }
    if (velocityY1000 > 0) {
      if (!crate.fallTrackingActive) {
        crate.fallTrackingActive = true
        crate.fallStartY1000 = Math.round(crate.centerY * 1000)
        box2d.b2Body_SetBullet(crate.bodyId, true)
      }
      if (velocityY1000 > crate.maxFallVelocity1000) {
        crate.maxFallVelocity1000 = velocityY1000
      }
    }
    return
  }

  if (!grounded && velocityY1000 > 0) {
    if (!crate.fallTrackingActive) {
      crate.fallTrackingActive = true
      crate.fallStartY1000 = Math.round(crate.centerY * 1000)
      box2d.b2Body_SetBullet(crate.bodyId, true)
    }
    if (velocityY1000 > crate.maxFallVelocity1000) {
      crate.maxFallVelocity1000 = velocityY1000
    }
    return
  }

  if (wasGrounded || !grounded || !crate.fallTrackingActive) {
    return
  }

  const landingY1000 = Math.round(crate.centerY * 1000)
  const damage = getBreakableCrateFallDamage(
    crate.maxFallVelocity1000,
    crate.fallStartY1000,
    landingY1000
  )
  const fallDistance1000 = Math.max(0, landingY1000 - crate.fallStartY1000)
  box2d.b2Body_SetBullet(crate.bodyId, false)
  crate.fallTrackingActive = false
  crate.maxFallVelocity1000 = 0
  crate.fallStartY1000 = 0
  if (damage <= 0) {
    return
  }
  const impactX = crate.centerX
  const impactY = crate.centerY + crate.hitHalfHeight
  const impactLevel = getFallImpactLevel(fallDistance1000)
  if (fallDistance1000 > 0) {
    applyFallImpactTargetsFromBody(
      crate.bodyId,
      damage,
      impactX,
      impactY,
      impactLevel,
      0,
      crate.id
    )
  }
  applyBreakableCrateDamage(crate.id, damage, impactX, impactY, impactLevel)
}

function syncBreakableCrateRuntime(crate: BreakableCrateRuntime): void {
  if (!box2d || crate.destroyed) {
    return
  }
  const isAwake = box2d.b2Body_IsAwake(crate.bodyId)
  if (!isAwake && crate.sleepSynced) {
    return
  }
  const position = box2d.b2Body_GetPosition(crate.bodyId)
  const rotation = box2d.b2Body_GetRotation(crate.bodyId)
  const velocity = box2d.b2Body_GetLinearVelocity(crate.bodyId)
  const angle = box2d.b2Rot_GetAngle(rotation)
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  crate.centerX = position.x
  crate.centerY = position.y
  crate.rotationRad = angle
  syncBreakableCrateDebugStats(crate)
  updateBreakableCrateFallDamage(crate, Math.round(velocity.y * 1000))
  const hitCenterX =
    crate.centerX + crate.hitLocalCenterX * cos - crate.hitLocalCenterY * sin
  const hitCenterY =
    crate.centerY + crate.hitLocalCenterX * sin + crate.hitLocalCenterY * cos
  const hitObstacle = obstacles[crate.hitObstacleIndex]
  if (hitObstacle?.breakableHitProxy && hitObstacle.breakableId === crate.id) {
    hitObstacle.centerX = hitCenterX
    hitObstacle.centerY = hitCenterY
    hitObstacle.rotationRad = angle
    hitObstacle.worldVertices = computeRectWorldVertices(
      hitCenterX,
      hitCenterY,
      crate.hitHalfWidth,
      crate.hitHalfHeight,
      angle,
      hitObstacle.worldVertices
    )
  }

  for (let i = 0; i < crate.planks.length; i++) {
    const plank = crate.planks[i]
    const worldX =
      crate.centerX + plank.localCenterX * cos - plank.localCenterY * sin
    const worldY =
      crate.centerY + plank.localCenterX * sin + plank.localCenterY * cos
    plank.centerX = worldX
    plank.centerY = worldY
    plank.rotationRad = angle

    const obstacle = obstacles[plank.obstacleIndex]
    if (obstacle?.breakableId === crate.id && !obstacle.breakableHitProxy) {
      obstacle.centerX = worldX
      obstacle.centerY = worldY
      obstacle.rotationRad = angle
      obstacle.worldVertices = computeRectWorldVertices(
        worldX,
        worldY,
        plank.halfWidth,
        plank.halfHeight,
        angle,
        obstacle.worldVertices
      )
    }

    const entity = plank.entity
    if (entity?.transform) {
      entity.transform.x = worldX
      entity.transform.y = worldY
      entity.transform.rotation = angle
    }
  }

  crate.sleepSynced = !isAwake
  position.delete()
  rotation.delete()
  velocity.delete()
}

function syncBreakableCrateRuntimes(): void {
  if (!box2d || breakableCrates.size === 0) {
    return
  }
  for (const crate of breakableCrates.values()) {
    syncBreakableCrateRuntime(crate)
  }
}

function refreshBreakableCrateObstacleIndices(): void {
  for (const crate of breakableCrates.values()) {
    crate.hitObstacleIndex = -1
    for (let i = 0; i < crate.planks.length; i++) {
      crate.planks[i].obstacleIndex = -1
    }
  }
  for (let i = 0; i < obstacles.length; i++) {
    const obstacle = obstacles[i]
    const crateId = obstacle.breakableId
    if (crateId === undefined) {
      continue
    }
    const crate = breakableCrates.get(crateId)
    if (!crate || crate.destroyed) {
      continue
    }
    if (obstacle.breakableHitProxy) {
      crate.hitObstacleIndex = i
      continue
    }
    const plank = breakableCratePlanksByShapeId.get(obstacle.mainShapeId)
    if (!plank || plank.crateId !== crateId) {
      continue
    }
    plank.obstacleIndex = i
  }
}

function appendActiveBreakableCrateObstacles(): void {
  if (breakableCrates.size <= 0) {
    return
  }
  for (const crate of breakableCrates.values()) {
    if (crate.destroyed) {
      continue
    }
    const cos = Math.cos(crate.rotationRad)
    const sin = Math.sin(crate.rotationRad)
    const hitCenterX =
      crate.centerX + crate.hitLocalCenterX * cos - crate.hitLocalCenterY * sin
    const hitCenterY =
      crate.centerY + crate.hitLocalCenterX * sin + crate.hitLocalCenterY * cos
    crate.hitObstacleIndex = obstacles.length
    obstacles.push({
      bodyId: crate.bodyId,
      mainShapeId: crate.planks[0]?.shapeId ?? (0 as unknown as b2ShapeId),
      capBodyId: crate.bodyId,
      capShapeId: crate.planks[0]?.shapeId ?? (0 as unknown as b2ShapeId),
      centerX: hitCenterX,
      centerY: hitCenterY,
      width: crate.hitHalfWidth,
      height: crate.hitHalfHeight,
      rotationRad: crate.rotationRad,
      renderLayer: crate.renderLayer,
      materialTag: 'obstacle',
      breakableId: crate.id,
      breakableHitProxy: true,
      worldVertices: computeRectWorldVertices(
        hitCenterX,
        hitCenterY,
        crate.hitHalfWidth,
        crate.hitHalfHeight,
        crate.rotationRad
      ),
    })
    for (let i = 0; i < crate.planks.length; i++) {
      const plank = crate.planks[i]
      plank.obstacleIndex = obstacles.length
      obstacles.push({
        bodyId: crate.bodyId,
        mainShapeId: plank.shapeId,
        capBodyId: crate.bodyId,
        capShapeId: plank.shapeId,
        centerX: plank.centerX,
        centerY: plank.centerY,
        width: plank.halfWidth,
        height: plank.halfHeight,
        rotationRad: plank.rotationRad,
        renderLayer: crate.renderLayer,
        materialTag: 'obstacle',
        breakableId: crate.id,
        worldVertices: computeRectWorldVertices(
          plank.centerX,
          plank.centerY,
          plank.halfWidth,
          plank.halfHeight,
          plank.rotationRad
        ),
      })
    }
  }
}

function createBreakableCratesFromMap(map: EditorMapData): void {
  const envObjects = map.environmentObjects
  if (!envObjects || envObjects.length === 0) {
    return
  }
  const invPixelsPerMeter = pixelsPerMeter > 0 ? 1 / pixelsPerMeter : 0
  for (let i = 0; i < envObjects.length; i++) {
    const env = envObjects[i]
    if (env.type !== 'crate' || env.hidden === true || invPixelsPerMeter <= 0) {
      continue
    }
    const renderLayer = getIndexedLayer(
      activeMapLayerLookup.environmentObjectLayers,
      i
    )
    const layout = createEnvironmentCrateLayout(env.seed, pixelsPerMeter)
    const rotationDeg = getEnvironmentRotationDeg(env)
    const scaleXPermille = getEnvironmentScaleXPermille(env)
    const scaleYPermille = getEnvironmentScaleYPermille(env)
    const scaleX = scaleXPermille / DEFAULT_ENVIRONMENT_SCALE_PERMILLE
    const scaleY = scaleYPermille / DEFAULT_ENVIRONMENT_SCALE_PERMILLE
    const rotationRad = (rotationDeg * Math.PI) / 180
    const cos = Math.cos(rotationRad)
    const sin = Math.sin(rotationRad)
    const crateHitHalfWidth = Math.max(
      0.02,
      layout.width * scaleX * invPixelsPerMeter * 0.5
    )
    const crateHitHalfHeight = Math.max(
      0.02,
      layout.height * scaleY * invPixelsPerMeter * 0.5
    )
    const crateHitLocalCenterX = 0
    const crateHitLocalCenterY = -crateHitHalfHeight

    const crateId = nextBreakableCrateId++
    const plankRuntimes: BreakableCratePlankRuntime[] = []
    let massArea = 0
    let massCenterX = 0
    let massCenterY = 0
    for (let plankIndex = 0; plankIndex < layout.planks.length; plankIndex++) {
      const plank = layout.planks[plankIndex]
      const localCenterX = plank.localCenterX * scaleX * invPixelsPerMeter
      const localCenterY = plank.localCenterY * scaleY * invPixelsPerMeter
      const halfWidth = Math.max(
        0.02,
        plank.width * scaleX * invPixelsPerMeter * 0.5
      )
      const halfHeight = Math.max(
        0.02,
        plank.height * scaleY * invPixelsPerMeter * 0.5
      )
      const plankRuntime: BreakableCratePlankRuntime = {
        crateId,
        entity: null,
        bodyId: 0 as unknown as b2BodyId,
        shapeId: 0 as unknown as b2ShapeId,
        obstacleIndex: -1,
        localCenterX,
        localCenterY,
        centerX: 0,
        centerY: 0,
        halfWidth,
        halfHeight,
        rotationRad,
        debrisVariant: plank.debrisVariant,
      }
      plankRuntimes.push(plankRuntime)
      const area = halfWidth * halfHeight
      massArea += area
      massCenterX += localCenterX * area
      massCenterY += localCenterY * area
    }
    const centerOfMassLocalX = massArea > 0 ? massCenterX / massArea : 0
    const centerOfMassLocalY = massArea > 0 ? massCenterY / massArea : 0
    const bodyCenterX =
      env.x + centerOfMassLocalX * cos - centerOfMassLocalY * sin
    const bodyCenterY =
      env.y + centerOfMassLocalX * sin + centerOfMassLocalY * cos
    const adjustedHitLocalCenterX = crateHitLocalCenterX - centerOfMassLocalX
    const adjustedHitLocalCenterY = crateHitLocalCenterY - centerOfMassLocalY
    const crateHitCenterX =
      bodyCenterX +
      adjustedHitLocalCenterX * cos -
      adjustedHitLocalCenterY * sin
    const crateHitCenterY =
      bodyCenterY +
      adjustedHitLocalCenterX * sin +
      adjustedHitLocalCenterY * cos
    for (let plankIndex = 0; plankIndex < plankRuntimes.length; plankIndex++) {
      const plankRuntime = plankRuntimes[plankIndex]
      plankRuntime.localCenterX -= centerOfMassLocalX
      plankRuntime.localCenterY -= centerOfMassLocalY
      plankRuntime.centerX =
        bodyCenterX +
        plankRuntime.localCenterX * cos -
        plankRuntime.localCenterY * sin
      plankRuntime.centerY =
        bodyCenterY +
        plankRuntime.localCenterX * sin +
        plankRuntime.localCenterY * cos
    }

    const crate: BreakableCrateRuntime = {
      id: crateId,
      envIndex: i,
      seed: env.seed,
      renderLayer,
      destroyed: false,
      health: BREAKABLE_CRATE_MAX_HEALTH,
      bodyId: 0 as unknown as b2BodyId,
      centerX: bodyCenterX,
      centerY: bodyCenterY,
      rotationRad,
      isGrounded: false,
      wasGrounded: false,
      fallTrackingActive: false,
      fallDamageIgnoreUntilMs:
        playTimeMs + BREAKABLE_CRATE_SPAWN_FALL_DAMAGE_GRACE_MS,
      maxFallVelocity1000: 0,
      fallStartY1000: 0,
      fallContactCount: 0,
      fallSolidContactCount: 0,
      sleepSynced: false,
      hitObstacleIndex: -1,
      hitLocalCenterX: adjustedHitLocalCenterX,
      hitLocalCenterY: adjustedHitLocalCenterY,
      hitHalfWidth: crateHitHalfWidth,
      hitHalfHeight: crateHitHalfHeight,
      planks: plankRuntimes,
    }
    crate.bodyId = createBreakableCrateRuntimeBody(
      bodyCenterX,
      bodyCenterY,
      rotationRad,
      renderLayer,
      crate.planks
    )
    crate.hitObstacleIndex = obstacles.length
    obstacles.push({
      bodyId: crate.bodyId,
      mainShapeId: crate.planks[0]?.shapeId ?? (0 as unknown as b2ShapeId),
      capBodyId: crate.bodyId,
      capShapeId: crate.planks[0]?.shapeId ?? (0 as unknown as b2ShapeId),
      centerX: crateHitCenterX,
      centerY: crateHitCenterY,
      width: crateHitHalfWidth,
      height: crateHitHalfHeight,
      rotationRad,
      renderLayer,
      materialTag: 'obstacle',
      breakableId: crate.id,
      breakableHitProxy: true,
      worldVertices: computeRectWorldVertices(
        crateHitCenterX,
        crateHitCenterY,
        crateHitHalfWidth,
        crateHitHalfHeight,
        rotationRad
      ),
    })
    for (let plankIndex = 0; plankIndex < crate.planks.length; plankIndex++) {
      const plankRuntime = crate.planks[plankIndex]
      plankRuntime.bodyId = crate.bodyId
      plankRuntime.entity = createBreakableCratePlankEntity(
        plankRuntime,
        renderLayer,
        crate.seed,
        plankIndex
      )
      plankRuntime.obstacleIndex = obstacles.length
      obstacles.push({
        bodyId: crate.bodyId,
        mainShapeId: plankRuntime.shapeId,
        capBodyId: crate.bodyId,
        capShapeId: plankRuntime.shapeId,
        centerX: plankRuntime.centerX,
        centerY: plankRuntime.centerY,
        width: plankRuntime.halfWidth,
        height: plankRuntime.halfHeight,
        rotationRad: plankRuntime.rotationRad,
        renderLayer,
        materialTag: 'obstacle',
        breakableId: crate.id,
        worldVertices: computeRectWorldVertices(
          plankRuntime.centerX,
          plankRuntime.centerY,
          plankRuntime.halfWidth,
          plankRuntime.halfHeight,
          plankRuntime.rotationRad
        ),
      })
    }
    syncBreakableCrateRuntime(crate)
    breakableCrates.set(crate.id, crate)
  }
}

function syncRuntimeTerrainState(terrain: MapTerrainData | undefined): void {
  runtimeTerrainState = createTerrainRuntimeState(terrain, pixelsPerMeter)
  runtimeTerrainBuildRevision = getMaxTerrainBuildRevision(terrain)
}

function getMaxTerrainBuildRevision(
  terrain: MapTerrainData | undefined
): number {
  if (!terrain) {
    return 1
  }
  let maxRevision = 1
  const layers = terrain.layers
  if (layers) {
    for (let i = 0; i < layers.length; i++) {
      const buildRevision = layers[i].buildRevision
      if (
        typeof buildRevision === 'number' &&
        Number.isFinite(buildRevision) &&
        buildRevision > maxRevision
      ) {
        maxRevision = buildRevision | 0
      }
    }
  }
  const contours = terrain.contours
  if (contours) {
    for (let i = 0; i < contours.length; i++) {
      const buildRevision = contours[i].buildRevision
      if (
        typeof buildRevision === 'number' &&
        Number.isFinite(buildRevision) &&
        buildRevision > maxRevision
      ) {
        maxRevision = buildRevision | 0
      }
    }
  }
  return maxRevision
}

function nextRuntimeTerrainBuildRevision(): number {
  runtimeTerrainBuildRevision += 1
  return runtimeTerrainBuildRevision
}

function countActiveTerrainDebris(): number {
  if (!world) {
    return 0
  }
  const entities = world.getEntities()
  let count = 0
  for (let i = 0; i < entities.length; i++) {
    if (
      entities[i].terrainDebris &&
      (entities[i].terrainDebris?.lifeMs ?? 0) > 0
    ) {
      count += 1
    }
  }
  return count
}

function hashTerrainDebrisSeed(a: number, b: number, c: number): number {
  let hash =
    Math.imul(a | 0, 73856093) ^
    Math.imul(b | 0, 19349663) ^
    Math.imul(c | 0, 83492791)
  hash ^= hash >>> 16
  hash = Math.imul(hash, 0x7feb352d)
  hash ^= hash >>> 15
  hash = Math.imul(hash, 0x846ca68b)
  hash ^= hash >>> 16
  return hash >>> 0
}

function countSelectedCratePlanks(mask: number): number {
  let count = 0
  let bits = mask >>> 0
  while (bits !== 0) {
    count += bits & 1
    bits >>>= 1
  }
  return count
}

function selectRetainedCratePlankMask(
  crate: BreakableCrateRuntime,
  impactX: number,
  impactY: number,
  impactLevel: ImpactLevel,
  maxSelectableCount: number
): number {
  const plankCount = crate.planks.length
  if (plankCount <= 0 || maxSelectableCount <= 0) {
    return 0
  }
  const impactX1000 = Math.round(impactX * 1000)
  const impactY1000 = Math.round(impactY * 1000)
  const seed = hashTerrainDebrisSeed(crate.seed, impactX1000, impactY1000)
  const desiredCount = Math.min(
    plankCount,
    maxSelectableCount,
    impactLevel === 'extreme'
      ? CRATE_RETAINED_DEBRIS_MAX_COUNT
      : CRATE_RETAINED_DEBRIS_MIN_COUNT +
          (((seed >>> 30) & 1) % (CRATE_RETAINED_DEBRIS_MAX_COUNT - 1))
  )
  if (desiredCount <= 0) {
    return 0
  }

  let firstIndex = -1
  let secondIndex = -1
  let thirdIndex = -1
  let firstScore = -1
  let secondScore = -1
  let thirdScore = -1

  for (let i = 0; i < plankCount; i++) {
    const plank = crate.planks[i]
    const sizeKey =
      (Math.round(plank.halfWidth * 1000) << 12) ^
      Math.round(plank.halfHeight * 1000) ^
      (plank.debrisVariant << 24)
    const score =
      hashTerrainDebrisSeed(
        seed ^ Math.imul(i + 1, 131),
        sizeKey,
        crate.seed
      ) >>> 0

    if (score > firstScore) {
      thirdScore = secondScore
      thirdIndex = secondIndex
      secondScore = firstScore
      secondIndex = firstIndex
      firstScore = score
      firstIndex = i
      continue
    }
    if (score > secondScore) {
      thirdScore = secondScore
      thirdIndex = secondIndex
      secondScore = score
      secondIndex = i
      continue
    }
    if (score > thirdScore) {
      thirdScore = score
      thirdIndex = i
    }
  }

  let mask = 0
  if (firstIndex >= 0) {
    mask |= 1 << firstIndex
  }
  if (desiredCount >= 2 && secondIndex >= 0) {
    mask |= 1 << secondIndex
  }
  if (desiredCount >= 3 && thirdIndex >= 0) {
    mask |= 1 << thirdIndex
  }
  return mask
}

function getCrateDebrisVisualOutwardSpeed1000(
  impactLevel: ImpactLevel,
  seed: number
): number {
  if (impactLevel === 'extreme') {
    return 4600 + ((seed >>> 11) % 2601)
  }
  if (impactLevel === 'large') {
    return 1800 + ((seed >>> 11) % 1601)
  }
  return 700 + ((seed >>> 11) % 701)
}

function getCrateDebrisVisualUpwardSpeed1000(
  impactLevel: ImpactLevel,
  seed: number
): number {
  if (impactLevel === 'extreme') {
    return 4200 + ((seed >>> 19) % 2601)
  }
  if (impactLevel === 'large') {
    return 1800 + ((seed >>> 19) % 1401)
  }
  return 900 + ((seed >>> 19) % 701)
}

function getCrateDebrisVisualSideSpeed1000(
  impactLevel: ImpactLevel,
  seed: number
): number {
  if (impactLevel === 'extreme') {
    return (((seed >>> 5) % 4201) - 2100) | 0
  }
  if (impactLevel === 'large') {
    return (((seed >>> 5) % 2201) - 1100) | 0
  }
  return (((seed >>> 5) % 801) - 400) | 0
}

function getCrateDebrisRetainedOutwardSpeed1000(
  impactLevel: ImpactLevel,
  seed: number
): number {
  if (impactLevel === 'extreme') {
    return 4200 + ((seed >>> 12) % 2601)
  }
  if (impactLevel === 'large') {
    return 2200 + ((seed >>> 12) % 1801)
  }
  return 450 + ((seed >>> 12) % 551)
}

function getCrateDebrisRetainedUpwardSpeed1000(
  impactLevel: ImpactLevel,
  seed: number
): number {
  if (impactLevel === 'extreme') {
    return 5200 + ((seed >>> 20) % 2801)
  }
  if (impactLevel === 'large') {
    return 2800 + ((seed >>> 20) % 1801)
  }
  return 500 + ((seed >>> 20) % 701)
}

function getCrateDebrisRetainedSideSpeed1000(
  impactLevel: ImpactLevel,
  seed: number
): number {
  if (impactLevel === 'extreme') {
    return (((seed >>> 6) % 4801) - 2400) | 0
  }
  if (impactLevel === 'large') {
    return (((seed >>> 6) % 2601) - 1300) | 0
  }
  return (((seed >>> 6) % 901) - 450) | 0
}

function getCrateDebrisRetainedAngularVelocity1000(
  impactLevel: ImpactLevel,
  seed: number
): number {
  if (impactLevel === 'extreme') {
    return ((seed >>> 2) & 1) === 0
      ? 5200 + ((seed >>> 8) % 3201)
      : -(5200 + ((seed >>> 8) % 3201))
  }
  if (impactLevel === 'large') {
    return ((seed >>> 2) & 1) === 0
      ? 3200 + ((seed >>> 8) % 2201)
      : -(3200 + ((seed >>> 8) % 2201))
  }
  return ((seed >>> 2) & 1) === 0
    ? CRATE_RETAINED_DEBRIS_ANGULAR_BASE1000 +
        ((seed >>> 8) % (CRATE_RETAINED_DEBRIS_ANGULAR_RANGE1000 + 1))
    : -(
        CRATE_RETAINED_DEBRIS_ANGULAR_BASE1000 +
        ((seed >>> 8) % (CRATE_RETAINED_DEBRIS_ANGULAR_RANGE1000 + 1))
      )
}

function spawnTerrainDebrisFromImpact(
  result: TerrainImpactResult,
  request: {
    worldX: number
    worldY: number
    radius: number
    impactPower: number
    renderLayer: number
  }
): void {
  if (!world || !box2d) {
    return
  }
  const destroyedCells1000 = result.destroyedCells1000
  const destroyedCount = Math.floor(destroyedCells1000.length / 3)
  if (destroyedCount <= 0) {
    return
  }

  const activeCount = countActiveTerrainDebris()
  const remainingBudget = MAX_TERRAIN_DEBRIS_ACTIVE - activeCount
  if (remainingBudget <= 0) {
    return
  }

  const spawnCount = Math.min(
    MAX_TERRAIN_DEBRIS_PER_IMPACT,
    remainingBudget,
    destroyedCount
  )
  if (spawnCount <= 0) {
    return
  }

  const step1000 = Math.max(
    1000,
    Math.floor((destroyedCount * 1000) / spawnCount)
  )
  const impactX1000 = Math.round(request.worldX * 1000)
  const impactY1000 = Math.round(request.worldY * 1000)
  const radius1000 = Math.max(1, Math.round(request.radius * 1000))
  const terrainRadius1000 = Math.max(1, Math.floor((radius1000 * 3) / 4))

  for (let i = 0; i < spawnCount; i++) {
    const sampleIndex = Math.min(
      destroyedCount - 1,
      Math.floor(((i * 2 + 1) * step1000) / 2000)
    )
    const sampleOffset = sampleIndex * 3
    spawnTerrainDebrisEntity(
      destroyedCells1000[sampleOffset] | 0,
      destroyedCells1000[sampleOffset + 1] | 0,
      destroyedCells1000[sampleOffset + 2] | 0,
      impactX1000,
      impactY1000,
      terrainRadius1000,
      request.renderLayer,
      i
    )
  }
}

function spawnTerrainDebrisEntity(
  worldX1000: number,
  worldY1000: number,
  materialCode: number,
  impactX1000: number,
  impactY1000: number,
  terrainRadius1000: number,
  renderLayer: number,
  sampleIndex: number
): void {
  if (!world || !box2d) {
    return
  }
  const material = getTerrainMaterialByCode(materialCode)
  if (!material) {
    return
  }

  const seed = hashTerrainDebrisSeed(worldX1000, worldY1000, sampleIndex)
  const width1000 =
    TERRAIN_DEBRIS_MIN_SIZE1000 + (seed % (TERRAIN_DEBRIS_SIZE_RANGE1000 + 1))
  const height1000 =
    TERRAIN_DEBRIS_MIN_SIZE1000 +
    ((seed >>> 8) % (TERRAIN_DEBRIS_SIZE_RANGE1000 + 1))
  const rotationMilliRad = (seed >>> 16) % 6283 | 0
  const rotationRad = rotationMilliRad / 1000
  const dx1000 = worldX1000 - impactX1000
  const dy1000 = worldY1000 - impactY1000
  const distanceBase1000 = Math.abs(dx1000) + Math.abs(dy1000)
  const dirX1000 =
    distanceBase1000 > 0
      ? Math.floor((dx1000 * 1000) / distanceBase1000)
      : (seed & 1) === 0
        ? 1000
        : -1000
  const dirY1000 =
    distanceBase1000 > 0
      ? Math.floor((dy1000 * 1000) / distanceBase1000)
      : -1000
  const outerLaunch = (sampleIndex & 1) === 0
  const sideX1000 = -dirY1000
  const sideY1000 = dirX1000
  const sideSpeed1000 = (((seed >>> 3) % 1601) - 800) | 0
  const outwardSpeed1000 =
    TERRAIN_DEBRIS_BASE_SPEED1000 +
    ((seed >>> 11) % (TERRAIN_DEBRIS_SPEED_RANGE1000 + 1))
  const upwardSpeed1000 =
    TERRAIN_DEBRIS_UPWARD_SPEED1000 +
    ((seed >>> 21) % (TERRAIN_DEBRIS_UPWARD_RANGE1000 + 1))
  const outerOffset1000 = outerLaunch
    ? Math.min(
        TERRAIN_DEBRIS_OUTER_OFFSET_MAX1000,
        Math.max(
          TERRAIN_DEBRIS_OUTER_OFFSET_MIN1000,
          Math.floor(terrainRadius1000 / 3)
        )
      )
    : 0
  const outerSpeedBonus1000 = outerLaunch
    ? TERRAIN_DEBRIS_OUTER_SPEED_BONUS1000
    : 0
  const upwardBonus1000 = outerLaunch
    ? TERRAIN_DEBRIS_OUTER_UPWARD_BONUS1000
    : 0
  const spawnX1000 =
    worldX1000 +
    Math.floor((dirX1000 * outerOffset1000) / 1000) +
    Math.floor((sideX1000 * sideSpeed1000) / 4000)
  const spawnY1000 =
    worldY1000 -
    TERRAIN_DEBRIS_SPAWN_LIFT1000 -
    Math.floor((Math.max(0, dirY1000) * outerOffset1000) / 2000)
  const velocityX1000 =
    Math.floor((dirX1000 * (outwardSpeed1000 + outerSpeedBonus1000)) / 1000) +
    Math.floor((sideX1000 * sideSpeed1000) / 1000)
  const velocityY1000 =
    -(upwardSpeed1000 + upwardBonus1000) +
    Math.floor((dirY1000 * outwardSpeed1000) / 1600) +
    Math.floor((sideY1000 * sideSpeed1000) / 2000)
  const angularVelocity1000 =
    ((seed >>> 1) & 1) === 0
      ? TERRAIN_DEBRIS_ANGULAR_BASE1000 +
        ((seed >>> 5) % (TERRAIN_DEBRIS_ANGULAR_RANGE1000 + 1))
      : -(
          TERRAIN_DEBRIS_ANGULAR_BASE1000 +
          ((seed >>> 5) % (TERRAIN_DEBRIS_ANGULAR_RANGE1000 + 1))
        )
  const worldX = spawnX1000 / 1000
  const worldY = spawnY1000 / 1000

  const {
    b2DefaultBodyDef,
    b2CreateBody,
    b2BodyType,
    b2DefaultShapeDef,
    b2MakeBox,
    b2CreatePolygonShape,
    b2Body_SetAngularVelocity,
  } = box2d

  const entity = world.createEntity()
  const transform = arrowPools.acquireTransform()
  transform.x = worldX
  transform.y = worldY
  transform.rotation = rotationRad
  entity.addComponent(transform)

  const bodyDef = b2DefaultBodyDef()
  bodyDef.type = b2BodyType.b2_dynamicBody
  bodyDef.position.Set(worldX, worldY)
  bodyDef.rotation.SetAngle(rotationRad)
  bodyDef.linearDamping = 1.25
  bodyDef.angularDamping = 2.2
  const bodyId = b2CreateBody(worldId, bodyDef)

  const shapeDef = b2DefaultShapeDef()
  shapeDef.density = 0.65
  shapeDef.material.friction = 0.55
  shapeDef.material.restitution = 0.08
  shapeDef.filter.categoryBits = getWeaponCollisionCategory(renderLayer)
  shapeDef.filter.maskBits = getWeaponCollisionMask(renderLayer)

  const box = b2MakeBox(width1000 / 2000, height1000 / 2000)
  b2CreatePolygonShape(bodyId, shapeDef, box)
  setBodyLinearVelocity(bodyId, velocityX1000 / 1000, velocityY1000 / 1000)
  b2Body_SetAngularVelocity(bodyId, angularVelocity1000 / 1000)
  bodyDef.delete()
  shapeDef.delete()
  box.delete()

  const physics = arrowPools.acquirePhysics()
  physics.bodyId = bodyId
  entity.addComponent(physics)

  const render = arrowPools.acquireRender()
  render.visible = true
  render.renderLayer = renderLayer
  render.radius = Math.max(width1000, height1000) / 2000
  render.color = material.fillPalette[seed % material.fillPalette.length]
  render.borderColor = material.strokeColor
  entity.addComponent(render)

  const debris = arrowPools.acquireTerrainDebris()
  debris.width = width1000 / 1000
  debris.height = height1000 / 1000
  debris.variant = (seed >>> 27) & 3
  debris.lifeMs = TERRAIN_DEBRIS_LIFETIME_MS
  debris.elapsedMs = 0
  debris.fadeStartMs = TERRAIN_DEBRIS_FADE_START_MS
  debris.receivesWeaponImpulse = false
  entity.addComponent(debris)
}

function updateTerrainDebrisEntities(entities: Entity[]): void {
  if (!box2d || !world) {
    return
  }
  const { b2Body_GetRotation, b2Rot_GetAngle, b2DestroyBody } = box2d

  for (let i = 0; i < entities.length; i++) {
    const entity = entities[i]
    const debris = entity.terrainDebris
    const physics = entity.physics
    const transform = entity.transform
    if (!debris || !physics || !transform) {
      continue
    }
    if (debris.lifeMs <= 0) {
      continue
    }

    debris.elapsedMs += FIXED_STEP_MS
    const rotation = b2Body_GetRotation(physics.bodyId)
    transform.rotation = b2Rot_GetAngle(rotation)
    rotation.delete()

    if (debris.elapsedMs < debris.lifeMs) {
      continue
    }

    debris.lifeMs = 0
    if (entity.render) {
      entity.render.visible = false
    }
    spatialHash.removeEntity(entity)
    b2DestroyBody(physics.bodyId)
    arrowPools.releasePhysics(physics)
    entity.removeComponent('Physics')
    world.destroyEntity(entity)
  }
}

function flushPendingBreakableCrateBreaks(): void {
  if (pendingBreakableCrateBreaks.length === 0) {
    return
  }
  while (pendingBreakableCrateBreaks.length > 0) {
    const request = pendingBreakableCrateBreaks.pop()
    if (!request) {
      continue
    }
    pendingBreakableCrateBreakIds.delete(request.crateId)
    breakBreakableCrate(request)
  }
}

function emitBreakableCrateBreakSound(
  request: BreakableCrateBreakRequest
): void {
  let sourceRadius = DEFAULT_PLAYER_RADIUS
  if (request.sourceEntityId > 0) {
    const source = world.getEntityById(request.sourceEntityId)
    sourceRadius = source?.render?.radius ?? DEFAULT_PLAYER_RADIUS
  }
  soundSystem.emitSoundAt(
    request.impactX,
    request.impactY,
    sourceRadius,
    SOUND_DB_SWORD_HIT_OBSTACLE,
    SOUND_RANGE_MULTIPLIER_WEAPON,
    request.sourceEntityId
  )
}

function breakBreakableCrate(request: BreakableCrateBreakRequest): boolean {
  if (!box2d) {
    return false
  }
  const crate = breakableCrates.get(request.crateId)
  if (!crate || crate.destroyed) {
    return false
  }
  crate.destroyed = true
  breakableCrates.delete(crate.id)
  brokenEnvironmentIndices.add(crate.envIndex)
  effectsEmitter.playSoundAt(
    SOUND_IDS.WOOD_BOX_BROKEN,
    request.impactX,
    request.impactY
  )
  emitBreakableCrateBreakSound(request)
  let remainingDebrisBudget =
    MAX_TERRAIN_DEBRIS_ACTIVE - countActiveTerrainDebris()
  if (remainingDebrisBudget < 0) {
    remainingDebrisBudget = 0
  }
  const retainedPlankMask = selectRetainedCratePlankMask(
    crate,
    request.impactX,
    request.impactY,
    request.impactLevel,
    remainingDebrisBudget
  )
  remainingDebrisBudget -= countSelectedCratePlanks(retainedPlankMask)

  for (let i = 0; i < crate.planks.length; i++) {
    const plank = crate.planks[i]
    if (plank.entity) {
      plank.entity.removeComponent('GrappleTarget')
      world?.markCacheDirty()
      grappleSystem?.markAnchorsDirty()
      world?.destroyEntity(plank.entity)
      plank.entity = null
    }
    breakableCratePlanksByShapeId.delete(plank.shapeId)
    const shouldRetain = ((retainedPlankMask >>> i) & 1) !== 0
    if (shouldRetain) {
      if (
        !retainCratePlankDebrisEntity(
          plank,
          request.impactX,
          request.impactY,
          request.impactLevel,
          crate.renderLayer,
          crate.seed,
          i
        )
      ) {
        continue
      }
      continue
    }
    if (remainingDebrisBudget > 0) {
      spawnCratePlankDebrisEntity(
        plank,
        request.impactX,
        request.impactY,
        request.impactLevel,
        crate.renderLayer,
        crate.seed,
        i
      )
      remainingDebrisBudget -= 1
    }
  }
  box2d.b2DestroyBody(crate.bodyId)

  for (let i = obstacles.length - 1; i >= 0; i--) {
    if (obstacles[i].breakableId === crate.id) {
      obstacles.splice(i, 1)
    }
  }
  refreshBreakableCrateObstacleIndices()
  weaponSystem.setObstacles(obstacles)
  arrowSystem.setObstacles(obstacles)
  return true
}

function spawnCratePlankDebrisEntity(
  plank: BreakableCratePlankRuntime,
  impactX: number,
  impactY: number,
  impactLevel: ImpactLevel,
  renderLayer: number,
  seedBase: number,
  plankIndex: number
): void {
  if (!world || !box2d) {
    return
  }
  const seed = hashTerrainDebrisSeed(
    Math.round(plank.centerX * 1000),
    Math.round(plank.centerY * 1000),
    (seedBase + plankIndex * 17) | 0
  )
  const dx1000 = Math.round((plank.centerX - impactX) * 1000)
  const dy1000 = Math.round((plank.centerY - impactY) * 1000)
  const distanceBase1000 = Math.abs(dx1000) + Math.abs(dy1000)
  const dirX1000 =
    distanceBase1000 > 0
      ? Math.floor((dx1000 * 1000) / distanceBase1000)
      : (seed & 1) === 0
        ? 1000
        : -1000
  const dirY1000 =
    distanceBase1000 > 0
      ? Math.floor((dy1000 * 1000) / distanceBase1000)
      : -1000
  const sideX1000 = -dirY1000
  const sideY1000 = dirX1000
  const sideSpeed1000 = getCrateDebrisVisualSideSpeed1000(impactLevel, seed)
  const outwardSpeed1000 = getCrateDebrisVisualOutwardSpeed1000(
    impactLevel,
    seed
  )
  const upwardSpeed1000 = getCrateDebrisVisualUpwardSpeed1000(impactLevel, seed)
  const spawnY = plank.centerY - 0.05
  const velocityX =
    (dirX1000 * outwardSpeed1000 + sideX1000 * sideSpeed1000) / 1000000
  const velocityY =
    (-(upwardSpeed1000 * 1000) +
      dirY1000 * outwardSpeed1000 +
      Math.floor((sideY1000 * sideSpeed1000) / 2)) /
    1000000
  const angularVelocity =
    ((seed >>> 2) & 1) === 0
      ? 4 + ((seed >>> 7) % 5)
      : -(4 + ((seed >>> 7) % 5))

  const {
    b2DefaultBodyDef,
    b2CreateBody,
    b2BodyType,
    b2DefaultShapeDef,
    b2MakeBox,
    b2CreatePolygonShape,
    b2Body_SetAngularVelocity,
  } = box2d

  const entity = world.createEntity()
  const transform = arrowPools.acquireTransform()
  transform.x = plank.centerX
  transform.y = spawnY
  transform.rotation = plank.rotationRad
  entity.addComponent(transform)

  const bodyDef = b2DefaultBodyDef()
  bodyDef.type = b2BodyType.b2_dynamicBody
  bodyDef.position.Set(plank.centerX, spawnY)
  bodyDef.rotation.SetAngle(plank.rotationRad)
  bodyDef.linearDamping = 0.09
  bodyDef.angularDamping = 0.21
  const bodyId = b2CreateBody(worldId, bodyDef)

  const shapeDef = b2DefaultShapeDef()
  shapeDef.density = 0.16
  shapeDef.material.friction = 0.09
  shapeDef.material.restitution = 0.14
  shapeDef.filter.categoryBits = getWeaponCollisionCategory(renderLayer)
  shapeDef.filter.maskBits = getWeaponCollisionMask(renderLayer)

  const box = b2MakeBox(plank.halfWidth, plank.halfHeight)
  b2CreatePolygonShape(bodyId, shapeDef, box)
  setBodyLinearVelocity(bodyId, velocityX, velocityY)
  b2Body_SetAngularVelocity(bodyId, angularVelocity)
  bodyDef.delete()
  shapeDef.delete()
  box.delete()

  const physics = arrowPools.acquirePhysics()
  physics.bodyId = bodyId
  entity.addComponent(physics)

  const render = arrowPools.acquireRender()
  render.visible = true
  render.renderLayer = renderLayer
  render.radius = Math.max(plank.halfWidth, plank.halfHeight)
  render.color =
    WOOD_MATERIAL.fillPalette[(seed >>> 3) % WOOD_MATERIAL.fillPalette.length]
  render.borderColor = WOOD_MATERIAL.strokeColor
  entity.addComponent(render)

  const debris = arrowPools.acquireTerrainDebris()
  debris.width = plank.halfWidth * 2
  debris.height = plank.halfHeight * 2
  debris.variant = plank.debrisVariant
  debris.lifeMs = TERRAIN_DEBRIS_LIFETIME_MS
  debris.elapsedMs = 0
  debris.fadeStartMs = TERRAIN_DEBRIS_FADE_START_MS
  debris.receivesWeaponImpulse = false
  entity.addComponent(debris)
}

function retainCratePlankDebrisEntity(
  plank: BreakableCratePlankRuntime,
  impactX: number,
  impactY: number,
  impactLevel: ImpactLevel,
  renderLayer: number,
  seedBase: number,
  plankIndex: number
): boolean {
  if (!world || !box2d) {
    return false
  }

  const seed = hashTerrainDebrisSeed(
    Math.round(plank.centerX * 1000),
    Math.round(plank.centerY * 1000),
    (seedBase + plankIndex * 29) | 0
  )
  const dx1000 = Math.round((plank.centerX - impactX) * 1000)
  const dy1000 = Math.round((plank.centerY - impactY) * 1000)
  const distanceBase1000 = Math.abs(dx1000) + Math.abs(dy1000)
  const dirX1000 =
    distanceBase1000 > 0
      ? Math.floor((dx1000 * 1000) / distanceBase1000)
      : (seed & 1) === 0
        ? 1000
        : -1000
  const dirY1000 =
    distanceBase1000 > 0
      ? Math.floor((dy1000 * 1000) / distanceBase1000)
      : -1000
  const sideX1000 = -dirY1000
  const sideY1000 = dirX1000
  const sideSpeed1000 = getCrateDebrisRetainedSideSpeed1000(impactLevel, seed)
  const outwardSpeed1000 = getCrateDebrisRetainedOutwardSpeed1000(
    impactLevel,
    seed
  )
  const upwardSpeed1000 = getCrateDebrisRetainedUpwardSpeed1000(
    impactLevel,
    seed
  )
  const angularVelocity1000 = getCrateDebrisRetainedAngularVelocity1000(
    impactLevel,
    seed
  )
  const collisionCategoryBits =
    getObstacleCollisionCategory(renderLayer) |
    getWeaponCollisionCategory(renderLayer)
  const collisionMaskBits =
    getObstacleCollisionMask(renderLayer) | getWeaponCollisionMask(renderLayer)
  const fadeStartMs = Math.max(
    0,
    CRATE_RETAINED_DEBRIS_LIFETIME_MS - CRATE_RETAINED_DEBRIS_FADE_DURATION_MS
  )
  const woodPalette = WOOD_MATERIAL.fillPalette

  const {
    b2DefaultBodyDef,
    b2CreateBody,
    b2BodyType,
    b2DefaultShapeDef,
    b2MakeBox,
    b2CreatePolygonShape,
    b2Body_SetAngularVelocity,
    b2Body_SetAwake,
  } = box2d

  const bodyDef = b2DefaultBodyDef()
  bodyDef.type = b2BodyType.b2_dynamicBody
  bodyDef.position.Set(plank.centerX, plank.centerY)
  bodyDef.rotation.SetAngle(plank.rotationRad)
  bodyDef.linearDamping = CRATE_RETAINED_DEBRIS_LINEAR_DAMPING
  bodyDef.angularDamping = CRATE_RETAINED_DEBRIS_ANGULAR_DAMPING
  const bodyId = b2CreateBody(worldId, bodyDef)

  const shapeDef = b2DefaultShapeDef()
  shapeDef.density = 0.11
  shapeDef.material.friction = 0.05
  shapeDef.material.restitution = 0.16
  shapeDef.filter.categoryBits = collisionCategoryBits
  shapeDef.filter.maskBits = collisionMaskBits
  const box = b2MakeBox(plank.halfWidth, plank.halfHeight)
  const shapeId = b2CreatePolygonShape(bodyId, shapeDef, box)

  setBodyLinearVelocity(
    bodyId,
    (dirX1000 * outwardSpeed1000 + sideX1000 * sideSpeed1000) / 1000000,
    (-(upwardSpeed1000 * 1000) +
      dirY1000 * outwardSpeed1000 +
      Math.floor((sideY1000 * sideSpeed1000) / 2)) /
      1000000
  )
  b2Body_SetAngularVelocity(bodyId, angularVelocity1000 / 1000)
  b2Body_SetAwake(bodyId, true)
  bodyDef.delete()
  shapeDef.delete()
  box.delete()

  const entity = world.createEntity()
  const transform = arrowPools.acquireTransform()
  transform.x = plank.centerX
  transform.y = plank.centerY
  transform.rotation = plank.rotationRad
  entity.addComponent(transform)

  const physics = arrowPools.acquirePhysics()
  physics.bodyId = bodyId
  physics.shapeId = shapeId
  entity.addComponent(physics)

  const render = arrowPools.acquireRender()
  render.visible = true
  render.renderLayer = renderLayer
  render.radius = Math.max(plank.halfWidth, plank.halfHeight)
  render.color = woodPalette[(seed >>> 3) % woodPalette.length]
  render.borderColor = WOOD_MATERIAL.strokeColor
  entity.addComponent(render)

  const debris = arrowPools.acquireTerrainDebris()
  debris.width = plank.halfWidth * 2
  debris.height = plank.halfHeight * 2
  debris.variant = plank.debrisVariant
  debris.lifeMs = CRATE_RETAINED_DEBRIS_LIFETIME_MS
  debris.elapsedMs = 0
  debris.fadeStartMs = fadeStartMs
  debris.receivesWeaponImpulse = true
  entity.addComponent(debris)
  return true
}

function handleTerrainImpact(request: {
  worldX: number
  worldY: number
  radius: number
  impactPower: number
  renderLayer: number
}): void {
  const terrain = activeMapData?.terrain
  if (!terrain || !hasTerrainContent(terrain) || !runtimeTerrainState) {
    return
  }
  const changed = applyTerrainImpactToRuntimeState(
    runtimeTerrainState,
    request,
    nextRuntimeTerrainBuildRevision
  )
  if (!changed) {
    return
  }
  rebuildTerrainCollisionFromActiveMap()
  spawnTerrainDebrisFromImpact(changed, request)
  if (activeMapData) {
    const runtimeMapData = buildRuntimeMapData(activeMapData)
    if (!runtimeMapData) {
      return
    }
    ctx.postMessage({
      type: 'map_data',
      map: runtimeMapData,
      runtimeTerrainUpdate: true,
    })
  }
}

function rebuildTerrainCollisionFromActiveMap(): void {
  if (!activeMapData?.terrain) {
    return
  }
  const { b2DestroyBody } = box2d
  for (let i = 0; i < terrainBodyIds.length; i++) {
    b2DestroyBody(terrainBodyIds[i])
  }
  terrainBodyIds.length = 0
  groundShapeIds.length = 0
  standableSurfaces = []
  obstacles = []
  createTerrainFromMap(activeMapData.terrain)
  appendActiveBreakableCrateObstacles()
  refreshBreakableCrateObstacleIndices()
  weaponSystem.setObstacles(obstacles)
  arrowSystem.setObstacles(obstacles)
  weaponSystem.setStandableSurfaces(standableSurfaces)
  wakeGroundItemBodiesAfterTerrainChange()
}

function wakeGroundItemBodiesAfterTerrainChange(): void {
  if (!world || !box2d || !tempZeroVec) {
    return
  }
  const { b2Body_SetLinearVelocity } = box2d
  const entities = world.getEntities()
  for (let i = 0; i < entities.length; i++) {
    const entity = entities[i]
    if (!entity.physics || !entity.weapon || entity.stats) {
      continue
    }
    if (entity.weapon.bombState === 'projectile') {
      continue
    }
    const nextVelX = entity.physics.velX
    const nextVelY = entity.physics.velY > 0.05 ? entity.physics.velY : 0.05
    entity.physics.velX = nextVelX
    entity.physics.velY = nextVelY
    tempZeroVec.x = nextVelX
    tempZeroVec.y = nextVelY
    b2Body_SetLinearVelocity(entity.physics.bodyId, tempZeroVec)
  }
}

function createTerrainFromMap(
  terrain: NonNullable<EditorMapData['terrain']>
): void {
  const physicsTerrain = buildPhysicsTerrainData(terrain, pixelsPerMeter)
  if (terrain.version >= 4) {
    const polygons = VoronoiCollisionBuilder.buildPolygons(physicsTerrain)
    for (let i = 0; i < polygons.length; i++) {
      const polygon = polygons[i]
      const materialId = getTerrainMaterialByCode(polygon.materialCode)?.id
      const materialTag = polygon.materialTag
      const renderLayer = getCollisionLayerValue(polygon.renderLayer)
      const polygonShape: Extract<
        MapPlacedShape['shape'],
        { kind: 'polygon' }
      > = {
        kind: 'polygon',
        center: { x: polygon.centerX, y: polygon.centerY },
        points: polygon.points.slice(),
      }
      const bodyId = registerPolygonShape(
        polygonShape,
        renderLayer,
        materialId,
        materialTag,
        materialTag === 'obstacle' ? obstacleFriction : groundFriction,
        materialTag === 'obstacle',
        polygon.preferExactDecomp === true
      )
      if (bodyId) {
        terrainBodyIds.push(bodyId)
      }
      standableSurfaces.push({
        bodyId: 0 as unknown as b2BodyId,
        centerX: polygon.centerX,
        centerY: polygon.centerY,
        width: polygon.halfWidth,
        height: polygon.halfHeight,
        renderLayer,
        materialTag,
      })
    }
    return
  }
  const rects = TerrainCollisionBuilder.buildRectangles(physicsTerrain)
  if (rects.length === 0) {
    return
  }
  const cellSize = terrain.cellSize
  for (let i = 0; i < rects.length; i++) {
    const rect = rects[i]
    const materialTag = rect.materialTag
    const renderLayer = getCollisionLayerValue(rect.renderLayer)
    if (materialTag === 'foliage') {
      continue
    }
    const halfWidth = rect.widthCells * cellSize * 0.5
    const halfHeight = rect.heightCells * cellSize * 0.5
    const centerX = rect.cellX * cellSize + halfWidth
    const centerY = rect.cellY * cellSize + halfHeight
    const rectShape: Extract<MapPlacedShape['shape'], { kind: 'rect' }> = {
      kind: 'rect',
      center: { x: centerX, y: centerY },
      halfWidth,
      halfHeight,
      rotationRad: 0,
    }
    const bodyResult = createStaticRectBody(
      centerX,
      centerY,
      halfWidth,
      halfHeight,
      0,
      renderLayer,
      materialTag,
      materialTag === 'obstacle' ? obstacleFriction : groundFriction
    )
    terrainBodyIds.push(bodyResult.bodyId)
    if (materialTag === 'obstacle') {
      const capBodyId = registerObstacleFromRect(
        rectShape,
        bodyResult,
        renderLayer,
        rect.materialId,
        materialTag
      )
      terrainBodyIds.push(capBodyId)
    }
    standableSurfaces.push({
      bodyId: 0 as unknown as b2BodyId,
      centerX,
      centerY,
      width: halfWidth,
      height: halfHeight,
      renderLayer,
      materialTag,
    })
  }
}

function createCheckpointsFromMap(map: EditorMapData): void {
  if (!world) return
  const checkpoints = map.checkpoints ?? []
  for (let i = 0; i < checkpoints.length; i++) {
    const checkpoint = checkpoints[i]
    createCheckpointEntity(
      checkpoint.x,
      checkpoint.y,
      getCheckpointRenderLayer(i),
      checkpoint.cellStroke === true
    )
  }
}

function createCheckpointEntity(
  x: number,
  y: number,
  renderLayer: number,
  cellStroke: boolean
): void {
  if (!world) return
  const entity = world.createEntity()
  const transform = new TransformComponent()
  transform.x = x
  transform.y = y
  entity.addComponent(transform)

  const render = new RenderComponent()
  render.radius = DEFAULT_CHECKPOINT_RENDER_RADIUS
  render.color = CHECKPOINT_TREE_TOP_COLOR_INACTIVE
  render.borderColor = CHECKPOINT_TREE_TRUNK_COLOR_INACTIVE
  render.visible = true
  render.renderLayer = renderLayer
  render.cellStroke = cellStroke
  entity.addComponent(render)

  const checkpoint = new CheckpointComponent()
  entity.addComponent(checkpoint)
}

function createGrappleAnchorsFromMap(map: EditorMapData): void {
  if (!world) return
  const anchors = map.hookAnchors ?? []
  for (let i = 0; i < anchors.length; i++) {
    const anchor = anchors[i]
    createGrappleAnchorEntity(anchor.x, anchor.y, getHookAnchorRenderLayer(i))
  }
  if (grappleSystem) {
    grappleSystem.markAnchorsDirty()
  }
}

function createGrappleAnchorEntity(
  x: number,
  y: number,
  renderLayer: number
): void {
  if (!world) return
  const entity = world.createEntity()
  const transform = new TransformComponent()
  transform.x = x
  transform.y = y
  entity.addComponent(transform)

  const render = new RenderComponent()
  render.radius = DEFAULT_GRAPPLE_ANCHOR_RENDER_RADIUS
  render.color = GRAPPLE_ANCHOR_COLOR
  render.borderColor = GRAPPLE_ANCHOR_BORDER_COLOR
  render.visible = true
  render.renderLayer = renderLayer
  entity.addComponent(render)

  const anchor = new GrappleAnchorComponent()
  entity.addComponent(anchor)
}

function createSunPickupsFromMap(map: EditorMapData): void {
  if (!world) return
  const pickups = map.sunPickups ?? []
  for (let i = 0; i < pickups.length; i++) {
    const p = pickups[i]
    createMapSunPickupEntity(
      p.x,
      p.y,
      p.isLarge,
      getSunPickupRenderLayer(i, p.isLarge),
      i
    )
  }
}

function createExpOrbsFromMap(map: EditorMapData): void {
  if (!world) return
  const expOrbs = map.expOrbs ?? []
  for (let i = 0; i < expOrbs.length; i++) {
    const expOrb = expOrbs[i]
    createExpOrbEntity(expOrb.x, expOrb.y, getExpOrbRenderLayer(i))
  }
}

function createSunPickupEntity(
  x: number,
  y: number,
  isLarge: boolean,
  renderLayer: number,
  velocityX = 0,
  velocityY = 0,
  mapSpawnIndex = -1
): Entity | null {
  if (!world) return null
  const {
    b2DefaultBodyDef,
    b2CreateBody,
    b2BodyType,
    b2DefaultShapeDef,
    b2CreateCircleShape,
    b2Circle,
  } = box2d
  const entity = world.createEntity()
  const t = new TransformComponent()
  t.x = x
  t.y = y
  entity.addComponent(t)

  const bodyDef = b2DefaultBodyDef()
  bodyDef.type = b2BodyType.b2_dynamicBody
  bodyDef.position.Set(x, y)
  bodyDef.linearDamping = 1.0
  bodyDef.motionLocks.angularZ = true
  const bodyId = b2CreateBody(worldId, bodyDef)

  const shapeDef = b2DefaultShapeDef()
  shapeDef.density = 0.3
  shapeDef.material.friction = 0.3
  shapeDef.material.restitution = 0.1
  shapeDef.filter.categoryBits = getWeaponCollisionCategory(renderLayer)
  shapeDef.filter.maskBits = getWeaponCollisionMask(renderLayer)

  const circle = new b2Circle()
  circle.center.Set(0, 0)
  circle.radius = isLarge ? 0.3 : 0.15
  b2CreateCircleShape(bodyId, shapeDef, circle)
  bodyDef.delete()
  shapeDef.delete()
  circle.delete()

  const physics = new PhysicsComponent()
  physics.bodyId = bodyId
  entity.addComponent(physics)

  const render = new RenderComponent()
  render.visible = true
  render.renderLayer = renderLayer
  entity.addComponent(render)

  const p = new SunPickupComponent()
  p.isLarge = isLarge
  p.pickupRadiusSq = isLarge ? 4 : 1
  p.mapSpawnIndex = mapSpawnIndex
  entity.addComponent(p)

  setBodyLinearVelocity(bodyId, velocityX, velocityY)
  return entity
}

function createMapSunPickupEntity(
  x: number,
  y: number,
  isLarge: boolean,
  renderLayer: number,
  mapSpawnIndex: number
): void {
  createSunPickupEntity(x, y, isLarge, renderLayer, 0, 0, mapSpawnIndex)
}

function createExpOrbEntity(
  x: number,
  y: number,
  renderLayer: number,
  velocityX = 0,
  velocityY = 0
): Entity | null {
  if (!world) return null
  const {
    b2DefaultBodyDef,
    b2CreateBody,
    b2BodyType,
    b2DefaultShapeDef,
    b2CreateCircleShape,
    b2Circle,
  } = box2d
  const entity = world.createEntity()
  const transform = new TransformComponent()
  transform.x = x
  transform.y = y
  entity.addComponent(transform)

  const bodyDef = b2DefaultBodyDef()
  bodyDef.type = b2BodyType.b2_dynamicBody
  bodyDef.position.Set(x, y)
  bodyDef.linearDamping = 1.0
  bodyDef.motionLocks.angularZ = true
  const bodyId = b2CreateBody(worldId, bodyDef)

  const shapeDef = b2DefaultShapeDef()
  shapeDef.density = 0.3
  shapeDef.material.friction = 0.3
  shapeDef.material.restitution = 0.1
  shapeDef.filter.categoryBits = getWeaponCollisionCategory(renderLayer)
  shapeDef.filter.maskBits = getWeaponCollisionMask(renderLayer)

  const circle = new b2Circle()
  circle.center.Set(0, 0)
  circle.radius = 0.12
  b2CreateCircleShape(bodyId, shapeDef, circle)
  bodyDef.delete()
  shapeDef.delete()
  circle.delete()

  const physics = new PhysicsComponent()
  physics.bodyId = bodyId
  entity.addComponent(physics)

  const render = new RenderComponent()
  render.visible = true
  render.renderLayer = renderLayer
  entity.addComponent(render)

  const expOrb = new ExpOrbComponent()
  expOrb.pickupRadiusSq = 1
  entity.addComponent(expOrb)

  setBodyLinearVelocity(bodyId, velocityX, velocityY)
  return entity
}

function rollDropChance(chance: number): boolean {
  return ((Math.random() * 100) | 0) < chance
}

function getNpcDropOffsetX(dropIndex: number): number {
  if (dropIndex <= 0) {
    return 0
  }
  const ring = (dropIndex + 1) >> 1
  return (dropIndex & 1) === 0 ? ring * 0.28 : -ring * 0.28
}

function getNpcDropVelocityX(dropIndex: number): number {
  if (dropIndex <= 0) {
    return 0
  }
  const ring = (dropIndex + 1) >> 1
  return (dropIndex & 1) === 0 ? 2 + ring : -(2 + ring)
}

function getNpcDropVelocityY(dropIndex: number): number {
  return -(6 + (dropIndex % 3))
}

function dropNpcConfiguredLoot(entity: Entity): void {
  if (
    !world ||
    !entity.transform ||
    !entity.npcDropTable ||
    entity.npcDropTable.items.length === 0
  ) {
    return
  }

  const drops = entity.npcDropTable.items
  const renderLayer = entity.render?.renderLayer ?? 0
  let spawnCount = 0

  for (let i = 0; i < drops.length; i++) {
    const drop = drops[i]
    if (!rollDropChance(drop.chance)) {
      continue
    }
    const dropCount = drop.count > 0 ? drop.count : 1
    for (let j = 0; j < dropCount; j++) {
      const offsetX = getNpcDropOffsetX(spawnCount)
      const velocityX = getNpcDropVelocityX(spawnCount)
      const velocityY = getNpcDropVelocityY(spawnCount)
      const spawnX = entity.transform.x + offsetX
      const spawnY = entity.transform.y

      if (isWeaponDropItemType(drop.itemType)) {
        const weaponEntity = createWeapon(
          world,
          box2d,
          worldId,
          spawnX,
          spawnY,
          groundTopY,
          drop.itemType,
          renderLayer
        )
        if (weaponEntity.physics) {
          setBodyLinearVelocity(
            weaponEntity.physics.bodyId,
            velocityX,
            velocityY
          )
        }
        weaponSystem?.setGroundWeaponPickupCooldown(weaponEntity, 500)
      } else if (drop.itemType === 'expOrb') {
        createExpOrbEntity(spawnX, spawnY, renderLayer, velocityX, velocityY)
      } else {
        createSunPickupEntity(
          spawnX,
          spawnY,
          drop.itemType === 'sunPickupLarge',
          renderLayer,
          velocityX,
          velocityY
        )
      }

      spawnCount += 1
    }
  }
}

function createStaticRectBody(
  centerX: number,
  centerY: number,
  halfWidth: number,
  halfHeight: number,
  rotationRad: number,
  renderLayer: number,
  materialTag: TerrainMaterialTag,
  friction: number
): { bodyId: b2BodyId; shapeId: b2ShapeId } {
  const {
    b2DefaultBodyDef,
    b2CreateBody,
    b2MakeBox,
    b2DefaultShapeDef,
    b2CreatePolygonShape,
  } = box2d

  const bodyDef = b2DefaultBodyDef()
  bodyDef.position.Set(centerX, centerY)
  bodyDef.rotation.SetAngle(rotationRad)
  const bodyId = b2CreateBody(worldId, bodyDef)

  const box = b2MakeBox(halfWidth, halfHeight)
  const shapeDef = b2DefaultShapeDef()
  shapeDef.material.friction = friction
  shapeDef.material.restitution = 0
  const isGround = materialTag === 'ground'
  shapeDef.filter.categoryBits = isGround
    ? getGroundCollisionCategory(renderLayer)
    : getObstacleCollisionCategory(renderLayer)
  shapeDef.filter.maskBits = isGround
    ? getGroundCollisionMask(renderLayer)
    : getObstacleCollisionMask(renderLayer)
  const shapeId = b2CreatePolygonShape(bodyId, shapeDef, box)
  if (isGround) {
    groundShapeIds.push(shapeId)
  }

  bodyDef.delete()
  box.delete()
  shapeDef.delete()

  return { bodyId, shapeId }
}

function registerObstacleFromRect(
  shape: Extract<MapPlacedShape['shape'], { kind: 'rect' }>,
  result: { bodyId: b2BodyId; shapeId: b2ShapeId },
  renderLayer: number,
  materialId: TerrainMaterialId | undefined,
  materialTag: TerrainMaterialTag = 'obstacle'
): b2BodyId {
  const halfWidth = shape.halfWidth
  const halfHeight = shape.halfHeight
  const centerX = shape.center.x
  const centerY = shape.center.y
  const rotationRad = shape.rotationRad
  const cap = createObstacleCapRect(
    centerX,
    centerY,
    halfWidth,
    halfHeight,
    rotationRad,
    renderLayer
  )
  const worldVertices =
    Math.abs(rotationRad) > 0.0001
      ? computeRectWorldVertices(
          centerX,
          centerY,
          halfWidth,
          halfHeight,
          rotationRad
        )
      : undefined
  obstacles.push({
    bodyId: result.bodyId,
    mainShapeId: result.shapeId,
    capBodyId: cap.capBodyId,
    capShapeId: cap.capShapeId,
    centerX,
    centerY,
    width: halfWidth,
    height: halfHeight,
    renderLayer,
    materialId,
    materialTag,
    worldVertices,
  })
  return cap.capBodyId
}

function registerPolygonShape(
  shape: Extract<MapPlacedShape['shape'], { kind: 'polygon' }>,
  renderLayer: number,
  materialId: TerrainMaterialId | undefined,
  materialTag: TerrainMaterialTag,
  friction: number,
  shouldRegisterObstacle: boolean,
  preferExactDecomp = false
): b2BodyId | null {
  if (shape.points.length < 6) {
    return null
  }
  const { b2DefaultBodyDef, b2CreateBody, b2DefaultShapeDef } = box2d

  const centerX = shape.center.x
  const centerY = shape.center.y
  const bodyDef = b2DefaultBodyDef()
  bodyDef.position.Set(centerX, centerY)
  const bodyId = b2CreateBody(worldId, bodyDef)

  const shapeDef = b2DefaultShapeDef()
  shapeDef.material.friction = friction
  shapeDef.material.restitution = 0
  const isGround = materialTag === 'ground'
  shapeDef.filter.categoryBits = isGround
    ? getGroundCollisionCategory(renderLayer)
    : getObstacleCollisionCategory(renderLayer)
  shapeDef.filter.maskBits = isGround
    ? getGroundCollisionMask(renderLayer)
    : getObstacleCollisionMask(renderLayer)
  resetDecompScratchPolygon()
  for (let i = 0; i < shape.points.length; i += 2) {
    const worldX = shape.points[i]
    const worldY = shape.points[i + 1]
    decompScratchPolygon.push(
      acquireDecompPoint(worldX - centerX, worldY - centerY)
    )
  }
  removeDuplicatePoints(decompScratchPolygon, DECOMP_POINT_EPSILON)
  removeCollinearPoints(decompScratchPolygon, DECOMP_POINT_EPSILON)

  if (decompScratchPolygon.length < 3) {
    bodyDef.delete()
    shapeDef.delete()
    resetDecompScratchPolygon()
    return null
  }

  const convexPolygons = decomposeStaticTerrainPolygon(
    decompScratchPolygon,
    preferExactDecomp
  )

  if (!convexPolygons || convexPolygons.length === 0) {
    let minX = Number.POSITIVE_INFINITY
    let maxX = Number.NEGATIVE_INFINITY
    let minY = Number.POSITIVE_INFINITY
    let maxY = Number.NEGATIVE_INFINITY
    for (let i = 0; i < decompScratchPolygon.length; i++) {
      const point = decompScratchPolygon[i]
      const localX = point[0]
      const localY = point[1]
      if (localX < minX) minX = localX
      if (localX > maxX) maxX = localX
      if (localY < minY) minY = localY
      if (localY > maxY) maxY = localY
    }
    const shapeIds: b2ShapeId[] = []
    appendConvexPolygonBodyShapes(
      box2d,
      bodyId,
      shapeDef,
      decompScratchPolygon,
      shapeIds
    )
    if (isGround) {
      for (let i = 0; i < shapeIds.length; i++) {
        groundShapeIds.push(shapeIds[i])
      }
    }

    if (shouldRegisterObstacle) {
      const vertices: { x: number; y: number }[] = []
      const worldVertices: { x: number; y: number }[] = []
      for (let i = 0; i < decompScratchPolygon.length; i++) {
        const point = decompScratchPolygon[i]
        const localX = point[0]
        const localY = point[1]
        vertices.push({ x: localX, y: localY })
        worldVertices.push({ x: centerX + localX, y: centerY + localY })
      }
      const halfWidth = Math.max(Math.abs(minX), Math.abs(maxX))
      const halfHeight = Math.max(Math.abs(minY), Math.abs(maxY))
      for (let i = 0; i < shapeIds.length; i++) {
        obstacles.push({
          bodyId,
          mainShapeId: shapeIds[i],
          capBodyId: bodyId,
          capShapeId: shapeIds[i],
          centerX,
          centerY,
          width: halfWidth,
          height: halfHeight,
          renderLayer,
          materialId,
          materialTag,
          vertices,
          worldVertices,
        })
      }
    }

    bodyDef.delete()
    shapeDef.delete()
    resetDecompScratchPolygon()
    return bodyId
  }

  for (let i = 0; i < convexPolygons.length; i++) {
    const convex = convexPolygons[i]
    if (convex.length < 3) {
      continue
    }
    let minX = Number.POSITIVE_INFINITY
    let maxX = Number.NEGATIVE_INFINITY
    let minY = Number.POSITIVE_INFINITY
    let maxY = Number.NEGATIVE_INFINITY
    const vertices: { x: number; y: number }[] | null = shouldRegisterObstacle
      ? []
      : null
    const worldVertices: { x: number; y: number }[] | null =
      shouldRegisterObstacle ? [] : null
    for (let j = 0; j < convex.length; j++) {
      const point = convex[j]
      const localX = point[0]
      const localY = point[1]
      if (localX < minX) minX = localX
      if (localX > maxX) maxX = localX
      if (localY < minY) minY = localY
      if (localY > maxY) maxY = localY
      if (vertices && worldVertices) {
        vertices.push({ x: localX, y: localY })
        worldVertices.push({ x: centerX + localX, y: centerY + localY })
      }
    }
    const shapeIds: b2ShapeId[] = []
    appendConvexPolygonBodyShapes(box2d, bodyId, shapeDef, convex, shapeIds)
    if (isGround) {
      for (let j = 0; j < shapeIds.length; j++) {
        groundShapeIds.push(shapeIds[j])
      }
    }

    if (!shouldRegisterObstacle || !vertices || !worldVertices) {
      continue
    }
    const halfWidth = Math.max(Math.abs(minX), Math.abs(maxX))
    const halfHeight = Math.max(Math.abs(minY), Math.abs(maxY))
    for (let j = 0; j < shapeIds.length; j++) {
      obstacles.push({
        bodyId,
        mainShapeId: shapeIds[j],
        capBodyId: bodyId,
        capShapeId: shapeIds[j],
        centerX,
        centerY,
        width: halfWidth,
        height: halfHeight,
        renderLayer,
        materialId,
        materialTag,
        vertices,
        worldVertices,
      })
    }
  }

  bodyDef.delete()
  shapeDef.delete()
  resetDecompScratchPolygon()
  return bodyId
}

function decomposeStaticTerrainPolygon(
  polygon: DecompPolygon,
  preferExactDecomp: boolean
): DecompPolygon[] | null {
  if (!isSimple(polygon)) {
    return null
  }
  makeCCW(polygon)
  const primary = preferExactDecomp
    ? runExactDecomp(polygon)
    : runQuickDecomp(polygon)
  if (primary && primary.length > 0) {
    return primary
  }
  const secondary = preferExactDecomp
    ? runQuickDecomp(polygon)
    : runExactDecomp(polygon)
  if (secondary && secondary.length > 0) {
    return secondary
  }
  return triangulateSimplePolygon(polygon)
}

function runQuickDecomp(polygon: DecompPolygon): DecompPolygon[] | null {
  const convexPolygons = quickDecomp(polygon)
  return convexPolygons && convexPolygons.length > 0 ? convexPolygons : null
}

function runExactDecomp(polygon: DecompPolygon): DecompPolygon[] | null {
  const convexPolygons = decomp(polygon)
  return convexPolygons !== false && convexPolygons.length > 0
    ? convexPolygons
    : null
}

function triangulateSimplePolygon(
  polygon: DecompPolygon
): DecompPolygon[] | null {
  if (polygon.length < 3) {
    return null
  }
  if (polygon.length === 3) {
    return [polygon]
  }
  const remaining = new Array<number>(polygon.length)
  for (let i = 0; i < polygon.length; i++) {
    remaining[i] = i
  }
  const triangles: DecompPolygon[] = []
  let remainingCount = remaining.length
  let guard = remainingCount * remainingCount
  while (remainingCount > 3 && guard > 0) {
    let earFound = false
    for (let i = 0; i < remainingCount; i++) {
      const previousIndex = remaining[(i + remainingCount - 1) % remainingCount]
      const currentIndex = remaining[i]
      const nextIndex = remaining[(i + 1) % remainingCount]
      if (
        !isEarTriangle(
          polygon,
          remaining,
          remainingCount,
          previousIndex,
          currentIndex,
          nextIndex
        )
      ) {
        continue
      }
      triangles.push([
        polygon[previousIndex],
        polygon[currentIndex],
        polygon[nextIndex],
      ])
      remaining.splice(i, 1)
      remainingCount -= 1
      earFound = true
      break
    }
    if (!earFound) {
      return null
    }
    guard -= 1
  }
  if (remainingCount === 3) {
    triangles.push([
      polygon[remaining[0]],
      polygon[remaining[1]],
      polygon[remaining[2]],
    ])
  }
  return triangles.length > 0 ? triangles : null
}

function isEarTriangle(
  polygon: DecompPolygon,
  remaining: readonly number[],
  remainingCount: number,
  previousIndex: number,
  currentIndex: number,
  nextIndex: number
): boolean {
  const previousPoint = polygon[previousIndex]
  const currentPoint = polygon[currentIndex]
  const nextPoint = polygon[nextIndex]
  if (
    computeSignedTriangleArea(
      previousPoint[0],
      previousPoint[1],
      currentPoint[0],
      currentPoint[1],
      nextPoint[0],
      nextPoint[1]
    ) <= DECOMP_TRIANGLE_AREA_EPSILON
  ) {
    return false
  }
  for (let i = 0; i < remainingCount; i++) {
    const testIndex = remaining[i]
    if (
      testIndex === previousIndex ||
      testIndex === currentIndex ||
      testIndex === nextIndex
    ) {
      continue
    }
    const testPoint = polygon[testIndex]
    if (
      isPointInsideTriangle(
        testPoint[0],
        testPoint[1],
        previousPoint[0],
        previousPoint[1],
        currentPoint[0],
        currentPoint[1],
        nextPoint[0],
        nextPoint[1]
      )
    ) {
      return false
    }
  }
  return true
}

function isPointInsideTriangle(
  pointX: number,
  pointY: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number
): boolean {
  const ab = computeSignedTriangleArea(ax, ay, bx, by, pointX, pointY)
  const bc = computeSignedTriangleArea(bx, by, cx, cy, pointX, pointY)
  const ca = computeSignedTriangleArea(cx, cy, ax, ay, pointX, pointY)
  return (
    ab >= -DECOMP_TRIANGLE_AREA_EPSILON &&
    bc >= -DECOMP_TRIANGLE_AREA_EPSILON &&
    ca >= -DECOMP_TRIANGLE_AREA_EPSILON
  )
}

function computeSignedTriangleArea(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number
): number {
  return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax)
}

function appendConvexPolygonBodyShapes(
  box2dModule: MainModule,
  bodyId: b2BodyId,
  shapeDef: ReturnType<MainModule['b2DefaultShapeDef']>,
  convexPolygon: DecompPolygon,
  outShapeIds: b2ShapeId[]
): void {
  if (convexPolygon.length < 3) {
    return
  }
  if (convexPolygon.length <= BOX2D_MAX_POLYGON_VERTICES) {
    appendPolygonBodyShape(
      box2dModule,
      bodyId,
      shapeDef,
      convexPolygon,
      outShapeIds
    )
    return
  }
  const pointCount = convexPolygon.length
  let startIndex = 1
  while (startIndex < pointCount - 1) {
    const endIndex = Math.min(
      pointCount - 1,
      startIndex + BOX2D_MAX_POLYGON_VERTICES - 2
    )
    const splitPolygon: DecompPolygon = [convexPolygon[0]]
    for (let i = startIndex; i <= endIndex; i++) {
      splitPolygon.push(convexPolygon[i])
    }
    appendPolygonBodyShape(
      box2dModule,
      bodyId,
      shapeDef,
      splitPolygon,
      outShapeIds
    )
    startIndex = endIndex
  }
}

function appendPolygonBodyShape(
  box2dModule: MainModule,
  bodyId: b2BodyId,
  shapeDef: ReturnType<MainModule['b2DefaultShapeDef']>,
  polygonPoints: DecompPolygon,
  outShapeIds: b2ShapeId[]
): void {
  if (polygonPoints.length < 3) {
    return
  }
  const { b2CreatePolygonShape, b2ComputeHull, b2MakePolygon, b2Vec2 } =
    box2dModule
  const localPoints: InstanceType<MainModule['b2Vec2']>[] = []
  for (let i = 0; i < polygonPoints.length; i++) {
    localPoints.push(new b2Vec2(polygonPoints[i][0], polygonPoints[i][1]))
  }
  const hull: b2Hull = b2ComputeHull(localPoints)
  const polygon: b2Polygon = b2MakePolygon(hull, 0)
  outShapeIds.push(b2CreatePolygonShape(bodyId, shapeDef, polygon))
  hull.delete()
  polygon.delete()
  for (let i = 0; i < localPoints.length; i++) {
    localPoints[i].delete()
  }
}

function createObstacleCapRect(
  centerX: number,
  centerY: number,
  halfWidth: number,
  halfHeight: number,
  rotationRad: number,
  renderLayer: number
): { capBodyId: b2BodyId; capShapeId: b2ShapeId } {
  const {
    b2DefaultBodyDef,
    b2CreateBody,
    b2MakeBox,
    b2DefaultShapeDef,
    b2CreatePolygonShape,
  } = box2d
  const CAP_TOTAL_HEIGHT = 0.1
  const capHalfHeight = CAP_TOTAL_HEIGHT * 0.5
  const offsetY = -halfHeight + capHalfHeight
  const cos = Math.cos(rotationRad)
  const sin = Math.sin(rotationRad)
  const capCenterX = centerX - offsetY * sin
  const capCenterY = centerY + offsetY * cos
  const bodyDef = b2DefaultBodyDef()
  bodyDef.position.Set(capCenterX, capCenterY)
  bodyDef.rotation.SetAngle(rotationRad)
  const bodyId = b2CreateBody(worldId, bodyDef)
  const capBox = b2MakeBox(halfWidth, capHalfHeight)
  const shapeDef = b2DefaultShapeDef()
  shapeDef.material.friction = obstacleFriction
  shapeDef.material.restitution = 0
  shapeDef.filter.categoryBits = getObstacleCollisionCategory(renderLayer)
  shapeDef.filter.maskBits = getObstacleCollisionMask(renderLayer)
  const capShapeId = b2CreatePolygonShape(bodyId, shapeDef, capBox)

  bodyDef.delete()
  capBox.delete()
  shapeDef.delete()

  return { capBodyId: bodyId, capShapeId }
}

function computeRectWorldVertices(
  centerX: number,
  centerY: number,
  halfWidth: number,
  halfHeight: number,
  rotationRad: number,
  target?: { x: number; y: number }[]
): { x: number; y: number }[] {
  const cos = Math.cos(rotationRad)
  const sin = Math.sin(rotationRad)
  const world =
    target && target.length >= 4
      ? target
      : [
          { x: 0, y: 0 },
          { x: 0, y: 0 },
          { x: 0, y: 0 },
          { x: 0, y: 0 },
        ]
  world.length = 4

  writeRectWorldVertex(
    world[0],
    centerX,
    centerY,
    -halfWidth,
    -halfHeight,
    cos,
    sin
  )
  writeRectWorldVertex(
    world[1],
    centerX,
    centerY,
    halfWidth,
    -halfHeight,
    cos,
    sin
  )
  writeRectWorldVertex(
    world[2],
    centerX,
    centerY,
    halfWidth,
    halfHeight,
    cos,
    sin
  )
  writeRectWorldVertex(
    world[3],
    centerX,
    centerY,
    -halfWidth,
    halfHeight,
    cos,
    sin
  )
  return world
}

function writeRectWorldVertex(
  target: { x: number; y: number },
  centerX: number,
  centerY: number,
  localX: number,
  localY: number,
  cos: number,
  sin: number
): void {
  target.x = centerX + localX * cos - localY * sin
  target.y = centerY + localX * sin + localY * cos
}

function applyWeaponSlotConfig(
  slot: {
    hasWeapon: boolean
    weaponType: string
    movesetId: string
    width: number
    height: number
    baseWidth: number
    sizeLevel: number
    sizeMaxLevel: number
    cornerRadius: number
    weight: number
    attackDamage: number
    postureDamage: number
    toughnessDamage: number
    bowAmmo: number
    bowAmmoMax: number
    skillId: string
    skillCharges: number
  },
  config: MapNpcWeapon | undefined,
  defaultBowAmmo: number
) {
  if (!config) {
    slot.hasWeapon = false
    slot.movesetId = ''
    return
  }

  const normalizedConfig = normalizeWeaponTypeAndSizeLevel(
    config.weaponType,
    config.sizeLevel
  )
  if (!normalizedConfig) {
    slot.hasWeapon = false
    slot.movesetId = ''
    return
  }
  const template = WEAPON_DEFAULT_DATA[normalizedConfig.weaponType]
  const baseLevel = template.sizeLevel > 0 ? template.sizeLevel : 1
  const sizeLevel = normalizedConfig.sizeLevel
  const scaleFactor = sizeLevel / baseLevel
  const resolvedStats = resolveWeaponStatsForSize(
    template,
    sizeLevel,
    {
      attackDamage: config.attackDamage,
      postureDamage: config.postureDamage,
      toughnessDamage: config.toughnessDamage,
    },
    true
  )
  slot.hasWeapon = true
  slot.weaponType = normalizedConfig.weaponType
  slot.movesetId = getDefaultAttackMovesetIdForWeaponType(
    normalizedConfig.weaponType
  )
  slot.width = template.width * scaleFactor
  slot.height = template.height * scaleFactor
  slot.baseWidth = template.width * scaleFactor
  slot.sizeLevel = sizeLevel
  slot.sizeMaxLevel = template.sizeMaxLevel
  slot.cornerRadius = DEFAULT_WEAPON_CORNER_RADIUS
  slot.weight = template.weight
  slot.attackDamage = resolvedStats.attackDamage
  slot.postureDamage = resolvedStats.postureDamage
  slot.toughnessDamage = resolvedStats.toughnessDamage
  if (isAmmoLimitedWeaponType(normalizedConfig.weaponType)) {
    const ammo = config.bowAmmo ?? defaultBowAmmo
    slot.bowAmmoMax = ammo
    slot.bowAmmo = ammo
  } else {
    slot.bowAmmoMax = 0
    slot.bowAmmo = 0
  }
  slot.skillId = normalizedConfig.weaponType === 'hammer' ? 'hammer_crit' : ''
  slot.skillCharges = slot.skillId ? DEFAULT_SKILL_MAX_CHARGES : 0
}

function createPlayerAndWeapon(
  groundY: number,
  map: EditorMapData | null
): void {
  const playerProps = map?.player
  const playerFacing =
    typeof playerProps?.facing === 'number' && playerProps.facing < 0 ? -1 : 1
  const playerRadius =
    typeof playerProps?.radius === 'number' &&
    Number.isFinite(playerProps.radius) &&
    playerProps.radius > 0
      ? playerProps.radius
      : DEFAULT_PLAYER_RADIUS
  const playerBodyHeight =
    typeof playerProps?.bodyHeight === 'number' && playerProps.bodyHeight > 0
      ? playerProps.bodyHeight
      : 0
  const playerBodyProfile = playerProps?.bodyProfile
  playerEntity = createPlayer(
    world,
    box2d,
    worldId,
    map ? map.playerSpawn.x : -12,
    map ? map.playerSpawn.y : groundY - 0.6,
    groundY,
    playerRadius,
    playerBodyHeight,
    playerBodyProfile,
    getPlayerRenderLayer()
  )
  if (playerEntity.render) {
    playerEntity.render.bodyProfile = playerBodyProfile ?? null
    playerEntity.render.bodyProfileIndex = hasRenderableBodyProfile(
      playerBodyProfile
    )
      ? PLAYER_BODY_PROFILE_INDEX
      : 0
    playerEntity.render.color = getCharacterBodyColor(
      playerBodyProfile,
      playerProps?.color ?? playerEntity.render.color
    )
    playerEntity.render.bloodColor = getCharacterBloodColor(
      playerBodyProfile,
      ''
    )
  }
  if (playerEntity.render?.bodyProfile?.skeletalMode) {
    skeletalSegmentManager.createSegments(playerEntity)
  }

  if (playerEntity.stats && playerProps) {
    const nextMaxHealth =
      typeof playerProps.maxHealth === 'number' &&
      Number.isFinite(playerProps.maxHealth) &&
      playerProps.maxHealth > 0
        ? playerProps.maxHealth
        : DEFAULT_PLAYER_MAX_HEALTH
    const nextMaxPosture =
      typeof playerProps.maxPosture === 'number' &&
      Number.isFinite(playerProps.maxPosture) &&
      playerProps.maxPosture >= 0
        ? playerProps.maxPosture
        : DEFAULT_PLAYER_MAX_POSTURE
    const nextMaxToughness =
      typeof playerProps.maxToughness === 'number' &&
      Number.isFinite(playerProps.maxToughness) &&
      playerProps.maxToughness >= 0
        ? playerProps.maxToughness
        : DEFAULT_PLAYER_MAX_TOUGHNESS

    playerEntity.stats.maxHealth = nextMaxHealth
    playerEntity.stats.health = nextMaxHealth
    playerEntity.stats.maxPosture = nextMaxPosture
    playerEntity.stats.posture = nextMaxPosture
    playerEntity.stats.maxToughness = nextMaxToughness
    playerEntity.stats.toughness = nextMaxToughness
    playerEntity.stats.debugNoDamage = playerProps.debugNoDamage === true
    playerEntity.stats.debugNoDeath = playerProps.debugNoDeath === true
    if (!playerEntity.stats.persistentId) {
      playerEntity.stats.persistentId = PLAYER_PERSISTENT_ID
    }
    if (playerEntity.level) {
      playerEntity.level.baseMaxHealth = nextMaxHealth
      playerEntity.level.baseMaxToughness = nextMaxToughness
    }
  }

  if (playerEntity.faction && playerProps?.factionId) {
    playerEntity.faction.factionId = playerProps.factionId
    playerEntity.faction.npcFactions = playerProps.npcFactions ??
      playerProps.enemyFactions ?? [Faction.Enemy]
    playerEntity.faction.allyFactions = playerProps.allyFactions ?? []
  }

  if (playerEntity.movement && playerProps) {
    const nextMoveSpeed =
      typeof playerProps.moveSpeed === 'number' &&
      Number.isFinite(playerProps.moveSpeed) &&
      playerProps.moveSpeed >= 0
        ? playerProps.moveSpeed
        : playerEntity.movement.moveSpeed
    playerEntity.movement.baseMoveSpeed = nextMoveSpeed
    playerEntity.movement.moveSpeed = nextMoveSpeed
  }

  if (playerEntity.input) {
    playerEntity.input.lastMoveDirection = playerFacing
  }

  if (playerEntity.attackSlots && playerProps) {
    const defaultWeaponType =
      normalizeWeaponType(
        playerProps.mainWeapon?.weaponType ??
          playerProps.secondaryWeapon?.weaponType
      ) ?? 'sword'
    const nextMovesetId = isNormalAttackMovesetId(
      playerProps.initialNormalMovesetId
    )
      ? playerProps.initialNormalMovesetId
      : getDefaultAttackMovesetIdForWeaponType(defaultWeaponType) ||
        getDefaultNormalAttackMovesetId('player')
    playerEntity.attackSlots.normal.hasMoveset = true
    playerEntity.attackSlots.normal.movesetId = nextMovesetId
    if (playerEntity.weapon) {
      playerEntity.weapon.movesetId = nextMovesetId
    }
  }

  if (playerEntity.weapon && playerEntity.weaponSlots && playerProps) {
    const weaponSlots = playerEntity.weaponSlots
    applyWeaponSlotConfig(
      weaponSlots.main,
      playerProps.mainWeapon,
      getDefaultPlayerAmmoForWeaponType(playerProps.mainWeapon?.weaponType)
    )
    applyWeaponSlotConfig(
      weaponSlots.secondary,
      playerProps.secondaryWeapon,
      getDefaultPlayerAmmoForWeaponType(playerProps.secondaryWeapon?.weaponType)
    )

    if (weaponSlots.main.hasWeapon) {
      weaponSlots.activeSlot = 'main'
    } else if (weaponSlots.secondary.hasWeapon) {
      weaponSlots.activeSlot = 'secondary'
    }

    const activeSlot =
      weaponSlots.activeSlot === 'main'
        ? weaponSlots.main
        : weaponSlots.secondary

    if (activeSlot.hasWeapon) {
      const weaponType = activeSlot.weaponType as WeaponType
      const template = WEAPON_DEFAULT_DATA[weaponType]
      applyWeaponSizeLevel(playerEntity.weapon, template, activeSlot.sizeLevel)
      playerEntity.weapon.sizeMaxLevel = activeSlot.sizeMaxLevel
      playerEntity.weapon.cornerRadius = activeSlot.cornerRadius
      playerEntity.weapon.weaponType = weaponType
      playerEntity.weapon.movesetId =
        activeSlot.movesetId ||
        getDefaultAttackMovesetIdForWeaponType(weaponType)
      playerEntity.weapon.attackDamage = activeSlot.attackDamage
      playerEntity.weapon.postureDamage = activeSlot.postureDamage
      playerEntity.weapon.toughnessDamage = activeSlot.toughnessDamage
      playerEntity.weapon.bowAmmo = activeSlot.bowAmmo
      playerEntity.weapon.bowAmmoMax = activeSlot.bowAmmoMax
      playerEntity.weapon.skillId = activeSlot.skillId
      playerEntity.weapon.skillCharges = activeSlot.skillCharges
      playerEntity.weapon.isEquipped = true
      if (playerEntity.attackSlots) {
        playerEntity.attackSlots.normal.hasMoveset =
          playerEntity.weapon.movesetId.length > 0
        playerEntity.attackSlots.normal.movesetId =
          playerEntity.weapon.movesetId
        const ultimateMovesetId = getUltimateMovesetIdForWeaponType(weaponType)
        playerEntity.attackSlots.ultimate.hasMoveset =
          ultimateMovesetId.length > 0
        playerEntity.attackSlots.ultimate.movesetId = ultimateMovesetId
        // 初始化技能槽（applySkillMoveset 只在武器切换时调用，此处手动初始化）
        const skill = playerEntity.attackSlots.skill
        skill.skillId = activeSlot.skillId
        skill.maxCharges = activeSlot.skillId ? DEFAULT_SKILL_MAX_CHARGES : 0
        skill.chargesRemaining = activeSlot.skillId
          ? activeSlot.skillCharges
          : 0
      }
    } else {
      playerEntity.weapon.isEquipped = false
    }
  }

  syncPlayerUpgradeState(playerEntity, true, true, false)

  if (map?.weapons) {
    for (let i = 0; i < map.weapons.length; i++) {
      const weaponData = map.weapons[i]
      const weaponEntity = createWeapon(
        world,
        box2d,
        worldId,
        weaponData.x,
        weaponData.y,
        groundY,
        normalizeWeaponType(weaponData.weaponType) ?? 'sword',
        getWeaponRenderLayer(i)
      )
      const weapon = weaponEntity.weapon
      if (!weapon) {
        continue
      }

      const sizeLevel =
        normalizeWeaponTypeAndSizeLevel(
          weaponData.weaponType,
          weaponData.sizeLevel
        )?.sizeLevel ?? weaponData.sizeLevel
      if (Number.isFinite(sizeLevel) && sizeLevel > 0) {
        const weaponType = weapon.weaponType
        if (!isTemplateWeaponType(weaponType)) {
          continue
        }
        const template = WEAPON_DEFAULT_DATA[weaponType]
        applyWeaponSizeLevel(weapon, template, sizeLevel)
        const resolvedStats = resolveWeaponStatsForSize(
          template,
          sizeLevel,
          {
            attackDamage: weaponData.attackDamage,
            postureDamage: weaponData.postureDamage,
            toughnessDamage: weaponData.toughnessDamage,
          },
          true
        )
        weapon.attackDamage = resolvedStats.attackDamage
        weapon.postureDamage = resolvedStats.postureDamage
        weapon.toughnessDamage = resolvedStats.toughnessDamage
        resetWeaponPhysicsCircle(weaponEntity)
      }

      if (isAmmoLimitedWeaponType(weapon.weaponType)) {
        const bowAmmo = weaponData.bowAmmo
        if (bowAmmo !== undefined && Number.isFinite(bowAmmo)) {
          const ammo = Math.max(0, bowAmmo)
          weapon.bowAmmo = ammo
          weapon.bowAmmoMax = Math.max(weapon.bowAmmoMax, ammo)
        }
      }
    }
  }

  // Obstacles are at -9.5, 9.5, 19.5

  // 暂时注释掉敌人以便测试跌落伤害
  /*
  // Default NPC in the middle area
  npcEntity = createNpc(
    world,
    box2d,
    worldId,
    ENEMY_SPAWNS.default.x,
    groundY + ENEMY_SPAWNS.default.yOffset,
    groundY,
    ENEMY_SPAWNS.default.type
  )

  // Leftmost default NPC outside alert range
  createNpc(
    world,
    box2d,
    worldId,
    ENEMY_SPAWNS.left.x,
    groundY + ENEMY_SPAWNS.left.yOffset,
    groundY,
    ENEMY_SPAWNS.left.type
  )

  // Archer NPC on top of the tallest obstacle near player spawn
  const archerTopY = groundY - ARCHER_SPAWN_CONFIG.obstacleHalfHeight * 2
  const archerSpawnX =
    ARCHER_SPAWN_CONFIG.obstacleX -
    ARCHER_SPAWN_CONFIG.obstacleHalfWidth +
    ARCHER_SPAWN_CONFIG.edgeOffset
  const archerSpawnY = archerTopY + ARCHER_SPAWN_CONFIG.yOffsetFromTop
  createNpc(
    world,
    box2d,
    worldId,
    archerSpawnX,
    archerSpawnY,
    groundY,
    ARCHER_SPAWN_CONFIG.type
  )

  // Large NPC between 2nd and 3rd obstacle
  createNpc(
    world,
    box2d,
    worldId,
    ENEMY_SPAWNS.large.x,
    groundY + ENEMY_SPAWNS.large.yOffset,
    groundY,
    ENEMY_SPAWNS.large.type
  )

  // Fast (Small) NPC after the last obstacle
  createNpc(
    world,
    box2d,
    worldId,
    ENEMY_SPAWNS.fast.x,
    groundY + ENEMY_SPAWNS.fast.yOffset,
    groundY,
    ENEMY_SPAWNS.fast.type
  )
  */

  if (map && map.npcs.length > 0) {
    npcEntity = null
    for (let i = 0; i < map.npcs.length; i++) {
      const npc = map.npcs[i]
      const created = createGameNpc(npc.x, npc.y, groundY, npc.npcType, {
        ...npc,
        renderLayer: getNpcRenderLayer(i),
      })
      if (created.render) {
        created.render.bodyProfileIndex = hasRenderableBodyProfile(
          npc.bodyProfile
        )
          ? getNpcBodyProfileIndex(i)
          : 0
      }
      if (created.attackSlots) {
        const nextMovesetId = isNormalAttackMovesetId(
          npc.initialNormalMovesetId
        )
          ? npc.initialNormalMovesetId
          : getDefaultAttackMovesetIdForWeaponType(
              normalizeWeaponType(
                npc.mainWeapon?.weaponType ?? npc.secondaryWeapon?.weaponType
              ) ?? 'sword'
            ) || getDefaultNormalAttackMovesetId('npc')
        created.attackSlots.normal.hasMoveset = true
        created.attackSlots.normal.movesetId = nextMovesetId
        if (created.weapon) {
          created.weapon.movesetId = nextMovesetId
        }
        if (created.npcAI) {
          created.npcAI.movesetId = nextMovesetId
          created.npcAI.attackMoves = normalizeNpcAttackMoves(
            npc.attackMoves,
            npc.mainWeapon?.weaponType
          )
        }
      }
      if (created.npcAI) {
        created.npcAI.mapSpawnIndex = i
      }
      if (created.stats && !created.stats.persistentId) {
        const nextId = `npc-${i + 1}`
        created.stats.persistentId = nextId
        syncNpcIdCounter(nextId)
      }
      if (!npcEntity) {
        npcEntity = created
      }
    }
  }

  npcAISystem.setPlayer(playerEntity)
  soundSystem.setPlayer(playerEntity)
  targetingSystem.setPlayer(playerEntity)
  checkpointSystem.setPlayer(playerEntity)
  syncCheckpointDefaults(activeMapData)
  checkpointSystem.setPlayer(playerEntity)
  syncCheckpointDefaults(map)
}

function syncCheckpointDefaults(map: EditorMapData | null): void {
  if (!world) return
  if (map) {
    checkpointSystem.setDefaultSpawn(map.playerSpawn.x, map.playerSpawn.y)
  } else if (playerEntity?.transform) {
    checkpointSystem.setDefaultSpawn(
      playerEntity.transform.x,
      playerEntity.transform.y
    )
  }

  checkpointSystem.setActiveCheckpoint(null)
}

function applyMapCamera(map: EditorMapData): void {
  const zoomValue =
    map.camera.zoom > 0 && Number.isFinite(map.camera.zoom)
      ? map.camera.zoom
      : DEFAULT_CAMERA_ZOOM

  camera.x = map.camera.x
  camera.y = map.camera.y
  zoom = zoomValue
  requestedZoom = zoomValue
  targetZoom = zoomValue

  if (isThumbnailCameraCapture) {
    applyThumbnailCaptureCamera()
    return
  }

  const isDefaultCamera =
    Math.abs(map.camera.x) < 0.01 &&
    Math.abs(map.camera.y) < 0.01 &&
    Math.abs(map.camera.zoom - 1) < 0.01

  if (isDefaultCamera && playerEntity && playerEntity.transform) {
    const centerX = canvasWidth / 2
    camera.x = playerEntity.transform.x - centerX / pixelsPerMeter

    initialPlayerScreenRatioY = 0.8

    isCameraLocked = true
    isVerticalCameraLocked = false
    verticalLookAheadOffsetY = 0
    verticalForceCenterAfterEmergency = false
  } else {
    isCameraLocked = false
    isVerticalCameraLocked = false
    verticalLookAheadOffsetY = 0
    verticalForceCenterAfterEmergency = false
  }
}

function applyThumbnailCaptureCamera(): void {
  if (!playerEntity?.transform) {
    return
  }

  const centerX = canvasWidth / 2
  const canvasHeightInMeters = canvasHeight / pixelsPerMeter
  const playerRadius = playerEntity.render?.radius ?? DEFAULT_PLAYER_RADIUS
  const playerFeetY = playerEntity.transform.y + playerRadius

  camera.x = playerEntity.transform.x - centerX / pixelsPerMeter
  camera.y =
    playerFeetY -
    canvasHeightInMeters * ((VERTICAL_LOCK_SCREEN_RATIO - 1) / zoom + 1)

  isCameraLocked = false
  isTransitioning = false
  needsReturnToCenter = false
  outOfCenterTime = 0
  horizontalForceCenterAfterEmergency = false

  isVerticalCameraLocked = false
  isVerticalTransitioning = false
  verticalOutOfCenterTime = 0
  verticalLookAheadOffsetY = 0
  verticalForceCenterAfterEmergency = false
}

function resetWeaponPhysicsCircle(entity: Entity): void {
  if (!entity.physics || !entity.weapon || !entity.transform) {
    return
  }
  if (!box2d || !worldId) {
    return
  }

  const {
    b2DestroyBody,
    b2DefaultBodyDef,
    b2CreateBody,
    b2BodyType,
    b2DefaultShapeDef,
    b2CreateCircleShape,
    b2Circle,
  } = box2d

  b2DestroyBody(entity.physics.bodyId)

  const bodyDef = b2DefaultBodyDef()
  bodyDef.type = b2BodyType.b2_dynamicBody
  bodyDef.position.Set(entity.transform.x, entity.transform.y)
  bodyDef.linearDamping = 2.0
  bodyDef.motionLocks.angularZ = true
  entity.physics.bodyId = b2CreateBody(worldId, bodyDef)

  const shapeDef = b2DefaultShapeDef()
  shapeDef.density = 0.5
  shapeDef.material.friction = 0.3
  shapeDef.material.restitution = 0.2
  const renderLayer = entity.weapon.renderLayer
  shapeDef.filter.categoryBits = getWeaponCollisionCategory(renderLayer)
  shapeDef.filter.maskBits = getWeaponCollisionMask(renderLayer)

  const circle = new b2Circle()
  circle.center.Set(0, 0)
  circle.radius = entity.weapon.height * 0.5
  entity.physics.shapeId = b2CreateCircleShape(
    entity.physics.bodyId,
    shapeDef,
    circle
  )

  bodyDef.delete()
  shapeDef.delete()
  circle.delete()
}

function canGrappleLockedTarget(player: Entity): boolean {
  if (!player.input || !player.grapple || !player.transform) {
    return false
  }
  if (!player.grapple.hasGrapple) {
    return false
  }

  const targetId = player.input.lockedTargetId
  if (targetId === null) {
    return false
  }

  const target = world.getEntityById(targetId)
  if (
    !target ||
    target.id === player.id ||
    !target.transform ||
    (target.stats !== undefined &&
      (target.stats.isDead || target.stats.isVanished))
  ) {
    return false
  }

  const hasBody =
    target.grappleAnchor !== undefined ||
    target.physics !== undefined ||
    (target.grappleTarget !== undefined && target.grappleTarget.canPull)
  if (!hasBody) {
    return false
  }

  if ((target.render?.renderLayer ?? 0) !== (player.render?.renderLayer ?? 0)) {
    return false
  }

  const dx = target.transform.x - player.transform.x
  const dy = target.transform.y - player.transform.y
  return dx * dx + dy * dy <= GRAPPLE_TARGET_RANGE_SQ
}

function resetLockSwitchMouseSwipe(): void {
  lockSwitchMouseSwipeStartMs = -1
  lockSwitchMouseLastMoveMs = -1
  lockSwitchMouseSwipeAccumX = 0
  lockSwitchMouseSwipeAccumY = 0
  lockSwitchMouseSwipeConsumed = false
}

function isTemplateWeaponType(
  weaponType: string
): weaponType is keyof typeof WEAPON_DEFAULT_DATA {
  return weaponType in WEAPON_DEFAULT_DATA
}

function handleInput(
  activeKeys: string[],
  activeMouseButtons: number[],
  mouseZoomTarget: number,
  mouseX: number,
  mouseY: number,
  mouseDeltaX: number,
  mouseDeltaY: number,
  mouseCaptured: boolean
) {
  const temp = prevKeys
  prevKeys = currKeys
  currKeys = temp
  currKeys.clear()
  for (let i = 0; i < activeKeys.length; i++) {
    currKeys.add(activeKeys[i])
  }

  const tempMouse = prevMouseButtons
  prevMouseButtons = currMouseButtons
  currMouseButtons = tempMouse
  currMouseButtons.clear()
  for (let i = 0; i < activeMouseButtons.length; i++) {
    currMouseButtons.add(activeMouseButtons[i])
  }

  const isPlayerDead = playerEntity.stats?.isDead ?? false
  const isUltimateActive = playerEntity.weapon?.ultimatePhase != null

  if (playerEntity.input) {
    const eHeld = currKeys.has('e')
    let moveDirection = 0
    if (currKeys.has('a') || currKeys.has('arrowleft')) moveDirection -= 1
    if (currKeys.has('d') || currKeys.has('arrowright')) moveDirection += 1

    const isRangedEquipped = isRangedWeaponType(playerEntity.weapon?.weaponType)

    // 绝招期间锁定移动和所有操作
    playerEntity.input.moveDirection =
      isPlayerDead || isUltimateActive ? 0 : moveDirection

    if (isUltimateActive) {
      playerEntity.input.attackRequested = false
      playerEntity.input.blockRequested = false
      playerEntity.input.jumpRequested = false
      playerEntity.input.sprintRequested = false
      playerEntity.input.grappleHoldRequested = false
      playerEntity.input.grapplePersistentRequested = false
      playerEntity.input.freeAimToggleRequested = false
      playerEntity.input.inputBuffer.clearAll()
      lockCancelOnReleaseArmed = false
      lockSwitchAttemptedDuringHold = false
      resetLockSwitchMouseSwipe()
      if (!eHeld) {
        eUsedForUltimate = false
      }
      return
    }

    if (currKeys.has(' ') && !prevKeys.has(' ') && !isPlayerDead) {
      if (playerEntity.isStunned()) {
        playerEntity.input.inputBuffer.clearAll()
      }
      playerEntity.input.inputBuffer.bufferAction('jump')
      playerEntity.input.jumpRequested = true
    } else if (!currKeys.has(' ')) {
      playerEntity.input.jumpRequested = false
    }

    // Left click or J for attack
    const attackJustPressed =
      (currKeys.has('j') && !prevKeys.has('j')) ||
      (currMouseButtons.has(0) && !prevMouseButtons.has(0))
    const attackHeld = currKeys.has('j') || currMouseButtons.has(0)

    playerEntity.input.attackRequested = attackHeld && !isPlayerDead

    const rightClickJustPressed =
      currMouseButtons.has(2) && !prevMouseButtons.has(2)
    const freeAimToggleJustPressed = currKeys.has('k') && !prevKeys.has('k')
    playerEntity.input.freeAimToggleRequested = false
    if (
      !isPlayerDead &&
      isRangedEquipped &&
      (rightClickJustPressed || freeAimToggleJustPressed)
    ) {
      playerEntity.input.freeAimToggleRequested = true
    }

    const blockPressed =
      (currMouseButtons.has(2) && !isRangedEquipped) ||
      (currKeys.has('k') && !isRangedEquipped)
    if (blockPressed && !isPlayerDead) {
      playerEntity.input.blockRequested = true
    } else {
      playerEntity.input.blockRequested = false
    }

    if (
      attackJustPressed &&
      !isPlayerDead &&
      !isRangedWeaponType(playerEntity.weapon?.weaponType)
    ) {
      weaponSystem.startAttack(playerEntity)
    }

    // F 键 = 技能
    if (currKeys.has('f') && !prevKeys.has('f') && !isPlayerDead) {
      weaponSystem.handleSkillRequest(playerEntity)
    }

    const qHeld = currKeys.has('q')
    const qJustPressed = qHeld && !prevKeys.has('q')
    const qJustReleased = !qHeld && prevKeys.has('q')
    const isLocked = playerEntity.input.lockedTargetId !== null

    if (isPlayerDead) {
      lockCancelOnReleaseArmed = false
      lockSwitchAttemptedDuringHold = false
      resetLockSwitchMouseSwipe()
    } else {
      if (qJustPressed) {
        resetLockSwitchMouseSwipe()
        if (isLocked) {
          lockCancelOnReleaseArmed = true
          lockSwitchAttemptedDuringHold = false
        } else {
          lockCancelOnReleaseArmed = false
          lockSwitchAttemptedDuringHold = false
          playerEntity.input.lockToggleRequested = true
        }
      }

      if (qHeld && isLocked) {
        let switchX = 0
        let switchY = 0

        if (mouseCaptured && (mouseDeltaX !== 0 || mouseDeltaY !== 0)) {
          const mouseMoveTimeMs = playTimeMs
          if (lockSwitchMouseSwipeConsumed) {
            const idleMs =
              lockSwitchMouseLastMoveMs >= 0
                ? mouseMoveTimeMs - lockSwitchMouseLastMoveMs
                : LOCK_SWITCH_MOUSE_IDLE_RESET_MS
            if (idleMs >= LOCK_SWITCH_MOUSE_IDLE_RESET_MS) {
              resetLockSwitchMouseSwipe()
            } else {
              lockSwitchMouseLastMoveMs = mouseMoveTimeMs
            }
          }

          if (!lockSwitchMouseSwipeConsumed) {
            if (
              lockSwitchMouseSwipeStartMs < 0 ||
              mouseMoveTimeMs - lockSwitchMouseSwipeStartMs >
                LOCK_SWITCH_MOUSE_SWIPE_WINDOW_MS
            ) {
              lockSwitchMouseSwipeStartMs = mouseMoveTimeMs
              lockSwitchMouseSwipeAccumX = 0
              lockSwitchMouseSwipeAccumY = 0
            }

            lockSwitchMouseSwipeAccumX += mouseDeltaX
            lockSwitchMouseSwipeAccumY += mouseDeltaY
            lockSwitchMouseLastMoveMs = mouseMoveTimeMs

            const swipeAbsX = Math.abs(lockSwitchMouseSwipeAccumX)
            const swipeAbsY = Math.abs(lockSwitchMouseSwipeAccumY)
            if (
              swipeAbsX >= LOCK_SWITCH_MOUSE_SWIPE_THRESHOLD_PX ||
              swipeAbsY >= LOCK_SWITCH_MOUSE_SWIPE_THRESHOLD_PX
            ) {
              const dominantSwipeAbs =
                swipeAbsX >= swipeAbsY ? swipeAbsX : swipeAbsY
              const swipeElapsedMs =
                mouseMoveTimeMs - lockSwitchMouseSwipeStartMs
              const speedElapsedMs =
                swipeElapsedMs > 0 ? swipeElapsedMs : FIXED_STEP_MS
              const hasEnoughSwipeSpeed =
                dominantSwipeAbs * 1000 >=
                LOCK_SWITCH_MOUSE_SWIPE_MIN_SPEED_PX_PER_SEC * speedElapsedMs

              if (hasEnoughSwipeSpeed) {
                if (swipeAbsX >= swipeAbsY) {
                  switchX = lockSwitchMouseSwipeAccumX > 0 ? 1 : -1
                } else {
                  switchY = lockSwitchMouseSwipeAccumY > 0 ? 1 : -1
                }
                lockSwitchMouseSwipeStartMs = -1
                lockSwitchMouseSwipeAccumX = 0
                lockSwitchMouseSwipeAccumY = 0
                lockSwitchMouseSwipeConsumed = true
              }
            }
          }
        }

        if (switchX !== 0 || switchY !== 0) {
          playerEntity.input.lockSwitchIntentX = switchX
          playerEntity.input.lockSwitchIntentY = switchY
          lockSwitchAttemptedDuringHold = true
        }
      }

      if (qJustReleased) {
        if (
          lockCancelOnReleaseArmed &&
          !lockSwitchAttemptedDuringHold &&
          playerEntity.input.lockedTargetId !== null
        ) {
          playerEntity.input.lockToggleRequested = true
        }
        lockCancelOnReleaseArmed = false
        lockSwitchAttemptedDuringHold = false
        resetLockSwitchMouseSwipe()
      }
    }

    if (currKeys.has('control') && !prevKeys.has('control') && !isPlayerDead) {
      if (playerEntity.isStunned()) {
        playerEntity.input.inputBuffer.clearAll()
      }
      playerEntity.input.inputBuffer.bufferAction('roll')
    }

    const shiftHeld = currKeys.has('shift')
    if (shiftHeld && !isPlayerDead) {
      playerEntity.input.sprintRequested = !playerEntity.weapon?.bowFreeAim
    } else {
      playerEntity.input.sprintRequested = false
    }
    playerEntity.input.grappleHoldRequested = shiftHeld && !isPlayerDead
    playerEntity.input.grapplePersistentRequested = false

    const rPressed = currKeys.has('r')
    const rJustPressed = rPressed && !prevKeys.has('r')
    const rJustReleased = !rPressed && prevKeys.has('r')

    if (rJustPressed) {
      if (!isPlayerDead) {
        rHoldActive = true
        rHoldTriggered = false
        rHoldMs = 0
      } else {
        rHoldActive = false
        rHoldTriggered = false
        rHoldMs = 0
      }
    }

    if (rJustReleased) {
      if (rHoldActive && !rHoldTriggered && !isPlayerDead) {
        const g = playerEntity.grapple
        const shouldGrapple =
          g &&
          (g.isPulling ||
            g.isTethering ||
            g.hasAnchorNearby ||
            canGrappleLockedTarget(playerEntity))
        if (shouldGrapple) {
          playerEntity.input.inputBuffer.bufferAction('grapple')
        } else {
          const solar = playerEntity.solarEnergy
          const isGrounded = playerEntity.movement?.isGrounded ?? false
          const stats = playerEntity.stats
          if (
            solar &&
            solar.largeCount > 0 &&
            stats &&
            isGrounded &&
            stats.healingMs <= 0
          ) {
            solar.largeCount--
            stats.healingMs = 500
            stats.hudVisibleTimer = stats.combatExitTimeout
            if (playerEntity.transform) {
              statsSystem.emitHeal(
                playerEntity.transform.x,
                playerEntity.transform.y,
                playerEntity.render?.renderLayer ?? 0
              )
            }
          }
        }
      }
      rHoldActive = false
      rHoldTriggered = false
      rHoldMs = 0
    }

    const eJustPressed = eHeld && !prevKeys.has('e')
    const eJustReleased = !eHeld && prevKeys.has('e')
    const middleHeld = currMouseButtons.has(1)
    const middleJustPressed = middleHeld && !prevMouseButtons.has(1)

    // E + 中键 = 绝招
    const ultimateJustTriggered =
      ((eJustPressed && middleHeld) || (middleJustPressed && eHeld)) &&
      !isPlayerDead
    if (ultimateJustTriggered) {
      eUsedForUltimate = true
      const ultSlot = playerEntity.attackSlots?.ultimate
      const isBlocked =
        (ultSlot?.cooldownRemainingMs ?? 0) > 0 ||
        playerEntity.weapon?.ultimatePhase != null
      if (isBlocked) ultimateFlashRemainingMs = ULTIMATE_FLASH_DURATION_MS
      const viewHalfWidth = Math.round(
        canvasWidth / (pixelsPerMeter * zoom) / 2
      )
      weaponSystem.handleUltimateRequest(playerEntity, viewHalfWidth)
    } else {
      // E 松开 = 交互（keyup 触发，且本次按键未用于绝招）
      if (eJustReleased && !isPlayerDead) {
        if (!eUsedForUltimate) {
          playerEntity.input.inputBuffer.bufferAction('interact')
        }
        eUsedForUltimate = false
      }
      // 中键单独 = 钩爪
      if (middleJustPressed && !isPlayerDead) {
        playerEntity.input.inputBuffer.bufferAction('grapple')
      }
    }

    if (currKeys.has('1') && !prevKeys.has('1') && !isPlayerDead) {
      weaponSystem.switchWeaponSlot(playerEntity, 'main')
    }

    if (currKeys.has('2') && !prevKeys.has('2') && !isPlayerDead) {
      weaponSystem.switchWeaponSlot(playerEntity, 'secondary')
    }

    let aimAdjust = 0
    const upHeld =
      currKeys.has('w') || currKeys.has('arrowup') || currKeys.has('ArrowUp')
    const downHeld =
      currKeys.has('s') ||
      currKeys.has('arrowdown') ||
      currKeys.has('ArrowDown')
    if (upHeld) {
      aimAdjust -= 1
    }
    if (downHeld) {
      aimAdjust += 1
    }
    playerEntity.input.grappleClimbHeld = upHeld ? -1 : downHeld ? 1 : 0
    playerEntity.input.freeAimAdjust = aimAdjust

    playerEntity.input.moveSpeedScale = playerEntity.weapon?.bowFreeAim
      ? 0.5
      : 1

    playerEntity.input.mouseAimActive = mouseCaptured
    if (mouseCaptured) {
      const prevMouseX = playerEntity.input.mouseScreenX
      const prevMouseY = playerEntity.input.mouseScreenY
      playerEntity.input.mouseAimMoved =
        mouseX !== prevMouseX || mouseY !== prevMouseY
      playerEntity.input.mouseScreenX = mouseX
      playerEntity.input.mouseScreenY = mouseY
      const anchorX = canvasWidth * 0.5
      const anchorY = canvasHeight
      const invZoom = 1 / zoom
      const camPxX = camera.x * pixelsPerMeter
      const camPxY = camera.y * pixelsPerMeter
      const worldPxX = (mouseX - anchorX) * invZoom + anchorX + camPxX
      const worldPxY = (mouseY - anchorY) * invZoom + anchorY + camPxY
      const invPixelsPerMeter = 1 / pixelsPerMeter
      playerEntity.input.mouseAimX = worldPxX * invPixelsPerMeter
      playerEntity.input.mouseAimY = worldPxY * invPixelsPerMeter
    } else {
      playerEntity.input.mouseAimMoved = false
    }
  }

  requestedZoom = mouseZoomTarget
}

function fixedUpdate() {
  const fixedStartMs = performance.now()
  // Accumulate time using delta time
  currentTime += TIME_STEP
  playTimeMs += FIXED_STEP_MS
  syncTimeScaleState()
  if (ultimateFlashRemainingMs > 0) {
    ultimateFlashRemainingMs = Math.max(
      0,
      ultimateFlashRemainingMs - FIXED_STEP_MS
    )
  }

  if (rHoldActive && !rHoldTriggered) {
    if (!currKeys.has('r')) {
      rHoldActive = false
      rHoldTriggered = false
      rHoldMs = 0
    } else if (playerEntity?.input) {
      const isPlayerDead = playerEntity.stats?.isDead ?? false
      if (isPlayerDead) {
        rHoldActive = false
        rHoldTriggered = false
        rHoldMs = 0
      } else {
        rHoldMs += FIXED_STEP_MS
        if (rHoldMs >= GRAPPLE_LONG_PRESS_MS) {
          rHoldTriggered = true
          const canPersistGrapple =
            playerEntity.input.lockedTargetId !== null ||
            playerEntity.grapple?.hasAnchorNearby === true
          if (canPersistGrapple) {
            playerEntity.input.grapplePersistentRequested = true
            playerEntity.input.inputBuffer.bufferAction('grapple')
          }
        }
      }
    }
  }

  syncUltimateCameraState()
  targetZoom = ultimateCameraActive ? ultimateCameraTargetZoom : requestedZoom

  // Update Zoom logic (smooth transition)
  const zoomDiff = targetZoom - zoom
  if (Math.abs(zoomDiff) > 0.001) {
    zoom += zoomDiff * 0.15
  } else {
    zoom = targetZoom
  }

  const entities = world.getEntities()
  const spatialHashStartMs = performance.now()
  spatialHash.update(entities)
  workerPerfSpatialHashTotalUs += Math.round(
    (performance.now() - spatialHashStartMs) * 1000
  )

  weaponSystem.setEntities(entities)
  weaponSystem.setSpatialHash(spatialHash)
  movementSystem.setEntities(entities)
  movementSystem.setSpatialHash(spatialHash)

  // 回血动画期间锁定玩家主动操作（受击/位移仍正常）
  const healStats = playerEntity.stats
  if (healStats && healStats.healingMs > 0 && playerEntity.input) {
    healStats.healingMs -= FIXED_STEP_MS
    if (healStats.healingMs <= 0) {
      healStats.healingMs = 0
      healStats.health = healStats.maxHealth
    }
    playerEntity.input.moveDirection = 0
    playerEntity.input.jumpRequested = false
    playerEntity.input.attackRequested = false
    playerEntity.input.ultimateRequested = false
    playerEntity.input.skillRequested = false
    playerEntity.input.blockRequested = false
    playerEntity.input.inputBuffer.clearAll()
  }

  syncBreakableCrateRuntimes()
  const worldUpdateStartMs = performance.now()
  world.update(TIME_STEP)
  const worldUpdateUs = Math.round(
    (performance.now() - worldUpdateStartMs) * 1000
  )
  workerPerfWorldUpdateTotalUs += worldUpdateUs
  const systemPerfLastUs = world.getSystemPerfLastUs()
  syncWorkerPerfSystemBuffers()
  for (let i = 0; i < systemPerfLastUs.length; i++) {
    const timeUs = systemPerfLastUs[i] | 0
    workerPerfSystemTotalsUs[i] += timeUs
    if (timeUs > workerPerfSystemMaxUs[i]) {
      workerPerfSystemMaxUs[i] = timeUs
    }
  }

  const pickupCollectStartMs = performance.now()
  collectPickupEntities(entities)
  playerEntityView[0] = playerEntity
  workerPerfPickupCollectTotalUs += Math.round(
    (performance.now() - pickupCollectStartMs) * 1000
  )

  const pickupUpdateStartMs = performance.now()
  sunPickupSystem.update(sunPickupEntityBuffer, playerEntityView, TIME_STEP)
  for (const e of sunPickupSystem.getPendingRemove()) {
    destroyEntityPhysicsBody(e)
    world.destroyEntity(e)
  }

  expOrbSystem.update(expOrbEntityBuffer, playerEntityView, TIME_STEP)
  for (const e of expOrbSystem.getPendingRemove()) {
    destroyEntityPhysicsBody(e)
    world.destroyEntity(e)
  }
  workerPerfPickupUpdateTotalUs += Math.round(
    (performance.now() - pickupUpdateStartMs) * 1000
  )

  syncBreakableCrateRuntimes()
  updateTerrainDebrisEntities(entities)
  flushPendingBreakableCrateBreaks()

  const cleanupStartMs = performance.now()
  cleanupDestroyedEntities()
  workerPerfCleanupTotalUs += Math.round(
    (performance.now() - cleanupStartMs) * 1000
  )

  const cameraStartMs = performance.now()
  updateCamera()
  workerPerfCameraTotalUs += Math.round(
    (performance.now() - cameraStartMs) * 1000
  )
  const fixedUs = Math.round((performance.now() - fixedStartMs) * 1000)
  workerPerfFixedCount++
  workerPerfFixedTotalUs += fixedUs
  if (fixedUs > workerPerfFixedMaxUs) {
    workerPerfFixedMaxUs = fixedUs
  }
}

function update() {
  if (isPaused || !world) return

  const updateStartMs = performance.now()
  const now = performance.now()
  let frameTime = (now - lastTime) / 1000
  lastTime = now

  // Spiral of death protection: Cap frame time
  if (frameTime > 0.25) frameTime = 0.25

  accumulator += (frameTime * timeScale1000) / DEFAULT_TIME_SCALE_1000

  let fixedSteps = 0
  while (accumulator >= TIME_STEP) {
    fixedUpdate()
    accumulator -= TIME_STEP
    fixedSteps++
  }

  const sendStateStartMs = performance.now()
  sendState()
  const sendStateUs = Math.round((performance.now() - sendStateStartMs) * 1000)
  workerPerfSendStateCount++
  workerPerfSendStateTotalUs += sendStateUs

  const updateUs = Math.round((performance.now() - updateStartMs) * 1000)
  workerPerfWindowMs += frameTime * 1000
  workerPerfUpdateCount++
  workerPerfUpdateTotalUs += updateUs
  workerPerfFixedStepsTotal += fixedSteps
  if (fixedSteps > workerPerfFixedStepsMax) {
    workerPerfFixedStepsMax = fixedSteps
  }
  if (updateUs > workerPerfUpdateMaxUs) {
    workerPerfUpdateMaxUs = updateUs
  }

  if (workerPerfWindowMs >= 1000) {
    const entityCount = world.getEntities().length
    postWorkerPerfSnapshot(entityCount)
  }
}

function collectPickupEntities(entities: Entity[]): void {
  sunPickupEntityBuffer.length = 0
  expOrbEntityBuffer.length = 0

  for (let i = 0; i < entities.length; i++) {
    const entity = entities[i]
    if (entity.sunPickup) {
      sunPickupEntityBuffer.push(entity)
    }
    if (entity.expOrb) {
      expOrbEntityBuffer.push(entity)
    }
  }
}

function buildPhysicsTerrainData(
  terrain: NonNullable<EditorMapData['terrain']>,
  pixelsPerMeterValue: number
): NonNullable<EditorMapData['terrain']> {
  if (!(pixelsPerMeterValue > 0)) {
    return terrain
  }
  const scale = 1 / pixelsPerMeterValue
  const scaledLayers = terrain.layers?.map((layer) => ({
    ...layer,
    offsetXUnits: (layer.offsetXUnits ?? 0) * scale,
    offsetYUnits: (layer.offsetYUnits ?? 0) * scale,
  }))
  if (!terrain.contours || terrain.contours.length === 0) {
    if (!scaledLayers) {
      return terrain
    }
    return {
      ...terrain,
      layers: scaledLayers,
    }
  }
  return {
    ...terrain,
    layers: scaledLayers,
    contours: terrain.contours.map((contour) => {
      const points = new Array<number>(contour.points.length)
      for (let i = 0; i < contour.points.length; i++) {
        points[i] = contour.points[i] * scale
      }
      return {
        ...contour,
        points,
      }
    }),
  }
}

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3)
}

function isHammerUltimatePhase(
  phase: NonNullable<Entity['weapon']>['ultimatePhase'] | null | undefined
): boolean {
  return typeof phase === 'string' && phase.startsWith('hammer_')
}

function isSpearUltimatePhase(
  phase: NonNullable<Entity['weapon']>['ultimatePhase'] | null | undefined
): boolean {
  return typeof phase === 'string' && phase.startsWith('spear_')
}

function resetCameraTrackingState(): void {
  isCameraLocked = false
  isTransitioning = false
  transitionStartTime = 0
  transitionStartCameraX = camera.x
  lastVelocityDirection = 0
  needsReturnToCenter = false
  lastUnlockTime = currentTime
  outOfCenterTime = 0
  horizontalForceCenterAfterEmergency = false

  isVerticalCameraLocked = false
  isVerticalTransitioning = false
  verticalTransitionStartTime = 0
  verticalTransitionStartCameraY = camera.y
  verticalOutOfCenterTime = 0
  lastVerticalUnlockTime = currentTime
  verticalLookAheadOffsetY = 0
  verticalForceCenterAfterEmergency = false
}

function setTimeScale1000(nextScale1000: number): void {
  if (!Number.isFinite(nextScale1000)) {
    timeScale1000 = DEFAULT_TIME_SCALE_1000
    return
  }
  if (nextScale1000 < 1) {
    timeScale1000 = 1
    return
  }
  if (nextScale1000 > 4000) {
    timeScale1000 = 4000
    return
  }
  timeScale1000 = Math.round(nextScale1000)
}

function syncTimeScaleState(): void {
  const weapon = playerEntity?.weapon
  if (
    weapon &&
    weapon.assassinationPhase !== null &&
    weapon.assassinationTargetId > 0
  ) {
    setTimeScale1000(ASSASSINATION_TIME_SCALE_1000)
    return
  }
  setTimeScale1000(DEFAULT_TIME_SCALE_1000)
}

function updateUltimateCameraTarget(): boolean {
  if (!playerEntity?.transform || !playerEntity.weapon) {
    return false
  }

  const weapon = playerEntity.weapon
  const assassinationTargetId = weapon.assassinationTargetId
  if (weapon.assassinationPhase !== null && assassinationTargetId > 0) {
    const target = world.getEntityById(assassinationTargetId)
    if (!target?.transform) {
      return false
    }
    const radius = playerEntity.render?.radius ?? DEFAULT_PLAYER_RADIUS
    const targetRadius = target.render?.radius ?? DEFAULT_PLAYER_RADIUS
    const focusX = (playerEntity.transform.x + target.transform.x) * 0.5
    const focusY =
      (playerEntity.transform.y +
        radius +
        (target.transform.y + targetRadius)) *
        0.5 -
      ASSASSINATION_CAMERA_FOCUS_OFFSET_Y
    const canvasHeightInMeters = canvasHeight / pixelsPerMeter
    ultimateCameraTargetZoom = Math.max(
      requestedZoom,
      ASSASSINATION_CAMERA_ZOOM
    )
    ultimateCameraTargetX = focusX - canvasWidth / (pixelsPerMeter * 2)
    ultimateCameraTargetY =
      focusY -
      canvasHeightInMeters *
        ((ULTIMATE_CAMERA_SCREEN_RATIO_Y - 1) / ultimateCameraTargetZoom + 1)
    return true
  }

  const phase = weapon.ultimatePhase
  if (phase === null) {
    return false
  }

  const radius = playerEntity.render?.radius ?? DEFAULT_PLAYER_RADIUS
  const playerFeetY = playerEntity.transform.y + radius
  let focusX = playerEntity.transform.x
  let focusY = playerFeetY
  let zoomTarget = requestedZoom

  if (isHammerUltimatePhase(phase)) {
    focusX = (playerEntity.transform.x + weapon.ultimateHammerLandX) * 0.5
    focusY = playerFeetY - HAMMER_ULTIMATE_CAMERA_FOCUS_OFFSET_Y
    zoomTarget = Math.min(requestedZoom, ULTIMATE_CAMERA_HAMMER_ZOOM)
  } else if (isSpearUltimatePhase(phase)) {
    focusX = (playerEntity.transform.x + weapon.ultimateSpearCrossX) * 0.5
    zoomTarget = Math.min(requestedZoom, ULTIMATE_CAMERA_SPEAR_ZOOM)
  } else {
    focusX = (playerEntity.transform.x + weapon.ultimateGiantX) * 0.5
    zoomTarget = Math.min(requestedZoom, ULTIMATE_CAMERA_SWORD_ZOOM)
  }

  const canvasHeightInMeters = canvasHeight / pixelsPerMeter
  ultimateCameraTargetZoom = zoomTarget
  ultimateCameraTargetX = focusX - canvasWidth / (pixelsPerMeter * 2)
  ultimateCameraTargetY =
    focusY -
    canvasHeightInMeters *
      ((ULTIMATE_CAMERA_SCREEN_RATIO_Y - 1) / ultimateCameraTargetZoom + 1)
  return true
}

function activateUltimateCamera(): void {
  if (!updateUltimateCameraTarget()) {
    ultimateCameraActive = false
    return
  }
  ultimateCameraActive = true
  resetCameraTrackingState()
}

function syncUltimateCameraState(): void {
  const weapon = playerEntity?.weapon
  const phase = weapon?.ultimatePhase
  const hasAssassinationCamera =
    weapon?.assassinationPhase !== null &&
    (weapon?.assassinationTargetId ?? 0) > 0
  if ((phase === null || phase === undefined) && !hasAssassinationCamera) {
    if (ultimateCameraActive) {
      ultimateCameraActive = false
      resetCameraTrackingState()
    }
    return
  }

  if (!ultimateCameraActive) {
    activateUltimateCamera()
    return
  }

  if (!updateUltimateCameraTarget()) {
    ultimateCameraActive = false
    resetCameraTrackingState()
  }
}

function updateCamera() {
  if (!playerEntity?.transform) return
  if (isThumbnailCameraCapture) {
    applyThumbnailCaptureCamera()
    return
  }
  const playerX = playerEntity.transform.x

  if (ultimateCameraActive) {
    if (!updateUltimateCameraTarget()) {
      ultimateCameraActive = false
      resetCameraTrackingState()
    } else {
      const diffX = ultimateCameraTargetX - camera.x
      if (Math.abs(diffX) > 0.001) {
        camera.x += diffX * 0.15
      } else {
        camera.x = ultimateCameraTargetX
      }

      const diffY = ultimateCameraTargetY - camera.y
      if (Math.abs(diffY) > 0.001) {
        camera.y += diffY * 0.12
      } else {
        camera.y = ultimateCameraTargetY
      }

      if (DEBUG_DRAW_CAMERA) {
        const radius = playerEntity.render?.radius ?? DEFAULT_PLAYER_RADIUS
        const playerFeetY = playerEntity.transform.y + radius
        const playerScreenY =
          canvasHeight +
          ((playerFeetY - camera.y) * pixelsPerMeter - canvasHeight) * zoom
        debugCameraData.topLimitRatio = 1 - ULTIMATE_CAMERA_SCREEN_RATIO_Y
        debugCameraData.bottomLimitRatio = ULTIMATE_CAMERA_SCREEN_RATIO_Y
        debugCameraData.playerScreenY = playerScreenY
        debugCameraData.playerFeetY = playerFeetY
        debugCameraData.cameraY = camera.y
        debugCameraData.zoom = zoom
        debugCameraData.isOutsideVerticalZone = false
      }

      return
    }
  }

  // --- Horizontal Logic ---
  const canvasWidthInMeters = canvasWidth / (pixelsPerMeter * zoom)
  let isNpcLocked = false
  let targetEntityX = 0

  if (
    playerEntity &&
    playerEntity.input &&
    playerEntity.input.lockedTargetId !== null
  ) {
    const targetEntity = world.getEntityById(playerEntity.input.lockedTargetId)
    if (targetEntity && targetEntity.transform) {
      const dist = Math.abs(targetEntity.transform.x - playerX)
      if (dist > canvasWidthInMeters * 0.9) {
        playerEntity.input.lockedTargetId = null
      } else {
        targetEntityX = targetEntity.transform.x
        isNpcLocked = true
      }
    }
  }

  const centerX = canvasWidth / 2
  let desiredCameraX = camera.x

  if (isNpcLocked) {
    const midPointX = (playerX + targetEntityX) * 0.5
    desiredCameraX = midPointX - centerX / pixelsPerMeter
  } else {
    const currentCameraX = camera.x
    const playerScreenX =
      centerX + ((playerX - currentCameraX) * pixelsPerMeter - centerX) * zoom

    const leftThird = canvasWidth / 3
    const rightThird = (2 * canvasWidth) / 3
    const isOutsideCenterZone =
      playerScreenX < leftThird || playerScreenX > rightThird

    // Safety check: player is too close to screen edge
    const edgeMargin = canvasWidth * 0.1
    const isNearEdge =
      playerScreenX < edgeMargin || playerScreenX > canvasWidth - edgeMargin

    // Check if player is in center zone
    const isInCenterZone = !isOutsideCenterZone

    if (isCameraLocked) {
      outOfCenterTime = 0
    } else if (isOutsideCenterZone) {
      outOfCenterTime += TIME_STEP
    } else {
      outOfCenterTime = 0
    }

    // Clear the return-to-center flag if player is back in center
    if (needsReturnToCenter && isInCenterZone) {
      needsReturnToCenter = false
    }

    // Check if we need to lock
    if (!isCameraLocked) {
      const timeSinceUnlock = currentTime - lastUnlockTime
      const canRelockWhileReturning =
        !needsReturnToCenter || outOfCenterTime >= OUTSIDE_THIRD_RELOCK_DELAY
      const normalLockCondition =
        canRelockWhileReturning && timeSinceUnlock > UNLOCK_COOLDOWN
      const emergencyLock = isNearEdge

      // Lock if in left/right third (with normal conditions) OR emergency
      if (isOutsideCenterZone) {
        if (normalLockCondition || emergencyLock) {
          isCameraLocked = true
          isTransitioning = true
          transitionStartTime = currentTime
          transitionStartCameraX = camera.x

          // Clear flags on emergency lock
          if (emergencyLock) {
            needsReturnToCenter = false
          }

          // Initialize velocity direction for turn detection
          if (playerEntity && playerEntity.physics) {
            const vel = box2d.b2Body_GetLinearVelocity(
              playerEntity.physics.bodyId
            )
            lastVelocityDirection = vel.x > 0.05 ? 1 : vel.x < -0.05 ? -1 : 0
            vel.delete()
          }
        }
      }
    }

    // Check if we need to unlock (player stopped or turned around)
    if (isCameraLocked) {
      if (playerEntity && playerEntity.physics) {
        const vel = box2d.b2Body_GetLinearVelocity(playerEntity.physics.bodyId)
        const speed = Math.abs(vel.x)
        const currentDirection = vel.x > 0.05 ? 1 : vel.x < -0.05 ? -1 : 0
        vel.delete()

        if (!horizontalForceCenterAfterEmergency) {
          // Unlock if player stopped (and not transitioning)
          if (speed < 0.1 && !isTransitioning) {
            isCameraLocked = false
            lastVelocityDirection = 0
            needsReturnToCenter = true
            lastUnlockTime = currentTime
          }
          // Unlock if player turned around (more sensitive detection)
          else if (lastVelocityDirection !== 0 && currentDirection !== 0) {
            if (lastVelocityDirection !== currentDirection) {
              isCameraLocked = false
              isTransitioning = false
              lastVelocityDirection = 0
              needsReturnToCenter = true
              lastUnlockTime = currentTime
            } else {
              // Only update direction if still moving in same direction
              lastVelocityDirection = currentDirection
            }
          } else if (currentDirection !== 0 && lastVelocityDirection === 0) {
            // Initialize direction if starting to move
            lastVelocityDirection = currentDirection
          }
        } else if (speed < 0.1) {
          lastVelocityDirection = 0
        } else if (currentDirection !== 0) {
          lastVelocityDirection = currentDirection
        }
      }
    }

    // Set desired camera position with time-based easing transition
    if (isCameraLocked) {
      const forwardOffset = lastVelocityDirection * CAMERA_FORWARD_OFFSET
      if (isTransitioning) {
        const elapsed = currentTime - transitionStartTime
        const progress = Math.min(elapsed / TRANSITION_DURATION, 1)

        if (progress >= 1) {
          isTransitioning = false
          desiredCameraX = playerX + forwardOffset - centerX / pixelsPerMeter
        } else {
          const targetX = playerX + forwardOffset - centerX / pixelsPerMeter
          const easedProgress = easeOutCubic(progress)
          desiredCameraX =
            transitionStartCameraX +
            (targetX - transitionStartCameraX) * easedProgress
        }
      } else {
        desiredCameraX = playerX + forwardOffset - centerX / pixelsPerMeter
      }
    } else {
      desiredCameraX = currentCameraX
    }
  }

  // Horizontal Interpolation
  const diffX = desiredCameraX - camera.x
  if (Math.abs(diffX) > 0.001) {
    camera.x += diffX * 0.15
  } else {
    camera.x = desiredCameraX
  }

  // Emergency Clamp: Prevent player from escaping viewport at high speed.
  if (playerEntity && playerEntity.transform) {
    const currentCameraX = camera.x
    const playerScreenX =
      centerX + ((playerX - currentCameraX) * pixelsPerMeter - centerX) * zoom
    const leftLimit = canvasWidth / 3
    const rightLimit = (2 * canvasWidth) / 3
    let didEmergencyClamp = false

    if (playerScreenX < leftLimit) {
      const targetScreenX = leftLimit
      camera.x =
        playerX - ((targetScreenX - centerX) / zoom + centerX) / pixelsPerMeter
      didEmergencyClamp = true
    } else if (playerScreenX > rightLimit) {
      const targetScreenX = rightLimit
      camera.x =
        playerX - ((targetScreenX - centerX) / zoom + centerX) / pixelsPerMeter
      didEmergencyClamp = true
    }

    if (didEmergencyClamp) {
      // After emergency catch-up, immediately hand off to slow center tracking.
      isCameraLocked = true
      isTransitioning = true
      transitionStartTime = currentTime
      transitionStartCameraX = camera.x
      outOfCenterTime = 0
      horizontalForceCenterAfterEmergency = true
      needsReturnToCenter = false
    }

    if (
      isCameraLocked &&
      !isTransitioning &&
      horizontalForceCenterAfterEmergency
    ) {
      const centerScreenX = 0.5 * canvasWidth
      const centerDelta = Math.abs(playerScreenX - centerScreenX)
      const centerEpsilon = HORIZONTAL_CENTER_UNLOCK_EPSILON_RATIO * canvasWidth
      if (centerDelta <= centerEpsilon) {
        isCameraLocked = false
        lastUnlockTime = currentTime
        outOfCenterTime = 0
        horizontalForceCenterAfterEmergency = false
        needsReturnToCenter = false
        lastVelocityDirection = 0
      }
    }
  }

  // --- Vertical Logic ---
  const canvasHeightInMeters = canvasHeight / pixelsPerMeter
  let desiredCameraY = camera.y
  const bottomLimitRatio = initialPlayerScreenRatioY
  const topLimitRatio = 1 - bottomLimitRatio
  const topLimit = topLimitRatio * canvasHeight
  const bottomLimit = bottomLimitRatio * canvasHeight

  if (playerEntity && playerEntity.transform) {
    const playerY = playerEntity.transform.y
    const playerFeetY = playerY + DEFAULT_PLAYER_RADIUS
    const currentCameraY = camera.y
    let playerVelocityY = 0
    if (playerEntity.physics) {
      const vel = box2d.b2Body_GetLinearVelocity(playerEntity.physics.bodyId)
      playerVelocityY = vel.y
      vel.delete()
    }

    // Screen-space position calculation (matching GameClient render transform)
    const playerScreenY =
      canvasHeight +
      ((playerFeetY - currentCameraY) * pixelsPerMeter - canvasHeight) * zoom

    const isOutsideVerticalZone =
      playerScreenY < topLimit || playerScreenY > bottomLimit

    if (DEBUG_DRAW_CAMERA) {
      debugCameraData.topLimitRatio = topLimitRatio
      debugCameraData.bottomLimitRatio = bottomLimitRatio
      debugCameraData.playerScreenY = playerScreenY
      debugCameraData.playerFeetY = playerFeetY
      debugCameraData.cameraY = currentCameraY
      debugCameraData.zoom = zoom
      debugCameraData.isOutsideVerticalZone = isOutsideVerticalZone
    }

    // Time tracking
    if (isVerticalCameraLocked) {
      verticalOutOfCenterTime = 0
    } else if (isOutsideVerticalZone) {
      verticalOutOfCenterTime += TIME_STEP
    } else {
      verticalOutOfCenterTime = 0
    }

    // Lock Logic
    if (!isVerticalCameraLocked) {
      const timeSinceUnlock = currentTime - lastVerticalUnlockTime

      if (
        isOutsideVerticalZone &&
        verticalOutOfCenterTime >= OUTSIDE_THIRD_RELOCK_DELAY &&
        timeSinceUnlock > UNLOCK_COOLDOWN
      ) {
        isVerticalCameraLocked = true
        isVerticalTransitioning = true
        verticalTransitionStartTime = currentTime
        verticalTransitionStartCameraY = camera.y
        verticalForceCenterAfterEmergency = false
      }
    }

    const lookAheadTarget = Math.max(
      -VERTICAL_LOOK_AHEAD_MAX,
      Math.min(
        VERTICAL_LOOK_AHEAD_MAX,
        playerVelocityY * VERTICAL_LOOK_AHEAD_TIME
      )
    )
    verticalLookAheadOffsetY +=
      (lookAheadTarget - verticalLookAheadOffsetY) * VERTICAL_LOOK_AHEAD_LERP

    // Target Calculation
    if (isVerticalCameraLocked || isVerticalTransitioning) {
      // Formula to find CameraY for a specific ScreenRatio:
      // camY = worldY - canvasHeightInMeters * ((ratio - 1) / zoom + 1)
      const trackedFeetY = playerFeetY + verticalLookAheadOffsetY
      const targetY =
        trackedFeetY -
        canvasHeightInMeters * ((VERTICAL_LOCK_SCREEN_RATIO - 1) / zoom + 1)

      if (isVerticalTransitioning) {
        const elapsed = currentTime - verticalTransitionStartTime
        const progress = Math.min(elapsed / VERTICAL_TRANSITION_DURATION, 1)

        if (progress >= 1) {
          isVerticalTransitioning = false
          desiredCameraY = targetY
        } else {
          const eased = easeOutCubic(progress)
          desiredCameraY =
            verticalTransitionStartCameraY +
            (targetY - verticalTransitionStartCameraY) * eased
        }
      } else {
        desiredCameraY = targetY
      }
    } else {
      desiredCameraY = currentCameraY
    }
  }

  // Vertical Interpolation (Time-based smoothing)
  const diffY = desiredCameraY - camera.y
  if (Math.abs(diffY) > 0.001) {
    camera.y += diffY * VERTICAL_FOLLOW_LERP
  } else {
    camera.y = desiredCameraY
  }

  // Emergency Clamp: Prevent player from escaping viewport at high speed.
  let didEmergencyClamp = false
  if (playerEntity && playerEntity.transform) {
    const playerFeetY = playerEntity.transform.y + DEFAULT_PLAYER_RADIUS
    const currentCameraY = camera.y
    const playerScreenY =
      canvasHeight +
      ((playerFeetY - currentCameraY) * pixelsPerMeter - canvasHeight) * zoom

    if (playerScreenY < topLimit) {
      const ratio = topLimitRatio
      camera.y = playerFeetY - canvasHeightInMeters * ((ratio - 1) / zoom + 1)
      didEmergencyClamp = true
    } else if (playerScreenY > bottomLimit) {
      const ratio = bottomLimitRatio
      camera.y = playerFeetY - canvasHeightInMeters * ((ratio - 1) / zoom + 1)
      didEmergencyClamp = true
    }

    if (didEmergencyClamp) {
      // After emergency catch-up, immediately hand off to slow center tracking.
      isVerticalCameraLocked = true
      isVerticalTransitioning = true
      verticalTransitionStartTime = currentTime
      verticalTransitionStartCameraY = camera.y
      verticalOutOfCenterTime = 0
      verticalForceCenterAfterEmergency = true
    }

    if (isVerticalCameraLocked && !isVerticalTransitioning) {
      if (!verticalForceCenterAfterEmergency) {
        const isInsideVerticalZone =
          playerScreenY >= topLimit && playerScreenY <= bottomLimit
        if (isInsideVerticalZone) {
          isVerticalCameraLocked = false
          lastVerticalUnlockTime = currentTime
          verticalOutOfCenterTime = 0
        }
      } else {
        const centerScreenY = VERTICAL_LOCK_SCREEN_RATIO * canvasHeight
        const centerDelta = Math.abs(playerScreenY - centerScreenY)
        const centerEpsilon =
          VERTICAL_CENTER_UNLOCK_EPSILON_RATIO * canvasHeight
        if (centerDelta <= centerEpsilon) {
          isVerticalCameraLocked = false
          lastVerticalUnlockTime = currentTime
          verticalOutOfCenterTime = 0
          verticalForceCenterAfterEmergency = false
        }
      }
      if (!isVerticalCameraLocked) {
        verticalForceCenterAfterEmergency = false
        isVerticalCameraLocked = false
      }
    }
  }
}

function cleanupDestroyedEntities() {
  const entities = world.getEntities()
  for (const entity of entities) {
    const isPlayer = entity.id === playerEntity.id

    // 清理被拾取的独立武器实体
    const isPickedUpWeapon =
      entity.weapon && entity.weapon.isEquipped && !entity.stats
    if (isPickedUpWeapon) {
      spatialHash.removeEntity(entity)
      destroyEntityPhysicsBody(entity)
      world.destroyEntity(entity)
      continue
    }

    if (entity.stats?.isDead && entity.weapon) {
      entity.weapon.hitEntityIds.clear()
      entity.removeComponent('Weapon')
    }
    if (!isPlayer && (entity.stats?.isDead || entity.stats?.isVanished)) {
      spineSegmentManager.destroySegments(entity.id)
      skeletalSegmentManager.destroySegments(entity.id)
    }
    if (entity.stats?.isVanished && !isPlayer) {
      if (npcEntity && npcEntity.id === entity.id) {
        npcEntity = null
      }
      spatialHash.removeEntity(entity)
      destroyEntityPhysicsBody(entity)
      world.destroyEntity(entity)
    }
  }
}

function destroyEntityPhysicsBody(entity: Entity): void {
  if (!entity.physics) {
    return
  }
  box2d.b2DestroyBody(entity.physics.bodyId)
  entity.removeComponent('Physics')
}

function collectSensorDebugData(entities: Entity[]): SensorDebugData[] {
  let sensorCount = 0

  for (const entity of entities) {
    if (!entity.sensor || !entity.transform) continue

    let facing = 1
    if (entity.input) {
      if (
        entity.input.facingOverride !== null &&
        entity.input.facingOverride !== 0
      ) {
        facing = entity.input.facingOverride
      } else if (entity.input.lastMoveDirection !== 0) {
        facing = entity.input.lastMoveDirection
      }
    } else if (entity.weapon) {
      facing = entity.weapon.attackFacing
    }

    const scanResults = entity.sensor.scanResults
    const entityRadius = entity.render?.radius || 0.5
    const eyeOffsetX = getCharacterEyeOffsetX(
      entity.render?.bodyProfile,
      entityRadius,
      facing
    )
    const eyeOffsetY = getCharacterEyeOffsetY(
      entity.render?.bodyProfile,
      entityRadius,
      entity.render?.bodyHeight ?? 0
    )

    let sensorDebug = debugSensors[sensorCount]
    if (!sensorDebug) {
      sensorDebug = {
        entityId: entity.id,
        x: 0,
        y: 0,
        radius: 0,
        facing: 1,
        fov: 0,
        eyeX: 0,
        eyeY: 0,
        rays: [],
      }
      debugSensors[sensorCount] = sensorDebug
    }

    sensorDebug.entityId = entity.id
    sensorDebug.x = entity.transform.x
    sensorDebug.y = entity.transform.y
    sensorDebug.radius = entity.sensor.radius
    sensorDebug.facing = facing
    sensorDebug.fov = entity.sensor.fov
    sensorDebug.eyeX = entity.transform.x + eyeOffsetX
    sensorDebug.eyeY = entity.transform.y + eyeOffsetY

    const rays = sensorDebug.rays
    for (let i = rays.length; i < scanResults.length; i++) {
      rays.push({
        startX: 0,
        startY: 0,
        endX: 0,
        endY: 0,
        hit: false,
        hitX: 0,
        hitY: 0,
        isHostile: false,
      })
    }
    if (rays.length > scanResults.length) {
      rays.length = scanResults.length
    }

    for (let i = 0; i < scanResults.length; i++) {
      const result = scanResults[i]
      const ray = rays[i]
      ray.startX = result.start.x
      ray.startY = result.start.y
      ray.endX = result.end.x
      ray.endY = result.end.y
      ray.hit = result.hit
      ray.isHostile = result.isHostile ?? false
      if (result.hit && result.hitPoint) {
        ray.hitX = result.hitPoint.x
        ray.hitY = result.hitPoint.y
      } else {
        ray.hitX = result.end.x
        ray.hitY = result.end.y
      }
    }

    sensorCount++
  }

  if (debugSensors.length > sensorCount) {
    debugSensors.length = sensorCount
  }

  return debugSensors
}

function collectSoundWaveDebugData(): SoundWaveDebugData[] {
  const waves = soundSystem.getActiveWaves()
  for (let i = 0; i < waves.length; i++) {
    const wave = waves[i]
    let debugWave = debugSoundWaves[i]
    if (!debugWave) {
      debugWave = {
        x: 0,
        y: 0,
        radius: 0,
        maxRadius: 0,
        db: 0,
      }
      debugSoundWaves[i] = debugWave
    }
    debugWave.x = wave.x
    debugWave.y = wave.y
    debugWave.radius = wave.radius
    debugWave.maxRadius = wave.maxRadius
    debugWave.db = wave.currentDb
  }

  if (debugSoundWaves.length > waves.length) {
    debugSoundWaves.length = waves.length
  }

  return debugSoundWaves
}

function collectSoundListenerDebugData(
  entities: Entity[]
): SoundListenerDebugData[] {
  let listenerCount = 0

  for (let i = 0; i < entities.length; i++) {
    const entity = entities[i]
    if (!entity.npcAI || !entity.transform) continue
    if (entity.stats?.isDead || entity.stats?.isVanished) continue

    let debugListener = debugSoundListeners[listenerCount]
    if (!debugListener) {
      debugListener = {
        entityId: entity.id,
        x: 0,
        y: 0,
        radius: 0,
      }
      debugSoundListeners[listenerCount] = debugListener
    }

    debugListener.entityId = entity.id
    debugListener.x = entity.transform.x
    debugListener.y = entity.transform.y
    debugListener.radius =
      entity.npcAI.detectionRange * ENEMY_HEARING_RANGE_MULTIPLIER

    listenerCount += 1
  }

  if (debugSoundListeners.length > listenerCount) {
    debugSoundListeners.length = listenerCount
  }

  return debugSoundListeners
}

function sendState() {
  if (!sharedStateBuffer && stateBufferViews.length === 0) {
    return
  }

  const entities = world.getEntities()
  let highlightAnchorId = -1
  if (playerEntity?.transform && playerEntity.grapple?.hasGrapple) {
    const playerX = playerEntity.transform.x
    const playerY = playerEntity.transform.y
    const facing = playerEntity.input?.lastMoveDirection ?? 1
    const forwardX = facing >= 0 ? 1 : -1
    const forwardY = 0
    const cosHalfFov = Math.cos(DEFAULT_PLAYER_FOV_RAD * 0.5)
    const rangeSq = DEFAULT_GRAPPLE_RANGE * DEFAULT_GRAPPLE_RANGE
    const isTethering = playerEntity.grapple.isTethering
    const currentTargetX = isTethering
      ? playerEntity.grapple.targetX
      : undefined
    const currentTargetY = isTethering
      ? playerEntity.grapple.targetY
      : undefined
    let bestDistSq = rangeSq + 1
    for (let i = 0; i < entities.length; i++) {
      const entity = entities[i]
      if (!entity.grappleAnchor || !entity.transform) continue

      if (
        currentTargetX !== undefined &&
        currentTargetY !== undefined &&
        Math.abs(entity.transform.x - currentTargetX) < 0.01 &&
        Math.abs(entity.transform.y - currentTargetY) < 0.01
      ) {
        continue
      }

      const dx = entity.transform.x - playerX
      const dy = entity.transform.y - playerY
      const distSq = dx * dx + dy * dy
      if (distSq > rangeSq || distSq <= 0) continue
      const invDist = 1 / Math.sqrt(distSq)
      const dot = (dx * forwardX + dy * forwardY) * invDist
      if (dot < cosHalfFov) continue
      if (distSq < bestDistSq) {
        bestDistSq = distSq
        highlightAnchorId = entity.id
      }
    }
  }
  let count = 0

  for (const e of entities) {
    if (count >= MAX_ENTITIES) break
    if (!e.transform) continue

    const isStandaloneWeapon = e.weapon && !e.weapon.isEquipped && !e.stats
    const terrainDebris = e.terrainDebris
    const isTerrainDebris = terrainDebris !== undefined
    if (
      !isStandaloneWeapon &&
      !isTerrainDebris &&
      !e.render &&
      !e.sunPickup &&
      !e.expOrb
    ) {
      continue
    }

    const offset = count * ENTITY_STRIDE

    stateBuffer[offset + OFFSETS.ID] = e.id
    // 锤子绝招期间使用视觉位置（跳跃偏移）覆盖渲染坐标
    const hammerPhase = e.weapon?.ultimatePhase
    const hammerUltActive =
      hammerPhase !== null &&
      hammerPhase !== undefined &&
      typeof hammerPhase === 'string' &&
      hammerPhase.startsWith('hammer_')
    stateBuffer[offset + OFFSETS.X] = hammerUltActive
      ? e.transform.x + (e.weapon?.ultimateHammerVisualDX ?? 0)
      : e.transform.x
    stateBuffer[offset + OFFSETS.Y] = hammerUltActive
      ? e.transform.y - (e.weapon?.ultimateHammerJumpOffsetY ?? 0)
      : e.transform.y
    stateBuffer[offset + OFFSETS.RADIUS] = e.render?.radius ?? 0
    stateBuffer[offset + OFFSETS.COLOR] = parseColor(
      e.render?.color ?? '#000000'
    )
    stateBuffer[offset + OFFSETS.BORDER_COLOR] = parseColor(
      e.render?.borderColor ?? '#000000'
    )

    let flags = 0
    if ((e.render?.visible ?? isStandaloneWeapon) || e.sunPickup || e.expOrb)
      flags |= FLAGS.VISIBLE
    if (e.stats?.isDead) flags |= FLAGS.DEAD
    if (e.stats?.isVanished) flags |= FLAGS.VANISHED
    if (e.movement?.isRolling || e.movement?.isBackstepping)
      flags |= FLAGS.ROLLING
    if (e.stats?.isStaggered) flags |= FLAGS.STAGGERED

    // 武器具有伤害力的条件（与实际碰撞检测逻辑一致）
    const isWeaponAttacking = isSkeletalWeaponAttacking(
      e.weapon?.attackPhase,
      e.movement?.isGrounded === true
    )
    const isCombatReady = isSkeletalCombatReady(
      e.weapon?.attackPhase,
      e.weapon?.isBlocking === true,
      e.input?.lockedTargetId ?? null
    )
    if (isWeaponAttacking) flags |= FLAGS.WEAPON_ATTACKING
    if (e.id === playerEntity.id) flags |= FLAGS.IS_PLAYER
    if (e.stats?.isInCombat) flags |= FLAGS.IN_COMBAT
    const hudVisibleTimer = e.stats ? e.stats.hudVisibleTimer : 0
    if (hudVisibleTimer > 0) flags |= FLAGS.HUD_VISIBLE
    if (e.stats && e.stats.healthBarTimerMs > 0) flags |= FLAGS.HEALTH_BAR_FLASH
    if (e.weapon?.isBlocking) flags |= FLAGS.WEAPON_BLOCKING
    if (e.checkpoint) flags |= FLAGS.CHECKPOINT
    if (e.checkpoint && e.render?.cellStroke === true) {
      flags |= FLAGS.CHECKPOINT_CELL_STROKE
    }
    if (e.grapple?.hasGrapple) flags |= FLAGS.GRAPPLE_READY
    if (e.grappleAnchor) flags |= FLAGS.GRAPPLE_ANCHOR
    if (e.sunPickup) {
      flags |= e.sunPickup.isLarge
        ? FLAGS.SUN_PICKUP_LARGE
        : FLAGS.SUN_PICKUP_SMALL
    }
    if (e.expOrb) {
      flags |= FLAGS.EXP_ORB
    }
    if (isTerrainDebris) {
      flags |= FLAGS.TERRAIN_DEBRIS
    }
    if (e.follow !== undefined && e.follow.followTargetId !== null) {
      flags |= FLAGS.FOLLOW_BOUND
    }
    const assassinationTargetId =
      playerEntity?.weapon?.assassinationPhase != null &&
      playerEntity?.weapon?.assassinationTargetId
        ? playerEntity.weapon.assassinationTargetId
        : (playerEntity?.input?.assassinationTargetId ?? null)
    if (assassinationTargetId === e.id) {
      flags |= FLAGS.ASSASSINATION_TARGET
    }
    if (e.follow !== undefined && e.follow.bondFlashTimer > 0) {
      flags |= FLAGS.IS_FOLLOWING
      stateBuffer[offset + OFFSETS.FOLLOW_FLASH_PROGRESS] =
        e.follow.bondFlashTimer / 1200
    } else {
      stateBuffer[offset + OFFSETS.FOLLOW_FLASH_PROGRESS] = 0
    }
    stateBuffer[offset + OFFSETS.UNBOND_FLASH_PROGRESS] =
      e.follow !== undefined && e.follow.unbondFlashTimer > 0
        ? e.follow.unbondFlashTimer / 1200
        : 0
    if (e.grappleAnchor && e.id === highlightAnchorId) {
      flags |= FLAGS.GRAPPLE_ANCHOR_HIGHLIGHT
      stateBuffer[offset + OFFSETS.COLOR] = parseColor(
        GRAPPLE_ANCHOR_HIGHLIGHT_COLOR
      )
      stateBuffer[offset + OFFSETS.BORDER_COLOR] = parseColor(
        GRAPPLE_ANCHOR_HIGHLIGHT_BORDER_COLOR
      )
    }

    stateBuffer[offset + OFFSETS.FLAGS] = flags

    stateBuffer[offset + OFFSETS.MOVE_DIR] = e.input
      ? e.input.lastMoveDirection
      : 1
    stateBuffer[offset + OFFSETS.SKELETAL_GAIT_PHASE] = e.render?.bodyProfile
      ?.skeletalMode
      ? skeletalSegmentManager.getEntityGaitPhase(e.id)
      : 0
    stateBuffer[offset + OFFSETS.MOTION_VELOCITY_X] = e.physics?.velX ?? 0
    stateBuffer[offset + OFFSETS.MOTION_VELOCITY_Y] = e.physics?.velY ?? 0
    stateBuffer[offset + OFFSETS.MOTION_IS_GROUNDED] = e.movement?.isGrounded
      ? 1
      : 0
    stateBuffer[offset + OFFSETS.MOTION_IS_SPRINTING] = e.movement?.isSprinting
      ? 1
      : 0
    stateBuffer[offset + OFFSETS.MOTION_IS_COMBAT_READY] = isCombatReady ? 1 : 0
    stateBuffer[offset + OFFSETS.ROLL_ANGLE] = e.movement
      ? e.movement.rollAngle
      : 0
    stateBuffer[offset + OFFSETS.LOCKED_TARGET_ID] =
      e.input?.lockedTargetId ?? -1
    if (e.id === playerEntity.id && e.weapon?.bowFreeAim) {
      stateBuffer[offset + OFFSETS.FREE_AIM_ACTIVE] = 1
      stateBuffer[offset + OFFSETS.FREE_AIM_X] = e.weapon.bowFreeAimReticleX
      stateBuffer[offset + OFFSETS.FREE_AIM_Y] = e.weapon.bowFreeAimReticleY
    } else {
      stateBuffer[offset + OFFSETS.FREE_AIM_ACTIVE] = 0
      stateBuffer[offset + OFFSETS.FREE_AIM_X] = 0
      stateBuffer[offset + OFFSETS.FREE_AIM_Y] = 0
    }

    if (e.stats) {
      stateBuffer[offset + OFFSETS.STATS_HEALTH_MAX] = e.stats.maxHealth
      stateBuffer[offset + OFFSETS.STATS_HEALTH] = e.stats.health
      stateBuffer[offset + OFFSETS.STATS_POSTURE_MAX] = e.stats.maxPosture
      stateBuffer[offset + OFFSETS.STATS_POSTURE] = e.stats.posture
      stateBuffer[offset + OFFSETS.STATS_DEATH_ELAPSED] =
        e.stats.deathElapsedSec
      stateBuffer[offset + OFFSETS.STATS_SHAKE_DURATION] =
        e.stats.hitShakeDurationMs
      stateBuffer[offset + OFFSETS.STATS_SHAKE_ELAPSED] =
        e.stats.hitShakeElapsedMs
      stateBuffer[offset + OFFSETS.STATS_SHAKE_INTENSITY] =
        e.stats.hitShakeIntensity
      stateBuffer[offset + OFFSETS.STATS_SHAKE_DIR_X] =
        e.stats.hitShakeDirectionX
      stateBuffer[offset + OFFSETS.STATS_DAMAGE_TEXT_VALUE] =
        e.stats.pendingDamageTextValue
      stateBuffer[offset + OFFSETS.STATS_DAMAGE_TEXT_TOKEN] =
        e.stats.pendingDamageTextToken
      e.stats.pendingDamageTextValue = 0
    } else {
      stateBuffer[offset + OFFSETS.STATS_HEALTH_MAX] = 0
      stateBuffer[offset + OFFSETS.STATS_DAMAGE_TEXT_VALUE] = 0
      stateBuffer[offset + OFFSETS.STATS_DAMAGE_TEXT_TOKEN] = 0
    }

    if (e.grapple) {
      stateBuffer[offset + OFFSETS.GRAPPLE_ACTIVE] =
        e.grapple.isPulling && !e.grapple.isRopeClimbing ? 1 : 0
      stateBuffer[offset + OFFSETS.GRAPPLE_TARGET_X] = e.grapple.targetX
      stateBuffer[offset + OFFSETS.GRAPPLE_TARGET_Y] = e.grapple.targetY
      stateBuffer[offset + OFFSETS.GRAPPLE_START_X] = e.grapple.startX
      stateBuffer[offset + OFFSETS.GRAPPLE_START_Y] = e.grapple.startY
      stateBuffer[offset + OFFSETS.GRAPPLE_VX] = e.grapple.velocityX
      stateBuffer[offset + OFFSETS.GRAPPLE_VY] = e.grapple.velocityY
    } else {
      stateBuffer[offset + OFFSETS.GRAPPLE_ACTIVE] = 0
      stateBuffer[offset + OFFSETS.GRAPPLE_TARGET_X] = 0
      stateBuffer[offset + OFFSETS.GRAPPLE_TARGET_Y] = 0
      stateBuffer[offset + OFFSETS.GRAPPLE_START_X] = 0
      stateBuffer[offset + OFFSETS.GRAPPLE_START_Y] = 0
      stateBuffer[offset + OFFSETS.GRAPPLE_VX] = 0
      stateBuffer[offset + OFFSETS.GRAPPLE_VY] = 0
    }

    if (e.solarEnergy) {
      stateBuffer[offset + OFFSETS.SOLAR_SMALL] = e.solarEnergy.smallCount
      stateBuffer[offset + OFFSETS.SOLAR_LARGE] = e.solarEnergy.largeCount
      stateBuffer[offset + OFFSETS.SOLAR_LARGE_MAX] =
        e.solarEnergy.largeMaxCount
    } else {
      stateBuffer[offset + OFFSETS.SOLAR_SMALL] = 0
      stateBuffer[offset + OFFSETS.SOLAR_LARGE] = 0
      stateBuffer[offset + OFFSETS.SOLAR_LARGE_MAX] = 0
    }

    if (e.level) {
      stateBuffer[offset + OFFSETS.PLAYER_LEVEL] = e.level.level
      const expRatio100 =
        e.level.level >= PLAYER_MAX_LEVEL
          ? 100
          : ((e.level.exp * 100) / EXP_TABLE[e.level.level - 1]) | 0
      stateBuffer[offset + OFFSETS.PLAYER_EXP_RATIO100] = expRatio100
    } else {
      stateBuffer[offset + OFFSETS.PLAYER_LEVEL] = 0
      stateBuffer[offset + OFFSETS.PLAYER_EXP_RATIO100] = 0
    }

    stateBuffer[offset + OFFSETS.BODY_HEIGHT] = e.render?.bodyHeight ?? 0
    stateBuffer[offset + OFFSETS.BODY_PROFILE_INDEX] =
      e.render?.bodyProfileIndex ?? 0
    stateBuffer[offset + OFFSETS.RENDER_LAYER] =
      e.render?.renderLayer ?? e.weapon?.renderLayer ?? 0

    // 独立武器实体（地面武器）：只要有weapon组件就显示
    // 角色实体：只有装备时才显示武器
    if (e.weapon && (!e.stats || e.weapon.isEquipped)) {
      const isBombWeapon = e.weapon.weaponType === 'bomb'
      const bombFuseRatio =
        isBombWeapon && e.weapon.bombFuseDurationMs > 0
          ? Math.max(
              0,
              Math.min(
                1,
                e.weapon.bombFuseRemainingMs / e.weapon.bombFuseDurationMs
              )
            )
          : 0
      stateBuffer[offset + OFFSETS.WEAPON_ACTIVE] = 1
      stateBuffer[offset + OFFSETS.WEAPON_X] = e.weapon.visual.x
      stateBuffer[offset + OFFSETS.WEAPON_Y] = e.weapon.visual.y
      stateBuffer[offset + OFFSETS.WEAPON_ROT] = e.weapon.visual.rotation
      stateBuffer[offset + OFFSETS.WEAPON_W] = e.weapon.width
      stateBuffer[offset + OFFSETS.WEAPON_H] = e.weapon.height
      stateBuffer[offset + OFFSETS.WEAPON_R] = e.weapon.cornerRadius
      stateBuffer[offset + OFFSETS.WEAPON_DRAW] = isBombWeapon
        ? bombFuseRatio
        : e.weapon.bowDrawRatio
      stateBuffer[offset + OFFSETS.WEAPON_DRAW_ACTIVE] =
        isBombWeapon &&
        (e.weapon.bombState === 'lit' || e.weapon.bombState === 'throw_windup')
          ? 1
          : e.weapon.bowIsDrawing
            ? 1
            : 0
      stateBuffer[offset + OFFSETS.WEAPON_HAS_ARROW] =
        e.weapon.weaponType === 'bow' && e.weapon.bowAmmo > 0 ? 1 : 0
      stateBuffer[offset + OFFSETS.WEAPON_TYPE] = getWeaponTypeId(
        e.weapon.weaponType
      )
    } else {
      stateBuffer[offset + OFFSETS.WEAPON_ACTIVE] = 0
      stateBuffer[offset + OFFSETS.WEAPON_X] = 0
      stateBuffer[offset + OFFSETS.WEAPON_Y] = 0
      stateBuffer[offset + OFFSETS.WEAPON_ROT] = 0
      stateBuffer[offset + OFFSETS.WEAPON_W] = 0
      stateBuffer[offset + OFFSETS.WEAPON_H] = 0
      stateBuffer[offset + OFFSETS.WEAPON_R] = 0
      stateBuffer[offset + OFFSETS.WEAPON_DRAW] = 0
      stateBuffer[offset + OFFSETS.WEAPON_DRAW_ACTIVE] = 0
      stateBuffer[offset + OFFSETS.WEAPON_HAS_ARROW] = 0
      stateBuffer[offset + OFFSETS.WEAPON_TYPE] = e.weapon
        ? getWeaponTypeId(e.weapon.weaponType)
        : WEAPON_TYPES.SWORD
    }

    if (isTerrainDebris) {
      const debris = terrainDebris
      if (!debris) {
        continue
      }
      const fadeStartMs = Math.min(
        debris.lifeMs,
        Math.max(0, debris.fadeStartMs)
      )
      const fadeDurationMs = Math.max(1, debris.lifeMs - fadeStartMs)
      const remainingFadeMs = Math.max(0, debris.lifeMs - debris.elapsedMs)
      const debrisAlpha1000 =
        debris.elapsedMs <= fadeStartMs
          ? 1000
          : Math.floor((remainingFadeMs * 1000) / fadeDurationMs)
      stateBuffer[offset + OFFSETS.WEAPON_ACTIVE] = 0
      stateBuffer[offset + OFFSETS.WEAPON_ROT] = e.transform.rotation
      stateBuffer[offset + OFFSETS.WEAPON_W] = debris.width
      stateBuffer[offset + OFFSETS.WEAPON_H] = debris.height
      stateBuffer[offset + OFFSETS.WEAPON_DRAW] = debrisAlpha1000 / 1000
      stateBuffer[offset + OFFSETS.WEAPON_TYPE] = debris.variant
    }

    if (e.weaponSlots) {
      const weaponSlots = e.weaponSlots
      const mainSlot = weaponSlots.main
      const secondarySlot = weaponSlots.secondary
      const activeSlotIndex = weaponSlots.activeSlot === 'main' ? 0 : 1
      let mainAmmo = mainSlot.bowAmmo
      let secondaryAmmo = secondarySlot.bowAmmo
      let mainSize = mainSlot.sizeLevel
      let secondarySize = secondarySlot.sizeLevel
      let mainMax = mainSlot.sizeMaxLevel
      let secondaryMax = secondarySlot.sizeMaxLevel

      if (e.weapon && e.weapon.isEquipped) {
        if (activeSlotIndex === 0) {
          mainAmmo = e.weapon.bowAmmo
          mainSize = e.weapon.sizeLevel
          mainMax = e.weapon.sizeMaxLevel
        } else {
          secondaryAmmo = e.weapon.bowAmmo
          secondarySize = e.weapon.sizeLevel
          secondaryMax = e.weapon.sizeMaxLevel
        }
      }

      stateBuffer[offset + OFFSETS.WEAPON_SLOT_MAIN_HAS] = mainSlot.hasWeapon
        ? 1
        : 0
      stateBuffer[offset + OFFSETS.WEAPON_SLOT_MAIN_TYPE] = mainSlot.hasWeapon
        ? getWeaponTypeId(mainSlot.weaponType)
        : WEAPON_TYPES.SWORD
      stateBuffer[offset + OFFSETS.WEAPON_SLOT_MAIN_W] = mainSlot.width
      stateBuffer[offset + OFFSETS.WEAPON_SLOT_MAIN_H] = mainSlot.height
      stateBuffer[offset + OFFSETS.WEAPON_SLOT_MAIN_AMMO] = mainAmmo
      stateBuffer[offset + OFFSETS.WEAPON_SLOT_MAIN_SIZE] = mainSize
      stateBuffer[offset + OFFSETS.WEAPON_SLOT_MAIN_MAX] = mainMax

      stateBuffer[offset + OFFSETS.WEAPON_SLOT_SECONDARY_HAS] =
        secondarySlot.hasWeapon ? 1 : 0
      stateBuffer[offset + OFFSETS.WEAPON_SLOT_SECONDARY_TYPE] =
        secondarySlot.hasWeapon
          ? getWeaponTypeId(secondarySlot.weaponType)
          : WEAPON_TYPES.SWORD
      stateBuffer[offset + OFFSETS.WEAPON_SLOT_SECONDARY_W] =
        secondarySlot.width
      stateBuffer[offset + OFFSETS.WEAPON_SLOT_SECONDARY_H] =
        secondarySlot.height
      stateBuffer[offset + OFFSETS.WEAPON_SLOT_SECONDARY_AMMO] = secondaryAmmo
      stateBuffer[offset + OFFSETS.WEAPON_SLOT_SECONDARY_SIZE] = secondarySize
      stateBuffer[offset + OFFSETS.WEAPON_SLOT_SECONDARY_MAX] = secondaryMax
      stateBuffer[offset + OFFSETS.WEAPON_SLOT_ACTIVE] = activeSlotIndex
    } else {
      stateBuffer[offset + OFFSETS.WEAPON_SLOT_MAIN_HAS] = 0
      stateBuffer[offset + OFFSETS.WEAPON_SLOT_MAIN_TYPE] = WEAPON_TYPES.SWORD
      stateBuffer[offset + OFFSETS.WEAPON_SLOT_MAIN_W] = 0
      stateBuffer[offset + OFFSETS.WEAPON_SLOT_MAIN_H] = 0
      stateBuffer[offset + OFFSETS.WEAPON_SLOT_MAIN_AMMO] = 0
      stateBuffer[offset + OFFSETS.WEAPON_SLOT_MAIN_SIZE] = 0
      stateBuffer[offset + OFFSETS.WEAPON_SLOT_MAIN_MAX] = 0
      stateBuffer[offset + OFFSETS.WEAPON_SLOT_SECONDARY_HAS] = 0
      stateBuffer[offset + OFFSETS.WEAPON_SLOT_SECONDARY_TYPE] =
        WEAPON_TYPES.SWORD
      stateBuffer[offset + OFFSETS.WEAPON_SLOT_SECONDARY_W] = 0
      stateBuffer[offset + OFFSETS.WEAPON_SLOT_SECONDARY_H] = 0
      stateBuffer[offset + OFFSETS.WEAPON_SLOT_SECONDARY_AMMO] = 0
      stateBuffer[offset + OFFSETS.WEAPON_SLOT_SECONDARY_SIZE] = 0
      stateBuffer[offset + OFFSETS.WEAPON_SLOT_SECONDARY_MAX] = 0
      stateBuffer[offset + OFFSETS.WEAPON_SLOT_ACTIVE] = 0
    }

    if (e.attackSlots) {
      const ultimateSlot = e.attackSlots.ultimate
      const cooldownRatio =
        ultimateSlot.cooldownRemainingMs > 0
          ? Math.min(
              100,
              Math.ceil(
                (ultimateSlot.cooldownRemainingMs * 100) / ULTIMATE_COOLDOWN_MS
              )
            )
          : 0
      // 动画进行中时也视为不可用（ULTIMATE_SWORD_ACTIVE 在后面写入，这里先判断 weapon）
      const ultimateAnimating = e.weapon?.ultimatePhase != null
      stateBuffer[offset + OFFSETS.ULTIMATE_COOLDOWN_RATIO] = cooldownRatio
      stateBuffer[offset + OFFSETS.ULTIMATE_READY] =
        ultimateSlot.hasMoveset && cooldownRatio === 0 && !ultimateAnimating
          ? 1
          : 0
    } else {
      stateBuffer[offset + OFFSETS.ULTIMATE_COOLDOWN_RATIO] = 0
      stateBuffer[offset + OFFSETS.ULTIMATE_READY] = 0
    }

    if (e.weapon) {
      const w = e.weapon
      const giantSwordVisible =
        w.ultimatePhase !== null &&
        (w.ultimateGiantRise100 > 0 || w.ultimateGiantAlpha100 > 0)
      const spearUltActive =
        w.ultimatePhase !== null &&
        typeof w.ultimatePhase === 'string' &&
        w.ultimatePhase.startsWith('spear_') &&
        w.ultimateSpearAlpha100 > 0
      // 1=巨剑可见, 2=绝招动画进行中(手剑需置顶), 0=无
      stateBuffer[offset + OFFSETS.ULTIMATE_SWORD_ACTIVE] = giantSwordVisible
        ? 1
        : w.ultimatePhase !== null
          ? 2
          : 0
      stateBuffer[offset + OFFSETS.ULTIMATE_SWORD_X] = w.ultimateGiantX
      stateBuffer[offset + OFFSETS.ULTIMATE_SWORD_GROUND_Y] =
        w.ultimateGiantGroundY
      stateBuffer[offset + OFFSETS.ULTIMATE_SWORD_RISE100] =
        w.ultimateGiantRise100
      stateBuffer[offset + OFFSETS.ULTIMATE_SWORD_ALPHA100] =
        w.ultimateGiantAlpha100
      // 锤子绝招状态
      stateBuffer[offset + OFFSETS.HAMMER_ULTIMATE_ACTIVE] = hammerUltActive
        ? 1
        : 0
      stateBuffer[offset + OFFSETS.HAMMER_ULTIMATE_IMPACT100] = hammerUltActive
        ? w.ultimateHammerImpact100
        : 0
      stateBuffer[offset + OFFSETS.SPEAR_ULTIMATE_ACTIVE] = spearUltActive
        ? 1
        : 0
      stateBuffer[offset + OFFSETS.SPEAR_ULTIMATE_ALPHA100] = spearUltActive
        ? w.ultimateSpearAlpha100
        : 0
      stateBuffer[offset + OFFSETS.SPEAR_ULTIMATE_TOP_X] = spearUltActive
        ? w.ultimateSpearTopX
        : 0
      stateBuffer[offset + OFFSETS.SPEAR_ULTIMATE_TOP_Y] = spearUltActive
        ? w.ultimateSpearTopY
        : 0
      stateBuffer[offset + OFFSETS.SPEAR_ULTIMATE_TOP_ROT] = spearUltActive
        ? w.ultimateSpearTopRot
        : 0
      stateBuffer[offset + OFFSETS.SPEAR_ULTIMATE_BOTTOM_X] = spearUltActive
        ? w.ultimateSpearBottomX
        : 0
      stateBuffer[offset + OFFSETS.SPEAR_ULTIMATE_BOTTOM_Y] = spearUltActive
        ? w.ultimateSpearBottomY
        : 0
      stateBuffer[offset + OFFSETS.SPEAR_ULTIMATE_BOTTOM_ROT] = spearUltActive
        ? w.ultimateSpearBottomRot
        : 0
      stateBuffer[offset + OFFSETS.SPEAR_ULTIMATE_W] = spearUltActive
        ? w.ultimateGiantX
        : 0
      stateBuffer[offset + OFFSETS.SPEAR_ULTIMATE_H] = spearUltActive
        ? w.ultimateGiantGroundY
        : 0
    } else {
      stateBuffer[offset + OFFSETS.ULTIMATE_SWORD_ACTIVE] = 0
      stateBuffer[offset + OFFSETS.ULTIMATE_SWORD_X] = 0
      stateBuffer[offset + OFFSETS.ULTIMATE_SWORD_GROUND_Y] = 0
      stateBuffer[offset + OFFSETS.ULTIMATE_SWORD_RISE100] = 0
      stateBuffer[offset + OFFSETS.ULTIMATE_SWORD_ALPHA100] = 0
      stateBuffer[offset + OFFSETS.HAMMER_ULTIMATE_ACTIVE] = 0
      stateBuffer[offset + OFFSETS.HAMMER_ULTIMATE_IMPACT100] = 0
      stateBuffer[offset + OFFSETS.SPEAR_ULTIMATE_ACTIVE] = 0
      stateBuffer[offset + OFFSETS.SPEAR_ULTIMATE_ALPHA100] = 0
      stateBuffer[offset + OFFSETS.SPEAR_ULTIMATE_TOP_X] = 0
      stateBuffer[offset + OFFSETS.SPEAR_ULTIMATE_TOP_Y] = 0
      stateBuffer[offset + OFFSETS.SPEAR_ULTIMATE_TOP_ROT] = 0
      stateBuffer[offset + OFFSETS.SPEAR_ULTIMATE_BOTTOM_X] = 0
      stateBuffer[offset + OFFSETS.SPEAR_ULTIMATE_BOTTOM_Y] = 0
      stateBuffer[offset + OFFSETS.SPEAR_ULTIMATE_BOTTOM_ROT] = 0
      stateBuffer[offset + OFFSETS.SPEAR_ULTIMATE_W] = 0
      stateBuffer[offset + OFFSETS.SPEAR_ULTIMATE_H] = 0
    }
    // 绝招边框闪烁（仅玩家）
    if (e === playerEntity) {
      stateBuffer[offset + OFFSETS.ULTIMATE_FLASH_TIMER100] =
        ultimateFlashRemainingMs > 0
          ? Math.ceil(
              (ultimateFlashRemainingMs * 100) / ULTIMATE_FLASH_DURATION_MS
            )
          : 0
    } else {
      stateBuffer[offset + OFFSETS.ULTIMATE_FLASH_TIMER100] = 0
    }

    // 技能槽数据（仅玩家读取）
    if (e === playerEntity && e.attackSlots) {
      const skillSlot = e.attackSlots.skill
      stateBuffer[offset + OFFSETS.SKILL_HAS] = skillSlot.skillId ? 1 : 0
      stateBuffer[offset + OFFSETS.SKILL_CHARGES] = skillSlot.chargesRemaining
      stateBuffer[offset + OFFSETS.SKILL_MAX_CHARGES] = skillSlot.maxCharges
    } else {
      stateBuffer[offset + OFFSETS.SKILL_HAS] = 0
      stateBuffer[offset + OFFSETS.SKILL_CHARGES] = 0
      stateBuffer[offset + OFFSETS.SKILL_MAX_CHARGES] = 0
    }

    count++
  }

  let ropePointCount = 0
  if (playerEntity && grappleSystem) {
    ropePointCount = grappleSystem.writeActiveRopePoints(
      playerEntity,
      stateBuffer,
      ROPE_POINTS_BASE_OFFSET,
      MAX_ROPE_POINTS
    )
  }

  stateMessage.entitiesBuffer = stateBuffer.buffer
  stateMessage.entityCount = count
  stateMessage.effectsCount = effectsCount
  stateMessage.ropePointCount = ropePointCount
  stateMessage.camera.x = camera.x
  stateMessage.camera.y = camera.y
  stateMessage.zoom = zoom
  stateMessage.timeScale1000 = timeScale1000
  const hasSpineCollisionDebug =
    DEBUG_DRAW_PLAYER_COLLISION_SHAPE &&
    (spineSegmentManager.getMaxActiveCoverageRadius() > 0 ||
      skeletalSegmentManager.getMaxActiveCoverageRadius() > 0)
  const shouldSendDebug =
    DEBUG_DRAW_SENSORS ||
    DEBUG_DRAW_SOUND ||
    DEBUG_DRAW_CAMERA ||
    hasSpineCollisionDebug ||
    hadSpineCollisionDebugLastFrame
  if (sharedStateBuffer) {
    ctx.postMessage(stateMessage)
    if (shouldSendDebug) {
      debugMessage.sensors = DEBUG_DRAW_SENSORS
        ? collectSensorDebugData(entities)
        : emptySensors
      debugMessage.soundWaves = DEBUG_DRAW_SOUND
        ? collectSoundWaveDebugData()
        : emptySoundWaves
      debugMessage.soundListeners = DEBUG_DRAW_SOUND
        ? collectSoundListenerDebugData(entities)
        : emptySoundListeners
      debugMessage.camera = DEBUG_DRAW_CAMERA ? debugCameraData : null
      debugMessage.spineCollisions = hasSpineCollisionDebug
        ? [
            ...spineSegmentManager.collectDebugCollisionData(),
            ...skeletalSegmentManager.collectDebugCollisionData(),
          ]
        : emptySpineCollisions
      hadSpineCollisionDebugLastFrame = hasSpineCollisionDebug
      ctx.postMessage(debugMessage)
    }
    effectsCount = 0
    return
  }

  const buffer = stateBuffer.buffer as ArrayBuffer
  ctx.postMessage(stateMessage, [buffer])
  if (shouldSendDebug) {
    debugMessage.sensors = DEBUG_DRAW_SENSORS
      ? collectSensorDebugData(entities)
      : emptySensors
    debugMessage.soundWaves = DEBUG_DRAW_SOUND
      ? collectSoundWaveDebugData()
      : emptySoundWaves
    debugMessage.soundListeners = DEBUG_DRAW_SOUND
      ? collectSoundListenerDebugData(entities)
      : emptySoundListeners
    debugMessage.camera = DEBUG_DRAW_CAMERA ? debugCameraData : null
    debugMessage.spineCollisions = hasSpineCollisionDebug
      ? [
          ...spineSegmentManager.collectDebugCollisionData(),
          ...skeletalSegmentManager.collectDebugCollisionData(),
        ]
      : emptySpineCollisions
    hadSpineCollisionDebugLastFrame = hasSpineCollisionDebug
    ctx.postMessage(debugMessage)
  }
  effectsCount = 0

  const nextView = stateBufferViews.pop()
  if (nextView) {
    stateBuffer = nextView
  }
}

function restart() {
  if (!world || !box2d) return
  if (spineSegmentManager) {
    spineSegmentManager.clear()
  }
  if (skeletalSegmentManager) {
    skeletalSegmentManager.clear()
  }
  hadSpineCollisionDebugLastFrame = false
  world.clear()
  if (worldId) {
    const { b2DestroyWorld } = box2d
    b2DestroyWorld(worldId)
  }
  const { b2DefaultWorldDef, b2CreateWorld, b2Vec2 } = box2d
  const worldDef = b2DefaultWorldDef()
  worldDef.gravity = new b2Vec2(0, DEFAULT_GRAVITY)
  worldId = b2CreateWorld(worldDef)
  worldDef.delete()
  spatialHash = new SpatialHash(5)
  obstacles = []

  const groundHeight = 0.5
  const groundY = canvasHeight / pixelsPerMeter - groundHeight
  groundTopY = groundY - groundHeight

  refreshActiveMapCollisionLayers()
  createEnvironment()
  if (activeMapData) {
    const runtimeMapData = buildRuntimeMapData(activeMapData)
    if (runtimeMapData) {
      ctx.postMessage({
        type: 'map_data',
        map: runtimeMapData,
      })
    }
  }
  initializeSystems()
  npcEntity = null
  createPlayerAndWeapon(groundTopY, activeMapData)

  npcAISystem.setPlayer(playerEntity)
  soundSystem.setPlayer(playerEntity)
  targetingSystem.setPlayer(playerEntity)

  prevKeys.clear()
  currKeys.clear()
  prevMouseButtons.clear()
  currMouseButtons.clear()
  rHoldMs = 0
  rHoldActive = false
  rHoldTriggered = false
  lockCancelOnReleaseArmed = false
  lockSwitchAttemptedDuringHold = false
  resetLockSwitchMouseSwipe()

  // Reset camera state variables
  isCameraLocked = false
  isTransitioning = false
  transitionStartTime = 0
  transitionStartCameraX = 0
  lastVelocityDirection = 0
  needsReturnToCenter = false
  lastUnlockTime = 0
  outOfCenterTime = 0

  // Reset Vertical State
  isVerticalCameraLocked = false
  isVerticalTransitioning = false
  verticalTransitionStartTime = 0
  verticalTransitionStartCameraY = 0
  verticalOutOfCenterTime = 0
  lastVerticalUnlockTime = 0
  initialPlayerScreenRatioY = 0.8
  verticalLookAheadOffsetY = 0
  verticalForceCenterAfterEmergency = false
  ultimateCameraActive = false
  ultimateCameraTargetX = 0
  ultimateCameraTargetY = 0
  ultimateCameraTargetZoom = DEFAULT_CAMERA_ZOOM

  if (activeMapData) {
    applyMapCamera(activeMapData)
  } else if (playerEntity && playerEntity.transform) {
    camera.x = 0
    camera.y = 0
    zoom = DEFAULT_CAMERA_ZOOM
    requestedZoom = DEFAULT_CAMERA_ZOOM
    targetZoom = DEFAULT_CAMERA_ZOOM

    const centerX = canvasWidth / 2
    camera.x = playerEntity.transform.x - centerX / pixelsPerMeter

    // Vertical initialization
    const canvasHeightInMeters = canvasHeight / pixelsPerMeter
    camera.y = canvasHeightInMeters - canvasHeightInMeters

    initialPlayerScreenRatioY = 0.8

    isCameraLocked = true
  }
  effectsCount = 0
  isPaused = false
  lastTime = performance.now()
  accumulator = 0
  currentTime = 0
  resetWorkerPerfWindow()
}

// Message Handler
ctx.onmessage = (e: MessageEvent<MainToWorkerMessage>) => {
  const msg = e.data
  switch (msg.type) {
    case 'init':
      init(msg.canvasWidth, msg.canvasHeight, msg.pixelsPerMeter)
      break
    case 'input':
      if (world && playerEntity && 'mouseButtons' in msg) {
        handleInput(
          msg.keys,
          msg.mouseButtons,
          msg.mouseZoom,
          msg.mouseX,
          msg.mouseY,
          msg.mouseDeltaX,
          msg.mouseDeltaY,
          msg.mouseCaptured
        )
      }
      break
    case 'buffer_release':
      releaseStateBuffer(msg.buffer)
      break
    case 'spine_collision_data':
      spineCollisionDataByNpcType.set(msg.data.npcType, msg.data)
      if (spineSegmentManager) {
        spineSegmentManager.setCollisionData(msg.data)
      }
      break
    case 'control':
      if (msg.action === 'stop') isPaused = true
      if (msg.action === 'start') {
        isPaused = false
        lastTime = performance.now()
      }
      if (msg.action === 'restart') restart()
      if (msg.action === 'clear_map_preview') {
        activeMapData = defaultMapData
        isMapPreview = false
        isThumbnailCameraCapture = false
        restart()
        if (activeMapData) {
          const runtimeMapData = buildRuntimeMapData(activeMapData)
          if (runtimeMapData) {
            ctx.postMessage({
              type: 'map_data',
              map: runtimeMapData,
            })
          }
        }
      }
      if (msg.action === 'reload_default_map') {
        void reloadDefaultMap()
      }
      if (msg.action === 'update_param') {
        updateParam(msg.paramId, msg.value)
      }
      break
    case 'map_preview':
      activeMapData = msg.map
      isMapPreview = true
      isThumbnailCameraCapture = msg.thumbnailCapture === true
      restart()
      break
    case 'save_request':
      exportGameState(msg.saveId)
      break
    case 'load_save':
      loadFromSave(msg.saveData)
      break
    case 'allocate_player_upgrade':
      applyPlayerUpgrade(msg.stat)
      break
    case 'resize':
      canvasWidth = msg.canvasWidth
      canvasHeight = msg.canvasHeight
      weaponSystem?.setViewportSize(
        canvasWidth / pixelsPerMeter,
        canvasHeight / pixelsPerMeter
      )
      break
  }
}

function updateParam(id?: string, value?: number) {
  if (!id || value === undefined) return

  if (!playerEntity) {
    pendingParams[id] = value
    return
  }

  // Map params similarly to main.ts
  // 'jumpForce' -> player.movement.jumpForce
  // etc.
  // Ideally we should have a map or switch

  if (playerEntity.movement) {
    switch (id) {
      case 'jumpForce':
        playerEntity.movement.jumpForce = value
        break
      case 'maxJumpDuration':
        playerEntity.movement.maxJumpDuration = value
        break
      case 'jumpForceMultiplier':
        playerEntity.movement.jumpForceMultiplier = value
        break
      case 'wallJumpPushAway':
        playerEntity.movement.wallJumpPushAwayMultiplier = value
        break
      case 'wallJumpUpward':
        playerEntity.movement.wallJumpUpwardMultiplier = value
        break
      case 'maxWallJumps':
        playerEntity.movement.maxWallJumps = Math.floor(value)
        break
      case 'moveSpeed':
        playerEntity.movement.baseMoveSpeed = value >= 0 ? value : 0
        playerEntity.movement.moveSpeed = playerEntity.movement.baseMoveSpeed
        break
      case 'baseWeight':
        playerEntity.movement.baseWeight = Math.max(1, value)
        break
    }
    // Handle carryWeight sync if needed? done in update usually
  }

  if (playerEntity.physics) {
    if (id === 'bodyFriction') {
      const { b2Shape_SetFriction } = box2d
      if (playerEntity.physics.shapeIds.length > 0) {
        for (let i = 0; i < playerEntity.physics.shapeIds.length; i++) {
          b2Shape_SetFriction(playerEntity.physics.shapeIds[i], value)
        }
      } else {
        b2Shape_SetFriction(playerEntity.physics.shapeId, value)
      }
      if (playerEntity.movement) {
        playerEntity.movement.bodyFriction = value
        if (playerEntity.movement.isGrounded) {
          playerEntity.movement.currentFriction = value
        }
      }
    }
    if (id === 'bodyLinearDamping') {
      const { b2Body_SetLinearDamping } = box2d
      b2Body_SetLinearDamping(playerEntity.physics.bodyId, value)
    }
  }

  if (id === 'groundFriction') {
    groundFriction = value
    if (groundShapeIds.length > 0) {
      const { b2Shape_SetFriction } = box2d
      for (let i = 0; i < groundShapeIds.length; i++) {
        b2Shape_SetFriction(groundShapeIds[i], value)
      }
    }
  }

  if (id === 'obstacleFriction') {
    obstacleFriction = value
    const { b2Shape_SetFriction } = box2d
    obstacles.forEach((obs) => {
      // Only update the Top Cap friction
      b2Shape_SetFriction(obs.capShapeId, value)
      // Base friction remains 0
    })
  }

  if (id === 'ropeDensity') {
    grappleSystem.setRopeDensity(value)
  }

  if (id === 'breakableCrateDensity') {
    breakableCrateDensity = Math.max(0, value)
    applyBreakableCratePreBreakParams()
  }

  if (id === 'breakableCrateFriction') {
    breakableCrateFriction = Math.max(0, value)
    applyBreakableCratePreBreakParams()
  }

  if (id === 'breakableCrateLinearDamping') {
    breakableCrateLinearDamping = Math.max(0, value)
    applyBreakableCratePreBreakParams()
  }

  if (id === 'breakableCrateAngularDamping') {
    breakableCrateAngularDamping = Math.max(0, value)
    applyBreakableCratePreBreakParams()
  }

  if (id === 'breakableCrateRestitution') {
    breakableCrateRestitution = Math.max(0, value)
    applyBreakableCratePreBreakParams()
  }

  if (id === 'ropeLinearDamping') {
    grappleSystem.setRopeLinearDamping(value)
  }

  if (id === 'ropeHertz') {
    grappleSystem.setRopeHertz(value)
  }

  if (id === 'ropeDampingRatio') {
    grappleSystem.setRopeDampingRatio(value)
  }

  if (id === 'ropeClimbLinearDamping') {
    grappleSystem.setRopeClimbLinearDamping(value)
  }

  if (id === 'ropeClimbHertz') {
    grappleSystem.setRopeClimbHertz(value)
  }

  if (id === 'ropeClimbDampingRatio') {
    grappleSystem.setRopeClimbDampingRatio(value)
  }

  if (id === 'ropeClimbWeightForceScale') {
    grappleSystem.setRopeClimbWeightForceScale(value)
  }

  if (id === 'ropeClimbJumpRecoilScale') {
    grappleSystem.setRopeClimbJumpRecoilScale(value)
  }

  if (id === 'swingForce') {
    grappleSystem.setSwingForce(value)
  }

  if (id === 'jumpBufferWindow') {
    if (playerEntity.input) {
      playerEntity.input.inputBuffer.setDefaultBufferWindow(value)
    }
  }
}

function ensureTransformTemps(): void {
  if (!box2d) return
  if (!tempSetTransformVec) {
    tempSetTransformVec = new box2d.b2Vec2(0, 0)
  }
  if (!tempZeroVec) {
    tempZeroVec = new box2d.b2Vec2(0, 0)
  }
  if (!tempSetTransformRot) {
    tempSetTransformRot = new box2d.b2Rot()
    tempSetTransformRot.SetAngle(0)
  }
}

function setBodyLinearVelocity(
  bodyId: b2BodyId,
  velocityX: number,
  velocityY: number
): void {
  if (!box2d) {
    return
  }
  ensureTransformTemps()
  if (!tempSetTransformVec) {
    return
  }
  tempSetTransformVec.Set(velocityX, velocityY)
  box2d.b2Body_SetLinearVelocity(bodyId, tempSetTransformVec)
}

function setEntityTransformFromSave(
  entity: Entity,
  x: number,
  y: number
): void {
  if (!entity.transform) return
  entity.transform.x = x
  entity.transform.y = y

  if (!entity.physics || !box2d) return

  ensureTransformTemps()
  if (!tempSetTransformVec || !tempZeroVec || !tempSetTransformRot) return

  tempSetTransformVec.Set(x, y)
  box2d.b2Body_SetTransform(
    entity.physics.bodyId,
    tempSetTransformVec,
    tempSetTransformRot
  )
  box2d.b2Body_SetLinearVelocity(entity.physics.bodyId, tempZeroVec)
  entity.physics.posX = x
  entity.physics.posY = y
  entity.physics.prevX = x
  entity.physics.prevY = y
  entity.physics.velX = 0
  entity.physics.velY = 0
  entity.physics.hasPrev = true
}

function ensureNpcPersistentId(entity: Entity): string {
  if (!entity.stats) return ''
  if (entity.stats.persistentId) {
    return entity.stats.persistentId
  }
  const nextId = `npc-${nextPersistentNpcId}`
  nextPersistentNpcId += 1
  entity.stats.persistentId = nextId
  return nextId
}

function syncNpcIdCounter(persistentId: string): void {
  const hasNpcPrefix = persistentId.startsWith('npc-')
  const hasEnemyPrefix = persistentId.startsWith('enemy-')
  if (!hasNpcPrefix && !hasEnemyPrefix) return
  const suffix = persistentId.slice(hasNpcPrefix ? 4 : 6)
  const parsed = Number.parseInt(suffix, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) return
  if (parsed >= nextPersistentNpcId) {
    nextPersistentNpcId = parsed + 1
  }
}

function applyWeaponSlotState(
  slot: {
    hasWeapon: boolean
    weaponType: WeaponVisualType
    movesetId: string
    width: number
    height: number
    baseWidth: number
    sizeLevel: number
    sizeMaxLevel: number
    cornerRadius: number
    weight: number
    attackDamage: number
    postureDamage: number
    toughnessDamage: number
    bowAmmo: number
    bowAmmoMax: number
  },
  state: SaveWeaponSlotState | null
): void {
  if (!state) {
    slot.hasWeapon = false
    slot.movesetId = ''
    return
  }

  const normalizedWeaponType = normalizeWeaponType(state.weaponType)
  if (!normalizedWeaponType) {
    slot.hasWeapon = false
    slot.movesetId = ''
    return
  }

  slot.hasWeapon = true
  slot.weaponType = normalizedWeaponType
  slot.movesetId = getDefaultAttackMovesetIdForWeaponType(normalizedWeaponType)
  slot.sizeLevel = state.sizeLevel
  if (state.width !== undefined) slot.width = state.width
  if (state.height !== undefined) slot.height = state.height
  if (state.baseWidth !== undefined) slot.baseWidth = state.baseWidth
  if (state.sizeMaxLevel !== undefined) slot.sizeMaxLevel = state.sizeMaxLevel
  if (state.cornerRadius !== undefined) slot.cornerRadius = state.cornerRadius
  if (state.weight !== undefined) slot.weight = state.weight
  slot.attackDamage = state.attackDamage
  slot.postureDamage = state.postureDamage
  slot.toughnessDamage = state.toughnessDamage
  slot.bowAmmo = state.bowAmmo
  slot.bowAmmoMax = state.bowAmmoMax
}

function syncActiveSlotFromWeapon(
  weaponSlots: {
    activeSlot: 'main' | 'secondary'
    main: {
      hasWeapon: boolean
      weaponType: WeaponVisualType
      movesetId: string
      width: number
      height: number
      baseWidth: number
      sizeLevel: number
      sizeMaxLevel: number
      cornerRadius: number
      weight: number
      attackDamage: number
      postureDamage: number
      toughnessDamage: number
      bowAmmo: number
      bowAmmoMax: number
    }
    secondary: {
      hasWeapon: boolean
      weaponType: WeaponVisualType
      movesetId: string
      width: number
      height: number
      baseWidth: number
      sizeLevel: number
      sizeMaxLevel: number
      cornerRadius: number
      weight: number
      attackDamage: number
      postureDamage: number
      toughnessDamage: number
      bowAmmo: number
      bowAmmoMax: number
    }
  },
  weapon: {
    isEquipped: boolean
    weaponType: WeaponVisualType
    movesetId: string
    width: number
    height: number
    baseWidth: number
    sizeLevel: number
    sizeMaxLevel: number
    cornerRadius: number
    weight: number
    attackDamage: number
    postureDamage: number
    toughnessDamage: number
    bowAmmo: number
    bowAmmoMax: number
  }
): void {
  if (!weapon.isEquipped) return
  const targetSlot =
    weaponSlots.activeSlot === 'main' ? weaponSlots.main : weaponSlots.secondary
  targetSlot.hasWeapon = true
  targetSlot.weaponType = weapon.weaponType
  targetSlot.movesetId =
    weapon.movesetId ||
    getDefaultAttackMovesetIdForWeaponType(weapon.weaponType)
  targetSlot.width = weapon.baseWidth
  targetSlot.height = weapon.height
  targetSlot.baseWidth = weapon.baseWidth
  targetSlot.sizeLevel = weapon.sizeLevel
  targetSlot.sizeMaxLevel = weapon.sizeMaxLevel
  targetSlot.cornerRadius = weapon.cornerRadius
  targetSlot.weight = weapon.weight
  targetSlot.attackDamage = weapon.attackDamage
  targetSlot.postureDamage = weapon.postureDamage
  targetSlot.toughnessDamage = weapon.toughnessDamage
  targetSlot.bowAmmo = weapon.bowAmmo
  targetSlot.bowAmmoMax = weapon.bowAmmoMax
}

function applyWeaponFromSlot(
  weapon: {
    sizeLevel: number
    width: number
    height: number
    baseWidth: number
    sizeMaxLevel: number
    cornerRadius: number
    weight: number
    blockWidthStart: number
    blockWidthTarget: number
    weaponType: WeaponVisualType
    movesetId: string
    attackDamage: number
    postureDamage: number
    toughnessDamage: number
    bowAmmo: number
    bowAmmoMax: number
    isEquipped: boolean
  },
  slot: {
    hasWeapon: boolean
    weaponType: WeaponVisualType
    movesetId: string
    sizeLevel: number
    width: number
    height: number
    baseWidth: number
    sizeMaxLevel: number
    cornerRadius: number
    weight: number
    attackDamage: number
    postureDamage: number
    toughnessDamage: number
    bowAmmo: number
    bowAmmoMax: number
  }
): void {
  if (!slot.hasWeapon) {
    weapon.movesetId = ''
    weapon.isEquipped = false
    return
  }

  const weaponType = slot.weaponType
  weapon.weaponType = weaponType
  weapon.movesetId =
    slot.movesetId || getDefaultAttackMovesetIdForWeaponType(weaponType)
  weapon.sizeLevel = slot.sizeLevel
  weapon.attackDamage = slot.attackDamage
  weapon.postureDamage = slot.postureDamage
  weapon.toughnessDamage = slot.toughnessDamage
  weapon.bowAmmo = slot.bowAmmo
  weapon.bowAmmoMax = slot.bowAmmoMax
  weapon.isEquipped = true

  if (slot.width > 0) {
    weapon.width = slot.width
    weapon.height = slot.height
    weapon.baseWidth = slot.baseWidth
    weapon.blockWidthStart = slot.width
    weapon.blockWidthTarget = slot.width
  }
  if (slot.sizeMaxLevel > 0) {
    weapon.sizeMaxLevel = slot.sizeMaxLevel
  }
  if (slot.cornerRadius > 0) {
    weapon.cornerRadius = slot.cornerRadius
  }
  if (slot.weight > 0) {
    weapon.weight = slot.weight
  }
}

function applyGroundWeaponState(
  weapon: {
    weaponType: WeaponVisualType
    movesetId: string
    sizeLevel: number
    width: number
    height: number
    baseWidth: number
    sizeMaxLevel: number
    cornerRadius: number
    weight: number
    blockWidthStart: number
    blockWidthTarget: number
    attackDamage: number
    postureDamage: number
    toughnessDamage: number
    bowAmmo: number
    bowAmmoMax: number
    isEquipped: boolean
    position: { x: number; y: number }
    visual: { x: number; y: number; rotation: number }
    attackStartTransform: { x: number; y: number; rotation: number }
    swingStartTransform: { x: number; y: number; rotation: number }
    swingEndTransform: { x: number; y: number; rotation: number }
  },
  state: SaveGroundWeaponState
): void {
  const normalizedWeaponType = normalizeWeaponType(state.weaponType)
  if (!normalizedWeaponType) {
    return
  }
  weapon.weaponType = normalizedWeaponType
  weapon.movesetId =
    getDefaultAttackMovesetIdForWeaponType(normalizedWeaponType)
  weapon.sizeLevel = state.sizeLevel
  weapon.attackDamage = state.attackDamage
  weapon.postureDamage = state.postureDamage
  weapon.toughnessDamage = state.toughnessDamage
  weapon.bowAmmo = state.bowAmmo
  weapon.bowAmmoMax = state.bowAmmoMax
  weapon.isEquipped = false

  if (state.width !== undefined) {
    weapon.width = state.width
    weapon.blockWidthStart = state.width
    weapon.blockWidthTarget = state.width
  }
  if (state.height !== undefined) {
    weapon.height = state.height
  }
  if (state.baseWidth !== undefined) {
    weapon.baseWidth = state.baseWidth
  }
  if (state.sizeMaxLevel !== undefined) {
    weapon.sizeMaxLevel = state.sizeMaxLevel
  }
  if (state.cornerRadius !== undefined) {
    weapon.cornerRadius = state.cornerRadius
  }
  if (state.weight !== undefined) {
    weapon.weight = state.weight
  }

  weapon.position.x = state.position.x
  weapon.position.y = state.position.y
  weapon.visual.x = state.position.x
  weapon.visual.y = state.position.y
  weapon.attackStartTransform.x = state.position.x
  weapon.attackStartTransform.y = state.position.y
  weapon.swingStartTransform.x = state.position.x
  weapon.swingStartTransform.y = state.position.y
  weapon.swingEndTransform.x = state.position.x
  weapon.swingEndTransform.y = state.position.y
}

function extractWeaponSlotState(
  slot: {
    hasWeapon: boolean
    weaponType: string
    sizeLevel: number
    width: number
    height: number
    baseWidth: number
    sizeMaxLevel: number
    cornerRadius: number
    weight: number
    attackDamage: number
    postureDamage: number
    toughnessDamage: number
    bowAmmo: number
    bowAmmoMax: number
  } | null
): SaveWeaponSlotState | null {
  if (!slot || !slot.hasWeapon) return null
  return {
    weaponType: slot.weaponType as SaveWeaponSlotState['weaponType'],
    sizeLevel: slot.sizeLevel,
    width: slot.width,
    height: slot.height,
    baseWidth: slot.baseWidth,
    sizeMaxLevel: slot.sizeMaxLevel,
    cornerRadius: slot.cornerRadius,
    weight: slot.weight,
    attackDamage: slot.attackDamage,
    postureDamage: slot.postureDamage,
    toughnessDamage: slot.toughnessDamage,
    bowAmmo: slot.bowAmmo,
    bowAmmoMax: slot.bowAmmoMax,
  }
}

function extractPlayerState(): SavePlayerState {
  const transform = playerEntity.transform
  const stats = playerEntity.stats
  const input = playerEntity.input
  const level = playerEntity.level
  const weaponSlots = playerEntity.weaponSlots
  const weapon = playerEntity.weapon
  const grapple = playerEntity.grapple

  if (weaponSlots && weapon) {
    syncActiveSlotFromWeapon(weaponSlots, weapon)
  }

  return {
    id: stats?.persistentId ?? PLAYER_PERSISTENT_ID,
    position: { x: transform?.x ?? 0, y: transform?.y ?? 0 },
    facing: input?.lastMoveDirection ?? 1,
    level: level?.level ?? 1,
    exp: level?.exp ?? 0,
    pendingUpgradePoints: level?.pendingUpgradePoints ?? 0,
    attackLevel: level?.attackLevel ?? 0,
    defenseLevel: level?.defenseLevel ?? 0,
    agilityLevel: level?.agilityLevel ?? 0,
    toughnessLevel: level?.toughnessLevel ?? 0,
    health: stats?.health ?? 100,
    maxHealth: stats?.maxHealth ?? 100,
    posture: stats?.posture ?? 100,
    maxPosture: stats?.maxPosture ?? 100,
    toughness: stats?.toughness ?? 100,
    maxToughness: stats?.maxToughness ?? 100,
    hasGrapple: grapple?.hasGrapple ?? false,
    mainWeapon: weaponSlots ? extractWeaponSlotState(weaponSlots.main) : null,
    secondaryWeapon: weaponSlots
      ? extractWeaponSlotState(weaponSlots.secondary)
      : null,
    activeSlot: weaponSlots?.activeSlot ?? 'main',
  }
}

function extractNpcsState(): SaveNpcState[] {
  const npcs: SaveNpcState[] = []
  const entities = world.getEntities()

  let spawnIndex = 0
  for (let i = 0; i < entities.length; i++) {
    const entity = entities[i]
    if (!entity.npcAI || !entity.faction) continue

    const transform = entity.transform
    const stats = entity.stats
    const input = entity.input
    const weaponSlots = entity.weaponSlots
    const weapon = entity.weapon
    const npcAI = entity.npcAI

    if (weaponSlots && weapon) {
      syncActiveSlotFromWeapon(weaponSlots, weapon)
    }

    const persistentId = stats ? ensureNpcPersistentId(entity) : ''
    const nextSpawnIndex =
      npcAI.mapSpawnIndex >= 0 ? npcAI.mapSpawnIndex : spawnIndex
    npcs.push({
      spawnIndex: nextSpawnIndex,
      id: persistentId || undefined,
      npcType: npcAI.npcType,
      position: { x: transform?.x ?? 0, y: transform?.y ?? 0 },
      facing: input?.lastMoveDirection ?? 1,
      health: stats?.health ?? 100,
      posture: stats?.posture ?? 100,
      toughness: stats?.toughness ?? 100,
      isDead: stats?.isDead ?? false,
      isVanished: stats?.isVanished ?? false,
      aiState: npcAI.state,
      currentWaypointIndex: npcAI.currentWaypointIndex,
      mainWeapon: weaponSlots ? extractWeaponSlotState(weaponSlots.main) : null,
      secondaryWeapon: weaponSlots
        ? extractWeaponSlotState(weaponSlots.secondary)
        : null,
      activeSlot: weaponSlots?.activeSlot ?? 'main',
    })
    if (npcAI.mapSpawnIndex < 0) {
      spawnIndex++
    }
  }

  return npcs
}

function extractGroundWeaponsState(): SaveGroundWeaponState[] {
  const weapons: SaveGroundWeaponState[] = []
  const entities = world.getEntities()

  let spawnIndex = 0
  for (let i = 0; i < entities.length; i++) {
    const entity = entities[i]
    if (!entity.weapon || entity.faction) continue
    if (entity.weapon.isEquipped) continue

    const transform = entity.transform
    const weapon = entity.weapon
    const normalizedWeaponType = normalizeWeaponType(weapon.weaponType)
    if (!normalizedWeaponType) continue

    weapons.push({
      spawnIndex,
      position: { x: transform?.x ?? 0, y: transform?.y ?? 0 },
      renderLayer: entity.render?.renderLayer ?? weapon.renderLayer ?? 0,
      weaponType: normalizedWeaponType,
      sizeLevel: weapon.sizeLevel,
      width: weapon.width,
      height: weapon.height,
      baseWidth: weapon.baseWidth,
      sizeMaxLevel: weapon.sizeMaxLevel,
      cornerRadius: weapon.cornerRadius,
      weight: weapon.weight,
      attackDamage: weapon.attackDamage,
      postureDamage: weapon.postureDamage,
      toughnessDamage: weapon.toughnessDamage,
      bowAmmo: weapon.bowAmmo,
      bowAmmoMax: weapon.bowAmmoMax,
    })
    spawnIndex++
  }

  return weapons
}

function extractGroundSunPickupsState(): SaveGroundSunPickupState[] {
  const pickups: SaveGroundSunPickupState[] = []
  const entities = world.getEntities()

  let spawnIndex = 0
  for (let i = 0; i < entities.length; i++) {
    const entity = entities[i]
    if (!entity.sunPickup || entity.sunPickup.mapSpawnIndex >= 0) continue

    pickups.push({
      spawnIndex,
      position: { x: entity.transform?.x ?? 0, y: entity.transform?.y ?? 0 },
      renderLayer: entity.render?.renderLayer ?? 0,
      isLarge: entity.sunPickup.isLarge,
    })
    spawnIndex++
  }

  return pickups
}

function exportGameState(saveId: string): void {
  if (isMapPreview) {
    return
  }
  if (!world || !playerEntity) return

  const activeCheckpoint = readActiveCheckpointForSave()

  const response: WorkerSaveResponseMessage = {
    type: 'save_response',
    saveId,
    playTimeMs,
    activeCheckpoint,
    player: extractPlayerState(),
    npcs: extractNpcsState(),
    groundWeapons: extractGroundWeaponsState(),
    groundSunPickups: extractGroundSunPickupsState(),
    camera: { x: camera.x, y: camera.y, zoom },
  }

  ctx.postMessage(response)
}

function readActiveCheckpointForSave(): SaveCheckpointState | null {
  if (!checkpointSystem) {
    return null
  }
  if (
    !checkpointSystem.readActiveCheckpointPosition(activeCheckpointSavePosition)
  ) {
    return null
  }
  return activeCheckpointSavePosition
}

function loadFromSave(saveData: SaveData): void {
  if (!world || !box2d) return

  playTimeMs = saveData.playTimeMs

  activeMapData = saveData.mapData
  isMapPreview = false
  isThumbnailCameraCapture = false

  restart()

  if (playerEntity && playerEntity.stats) {
    const playerState = saveData.player

    setEntityTransformFromSave(
      playerEntity,
      playerState.position.x,
      playerState.position.y
    )
    playerEntity.stats.persistentId = playerState.id ?? PLAYER_PERSISTENT_ID
    playerEntity.stats.health = playerState.health
    playerEntity.stats.posture = playerState.posture
    playerEntity.stats.maxPosture = playerState.maxPosture
    playerEntity.stats.toughness = playerState.toughness

    if (playerEntity.level) {
      playerEntity.level.level = clampPlayerLevel(playerState.level)
      playerEntity.level.exp =
        typeof playerState.exp === 'number' && Number.isFinite(playerState.exp)
          ? Math.max(0, Math.round(playerState.exp))
          : 0
      playerEntity.level.pendingUpgradePoints =
        typeof playerState.pendingUpgradePoints === 'number' &&
        Number.isFinite(playerState.pendingUpgradePoints)
          ? Math.max(0, Math.round(playerState.pendingUpgradePoints))
          : 0
      playerEntity.level.attackLevel = clampPlayerUpgradeLevel(
        playerState.attackLevel
      )
      playerEntity.level.defenseLevel = clampPlayerUpgradeLevel(
        playerState.defenseLevel
      )
      playerEntity.level.agilityLevel = clampPlayerUpgradeLevel(
        playerState.agilityLevel
      )
      playerEntity.level.toughnessLevel = clampPlayerUpgradeLevel(
        playerState.toughnessLevel
      )
    }
    syncPlayerUpgradeState(playerEntity, false, false, false)

    if (playerEntity.input) {
      playerEntity.input.lastMoveDirection = playerState.facing
    }

    if (playerEntity.grapple) {
      playerEntity.grapple.hasGrapple = !!playerState.hasGrapple
      playerEntity.grapple.isPulling = false
      playerEntity.grapple.pullElapsedMs = 0
      playerEntity.grapple.moveLockEndTime = 0
    }

    restorePlayerWeapons(saveData.player)
  }

  if (saveData.worldStateReady !== false) {
    restoreNpcsState(saveData.npcs)
    restoreGroundWeaponsState(saveData.groundWeapons)
    restoreGroundSunPickupsState(saveData.groundSunPickups ?? [])
  }

  restoreActiveCheckpointFromSave(saveData)

  camera.x = saveData.camera.x
  camera.y = saveData.camera.y
  zoom = saveData.camera.zoom
  requestedZoom = saveData.camera.zoom
  targetZoom = saveData.camera.zoom

  const runtimeMapData = buildRuntimeMapData(activeMapData)
  if (runtimeMapData) {
    ctx.postMessage({
      type: 'map_data',
      map: runtimeMapData,
    })
  }
  if (playerEntity?.level?.pendingUpgradePoints) {
    emitPlayerLevelUpPrompt(undefined, playerEntity.level.level)
  }
}

function restoreActiveCheckpointFromSave(saveData: SaveData): void {
  if (!world) return
  const savedCheckpoint = saveData.activeCheckpoint
  if (!savedCheckpoint) return

  const entities = world.getEntities()
  for (let i = 0; i < entities.length; i++) {
    const entity = entities[i]
    if (!entity.checkpoint || !entity.transform) continue
    if (
      entity.transform.x === savedCheckpoint.x &&
      entity.transform.y === savedCheckpoint.y
    ) {
      checkpointSystem.setActiveCheckpoint(entity, false)
      break
    }
  }
}

function restorePlayerWeapons(playerState: SaveData['player']): void {
  if (!playerEntity || !playerEntity.weaponSlots || !playerEntity.weapon) return

  const slots = playerEntity.weaponSlots

  applyWeaponSlotState(slots.main, playerState.mainWeapon)
  applyWeaponSlotState(slots.secondary, playerState.secondaryWeapon)

  slots.activeSlot = playerState.activeSlot

  const activeSlot = slots.activeSlot === 'main' ? slots.main : slots.secondary

  if (activeSlot.hasWeapon) {
    applyWeaponFromSlot(playerEntity.weapon, activeSlot)
    if (activeSlot.width <= 0) {
      const weaponType = activeSlot.weaponType as WeaponType
      if (isTemplateWeaponType(weaponType)) {
        const template = WEAPON_DEFAULT_DATA[weaponType]
        applyWeaponSizeLevel(
          playerEntity.weapon,
          template,
          activeSlot.sizeLevel
        )
      }
    }
    if (playerEntity.attackSlots) {
      playerEntity.attackSlots.normal.hasMoveset =
        playerEntity.weapon.movesetId.length > 0
      playerEntity.attackSlots.normal.movesetId = playerEntity.weapon.movesetId
    }
  } else {
    playerEntity.weapon.isEquipped = false
  }
}

function restoreNpcsState(npcsState: SaveNpcState[]): void {
  if (!world || !box2d) return

  const entities = world.getEntities()
  const currentNpcs: Entity[] = []
  const currentById = new Map<string, Entity>()
  const currentWithoutId: Entity[] = []

  for (let i = 0; i < entities.length; i++) {
    const entity = entities[i]
    if (!entity.npcAI || !entity.faction) continue
    currentNpcs.push(entity)
    if (entity.stats?.persistentId) {
      currentById.set(entity.stats.persistentId, entity)
    } else {
      currentWithoutId.push(entity)
    }
  }

  const savedById = new Map<string, SaveNpcState>()
  const savedWithoutId: SaveNpcState[] = []
  for (let i = 0; i < npcsState.length; i++) {
    const savedState = npcsState[i]
    if (savedState.id) {
      savedById.set(savedState.id, savedState)
    } else {
      savedWithoutId.push(savedState)
    }
  }

  const usedEntities = new Set<Entity>()

  const resolveNpcMapConfig = (
    savedState: SaveNpcState
  ): MapNpc | undefined => {
    if (!activeMapData) {
      return undefined
    }
    const mapNpcs = activeMapData.npcs
    const spawnIndex = savedState.spawnIndex
    if (
      !Number.isInteger(spawnIndex) ||
      spawnIndex < 0 ||
      spawnIndex >= mapNpcs.length
    ) {
      return undefined
    }
    return mapNpcs[spawnIndex]
  }

  const applyStateToEntity = (entity: Entity, savedState: SaveNpcState) => {
    const mapNpc = resolveNpcMapConfig(savedState)
    setEntityTransformFromSave(
      entity,
      savedState.position.x,
      savedState.position.y
    )
    if (entity.stats) {
      entity.stats.health = savedState.health
      entity.stats.posture = savedState.posture
      entity.stats.toughness = savedState.toughness
      entity.stats.debugNoDamage = mapNpc?.debugNoDamage === true
      entity.stats.debugNoDeath = mapNpc?.debugNoDeath === true
      entity.stats.isDead = savedState.isDead
      entity.stats.isVanished = savedState.isVanished
      if (savedState.id) {
        entity.stats.persistentId = savedState.id
        syncNpcIdCounter(savedState.id)
      } else {
        ensureNpcPersistentId(entity)
      }
    }

    if (entity.input) {
      entity.input.lastMoveDirection = savedState.facing
    }

    if (entity.npcAI) {
      entity.npcAI.state = savedState.aiState
      entity.npcAI.currentWaypointIndex = savedState.currentWaypointIndex
      entity.npcAI.lastPosition.x = savedState.position.x
      entity.npcAI.lastPosition.y = savedState.position.y
    }

    if (entity.weaponSlots && entity.weapon) {
      applyWeaponSlotState(entity.weaponSlots.main, savedState.mainWeapon)
      applyWeaponSlotState(
        entity.weaponSlots.secondary,
        savedState.secondaryWeapon
      )
      entity.weaponSlots.activeSlot = savedState.activeSlot

      const activeSlot =
        entity.weaponSlots.activeSlot === 'main'
          ? entity.weaponSlots.main
          : entity.weaponSlots.secondary
      applyWeaponFromSlot(entity.weapon, activeSlot)
      if (activeSlot.hasWeapon && activeSlot.width <= 0) {
        const weaponType = activeSlot.weaponType as WeaponType
        if (isTemplateWeaponType(weaponType)) {
          const template = WEAPON_DEFAULT_DATA[weaponType]
          applyWeaponSizeLevel(entity.weapon, template, activeSlot.sizeLevel)
        }
      }
      if (entity.attackSlots) {
        entity.attackSlots.normal.hasMoveset =
          entity.weapon.movesetId.length > 0
        entity.attackSlots.normal.movesetId = entity.weapon.movesetId
      }
      if (entity.npcAI) {
        entity.npcAI.movesetId = entity.weapon.movesetId
      }
    }

    if (savedState.isDead || savedState.isVanished) {
      if (entity.stats) {
        entity.stats.isDead = true
        entity.stats.isVanished = true
      }
      if (entity.render) {
        entity.render.visible = false
      }
      destroyEntityPhysicsBody(entity)
    }
    usedEntities.add(entity)
  }

  for (const [id, savedState] of savedById.entries()) {
    const entity = currentById.get(id)
    if (entity) {
      applyStateToEntity(entity, savedState)
      continue
    }
    const mapNpc = resolveNpcMapConfig(savedState)
    const npcType = mapNpc?.npcType ?? savedState.npcType ?? 'default'
    const created = createGameNpc(
      savedState.position.x,
      savedState.position.y,
      groundTopY,
      npcType,
      mapNpc
    )
    if (created.render && mapNpc) {
      created.render.bodyProfileIndex = hasRenderableBodyProfile(
        mapNpc.bodyProfile
      )
        ? getNpcBodyProfileIndex(savedState.spawnIndex)
        : 0
    }
    applyStateToEntity(created, savedState)
  }

  let fallbackIndex = 0
  for (let i = 0; i < savedWithoutId.length; i++) {
    const savedState = savedWithoutId[i]
    if (fallbackIndex < currentWithoutId.length) {
      const entity = currentWithoutId[fallbackIndex]
      fallbackIndex += 1
      applyStateToEntity(entity, savedState)
      continue
    }
    const mapNpc = resolveNpcMapConfig(savedState)
    const npcType = mapNpc?.npcType ?? savedState.npcType ?? 'default'
    const created = createGameNpc(
      savedState.position.x,
      savedState.position.y,
      groundTopY,
      npcType,
      mapNpc
    )
    if (created.render && mapNpc) {
      created.render.bodyProfileIndex = hasRenderableBodyProfile(
        mapNpc.bodyProfile
      )
        ? getNpcBodyProfileIndex(savedState.spawnIndex)
        : 0
    }
    applyStateToEntity(created, savedState)
  }

  for (let i = 0; i < currentNpcs.length; i++) {
    const entity = currentNpcs[i]
    if (usedEntities.has(entity)) continue
    if (entity.stats) {
      entity.stats.isDead = true
      entity.stats.isVanished = true
    }
    if (entity.render) {
      entity.render.visible = false
    }
    destroyEntityPhysicsBody(entity)
  }
}

function restoreGroundWeaponsState(
  groundWeaponsState: SaveGroundWeaponState[]
): void {
  if (!world) return

  const entities = world.getEntities()
  let spawnIndex = 0

  for (let i = 0; i < entities.length; i++) {
    const entity = entities[i]
    if (!entity.weapon || entity.faction) continue
    if (entity.weapon.isEquipped) continue

    const savedState = groundWeaponsState[spawnIndex]
    if (savedState) {
      setEntityTransformFromSave(
        entity,
        savedState.position.x,
        savedState.position.y
      )
      const renderLayer = getCollisionLayerValue(savedState.renderLayer)
      if (entity.render) {
        entity.render.renderLayer = renderLayer
      }
      if (entity.weapon) {
        entity.weapon.renderLayer = renderLayer
      }
      if (box2d && entity.physics?.shapeId) {
        const { b2Shape_GetFilter, b2Shape_SetFilter } = box2d
        const filter = b2Shape_GetFilter(entity.physics.shapeId)
        filter.categoryBits = getWeaponCollisionCategory(renderLayer)
        filter.maskBits = getWeaponCollisionMask(renderLayer)
        b2Shape_SetFilter(entity.physics.shapeId, filter)
      }
      applyGroundWeaponState(entity.weapon, savedState)
    } else {
      spatialHash.removeEntity(entity)
      destroyEntityPhysicsBody(entity)
      world.destroyEntity(entity)
    }
    spawnIndex++
  }

  if (spawnIndex < groundWeaponsState.length && box2d) {
    for (let i = spawnIndex; i < groundWeaponsState.length; i++) {
      const savedState = groundWeaponsState[i]
      const created = createWeapon(
        world,
        box2d,
        worldId,
        savedState.position.x,
        savedState.position.y,
        groundTopY,
        savedState.weaponType as WeaponType,
        getCollisionLayerValue(savedState.renderLayer)
      )
      setEntityTransformFromSave(
        created,
        savedState.position.x,
        savedState.position.y
      )
      if (created.weapon) {
        applyGroundWeaponState(created.weapon, savedState)
      }
    }
  }
}

function restoreGroundSunPickupsState(
  groundSunPickupsState: SaveGroundSunPickupState[]
): void {
  if (!world) return

  const entities = world.getEntities()

  for (let i = 0; i < entities.length; i++) {
    const entity = entities[i]
    if (!entity.sunPickup || entity.sunPickup.mapSpawnIndex >= 0) continue
    spatialHash.removeEntity(entity)
    destroyEntityPhysicsBody(entity)
    world.destroyEntity(entity)
  }

  for (let i = 0; i < groundSunPickupsState.length; i++) {
    const savedState = groundSunPickupsState[i]
    createSunPickupEntity(
      savedState.position.x,
      savedState.position.y,
      savedState.isLarge,
      getCollisionLayerValue(savedState.renderLayer),
      0,
      0
    )
  }
}
