import Box2DFactory from 'box2d3-wasm'

import {
  refillUnlockedSkills,
  syncAttackSlotsForWeaponType,
} from '../attackPickupUtils'
import {
  normalizeCharacterAttackSpeedLevel,
  normalizeCharacterMaxComboCount,
} from '../characterActionConfig'
import {
  PLAYER_BODY_PROFILE_INDEX,
  getCharacterBloodColor,
  getCharacterBodyColor,
  getNpcBodyProfileIndex,
  hasRenderableBodyProfile,
} from '../characterBodyProfile'
import {
  CHARACTER_DEFAULT_DATA,
  CHECKPOINT_TREE_TOP_COLOR_INACTIVE,
  CHECKPOINT_TREE_TRUNK_COLOR_INACTIVE,
  DEFAULT_CHECKPOINT_RENDER_RADIUS,
  DEFAULT_GRAPPLE_ANCHOR_RENDER_RADIUS,
  DEFAULT_GRAVITY,
  DEFAULT_GROUND_FRICTION,
  DEFAULT_OBSTACLE_FRICTION,
  DEFAULT_PLAYER_MAX_HEALTH,
  DEFAULT_PLAYER_MAX_POSTURE,
  DEFAULT_PLAYER_MAX_TOUGHNESS,
  DEFAULT_PLAYER_RADIUS,
  DEFAULT_WEAPON_CORNER_RADIUS,
  GRAPPLE_ANCHOR_BORDER_COLOR,
  GRAPPLE_ANCHOR_COLOR,
  WEAPON_DEFAULT_DATA,
} from '../constants'
import { ArrowPools } from '../ecs/ArrowPools'
import {
  getDefaultAttackMovesetIdForWeaponType,
  getDefaultNormalAttackMovesetId,
  isNormalAttackMovesetId,
  normalizeNpcAttackMoves,
} from '../ecs/AttackMoveRegistry'
import {
  AttackPickupComponent,
  CheckpointComponent,
  ExpOrbComponent,
  Faction,
  GrappleAnchorComponent,
  PhysicsComponent,
  RenderComponent,
  SunPickupComponent,
  TransformComponent,
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
import { AttackPickupSystem } from '../ecs/systems/AttackPickupSystem'
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
  type ObstacleCollider,
  WeaponSystem,
} from '../ecs/systems/WeaponSystem'
import type {
  EditorMapData,
  MapNpc,
  MapNpcWeapon,
  MapPlacedShape,
} from '../editorMapTypes'
import {
  type MapObjectLayerLookup,
  buildMapObjectLayerLookup,
  collectCollisionLayers,
} from '../mapObjectLayers'
import {
  configureCollisionLayers,
  getCollisionLayerValue,
  getGroundCollisionCategory,
  getGroundCollisionMask,
  getObstacleCollisionCategory,
  getObstacleCollisionMask,
  getWeaponCollisionCategory,
  getWeaponCollisionMask,
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
import type { SaveCheckpointState, SaveData } from '../saveTypes'
import { ensureDefaultMap } from '../storage'
import { TerrainCollisionBuilder } from '../terrain/TerrainCollisionBuilder'
import { hasTerrainContent } from '../terrain/TerrainDataUtils'
import { getTerrainMaterialByCode } from '../terrain/TerrainMaterialRegistry'
import { initializeTerrainPolygonUtils } from '../terrain/TerrainPolygonUtils'
import {
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
  AttackPickupKind,
  MainModule,
  NpcType,
  WeaponType,
  b2BodyId,
  b2Hull,
  b2Polygon,
  b2Rot,
  b2ShapeId,
} from '../types'
import {
  getDefaultPlayerAmmoForWeaponType,
  isAmmoLimitedWeaponType,
  normalizeWeaponType,
  normalizeWeaponTypeAndSizeLevel,
  resolveWeaponStatsForSize,
} from '../weaponTypeUtils'
import {
  BreakableCrateManager,
  type RuntimeObstacleCollider,
} from './BreakableCrateManager'
import {
  CameraDirector,
  DEFAULT_CAMERA_TIME_SCALE_1000,
} from './CameraDirector'
import { ImpactPhysics } from './ImpactPhysics'
import { LootSpawner } from './LootSpawner'
import { computeRectWorldVertices } from './PolygonUtils'
import { buildRuntimeMapData as buildRuntimeMapDataFromState } from './RuntimeMapData'
import {
  appendConvexPolygonBodyShapes,
  createDecompScratch,
  decomposeStaticTerrainPolygon,
  fillDecompScratchPolygon,
  resetDecompScratchPolygon,
} from './TerrainDecomposer'
import { WorkerInputController } from './WorkerInputController'
import {
  WorkerFrameStateExporter,
  exportWorkerGameState,
  restoreWorkerGameState,
} from './WorkerStateExporter'
import { EFFECT_TYPES, SOUND_EFFECT_FLAGS } from './effectsProtocol'
import type {
  MainToWorkerMessage,
  WorkerPerfSnapshotMessage,
  WorkerPlayerLevelUpMessage,
  WorkerSaveResponseMessage,
  WorkerSpineCollisionData,
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
let attackPickupSystem: AttackPickupSystem
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
let obstacles: RuntimeObstacleCollider[] = []

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

const SPARK_COLOR_INT = 0xfff4a8

const terrainDecompScratch = createDecompScratch()

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

function getAttackPickupRenderLayer(index: number): number {
  return getIndexedLayer(activeMapLayerLookup.attackPickupLayers, index)
}

function buildRuntimeMapData(
  map: EditorMapData | null | undefined
): EditorMapData | null {
  return buildRuntimeMapDataFromState(
    map,
    breakableCrateManager.getBrokenEnvironmentIndices()
  )
}

const frameStateExporter = new WorkerFrameStateExporter(ctx)
const queueEffect = frameStateExporter.queueEffect.bind(frameStateExporter)

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

let canvasHeight = 0
let pixelsPerMeter = 50
let groundFriction = DEFAULT_GROUND_FRICTION
let obstacleFriction = DEFAULT_OBSTACLE_FRICTION
let groundTopY = 0

// Parameter buffer for async init
const pendingParams: Record<string, number> = {}

let canvasWidth = 0
let currentTime = 0

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
const debugCameraData = frameStateExporter.debugCameraData
const cameraDirector = new CameraDirector(debugCameraData)
const camera = cameraDirector.camera
const lootSpawner = new LootSpawner()
const impactPhysics = new ImpactPhysics()
const breakableCrateManager = new BreakableCrateManager()
const inputController = new WorkerInputController(FIXED_STEP_MS)
const playerEntityView: Entity[] = []
const sunPickupEntityBuffer: Entity[] = []
const expOrbEntityBuffer: Entity[] = []
const attackPickupEntityBuffer: Entity[] = []
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

function syncCameraDirectorRuntime(): void {
  if (!box2d || !world) {
    return
  }
  cameraDirector.syncRuntime(
    box2d,
    world,
    playerEntity ?? null,
    canvasWidth,
    canvasHeight,
    pixelsPerMeter,
    currentTime,
    isThumbnailCameraCapture
  )
}

function syncFrameStateExporterRuntime(): void {
  frameStateExporter.syncRuntime(
    world ?? null,
    playerEntity ?? null,
    grappleSystem ?? null,
    soundSystem ?? null,
    spineSegmentManager ?? null,
    skeletalSegmentManager ?? null,
    cameraDirector,
    ultimateFlashRemainingMs,
    ULTIMATE_FLASH_DURATION_MS
  )
}

function triggerUltimateBlockedFlash(): void {
  ultimateFlashRemainingMs = ULTIMATE_FLASH_DURATION_MS
}

function syncInputControllerRuntime(): void {
  inputController.syncRuntime(
    world ?? null,
    playerEntity ?? null,
    weaponSystem ?? null,
    statsSystem ?? null,
    cameraDirector,
    playTimeMs,
    triggerUltimateBlockedFlash
  )
}

function syncImpactPhysicsRuntime(): void {
  if (!box2d || !world || !statsSystem || !grappleSystem) {
    return
  }
  impactPhysics.syncRuntime({
    box2d,
    world,
    statsSystem,
    grappleSystem,
    breakableCrates: breakableCrateManager.getCrates(),
    breakableCratePlanksByShapeId: breakableCrateManager.getPlanksByShapeId(),
    effectsEmitter,
  })
}

function syncBreakableCrateManagerRuntime(): void {
  if (!box2d || !world) {
    return
  }
  breakableCrateManager.syncRuntime({
    box2d,
    worldId,
    world,
    impactPhysics,
    lootSpawner,
    effectsEmitter,
    soundSystem: soundSystem ?? null,
    weaponSystem: weaponSystem ?? null,
    arrowSystem: arrowSystem ?? null,
    grappleSystem: grappleSystem ?? null,
  })
}

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

  frameStateExporter.initStateBuffers()

  box2d = await Box2DFactory()
  const { b2DefaultWorldDef, b2CreateWorld, b2Vec2 } = box2d

  const worldDef = b2DefaultWorldDef()
  worldDef.gravity = new b2Vec2(0, DEFAULT_GRAVITY)
  worldId = b2CreateWorld(worldDef)
  worldDef.delete()

  world = new World()
  spatialHash = new SpatialHash(5)
  syncBreakableCrateManagerRuntime()

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
  syncCameraDirectorRuntime()

  // Initialize camera to center on player
  if (activeMapData) {
    cameraDirector.applyMapCamera(activeMapData)
  } else if (playerEntity && playerEntity.transform) {
    cameraDirector.initializeDefaultCamera()
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
  for (const crate of breakableCrateManager.getCrates().values()) {
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
  perfSnapshotMessage.breakableCrateCount =
    breakableCrateManager.getCrateCount()
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
  componentRegistry.registerComponent('AttackPickup')
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
      refillUnlockedSkills(playerEntity.attackSlots)
      if (playerEntity.weapon) {
        syncAttackSlotsForWeaponType(
          playerEntity.attackSlots,
          playerEntity.weapon.weaponType
        )
        playerEntity.weapon.skillId = playerEntity.attackSlots.skill.skillId
        playerEntity.weapon.skillCharges =
          playerEntity.attackSlots.skill.chargesRemaining
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
  syncBreakableCrateManagerRuntime()
  syncImpactPhysicsRuntime()
  statsSystem.setWeaponSystem(weaponSystem)
  statsSystem.setSoundSystem(soundSystem)
  npcAISystem.setWeaponSystem(weaponSystem)
  movementSystem.setSoundSystem(soundSystem)
  movementSystem.setStatsSystem(statsSystem)
  movementSystem.setFallImpactHandler((entity, damage, fallDistance1000) =>
    impactPhysics.handleEntityFallImpact(entity, damage, fallDistance1000)
  )
  physicsSystem.addAfterStepCallback(() =>
    breakableCrateManager.syncRuntimes(obstacles, playTimeMs)
  )
  grappleSystem.setStatsSystem(statsSystem)
  weaponSystem.setSoundSystem(soundSystem)
  weaponSystem.setBreakableObstacleHitHandler((hit) =>
    impactPhysics.handleBreakableObstacleHit(hit)
  )
  weaponSystem.setRopeHitHandler((hit) => grappleSystem.hitRopesInOBB(hit))
  weaponSystem.setRopeCircleHitHandler((hit) =>
    grappleSystem.hitRopesInCircle(hit)
  )
  arrowSystem.setSoundSystem(soundSystem)
  arrowSystem.setBreakableObstacleHitHandler((hit) =>
    impactPhysics.handleBreakableObstacleHit(hit)
  )
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
  attackPickupSystem = new AttackPickupSystem()
  attackPickupSystem.setEffectsEmitter(effectsEmitter)
  lootSpawner.setFactories(
    createSunPickupEntity,
    createExpOrbEntity,
    setBodyLinearVelocity
  )
  lootSpawner.setRuntime(
    world,
    box2d,
    worldId,
    groundTopY,
    weaponSystem,
    arrowPools,
    spatialHash,
    FIXED_STEP_MS
  )
  statsSystem.onNpcDeath = (entity: Entity) => {
    lootSpawner.dropNpcConfiguredLoot(entity)
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
  breakableCrateManager.reset()
  runtimeTerrainState = null
  if (activeMapData) {
    createEnvironmentFromMap(activeMapData)
    createCheckpointsFromMap(activeMapData)
    createGrappleAnchorsFromMap(activeMapData)
    createSunPickupsFromMap(activeMapData)
    createExpOrbsFromMap(activeMapData)
    createAttackPickupsFromMap(activeMapData)
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
  breakableCrateManager.createFromMap(map, {
    mapLayerLookup: activeMapLayerLookup,
    obstacles,
    pixelsPerMeter,
    playTimeMs,
  })
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
  lootSpawner.spawnTerrainDebrisFromImpact(changed, request)
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
  breakableCrateManager.appendActiveObstacles(obstacles)
  breakableCrateManager.refreshObstacleIndices(obstacles)
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

function createAttackPickupsFromMap(map: EditorMapData): void {
  if (!world) return
  const pickups = map.attackPickups ?? []
  for (let i = 0; i < pickups.length; i++) {
    const pickup = pickups[i]
    createAttackPickupEntity(
      pickup.x,
      pickup.y,
      normalizeWeaponType(pickup.weaponType) ?? 'sword',
      pickup.kind,
      getAttackPickupRenderLayer(i),
      0,
      0,
      i
    )
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

function createAttackPickupEntity(
  x: number,
  y: number,
  weaponType: WeaponType,
  kind: AttackPickupKind,
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
  circle.radius = 0.22
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

  const attackPickup = new AttackPickupComponent()
  attackPickup.weaponType = weaponType
  attackPickup.kind = kind
  attackPickup.pickupRadiusSq = 1
  attackPickup.mapSpawnIndex = mapSpawnIndex
  entity.addComponent(attackPickup)

  setBodyLinearVelocity(bodyId, velocityX, velocityY)
  return entity
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
  const decompPolygon = fillDecompScratchPolygon(
    terrainDecompScratch,
    shape.points,
    centerX,
    centerY
  )

  if (decompPolygon.length < 3) {
    bodyDef.delete()
    shapeDef.delete()
    resetDecompScratchPolygon(terrainDecompScratch)
    return null
  }

  const convexPolygons = decomposeStaticTerrainPolygon(
    decompPolygon,
    preferExactDecomp
  )

  if (!convexPolygons || convexPolygons.length === 0) {
    let minX = Number.POSITIVE_INFINITY
    let maxX = Number.NEGATIVE_INFINITY
    let minY = Number.POSITIVE_INFINITY
    let maxY = Number.NEGATIVE_INFINITY
    for (let i = 0; i < decompPolygon.length; i++) {
      const point = decompPolygon[i]
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
      decompPolygon,
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
      for (let i = 0; i < decompPolygon.length; i++) {
        const point = decompPolygon[i]
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
    resetDecompScratchPolygon(terrainDecompScratch)
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
  resetDecompScratchPolygon(terrainDecompScratch)
  return bodyId
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
  slot.skillId = ''
  slot.skillCharges = 0
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
  if (playerEntity.weapon) {
    playerEntity.weapon.attackSpeedLevel = normalizeCharacterAttackSpeedLevel(
      playerProps?.attackSpeedLevel
    )
    playerEntity.weapon.maxComboCount = normalizeCharacterMaxComboCount(
      playerProps?.maxComboCount
    )
  }
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
      playerEntity.weapon.skillId = ''
      playerEntity.weapon.skillCharges = 0
      playerEntity.weapon.isEquipped = true
      if (playerEntity.attackSlots) {
        playerEntity.attackSlots.normal.hasMoveset =
          playerEntity.weapon.movesetId.length > 0
        playerEntity.attackSlots.normal.movesetId =
          playerEntity.weapon.movesetId
        syncAttackSlotsForWeaponType(playerEntity.attackSlots, weaponType)
        playerEntity.weapon.skillId = playerEntity.attackSlots.skill.skillId
        playerEntity.weapon.skillCharges =
          playerEntity.attackSlots.skill.chargesRemaining
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

function isTemplateWeaponType(
  weaponType: string
): weaponType is keyof typeof WEAPON_DEFAULT_DATA {
  return weaponType in WEAPON_DEFAULT_DATA
}

function fixedUpdate() {
  const fixedStartMs = performance.now()
  // Accumulate time using delta time
  currentTime += TIME_STEP
  playTimeMs += FIXED_STEP_MS
  syncCameraDirectorRuntime()
  cameraDirector.syncTimeScaleState()
  if (ultimateFlashRemainingMs > 0) {
    ultimateFlashRemainingMs = Math.max(
      0,
      ultimateFlashRemainingMs - FIXED_STEP_MS
    )
  }

  syncInputControllerRuntime()
  inputController.updateHoldState()

  cameraDirector.syncUltimateCameraState()
  cameraDirector.updateZoom()

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

  breakableCrateManager.syncRuntimes(obstacles, playTimeMs)
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

  attackPickupSystem.update(
    attackPickupEntityBuffer,
    playerEntityView,
    TIME_STEP
  )
  for (const e of attackPickupSystem.getPendingRemove()) {
    destroyEntityPhysicsBody(e)
    world.destroyEntity(e)
  }
  workerPerfPickupUpdateTotalUs += Math.round(
    (performance.now() - pickupUpdateStartMs) * 1000
  )

  breakableCrateManager.syncRuntimes(obstacles, playTimeMs)
  lootSpawner.updateTerrainDebrisEntities(entities)
  impactPhysics.flushPendingBreakableCrateBreaks((request) =>
    breakableCrateManager.breakCrate(request, obstacles)
  )

  const cleanupStartMs = performance.now()
  cleanupDestroyedEntities()
  workerPerfCleanupTotalUs += Math.round(
    (performance.now() - cleanupStartMs) * 1000
  )

  const cameraStartMs = performance.now()
  cameraDirector.update()
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

  accumulator +=
    (frameTime * cameraDirector.getTimeScale1000()) /
    DEFAULT_CAMERA_TIME_SCALE_1000

  let fixedSteps = 0
  while (accumulator >= TIME_STEP) {
    fixedUpdate()
    accumulator -= TIME_STEP
    fixedSteps++
  }

  const sendStateStartMs = performance.now()
  syncFrameStateExporterRuntime()
  frameStateExporter.sendState()
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
  attackPickupEntityBuffer.length = 0

  for (let i = 0; i < entities.length; i++) {
    const entity = entities[i]
    if (entity.sunPickup) {
      sunPickupEntityBuffer.push(entity)
    }
    if (entity.expOrb) {
      expOrbEntityBuffer.push(entity)
    }
    if (entity.attackPickup) {
      attackPickupEntityBuffer.push(entity)
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

function restart() {
  if (!world || !box2d) return
  if (spineSegmentManager) {
    spineSegmentManager.clear()
  }
  if (skeletalSegmentManager) {
    skeletalSegmentManager.clear()
  }
  frameStateExporter.resetTransientState()
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
  syncBreakableCrateManagerRuntime()

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
  syncCameraDirectorRuntime()

  npcAISystem.setPlayer(playerEntity)
  soundSystem.setPlayer(playerEntity)
  targetingSystem.setPlayer(playerEntity)

  inputController.resetAll()

  cameraDirector.resetAllState()

  if (activeMapData) {
    cameraDirector.applyMapCamera(activeMapData)
  } else if (playerEntity && playerEntity.transform) {
    cameraDirector.initializeDefaultCamera()
  }
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
        syncCameraDirectorRuntime()
        syncInputControllerRuntime()
        inputController.handleInput(
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
    case 'mobile_lock_target':
      if (world && playerEntity) {
        targetingSystem.requestPlayerLockTarget(msg.targetId)
      }
      break
    case 'mobile_interact_target':
      if (world && playerEntity) {
        interactionSystem.requestTargetInteraction(playerEntity, msg.targetId)
      }
      break
    case 'mobile_recover':
      if (world && playerEntity) {
        syncInputControllerRuntime()
        inputController.handleMobileRecoverRequest()
      }
      break
    case 'mobile_grapple_target':
      if (world && playerEntity) {
        syncInputControllerRuntime()
        inputController.handleMobileGrappleTarget(msg.targetId, msg.phase)
      }
      break
    case 'buffer_release':
      frameStateExporter.releaseStateBuffer(msg.buffer)
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
      syncCameraDirectorRuntime()
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

  if (breakableCrateManager.updateParam(id, value)) {
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

  if (id === 'ropeLinearDamping') {
    grappleSystem.setRopeLinearDamping(value)
  }

  if (id === 'ropeHertz') {
    grappleSystem.setRopeHertz(value)
  }

  if (id === 'ropeDampingRatio') {
    grappleSystem.setRopeDampingRatio(value)
  }

  if (id === 'ropeBendStiffness') {
    grappleSystem.setRopeBendStiffness(value)
  }

  if (id === 'ropeElasticLimitScale') {
    grappleSystem.setRopeElasticLimitScale(value)
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

function postSaveResponse(message: WorkerSaveResponseMessage): void {
  ctx.postMessage(message)
}

function exportGameState(saveId: string): void {
  exportWorkerGameState(saveId, {
    isMapPreview,
    world: world ?? null,
    playerEntity: playerEntity ?? null,
    playerPersistentId: PLAYER_PERSISTENT_ID,
    playTimeMs,
    cameraX: camera.x,
    cameraY: camera.y,
    zoom: cameraDirector.getZoom(),
    readActiveCheckpointForSave,
    ensureNpcPersistentId,
    postMessage: postSaveResponse,
  })
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

  restoreWorkerGameState(saveData, {
    world,
    box2d,
    worldId,
    activeMapData,
    playerEntity: playerEntity ?? null,
    playerPersistentId: PLAYER_PERSISTENT_ID,
    groundTopY,
    spatialHash,
    checkpointSystem,
    syncPlayerUpgradeState,
    setEntityTransformFromSave,
    ensureNpcPersistentId,
    syncNpcIdCounter,
    createGameNpc,
    destroyEntityPhysicsBody,
    createSunPickupEntity,
  })

  cameraDirector.setSnapshot(
    saveData.camera.x,
    saveData.camera.y,
    saveData.camera.zoom
  )

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
