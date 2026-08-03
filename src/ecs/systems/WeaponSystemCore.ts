import {
  DEBUG_ANIMATION_SLOWDOWN,
  DEFAULT_PLAYER_RADIUS,
  SOUND_DB_BIG_HAMMER_HIT_ROCK,
  SOUND_DB_HEAVY_SWORD_HIT_GROUND,
  WEAPON_DROP_DURATION_MS,
} from '../../constants'
import { getPlayerAgilityScalePercent } from '../../playerUpgrade'
import type { MainModule } from '../../types'
import { isRangedWeaponType } from '../../weaponTypeUtils'
import { SOUND_IDS } from '../../worker/effectsProtocol'
import type { ArrowPools } from '../ArrowPools'
import type { AttackMoveData, ImpactLevel } from '../AttackMoveData'
import type { WeaponRelativeTransform, WeaponTransform } from '../Component'
import { WeaponComponent } from '../Component'
import { componentRegistry } from '../ComponentRegistry'
import type { Entity } from '../Entity'
import type { SkeletalSegmentManager } from '../SkeletalSegmentManager'
import type { SpatialHash } from '../SpatialHash'
import { System } from '../System'
import {
  applyOffset,
  copyTransform,
  getFrontTransform,
  getOffsetFromTransform,
  lerpRelativeTransform,
  setWeaponBackTransform,
} from '../WeaponPoseUtils'
import type { World } from '../World'
import type { RopeCircleHitRequest, RopeHitRequest } from './GrappleSystem'
import { SkillHandler } from './SkillHandler'
import type { SoundSystem } from './SoundSystem'
import type { StatsSystem } from './StatsSystem'
import {
  type BreakableObstacleCircleHitRequest,
  type BreakableObstacleOBBHitRequest,
  type TerrainImpactCallback,
  UltimateHandler,
} from './UltimateHandler'
import {
  BreakableObstacleHit,
  ObstacleCollider,
  WeaponDropData,
  getBodyHalfHeight,
} from './WeaponSystemShared'

export abstract class WeaponSystemCore extends System {
  protected box2d?: MainModule
  protected obstacles: ObstacleCollider[] = []
  protected standableSurfaces: ObstacleCollider[] = []
  protected statsSystem?: StatsSystem
  protected soundSystem: SoundSystem | null = null
  protected allEntities: Entity[] = []
  protected spatialHash: SpatialHash | null = null
  protected entityLookup?: (id: number) => Entity | undefined
  protected tempVec?: InstanceType<MainModule['b2Vec2']>
  protected rayStart?: InstanceType<MainModule['b2Vec2']>
  protected rayTranslation?: InstanceType<MainModule['b2Vec2']>
  protected rayFilter?: ReturnType<MainModule['b2DefaultQueryFilter']>
  protected arrowBodyDef?: ReturnType<MainModule['b2DefaultBodyDef']>
  protected arrowShapeDef?: ReturnType<MainModule['b2DefaultShapeDef']>
  protected arrowCircle?: InstanceType<MainModule['b2Circle']>
  protected dropBodyDef?: ReturnType<MainModule['b2DefaultBodyDef']>
  protected dropShapeDef?: ReturnType<MainModule['b2DefaultShapeDef']>
  protected dropCircle?: InstanceType<MainModule['b2Circle']>
  protected world?: World
  protected worldId?: ReturnType<MainModule['b2CreateWorld']>
  protected groundTopY = 0
  protected viewportWidth = 16
  protected viewportHeight = 9
  protected arrowPools?: ArrowPools
  protected skeletalSegmentManager: SkeletalSegmentManager | null = null
  protected onBreakableObstacleHit:
    | ((hit: BreakableObstacleHit) => void)
    | null = null
  protected onRopeHit: ((hit: RopeHitRequest) => boolean) | null = null
  protected onRopeCircleHit: ((hit: RopeCircleHitRequest) => boolean) | null =
    null

  protected tempTransform: WeaponTransform = { x: 0, y: 0, rotation: 0 }
  protected tempSweptWeaponTransform: WeaponTransform = {
    x: 0,
    y: 0,
    rotation: 0,
  }
  protected tempRelativeTransform: WeaponRelativeTransform = {
    dx: 0,
    dy: 0,
    rotation: 0,
  }
  protected tempTargetRelativeTransform: WeaponRelativeTransform = {
    dx: 0,
    dy: 0,
    rotation: 0,
  }
  protected tempWeaponDropData: WeaponDropData = {
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
  protected readonly tempRopeHitRequest: RopeHitRequest = {
    centerX: 0,
    centerY: 0,
    width: 0,
    height: 0,
    rotation: 0,
    renderLayer: 0,
    impactX: 0,
    impactY: 0,
    damage: 1,
    hitDirX: 0,
    hitDirY: 0,
  }
  protected readonly tempRopeCircleHitRequest: RopeCircleHitRequest = {
    centerX: 0,
    centerY: 0,
    radius: 0,
    renderLayer: 0,
    impactX: 0,
    impactY: 0,
    damage: 1,
    hitDirX: 0,
    hitDirY: 0,
  }
  protected tempPlayerPos = { x: 0, y: 0 }
  protected tempHitSource = { x: 0, y: 0 }
  protected tempWeaponBottomPoint = { x: 0, y: 0 }
  protected currentDeltaTime = 0
  protected currentTimeMs = 0
  protected readonly ultimateHandler = new UltimateHandler()
  protected readonly skillHandler = new SkillHandler()
  protected terrainImpactCallback?: TerrainImpactCallback

  protected abstract handleBreakableObstacleOBBHit(
    request: BreakableObstacleOBBHitRequest
  ): void
  protected abstract handleBreakableObstacleCircleHit(
    request: BreakableObstacleCircleHitRequest
  ): void
  protected abstract updateBombProjectile(entity: Entity, deltaMs: number): void
  protected abstract updateDroppingWeapon(entity: Entity): void
  protected abstract resetWeaponState(entity: Entity): void
  protected abstract emitSoundAt(
    x: number,
    y: number,
    source: Entity,
    db: number,
    rangeMultiplier?: number
  ): void
  protected abstract handleHammerCritPhases(
    entity: Entity,
    weapon: Entity['weapon'],
    playerPos: { x: number; y: number },
    deltaMs: number
  ): void
  protected abstract handleAssassinationPhases(
    attacker: Entity,
    weapon: WeaponComponent,
    deltaMs: number
  ): void
  protected abstract clearAssassinationAvailability(entity: Entity): void
  protected abstract clearAttackImpactState(weapon: Entity['weapon']): void
  protected abstract beginAttackImpactState(
    entity: Entity,
    weapon: WeaponComponent
  ): void
  protected abstract updateStaggerDroppingWeapon(
    weapon: WeaponComponent,
    playerPos: { x: number; y: number }
  ): void
  protected abstract syncStaggerDroppedWeapon(
    weapon: WeaponComponent,
    playerPos: { x: number; y: number }
  ): void
  protected abstract startWeaponRecover(entity: Entity): void
  protected abstract tryEmitLandingCameraShake(
    entity: Entity,
    weapon: WeaponComponent
  ): void
  protected abstract updateBombWeapon(
    entity: Entity,
    weapon: WeaponComponent,
    playerPos: { x: number; y: number },
    facing: number,
    deltaMs: number
  ): void
  protected abstract updateBowWeapon(
    entity: Entity,
    weapon: WeaponComponent,
    playerPos: { x: number; y: number },
    facing: number,
    deltaMs: number
  ): void
  protected abstract updateAssassinationAvailability(entity: Entity): void
  protected abstract getAttackRadius(entity: Entity): number
  protected abstract startBlock(
    entity: Entity,
    playerPos: { x: number; y: number },
    facing: number
  ): void
  protected abstract handleIdlePhase(
    entity: Entity,
    playerPos: { x: number; y: number },
    attackRadius: number,
    attackFacing: number,
    now: number
  ): void
  protected abstract handleBlockPhase(
    entity: Entity,
    playerPos: { x: number; y: number },
    facing: number
  ): void
  protected abstract handleBlockReturnPhase(
    entity: Entity,
    playerPos: { x: number; y: number },
    facing: number
  ): void
  protected abstract resetWeaponToCombatIdle(
    entity: Entity,
    playerPos: { x: number; y: number },
    facing: number
  ): void
  protected abstract resetAssassinationState(
    entity: Entity,
    clearTargetId: boolean
  ): void
  protected abstract handleWindupPhase(
    entity: Entity,
    weapon: Entity['weapon']
  ): void
  protected abstract handleSwingPhase(
    entity: Entity,
    playerPos: { x: number; y: number },
    now: number
  ): void
  protected abstract handleReboundPhase(
    entity: Entity,
    weapon: Entity['weapon'],
    playerPos: { x: number; y: number },
    now: number
  ): void
  protected abstract handlePausePhase(
    entity: Entity,
    playerPos: { x: number; y: number },
    attackRadius: number,
    attackFacing: number,
    now: number
  ): void
  protected abstract handleRecoverPhase(
    entity: Entity,
    playerPos: { x: number; y: number },
    now: number
  ): void
  protected abstract destroyStaggerDropBody(weapon: WeaponComponent): void
  protected abstract createStaggerDropBody(
    weapon: WeaponComponent,
    x: number,
    y: number,
    initialVelX: number,
    initialVelY: number
  ): boolean
  protected abstract setStaggerDropTransform(
    entity: Entity,
    weapon: WeaponComponent,
    playerPos: { x: number; y: number },
    out: WeaponTransform
  ): void
  abstract startAttack(entity: Entity, movesetIdOverride?: string): void
  protected abstract resetAttackStateForInterrupt(
    weapon: Entity['weapon']
  ): void
  protected abstract startRebound(
    entity: Entity,
    playerPos: { x: number; y: number },
    now: number,
    collisionSource?: 'weapon' | 'obstacle'
  ): void
  protected abstract checkObstacleCollision(
    attacker: Entity,
    weapon?: Entity['weapon'],
    previousWeaponX?: number,
    previousWeaponY?: number,
    previousWeaponRotation?: number
  ): ObstacleCollider | null
  protected abstract checkEntityHits(
    attacker: Entity,
    weapon: Entity['weapon']
  ): number
  protected abstract applyPushback(
    entity: Entity,
    weapon: Entity['weapon']
  ): void
  protected abstract shouldSkipObstacleRebound(
    weapon: WeaponComponent,
    obstacle: ObstacleCollider
  ): boolean
  protected abstract finishObstacleHitWithoutRebound(
    weapon: WeaponComponent,
    playerPos: { x: number; y: number },
    now: number
  ): void
  protected abstract tryQueueHeavyGroundHitSound(
    entity: Entity,
    weapon: WeaponComponent
  ): void
  protected abstract tryEmitCompletedFinalSwingCameraShake(
    entity: Entity,
    weapon: WeaponComponent
  ): void
  protected abstract enterAttackPause(
    weapon: WeaponComponent,
    playerPos: { x: number; y: number },
    now: number
  ): void
  protected abstract removeDepletedConsumable(
    entity: Entity,
    weapon: WeaponComponent
  ): void
  protected abstract retractWeaponOnDirectionChange(
    entity: Entity,
    weapon: Entity['weapon'],
    playerPos: { x: number; y: number }
  ): void
  protected abstract getDefaultMovesetIdForWeaponType(
    weaponType: WeaponComponent['weaponType']
  ): string
  protected abstract hitBreakableObstaclesInCircle(
    centerX: number,
    centerY: number,
    radius: number,
    renderLayer: number,
    impactLevel: ImpactLevel,
    impactX: number,
    impactY: number,
    attacker?: Entity,
    weapon?: WeaponComponent,
    hitDirX?: number,
    hitDirY?: number
  ): void
  protected abstract hitTerrainDebrisInCircle(
    centerX: number,
    centerY: number,
    radius: number,
    renderLayer: number,
    impactLevel: ImpactLevel,
    impactX?: number,
    impactY?: number,
    weapon?: WeaponComponent
  ): void
  protected abstract hitTerrainDebrisInOBB(
    centerX: number,
    centerY: number,
    width: number,
    height: number,
    rotation: number,
    renderLayer: number,
    impactLevel: ImpactLevel,
    impactX?: number,
    impactY?: number,
    weapon?: WeaponComponent
  ): void
  protected abstract getMoveKind(
    weapon: Entity['weapon']
  ): AttackMoveData['kind']

  interruptForHitStun(entity: Entity): void {
    const weapon = entity.weapon
    if (!weapon) return

    if (!entity.stats?.assassinationLocked) {
      this.resetAssassinationState(entity, true)
    }

    weapon.width = weapon.baseWidth
    const inputDirection = entity.input?.lastMoveDirection ?? 0
    const facing =
      inputDirection !== 0 ? inputDirection : weapon.attackFacing || 1
    if (entity.transform) {
      this.tempPlayerPos.x = entity.transform.x
      this.tempPlayerPos.y = entity.transform.y
      this.resetWeaponToCombatIdle(entity, this.tempPlayerPos, facing)
    } else {
      this.resetAttackStateForInterrupt(weapon)
      weapon.attackPhase = 'idle'
    }

    weapon.attackElapsedMs = 0
    weapon.attackQueued = false
    weapon.isColliding = false
    weapon.isBlocking = false
    weapon.isParrying = false
    weapon.parryElapsedTime = 0
    weapon.parryCounterActive = false
    weapon.reboundLockedPause = false
    weapon.isUnstoppable = false
    weapon.hitEntityIds.clear()
    weapon.parryHitWeaponIds.clear()
    weapon.hitBreakableObstacleIds.clear()
    weapon.hitRopeIds.clear()

    weapon.bowIsDrawing = false
    weapon.bowDrawElapsedMs = 0
    weapon.bowDrawRatio = 0
    weapon.bowForceRatio = 0
    weapon.bowReleaseRatio = 0
    weapon.bowReleasePending = false
    weapon.bowReleaseDelayMs = 0
    weapon.bowReleaseDelayTotalMs = 0
    weapon.bowRecoverElapsedMs = 0
    weapon.bowHasAim = false
    weapon.bowFreeAim = false
    weapon.bowFreeAimReticleX = 0
    weapon.bowFreeAimReticleY = 0
    weapon.bowFreeAimUseMouse = false
    weapon.bowFreeAimUseReticle = false
    weapon.bowFreeAimReticleOffsetX = 0
    weapon.bowFreeAimReticleOffsetY = 0

    if (weapon.bombState === 'throw_windup') {
      weapon.bombState = 'lit'
      weapon.bombThrowWindupElapsedMs = 0
      weapon.bombThrowVelocityX = 0
      weapon.bombThrowVelocityY = 0
      weapon.bombThrowAimAngle = 0
    }

    weapon.ultimatePhase = null
    weapon.ultimateElapsedMs = 0
    weapon.ultimateGiantRise100 = 0
    weapon.ultimateGiantAlpha100 = 0
    weapon.ultimateDamageDealt = false
    weapon.ultimateHammerJumpOffsetY = 0
    weapon.ultimateHammerVisualDX = 0
    weapon.ultimateHammerApexX = 0
    weapon.ultimateHammerPhysicalFallStarted = false
    weapon.ultimateHammerPhysicalFallStartY = 0
    weapon.ultimateHammerImpact100 = 0
    weapon.ultimateSpearAlpha100 = 0
    weapon.skillPhase = null
    weapon.skillElapsedMs = 0
    weapon.assassinationPhase = null
    weapon.assassinationElapsedMs = 0
    weapon.assassinationTargetId = 0
    weapon.assassinationImpactApplied = false
    weapon.assassinationKillApplied = false
    weapon.hitSoundPlaybackRate = 1

    if (entity.stats) {
      entity.stats.isInvincible = false
    }
    if (entity.input) {
      entity.input.attackRequested = false
      entity.input.blockRequested = false
      entity.input.skillRequested = false
      entity.input.ultimateRequested = false
      entity.input.inputBuffer.clearAction('attack')
      if (!entity.stats?.assassinationLocked) {
        entity.input.facingOverride = null
      }
    }
  }

  protected isHitStunActive(entity: Entity): boolean {
    const movement = entity.movement
    if (!movement || movement.knockbackDuration <= 0) return false
    return movement.knockbackElapsedTime * 1000 < movement.knockbackDuration
  }

  protected hasHitStunInterruptibleAction(weapon: WeaponComponent): boolean {
    return (
      weapon.attackPhase !== 'idle' ||
      weapon.attackQueued ||
      weapon.isColliding ||
      weapon.isBlocking ||
      weapon.isParrying ||
      weapon.reboundLockedPause ||
      weapon.bowIsDrawing ||
      weapon.bowReleasePending ||
      weapon.bowRecoverElapsedMs > 0 ||
      weapon.bombState === 'throw_windup' ||
      weapon.ultimatePhase !== null ||
      weapon.skillPhase !== null ||
      weapon.assassinationPhase !== null
    )
  }

  protected syncHitStunIdlePose(
    entity: Entity,
    weapon: WeaponComponent,
    playerPos: { x: number; y: number },
    facing: number
  ): void {
    if (!weapon.isEquipped) {
      weapon.visual.x = weapon.position.x
      weapon.visual.y = weapon.position.y
      weapon.visual.rotation = weapon.rotation
      return
    }

    const radius = entity.render?.radius || DEFAULT_PLAYER_RADIUS
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
        getBodyHalfHeight(entity.render, radius)
      )
    }
  }

  constructor(box2d?: MainModule, statsSystem?: StatsSystem) {
    super()
    this.box2d = box2d
    this.statsSystem = statsSystem
    this.ultimateHandler.setBreakableObstacleHitHandlers(
      (request) => {
        this.handleBreakableObstacleOBBHit(request)
      },
      (request) => {
        this.handleBreakableObstacleCircleHit(request)
      }
    )
    if (statsSystem) {
      this.ultimateHandler.setStatsSystem(statsSystem)
    }
    if (box2d) {
      this.tempVec = new box2d.b2Vec2(0, 0)
      this.rayStart = new box2d.b2Vec2(0, 0)
      this.rayTranslation = new box2d.b2Vec2(0, 0)
      this.rayFilter = box2d.b2DefaultQueryFilter()
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
    this.ultimateHandler.setViewportSize(viewportWidth, viewportHeight)
  }

  setArrowPools(arrowPools: ArrowPools): void {
    this.arrowPools = arrowPools
  }

  setSoundSystem(soundSystem: SoundSystem): void {
    this.soundSystem = soundSystem
  }

  setSkeletalSegmentManager(
    skeletalSegmentManager: SkeletalSegmentManager | null
  ): void {
    this.skeletalSegmentManager = skeletalSegmentManager
  }

  setTerrainImpactCallback(
    terrainImpactCallback: TerrainImpactCallback | undefined
  ): void {
    this.terrainImpactCallback = terrainImpactCallback
    this.ultimateHandler.setTerrainImpactCallback(terrainImpactCallback)
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

      if (
        !entity.stats &&
        entity.weapon &&
        entity.transform &&
        entity.weapon.weaponType === 'bomb' &&
        entity.weapon.bombState === 'projectile'
      ) {
        this.updateBombProjectile(entity, deltaMs)
        continue
      }

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
    copyTransform(weapon.dropStartTransform, weapon.visual)

    this.tempPlayerPos.x = entity.transform.x
    this.tempPlayerPos.y = entity.transform.y
    const playerPos = this.tempPlayerPos
    getOffsetFromTransform(weapon.visual, playerPos, weapon.dropStartOffset)

    this.setStaggerDropTransform(entity, weapon, playerPos, this.tempTransform)
    copyTransform(weapon.dropEndTransform, this.tempTransform)
    getOffsetFromTransform(this.tempTransform, playerPos, weapon.dropEndOffset)

    const initialVelX = entity.physics?.velX ?? 0
    const initialVelY = entity.physics?.velY ?? 0
    if (
      !this.createStaggerDropBody(
        weapon,
        weapon.visual.x,
        weapon.visual.y,
        initialVelX,
        initialVelY
      )
    ) {
      weapon.isDropping = false
      weapon.isDropped = true
      applyOffset(weapon.dropEndOffset, playerPos, weapon.visual)
      weapon.position.x = weapon.visual.x
      weapon.position.y = weapon.visual.y
      weapon.rotation = weapon.visual.rotation
    }
  }

  protected updateWeapon(entity: Entity, deltaMs: number): void {
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

    if (!entity.stats?.isStaggered && this.isHitStunActive(entity)) {
      if (this.hasHitStunInterruptibleAction(weapon)) {
        this.interruptForHitStun(entity)
      }
      this.syncHitStunIdlePose(entity, weapon, playerPos, inputFacing)
      return
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

    if (weapon.assassinationPhase !== null) {
      this.handleAssassinationPhases(entity, weapon, deltaMs)
      return
    }

    if (!weapon.isEquipped) {
      this.clearAssassinationAvailability(entity)
      weapon.visual.x = weapon.position.x
      weapon.visual.y = weapon.position.y
      weapon.visual.rotation = weapon.rotation
      this.clearAttackImpactState(weapon)
      return
    }

    if (weapon.isDropping) {
      this.clearAssassinationAvailability(entity)
      this.updateStaggerDroppingWeapon(weapon, playerPos)
      this.clearAttackImpactState(weapon)
      return
    }

    if (entity.stats?.isStaggered) {
      this.clearAssassinationAvailability(entity)
      if (weapon.isDropped) {
        this.syncStaggerDroppedWeapon(weapon, playerPos)
      }
      this.clearAttackImpactState(weapon)
      return
    }

    if (weapon.isDropped && !weapon.isRecovering) {
      this.startWeaponRecover(entity)
    }

    if (weapon.isRecovering) {
      this.clearAssassinationAvailability(entity)
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
      weapon.position.x = weapon.visual.x
      weapon.position.y = weapon.visual.y
      weapon.rotation = weapon.visual.rotation

      if (progress >= 1) {
        weapon.isRecovering = false
        weapon.isDropped = false
      }
      this.clearAttackImpactState(weapon)
      return
    }

    this.tryEmitLandingCameraShake(entity, weapon)

    if (weapon.weaponType === 'bomb') {
      this.clearAssassinationAvailability(entity)
      this.updateBombWeapon(entity, weapon, playerPos, inputFacing, deltaMs)
      return
    }

    if (isRangedWeaponType(weapon.weaponType) && entity.stats) {
      this.clearAssassinationAvailability(entity)
      this.updateBowWeapon(entity, weapon, playerPos, inputFacing, deltaMs)
      return
    }

    this.updateAssassinationAvailability(entity)

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
}
