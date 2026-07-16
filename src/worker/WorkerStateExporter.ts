import {
  getAttackPickupKindId,
  hasUnlockedAttackPickup,
  syncAttackSlotsForWeaponType,
} from '../attackPickupUtils'
import {
  getCharacterEyeOffsetX,
  getCharacterEyeOffsetY,
  getNpcBodyProfileIndex,
  hasRenderableBodyProfile,
} from '../characterBodyProfile'
import {
  DEBUG_DRAW_CAMERA,
  DEBUG_DRAW_PLAYER_COLLISION_SHAPE,
  DEBUG_DRAW_SENSORS,
  DEBUG_DRAW_SOUND,
  DEFAULT_CAMERA_ZOOM,
  DEFAULT_GRAPPLE_RANGE,
  DEFAULT_PLAYER_FOV_RAD,
  ENEMY_HEARING_RANGE_MULTIPLIER,
  EXP_TABLE,
  GRAPPLE_ANCHOR_HIGHLIGHT_BORDER_COLOR,
  GRAPPLE_ANCHOR_HIGHLIGHT_COLOR,
  PLAYER_MAX_LEVEL,
  WEAPON_DEFAULT_DATA,
} from '../constants'
import { ULTIMATE_COOLDOWN_MS } from '../ecs/Component'
import type { Entity } from '../ecs/Entity'
import { SkeletalSegmentManager } from '../ecs/SkeletalSegmentManager'
import type { SpatialHash } from '../ecs/SpatialHash'
import { SpineSegmentManager } from '../ecs/SpineSegmentManager'
import type { World } from '../ecs/World'
import {
  type NpcSpawnConfig,
  applyWeaponSizeLevel,
  createWeapon,
} from '../ecs/factories/PlayerFactory'
import type { CheckpointSystem } from '../ecs/systems/CheckpointSystem'
import { GrappleSystem } from '../ecs/systems/GrappleSystem'
import { SoundSystem } from '../ecs/systems/SoundSystem'
import type { EditorMapData, MapNpc } from '../editorMapTypes'
import {
  getCollisionLayerValue,
  getWeaponCollisionCategory,
  getWeaponCollisionMask,
} from '../physicsLayers'
import { clampPlayerLevel, clampPlayerUpgradeLevel } from '../playerUpgrade'
import type {
  SaveCheckpointState,
  SaveData,
  SaveGroundSunPickupState,
  SaveGroundWeaponState,
  SaveNpcState,
  SavePlayerState,
} from '../saveTypes'
import {
  isSkeletalCombatReady,
  isSkeletalWeaponAttacking,
} from '../skeletalAnimation'
import type { MainModule, NpcType, WeaponType } from '../types'
import { normalizeWeaponType } from '../weaponTypeUtils'
import {
  CameraDirector,
  DEFAULT_CAMERA_INITIAL_PLAYER_SCREEN_RATIO_Y,
  DEFAULT_CAMERA_TIME_SCALE_1000,
} from './CameraDirector'
import {
  applyGroundWeaponState,
  applyWeaponFromSlot,
  applyWeaponSlotState,
  extractWeaponSlotState,
  syncActiveSlotFromWeapon,
} from './WorkerSaveStateUtils'
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
  STATE_BUFFER_FLOATS,
} from './effectsProtocol'
import type {
  CameraDebugData,
  SensorDebugData,
  SoundListenerDebugData,
  SoundWaveDebugData,
  WorkerDebugMessage,
  WorkerSaveResponseMessage,
  WorkerStateMessage,
} from './protocol'

type WorldId = ReturnType<MainModule['b2CreateWorld']>

type CreateGameNpc = (
  x: number,
  y: number,
  groundY: number,
  npcType: NpcType,
  options?: NpcSpawnConfig
) => Entity

type CreateSunPickupEntity = (
  x: number,
  y: number,
  isLarge: boolean,
  renderLayer: number,
  velocityX?: number,
  velocityY?: number,
  mapSpawnIndex?: number
) => Entity | null

export interface WorkerStateRestoreContext {
  world: World
  box2d: MainModule
  worldId: WorldId
  activeMapData: EditorMapData | null
  playerEntity: Entity | null
  playerPersistentId: string
  groundTopY: number
  spatialHash: SpatialHash
  checkpointSystem: CheckpointSystem
  syncPlayerUpgradeState: (
    entity: Entity | null | undefined,
    restoreHealth: boolean,
    restoreToughness: boolean,
    showHud: boolean
  ) => void
  setEntityTransformFromSave: (entity: Entity, x: number, y: number) => void
  ensureNpcPersistentId: (entity: Entity) => string
  syncNpcIdCounter: (persistentId: string) => void
  createGameNpc: CreateGameNpc
  destroyEntityPhysicsBody: (entity: Entity) => void
  createSunPickupEntity: CreateSunPickupEntity
}

const FRAME_STATE_BUFFER_BYTES =
  STATE_BUFFER_FLOATS * Float32Array.BYTES_PER_ELEMENT
const supportsSharedFrameStateBuffer =
  typeof SharedArrayBuffer !== 'undefined' && self.crossOriginIsolated

export class WorkerFrameStateExporter {
  readonly debugCameraData: CameraDebugData = {
    topLimitRatio: 1 - DEFAULT_CAMERA_INITIAL_PLAYER_SCREEN_RATIO_Y,
    bottomLimitRatio: DEFAULT_CAMERA_INITIAL_PLAYER_SCREEN_RATIO_Y,
    playerScreenY: 0,
    playerFeetY: 0,
    cameraY: 0,
    zoom: DEFAULT_CAMERA_ZOOM,
    isOutsideVerticalZone: false,
  }

  private world: World | null = null
  private playerEntity: Entity | null = null
  private grappleSystem: GrappleSystem | null = null
  private soundSystem: SoundSystem | null = null
  private spineSegmentManager: SpineSegmentManager | null = null
  private skeletalSegmentManager: SkeletalSegmentManager | null = null
  private cameraDirector: CameraDirector | null = null
  private ultimateFlashRemainingMs = 0
  private ultimateFlashDurationMs = 1
  private sharedStateBuffer: SharedArrayBuffer | null = null
  private stateBuffer: Float32Array<ArrayBufferLike> = new Float32Array(
    STATE_BUFFER_FLOATS
  )
  private readonly stateBufferViews: Float32Array[] = []
  private effectsCount = 0
  private readonly colorCache = new Map<string, number>()
  private readonly debugSensors: SensorDebugData[] = []
  private readonly debugSoundWaves: SoundWaveDebugData[] = []
  private readonly debugSoundListeners: SoundListenerDebugData[] = []
  private readonly emptySoundWaves: SoundWaveDebugData[] = []
  private readonly emptySoundListeners: SoundListenerDebugData[] = []
  private readonly emptySensors: SensorDebugData[] = []
  private readonly emptySpineCollisions: WorkerDebugMessage['spineCollisions'] =
    []
  private hadSpineCollisionDebugLastFrame = false
  private readonly stateMessage: WorkerStateMessage = {
    type: 'state',
    entitiesBuffer: null as unknown as ArrayBuffer | SharedArrayBuffer,
    entityCount: 0,
    effectsCount: 0,
    ropePointCount: 0,
    camera: { x: 0, y: 0 },
    zoom: DEFAULT_CAMERA_ZOOM,
    timeScale1000: DEFAULT_CAMERA_TIME_SCALE_1000,
  }
  private readonly debugMessage: WorkerDebugMessage = {
    type: 'debug',
    sensors: [],
    soundWaves: [],
    soundListeners: [],
    camera: null,
    spineCollisions: [],
  }

  constructor(private readonly postTarget: Worker) {}

  syncRuntime(
    world: World | null,
    playerEntity: Entity | null,
    grappleSystem: GrappleSystem | null,
    soundSystem: SoundSystem | null,
    spineSegmentManager: SpineSegmentManager | null,
    skeletalSegmentManager: SkeletalSegmentManager | null,
    cameraDirector: CameraDirector | null,
    ultimateFlashRemainingMs: number,
    ultimateFlashDurationMs: number
  ): void {
    this.world = world
    this.playerEntity = playerEntity
    this.grappleSystem = grappleSystem
    this.soundSystem = soundSystem
    this.spineSegmentManager = spineSegmentManager
    this.skeletalSegmentManager = skeletalSegmentManager
    this.cameraDirector = cameraDirector
    this.ultimateFlashRemainingMs = ultimateFlashRemainingMs
    this.ultimateFlashDurationMs =
      ultimateFlashDurationMs > 0 ? ultimateFlashDurationMs : 1
  }

  initStateBuffers(): void {
    this.effectsCount = 0
    if (supportsSharedFrameStateBuffer) {
      this.sharedStateBuffer = new SharedArrayBuffer(FRAME_STATE_BUFFER_BYTES)
      this.stateBuffer = new Float32Array(this.sharedStateBuffer)
      this.stateBufferViews.length = 0
      return
    }

    this.sharedStateBuffer = null
    this.stateBufferViews.length = 0
    for (let i = 0; i < 2; i++) {
      const buffer = new ArrayBuffer(FRAME_STATE_BUFFER_BYTES)
      this.stateBufferViews.push(new Float32Array(buffer))
    }
    const initialView = this.stateBufferViews.pop()
    if (initialView) {
      this.stateBuffer = initialView
    }
  }

  releaseStateBuffer(buffer: ArrayBuffer): void {
    if (this.sharedStateBuffer) return
    if (buffer.byteLength !== FRAME_STATE_BUFFER_BYTES) return
    this.stateBufferViews.push(new Float32Array(buffer))
  }

  resetTransientState(): void {
    this.hadSpineCollisionDebugLastFrame = false
    this.effectsCount = 0
  }

  queueEffect(
    type: number,
    x: number,
    y: number,
    color: number,
    radius: number,
    renderLayer: number = 0
  ): void {
    if (this.effectsCount >= MAX_EFFECTS) {
      if (type !== EFFECT_TYPES.SOUND) return
      const base = EFFECTS_BASE_OFFSET + (MAX_EFFECTS - 1) * EFFECT_STRIDE
      this.stateBuffer[base + EFFECT_OFFSETS.TYPE] = type
      this.stateBuffer[base + EFFECT_OFFSETS.X] = x
      this.stateBuffer[base + EFFECT_OFFSETS.Y] = y
      this.stateBuffer[base + EFFECT_OFFSETS.COLOR] = color
      this.stateBuffer[base + EFFECT_OFFSETS.RADIUS] = radius
      this.stateBuffer[base + EFFECT_OFFSETS.RENDER_LAYER] = renderLayer
      return
    }
    const base = EFFECTS_BASE_OFFSET + this.effectsCount * EFFECT_STRIDE
    this.stateBuffer[base + EFFECT_OFFSETS.TYPE] = type
    this.stateBuffer[base + EFFECT_OFFSETS.X] = x
    this.stateBuffer[base + EFFECT_OFFSETS.Y] = y
    this.stateBuffer[base + EFFECT_OFFSETS.COLOR] = color
    this.stateBuffer[base + EFFECT_OFFSETS.RADIUS] = radius
    this.stateBuffer[base + EFFECT_OFFSETS.RENDER_LAYER] = renderLayer
    this.effectsCount += 1
  }

  sendState(): void {
    const world = this.world
    const playerEntity = this.playerEntity
    const grappleSystem = this.grappleSystem
    const spineSegmentManager = this.spineSegmentManager
    const skeletalSegmentManager = this.skeletalSegmentManager
    const cameraDirector = this.cameraDirector
    if (
      !world ||
      !playerEntity ||
      !grappleSystem ||
      !spineSegmentManager ||
      !skeletalSegmentManager ||
      !cameraDirector
    ) {
      return
    }
    if (!this.sharedStateBuffer && this.stateBufferViews.length === 0) {
      return
    }

    const entities = world.getEntities()
    const stateBuffer = this.stateBuffer
    let highlightAnchorId = -1
    if (playerEntity.transform && playerEntity.grapple?.hasGrapple) {
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
        !e.expOrb &&
        !e.attackPickup
      ) {
        continue
      }

      const offset = count * ENTITY_STRIDE

      stateBuffer[offset + OFFSETS.ID] = e.id
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
      stateBuffer[offset + OFFSETS.COLOR] = this.parseColor(
        e.render?.color ?? '#000000'
      )
      stateBuffer[offset + OFFSETS.BORDER_COLOR] = this.parseColor(
        e.render?.borderColor ?? '#000000'
      )

      let flags = 0
      if (
        (e.render?.visible ?? isStandaloneWeapon) ||
        e.sunPickup ||
        e.expOrb ||
        e.attackPickup
      )
        flags |= FLAGS.VISIBLE
      if (e.stats?.isDead) flags |= FLAGS.DEAD
      if (e.stats?.isVanished) flags |= FLAGS.VANISHED
      if (e.movement?.isRolling || e.movement?.isBackstepping)
        flags |= FLAGS.ROLLING
      if (e.stats?.isStaggered) flags |= FLAGS.STAGGERED

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
      if (e.stats && e.stats.healthBarTimerMs > 0)
        flags |= FLAGS.HEALTH_BAR_FLASH
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
      if (e.attackPickup) {
        flags |= FLAGS.ATTACK_PICKUP
      }
      if (isTerrainDebris) {
        flags |= FLAGS.TERRAIN_DEBRIS
      }
      if (e.follow !== undefined && e.follow.followTargetId !== null) {
        flags |= FLAGS.FOLLOW_BOUND
      }
      const assassinationTargetId =
        playerEntity.weapon?.assassinationPhase != null &&
        playerEntity.weapon?.assassinationTargetId
          ? playerEntity.weapon.assassinationTargetId
          : (playerEntity.input?.assassinationTargetId ?? null)
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
        stateBuffer[offset + OFFSETS.COLOR] = this.parseColor(
          GRAPPLE_ANCHOR_HIGHLIGHT_COLOR
        )
        stateBuffer[offset + OFFSETS.BORDER_COLOR] = this.parseColor(
          GRAPPLE_ANCHOR_HIGHLIGHT_BORDER_COLOR
        )
      }

      stateBuffer[offset + OFFSETS.FLAGS] = flags

      stateBuffer[offset + OFFSETS.MOVE_DIR] = e.input?.lastMoveDirection ?? 1
      stateBuffer[offset + OFFSETS.SKELETAL_GAIT_PHASE] = e.render?.bodyProfile
        ?.skeletalMode
        ? skeletalSegmentManager.getEntityGaitPhase(e.id)
        : 0
      stateBuffer[offset + OFFSETS.MOTION_VELOCITY_X] = e.physics?.velX ?? 0
      stateBuffer[offset + OFFSETS.MOTION_VELOCITY_Y] = e.physics?.velY ?? 0
      stateBuffer[offset + OFFSETS.MOTION_IS_GROUNDED] = e.movement?.isGrounded
        ? 1
        : 0
      stateBuffer[offset + OFFSETS.MOTION_IS_SPRINTING] = e.movement
        ?.isSprinting
        ? 1
        : 0
      stateBuffer[offset + OFFSETS.MOTION_IS_COMBAT_READY] = isCombatReady
        ? 1
        : 0
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
          (e.weapon.bombState === 'lit' ||
            e.weapon.bombState === 'throw_windup')
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

      if (e.attackPickup) {
        stateBuffer[offset + OFFSETS.WEAPON_TYPE] = getWeaponTypeId(
          e.attackPickup.weaponType
        )
        stateBuffer[offset + OFFSETS.WEAPON_DRAW] = getAttackPickupKindId(
          e.attackPickup.kind
        )
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
                  (ultimateSlot.cooldownRemainingMs * 100) /
                    ULTIMATE_COOLDOWN_MS
                )
              )
            : 0
        const ultimateAnimating = e.weapon?.ultimatePhase != null
        stateBuffer[offset + OFFSETS.ULTIMATE_COOLDOWN_RATIO] = cooldownRatio
        stateBuffer[offset + OFFSETS.ULTIMATE_READY] = !ultimateSlot.hasMoveset
          ? -1
          : cooldownRatio === 0 && !ultimateAnimating
            ? 1
            : 0
      } else {
        stateBuffer[offset + OFFSETS.ULTIMATE_COOLDOWN_RATIO] = 0
        stateBuffer[offset + OFFSETS.ULTIMATE_READY] = -1
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
        stateBuffer[offset + OFFSETS.HAMMER_ULTIMATE_ACTIVE] = hammerUltActive
          ? 1
          : 0
        stateBuffer[offset + OFFSETS.HAMMER_ULTIMATE_IMPACT100] =
          hammerUltActive ? w.ultimateHammerImpact100 : 0
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
      if (e === playerEntity) {
        stateBuffer[offset + OFFSETS.ULTIMATE_FLASH_TIMER100] =
          this.ultimateFlashRemainingMs > 0
            ? Math.ceil(
                (this.ultimateFlashRemainingMs * 100) /
                  this.ultimateFlashDurationMs
              )
            : 0
      } else {
        stateBuffer[offset + OFFSETS.ULTIMATE_FLASH_TIMER100] = 0
      }

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

    const ropePointCount = grappleSystem.writeActiveRopePoints(
      playerEntity,
      stateBuffer,
      ROPE_POINTS_BASE_OFFSET,
      MAX_ROPE_POINTS
    )

    const camera = cameraDirector.camera
    this.stateMessage.entitiesBuffer = stateBuffer.buffer
    this.stateMessage.entityCount = count
    this.stateMessage.effectsCount = this.effectsCount
    this.stateMessage.ropePointCount = ropePointCount
    this.stateMessage.camera.x = camera.x
    this.stateMessage.camera.y = camera.y
    this.stateMessage.zoom = cameraDirector.getZoom()
    this.stateMessage.timeScale1000 = cameraDirector.getTimeScale1000()
    const hasSpineCollisionDebug =
      DEBUG_DRAW_PLAYER_COLLISION_SHAPE &&
      (spineSegmentManager.getMaxActiveCoverageRadius() > 0 ||
        skeletalSegmentManager.getMaxActiveCoverageRadius() > 0)
    const shouldSendDebug =
      DEBUG_DRAW_SENSORS ||
      DEBUG_DRAW_SOUND ||
      DEBUG_DRAW_CAMERA ||
      hasSpineCollisionDebug ||
      this.hadSpineCollisionDebugLastFrame
    if (this.sharedStateBuffer) {
      this.postTarget.postMessage(this.stateMessage)
      if (shouldSendDebug) {
        this.postDebugMessage(entities, hasSpineCollisionDebug)
      }
      this.effectsCount = 0
      return
    }

    const buffer = stateBuffer.buffer as ArrayBuffer
    this.postTarget.postMessage(this.stateMessage, [buffer])
    if (shouldSendDebug) {
      this.postDebugMessage(entities, hasSpineCollisionDebug)
    }
    this.effectsCount = 0

    const nextView = this.stateBufferViews.pop()
    if (nextView) {
      this.stateBuffer = nextView
    }
  }

  private postDebugMessage(
    entities: Entity[],
    hasSpineCollisionDebug: boolean
  ): void {
    const spineSegmentManager = this.spineSegmentManager
    const skeletalSegmentManager = this.skeletalSegmentManager
    if (!spineSegmentManager || !skeletalSegmentManager) {
      return
    }
    this.debugMessage.sensors = DEBUG_DRAW_SENSORS
      ? this.collectSensorDebugData(entities)
      : this.emptySensors
    this.debugMessage.soundWaves = DEBUG_DRAW_SOUND
      ? this.collectSoundWaveDebugData()
      : this.emptySoundWaves
    this.debugMessage.soundListeners = DEBUG_DRAW_SOUND
      ? this.collectSoundListenerDebugData(entities)
      : this.emptySoundListeners
    this.debugMessage.camera = DEBUG_DRAW_CAMERA ? this.debugCameraData : null
    this.debugMessage.spineCollisions = hasSpineCollisionDebug
      ? [
          ...spineSegmentManager.collectDebugCollisionData(),
          ...skeletalSegmentManager.collectDebugCollisionData(),
        ]
      : this.emptySpineCollisions
    this.hadSpineCollisionDebugLastFrame = hasSpineCollisionDebug
    this.postTarget.postMessage(this.debugMessage)
  }

  private collectSensorDebugData(entities: Entity[]): SensorDebugData[] {
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

      let sensorDebug = this.debugSensors[sensorCount]
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
        this.debugSensors[sensorCount] = sensorDebug
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

    if (this.debugSensors.length > sensorCount) {
      this.debugSensors.length = sensorCount
    }

    return this.debugSensors
  }

  private collectSoundWaveDebugData(): SoundWaveDebugData[] {
    const soundSystem = this.soundSystem
    if (!soundSystem) {
      this.debugSoundWaves.length = 0
      return this.debugSoundWaves
    }
    const waves = soundSystem.getActiveWaves()
    for (let i = 0; i < waves.length; i++) {
      const wave = waves[i]
      let debugWave = this.debugSoundWaves[i]
      if (!debugWave) {
        debugWave = {
          x: 0,
          y: 0,
          radius: 0,
          maxRadius: 0,
          db: 0,
        }
        this.debugSoundWaves[i] = debugWave
      }
      debugWave.x = wave.x
      debugWave.y = wave.y
      debugWave.radius = wave.radius
      debugWave.maxRadius = wave.maxRadius
      debugWave.db = wave.currentDb
    }

    if (this.debugSoundWaves.length > waves.length) {
      this.debugSoundWaves.length = waves.length
    }

    return this.debugSoundWaves
  }

  private collectSoundListenerDebugData(
    entities: Entity[]
  ): SoundListenerDebugData[] {
    let listenerCount = 0

    for (let i = 0; i < entities.length; i++) {
      const entity = entities[i]
      if (!entity.npcAI || !entity.transform) continue
      if (entity.stats?.isDead || entity.stats?.isVanished) continue

      let debugListener = this.debugSoundListeners[listenerCount]
      if (!debugListener) {
        debugListener = {
          entityId: entity.id,
          x: 0,
          y: 0,
          radius: 0,
        }
        this.debugSoundListeners[listenerCount] = debugListener
      }

      debugListener.entityId = entity.id
      debugListener.x = entity.transform.x
      debugListener.y = entity.transform.y
      debugListener.radius =
        entity.npcAI.detectionRange * ENEMY_HEARING_RANGE_MULTIPLIER

      listenerCount += 1
    }

    if (this.debugSoundListeners.length > listenerCount) {
      this.debugSoundListeners.length = listenerCount
    }

    return this.debugSoundListeners
  }

  private parseColor(color: string): number {
    const cached = this.colorCache.get(color)
    if (cached !== undefined) return cached
    if (color.startsWith('#')) {
      const hex = color.slice(1)
      const val = parseInt(hex, 16)
      this.colorCache.set(color, val)
      return val
    }
    return 0
  }
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

export interface WorkerStateExportContext {
  isMapPreview: boolean
  world: World | null
  playerEntity: Entity | null
  playerPersistentId: string
  playTimeMs: number
  cameraX: number
  cameraY: number
  zoom: number
  readActiveCheckpointForSave: () => SaveCheckpointState | null
  ensureNpcPersistentId: (entity: Entity) => string
  postMessage: (message: WorkerSaveResponseMessage) => void
}

export function exportWorkerGameState(
  saveId: string,
  context: WorkerStateExportContext
): void {
  if (context.isMapPreview) {
    return
  }
  if (!context.world || !context.playerEntity) return

  const activeCheckpoint = context.readActiveCheckpointForSave()

  const response: WorkerSaveResponseMessage = {
    type: 'save_response',
    saveId,
    playTimeMs: context.playTimeMs,
    activeCheckpoint,
    player: extractPlayerState(
      context.playerEntity,
      context.playerPersistentId
    ),
    npcs: extractNpcsState(context.world, context.ensureNpcPersistentId),
    groundWeapons: extractGroundWeaponsState(context.world),
    groundSunPickups: extractGroundSunPickupsState(context.world),
    camera: { x: context.cameraX, y: context.cameraY, zoom: context.zoom },
  }

  context.postMessage(response)
}

export function restoreWorkerGameState(
  saveData: SaveData,
  context: WorkerStateRestoreContext
): void {
  restorePlayerState(saveData.player, context)
  removeUnlockedAttackPickups(context)

  if (saveData.worldStateReady !== false) {
    restoreNpcsState(saveData.npcs, context)
    restoreGroundWeaponsState(saveData.groundWeapons, context)
    restoreGroundSunPickupsState(saveData.groundSunPickups ?? [], context)
  }

  restoreActiveCheckpointFromSave(saveData, context)
}

function restorePlayerState(
  playerState: SaveData['player'],
  context: WorkerStateRestoreContext
): void {
  const playerEntity = context.playerEntity
  if (!playerEntity?.stats) {
    return
  }

  context.setEntityTransformFromSave(
    playerEntity,
    playerState.position.x,
    playerState.position.y
  )
  playerEntity.stats.persistentId = playerState.id ?? context.playerPersistentId
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
  context.syncPlayerUpgradeState(playerEntity, false, false, false)

  if (playerEntity.input) {
    playerEntity.input.lastMoveDirection = playerState.facing
  }

  if (playerEntity.grapple) {
    playerEntity.grapple.hasGrapple = !!playerState.hasGrapple
    playerEntity.grapple.isPulling = false
    playerEntity.grapple.pullElapsedMs = 0
    playerEntity.grapple.moveLockEndTime = 0
  }

  restorePlayerAttackUnlocks(playerState, playerEntity)
  restorePlayerWeapons(playerState, context)
}

function restorePlayerAttackUnlocks(
  playerState: SaveData['player'],
  playerEntity: Entity
): void {
  const attackSlots = playerEntity.attackSlots
  if (!attackSlots) return
  attackSlots.unlockedUltimateMask = normalizeSavedMask(
    playerState.unlockedUltimateMask
  )
  attackSlots.unlockedSkillMask = normalizeSavedMask(
    playerState.unlockedSkillMask
  )
  attackSlots.swordSkillCharges = normalizeSavedCharges(
    playerState.swordSkillCharges
  )
  attackSlots.spearSkillCharges = normalizeSavedCharges(
    playerState.spearSkillCharges
  )
  attackSlots.hammerSkillCharges = normalizeSavedCharges(
    playerState.hammerSkillCharges
  )
  attackSlots.bowSkillCharges = normalizeSavedCharges(
    playerState.bowSkillCharges
  )
}

function normalizeSavedMask(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.round(value)
    : 0
}

function normalizeSavedCharges(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.round(value)
    : 0
}

function removeUnlockedAttackPickups(context: WorkerStateRestoreContext): void {
  const attackSlots = context.playerEntity?.attackSlots
  if (!attackSlots || !context.world) return

  const entities = context.world.getEntities()
  for (let i = 0; i < entities.length; i++) {
    const entity = entities[i]
    const attackPickup = entity.attackPickup
    if (!attackPickup) continue

    const weaponType = normalizeWeaponType(attackPickup.weaponType)
    if (
      !weaponType ||
      !hasUnlockedAttackPickup(attackSlots, weaponType, attackPickup.kind)
    ) {
      continue
    }

    context.spatialHash.removeEntity(entity)
    context.destroyEntityPhysicsBody(entity)
    context.world.destroyEntity(entity)
  }
}

function restoreActiveCheckpointFromSave(
  saveData: SaveData,
  context: WorkerStateRestoreContext
): void {
  const savedCheckpoint = saveData.activeCheckpoint
  if (!savedCheckpoint) return

  const entities = context.world.getEntities()
  for (let i = 0; i < entities.length; i++) {
    const entity = entities[i]
    if (!entity.checkpoint || !entity.transform) continue
    if (
      entity.transform.x === savedCheckpoint.x &&
      entity.transform.y === savedCheckpoint.y
    ) {
      context.checkpointSystem.setActiveCheckpoint(entity, false)
      break
    }
  }
}

function restorePlayerWeapons(
  playerState: SaveData['player'],
  context: WorkerStateRestoreContext
): void {
  const playerEntity = context.playerEntity
  if (!playerEntity?.weaponSlots || !playerEntity.weapon) return

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
      syncAttackSlotsForWeaponType(
        playerEntity.attackSlots,
        playerEntity.weapon.weaponType
      )
      playerEntity.weapon.skillId = playerEntity.attackSlots.skill.skillId
      playerEntity.weapon.skillCharges =
        playerEntity.attackSlots.skill.chargesRemaining
    }
  } else {
    playerEntity.weapon.isEquipped = false
  }
}

function restoreNpcsState(
  npcsState: SaveNpcState[],
  context: WorkerStateRestoreContext
): void {
  const entities = context.world.getEntities()
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
    const activeMapData = context.activeMapData
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
    context.setEntityTransformFromSave(
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
        context.syncNpcIdCounter(savedState.id)
      } else {
        context.ensureNpcPersistentId(entity)
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
      context.destroyEntityPhysicsBody(entity)
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
    const created = context.createGameNpc(
      savedState.position.x,
      savedState.position.y,
      context.groundTopY,
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
    const created = context.createGameNpc(
      savedState.position.x,
      savedState.position.y,
      context.groundTopY,
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
    context.destroyEntityPhysicsBody(entity)
  }
}

function restoreGroundWeaponsState(
  groundWeaponsState: SaveGroundWeaponState[],
  context: WorkerStateRestoreContext
): void {
  const entities = context.world.getEntities()
  let spawnIndex = 0

  for (let i = 0; i < entities.length; i++) {
    const entity = entities[i]
    if (!entity.weapon || entity.faction) continue
    if (entity.weapon.isEquipped) continue

    const savedState = groundWeaponsState[spawnIndex]
    if (savedState) {
      context.setEntityTransformFromSave(
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
      if (entity.physics?.shapeId) {
        const { b2Shape_GetFilter, b2Shape_SetFilter } = context.box2d
        const filter = b2Shape_GetFilter(entity.physics.shapeId)
        filter.categoryBits = getWeaponCollisionCategory(renderLayer)
        filter.maskBits = getWeaponCollisionMask(renderLayer)
        b2Shape_SetFilter(entity.physics.shapeId, filter)
      }
      applyGroundWeaponState(entity.weapon, savedState)
    } else {
      context.spatialHash.removeEntity(entity)
      context.destroyEntityPhysicsBody(entity)
      context.world.destroyEntity(entity)
    }
    spawnIndex++
  }

  if (spawnIndex < groundWeaponsState.length) {
    for (let i = spawnIndex; i < groundWeaponsState.length; i++) {
      const savedState = groundWeaponsState[i]
      const created = createWeapon(
        context.world,
        context.box2d,
        context.worldId,
        savedState.position.x,
        savedState.position.y,
        context.groundTopY,
        savedState.weaponType as WeaponType,
        getCollisionLayerValue(savedState.renderLayer)
      )
      context.setEntityTransformFromSave(
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
  groundSunPickupsState: SaveGroundSunPickupState[],
  context: WorkerStateRestoreContext
): void {
  const entities = context.world.getEntities()

  for (let i = 0; i < entities.length; i++) {
    const entity = entities[i]
    if (!entity.sunPickup || entity.sunPickup.mapSpawnIndex >= 0) continue
    context.spatialHash.removeEntity(entity)
    context.destroyEntityPhysicsBody(entity)
    context.world.destroyEntity(entity)
  }

  for (let i = 0; i < groundSunPickupsState.length; i++) {
    const savedState = groundSunPickupsState[i]
    context.createSunPickupEntity(
      savedState.position.x,
      savedState.position.y,
      savedState.isLarge,
      getCollisionLayerValue(savedState.renderLayer),
      0,
      0
    )
  }
}

function isTemplateWeaponType(
  weaponType: string
): weaponType is keyof typeof WEAPON_DEFAULT_DATA {
  return weaponType in WEAPON_DEFAULT_DATA
}

function extractPlayerState(
  playerEntity: Entity,
  playerPersistentId: string
): SavePlayerState {
  const transform = playerEntity.transform
  const stats = playerEntity.stats
  const input = playerEntity.input
  const level = playerEntity.level
  const weaponSlots = playerEntity.weaponSlots
  const weapon = playerEntity.weapon
  const attackSlots = playerEntity.attackSlots
  const grapple = playerEntity.grapple

  if (weaponSlots && weapon) {
    syncActiveSlotFromWeapon(weaponSlots, weapon)
  }

  return {
    id: stats?.persistentId ?? playerPersistentId,
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
    unlockedUltimateMask: attackSlots?.unlockedUltimateMask ?? 0,
    unlockedSkillMask: attackSlots?.unlockedSkillMask ?? 0,
    swordSkillCharges: attackSlots?.swordSkillCharges ?? 0,
    spearSkillCharges: attackSlots?.spearSkillCharges ?? 0,
    hammerSkillCharges: attackSlots?.hammerSkillCharges ?? 0,
    bowSkillCharges: attackSlots?.bowSkillCharges ?? 0,
    mainWeapon: weaponSlots ? extractWeaponSlotState(weaponSlots.main) : null,
    secondaryWeapon: weaponSlots
      ? extractWeaponSlotState(weaponSlots.secondary)
      : null,
    activeSlot: weaponSlots?.activeSlot ?? 'main',
  }
}

function extractNpcsState(
  world: World,
  ensureNpcPersistentId: (entity: Entity) => string
): SaveNpcState[] {
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

function extractGroundWeaponsState(world: World): SaveGroundWeaponState[] {
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

function extractGroundSunPickupsState(
  world: World
): SaveGroundSunPickupState[] {
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
