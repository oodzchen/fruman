import {
  BOW_FREE_AIM_MAX_OFFSET,
  BOW_FREE_AIM_TURN_SPEED,
  BOW_GRAVITY_SCALE,
  BOW_MAX_DRAW_MS,
  BOW_MAX_SPEED,
  BOW_MIN_FORCE_RATIO,
  BOW_MIN_SPEED,
  BOW_MIN_WINDUP_MS,
  BOW_RECOVER_MS,
  DEBUG_ANIMATION_SLOWDOWN,
  DEFAULT_FRAME_RATE,
  DEFAULT_GRAVITY,
  DEFAULT_PARRY_WINDOW_MS,
  DEFAULT_PLAYER_RADIUS,
  DEFAULT_WEAPON_ATTACK_PAUSE_MS,
  DEFAULT_WEAPON_ATTACK_RADIUS,
  DEFAULT_WEAPON_ATTACK_RECOVER_MS,
  DEFAULT_WEAPON_ATTACK_SWING_MS,
  DEFAULT_WEAPON_ATTACK_WINDUP_MS,
  DEFAULT_WEAPON_CENTER_OFFSET_X,
  DEFAULT_WEAPON_FINAL_WINDUP_MS,
  DEFAULT_WEAPON_FOLLOW_OFFSET_X,
  DEFAULT_WEAPON_FOLLOW_OFFSET_Y,
  DEFAULT_WEAPON_FRONT_OFFSET_X,
  DEFAULT_WEAPON_FRONT_OFFSET_Y,
  DEFAULT_WEAPON_GROUND_ROTATION_RAD,
  DEFAULT_WEAPON_HEIGHT,
  DEFAULT_WEAPON_MIN_ATTACK_INTERVAL_MS,
  DEFAULT_WEAPON_PICKUP_DISTANCE,
  DEFAULT_WEAPON_PLAYER_CLEARANCE,
  DEFAULT_WEAPON_VERTICAL_ROTATION_RAD,
  DEFAULT_WEAPON_WIDTH,
  GRAPE_GRAVITY_SCALE,
  GRAPE_MAX_SPEED,
  GRAPE_MIN_FORCE_RATIO,
  GRAPE_MIN_SPEED,
  GRAPE_MIN_WINDUP_MS,
  GRAPE_PROJECTILE_DENSITY,
  GRAPE_PROJECTILE_LIFETIME_MS,
  GRAPE_PROJECTILE_RADIUS,
  GRAPE_PROJECTILE_RESTITUTION,
  GRAPE_RECOVER_MS,
  JUMP_ATTACK_DAMAGE_SCALE_DENOMINATOR,
  JUMP_ATTACK_DAMAGE_SCALE_NUMERATOR,
  PARRY_COUNTER_WINDOW_MS,
  PARRY_ENEMY_POSTURE_DAMAGE,
  PARRY_SELF_POSTURE_RECOVERY,
  SOUND_DB_BIG_HAMMER_HIT_ROCK,
  SOUND_DB_BOW_SNAP,
  SOUND_DB_HEAVY_SWORD_HIT_GROUND,
  SOUND_DB_PARRY,
  SOUND_DB_SWORD_HIT_OBSTACLE,
  SOUND_DB_SWORD_SWING,
  WEAPON_DEFAULT_DATA,
  WEAPON_DROP_DURATION_MS,
  WEAPON_IMPACT_LEVEL,
} from '../../constants'
import {
  getWeaponCollisionCategory,
  getWeaponCollisionMask,
} from '../../physicsLayers'
import { getPlayerAgilityScalePercent } from '../../playerUpgrade'
import type { TerrainMaterialTag } from '../../terrain/TerrainTypes'
import type {
  MainModule,
  WeaponTemplate,
  WeaponType,
  WeaponVisualType,
  b2BodyId,
} from '../../types'
import {
  getGrapeChargeRangeScale,
  getWeaponGroundRotationRad,
  getWeaponStaggerDropRotationRad,
  isRangedAttackWeaponVisualType,
  isRangedWeaponType,
  isSecondaryWeaponType,
} from '../../weaponTypeUtils'
import { SOUND_IDS } from '../../worker/effectsProtocol'
import type { ArrowPools } from '../ArrowPools'
import type { AttackMoveData, ImpactLevel } from '../AttackMoveData'
import {
  ATTACK_MOVES,
  ATTACK_MOVESETS,
  getDefaultAttackMovesetIdForWeaponType,
  getUltimateMovesetIdForWeaponType,
  isMovesetCompatibleWithWeaponType,
} from '../AttackMoveRegistry'
import type {
  WeaponRelativeTransform,
  WeaponSlotData,
  WeaponSlotId,
  WeaponTransform,
} from '../Component'
import { DEFAULT_SKILL_MAX_CHARGES, ULTIMATE_COOLDOWN_MS } from '../Component'
import {
  Faction,
  PhysicsComponent,
  RenderComponent,
  TransformComponent,
  WeaponComponent,
  WeaponSlotsComponent,
} from '../Component'
import { componentRegistry } from '../ComponentRegistry'
import type { Entity } from '../Entity'
import {
  checkOBBvsAABB,
  checkOBBvsCircle,
  checkOBBvsOBB,
  checkOBBvsPolygon,
} from '../OBBCollision'
import type { SpatialHash } from '../SpatialHash'
import type { SpineSegmentManager } from '../SpineSegmentManager'
import { System } from '../System'
import {
  FRONT_SWING_TILT_RAD,
  applyOffset,
  clamp01,
  copyRelativeTransform,
  copyTransform,
  getFrontTransform,
  getOffsetFromTransform,
  getRangedAimRotation,
  getStrikeTransforms,
  getSwingTransforms,
  getThrustTransforms,
  getTransformAtAngle,
  lerpRelativeTransform,
  lerpTransform,
  realignToFacing,
  setWeaponBackTransform,
} from '../WeaponPoseUtils'
import type { World } from '../World'
import { SkillHandler } from './SkillHandler'
import type { SoundSystem } from './SoundSystem'
import type { StatsSystem } from './StatsSystem'
import { UltimateHandler } from './UltimateHandler'

function getBodyHalfHeight(
  render: { radius?: number; bodyHeight?: number } | undefined,
  radius: number
): number {
  const bh = render?.bodyHeight ?? 0
  return bh > 0 ? bh / 2 : radius
}

const BLOCK_VERTICAL_SCALE = 0.5
const REBOUND_PAUSE_MS = 150
const PARRY_WINDOW_FRAMES =
  (DEFAULT_PARRY_WINDOW_MS * DEFAULT_FRAME_RATE) / 1000
const PARRY_ACTIVE_START_FRAME = PARRY_WINDOW_FRAMES * 0.5
const BIG_HAMMER_SIZE_LEVEL = 2
const GREAT_SWORD_SIZE_LEVEL = 3
const GIANT_SWORD_SIZE_LEVEL = 4
const BIG_HAMMER_JUMP_SHAKE_INTENSITY_PX = 14
const BIG_HAMMER_JUMP_SHAKE_DURATION_MS = 180
const GIANT_SWORD_JUMP_SHAKE_INTENSITY_PX = 11
const GIANT_SWORD_JUMP_SHAKE_DURATION_MS = 160
const BIG_HAMMER_FINISHER_SHAKE_INTENSITY_PX = 16
const BIG_HAMMER_FINISHER_SHAKE_DURATION_MS = 210
const GIANT_SWORD_FINISHER_SHAKE_INTENSITY_PX = 13
const GIANT_SWORD_FINISHER_SHAKE_DURATION_MS = 190
const DEFAULT_PROJECTILE_DENSITY = 0.1
const DEFAULT_PROJECTILE_RESTITUTION = 0.4
const DEFAULT_PROJECTILE_LIFETIME_MS = 2500
const DEATH_WEAPON_DROP_CHANCE_DENOMINATOR = 2
const HAMMER_CRIT_WINDUP_MS = 600
const HAMMER_CRIT_SWING_MS = 300
const HAMMER_CRIT_RECOVER_MS = 350
const STAGGER_DROP_SETTLE_MIN_TIME = 0.1
const STAGGER_DROP_SETTLE_SPEED_SQ = 0.01

export type ObstacleCollider = {
  bodyId: b2BodyId
  centerX: number
  centerY: number
  width: number
  height: number
  renderLayer: number
  materialTag: TerrainMaterialTag
  vertices?: { x: number; y: number }[]
  worldVertices?: { x: number; y: number }[]
  radius?: number
}

type WeaponDropData = {
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
  skillId: string
}

export class WeaponSystem extends System {
  private box2d?: MainModule
  private obstacles: ObstacleCollider[] = []
  private standableSurfaces: ObstacleCollider[] = []
  private statsSystem?: StatsSystem
  private soundSystem: SoundSystem | null = null
  private allEntities: Entity[] = []
  private spatialHash: SpatialHash | null = null
  private entityLookup?: (id: number) => Entity | undefined
  private tempVec?: InstanceType<MainModule['b2Vec2']>
  private arrowBodyDef?: ReturnType<MainModule['b2DefaultBodyDef']>
  private arrowShapeDef?: ReturnType<MainModule['b2DefaultShapeDef']>
  private arrowCircle?: InstanceType<MainModule['b2Circle']>
  private dropBodyDef?: ReturnType<MainModule['b2DefaultBodyDef']>
  private dropShapeDef?: ReturnType<MainModule['b2DefaultShapeDef']>
  private dropCircle?: InstanceType<MainModule['b2Circle']>
  private world?: World
  private worldId?: ReturnType<MainModule['b2CreateWorld']>
  private groundTopY = 0
  private viewportWidth = 16
  private viewportHeight = 9
  private arrowPools?: ArrowPools
  private spineSegmentManager: SpineSegmentManager | null = null

  private tempTransform: WeaponTransform = { x: 0, y: 0, rotation: 0 }
  private tempRelativeTransform: WeaponRelativeTransform = {
    dx: 0,
    dy: 0,
    rotation: 0,
  }
  private tempTargetRelativeTransform: WeaponRelativeTransform = {
    dx: 0,
    dy: 0,
    rotation: 0,
  }
  private tempWeaponDropData: WeaponDropData = {
    weaponType: 'sword',
    movesetId: '',
    width: 0,
    height: 0,
    baseWidth: 0,
    sizeLevel: 0,
    sizeMaxLevel: 0,
    cornerRadius: 0,
    weight: 0,
    attackDamage: 0,
    postureDamage: 0,
    toughnessDamage: 0,
    bowAmmo: 0,
    bowAmmoMax: 0,
    skillId: '',
  }
  private tempPlayerPos = { x: 0, y: 0 }
  private tempHitSource = { x: 0, y: 0 }
  private tempWeaponBottomPoint = { x: 0, y: 0 }
  private currentDeltaTime = 0
  private currentTimeMs = 0
  private readonly ultimateHandler = new UltimateHandler()
  private readonly skillHandler = new SkillHandler()

  constructor(box2d?: MainModule, statsSystem?: StatsSystem) {
    super()
    this.box2d = box2d
    this.statsSystem = statsSystem
    if (statsSystem) {
      this.ultimateHandler.setStatsSystem(statsSystem)
    }
    if (box2d) {
      this.tempVec = new box2d.b2Vec2(0, 0)
      this.ultimateHandler.setBox2d(box2d)
      this.arrowBodyDef = box2d.b2DefaultBodyDef()
      this.arrowShapeDef = box2d.b2DefaultShapeDef()
      this.arrowCircle = new box2d.b2Circle()
      this.dropBodyDef = box2d.b2DefaultBodyDef()
      this.dropShapeDef = box2d.b2DefaultShapeDef()
      this.dropCircle = new box2d.b2Circle()
    }

    const transformType = componentRegistry.getComponentType('Transform')
    const weaponType = componentRegistry.getComponentType('Weapon')
    this.setRequiredComponents([transformType, weaponType])
  }

  setWorld(
    world: World,
    worldId: ReturnType<MainModule['b2CreateWorld']>,
    groundTopY: number
  ): void {
    this.world = world
    this.worldId = worldId
    this.groundTopY = groundTopY
  }

  setViewportSize(viewportWidth: number, viewportHeight: number): void {
    this.viewportWidth = viewportWidth
    this.viewportHeight = viewportHeight
  }

  setArrowPools(arrowPools: ArrowPools): void {
    this.arrowPools = arrowPools
  }

  setSoundSystem(soundSystem: SoundSystem): void {
    this.soundSystem = soundSystem
  }

  setSpineSegmentManager(
    spineSegmentManager: SpineSegmentManager | null
  ): void {
    this.spineSegmentManager = spineSegmentManager
  }

  update(entities: Entity[], deltaTime: number): void {
    // Apply debug slowdown to weapon animations
    const scaledDeltaTime = deltaTime / DEBUG_ANIMATION_SLOWDOWN
    this.currentDeltaTime = scaledDeltaTime
    const deltaMs = Math.max(0, scaledDeltaTime * 1000)
    this.currentTimeMs += deltaMs

    for (const entity of entities) {
      if (entity.attackSlots) {
        const slot = entity.attackSlots.ultimate
        if (slot.cooldownRemainingMs > 0) {
          slot.cooldownRemainingMs = Math.max(
            0,
            slot.cooldownRemainingMs - deltaMs
          )
        }
      }

      if (!entity.transform || !entity.weapon) continue
      if (entity.arrow) continue
      entity.weapon.isColliding = false

      // 更新掉落中的武器（独立武器实体且有物理组件）
      if (
        !entity.stats &&
        entity.physics &&
        entity.weapon &&
        entity.transform
      ) {
        this.updateDroppingWeapon(entity)
        continue
      }

      if (entity.stats?.isDead) {
        this.resetWeaponState(entity)
        continue
      }
      const attackDeltaMs = entity.level
        ? (deltaMs * getPlayerAgilityScalePercent(entity.level)) / 100
        : deltaMs
      this.updateWeapon(entity, attackDeltaMs)
    }

    for (const entity of entities) {
      if (!entity.weapon || entity.weapon.groundHitSoundPending === 0) continue
      if (!entity.weapon.isEquipped || !entity.stats) {
        entity.weapon.groundHitSoundPending = 0
        continue
      }
      const weapon = entity.weapon
      const soundId = weapon.groundHitSoundPending
      weapon.groundHitSoundPending = 0
      const db =
        soundId === SOUND_IDS.BIG_HAMMER_HIT_ROCK
          ? SOUND_DB_BIG_HAMMER_HIT_ROCK
          : SOUND_DB_HEAVY_SWORD_HIT_GROUND
      this.statsSystem?.playSoundAt(soundId, weapon.visual.x, weapon.visual.y)
      this.emitSoundAt(weapon.visual.x, weapon.visual.y, entity, db)
    }
  }

  setEntities(entities: Entity[]): void {
    this.allEntities = entities
    this.ultimateHandler.setAllEntities(entities)
  }

  setSpatialHash(spatialHash: SpatialHash): void {
    this.spatialHash = spatialHash
  }

  setEntityLookup(entityLookup: (id: number) => Entity | undefined): void {
    this.entityLookup = entityLookup
    this.ultimateHandler.setEntityLookup(entityLookup)
  }

  startStaggerWeaponDrop(entity: Entity): void {
    if (!entity.transform || !entity.weapon) return

    const weapon = entity.weapon
    if (entity.render) {
      weapon.renderLayer = entity.render.renderLayer
    }
    this.destroyStaggerDropBody(weapon)

    weapon.isDropping = true
    weapon.isDropped = false
    weapon.isRecovering = false
    weapon.dropElapsedTime = 0
    weapon.dropStartTransform.x = weapon.visual.x
    weapon.dropStartTransform.y = weapon.visual.y
    weapon.dropStartTransform.rotation = weapon.visual.rotation

    const radius = entity.render?.radius || DEFAULT_PLAYER_RADIUS
    const bodyHalfHeight = getBodyHalfHeight(entity.render, radius)
    const weaponRadius = DEFAULT_WEAPON_HEIGHT * 0.4
    const spawnX = entity.transform.x
    const spawnY = entity.transform.y - bodyHalfHeight + weaponRadius
    const groundRotation = getWeaponStaggerDropRotationRad(weapon.weaponType)
    const initialVelX = entity.physics?.velX ?? 0
    const initialVelY = entity.physics?.velY ?? 0

    weapon.dropEndTransform.x = spawnX
    weapon.dropEndTransform.y = spawnY
    weapon.dropEndTransform.rotation = groundRotation
    weapon.visual.x = spawnX
    weapon.visual.y = spawnY

    if (
      !this.createStaggerDropBody(
        weapon,
        spawnX,
        spawnY,
        initialVelX,
        initialVelY
      )
    ) {
      weapon.isDropping = false
      weapon.isDropped = true
      weapon.visual.rotation = groundRotation
      weapon.position.x = spawnX
      weapon.position.y = spawnY
      weapon.rotation = groundRotation
    }
  }

  private updateWeapon(entity: Entity, deltaMs: number): void {
    if (!entity.transform || !entity.weapon) return

    const weapon = entity.weapon
    if (entity.render) {
      weapon.renderLayer = entity.render.renderLayer
    }
    if (
      weapon.attackPhase !== 'block' &&
      weapon.attackPhase !== 'blockReturn' &&
      weapon.skillPhase === null &&
      weapon.width !== weapon.baseWidth
    ) {
      weapon.width = weapon.baseWidth
    }
    if (weapon.parryCounterTimerMs > 0) {
      weapon.parryCounterTimerMs = Math.max(
        0,
        weapon.parryCounterTimerMs - deltaMs
      )
    }
    this.tempPlayerPos.x = entity.transform.x
    this.tempPlayerPos.y = entity.transform.y
    const playerPos = this.tempPlayerPos
    const inputFacing =
      entity.input && entity.input.lastMoveDirection !== 0
        ? entity.input.lastMoveDirection
        : weapon.attackFacing

    if (weapon.attackPhase === 'idle') {
      weapon.attackFacing = inputFacing
    }

    // 绝招动画期间优先处理，不受装备/掉落/崩塌状态干扰
    if (weapon.ultimatePhase !== null) {
      this.ultimateHandler.handleUltimatePhases(
        entity,
        weapon,
        playerPos,
        deltaMs
      )
      return
    }

    // 技能动画期间优先处理
    if (weapon.skillPhase !== null) {
      this.handleHammerCritPhases(entity, weapon, playerPos, deltaMs)
      return
    }

    if (!weapon.isEquipped) {
      weapon.visual.x = weapon.position.x
      weapon.visual.y = weapon.position.y
      weapon.visual.rotation = weapon.rotation
      this.clearAttackImpactState(weapon)
      return
    }

    if (weapon.isDropping) {
      this.updateStaggerDroppingWeapon(weapon)
      this.clearAttackImpactState(weapon)
      return
    }

    if (entity.stats?.isStaggered) {
      if (weapon.isDropped) {
        this.syncStaggerDroppedWeapon(weapon)
      }
      this.clearAttackImpactState(weapon)
      return
    }

    if (weapon.isDropped && !weapon.isRecovering) {
      if (
        isRangedWeaponType(weapon.weaponType) &&
        entity.stats &&
        !entity.stats.isInCombat
      ) {
        this.syncStaggerDroppedWeapon(weapon)
        return
      }
      this.startWeaponRecover(entity)
    }

    if (weapon.isRecovering) {
      weapon.dropElapsedTime += this.currentDeltaTime
      const elapsedMs = weapon.dropElapsedTime * 1000
      const progress = Math.min(1, elapsedMs / WEAPON_DROP_DURATION_MS)

      // 使用缓动函数
      const eased = 1 - Math.pow(1 - progress, 2)

      // 插值相对偏移量
      lerpRelativeTransform(
        weapon.dropStartOffset,
        weapon.dropEndOffset,
        eased,
        this.tempRelativeTransform
      )

      // 应用到当前玩家位置
      applyOffset(this.tempRelativeTransform, playerPos, weapon.visual)

      if (progress >= 1) {
        weapon.isRecovering = false
        weapon.isDropped = false
      }
      this.clearAttackImpactState(weapon)
      return
    }

    this.tryEmitLandingCameraShake(entity, weapon)

    if (isRangedWeaponType(weapon.weaponType) && entity.stats) {
      this.updateBowWeapon(entity, weapon, playerPos, inputFacing, deltaMs)
      return
    }

    const now = this.currentTimeMs
    const attackRadius = weapon.attackRadius || this.getAttackRadius(entity)
    const attackFacing = weapon.attackFacing

    applyOffset(
      weapon.attackStartOffset,
      playerPos,
      weapon.attackStartTransform
    )
    applyOffset(weapon.swingStartOffset, playerPos, weapon.swingStartTransform)
    applyOffset(weapon.swingEndOffset, playerPos, weapon.swingEndTransform)

    if (weapon.attackPhase === 'idle') {
      if (entity.input && entity.input.blockRequested && !entity.isStunned()) {
        this.startBlock(entity, playerPos, inputFacing)
        return
      }

      // 检查是否有缓冲的攻击指令
      if (entity.input && !entity.isStunned()) {
        entity.input.inputBuffer.tryExecute(
          'attack',
          () => !entity.isStunned(),
          () => this.startAttack(entity)
        )
      }

      this.handleIdlePhase(entity, playerPos, attackRadius, attackFacing, now)
      return
    }

    if (weapon.attackPhase === 'block') {
      this.handleBlockPhase(entity, playerPos, inputFacing)
      return
    }

    if (weapon.attackPhase === 'blockReturn') {
      this.handleBlockReturnPhase(entity, playerPos, inputFacing)
      return
    }

    if (
      weapon.attackPhase === 'windup' &&
      (entity.movement?.isRolling || entity.movement?.isBackstepping)
    ) {
      this.resetWeaponToCombatIdle(entity, playerPos, inputFacing)
      return
    }

    weapon.attackElapsedMs += deltaMs

    if (weapon.attackPhase === 'windup') {
      this.handleWindupPhase(entity, weapon)
      return
    }

    if (weapon.attackPhase === 'swing') {
      this.handleSwingPhase(entity, playerPos, now)
      return
    }

    if (weapon.attackPhase === 'rebound') {
      this.handleReboundPhase(entity, weapon, playerPos, now)
      return
    }

    if (weapon.attackPhase === 'pause') {
      this.handlePausePhase(entity, playerPos, attackRadius, attackFacing, now)
      return
    }

    if (weapon.attackPhase === 'recover') {
      this.handleRecoverPhase(entity, playerPos, now)
    }
  }

  private startBlock(
    entity: Entity,
    playerPos: { x: number; y: number },
    facing: number
  ): void {
    if (!entity.weapon) return
    const weapon = entity.weapon

    weapon.attackPhase = 'block'
    weapon.parryElapsedTime = 0
    weapon.isParrying = true
    weapon.isBlocking = true
    if (this.statsSystem) {
      this.statsSystem.enterCombat(entity)
    }
    weapon.parryHitWeaponIds.clear()
    weapon.blockWidthStart = weapon.width
    weapon.blockWidthTarget = weapon.baseWidth * BLOCK_VERTICAL_SCALE

    // 初始化弹反起始和目标位置
    const radius = entity.render?.radius || DEFAULT_PLAYER_RADIUS
    const blockRotation = -Math.PI / 2
    getOffsetFromTransform(weapon.visual, playerPos, weapon.parryStartOffset)
    weapon.parryEndOffset.dx = facing * (radius + 0.2)
    weapon.parryEndOffset.dy = 0
    weapon.parryEndOffset.rotation = blockRotation

    weapon.parryStartTransform.x = weapon.visual.x
    weapon.parryStartTransform.y = weapon.visual.y
    weapon.parryStartTransform.rotation = weapon.visual.rotation

    weapon.parryEndTransform.x = playerPos.x + facing * (radius + 0.2)
    weapon.parryEndTransform.y = playerPos.y
    weapon.parryEndTransform.rotation = blockRotation
  }

  private handleBlockPhase(
    entity: Entity,
    playerPos: { x: number; y: number },
    facing: number
  ): void {
    if (!entity.weapon) return
    const weapon = entity.weapon

    // Update block target offset (parryEndOffset) immediately
    // ensuring we have the correct target for the current frame
    const radius = entity.render?.radius || DEFAULT_PLAYER_RADIUS
    const blockRotation = -Math.PI / 2
    weapon.parryEndOffset.dx = facing * (radius + 0.2)
    weapon.parryEndOffset.dy = 0
    weapon.parryEndOffset.rotation = blockRotation

    // 硬直期间退出格挡
    if (entity.isStunned()) {
      weapon.attackPhase = 'idle'
      weapon.isBlocking = false
      weapon.isParrying = false
      weapon.parryElapsedTime = 0
      weapon.width = weapon.baseWidth
      return
    }

    // 弹反窗口结束后，松开格挡键才能退出
    if (!weapon.isParrying && entity.input && !entity.input.blockRequested) {
      // Vital fix: Ensure visual is up-to-date with current playerPos before capturing offset
      // Since we are in "Hold" state here, we snap visual to the calculated parryEndOffset
      applyOffset(weapon.parryEndOffset, playerPos, weapon.visual)
      this.startBlockReturn(entity, weapon, playerPos)
      return
    }

    weapon.isBlocking = true
    if (this.statsSystem) {
      this.statsSystem.enterCombat(entity)
    }
    weapon.lastAttackTimestamp = this.currentTimeMs

    // 弹反窗口期间（只在武器移动期间有效）
    if (weapon.isParrying) {
      weapon.parryElapsedTime += this.currentDeltaTime * DEFAULT_FRAME_RATE
      const progress = Math.min(
        1,
        weapon.parryElapsedTime / PARRY_WINDOW_FRAMES
      )
      weapon.width =
        weapon.blockWidthStart +
        (weapon.blockWidthTarget - weapon.blockWidthStart) * progress

      // 插值相对位置并应用
      lerpRelativeTransform(
        weapon.parryStartOffset,
        weapon.parryEndOffset,
        progress,
        this.tempRelativeTransform
      )
      applyOffset(this.tempRelativeTransform, playerPos, weapon.visual)

      // 弹反窗口内检测敌人武器碰撞（仅后半段有效帧）
      if (weapon.parryElapsedTime >= PARRY_ACTIVE_START_FRAME) {
        this.checkParryHits(entity)
      }

      // 弹反窗口结束
      if (weapon.parryElapsedTime >= PARRY_WINDOW_FRAMES) {
        weapon.isParrying = false
        // 如果弹反窗口结束时格挡键已松开，自动退出
        if (entity.input && !entity.input.blockRequested) {
          this.startBlockReturn(entity, weapon, playerPos)
          return
        }
      }
    } else {
      // 弹反窗口结束后，保持格挡姿态（相对于角色）
      applyOffset(weapon.parryEndOffset, playerPos, weapon.visual)
      weapon.width = weapon.blockWidthTarget
    }
  }

  private startBlockReturn(
    entity: Entity,
    weapon: Entity['weapon'],
    playerPos: { x: number; y: number }
  ): void {
    if (!weapon) return
    weapon.attackPhase = 'blockReturn'
    weapon.isBlocking = false
    weapon.isParrying = false
    weapon.parryElapsedTime = 0 // 使用 parryElapsedTime 作为计时器（帧）
    weapon.blockWidthStart = weapon.width
    weapon.blockWidthTarget = weapon.baseWidth

    // 记录当前位置作为回归动画的起点 (存入 parryEndOffset)
    getOffsetFromTransform(weapon.visual, playerPos, weapon.parryEndOffset)

    // 计算 idle 状态的目标位置 (存入 parryStartOffset)
    // 注意：我们需要根据当前朝向计算 idle 位置
    const facing =
      entity.input && entity.input.lastMoveDirection !== 0
        ? entity.input.lastMoveDirection
        : weapon.attackFacing
    const radius = entity.render?.radius || DEFAULT_PLAYER_RADIUS

    // 复用 getFrontTransform 计算目标 offset (战斗姿态)
    getFrontTransform(
      playerPos,
      facing,
      this.tempTransform,
      radius,
      weapon.weaponType,
      weapon.width
    )
    getOffsetFromTransform(
      this.tempTransform,
      playerPos,
      weapon.parryStartOffset
    )
  }

  private handleBlockReturnPhase(
    entity: Entity,
    playerPos: { x: number; y: number },
    facing: number
  ): void {
    if (!entity.weapon) return
    const weapon = entity.weapon

    // Remove interrupt check: allow full return animation

    weapon.parryElapsedTime += this.currentDeltaTime * DEFAULT_FRAME_RATE
    // 动画时间比发起格挡快一倍 (200ms -> 100ms)
    const durationFrames = PARRY_WINDOW_FRAMES / 2
    const progress = Math.min(1, weapon.parryElapsedTime / durationFrames)
    weapon.width =
      weapon.blockWidthStart +
      (weapon.blockWidthTarget - weapon.blockWidthStart) * progress

    // 插值相对位置并应用 (从 parryEndOffset 回到 parryStartOffset)
    lerpRelativeTransform(
      weapon.parryEndOffset, // Start (recorded current)
      weapon.parryStartOffset, // End (idle)
      progress,
      this.tempRelativeTransform
    )
    applyOffset(this.tempRelativeTransform, playerPos, weapon.visual)

    // 在撤回过程中不再检测弹反碰撞，确保无弹反/防御效果

    if (progress >= 1) {
      weapon.attackPhase = 'idle'
      weapon.parryElapsedTime = 0
      weapon.width = weapon.baseWidth
    }
  }

  private checkParryHits(defender: Entity): void {
    if (!defender.weapon || !defender.faction || !defender.stats) return

    const weapon = defender.weapon
    const weaponX = weapon.visual.x
    const weaponY = weapon.visual.y
    const weaponWidth = weapon.width
    const weaponHeight = weapon.height
    const weaponRotation = weapon.visual.rotation

    for (const attacker of this.allEntities) {
      if (attacker.id === defender.id) continue
      if (!attacker.weapon || !attacker.faction || !attacker.stats) continue
      if (attacker.stats.isDead) continue
      if (
        !defender.faction.canAttackEntity(
          attacker.faction,
          attacker.id.toString()
        )
      )
        continue

      // 只检测正在攻击的敌人武器（swing 阶段）
      if (attacker.weapon.attackPhase !== 'swing') continue

      // 避免重复弹反同一个武器
      if (weapon.parryHitWeaponIds.has(attacker.id)) continue

      const attackerWeapon = attacker.weapon
      const attackerX = attackerWeapon.visual.x
      const attackerY = attackerWeapon.visual.y
      const attackerWidth = attackerWeapon.width
      const attackerHeight = attackerWeapon.height
      const attackerRotation = attackerWeapon.visual.rotation

      // 武器对武器 OBB 碰撞检测
      if (
        checkOBBvsOBB(
          weaponX,
          weaponY,
          weaponWidth,
          weaponHeight,
          weaponRotation,
          attackerX,
          attackerY,
          attackerWidth,
          attackerHeight,
          attackerRotation
        )
      ) {
        weapon.parryHitWeaponIds.add(attacker.id)
        const sparkX = (weaponX + attackerX) * 0.5
        const sparkY = (weaponY + attackerY) * 0.5
        this.statsSystem?.emitParrySpark(
          sparkX,
          sparkY,
          Math.atan2(weaponY - attackerY, weaponX - attackerX)
        )
        this.statsSystem?.playSoundAt(SOUND_IDS.SWORD_PARRY, sparkX, sparkY)
        this.emitSoundAt(sparkX, sparkY, defender, SOUND_DB_PARRY)
        this.applyParryEffect(defender, attacker)
      }
    }
  }

  private applyParryEffect(defender: Entity, attacker: Entity): void {
    if (!this.statsSystem) return

    if (defender.weapon) {
      defender.weapon.parryCounterTimerMs = PARRY_COUNTER_WINDOW_MS
      defender.weapon.parryCounterActive = false
    }
    const weaponType = attacker.weapon?.weaponType
    const isRangedAttack = isRangedAttackWeaponVisualType(weaponType)
    if (attacker.weapon && !isRangedAttack) {
      this.resetAttackStateForInterrupt(attacker.weapon)
      if (attacker.input?.inputBuffer) {
        attacker.input.inputBuffer.clearAction('attack')
      }
      this.statsSystem.applyForcedHitStun(attacker, 'light')
    }
    let attackerStaggered = false
    if (isRangedAttack) {
      this.statsSystem.applyParryRecovery(defender)
    } else {
      attackerStaggered = this.statsSystem.applyParryDamage(defender, attacker)
    }

    if (attackerStaggered) {
      // 触发攻击者武器回弹效果
      // 具体的崩塌状态和武器掉落由 StatsSystem 统一处理
      if (attacker.weapon && attacker.transform) {
        this.tempPlayerPos.x = attacker.transform.x
        this.tempPlayerPos.y = attacker.transform.y
        this.startRebound(attacker, this.tempPlayerPos, this.currentTimeMs)
      }
    } else {
      // 普通弹反
      if (
        attacker.weapon &&
        !attacker.weapon.isUnstoppable &&
        attacker.transform
      ) {
        // 非霸体攻击：仅触发回弹，无硬直
        this.tempPlayerPos.x = attacker.transform.x
        this.tempPlayerPos.y = attacker.transform.y
        this.startRebound(attacker, this.tempPlayerPos, this.currentTimeMs)
      }

      // 将防御者加入已击中列表，从而避免产生伤害（无论是霸体还是回弹，都要避免当次伤害）
      if (attacker.weapon) {
        attacker.weapon.hitEntityIds.add(defender.id)
      }
    }
  }

  private startWeaponRecover(entity: Entity): void {
    if (!entity.weapon || !entity.transform) return

    const weapon = entity.weapon
    weapon.isRecovering = true
    weapon.dropElapsedTime = 0

    this.tempPlayerPos.x = entity.transform.x
    this.tempPlayerPos.y = entity.transform.y
    const playerPos = this.tempPlayerPos

    this.syncStaggerDroppedWeapon(weapon)
    getOffsetFromTransform(weapon.visual, playerPos, weapon.dropStartOffset)
    this.destroyStaggerDropBody(weapon)

    const facing =
      entity.input && entity.input.lastMoveDirection !== 0
        ? entity.input.lastMoveDirection
        : weapon.attackFacing || 1
    const radius = entity.render?.radius || DEFAULT_PLAYER_RADIUS
    if (isRangedWeaponType(weapon.weaponType)) {
      getFrontTransform(
        playerPos,
        facing,
        this.tempTransform,
        radius,
        weapon.weaponType,
        weapon.width
      )
      getOffsetFromTransform(
        this.tempTransform,
        playerPos,
        weapon.dropEndOffset
      )
    } else {
      weapon.dropEndOffset.dx = -facing * (radius + 0.2)
      weapon.dropEndOffset.dy = radius * -0.2
      weapon.dropEndOffset.rotation = DEFAULT_WEAPON_VERTICAL_ROTATION_RAD
    }
  }

  private handleIdlePhase(
    entity: Entity,
    playerPos: { x: number; y: number },
    attackRadius: number,
    attackFacing: number,
    now: number
  ): void {
    if (!entity.input || !entity.weapon) return

    const weapon = entity.weapon
    weapon.isBlocking = false
    weapon.isParrying = false
    weapon.parryElapsedTime = 0
    const facing =
      entity.input.lastMoveDirection !== 0 ? entity.input.lastMoveDirection : 1
    const radius = entity.render?.radius || DEFAULT_PLAYER_RADIUS
    const bodyHalfHeight = getBodyHalfHeight(entity.render, radius)

    if (entity.stats?.isInCombat) {
      getFrontTransform(
        playerPos,
        facing,
        weapon.visual,
        radius,
        weapon.weaponType,
        weapon.width
      )
    } else {
      setWeaponBackTransform(
        playerPos,
        facing,
        weapon.visual,
        radius,
        weapon.weaponType,
        weapon.width,
        bodyHalfHeight
      )
    }

    let canChain = false
    let nextMove: AttackMoveData | null = null

    if (weapon.attackQueued && weapon.movesetId) {
      const moveset = ATTACK_MOVESETS[weapon.movesetId]
      const seq = moveset?.sequences.find(
        (s: any) => s.id === weapon.activeSequenceId
      )
      if (seq) {
        if (weapon.activeMoveIndex + 1 < seq.moves.length) {
          canChain = true
          nextMove = ATTACK_MOVES[seq.moves[weapon.activeMoveIndex + 1]] || null
        } else if (seq.loop) {
          canChain = true
          weapon.activeMoveIndex = -1
          nextMove = ATTACK_MOVES[seq.moves[0]] || null
        }
      }
    }

    if (canChain && nextMove) {
      if (!this.isMoveCompatibleWithWeapon(nextMove, weapon.weaponType)) {
        weapon.attackQueued = false
        return
      }
      weapon.attackQueued = false
      weapon.comboCount += 1

      weapon.activeMoveIndex += 1
      weapon.activeMoveId = nextMove.id
      weapon.swingDirection = nextMove.swingDirection
      weapon.impactLevel = this.resolveImpactLevel(nextMove, weapon)
      weapon.isUnstoppable = nextMove.isUnstoppable
      attackRadius = (attackRadius * nextMove.radiusScale) / 100

      getSwingTransforms(
        attackRadius,
        attackFacing,
        nextMove.kind,
        weapon.swingDirection,
        playerPos,
        weapon.weaponType,
        weapon.width,
        weapon.swingStartTransform,
        weapon.swingEndTransform
      )

      getOffsetFromTransform(weapon.visual, playerPos, weapon.attackStartOffset)
      getOffsetFromTransform(
        weapon.swingStartTransform,
        playerPos,
        weapon.swingStartOffset
      )
      getOffsetFromTransform(
        weapon.swingEndTransform,
        playerPos,
        weapon.swingEndOffset
      )

      if (this.statsSystem) {
        this.statsSystem.enterCombat(entity)
      }
      weapon.attackPhase = 'windup'
      weapon.attackElapsedMs = 0
      weapon.lastAttackTimestamp = now
      weapon.attackFacing = attackFacing
      this.beginAttackImpactState(entity, weapon)

      // Update attackStartTransform based on current visual (which was just set)
      applyOffset(
        weapon.attackStartOffset,
        playerPos,
        weapon.attackStartTransform
      )

      // Visual starts at attackStartTransform
      copyTransform(weapon.visual, weapon.attackStartTransform)

      weapon.attackRadius = attackRadius
      weapon.hitEntityIds.clear()
    }
  }

  private getActiveMove(weapon: Entity['weapon']): AttackMoveData | null {
    if (!weapon || !weapon.activeMoveId) return null
    return ATTACK_MOVES[weapon.activeMoveId] || null
  }

  private resolveImpactLevel(
    move: AttackMoveData,
    weapon: Entity['weapon']
  ): ImpactLevel {
    if (move.impactLevel !== undefined) return move.impactLevel
    if (!weapon) {
      return 'medium'
    }
    const baseImpactLevel =
      (WEAPON_IMPACT_LEVEL as Record<string, ImpactLevel>)[weapon.weaponType] ??
      'medium'
    if (weapon.weaponType === 'arrow' || weapon.weaponType === 'grapeShot') {
      return baseImpactLevel
    }
    const template = WEAPON_DEFAULT_DATA[weapon.weaponType]
    if (!template) {
      return baseImpactLevel
    }
    const baseLevel = template.sizeLevel > 0 ? template.sizeLevel : 1
    const currentLevel =
      Number.isFinite(weapon.sizeLevel) && weapon.sizeLevel > 0
        ? weapon.sizeLevel
        : baseLevel
    const levelOffset = currentLevel - baseLevel
    const baseIndex =
      baseImpactLevel === 'small'
        ? 0
        : baseImpactLevel === 'medium'
          ? 1
          : baseImpactLevel === 'large'
            ? 2
            : 3
    const nextIndex = Math.max(0, Math.min(3, baseIndex + levelOffset))
    if (nextIndex === 0) {
      return 'small'
    }
    if (nextIndex === 1) {
      return 'medium'
    }
    if (nextIndex === 2) {
      return 'large'
    }
    return 'extreme'
  }

  private isMoveCompatibleWithWeapon(
    move: AttackMoveData,
    weaponType: WeaponVisualType
  ): boolean {
    const compatibleWeaponTypes = move.compatibleWeaponTypes
    if (!compatibleWeaponTypes || compatibleWeaponTypes.length === 0) {
      return true
    }
    if (weaponType === 'arrow') {
      return false
    }
    return compatibleWeaponTypes.includes(weaponType as WeaponType)
  }

  private applyDamageOverrides(entity: Entity, weapon: Entity['weapon']): void {
    if (!weapon) return
    const move = this.getActiveMove(weapon)
    if (move) {
      const damageScaleNumerator =
        move.damageScaleNumerator && move.damageScaleNumerator > 0
          ? move.damageScaleNumerator
          : 1
      const damageScaleDenominator =
        move.damageScaleDenominator && move.damageScaleDenominator > 0
          ? move.damageScaleDenominator
          : 1
      if (damageScaleNumerator !== damageScaleDenominator) {
        if (weapon.originalAttackDamage === null) {
          weapon.originalAttackDamage = weapon.attackDamage
        }
        if (weapon.originalPostureDamage === null) {
          weapon.originalPostureDamage = weapon.postureDamage
        }
        if (weapon.originalToughnessDamage === null) {
          weapon.originalToughnessDamage = weapon.toughnessDamage
        }
        weapon.attackDamage = Math.max(
          1,
          Math.floor(
            (weapon.originalAttackDamage * damageScaleNumerator) /
              damageScaleDenominator
          )
        )
        weapon.postureDamage = Math.max(
          1,
          Math.floor(
            (weapon.originalPostureDamage * damageScaleNumerator) /
              damageScaleDenominator
          )
        )
        weapon.toughnessDamage = Math.max(
          1,
          Math.floor(
            (weapon.originalToughnessDamage * damageScaleNumerator) /
              damageScaleDenominator
          )
        )
      }
      if (move.attackDamage > 0) {
        weapon.originalAttackDamage = weapon.attackDamage
        weapon.attackDamage = move.attackDamage
      }
      if (move.postureDamage > 0) {
        weapon.originalPostureDamage = weapon.postureDamage
        weapon.postureDamage = move.postureDamage
      }
      if (move.toughnessDamage > 0) {
        weapon.originalToughnessDamage = weapon.toughnessDamage
        weapon.toughnessDamage = move.toughnessDamage
      }
    }
    const isJumpAttack = entity.movement ? !entity.movement.isGrounded : false
    if (!isJumpAttack) {
      return
    }
    if (weapon.originalAttackDamage === null) {
      weapon.originalAttackDamage = weapon.attackDamage
    }
    if (weapon.originalPostureDamage === null) {
      weapon.originalPostureDamage = weapon.postureDamage
    }
    if (weapon.originalToughnessDamage === null) {
      weapon.originalToughnessDamage = weapon.toughnessDamage
    }
    weapon.attackDamage = Math.max(
      1,
      Math.floor(
        (weapon.originalAttackDamage * JUMP_ATTACK_DAMAGE_SCALE_NUMERATOR) /
          JUMP_ATTACK_DAMAGE_SCALE_DENOMINATOR
      )
    )
    weapon.postureDamage = Math.max(
      1,
      Math.floor(
        (weapon.originalPostureDamage * JUMP_ATTACK_DAMAGE_SCALE_NUMERATOR) /
          JUMP_ATTACK_DAMAGE_SCALE_DENOMINATOR
      )
    )
    weapon.toughnessDamage = Math.max(
      1,
      Math.floor(
        (weapon.originalToughnessDamage * JUMP_ATTACK_DAMAGE_SCALE_NUMERATOR) /
          JUMP_ATTACK_DAMAGE_SCALE_DENOMINATOR
      )
    )
  }

  private restoreDamageOverrides(weapon: Entity['weapon']): void {
    if (!weapon) return
    if (weapon.originalAttackDamage !== null) {
      weapon.attackDamage = weapon.originalAttackDamage
      weapon.originalAttackDamage = null
    }
    if (weapon.originalPostureDamage !== null) {
      weapon.postureDamage = weapon.originalPostureDamage
      weapon.originalPostureDamage = null
    }
    if (weapon.originalToughnessDamage !== null) {
      weapon.toughnessDamage = weapon.originalToughnessDamage
      weapon.originalToughnessDamage = null
    }
  }

  private getWindupScaleRatio(weapon: Entity['weapon']): {
    numerator: number
    denominator: number
  } {
    if (!weapon) {
      return { numerator: 3, denominator: 3 }
    }
    if (weapon.weaponType === 'arrow' || weapon.weaponType === 'grapeShot') {
      return { numerator: 3, denominator: 3 }
    }
    const template = WEAPON_DEFAULT_DATA[weapon.weaponType]
    if (!template) {
      return { numerator: 3, denominator: 3 }
    }
    const baseLevel = template.sizeLevel > 0 ? template.sizeLevel : 1
    const currentLevel =
      Number.isFinite(weapon.sizeLevel) && weapon.sizeLevel > 0
        ? weapon.sizeLevel
        : baseLevel
    const deltaLevel = currentLevel - baseLevel
    const numerator = Math.max(1, 3 + deltaLevel)
    return { numerator, denominator: 3 }
  }

  private scaleWindupDuration(
    baseMs: number,
    weapon: Entity['weapon']
  ): number {
    const ratio = this.getWindupScaleRatio(weapon)
    return Math.max(
      1,
      Math.floor((baseMs * ratio.numerator) / ratio.denominator)
    )
  }

  private getWindupMs(weapon: Entity['weapon']): number {
    const move = this.getActiveMove(weapon)
    const baseMs = move ? move.windupMs : DEFAULT_WEAPON_ATTACK_WINDUP_MS
    return this.scaleWindupDuration(baseMs, weapon)
  }

  private getSwingMs(weapon: Entity['weapon']): number {
    const move = this.getActiveMove(weapon)
    return move ? move.swingMs : DEFAULT_WEAPON_ATTACK_SWING_MS
  }

  private getPauseMs(weapon: Entity['weapon']): number {
    const move = this.getActiveMove(weapon)
    return move ? move.pauseMs : DEFAULT_WEAPON_ATTACK_PAUSE_MS
  }

  private getRecoverMs(weapon: Entity['weapon']): number {
    const move = this.getActiveMove(weapon)
    return move ? move.recoverMs : DEFAULT_WEAPON_ATTACK_RECOVER_MS
  }

  private getRangedTemplate(weapon: Entity['weapon']): WeaponTemplate {
    return weapon?.weaponType === 'grape'
      ? WEAPON_DEFAULT_DATA.grape
      : WEAPON_DEFAULT_DATA.bow
  }

  private getRangedMinWindupMs(weapon: Entity['weapon']): number {
    const baseMs =
      weapon?.weaponType === 'grape' ? GRAPE_MIN_WINDUP_MS : BOW_MIN_WINDUP_MS
    return this.scaleWindupDuration(baseMs, weapon)
  }

  private getRangedMinForceRatio(weapon: Entity['weapon']): number {
    const baseRatio =
      weapon?.weaponType === 'grape'
        ? GRAPE_MIN_FORCE_RATIO
        : BOW_MIN_FORCE_RATIO
    return Math.max(
      baseRatio,
      Math.min(1, this.getRangedMinWindupMs(weapon) / BOW_MAX_DRAW_MS)
    )
  }

  private getRangedRecoverMs(weapon: Entity['weapon']): number {
    return weapon?.weaponType === 'grape' ? GRAPE_RECOVER_MS : BOW_RECOVER_MS
  }

  private getRangedLaunchSpeed(
    weapon: Entity['weapon'],
    drawRatio: number
  ): number {
    const clamped = Math.max(0, Math.min(1, drawRatio))
    if (weapon?.weaponType === 'grape') {
      const baseSpeed =
        GRAPE_MIN_SPEED + (GRAPE_MAX_SPEED - GRAPE_MIN_SPEED) * clamped
      return baseSpeed * getGrapeChargeRangeScale(clamped)
    }
    return BOW_MIN_SPEED + (BOW_MAX_SPEED - BOW_MIN_SPEED) * clamped
  }

  private getRangedGravityScale(weapon: Entity['weapon']): number {
    return weapon?.weaponType === 'grape'
      ? GRAPE_GRAVITY_SCALE
      : BOW_GRAVITY_SCALE
  }

  private getRangedProjectileVisualType(
    weapon: Entity['weapon']
  ): Extract<WeaponVisualType, 'arrow' | 'grapeShot'> {
    return weapon?.weaponType === 'grape' ? 'grapeShot' : 'arrow'
  }

  private getRangedProjectileDensity(weapon: Entity['weapon']): number {
    return weapon?.weaponType === 'grape'
      ? GRAPE_PROJECTILE_DENSITY
      : DEFAULT_PROJECTILE_DENSITY
  }

  private getRangedProjectileRestitution(weapon: Entity['weapon']): number {
    return weapon?.weaponType === 'grape'
      ? GRAPE_PROJECTILE_RESTITUTION
      : DEFAULT_PROJECTILE_RESTITUTION
  }

  private getRangedProjectileLifetimeMs(weapon: Entity['weapon']): number {
    return weapon?.weaponType === 'grape'
      ? GRAPE_PROJECTILE_LIFETIME_MS
      : DEFAULT_PROJECTILE_LIFETIME_MS
  }

  private getRangedProjectileRadius(
    weapon: Entity['weapon'],
    projectileThickness: number
  ): number {
    if (weapon?.weaponType === 'grape') {
      return GRAPE_PROJECTILE_RADIUS
    }
    return Math.max(0.08, projectileThickness)
  }

  private isRangedProjectileSticky(weapon: Entity['weapon']): boolean {
    return weapon?.weaponType !== 'grape'
  }

  private playRangedFireSound(entity: Entity, weapon: Entity['weapon']): void {
    if (!weapon) {
      return
    }
    if (weapon?.weaponType === 'grape') {
      const grapeWeapon = weapon
      this.statsSystem?.playSoundAt(
        SOUND_IDS.GRAPE_FIRE,
        grapeWeapon.visual.x,
        grapeWeapon.visual.y
      )
      this.emitSoundAt(
        grapeWeapon.visual.x,
        grapeWeapon.visual.y,
        entity,
        SOUND_DB_BOW_SNAP
      )
      return
    }

    this.statsSystem?.playSoundAt(
      SOUND_IDS.BOW_SNAP,
      weapon.visual.x,
      weapon.visual.y
    )
    this.emitSoundAt(
      weapon.visual.x,
      weapon.visual.y,
      entity,
      SOUND_DB_BOW_SNAP
    )
  }

  private getBowMinWindupMs(weapon: Entity['weapon']): number {
    return this.getRangedMinWindupMs(weapon)
  }

  private getBowMinForceRatio(weapon: Entity['weapon']): number {
    return this.getRangedMinForceRatio(weapon)
  }

  private handleWindupPhase(entity: Entity, weapon: Entity['weapon']): void {
    if (!weapon || !entity.transform) return

    const isGrounded = entity.movement?.isGrounded ?? true
    const baseWindupDuration = isGrounded
      ? this.getWindupMs(weapon)
      : this.scaleWindupDuration(250, weapon)
    const windupDuration = weapon.parryCounterActive
      ? baseWindupDuration / 2
      : baseWindupDuration

    const t = clamp01(weapon.attackElapsedMs / windupDuration)

    lerpRelativeTransform(
      weapon.attackStartOffset,
      weapon.swingStartOffset,
      t,
      this.tempRelativeTransform
    )

    this.tempPlayerPos.x = entity.transform.x
    this.tempPlayerPos.y = entity.transform.y
    applyOffset(this.tempRelativeTransform, this.tempPlayerPos, weapon.visual)

    if (entity.input && entity.input.blockRequested && !entity.isStunned()) {
      const facing =
        entity.input.lastMoveDirection !== 0
          ? entity.input.lastMoveDirection
          : weapon.attackFacing
      this.interruptWindupToBlock(entity, this.tempPlayerPos, facing)
      return
    }

    if (t >= 1) {
      weapon.parryCounterActive = false
      this.statsSystem?.playSoundAt(
        SOUND_IDS.SWORD_SWING_NORMAL,
        weapon.visual.x,
        weapon.visual.y
      )
      this.emitSoundAt(
        weapon.visual.x,
        weapon.visual.y,
        entity,
        SOUND_DB_SWORD_SWING
      )
      weapon.attackPhase = 'swing'
      this.applyDamageOverrides(entity, weapon)
      weapon.attackElapsedMs = 0
      // We don't need to copyTransform(attackStartTransform, swingStartTransform) anymore for logic,
      // but keeping data consistent is fine. However, logic now relies on offsets.
      copyTransform(weapon.attackStartTransform, weapon.swingStartTransform)
      weapon.hitEntityIds.clear()
    }
  }

  private handleSwingPhase(
    entity: Entity,
    playerPos: { x: number; y: number },
    now: number
  ): void {
    if (!entity.weapon) return
    const weapon = entity.weapon

    const t = clamp01(weapon.attackElapsedMs / this.getSwingMs(weapon))

    lerpRelativeTransform(
      weapon.swingStartOffset,
      weapon.swingEndOffset,
      t,
      this.tempRelativeTransform
    )
    applyOffset(this.tempRelativeTransform, playerPos, weapon.visual)

    if (this.checkObstacleCollision(weapon)) {
      weapon.attackCollisionSource = 'obstacle'
      weapon.isColliding = true
      this.statsSystem?.playSoundAt(
        SOUND_IDS.SWORD_HIT_OBSTACLE,
        weapon.visual.x,
        weapon.visual.y
      )
      this.emitSoundAt(
        weapon.visual.x,
        weapon.visual.y,
        entity,
        SOUND_DB_SWORD_HIT_OBSTACLE
      )
      this.applyPushback(entity, weapon)
      this.startRebound(entity, playerPos, now, 'obstacle')
      return
    }
    this.tryQueueHeavyGroundHitSound(entity, weapon)
    this.checkEntityHits(entity, weapon)
    if (t >= 1) {
      this.tryEmitCompletedFinalSwingCameraShake(entity, weapon)
      weapon.attackPhase = 'pause'
      this.restoreDamageOverrides(weapon)
      weapon.attackElapsedMs = 0
      getOffsetFromTransform(weapon.visual, playerPos, weapon.attackStartOffset)
      copyTransform(weapon.attackStartTransform, weapon.visual)
      weapon.lastAttackTimestamp = now
    }
  }

  private handlePausePhase(
    entity: Entity,
    playerPos: { x: number; y: number },
    attackRadius: number,
    attackFacing: number,
    now: number
  ): void {
    if (!entity.weapon) return

    const weapon = entity.weapon
    const currentFacing =
      entity.input && entity.input.lastMoveDirection !== 0
        ? entity.input.lastMoveDirection
        : attackFacing
    if (currentFacing !== weapon.attackFacing) {
      this.retractWeaponOnDirectionChange(entity, weapon, playerPos)
      return
    }

    // Allow interrupting pause/recovery with block
    // Allow blocking even if stunned IF we are in a locked pause (rebound recovery)
    if (
      entity.input &&
      entity.input.blockRequested &&
      (!entity.isStunned() || weapon.reboundLockedPause)
    ) {
      if (entity.isStunned() && entity.movement) {
        entity.movement.knockbackDuration = 0
      }
      this.interruptWindupToBlock(entity, playerPos, currentFacing)
      return
    }

    copyTransform(weapon.visual, weapon.attackStartTransform)
    this.tryQueueHeavyGroundHitSound(entity, weapon)

    if (entity.movement && !entity.movement.isGrounded) {
      this.checkEntityHits(entity, weapon)
    }

    const pauseMs = this.getPauseMs(weapon)
    const pauseThreshold = weapon.reboundLockedPause
      ? Math.max(REBOUND_PAUSE_MS, pauseMs)
      : pauseMs
    const reachedPause = weapon.attackElapsedMs >= pauseThreshold
    if (weapon.reboundLockedPause && !reachedPause) {
      return
    }
    if (weapon.reboundLockedPause && reachedPause) {
      weapon.reboundLockedPause = false
    }

    let canChain = false
    let nextMove: AttackMoveData | null = null

    if (
      weapon.attackQueued &&
      weapon.attackPhase !== 'rebound' &&
      weapon.attackElapsedMs >= DEFAULT_WEAPON_MIN_ATTACK_INTERVAL_MS
    ) {
      if (weapon.movesetId) {
        const moveset = ATTACK_MOVESETS[weapon.movesetId]
        const seq = moveset?.sequences.find(
          (s: any) => s.id === weapon.activeSequenceId
        )
        if (seq) {
          if (weapon.activeMoveIndex + 1 < seq.moves.length) {
            canChain = true
            nextMove =
              ATTACK_MOVES[seq.moves[weapon.activeMoveIndex + 1]] || null
          } else if (seq.loop) {
            canChain = true
            weapon.activeMoveIndex = -1
            nextMove = ATTACK_MOVES[seq.moves[0]] || null
          }
        }
      }
    }

    if (canChain && nextMove) {
      if (!this.isMoveCompatibleWithWeapon(nextMove, weapon.weaponType)) {
        weapon.attackQueued = false
      } else {
        weapon.attackQueued = false
        weapon.comboCount += 1

        weapon.activeMoveIndex += 1
        weapon.activeMoveId = nextMove.id
        weapon.swingDirection = nextMove.swingDirection
        weapon.impactLevel = this.resolveImpactLevel(nextMove, weapon)
        weapon.isUnstoppable = nextMove.isUnstoppable
        attackRadius = (attackRadius * nextMove.radiusScale) / 100

        getSwingTransforms(
          attackRadius,
          weapon.attackFacing,
          nextMove.kind,
          weapon.swingDirection,
          playerPos,
          weapon.weaponType,
          weapon.width,
          weapon.swingStartTransform,
          weapon.swingEndTransform
        )

        getOffsetFromTransform(
          weapon.visual,
          playerPos,
          weapon.attackStartOffset
        )
        getOffsetFromTransform(
          weapon.swingStartTransform,
          playerPos,
          weapon.swingStartOffset
        )
        getOffsetFromTransform(
          weapon.swingEndTransform,
          playerPos,
          weapon.swingEndOffset
        )

        weapon.attackPhase = nextMove.windupMs > 0 ? 'windup' : 'swing'
        weapon.attackElapsedMs = 0
        weapon.lastAttackTimestamp = now
        this.beginAttackImpactState(entity, weapon)

        if (weapon.attackPhase === 'windup') {
          // Update attackStartTransform based on current visual
          applyOffset(
            weapon.attackStartOffset,
            playerPos,
            weapon.attackStartTransform
          )
          copyTransform(weapon.visual, weapon.attackStartTransform)
        } else {
          // Skip windup, go directly to swing
          this.statsSystem?.playSoundAt(
            SOUND_IDS.SWORD_SWING_NORMAL,
            weapon.visual.x,
            weapon.visual.y
          )
          this.emitSoundAt(
            weapon.visual.x,
            weapon.visual.y,
            entity,
            SOUND_DB_SWORD_SWING
          )
          this.applyDamageOverrides(entity, weapon)
          copyTransform(weapon.swingStartTransform, weapon.visual)
          copyTransform(weapon.attackStartTransform, weapon.visual)
        }

        weapon.hitEntityIds.clear()
        return
      }
    }

    if (!reachedPause) return

    weapon.attackPhase = 'recover'
    weapon.reboundLockedPause = false
    weapon.attackElapsedMs = 0
    copyTransform(weapon.attackStartTransform, weapon.visual)
  }

  private handleRecoverPhase(
    entity: Entity,
    playerPos: { x: number; y: number },
    now: number
  ): void {
    if (!entity.input || !entity.weapon) return

    const weapon = entity.weapon
    const facing =
      entity.input.lastMoveDirection !== 0 ? entity.input.lastMoveDirection : 1

    if (facing !== weapon.attackFacing) {
      this.retractWeaponOnDirectionChange(entity, weapon, playerPos)
      return
    }

    const t = clamp01(weapon.attackElapsedMs / this.getRecoverMs(weapon))

    const radius = entity.render?.radius || DEFAULT_PLAYER_RADIUS
    getFrontTransform(
      playerPos,
      facing,
      this.tempTransform,
      radius,
      weapon.weaponType,
      weapon.width
    )
    getOffsetFromTransform(
      this.tempTransform,
      playerPos,
      this.tempTargetRelativeTransform
    )

    lerpRelativeTransform(
      weapon.attackStartOffset,
      this.tempTargetRelativeTransform,
      t,
      this.tempRelativeTransform
    )

    applyOffset(this.tempRelativeTransform, playerPos, weapon.visual)
    this.tryQueueHeavyGroundHitSound(entity, weapon)

    if (t >= 1) {
      weapon.attackPhase = 'idle'
      weapon.attackElapsedMs = 0
      weapon.lastAttackTimestamp = now
      weapon.attackQueued = false
      weapon.comboCount = 0
      weapon.swingDirection = 'toFront'
      weapon.nextSwingDirection = 'toFront'
      weapon.attackRadius = DEFAULT_WEAPON_ATTACK_RADIUS
      this.clearAttackImpactState(weapon)
    }
  }

  private resetAttackStateForInterrupt(weapon: Entity['weapon']): void {
    if (!weapon) return
    this.restoreDamageOverrides(weapon)
    weapon.attackElapsedMs = 0
    weapon.attackQueued = false
    weapon.comboCount = 0
    weapon.swingDirection = 'toFront'
    weapon.nextSwingDirection = 'toFront'
    weapon.reboundLockedPause = false
    weapon.parryCounterActive = false
    weapon.hitEntityIds.clear()
    this.clearAttackImpactState(weapon)
  }

  private resetWeaponToCombatIdle(
    entity: Entity,
    playerPos: { x: number; y: number },
    facing: number
  ): void {
    if (!entity.weapon) return
    const weapon = entity.weapon
    this.resetAttackStateForInterrupt(weapon)
    weapon.attackPhase = 'idle'
    weapon.attackFacing = facing
    weapon.isBlocking = false
    weapon.isParrying = false
    weapon.parryElapsedTime = 0
    weapon.parryHitWeaponIds.clear()
    const radius = entity.render?.radius || DEFAULT_PLAYER_RADIUS
    getFrontTransform(
      playerPos,
      facing,
      weapon.visual,
      radius,
      weapon.weaponType,
      weapon.width
    )
  }

  private interruptWindupToBlock(
    entity: Entity,
    playerPos: { x: number; y: number },
    facing: number
  ): void {
    if (!entity.weapon) return
    const weapon = entity.weapon
    this.resetAttackStateForInterrupt(weapon)
    weapon.attackFacing = facing
    this.startBlock(entity, playerPos, facing)
  }

  private dropWeapon(
    x: number,
    y: number,
    facing: number,
    weaponData: WeaponDropData,
    renderLayer: number
  ): void {
    if (
      !this.world ||
      !this.box2d ||
      !this.worldId ||
      !this.dropBodyDef ||
      !this.dropShapeDef ||
      !this.dropCircle
    ) {
      return
    }

    const entity = this.world.createEntity()

    const transform = new TransformComponent()
    transform.x = x
    transform.y = y
    entity.addComponent(transform)

    // 创建物理组件用于掉落动画
    const physics = new PhysicsComponent()
    const { b2CreateBody, b2BodyType, b2CreateCircleShape } = this.box2d

    const bodyDef = this.dropBodyDef
    bodyDef.type = b2BodyType.b2_dynamicBody
    bodyDef.position.Set(x, y)
    bodyDef.linearDamping = 2.0 // 较高的阻尼，快速减速
    bodyDef.motionLocks.angularZ = true // 锁定旋转
    physics.bodyId = b2CreateBody(this.worldId, bodyDef)

    // 使用固定小半径，避免大型武器（锤子/葡萄等）因中心过高而视觉悬浮
    const weaponRadius = DEFAULT_WEAPON_HEIGHT * 0.4
    const circle = this.dropCircle
    circle.center.Set(0, 0)
    circle.radius = weaponRadius
    const shapeDef = this.dropShapeDef
    shapeDef.density = 0.5
    shapeDef.material.friction = 0.3
    shapeDef.material.restitution = 0
    shapeDef.filter.categoryBits = getWeaponCollisionCategory(renderLayer)
    shapeDef.filter.maskBits = getWeaponCollisionMask(renderLayer)
    physics.shapeId = b2CreateCircleShape(physics.bodyId, shapeDef, circle)

    // 施加初始速度：向玩家面朝的前方抛出，同时向上
    const throwSpeedX = facing * 3 // 向前抛
    const throwSpeedY = -3.0 // 向上抛
    const throwVelocity = this.tempVec
    if (throwVelocity) {
      throwVelocity.x = throwSpeedX
      throwVelocity.y = throwSpeedY
      this.box2d.b2Body_SetLinearVelocity(physics.bodyId, throwVelocity)
      physics.velX = throwVelocity.x
      physics.velY = throwVelocity.y
    }

    entity.addComponent(physics)

    const render = new RenderComponent()
    render.radius = 0
    render.visible = true
    render.renderLayer = renderLayer
    entity.addComponent(render)

    const weapon = new WeaponComponent()
    weapon.renderLayer = renderLayer
    weapon.width = weaponData.width
    weapon.height = weaponData.height
    weapon.baseWidth = weaponData.baseWidth
    weapon.sizeLevel = weaponData.sizeLevel
    weapon.sizeMaxLevel = weaponData.sizeMaxLevel
    weapon.blockWidthStart = weaponData.width
    weapon.blockWidthTarget = weaponData.width
    weapon.cornerRadius = weaponData.cornerRadius
    weapon.weight = weaponData.weight
    weapon.weaponType = weaponData.weaponType
    weapon.movesetId =
      weaponData.movesetId ||
      this.getDefaultMovesetIdForWeaponType(weaponData.weaponType)
    weapon.attackDamage = weaponData.attackDamage
    weapon.postureDamage = weaponData.postureDamage
    weapon.toughnessDamage = weaponData.toughnessDamage
    weapon.bowAmmo = weaponData.bowAmmo
    weapon.bowAmmoMax = weaponData.bowAmmoMax
    weapon.skillId = weaponData.skillId

    const weaponY = y
    const groundRotation = getWeaponGroundRotationRad(weaponData.weaponType)
    weapon.position.x = x
    weapon.position.y = weaponY
    weapon.rotation = groundRotation
    weapon.isEquipped = false
    weapon.attackPhase = 'idle'
    weapon.visual.x = x
    weapon.visual.y = weaponY
    weapon.visual.rotation = groundRotation
    weapon.attackStartTransform.x = x
    weapon.attackStartTransform.y = weaponY
    weapon.attackStartTransform.rotation = groundRotation
    weapon.swingStartTransform.x = x
    weapon.swingStartTransform.y = weaponY
    weapon.swingStartTransform.rotation = groundRotation
    weapon.swingEndTransform.x = x
    weapon.swingEndTransform.y = weaponY
    weapon.swingEndTransform.rotation = groundRotation
    weapon.attackStartOffset.dx = 0
    weapon.attackStartOffset.dy = 0
    weapon.attackStartOffset.rotation = DEFAULT_WEAPON_VERTICAL_ROTATION_RAD
    weapon.swingStartOffset.dx = 0
    weapon.swingStartOffset.dy = 0
    weapon.swingStartOffset.rotation = DEFAULT_WEAPON_VERTICAL_ROTATION_RAD
    weapon.swingEndOffset.dx = 0
    weapon.swingEndOffset.dy = 0
    weapon.swingEndOffset.rotation = DEFAULT_WEAPON_VERTICAL_ROTATION_RAD
    weapon.attackRadius = DEFAULT_WEAPON_ATTACK_RADIUS
    weapon.pickupCooldownEndTime = this.currentTimeMs + 500 // 500ms 冷却时间

    entity.addComponent(weapon)
  }

  private updateDroppingWeapon(entity: Entity): void {
    if (!entity.physics || !entity.transform || !entity.weapon || !this.box2d) {
      return
    }

    const { b2DestroyBody } = this.box2d

    // 同步物理位置到 transform
    const bodyX = entity.physics.posX
    const bodyY = entity.physics.posY
    entity.transform.x = bodyX
    entity.transform.y = bodyY

    // 更新武器视觉位置
    entity.weapon.visual.x = bodyX
    entity.weapon.visual.y = bodyY

    // 增加掉落时间计时
    entity.weapon.dropElapsedTime += this.currentDeltaTime

    // 检查速度是否接近 0（已落地）
    // 增加最小掉落时间保护（0.1秒），防止生成第一帧因速度未更新而直接判定落地（悬空）
    const speed = Math.hypot(entity.physics.velX, entity.physics.velY)
    if (speed < 0.1 && entity.weapon.dropElapsedTime > 0.1) {
      // 速度很小，认为已经落地
      // 保留物理体最后的位置作为武器的最终位置
      const finalX = bodyX
      const finalY = bodyY

      // 销毁物理体
      b2DestroyBody(entity.physics.bodyId)
      entity.removeComponent('Physics')

      // 使用物理体最后的实际位置，而不是重新计算
      entity.weapon.position.x = finalX
      entity.weapon.position.y = finalY
      entity.weapon.visual.x = finalX
      entity.weapon.visual.y = finalY
    }
  }

  private updateBowWeapon(
    entity: Entity,
    weapon: WeaponComponent,
    playerPos: { x: number; y: number },
    facing: number,
    deltaMs: number
  ): void {
    weapon.attackFacing = facing
    if (!entity.input) {
      weapon.bowIsDrawing = false
      weapon.bowDrawElapsedMs = 0
      weapon.bowDrawRatio = 0
      weapon.bowForceRatio = 0
      weapon.bowReleaseRatio = 0
      weapon.bowReleasePending = false
      weapon.bowReleaseDelayMs = 0
      weapon.bowReleaseDelayTotalMs = 0
      weapon.bowRecoverElapsedMs = 0
      weapon.bowAimAngle = 0
      weapon.bowHasAim = false
      weapon.bowFreeAim = false
      weapon.bowFreeAimAngle = 0
      weapon.bowFreeAimReticleX = 0
      weapon.bowFreeAimReticleY = 0
      weapon.bowFreeAimUseMouse = false
      weapon.bowFreeAimUseReticle = false
      weapon.bowFreeAimLastMouseX = 0
      weapon.bowFreeAimLastMouseY = 0
      weapon.bowFreeAimReticleOffsetX = 0
      weapon.bowFreeAimReticleOffsetY = 0
      return
    }

    const hasAmmo = weapon.bowAmmo > 0
    const holdingAttack =
      hasAmmo && entity.input.attackRequested && !entity.isStunned()
    const radius = entity.render?.radius || DEFAULT_PLAYER_RADIUS
    const wantsLockToggle =
      entity.input.lockToggleRequested || entity.input.lockSwitchIntent !== 0
    if (weapon.bowFreeAim && wantsLockToggle) {
      weapon.bowFreeAim = false
      weapon.bowFreeAimAngle = 0
      weapon.bowFreeAimReticleX = 0
      weapon.bowFreeAimReticleY = 0
      weapon.bowFreeAimUseMouse = false
      weapon.bowFreeAimUseReticle = false
      weapon.bowFreeAimReticleOffsetX = 0
      weapon.bowFreeAimReticleOffsetY = 0
      entity.input.facingOverride = null
    }
    if (entity.input.freeAimToggleRequested) {
      entity.input.freeAimToggleRequested = false
      let lockedAimAngle: number | null = null
      let lockedTargetX = 0
      let lockedTargetY = 0
      let hasLockedTarget = false
      if (this.entityLookup && entity.input.lockedTargetId !== null) {
        const target = this.entityLookup(entity.input.lockedTargetId)
        if (target?.transform && target.stats && !target.stats.isDead) {
          lockedTargetX = target.transform.x
          lockedTargetY = target.transform.y
          hasLockedTarget = true
          const minForceRatio = this.getBowMinForceRatio(weapon)
          const drawRatio = weapon.bowIsDrawing
            ? weapon.bowDrawRatio
            : Math.max(weapon.bowDrawRatio, minForceRatio)
          lockedAimAngle = this.getBowAimAngleForPosition(
            weapon,
            playerPos,
            radius,
            lockedTargetX,
            lockedTargetY,
            drawRatio
          )
        }
      }
      weapon.bowFreeAim = !weapon.bowFreeAim
      if (weapon.bowFreeAim) {
        const defaultAngle =
          lockedAimAngle ??
          (weapon.bowHasAim
            ? weapon.bowAimAngle
            : weapon.attackFacing === 1
              ? 0
              : Math.PI)
        weapon.bowFreeAimAngle = defaultAngle
        weapon.bowFreeAimUseMouse = false
        weapon.bowFreeAimUseReticle = hasLockedTarget
        weapon.bowFreeAimLastMouseX = entity.input.mouseAimX
        weapon.bowFreeAimLastMouseY = entity.input.mouseAimY
        if (hasLockedTarget) {
          weapon.bowFreeAimReticleX = lockedTargetX
          weapon.bowFreeAimReticleY = lockedTargetY
          weapon.bowFreeAimReticleOffsetX = lockedTargetX - playerPos.x
          weapon.bowFreeAimReticleOffsetY = lockedTargetY - playerPos.y
        } else {
          const reticleRange =
            Math.max(this.viewportWidth, this.viewportHeight) * 0.5
          const reticleX = playerPos.x + Math.cos(defaultAngle) * reticleRange
          const reticleY = playerPos.y + Math.sin(defaultAngle) * reticleRange
          weapon.bowFreeAimReticleX = reticleX
          weapon.bowFreeAimReticleY = reticleY
          weapon.bowFreeAimReticleOffsetX = reticleX - playerPos.x
          weapon.bowFreeAimReticleOffsetY = reticleY - playerPos.y
        }
        entity.input.lockedTargetId = null
        entity.input.lockLostTimer = 0
        if (entity.stats && !entity.stats.isInCombat) {
          entity.stats.isInCombat = true
          entity.stats.combatExitTimer = 0
        }
      } else {
        entity.input.lockedTargetId = null
        entity.input.lockLostTimer = 0
        entity.input.facingOverride = null
        weapon.bowFreeAimReticleX = 0
        weapon.bowFreeAimReticleY = 0
        weapon.bowFreeAimUseMouse = false
        weapon.bowFreeAimUseReticle = false
        weapon.bowFreeAimReticleOffsetX = 0
        weapon.bowFreeAimReticleOffsetY = 0
      }
    }

    const freeAimActive = weapon.bowFreeAim
    const aimAngle = freeAimActive
      ? null
      : this.getBowAimAngleForTarget(entity, weapon, playerPos, radius)
    const hasAimLock = aimAngle !== null
    const inCombat =
      entity.stats?.isInCombat ||
      weapon.bowIsDrawing ||
      holdingAttack ||
      hasAimLock ||
      freeAimActive

    if (freeAimActive) {
      entity.input.lockedTargetId = null
      entity.input.lockLostTimer = 0
      const useMouseAim = entity.input.mouseAimActive
      const mouseAimMoved = entity.input.mouseAimMoved
      let reticleAngle = weapon.bowFreeAimAngle
      let reticleX = 0
      let reticleY = 0
      let useMouseAimNow = false
      if (useMouseAim) {
        const mouseX = entity.input.mouseAimX
        const mouseY = entity.input.mouseAimY
        if (weapon.bowFreeAimUseMouse || mouseAimMoved) {
          weapon.bowFreeAimUseMouse = true
          useMouseAimNow = true
        }
        weapon.bowFreeAimLastMouseX = mouseX
        weapon.bowFreeAimLastMouseY = mouseY
        if (useMouseAimNow) {
          reticleX = mouseX
          reticleY = mouseY
          reticleAngle = Math.atan2(
            reticleY - playerPos.y,
            reticleX - playerPos.x
          )
          weapon.bowFreeAimAngle = reticleAngle
          weapon.bowFreeAimReticleX = reticleX
          weapon.bowFreeAimReticleY = reticleY
          weapon.bowFreeAimReticleOffsetX = reticleX - playerPos.x
          weapon.bowFreeAimReticleOffsetY = reticleY - playerPos.y
          weapon.bowFreeAimUseReticle = false
        }
      }
      if (!useMouseAimNow) {
        const adjust =
          entity.input.freeAimAdjust * (weapon.attackFacing >= 0 ? 1 : -1)
        if (adjust !== 0) {
          weapon.bowFreeAimUseReticle = false
          weapon.bowFreeAimAngle +=
            adjust * BOW_FREE_AIM_TURN_SPEED * (deltaMs / 1000)
        }
        if (!weapon.bowFreeAimUseReticle) {
          const centerAngle = facing === 1 ? 0 : Math.PI
          const minAngle = centerAngle - BOW_FREE_AIM_MAX_OFFSET
          const maxAngle = centerAngle + BOW_FREE_AIM_MAX_OFFSET
          if (weapon.bowFreeAimAngle < minAngle) {
            weapon.bowFreeAimAngle = minAngle
          } else if (weapon.bowFreeAimAngle > maxAngle) {
            weapon.bowFreeAimAngle = maxAngle
          }
        }

        if (weapon.bowFreeAimUseReticle) {
          reticleX = playerPos.x + weapon.bowFreeAimReticleOffsetX
          reticleY = playerPos.y + weapon.bowFreeAimReticleOffsetY
          reticleAngle = Math.atan2(
            reticleY - playerPos.y,
            reticleX - playerPos.x
          )
          weapon.bowFreeAimAngle = reticleAngle
          weapon.bowFreeAimReticleX = reticleX
          weapon.bowFreeAimReticleY = reticleY
        } else {
          const reticleRange =
            Math.max(this.viewportWidth, this.viewportHeight) * 0.5
          reticleAngle = weapon.bowFreeAimAngle
          reticleX = playerPos.x + Math.cos(reticleAngle) * reticleRange
          reticleY = playerPos.y + Math.sin(reticleAngle) * reticleRange
          weapon.bowFreeAimReticleX = reticleX
          weapon.bowFreeAimReticleY = reticleY
          weapon.bowFreeAimReticleOffsetX = reticleX - playerPos.x
          weapon.bowFreeAimReticleOffsetY = reticleY - playerPos.y
        }
      }
      entity.input.facingOverride = Math.cos(reticleAngle) >= 0 ? 1 : -1

      const minForceRatio = this.getBowMinForceRatio(weapon)
      const drawRatio = weapon.bowIsDrawing
        ? weapon.bowDrawRatio
        : Math.max(weapon.bowDrawRatio, minForceRatio)
      const freeAimAngle = this.getBowAimAngleForPosition(
        weapon,
        playerPos,
        radius,
        reticleX,
        reticleY,
        drawRatio
      )
      weapon.bowAimAngle = freeAimAngle
      weapon.bowHasAim = true
      const offset = radius + 0.2
      weapon.visual.x = playerPos.x + Math.cos(freeAimAngle) * offset
      weapon.visual.y = playerPos.y + Math.sin(freeAimAngle) * offset
      weapon.visual.rotation = getRangedAimRotation(
        weapon.weaponType,
        freeAimAngle
      )
      weapon.attackFacing = Math.cos(freeAimAngle) >= 0 ? 1 : -1
    } else if (hasAimLock && aimAngle !== null) {
      weapon.bowAimAngle = aimAngle
      weapon.bowHasAim = true
      weapon.bowFreeAimReticleX = 0
      weapon.bowFreeAimReticleY = 0
      const offset = radius + 0.2
      weapon.visual.x = playerPos.x + Math.cos(aimAngle) * offset
      weapon.visual.y = playerPos.y + Math.sin(aimAngle) * offset
      weapon.visual.rotation = getRangedAimRotation(weapon.weaponType, aimAngle)
      weapon.attackFacing = Math.cos(aimAngle) >= 0 ? 1 : -1
    } else if (inCombat) {
      weapon.bowHasAim = false
      weapon.bowFreeAimReticleX = 0
      weapon.bowFreeAimReticleY = 0
      getFrontTransform(
        playerPos,
        facing,
        weapon.visual,
        radius,
        weapon.weaponType,
        weapon.width
      )
    } else {
      weapon.bowHasAim = false
      weapon.bowFreeAimReticleX = 0
      weapon.bowFreeAimReticleY = 0
      setWeaponBackTransform(
        playerPos,
        facing,
        weapon.visual,
        radius,
        weapon.weaponType,
        weapon.width,
        getBodyHalfHeight(entity.render, radius)
      )
    }

    if (weapon.bowRecoverElapsedMs > 0) {
      weapon.bowRecoverElapsedMs += deltaMs
      const recoverRatio = Math.min(
        1,
        weapon.bowRecoverElapsedMs / this.getRangedRecoverMs(weapon)
      )
      weapon.bowDrawRatio = Math.max(
        0,
        weapon.bowReleaseRatio * (1 - recoverRatio)
      )
      if (weapon.bowRecoverElapsedMs >= this.getRangedRecoverMs(weapon)) {
        weapon.bowRecoverElapsedMs = 0
        weapon.bowReleaseRatio = 0
        weapon.bowDrawRatio = 0
      }
      return
    }

    if (holdingAttack && !weapon.bowIsDrawing) {
      weapon.bowIsDrawing = true
      weapon.bowDrawElapsedMs = 0
      weapon.bowDrawRatio = 0
      weapon.bowForceRatio = 0
      weapon.bowReleaseRatio = 0
      weapon.bowReleasePending = false
      weapon.bowReleaseDelayMs = 0
      weapon.bowReleaseDelayTotalMs = 0
      if (this.statsSystem) {
        this.statsSystem.enterCombat(entity)
      }
    }

    if (holdingAttack) {
      weapon.bowDrawElapsedMs += deltaMs
      weapon.bowDrawRatio = Math.min(
        1,
        weapon.bowDrawElapsedMs / BOW_MAX_DRAW_MS
      )
      return
    }

    if (weapon.bowReleasePending) {
      weapon.bowReleaseDelayMs = Math.max(0, weapon.bowReleaseDelayMs - deltaMs)
      weapon.bowDrawElapsedMs += deltaMs
      const minForceRatio = this.getBowMinForceRatio(weapon)
      weapon.bowDrawRatio = Math.max(
        minForceRatio,
        Math.min(1, weapon.bowDrawElapsedMs / BOW_MAX_DRAW_MS)
      )
      weapon.bowForceRatio = weapon.bowDrawRatio

      if (weapon.bowReleaseDelayMs <= 0) {
        const drawRatio = weapon.bowForceRatio
        weapon.bowReleasePending = false
        weapon.bowReleaseDelayMs = 0
        weapon.bowReleaseDelayTotalMs = 0
        weapon.bowIsDrawing = false
        weapon.bowDrawElapsedMs = 0
        weapon.bowDrawRatio = 0
        weapon.bowForceRatio = 0

        if (drawRatio > 0) {
          weapon.bowReleaseRatio = drawRatio
          this.fireBowArrow(entity, weapon, facing, drawRatio)
          weapon.bowRecoverElapsedMs = 0.0001
        }
      }
      return
    }

    if (weapon.bowIsDrawing) {
      const drawRatio = weapon.bowDrawRatio
      const minForceRatio = this.getBowMinForceRatio(weapon)
      weapon.bowForceRatio = drawRatio

      const minWindupMs = this.getBowMinWindupMs(weapon)
      if (weapon.bowDrawElapsedMs < minWindupMs) {
        weapon.bowReleasePending = true
        weapon.bowReleaseDelayMs = minWindupMs - weapon.bowDrawElapsedMs
        weapon.bowReleaseDelayTotalMs = weapon.bowReleaseDelayMs
        return
      }

      weapon.bowIsDrawing = false
      weapon.bowDrawElapsedMs = 0
      weapon.bowDrawRatio = 0
      weapon.bowForceRatio = 0

      if (drawRatio > 0) {
        weapon.bowReleaseRatio = Math.max(drawRatio, minForceRatio)
        this.fireBowArrow(
          entity,
          weapon,
          facing,
          Math.max(drawRatio, minForceRatio)
        )
        weapon.bowRecoverElapsedMs = 0.0001
      }
    }
  }

  private fireBowArrow(
    entity: Entity,
    weapon: WeaponComponent,
    facing: number,
    drawRatio: number
  ): void {
    if (
      !this.world ||
      !this.box2d ||
      !this.worldId ||
      !this.arrowPools ||
      !this.arrowBodyDef ||
      !this.arrowShapeDef ||
      !this.arrowCircle
    ) {
      return
    }

    if (weapon.bowAmmo <= 0) {
      return
    }

    const arrowFaction = entity.faction?.factionId ?? Faction.Player
    if (!this.arrowPools.canSpawn(arrowFaction)) {
      return
    }

    const arrowEntity = this.world.createEntity()
    const arrowTransform = this.arrowPools.acquireTransform()

    arrowTransform.x = weapon.visual.x
    arrowTransform.y = weapon.visual.y
    arrowTransform.rotation = 0
    arrowEntity.addComponent(arrowTransform)

    const physics = this.arrowPools.acquirePhysics()
    const { b2CreateBody, b2BodyType, b2CreateCircleShape } = this.box2d

    const bodyDef = this.arrowBodyDef
    bodyDef.type = b2BodyType.b2_dynamicBody
    bodyDef.position.Set(arrowTransform.x, arrowTransform.y)
    bodyDef.linearDamping = 0.05
    bodyDef.motionLocks.angularZ = true
    bodyDef.isBullet = true
    bodyDef.gravityScale = this.getRangedGravityScale(weapon)
    physics.bodyId = b2CreateBody(this.worldId, bodyDef)

    const arrowWeapon = this.arrowPools.acquireWeapon()
    const rangedTemplate = this.getRangedTemplate(weapon)
    const rangedBaseWidth = rangedTemplate.width > 0 ? rangedTemplate.width : 1
    const rangedScale = Math.max(0.5, weapon.width / rangedBaseWidth)
    const projectileVisualType = this.getRangedProjectileVisualType(weapon)
    const arrowLength =
      projectileVisualType === 'grapeShot'
        ? GRAPE_PROJECTILE_RADIUS * 2
        : DEFAULT_WEAPON_WIDTH * 0.9 * rangedScale
    const arrowThickness =
      projectileVisualType === 'grapeShot'
        ? GRAPE_PROJECTILE_RADIUS * 2
        : DEFAULT_WEAPON_HEIGHT * 0.15 * rangedScale
    const arrowSpeed = this.getRangedLaunchSpeed(weapon, drawRatio)
    const minForceRatio = this.getBowMinForceRatio(weapon)
    const forceDenom = 1 - minForceRatio
    const forceRatio =
      forceDenom > 0
        ? Math.min(1, Math.max(0, (drawRatio - minForceRatio) / forceDenom))
        : 1
    const forceMultiplier = 1 + forceRatio
    const aimAngle = weapon.bowHasAim
      ? weapon.bowAimAngle
      : facing === 1
        ? 0
        : Math.PI
    const arrowRotation = aimAngle + Math.PI / 2

    const circle = this.arrowCircle
    circle.center.Set(0, 0)
    circle.radius = this.getRangedProjectileRadius(weapon, arrowThickness)
    const shapeDef = this.arrowShapeDef
    shapeDef.density = this.getRangedProjectileDensity(weapon)
    shapeDef.material.friction = 0.2
    shapeDef.material.restitution = this.getRangedProjectileRestitution(weapon)
    shapeDef.filter.categoryBits = getWeaponCollisionCategory(
      weapon.renderLayer
    )
    shapeDef.filter.maskBits = getWeaponCollisionMask(weapon.renderLayer)
    physics.shapeId = b2CreateCircleShape(physics.bodyId, shapeDef, circle)

    const launchSpeed = arrowSpeed * 1.5
    if (this.tempVec) {
      this.tempVec.x = Math.cos(aimAngle) * launchSpeed
      this.tempVec.y = Math.sin(aimAngle) * launchSpeed
      this.box2d.b2Body_SetLinearVelocity(physics.bodyId, this.tempVec)
    }

    arrowEntity.addComponent(physics)

    arrowWeapon.width = arrowLength
    arrowWeapon.height = arrowThickness
    arrowWeapon.baseWidth = arrowLength
    arrowWeapon.blockWidthStart = arrowLength
    arrowWeapon.blockWidthTarget = arrowLength
    arrowWeapon.cornerRadius = 0
    arrowWeapon.weight = 0
    arrowWeapon.weaponType = projectileVisualType
    arrowWeapon.attackDamage = weapon.attackDamage * forceMultiplier
    arrowWeapon.postureDamage = weapon.postureDamage * forceMultiplier
    arrowWeapon.toughnessDamage = weapon.toughnessDamage * forceMultiplier
    arrowWeapon.impactLevel = 'small'
    arrowWeapon.isEquipped = false
    arrowWeapon.attackPhase = 'idle'
    arrowWeapon.renderLayer = weapon.renderLayer
    arrowWeapon.visual.x = arrowTransform.x
    arrowWeapon.visual.y = arrowTransform.y
    arrowWeapon.visual.rotation = arrowRotation
    arrowEntity.addComponent(arrowWeapon)

    const arrow = this.arrowPools.acquireArrow()
    arrow.ownerId = entity.id
    arrow.factionId = arrowFaction
    arrow.npcFactions = entity.faction?.npcFactions ?? []
    arrow.projectileType = projectileVisualType
    arrow.velocityX = Math.cos(aimAngle) * launchSpeed
    arrow.velocityY = Math.sin(aimAngle) * launchSpeed
    arrow.gravity = DEFAULT_GRAVITY * this.getRangedGravityScale(weapon)
    arrow.hitRadius = circle.radius
    arrow.elapsedMs = 0
    arrow.lifetimeMs = this.getRangedProjectileLifetimeMs(weapon)
    arrow.prevX = arrowTransform.x
    arrow.prevY = arrowTransform.y
    arrow.hasPrev = true
    arrowEntity.addComponent(arrow)

    this.arrowPools.registerSpawn(arrowFaction)
    weapon.bowAmmo = Math.max(0, weapon.bowAmmo - 1)
    this.playRangedFireSound(entity, weapon)
  }

  private getBowAimAngleForTarget(
    entity: Entity,
    weapon: WeaponComponent,
    playerPos: { x: number; y: number },
    radius: number
  ): number | null {
    if (!this.entityLookup || !entity.input) return null
    const targetId = entity.input.lockedTargetId
    if (targetId === null) return null

    const target = this.entityLookup(targetId)
    if (!target?.transform || !target.stats || target.stats.isDead) return null

    const minForceRatio = this.getBowMinForceRatio(weapon)
    const drawRatio = weapon.bowIsDrawing
      ? weapon.bowDrawRatio
      : Math.max(weapon.bowDrawRatio, minForceRatio)
    return this.getBowAimAngleForPosition(
      weapon,
      playerPos,
      radius,
      target.transform.x,
      target.transform.y,
      drawRatio
    )
  }

  private getBowAimAngleForPosition(
    weapon: Entity['weapon'],
    playerPos: { x: number; y: number },
    radius: number,
    targetX: number,
    targetY: number,
    drawRatio: number
  ): number {
    const speed = this.getRangedLaunchSpeed(weapon, drawRatio) * 1.5
    const offset = radius + 0.2
    let aimAngle = this.getBowAimAngle(
      weapon,
      playerPos.x,
      playerPos.y,
      targetX,
      targetY,
      speed
    )

    const originX = playerPos.x + Math.cos(aimAngle) * offset
    const originY = playerPos.y + Math.sin(aimAngle) * offset
    aimAngle = this.getBowAimAngle(
      weapon,
      originX,
      originY,
      targetX,
      targetY,
      speed
    )

    return aimAngle
  }

  private getBowAimAngle(
    weapon: Entity['weapon'],
    originX: number,
    originY: number,
    targetX: number,
    targetY: number,
    speed: number
  ): number {
    const dx = targetX - originX
    const dyUp = originY - targetY
    const dxAbs = Math.abs(dx)
    if (dxAbs < 0.001) {
      return dyUp >= 0 ? -Math.PI / 2 : Math.PI / 2
    }

    const g = DEFAULT_GRAVITY * this.getRangedGravityScale(weapon)
    const v2 = speed * speed
    const disc = v2 * v2 - g * (g * dxAbs * dxAbs + 2 * dyUp * v2)
    if (disc < 0) {
      return -Math.atan2(dyUp, dx)
    }

    const sqrtDisc = Math.sqrt(disc)
    const tan = (v2 - sqrtDisc) / (g * dxAbs)
    let angle = Math.atan(tan)
    if (dx < 0) {
      angle = Math.PI - angle
    }
    return -angle
  }

  private getSlotForWeaponType(weaponType: WeaponVisualType): WeaponSlotId {
    return isSecondaryWeaponType(weaponType) ? 'secondary' : 'main'
  }

  private getSlotData(
    weaponSlots: WeaponSlotsComponent,
    slotId: WeaponSlotId
  ): WeaponSlotData {
    return slotId === 'main' ? weaponSlots.main : weaponSlots.secondary
  }

  private getDefaultMovesetIdForWeaponType(
    weaponType: WeaponVisualType
  ): string {
    return getDefaultAttackMovesetIdForWeaponType(weaponType)
  }

  private getSlotMovesetId(slot: WeaponSlotData): string {
    return (
      slot.movesetId || this.getDefaultMovesetIdForWeaponType(slot.weaponType)
    )
  }

  private getWeaponMovesetId(weapon: WeaponComponent): string {
    return (
      weapon.movesetId ||
      this.getDefaultMovesetIdForWeaponType(weapon.weaponType)
    )
  }

  private applyNormalAttackMoveset(entity: Entity, movesetId: string): void {
    if (entity.attackSlots) {
      entity.attackSlots.normal.hasMoveset = movesetId.length > 0
      entity.attackSlots.normal.movesetId = movesetId
    }
    if (entity.weapon) {
      entity.weapon.movesetId = movesetId
    }
    if (entity.npcAI) {
      entity.npcAI.movesetId = movesetId
    }
    if (entity.weapon?.weaponType) {
      this.applyUltimateMoveset(entity, entity.weapon.weaponType)
    }
    this.applySkillMoveset(entity)
  }

  private applyUltimateMoveset(entity: Entity, weaponType: string): void {
    if (!entity.attackSlots) return
    const movesetId = getUltimateMovesetIdForWeaponType(
      weaponType as Parameters<typeof getUltimateMovesetIdForWeaponType>[0]
    )
    entity.attackSlots.ultimate.hasMoveset = movesetId.length > 0
    entity.attackSlots.ultimate.movesetId = movesetId
  }

  private applySkillMoveset(entity: Entity): void {
    if (!entity.attackSlots || !entity.weapon) return
    const skill = entity.attackSlots.skill
    const skillId = entity.weapon.skillId
    skill.skillId = skillId
    skill.maxCharges = skillId ? DEFAULT_SKILL_MAX_CHARGES : 0
    // 切换武器时，从 weapon.skillCharges 恢复次数
    skill.chargesRemaining = skillId ? entity.weapon.skillCharges : 0
  }

  handleUltimateRequest(entity: Entity, maxLandDist?: number): void {
    this.ultimateHandler.handleUltimateRequest(entity, maxLandDist)
  }

  handleSkillRequest(entity: Entity): void {
    if (!entity.attackSlots || !entity.weapon) return
    const skill = entity.attackSlots.skill
    if (!skill.skillId || skill.chargesRemaining <= 0) return
    skill.chargesRemaining--
    entity.weapon.skillCharges = skill.chargesRemaining
    // 同步到当前武器槽
    if (entity.weaponSlots) {
      const activeSlotData =
        entity.weaponSlots.activeSlot === 'main'
          ? entity.weaponSlots.main
          : entity.weaponSlots.secondary
      activeSlotData.skillCharges = skill.chargesRemaining
    }
    this.skillHandler.handleSkillRequest(entity)
  }

  private getNormalAttackMovesetId(entity: Entity): string {
    const attackSlot = entity.attackSlots?.normal
    if (attackSlot && attackSlot.hasMoveset && attackSlot.movesetId) {
      return attackSlot.movesetId
    }
    return entity.weapon?.movesetId || ''
  }

  private canMovesetUseWeapon(
    movesetId: string,
    weaponType: WeaponVisualType
  ): boolean {
    if (weaponType === 'arrow') return false
    return isMovesetCompatibleWithWeaponType(
      movesetId,
      weaponType as WeaponType
    )
  }

  private playInvalidAttackFeedback(
    entity: Entity,
    weapon: Entity['weapon'],
    playerPos: { x: number; y: number },
    facing: number
  ): void {
    if (!weapon) return
    const radius = entity.render?.radius || DEFAULT_PLAYER_RADIUS
    getFrontTransform(
      playerPos,
      facing,
      this.tempTransform,
      radius,
      weapon.weaponType,
      weapon.width
    )
    copyTransform(this.tempTransform, weapon.visual)
    weapon.visual.rotation += facing === 1 ? 0.22 : -0.22
    weapon.visual.x += facing * 0.08
    this.startBlockReturn(entity, weapon, playerPos)
  }

  private copyWeaponToSlot(
    slot: WeaponSlotData,
    weapon: WeaponComponent
  ): void {
    slot.hasWeapon = true
    slot.weaponType = weapon.weaponType
    slot.movesetId = this.getWeaponMovesetId(weapon)
    slot.width = weapon.baseWidth
    slot.height = weapon.height
    slot.baseWidth = weapon.baseWidth
    slot.sizeLevel = weapon.sizeLevel
    slot.sizeMaxLevel = weapon.sizeMaxLevel
    slot.cornerRadius = weapon.cornerRadius
    slot.weight = weapon.weight
    slot.attackDamage = weapon.attackDamage
    slot.postureDamage = weapon.postureDamage
    slot.toughnessDamage = weapon.toughnessDamage
    slot.bowAmmo = weapon.bowAmmo
    slot.bowAmmoMax = weapon.bowAmmoMax
    slot.skillId = weapon.skillId
    slot.skillCharges = weapon.skillCharges
  }

  private copySlotToWeapon(
    slot: WeaponSlotData,
    weapon: WeaponComponent
  ): void {
    weapon.width = slot.baseWidth
    weapon.height = slot.height
    weapon.baseWidth = slot.baseWidth
    weapon.sizeLevel = slot.sizeLevel
    weapon.sizeMaxLevel = slot.sizeMaxLevel
    weapon.blockWidthStart = weapon.baseWidth
    weapon.blockWidthTarget = weapon.baseWidth
    weapon.cornerRadius = slot.cornerRadius
    weapon.weight = slot.weight
    weapon.weaponType = slot.weaponType
    weapon.movesetId = this.getSlotMovesetId(slot)
    weapon.attackDamage = slot.attackDamage
    weapon.postureDamage = slot.postureDamage
    weapon.toughnessDamage = slot.toughnessDamage
    weapon.bowAmmo = slot.bowAmmo
    weapon.bowAmmoMax = slot.bowAmmoMax
    weapon.skillId = slot.skillId
    weapon.skillCharges = slot.skillCharges
  }

  private fillWeaponDropDataFromWeapon(
    weapon: WeaponComponent,
    out: WeaponDropData
  ): void {
    out.weaponType = weapon.weaponType
    out.movesetId = this.getWeaponMovesetId(weapon)
    out.width = weapon.baseWidth
    out.height = weapon.height
    out.baseWidth = weapon.baseWidth
    out.sizeLevel = weapon.sizeLevel
    out.sizeMaxLevel = weapon.sizeMaxLevel
    out.cornerRadius = weapon.cornerRadius
    out.weight = weapon.weight
    out.attackDamage = weapon.attackDamage
    out.postureDamage = weapon.postureDamage
    out.toughnessDamage = weapon.toughnessDamage
    out.bowAmmo = weapon.bowAmmo
    out.bowAmmoMax = weapon.bowAmmoMax
    out.skillId = weapon.skillId
  }

  private fillWeaponDropDataFromSlot(
    slot: WeaponSlotData,
    out: WeaponDropData
  ): void {
    out.weaponType = slot.weaponType
    out.movesetId = this.getSlotMovesetId(slot)
    out.width = slot.baseWidth
    out.height = slot.height
    out.baseWidth = slot.baseWidth
    out.sizeLevel = slot.sizeLevel
    out.sizeMaxLevel = slot.sizeMaxLevel
    out.cornerRadius = slot.cornerRadius
    out.weight = slot.weight
    out.attackDamage = slot.attackDamage
    out.postureDamage = slot.postureDamage
    out.toughnessDamage = slot.toughnessDamage
    out.bowAmmo = slot.bowAmmo
    out.bowAmmoMax = slot.bowAmmoMax
    out.skillId = slot.skillId
  }

  private resetWeaponForSwap(entity: Entity): void {
    const weapon = entity.weapon
    if (!weapon) return

    weapon.attackPhase = 'idle'
    weapon.attackElapsedMs = 0
    weapon.lastAttackTimestamp = 0
    weapon.activeSequenceId = ''
    weapon.activeMoveIndex = 0
    weapon.activeMoveId = ''
    weapon.attackQueued = false
    weapon.comboCount = 0
    weapon.swingDirection = 'toFront'
    weapon.nextSwingDirection = 'toFront'
    weapon.attackRadius = DEFAULT_WEAPON_ATTACK_RADIUS
    weapon.isBlocking = false
    weapon.isParrying = false
    weapon.parryElapsedTime = 0
    weapon.parryCounterTimerMs = 0
    weapon.parryCounterActive = false
    weapon.reboundLockedPause = false
    weapon.isColliding = false
    weapon.hitEntityIds.clear()
    weapon.parryHitWeaponIds.clear()
    weapon.bowIsDrawing = false
    weapon.bowDrawElapsedMs = 0
    weapon.bowDrawRatio = 0
    weapon.bowForceRatio = 0
    weapon.bowReleaseRatio = 0
    weapon.bowReleasePending = false
    weapon.bowReleaseDelayMs = 0
    weapon.bowReleaseDelayTotalMs = 0
    weapon.bowRecoverElapsedMs = 0
    weapon.bowAimAngle = 0
    weapon.bowHasAim = false
    weapon.bowFreeAim = false
    weapon.bowFreeAimAngle = 0
    weapon.bowFreeAimReticleX = 0
    weapon.bowFreeAimReticleY = 0
    weapon.bowFreeAimUseMouse = false
    weapon.bowFreeAimUseReticle = false
    weapon.bowFreeAimLastMouseX = 0
    weapon.bowFreeAimLastMouseY = 0
    weapon.bowFreeAimReticleOffsetX = 0
    weapon.bowFreeAimReticleOffsetY = 0
    weapon.isDropping = false
    weapon.isDropped = false
    weapon.isRecovering = false
    weapon.dropElapsedTime = 0
    weapon.dropStartOffset.dx = 0
    weapon.dropStartOffset.dy = 0
    weapon.dropStartOffset.rotation = 0
    weapon.dropEndOffset.dx = 0
    weapon.dropEndOffset.dy = 0
    weapon.dropEndOffset.rotation = 0
    this.clearAttackImpactState(weapon)

    if (entity.input) {
      entity.input.facingOverride = null
    }
  }

  /**
   * 尝试拾取附近的武器
   * @returns 如果消费了互动键（进行了武器替换）返回true，否则返回false
   */
  tryPickUpWeapon(entity: Entity): boolean {
    if (!entity.transform || !entity.weapon) return false
    if (entity.stats?.isDead) return false
    const weaponSlots = entity.weaponSlots
    const entityLayer = entity.render?.renderLayer ?? 0

    // 检查是否靠近独立的武器实体
    for (const weaponEntity of this.allEntities) {
      // 独立武器实体：有 weapon 组件但没有 stats 组件
      if (!weaponEntity.weapon || weaponEntity.stats) continue
      if (weaponEntity.arrow || weaponEntity.weapon.weaponType === 'arrow')
        continue
      if (weaponEntity.weapon.isEquipped) continue
      if (!weaponEntity.transform) continue
      if ((weaponEntity.render?.renderLayer ?? 0) !== entityLayer) continue

      const dx = entity.transform.x - weaponEntity.transform.x
      const dy = entity.transform.y - weaponEntity.transform.y
      const distance = Math.hypot(dx, dy)

      if (distance <= DEFAULT_WEAPON_PICKUP_DISTANCE) {
        // 检查拾取冷却时间
        if (weaponEntity.weapon.pickupCooldownEndTime > this.currentTimeMs) {
          continue // 还在冷却期内，跳过
        }

        if (weaponEntity.weapon.weaponType === 'hook') {
          if (entity.grapple && !entity.grapple.hasGrapple) {
            entity.grapple.hasGrapple = true
            entity.grapple.isPulling = false
            entity.grapple.pullElapsedMs = 0
            weaponEntity.weapon.isEquipped = true
            this.showHud(entity)
          }
          continue
        }

        if (weaponSlots) {
          const targetSlotId = this.getSlotForWeaponType(
            weaponEntity.weapon.weaponType
          )
          const targetSlot = this.getSlotData(weaponSlots, targetSlotId)

          // 自动拾取逻辑：如果槽位为空，直接捡起，不需要按互动键
          if (!targetSlot.hasWeapon) {
            this.copyWeaponToSlot(targetSlot, weaponEntity.weapon)
            weaponEntity.weapon.isEquipped = true
            this.showHud(entity)

            if (!entity.weapon.isEquipped) {
              weaponSlots.activeSlot = targetSlotId
            }

            if (weaponSlots.activeSlot === targetSlotId) {
              this.copySlotToWeapon(targetSlot, entity.weapon)
              this.applyNormalAttackMoveset(
                entity,
                this.getSlotMovesetId(targetSlot)
              )
              entity.weapon.isEquipped = true
              entity.weapon.rotation = DEFAULT_WEAPON_VERTICAL_ROTATION_RAD
              entity.weapon.visual.rotation =
                DEFAULT_WEAPON_VERTICAL_ROTATION_RAD
              this.resetWeaponForSwap(entity)

              // 立即更新视觉位置，防止闪烁
              const facing = entity.input?.lastMoveDirection || 1
              const radius = entity.render?.radius || DEFAULT_PLAYER_RADIUS
              if (entity.stats?.isInCombat) {
                getFrontTransform(
                  entity.transform,
                  facing,
                  entity.weapon.visual,
                  radius,
                  entity.weapon.weaponType,
                  entity.weapon.width
                )
              } else {
                setWeaponBackTransform(
                  entity.transform,
                  facing,
                  entity.weapon.visual,
                  radius,
                  entity.weapon.weaponType,
                  entity.weapon.width,
                  getBodyHalfHeight(entity.render, radius)
                )
              }
            }
            continue // 已自动拾取，继续检查其他武器（或结束）
          }

          // 替换逻辑：槽位已满，必须按互动键（E）
          const interacted = entity.input?.inputBuffer.tryExecute(
            'interact',
            () => !entity.isStunned(),
            () => {}
          )

          if (!interacted) continue

          // 在玩家脚下掉落旧武器
          const facing = entity.weapon.attackFacing

          // Sync active weapon state to slot before dropping if we are dropping the active slot
          if (
            weaponSlots.activeSlot === targetSlotId &&
            entity.weapon &&
            entity.weapon.isEquipped
          ) {
            this.copyWeaponToSlot(targetSlot, entity.weapon)
          }

          this.fillWeaponDropDataFromSlot(targetSlot, this.tempWeaponDropData)
          this.dropWeapon(
            entity.transform.x,
            entity.transform.y,
            facing,
            this.tempWeaponDropData,
            entity.render?.renderLayer ?? 0
          )

          this.copyWeaponToSlot(targetSlot, weaponEntity.weapon)
          weaponEntity.weapon.isEquipped = true

          if (!entity.weapon.isEquipped) {
            weaponSlots.activeSlot = targetSlotId
          }

          if (weaponSlots.activeSlot === targetSlotId) {
            this.copySlotToWeapon(targetSlot, entity.weapon)
            this.applyNormalAttackMoveset(
              entity,
              this.getSlotMovesetId(targetSlot)
            )
            entity.weapon.isEquipped = true
            entity.weapon.rotation = DEFAULT_WEAPON_VERTICAL_ROTATION_RAD
            entity.weapon.visual.rotation = DEFAULT_WEAPON_VERTICAL_ROTATION_RAD
            this.resetWeaponForSwap(entity)
            this.showHud(entity)
            this.triggerFreeAimIfMouseMode(entity)
          }
          return true // 替换武器，已消费互动键
        }

        // 如果玩家武器未装备，直接装备并应用属性
        if (!entity.weapon.isEquipped) {
          entity.weapon.width = weaponEntity.weapon.width
          entity.weapon.height = weaponEntity.weapon.height
          entity.weapon.baseWidth = weaponEntity.weapon.baseWidth
          entity.weapon.cornerRadius = weaponEntity.weapon.cornerRadius
          entity.weapon.weight = weaponEntity.weapon.weight
          entity.weapon.weaponType = weaponEntity.weapon.weaponType
          entity.weapon.movesetId = this.getWeaponMovesetId(weaponEntity.weapon)
          entity.weapon.attackDamage = weaponEntity.weapon.attackDamage
          entity.weapon.postureDamage = weaponEntity.weapon.postureDamage
          entity.weapon.toughnessDamage = weaponEntity.weapon.toughnessDamage
          entity.weapon.bowAmmo = weaponEntity.weapon.bowAmmo
          entity.weapon.bowAmmoMax = weaponEntity.weapon.bowAmmoMax
          entity.weapon.isEquipped = true
          this.applyNormalAttackMoveset(entity, entity.weapon.movesetId)
          entity.weapon.rotation = DEFAULT_WEAPON_VERTICAL_ROTATION_RAD
          entity.weapon.visual.rotation = DEFAULT_WEAPON_VERTICAL_ROTATION_RAD
          this.resetWeaponForSwap(entity)

          // 立即更新视觉位置，防止闪烁
          const newFacing = entity.input?.lastMoveDirection || 1
          const radius = entity.render?.radius || DEFAULT_PLAYER_RADIUS
          if (entity.stats?.isInCombat) {
            getFrontTransform(
              entity.transform,
              newFacing,
              entity.weapon.visual,
              radius,
              entity.weapon.weaponType,
              entity.weapon.width
            )
          } else {
            setWeaponBackTransform(
              entity.transform,
              newFacing,
              entity.weapon.visual,
              radius,
              entity.weapon.weaponType,
              entity.weapon.width,
              getBodyHalfHeight(entity.render, radius)
            )
          }

          // 标记武器实体为已拾取（会在后续清理）
          weaponEntity.weapon.isEquipped = true
          this.showHud(entity)
          this.triggerFreeAimIfMouseMode(entity)
          return false // 自动拾取，未消费互动键
        }

        // 如果玩家已有武器，需要按 E 键（interact）才能替换
        if (entity.weapon.isEquipped) {
          const interacted = entity.input?.inputBuffer.tryExecute(
            'interact',
            () => !entity.isStunned(),
            () => {}
          )

          if (!interacted) continue

          // 在玩家脚下掉落旧武器
          const facing = entity.weapon.attackFacing
          this.fillWeaponDropDataFromWeapon(
            entity.weapon,
            this.tempWeaponDropData
          )
          this.dropWeapon(
            entity.transform.x,
            entity.transform.y,
            facing,
            this.tempWeaponDropData,
            entity.render?.renderLayer ?? 0
          )

          // 替换为新武器属性
          entity.weapon.width = weaponEntity.weapon.width
          entity.weapon.height = weaponEntity.weapon.height
          entity.weapon.baseWidth = weaponEntity.weapon.baseWidth
          entity.weapon.cornerRadius = weaponEntity.weapon.cornerRadius
          entity.weapon.weight = weaponEntity.weapon.weight
          entity.weapon.weaponType = weaponEntity.weapon.weaponType
          entity.weapon.movesetId = this.getWeaponMovesetId(weaponEntity.weapon)
          entity.weapon.attackDamage = weaponEntity.weapon.attackDamage
          entity.weapon.postureDamage = weaponEntity.weapon.postureDamage
          entity.weapon.toughnessDamage = weaponEntity.weapon.toughnessDamage
          entity.weapon.bowAmmo = weaponEntity.weapon.bowAmmo
          this.applyNormalAttackMoveset(entity, entity.weapon.movesetId)
          entity.weapon.rotation = DEFAULT_WEAPON_VERTICAL_ROTATION_RAD
          entity.weapon.visual.rotation = DEFAULT_WEAPON_VERTICAL_ROTATION_RAD
          this.resetWeaponForSwap(entity)

          // 立即更新视觉位置，防止闪烁
          const newFacing = entity.input?.lastMoveDirection || 1
          const radius = entity.render?.radius || DEFAULT_PLAYER_RADIUS
          if (entity.stats?.isInCombat) {
            getFrontTransform(
              entity.transform,
              newFacing,
              entity.weapon.visual,
              radius,
              entity.weapon.weaponType,
              entity.weapon.width
            )
          } else {
            setWeaponBackTransform(
              entity.transform,
              newFacing,
              entity.weapon.visual,
              radius,
              entity.weapon.weaponType,
              entity.weapon.width,
              getBodyHalfHeight(entity.render, radius)
            )
          }

          // 标记武器实体为已拾取（会在后续清理）
          weaponEntity.weapon.isEquipped = true
          this.showHud(entity)
          this.triggerFreeAimIfMouseMode(entity)
          return true // 替换武器，已消费互动键
        }
      }
    }

    // 没有可拾取的武器，未消费互动键
    return false
  }

  private showHud(entity: Entity): void {
    if (!entity.stats) return
    entity.stats.hudVisibleTimer = entity.stats.combatExitTimeout
  }

  dropWeaponsOnDeath(entity: Entity): void {
    if (!entity.transform) return

    const transform = entity.transform
    const weaponSlots = entity.weaponSlots
    const weapon = entity.weapon
    if (weapon) {
      this.destroyStaggerDropBody(weapon)
      weapon.isDropping = false
      weapon.isDropped = false
      weapon.isRecovering = false
    }
    let facing =
      weapon?.attackFacing ??
      entity.input?.lastMoveDirection ??
      entity.npcAI?.lastFacing ??
      1
    if (facing === 0) {
      facing = 1
    }

    const dropOffset = 0.35
    const dropFromSlot = (
      slot: WeaponSlotData,
      dropFacing: number,
      offsetX: number
    ) => {
      if (!slot.hasWeapon) return
      this.fillWeaponDropDataFromSlot(slot, this.tempWeaponDropData)
      if (this.shouldDropWeaponOnDeath()) {
        this.dropWeapon(
          transform.x + offsetX,
          transform.y,
          dropFacing,
          this.tempWeaponDropData,
          entity.render?.renderLayer ?? 0
        )
      }
      slot.hasWeapon = false
    }

    if (
      weaponSlots &&
      (weaponSlots.main.hasWeapon || weaponSlots.secondary.hasWeapon)
    ) {
      // Sync active weapon state (ammo, etc.) to the slot before dropping
      if (weapon && weapon.isEquipped) {
        const activeSlot = this.getSlotData(weaponSlots, weaponSlots.activeSlot)
        this.copyWeaponToSlot(activeSlot, weapon)
      }

      const hasMain = weaponSlots.main.hasWeapon
      const hasSecondary = weaponSlots.secondary.hasWeapon
      if (hasMain && hasSecondary) {
        dropFromSlot(weaponSlots.main, facing, facing * dropOffset)
        dropFromSlot(weaponSlots.secondary, -facing, -facing * dropOffset)
      } else if (hasMain) {
        dropFromSlot(weaponSlots.main, facing, 0)
      } else {
        dropFromSlot(weaponSlots.secondary, facing, 0)
      }
      if (weapon) {
        weapon.isEquipped = false
      }
      return
    }

    if (weapon && weapon.isEquipped) {
      this.fillWeaponDropDataFromWeapon(weapon, this.tempWeaponDropData)
      if (this.shouldDropWeaponOnDeath()) {
        this.dropWeapon(
          transform.x,
          transform.y,
          facing,
          this.tempWeaponDropData,
          entity.render?.renderLayer ?? 0
        )
      }
      weapon.isEquipped = false
    }
  }

  private shouldDropWeaponOnDeath(): boolean {
    return ((Math.random() * DEATH_WEAPON_DROP_CHANCE_DENOMINATOR) | 0) === 0
  }

  setGroundWeaponPickupCooldown(entity: Entity, cooldownMs: number): void {
    if (!entity.weapon) {
      return
    }
    const delayMs = Number.isFinite(cooldownMs) ? Math.max(0, cooldownMs) : 0
    entity.weapon.pickupCooldownEndTime = this.currentTimeMs + delayMs
  }

  switchWeaponSlot(entity: Entity, slotId: WeaponSlotId): void {
    if (!entity.weapon || !entity.weaponSlots) return
    if (entity.stats?.isDead) return

    const weaponSlots = entity.weaponSlots
    if (weaponSlots.activeSlot === slotId) return

    const targetSlot = this.getSlotData(weaponSlots, slotId)
    if (!targetSlot.hasWeapon) return

    const currentSlot = this.getSlotData(weaponSlots, weaponSlots.activeSlot)
    this.copyWeaponToSlot(currentSlot, entity.weapon)

    weaponSlots.activeSlot = slotId
    this.copySlotToWeapon(targetSlot, entity.weapon)
    this.applyNormalAttackMoveset(entity, this.getSlotMovesetId(targetSlot))
    entity.weapon.isEquipped = true
    entity.weapon.rotation = DEFAULT_WEAPON_VERTICAL_ROTATION_RAD
    entity.weapon.visual.rotation = DEFAULT_WEAPON_VERTICAL_ROTATION_RAD
    this.resetWeaponForSwap(entity)
    this.showHud(entity)
    this.triggerFreeAimIfMouseMode(entity)
  }

  private triggerFreeAimIfMouseMode(entity: Entity): void {
    if (
      entity.weapon &&
      isRangedWeaponType(entity.weapon.weaponType) &&
      entity.input &&
      entity.input.mouseAimActive
    ) {
      entity.input.freeAimToggleRequested = true
    }
  }

  startAttack(entity: Entity, movesetIdOverride?: string): void {
    if (!entity.transform || !entity.input || !entity.weapon) return
    if (!entity.weapon.isEquipped) return
    if (isRangedWeaponType(entity.weapon.weaponType)) return
    if (entity.stats?.isDead) return
    if (entity.isStunned()) {
      entity.input.inputBuffer.clearAll()
      entity.input.inputBuffer.bufferAction('attack')
      return
    }

    const weapon = entity.weapon
    const now = this.currentTimeMs
    this.tempPlayerPos.x = entity.transform.x
    this.tempPlayerPos.y = entity.transform.y
    const playerPos = this.tempPlayerPos
    const facing =
      entity.input.lastMoveDirection !== 0 ? entity.input.lastMoveDirection : 1
    let attackRadius = this.getAttackRadius(entity)
    weapon.attackRadius = attackRadius
    weapon.attackFacing = facing
    let equippedMovesetId =
      movesetIdOverride ?? this.getNormalAttackMovesetId(entity)
    if (
      !equippedMovesetId ||
      !this.canMovesetUseWeapon(equippedMovesetId, weapon.weaponType)
    ) {
      const fallbackId = getDefaultAttackMovesetIdForWeaponType(
        weapon.weaponType
      )
      if (
        fallbackId &&
        this.canMovesetUseWeapon(fallbackId, weapon.weaponType)
      ) {
        equippedMovesetId = fallbackId
      } else {
        weapon.attackQueued = false
        this.playInvalidAttackFeedback(entity, weapon, playerPos, facing)
        return
      }
    }
    weapon.movesetId = equippedMovesetId

    if (weapon.movesetId && weapon.attackPhase !== 'idle') {
      const moveset = ATTACK_MOVESETS[weapon.movesetId]
      const seq = moveset?.sequences.find(
        (s: any) => s.id === weapon.activeSequenceId
      )
      if (seq && !seq.loop && weapon.activeMoveIndex + 1 >= seq.moves.length) {
        return
      }
    }

    if (weapon.parryCounterTimerMs > 0) {
      weapon.parryCounterActive = true
      weapon.parryCounterTimerMs = 0
    }

    if (weapon.attackPhase === 'idle') {
      if (weapon.movesetId) {
        const moveset = ATTACK_MOVESETS[weapon.movesetId]
        if (moveset) {
          weapon.activeSequenceId = moveset.defaultSequenceId
          weapon.activeMoveIndex = 0
          const seq = moveset.sequences.find(
            (s: any) => s.id === weapon.activeSequenceId
          )
          if (seq && seq.moves.length > 0) {
            const firstMoveId = seq.moves[0]
            const move = ATTACK_MOVES[firstMoveId]
            if (move) {
              if (!this.isMoveCompatibleWithWeapon(move, weapon.weaponType)) {
                weapon.attackQueued = false
                return
              }
              weapon.activeMoveId = firstMoveId
              weapon.swingDirection = move.swingDirection
              weapon.impactLevel = this.resolveImpactLevel(move, weapon)
              weapon.isUnstoppable = move.isUnstoppable
              attackRadius = (attackRadius * move.radiusScale) / 100
              weapon.attackRadius = attackRadius
            }
          }
        }
      }

      getSwingTransforms(
        attackRadius,
        facing,
        this.getMoveKind(weapon),
        weapon.swingDirection,
        playerPos,
        weapon.weaponType,
        weapon.width,
        weapon.swingStartTransform,
        weapon.swingEndTransform
      )

      getOffsetFromTransform(weapon.visual, playerPos, weapon.attackStartOffset)
      getOffsetFromTransform(
        weapon.swingStartTransform,
        playerPos,
        weapon.swingStartOffset
      )
      getOffsetFromTransform(
        weapon.swingEndTransform,
        playerPos,
        weapon.swingEndOffset
      )

      if (this.statsSystem) {
        this.statsSystem.enterCombat(entity)
      }
      weapon.attackPhase = 'windup'
      weapon.attackElapsedMs = 0
      weapon.lastAttackTimestamp = now
      this.beginAttackImpactState(entity, weapon)

      applyOffset(
        weapon.attackStartOffset,
        playerPos,
        weapon.attackStartTransform
      )

      weapon.attackRadius = attackRadius
      weapon.comboCount = 1
      weapon.attackQueued = false

      applyOffset(weapon.attackStartOffset, playerPos, weapon.visual)

      weapon.hitEntityIds.clear()
      return
    }

    if (!weapon.attackQueued) {
      weapon.attackQueued = true
      weapon.lastAttackTimestamp = now
    }
  }

  private getAttackRadius(entity: Entity): number {
    const weapon = entity.weapon
    if (!weapon) {
      return DEFAULT_WEAPON_ATTACK_RADIUS
    }
    const entityRadius = entity.render?.radius || DEFAULT_PLAYER_RADIUS
    return entityRadius + weapon.width / 2 + DEFAULT_WEAPON_PLAYER_CLEARANCE
  }

  private emitSoundAt(
    x: number,
    y: number,
    source: Entity,
    db: number,
    rangeMultiplier = 1
  ): void {
    if (!this.soundSystem) return
    const radius = source.render?.radius ?? DEFAULT_PLAYER_RADIUS
    this.soundSystem.emitSoundAt(x, y, radius, db, rangeMultiplier)
  }

  private beginAttackImpactState(
    entity: Entity,
    weapon: WeaponComponent
  ): void {
    weapon.attackStartedAirborne = !(entity.movement?.isGrounded ?? true)
    weapon.landingShakeTriggered = false
    weapon.impactShakeTriggered = false
    weapon.attackCollisionSource = 'none'
    weapon.groundHitSoundTriggered = false
    weapon.groundHitSoundPending = 0
  }

  private clearAttackImpactState(weapon: Entity['weapon']): void {
    if (!weapon) return
    weapon.attackStartedAirborne = false
    weapon.landingShakeTriggered = false
    weapon.impactShakeTriggered = false
    weapon.attackCollisionSource = 'none'
    weapon.groundHitSoundTriggered = false
    weapon.groundHitSoundPending = 0
  }

  private isBigHammer(weapon: Entity['weapon']): boolean {
    return (
      !!weapon &&
      weapon.weaponType === 'hammer' &&
      weapon.sizeLevel >= BIG_HAMMER_SIZE_LEVEL
    )
  }

  private isGreatSword(weapon: Entity['weapon']): boolean {
    return (
      !!weapon &&
      weapon.weaponType === 'sword' &&
      weapon.sizeLevel >= GREAT_SWORD_SIZE_LEVEL
    )
  }

  private isGiantSword(weapon: Entity['weapon']): boolean {
    return (
      !!weapon &&
      weapon.weaponType === 'sword' &&
      weapon.sizeLevel >= GIANT_SWORD_SIZE_LEVEL
    )
  }

  private shouldPlayHeavySwordGroundHitSound(
    weapon: Entity['weapon']
  ): boolean {
    return (
      !!weapon &&
      this.isGreatSword(weapon) &&
      weapon.swingDirection === 'toFront'
    )
  }

  private getHeavyGroundHitSoundId(weapon: Entity['weapon']): number {
    if (!weapon) return 0
    if (this.isBigHammer(weapon)) {
      return SOUND_IDS.BIG_HAMMER_HIT_ROCK
    }
    if (this.shouldPlayHeavySwordGroundHitSound(weapon)) {
      return SOUND_IDS.HEAVY_SWORD_HIT_GROUND
    }
    return 0
  }

  private shouldTriggerHeavyGroundHitSound(
    entity: Entity,
    weapon: WeaponComponent
  ): boolean {
    if (this.getHeavyGroundHitSoundId(weapon) === 0) return false
    if (!weapon.isEquipped) return false
    if (weapon.isDropping || weapon.isDropped || weapon.isRecovering)
      return false
    if (weapon.attackCollisionSource !== 'none') return false
    if (!this.isHeavyGroundHitEligiblePhase(weapon)) return false
    if (!this.checkGroundCollision(weapon)) return false
    if (!this.isGroundImpactShakeTimingValid(entity)) return false
    return !this.hasActiveParryWeaponCollision(entity, weapon)
  }

  private tryQueueHeavyGroundHitSound(
    entity: Entity,
    weapon: WeaponComponent
  ): void {
    if (weapon.groundHitSoundTriggered) return
    if (!this.shouldTriggerHeavyGroundHitSound(entity, weapon)) return
    weapon.attackCollisionSource = 'ground'
    weapon.groundHitSoundTriggered = true
    weapon.groundHitSoundPending = this.getHeavyGroundHitSoundId(weapon)
  }

  private isHeavyGroundHitEligiblePhase(weapon: WeaponComponent): boolean {
    return (
      weapon.attackPhase === 'swing' ||
      weapon.attackPhase === 'pause' ||
      weapon.attackPhase === 'recover'
    )
  }

  private hasActiveParryWeaponCollision(
    attacker: Entity,
    attackerWeapon: WeaponComponent
  ): boolean {
    if (!attacker.faction) return false

    const weaponX = attackerWeapon.visual.x
    const weaponY = attackerWeapon.visual.y
    const weaponWidth = attackerWeapon.width
    const weaponHeight = attackerWeapon.height
    const weaponRotation = attackerWeapon.visual.rotation
    const attackRadius =
      attackerWeapon.attackRadius !== 0
        ? attackerWeapon.attackRadius
        : this.getAttackRadius(attacker)

    const nearbyEntities = this.spatialHash
      ? this.spatialHash.query(weaponX, weaponY, attackRadius + 2)
      : this.allEntities
    const nearbyCount = this.spatialHash
      ? this.spatialHash.getQueryResultLength()
      : nearbyEntities.length

    for (let i = 0; i < nearbyCount; i++) {
      const defender = nearbyEntities[i]
      if (!defender || defender.id === attacker.id) continue
      if (!defender.weapon || !defender.faction || !defender.stats) continue
      if (defender.stats.isDead) continue
      if (
        !attacker.faction.canAttackEntity(
          defender.faction,
          defender.id.toString()
        )
      ) {
        continue
      }
      if (!this.isWeaponInActiveParryWindow(defender.weapon)) continue

      if (
        checkOBBvsOBB(
          weaponX,
          weaponY,
          weaponWidth,
          weaponHeight,
          weaponRotation,
          defender.weapon.visual.x,
          defender.weapon.visual.y,
          defender.weapon.width,
          defender.weapon.height,
          defender.weapon.visual.rotation
        )
      ) {
        return true
      }
    }

    return false
  }

  private isWeaponInActiveParryWindow(weapon: Entity['weapon']): boolean {
    return (
      !!weapon &&
      weapon.attackPhase === 'block' &&
      weapon.isParrying &&
      weapon.parryElapsedTime >= PARRY_ACTIVE_START_FRAME
    )
  }

  private checkGroundCollision(
    weapon: Entity['weapon'],
    transform: WeaponTransform = weapon?.visual ?? this.tempTransform
  ): boolean {
    if (!weapon) return false
    if (this.checkGroundPlaneCollision(weapon, transform)) {
      return true
    }
    return this.checkStandableSurfaceCollision(weapon, transform)
  }

  private checkGroundPlaneCollision(
    weapon: WeaponComponent,
    transform: WeaponTransform
  ): boolean {
    const wy = transform.y
    const wWidth = weapon.width
    const wHeight = weapon.height
    const wRotation = transform.rotation
    const cos = Math.cos(wRotation)
    const sin = Math.sin(wRotation)
    const maxY =
      wy + (wWidth / 2) * Math.abs(sin) + (wHeight / 2) * Math.abs(cos)
    return maxY >= this.groundTopY
  }

  private checkStandableSurfaceCollision(
    weapon: WeaponComponent,
    transform: WeaponTransform
  ): boolean {
    if (this.standableSurfaces.length === 0) return false

    this.getWeaponBottomPoint(weapon, transform, this.tempWeaponBottomPoint)
    const pointX = this.tempWeaponBottomPoint.x
    const pointY = this.tempWeaponBottomPoint.y

    for (let i = 0; i < this.standableSurfaces.length; i++) {
      if (this.standableSurfaces[i].renderLayer !== weapon.renderLayer) {
        continue
      }
      if (
        this.isPointNearSurfaceTop(pointX, pointY, this.standableSurfaces[i])
      ) {
        return true
      }
    }

    return false
  }

  private getWeaponBottomPoint(
    weapon: WeaponComponent,
    transform: WeaponTransform,
    out: { x: number; y: number }
  ): void {
    const halfWidth = weapon.width / 2
    const halfHeight = weapon.height / 2
    const cos = Math.cos(transform.rotation)
    const sin = Math.sin(transform.rotation)
    const centerX = transform.x
    const centerY = transform.y
    let bottomX = centerX
    let bottomY = centerY

    for (let i = 0; i < 4; i++) {
      const localX = i === 0 || i === 3 ? -halfWidth : halfWidth
      const localY = i < 2 ? -halfHeight : halfHeight
      const worldX = centerX + localX * cos - localY * sin
      const worldY = centerY + localX * sin + localY * cos
      if (i === 0 || worldY > bottomY) {
        bottomX = worldX
        bottomY = worldY
      }
    }

    out.x = bottomX
    out.y = bottomY
  }

  private isPointNearSurfaceTop(
    x: number,
    y: number,
    surface: ObstacleCollider
  ): boolean {
    const SURFACE_HIT_TOLERANCE = 0.35
    const worldVertices = surface.worldVertices
    let topY: number | null = null

    if (worldVertices && worldVertices.length >= 2) {
      topY = this.findPolygonTopYAtX(worldVertices, x)
    } else if (surface.radius !== undefined && surface.radius > 0) {
      const dx = x - surface.centerX
      const radius = surface.radius
      if (dx < -radius || dx > radius) return false
      const remaining = radius * radius - dx * dx
      if (remaining < 0) return false
      topY = surface.centerY - Math.sqrt(remaining)
    } else {
      const left = surface.centerX - surface.width
      const right = surface.centerX + surface.width
      if (x < left || x > right) return false
      topY = surface.centerY - surface.height
    }

    return topY !== null && y >= topY && y <= topY + SURFACE_HIT_TOLERANCE
  }

  private findPolygonTopYAtX(
    vertices: { x: number; y: number }[],
    x: number
  ): number | null {
    let topY = 0
    let found = false

    for (let i = 0; i < vertices.length; i++) {
      const start = vertices[i]
      const end = vertices[(i + 1) % vertices.length]
      const minX = start.x < end.x ? start.x : end.x
      const maxX = start.x > end.x ? start.x : end.x
      if (x < minX || x > maxX) continue

      let edgeY = 0
      if (start.x === end.x) {
        edgeY = start.y < end.y ? start.y : end.y
      } else {
        const t = (x - start.x) / (end.x - start.x)
        if (t < 0 || t > 1) continue
        edgeY = start.y + (end.y - start.y) * t
      }

      if (!found || edgeY < topY) {
        topY = edgeY
        found = true
      }
    }

    return found ? topY : null
  }

  private tryEmitLandingCameraShake(
    entity: Entity,
    weapon: WeaponComponent
  ): void {
    if (!this.statsSystem || !entity.transform || !entity.render) return
    if (
      weapon.activeMoveId === 'hammer_strike_finisher' ||
      weapon.activeMoveId === 'sword_finisher'
    ) {
      return
    }
    weapon.attackStartedAirborne =
      weapon.attackStartedAirborne || !(entity.movement?.isGrounded ?? true)
    if (!weapon.attackStartedAirborne || weapon.landingShakeTriggered) return
    if (!this.checkGroundCollision(weapon)) return
    if (!this.isAttackShakeEligiblePhase(weapon.attackPhase)) return
    if (!this.isGroundImpactShakeTimingValid(entity)) return

    const impactX = entity.transform.x
    const impactY = entity.transform.y + (entity.render.radius || 0)

    if (this.isBigHammer(weapon)) {
      const isFinisher = weapon.activeMoveId === 'hammer_strike_finisher'
      this.statsSystem.emitCameraShake(
        impactX,
        impactY,
        isFinisher
          ? BIG_HAMMER_FINISHER_SHAKE_INTENSITY_PX
          : BIG_HAMMER_JUMP_SHAKE_INTENSITY_PX,
        isFinisher
          ? BIG_HAMMER_FINISHER_SHAKE_DURATION_MS
          : BIG_HAMMER_JUMP_SHAKE_DURATION_MS
      )
      weapon.landingShakeTriggered = true
      return
    }

    if (this.isGiantSword(weapon)) {
      const isFinisher = weapon.activeMoveId === 'sword_finisher'
      this.statsSystem.emitCameraShake(
        impactX,
        impactY,
        isFinisher
          ? GIANT_SWORD_FINISHER_SHAKE_INTENSITY_PX
          : GIANT_SWORD_JUMP_SHAKE_INTENSITY_PX,
        isFinisher
          ? GIANT_SWORD_FINISHER_SHAKE_DURATION_MS
          : GIANT_SWORD_JUMP_SHAKE_DURATION_MS
      )
      weapon.landingShakeTriggered = true
    }
  }

  private tryEmitCompletedFinalSwingCameraShake(
    entity: Entity,
    weapon: WeaponComponent
  ): void {
    if (!this.statsSystem || weapon.impactShakeTriggered) return
    if (!(entity.movement?.isGrounded ?? true)) return

    if (
      weapon.activeMoveId === 'hammer_strike_finisher' &&
      this.isBigHammer(weapon)
    ) {
      this.statsSystem.emitCameraShake(
        weapon.visual.x,
        weapon.visual.y,
        BIG_HAMMER_FINISHER_SHAKE_INTENSITY_PX,
        BIG_HAMMER_FINISHER_SHAKE_DURATION_MS
      )
      weapon.impactShakeTriggered = true
      return
    }

    if (weapon.activeMoveId === 'sword_finisher' && this.isGiantSword(weapon)) {
      this.statsSystem.emitCameraShake(
        weapon.visual.x,
        weapon.visual.y,
        GIANT_SWORD_FINISHER_SHAKE_INTENSITY_PX,
        GIANT_SWORD_FINISHER_SHAKE_DURATION_MS
      )
      weapon.impactShakeTriggered = true
    }
  }

  private isAttackShakeEligiblePhase(
    phase: WeaponComponent['attackPhase']
  ): boolean {
    return (
      phase === 'windup' ||
      phase === 'swing' ||
      phase === 'pause' ||
      phase === 'recover' ||
      phase === 'rebound'
    )
  }

  private isGroundImpactShakeTimingValid(entity: Entity): boolean {
    if (entity.movement?.isGrounded) return true
    return (entity.physics?.velY ?? 0) > 0
  }

  private getMoveKind(weapon: Entity['weapon']): AttackMoveData['kind'] {
    const move = this.getActiveMove(weapon)
    return move ? move.kind : 'slash'
  }

  setObstacles(obstacles: ObstacleCollider[]): void {
    this.obstacles = obstacles
  }

  setStandableSurfaces(surfaces: ObstacleCollider[]): void {
    this.standableSurfaces = surfaces
  }

  private retractWeaponOnDirectionChange(
    entity: Entity,
    weapon: Entity['weapon'],
    playerPos: { x: number; y: number }
  ): void {
    if (!weapon || !entity.input) return

    const newFacing =
      entity.input.lastMoveDirection !== 0
        ? entity.input.lastMoveDirection
        : weapon.attackFacing

    weapon.attackPhase = 'idle'
    weapon.attackElapsedMs = 0
    weapon.attackQueued = false
    weapon.attackFacing = newFacing
    weapon.comboCount = 0
    weapon.swingDirection = 'toFront'
    weapon.nextSwingDirection = 'toFront'
    weapon.hitEntityIds.clear()
    this.clearAttackImpactState(weapon)

    const radius = entity.render?.radius || DEFAULT_PLAYER_RADIUS
    getFrontTransform(
      playerPos,
      newFacing,
      weapon.visual,
      radius,
      weapon.weaponType,
      weapon.width
    )
  }

  private resetWeaponState(entity: Entity): void {
    if (!entity.weapon) return

    const weapon = entity.weapon
    this.destroyStaggerDropBody(weapon)
    weapon.attackQueued = false
    if (this.statsSystem) {
      this.statsSystem.exitCombat(entity)
    }
    weapon.attackPhase = 'idle'
    weapon.attackElapsedMs = 0
    weapon.isColliding = false
    weapon.isBlocking = false
    weapon.isParrying = false
    weapon.parryElapsedTime = 0
    weapon.isDropping = false
    weapon.isDropped = false
    weapon.isRecovering = false
    weapon.hitEntityIds.clear()
    weapon.width = weapon.baseWidth
    this.clearAttackImpactState(weapon)

    if (!entity.transform) return

    if (!weapon.isEquipped) {
      weapon.visual.x = weapon.position.x
      weapon.visual.y = weapon.position.y
      weapon.visual.rotation = weapon.rotation
      return
    }

    const facing =
      entity.input && entity.input.lastMoveDirection !== 0
        ? entity.input.lastMoveDirection
        : 1
    const radius = entity.render?.radius || DEFAULT_PLAYER_RADIUS
    this.tempPlayerPos.x = entity.transform.x
    this.tempPlayerPos.y = entity.transform.y
    setWeaponBackTransform(
      this.tempPlayerPos,
      facing,
      weapon.visual,
      radius,
      weapon.weaponType,
      weapon.width,
      getBodyHalfHeight(entity.render, radius)
    )
  }

  private createStaggerDropBody(
    weapon: WeaponComponent,
    x: number,
    y: number,
    initialVelX: number,
    initialVelY: number
  ): boolean {
    if (
      !this.box2d ||
      !this.worldId ||
      !this.dropBodyDef ||
      !this.dropShapeDef ||
      !this.dropCircle ||
      !this.tempVec
    ) {
      return false
    }

    const {
      b2CreateBody,
      b2BodyType,
      b2CreateCircleShape,
      b2Body_SetLinearVelocity,
    } = this.box2d

    const bodyDef = this.dropBodyDef
    bodyDef.type = b2BodyType.b2_dynamicBody
    bodyDef.position.Set(x, y)
    bodyDef.linearDamping = 2.0
    bodyDef.motionLocks.angularZ = true
    const bodyId = b2CreateBody(this.worldId, bodyDef)

    const circle = this.dropCircle
    circle.center.Set(0, 0)
    circle.radius = DEFAULT_WEAPON_HEIGHT * 0.4

    const shapeDef = this.dropShapeDef
    shapeDef.density = 0.5
    shapeDef.material.friction = 0.3
    shapeDef.material.restitution = 0
    shapeDef.filter.categoryBits = getWeaponCollisionCategory(
      weapon.renderLayer
    )
    shapeDef.filter.maskBits = getWeaponCollisionMask(weapon.renderLayer)
    b2CreateCircleShape(bodyId, shapeDef, circle)

    this.tempVec.x = initialVelX
    this.tempVec.y = initialVelY
    b2Body_SetLinearVelocity(bodyId, this.tempVec)
    weapon.staggerDropBodyId = bodyId
    return true
  }

  private destroyStaggerDropBody(weapon: WeaponComponent): void {
    if (!this.box2d || !weapon.staggerDropBodyId) {
      weapon.staggerDropBodyId = null
      return
    }

    this.box2d.b2DestroyBody(weapon.staggerDropBodyId)
    weapon.staggerDropBodyId = null
  }

  private syncStaggerDroppedWeapon(weapon: WeaponComponent): void {
    if (!this.box2d || !weapon.staggerDropBodyId) {
      return
    }

    const pos = this.box2d.b2Body_GetPosition(weapon.staggerDropBodyId)
    weapon.visual.x = pos.x
    weapon.visual.y = pos.y
    weapon.position.x = pos.x
    weapon.position.y = pos.y
    weapon.visual.rotation = weapon.dropEndTransform.rotation
    weapon.rotation = weapon.dropEndTransform.rotation
    pos.delete()
  }

  private updateStaggerDroppingWeapon(weapon: WeaponComponent): void {
    if (!this.box2d || !weapon.staggerDropBodyId) {
      weapon.isDropping = false
      weapon.isDropped = true
      weapon.visual.rotation = weapon.dropEndTransform.rotation
      weapon.position.x = weapon.visual.x
      weapon.position.y = weapon.visual.y
      weapon.rotation = weapon.visual.rotation
      return
    }

    const pos = this.box2d.b2Body_GetPosition(weapon.staggerDropBodyId)
    const velocity = this.box2d.b2Body_GetLinearVelocity(
      weapon.staggerDropBodyId
    )

    weapon.visual.x = pos.x
    weapon.visual.y = pos.y
    weapon.position.x = pos.x
    weapon.position.y = pos.y
    weapon.dropElapsedTime += this.currentDeltaTime

    const progress = clamp01(
      (weapon.dropElapsedTime * 1000) / WEAPON_DROP_DURATION_MS
    )
    weapon.visual.rotation =
      weapon.dropStartTransform.rotation +
      (weapon.dropEndTransform.rotation - weapon.dropStartTransform.rotation) *
        progress
    weapon.rotation = weapon.visual.rotation

    const speedSq = velocity.x * velocity.x + velocity.y * velocity.y
    if (
      speedSq <= STAGGER_DROP_SETTLE_SPEED_SQ &&
      weapon.dropElapsedTime >= STAGGER_DROP_SETTLE_MIN_TIME
    ) {
      weapon.isDropping = false
      weapon.isDropped = true
      weapon.visual.rotation = weapon.dropEndTransform.rotation
      weapon.rotation = weapon.dropEndTransform.rotation
    }

    pos.delete()
    velocity.delete()
  }

  private checkObstacleCollision(weapon?: Entity['weapon']): boolean {
    if (!weapon) return false
    if (this.obstacles.length === 0) return false
    const wx = weapon.visual.x
    const wy = weapon.visual.y
    const wWidth = weapon.width
    const wHeight = weapon.height
    const wRotation = weapon.visual.rotation

    for (const obstacle of this.obstacles) {
      if (obstacle.renderLayer !== weapon.renderLayer) {
        continue
      }
      const centerX = obstacle.centerX
      const centerY = obstacle.centerY
      const worldVertices = obstacle.worldVertices

      if (worldVertices) {
        // Polygon (SAT)
        if (
          checkOBBvsPolygon(wx, wy, wWidth, wHeight, wRotation, worldVertices)
        ) {
          return true
        }
      } else if (obstacle.radius !== undefined && obstacle.radius > 0) {
        // Circle
        if (
          checkOBBvsCircle(
            wx,
            wy,
            wWidth,
            wHeight,
            wRotation,
            centerX,
            centerY,
            obstacle.radius
          )
        ) {
          return true
        }
      } else {
        // AABB (Box optimization)
        const halfW = obstacle.width
        const halfH = obstacle.height

        if (
          checkOBBvsAABB(
            wx,
            wy,
            wWidth,
            wHeight,
            wRotation,
            centerX,
            centerY,
            halfW,
            halfH
          )
        ) {
          return true
        }
      }
    }

    return false
  }

  private applyPushback(entity: Entity, weapon: Entity['weapon']): void {
    if (!this.statsSystem || !weapon) return

    const dirX = Math.cos(weapon.visual.rotation)
    const dirY = Math.sin(weapon.visual.rotation)
    const impulseStrength = 0.2
    this.statsSystem.applyImpulse(
      entity,
      -dirX * impulseStrength,
      -dirY * impulseStrength
    )
  }

  private checkEntityHits(attacker: Entity, weapon: Entity['weapon']): void {
    if (!this.statsSystem) return
    if (!attacker.transform || !attacker.faction) return
    if (!weapon || !weapon.hitEntityIds) return
    if (!weapon.isEquipped) return

    const weaponX = weapon.visual.x
    const weaponY = weapon.visual.y
    const weaponWidth = weapon.width
    const weaponHeight = weapon.height
    const weaponRotation = weapon.visual.rotation

    // 使用攻击半径进行宽阶段检测优化
    const attackRadius =
      weapon.attackRadius !== 0
        ? weapon.attackRadius
        : this.getAttackRadius(attacker)
    const segmentedQueryRadius =
      this.spineSegmentManager?.getMaxActiveCoverageRadius() ?? 0

    const nearbyEntities = this.spatialHash
      ? this.spatialHash.query(
          weaponX,
          weaponY,
          attackRadius + 2 + segmentedQueryRadius
        )
      : this.allEntities
    const nearbyCount = this.spatialHash
      ? this.spatialHash.getQueryResultLength()
      : nearbyEntities.length
    const attackerLayer = attacker.render?.renderLayer ?? weapon.renderLayer

    for (let i = 0; i < nearbyCount; i++) {
      const target = nearbyEntities[i]
      if (!target || target.id === attacker.id) continue
      if (!target.transform || !target.stats || target.stats.isDead) continue
      if ((target.render?.renderLayer ?? 0) !== attackerLayer) continue
      if (
        !target.faction ||
        !attacker.faction.canAttackEntity(target.faction, target.id.toString())
      )
        continue

      const targetRadius = target.render?.radius ?? DEFAULT_PLAYER_RADIUS
      const segmentedCoverageRadius =
        this.spineSegmentManager?.getEntityCoverageRadius(target) ?? 0
      const collisionRadius =
        segmentedCoverageRadius > 0 ? segmentedCoverageRadius : targetRadius

      const hitRange = attackRadius + collisionRadius
      const dx = weaponX - target.transform.x
      const dy = weaponY - target.transform.y
      if (dx * dx + dy * dy > hitRange * hitRange) continue

      if (weapon.hitEntityIds.has(target.id)) continue

      const isSegmentHit =
        segmentedCoverageRadius > 0 &&
        this.spineSegmentManager?.testWeaponHit(
          target.id,
          weaponX,
          weaponY,
          weaponWidth,
          weaponHeight,
          weaponRotation
        ) === true

      const isCircleHit =
        segmentedCoverageRadius <= 0 &&
        checkOBBvsCircle(
          weaponX,
          weaponY,
          weaponWidth,
          weaponHeight,
          weaponRotation,
          target.transform.x,
          target.transform.y,
          targetRadius
        )

      if (isSegmentHit || isCircleHit) {
        this.tempHitSource.x = weaponX
        this.tempHitSource.y = weaponY
        this.statsSystem.applyWeaponHit(
          target,
          weapon,
          this.tempHitSource,
          attacker
        )
        weapon.isColliding = true
        weapon.hitEntityIds.add(target.id)
      }
    }
  }

  private startRebound(
    entity: Entity,
    playerPos: { x: number; y: number },
    now: number,
    collisionSource: 'weapon' | 'obstacle' = 'weapon'
  ): void {
    if (!entity.weapon) return
    const weapon = entity.weapon
    const radius =
      weapon.attackRadius !== 0
        ? weapon.attackRadius
        : this.getAttackRadius(entity)

    // Rebound should return to the windup start pose, not the swing entry pose.
    // For thrust attacks, using swingStart makes the retract distance too short.
    getOffsetFromTransform(
      weapon.attackStartTransform,
      playerPos,
      weapon.reboundTargetOffset
    )

    // reboundTargetTransform is WeaponTransform
    applyOffset(
      weapon.reboundTargetOffset,
      playerPos,
      weapon.reboundTargetTransform
    )

    weapon.attackPhase = 'rebound'
    weapon.attackElapsedMs = 0
    weapon.attackQueued = false
    weapon.reboundLockedPause = true

    // update attackStartOffset/swingStartOffset with current visual pos
    getOffsetFromTransform(weapon.visual, playerPos, weapon.attackStartOffset)
    getOffsetFromTransform(weapon.visual, playerPos, weapon.swingStartOffset)

    copyRelativeTransform(weapon.swingEndOffset, weapon.reboundTargetOffset)

    copyTransform(weapon.attackStartTransform, weapon.visual)
    copyTransform(weapon.swingStartTransform, weapon.visual)
    copyTransform(weapon.swingEndTransform, weapon.reboundTargetTransform)

    weapon.lastAttackTimestamp = now
    weapon.hitEntityIds.clear()
    weapon.attackCollisionSource = collisionSource
    weapon.groundHitSoundTriggered = true
    weapon.groundHitSoundPending = 0
  }

  private handleReboundPhase(
    entity: Entity,
    weapon: Entity['weapon'],
    playerPos: { x: number; y: number },
    now: number
  ): void {
    if (!weapon) return

    // Allow canceling rebound with block
    if (entity.input && entity.input.blockRequested) {
      if (entity.movement) {
        entity.movement.knockbackDuration = 0
      }
      this.interruptWindupToBlock(entity, playerPos, weapon.attackFacing)
      return
    }

    const reboundDurationMs = this.getSwingMs(weapon) * 0.8
    const t = clamp01(weapon.attackElapsedMs / reboundDurationMs)

    lerpRelativeTransform(
      weapon.swingStartOffset,
      weapon.reboundTargetOffset,
      t,
      this.tempRelativeTransform
    )
    applyOffset(this.tempRelativeTransform, playerPos, weapon.visual)

    if (t >= 1) {
      weapon.attackPhase = 'pause'
      this.restoreDamageOverrides(weapon)
      weapon.attackElapsedMs = 0
      getOffsetFromTransform(weapon.visual, playerPos, weapon.attackStartOffset)
      copyTransform(weapon.attackStartTransform, weapon.visual)
      weapon.lastAttackTimestamp = now
    }
  }

  private handleHammerCritPhases(
    entity: Entity,
    weapon: Entity['weapon'],
    playerPos: { x: number; y: number },
    deltaMs: number
  ): void {
    if (!weapon) return

    const radius = entity.render?.radius ?? DEFAULT_PLAYER_RADIUS
    const facing = weapon.skillFacing
    const baseWidth = weapon.baseWidth
    const halfLen = (baseWidth / 2) | 0
    const chestY = playerPos.y - radius * 0.4

    const backX = playerPos.x - facing * (radius + halfLen * 0.6)
    const backRot = facing === 1 ? Math.PI : 0

    const frontX = playerPos.x + facing * (radius + halfLen * 0.9)
    const frontRot = facing === 1 ? 0 : Math.PI

    weapon.skillElapsedMs += deltaMs

    if (weapon.skillPhase === 'hammer_crit_windup') {
      const t = clamp01(weapon.skillElapsedMs / HAMMER_CRIT_WINDUP_MS)
      const startX = weapon.attackStartTransform.x
      const startY = weapon.attackStartTransform.y
      const startRot = weapon.attackStartTransform.rotation
      weapon.visual.x = startX + (backX - startX) * t
      weapon.visual.y = startY + (chestY - startY) * t
      weapon.visual.rotation = startRot + (backRot - startRot) * t

      if (weapon.skillElapsedMs >= HAMMER_CRIT_WINDUP_MS) {
        weapon.skillPhase = 'hammer_crit_swing'
        weapon.skillElapsedMs = 0
        weapon.hitEntityIds.clear()
        weapon.originalAttackDamage = weapon.attackDamage
        weapon.attackDamage = Math.floor((weapon.attackDamage * 6) / 5)
        weapon.originalPostureDamage = weapon.postureDamage
        weapon.postureDamage = Math.floor((weapon.postureDamage * 6) / 5)
        weapon.originalToughnessDamage = weapon.toughnessDamage
        weapon.toughnessDamage = Math.floor((weapon.toughnessDamage * 6) / 5)
        weapon.impactLevel = 'extreme'
      }
      return
    }

    if (weapon.skillPhase === 'hammer_crit_swing') {
      const t = clamp01(weapon.skillElapsedMs / HAMMER_CRIT_SWING_MS)
      weapon.visual.x = backX + (frontX - backX) * t
      weapon.visual.y = chestY
      weapon.visual.rotation = backRot + (frontRot - backRot) * t

      const minWidth = weapon.height
      weapon.width =
        minWidth + (baseWidth - minWidth) * (1 - Math.sin(t * Math.PI))

      const prevHitCount = weapon.hitEntityIds.size
      this.checkEntityHits(entity, weapon)
      if (weapon.hitEntityIds.size > prevHitCount) {
        // 发射点在锤头前缘（朝向一侧半幅宽处）
        const headEdgeX = weapon.visual.x + facing * (baseWidth / 2)
        this.statsSystem?.emitHammerCritHit(headEdgeX, weapon.visual.y)
      }

      if (weapon.skillElapsedMs >= HAMMER_CRIT_SWING_MS) {
        this.restoreDamageOverrides(weapon)
        weapon.width = baseWidth
        weapon.skillPhase = 'hammer_crit_recover'
        weapon.skillElapsedMs = 0
        weapon.attackStartTransform.x = frontX
        weapon.attackStartTransform.y = chestY
        weapon.attackStartTransform.rotation = frontRot
      }
      return
    }

    if (weapon.skillPhase === 'hammer_crit_recover') {
      const t = clamp01(weapon.skillElapsedMs / HAMMER_CRIT_RECOVER_MS)
      getFrontTransform(
        playerPos,
        facing,
        this.tempTransform,
        radius,
        weapon.weaponType,
        weapon.width
      )
      const startX = weapon.attackStartTransform.x
      const startY = weapon.attackStartTransform.y
      const startRot = weapon.attackStartTransform.rotation
      weapon.visual.x = startX + (this.tempTransform.x - startX) * t
      weapon.visual.y = startY + (this.tempTransform.y - startY) * t
      weapon.visual.rotation =
        startRot + (this.tempTransform.rotation - startRot) * t

      if (weapon.skillElapsedMs >= HAMMER_CRIT_RECOVER_MS) {
        weapon.skillPhase = null
        weapon.skillElapsedMs = 0
        weapon.hitEntityIds.clear()
      }
    }
  }
}
