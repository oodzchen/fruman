import {
  getCharacterBodyHalfHeight,
  getCharacterBodyHalfWidth,
  getCharacterEyeOffsetX,
  getCharacterEyeOffsetY,
} from '../../characterBodyProfile'
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
  DEFAULT_PLAYER_FOV_RAD,
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
  SOUND_RANGE_MULTIPLIER_MASSIVE,
  SOUND_RANGE_MULTIPLIER_WEAPON,
  WEAPON_DEFAULT_DATA,
  WEAPON_DROP_DURATION_MS,
  WEAPON_IMPACT_LEVEL,
} from '../../constants'
import {
  getEnemyCollisionCategory,
  getEnvironmentCollisionMask,
  getPlayerCollisionCategory,
  getWeaponCollisionCategory,
  getWeaponCollisionMask,
} from '../../physicsLayers'
import { getPlayerAgilityScalePercent } from '../../playerUpgrade'
import type {
  TerrainMaterialId,
  TerrainMaterialTag,
} from '../../terrain/TerrainTypes'
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
  isConsumableWeaponType,
  isRangedAttackWeaponVisualType,
  isRangedWeaponType,
  isSecondaryWeaponType,
  resolveWeaponStatsForSize,
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
import type { SkeletalSegmentManager } from '../SkeletalSegmentManager'
import type { SpatialHash } from '../SpatialHash'
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
import { showEntityHud } from '../hudVisibility'
import type { RopeCircleHitRequest, RopeHitRequest } from './GrappleSystem'
import { SkillHandler } from './SkillHandler'
import type { SoundSystem } from './SoundSystem'
import type { StatsSystem } from './StatsSystem'
import {
  type BreakableObstacleCircleHitRequest,
  type BreakableObstacleOBBHitRequest,
  HAMMER_AOE_RADIUS,
  type TerrainImpactCallback,
  UltimateHandler,
} from './UltimateHandler'
import { WeaponCollisionSystem } from './WeaponCollisionSystem'
import {
  ASSASSINATION_CAMERA_SHAKE_DURATION_MS,
  ASSASSINATION_CAMERA_SHAKE_INTENSITY_PX,
  ASSASSINATION_DEATH_SOUND_PLAYBACK_RATE,
  ASSASSINATION_FIXED_RANGE,
  ASSASSINATION_RECOVER_MS,
  ASSASSINATION_SOUND_PLAYBACK_RATE,
  ASSASSINATION_STRIKE_MS,
  ASSASSINATION_THRUST_ANGLE_RAD,
  ASSASSINATION_TOTAL_DURATION_MS,
  ASSASSINATION_WINDUP_MS,
  BIG_HAMMER_FINISHER_SHAKE_DURATION_MS,
  BIG_HAMMER_FINISHER_SHAKE_INTENSITY_PX,
  BIG_HAMMER_JUMP_SHAKE_DURATION_MS,
  BIG_HAMMER_JUMP_SHAKE_INTENSITY_PX,
  BIG_HAMMER_SIZE_LEVEL,
  BLOCK_VERTICAL_SCALE,
  BOMB_CAMERA_SHAKE_DURATION_MS,
  BOMB_CAMERA_SHAKE_INTENSITY_PX,
  BOMB_FUSE_MS,
  BOMB_PROJECTILE_DENSITY,
  BOMB_PROJECTILE_FRICTION,
  BOMB_PROJECTILE_LINEAR_DAMPING,
  BOMB_PROJECTILE_RADIUS_SCALE_DENOMINATOR,
  BOMB_PROJECTILE_RADIUS_SCALE_NUMERATOR,
  BOMB_PROJECTILE_RESTITUTION,
  BOMB_TERRAIN_IMPACT_POWER,
  BOMB_THROW_FREE_SPEED,
  BOMB_THROW_GRAVITY_SCALE,
  BOMB_THROW_LOCKED_MAX_SPEED,
  BOMB_THROW_LOCKED_MIN_SPEED,
  BOMB_THROW_LOCKED_SPEED_PER_METER,
  BOMB_THROW_WINDUP_BACK_OFFSET,
  BOMB_THROW_WINDUP_DOWN_OFFSET,
  BOMB_THROW_WINDUP_MS,
  BOMB_THROW_WINDUP_ROTATION_RAD,
  BOMB_ULTIMATE_STATS,
  BreakableObstacleHit,
  DEATH_WEAPON_DROP_CHANCE_DENOMINATOR,
  DEFAULT_PROJECTILE_DENSITY,
  DEFAULT_PROJECTILE_LIFETIME_MS,
  DEFAULT_PROJECTILE_RESTITUTION,
  GIANT_SWORD_FINISHER_SHAKE_DURATION_MS,
  GIANT_SWORD_FINISHER_SHAKE_INTENSITY_PX,
  GIANT_SWORD_JUMP_SHAKE_DURATION_MS,
  GIANT_SWORD_JUMP_SHAKE_INTENSITY_PX,
  GIANT_SWORD_SIZE_LEVEL,
  GREAT_SWORD_SIZE_LEVEL,
  HAMMER_CRIT_RECOVER_MS,
  HAMMER_CRIT_SWING_MS,
  HAMMER_CRIT_WINDUP_MS,
  ObstacleCollider,
  PARRY_ACTIVE_START_FRAME,
  PARRY_WINDOW_FRAMES,
  REBOUND_PAUSE_MS,
  STAGGER_DROP_SETTLE_MIN_TIME,
  STAGGER_DROP_SETTLE_SPEED_SQ,
  TERRAIN_DEBRIS_HIT_ANGULAR_EXTREME1000,
  TERRAIN_DEBRIS_HIT_ANGULAR_LARGE1000,
  TERRAIN_DEBRIS_HIT_ANGULAR_MEDIUM1000,
  TERRAIN_DEBRIS_HIT_ANGULAR_SMALL1000,
  TERRAIN_DEBRIS_HIT_IMPULSE_EXTREME1000,
  TERRAIN_DEBRIS_HIT_IMPULSE_LARGE1000,
  TERRAIN_DEBRIS_HIT_IMPULSE_MEDIUM1000,
  TERRAIN_DEBRIS_HIT_IMPULSE_SMALL1000,
  TERRAIN_DEBRIS_HIT_LIFT_EXTREME1000,
  TERRAIN_DEBRIS_HIT_LIFT_LARGE1000,
  TERRAIN_DEBRIS_HIT_LIFT_MEDIUM1000,
  TERRAIN_DEBRIS_HIT_LIFT_SMALL1000,
  WeaponDropData,
  getBodyHalfHeight,
} from './WeaponSystemShared'

export abstract class WeaponImpactSystem extends WeaponCollisionSystem {
  protected retractWeaponOnDirectionChange(
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
    this.resetAssassinationState(entity, true)
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

  protected resetWeaponState(entity: Entity): void {
    if (!entity.weapon) return

    const weapon = entity.weapon
    this.resetAssassinationState(entity, true)
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
    this.resetBombState(weapon)
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

  protected createStaggerDropBody(
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
    bodyDef.gravityScale = 1
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

  protected destroyStaggerDropBody(weapon: WeaponComponent): void {
    if (!this.box2d || !weapon.staggerDropBodyId) {
      weapon.staggerDropBodyId = null
      return
    }

    this.box2d.b2DestroyBody(weapon.staggerDropBodyId)
    weapon.staggerDropBodyId = null
  }

  protected syncStaggerDroppedWeapon(
    weapon: WeaponComponent,
    playerPos: { x: number; y: number }
  ): void {
    applyOffset(weapon.dropEndOffset, playerPos, weapon.visual)
    weapon.position.x = weapon.visual.x
    weapon.position.y = weapon.visual.y
    weapon.rotation = weapon.visual.rotation
  }

  protected updateStaggerDroppingWeapon(
    weapon: WeaponComponent,
    playerPos: { x: number; y: number }
  ): void {
    if (!this.box2d || !weapon.staggerDropBodyId) {
      weapon.isDropping = false
      weapon.isDropped = true
      applyOffset(weapon.dropEndOffset, playerPos, weapon.visual)
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
      progress >= 1 ||
      (speedSq <= STAGGER_DROP_SETTLE_SPEED_SQ &&
        weapon.dropElapsedTime >= STAGGER_DROP_SETTLE_MIN_TIME)
    ) {
      this.destroyStaggerDropBody(weapon)
      weapon.isDropping = false
      weapon.isDropped = true
      applyOffset(weapon.dropEndOffset, playerPos, weapon.visual)
      weapon.position.x = weapon.visual.x
      weapon.position.y = weapon.visual.y
      weapon.rotation = weapon.visual.rotation
    }

    pos.delete()
    velocity.delete()
  }

  protected checkObstacleCollision(
    attacker: Entity,
    weapon?: Entity['weapon'],
    previousWeaponX?: number,
    previousWeaponY?: number,
    previousWeaponRotation?: number
  ): ObstacleCollider | null {
    if (!weapon) return null
    const wx = weapon.visual.x
    const wy = weapon.visual.y
    const wWidth = weapon.width
    const wHeight = weapon.height
    const wRotation = weapon.visual.rotation
    let blockingObstacle: ObstacleCollider | null = null
    const hasSweep =
      previousWeaponX !== undefined &&
      previousWeaponY !== undefined &&
      previousWeaponRotation !== undefined &&
      (previousWeaponX !== wx ||
        previousWeaponY !== wy ||
        previousWeaponRotation !== wRotation)

    this.hitRopesWithSweptWeaponOBB(
      weapon,
      hasSweep ? previousWeaponX : undefined,
      hasSweep ? previousWeaponY : undefined,
      hasSweep ? previousWeaponRotation : undefined
    )

    if (this.obstacles.length === 0) return null

    for (const obstacle of this.obstacles) {
      if (obstacle.renderLayer !== weapon.renderLayer) {
        continue
      }
      if (blockingObstacle && obstacle.breakableId === undefined) {
        continue
      }
      const centerX = obstacle.centerX
      const centerY = obstacle.centerY

      if (
        this.getObstacleCollisionHitSample(
          obstacle,
          wx,
          wy,
          wWidth,
          wHeight,
          wRotation,
          hasSweep ? previousWeaponX : undefined,
          hasSweep ? previousWeaponY : undefined,
          hasSweep ? previousWeaponRotation : undefined
        ) < 0
      ) {
        continue
      }

      this.hitTerrainDebrisInOBB(
        wx,
        wy,
        wWidth,
        wHeight,
        wRotation,
        weapon.renderLayer,
        weapon.impactLevel,
        wx,
        wy,
        weapon
      )
      this.emitBreakableObstacleHit(
        obstacle,
        weapon.impactLevel,
        wx,
        wy,
        attacker,
        weapon
      )
      if (obstacle.breakableId !== undefined) {
        continue
      }
      if (blockingObstacle === null) {
        blockingObstacle = obstacle
      }
    }

    return blockingObstacle
  }

  protected getObstacleCollisionHitSample(
    obstacle: ObstacleCollider,
    wx: number,
    wy: number,
    wWidth: number,
    wHeight: number,
    wRotation: number,
    previousWeaponX?: number,
    previousWeaponY?: number,
    previousWeaponRotation?: number
  ): number {
    if (
      this.checkObstacleOverlap(obstacle, wx, wy, wWidth, wHeight, wRotation)
    ) {
      return 0
    }
    if (
      previousWeaponX === undefined ||
      previousWeaponY === undefined ||
      previousWeaponRotation === undefined
    ) {
      return -1
    }

    for (let sample = 1; sample <= 3; sample++) {
      const currentWeight = sample
      const previousWeight = 4 - sample
      this.tempSweptWeaponTransform.x =
        (previousWeaponX * previousWeight + wx * currentWeight) / 4
      this.tempSweptWeaponTransform.y =
        (previousWeaponY * previousWeight + wy * currentWeight) / 4
      this.tempSweptWeaponTransform.rotation =
        (previousWeaponRotation * previousWeight + wRotation * currentWeight) /
        4
      if (
        this.checkObstacleOverlap(
          obstacle,
          this.tempSweptWeaponTransform.x,
          this.tempSweptWeaponTransform.y,
          wWidth,
          wHeight,
          this.tempSweptWeaponTransform.rotation
        )
      ) {
        return sample
      }
    }

    return -1
  }

  protected checkObstacleOverlap(
    obstacle: ObstacleCollider,
    wx: number,
    wy: number,
    wWidth: number,
    wHeight: number,
    wRotation: number
  ): boolean {
    const worldVertices = obstacle.worldVertices
    if (worldVertices) {
      return checkOBBvsPolygon(
        wx,
        wy,
        wWidth,
        wHeight,
        wRotation,
        worldVertices
      )
    }
    if (obstacle.radius !== undefined && obstacle.radius > 0) {
      return checkOBBvsCircle(
        wx,
        wy,
        wWidth,
        wHeight,
        wRotation,
        obstacle.centerX,
        obstacle.centerY,
        obstacle.radius
      )
    }
    return checkOBBvsAABB(
      wx,
      wy,
      wWidth,
      wHeight,
      wRotation,
      obstacle.centerX,
      obstacle.centerY,
      obstacle.width,
      obstacle.height
    )
  }

  protected shouldSkipObstacleRebound(
    weapon: WeaponComponent,
    obstacle: ObstacleCollider
  ): boolean {
    return weapon.weaponType === 'hammer' && obstacle.materialId === 'stone'
  }

  protected finishObstacleHitWithoutRebound(
    weapon: WeaponComponent,
    playerPos: { x: number; y: number },
    now: number
  ): void {
    weapon.attackQueued = false
    weapon.reboundLockedPause = false
    weapon.hitEntityIds.clear()
    weapon.attackCollisionSource = 'obstacle'
    weapon.groundHitSoundTriggered = true
    weapon.groundHitSoundPending = 0
    this.enterAttackPause(weapon, playerPos, now)
  }

  protected enterAttackPause(
    weapon: WeaponComponent,
    playerPos: { x: number; y: number },
    now: number
  ): void {
    weapon.attackPhase = 'pause'
    this.restoreDamageOverrides(weapon)
    weapon.attackElapsedMs = 0
    getOffsetFromTransform(weapon.visual, playerPos, weapon.attackStartOffset)
    copyTransform(weapon.attackStartTransform, weapon.visual)
    weapon.lastAttackTimestamp = now
  }

  protected applyPushback(entity: Entity, weapon: Entity['weapon']): void {
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

  protected getTerrainDebrisHitImpulse1000(impactLevel: ImpactLevel): number {
    if (impactLevel === 'small') {
      return TERRAIN_DEBRIS_HIT_IMPULSE_SMALL1000
    }
    if (impactLevel === 'medium') {
      return TERRAIN_DEBRIS_HIT_IMPULSE_MEDIUM1000
    }
    if (impactLevel === 'large') {
      return TERRAIN_DEBRIS_HIT_IMPULSE_LARGE1000
    }
    return TERRAIN_DEBRIS_HIT_IMPULSE_EXTREME1000
  }

  protected getTerrainDebrisHitLift1000(impactLevel: ImpactLevel): number {
    if (impactLevel === 'small') {
      return TERRAIN_DEBRIS_HIT_LIFT_SMALL1000
    }
    if (impactLevel === 'medium') {
      return TERRAIN_DEBRIS_HIT_LIFT_MEDIUM1000
    }
    if (impactLevel === 'large') {
      return TERRAIN_DEBRIS_HIT_LIFT_LARGE1000
    }
    return TERRAIN_DEBRIS_HIT_LIFT_EXTREME1000
  }

  protected getTerrainDebrisHitAngularImpulse1000(
    impactLevel: ImpactLevel
  ): number {
    if (impactLevel === 'small') {
      return TERRAIN_DEBRIS_HIT_ANGULAR_SMALL1000
    }
    if (impactLevel === 'medium') {
      return TERRAIN_DEBRIS_HIT_ANGULAR_MEDIUM1000
    }
    if (impactLevel === 'large') {
      return TERRAIN_DEBRIS_HIT_ANGULAR_LARGE1000
    }
    return TERRAIN_DEBRIS_HIT_ANGULAR_EXTREME1000
  }

  protected applyTerrainDebrisImpulse(
    target: Entity,
    sourceX: number,
    sourceY: number,
    impactLevel: ImpactLevel,
    fallbackDirX1000: number,
    fallbackDirY1000: number
  ): boolean {
    const debris = target.terrainDebris
    if (
      !debris ||
      !debris.receivesWeaponImpulse ||
      debris.lifeMs <= 0 ||
      !target.transform ||
      !target.physics ||
      !this.box2d ||
      !this.tempVec
    ) {
      return false
    }

    let dirX1000 = 0
    let dirY1000 = 0
    const dx1000 = Math.round((target.transform.x - sourceX) * 1000)
    const dy1000 = Math.round((target.transform.y - sourceY) * 1000)
    const distanceBase1000 = Math.abs(dx1000) + Math.abs(dy1000)
    if (distanceBase1000 > 0) {
      dirX1000 = Math.floor((dx1000 * 1000) / distanceBase1000)
      dirY1000 = Math.floor((dy1000 * 1000) / distanceBase1000)
    } else {
      dirX1000 = fallbackDirX1000
      dirY1000 = fallbackDirY1000
    }
    if (dirX1000 === 0 && dirY1000 === 0) {
      dirX1000 = 1000
    }

    const impulse1000 = this.getTerrainDebrisHitImpulse1000(impactLevel)
    const lift1000 = this.getTerrainDebrisHitLift1000(impactLevel)
    const angularImpulse1000 =
      this.getTerrainDebrisHitAngularImpulse1000(impactLevel)
    const {
      b2Body_ApplyLinearImpulseToCenter,
      b2Body_ApplyAngularImpulse,
      b2Body_GetMass,
    } = this.box2d
    const mass = b2Body_GetMass(target.physics.bodyId)
    this.tempVec.x = (dirX1000 * impulse1000 * mass) / 1000000
    this.tempVec.y =
      ((dirY1000 * impulse1000 - lift1000 * 1000) * mass) / 1000000
    b2Body_ApplyLinearImpulseToCenter(target.physics.bodyId, this.tempVec, true)
    const angularSign =
      dx1000 === 0 ? (dirX1000 >= 0 ? 1 : -1) : dx1000 > 0 ? 1 : -1
    b2Body_ApplyAngularImpulse(
      target.physics.bodyId,
      (angularImpulse1000 * angularSign * mass) / 1000,
      true
    )
    return true
  }

  protected hitTerrainDebrisInCircle(
    centerX: number,
    centerY: number,
    radius: number,
    renderLayer: number,
    impactLevel: ImpactLevel,
    impactX = centerX,
    impactY = centerY,
    weapon?: WeaponComponent
  ): void {
    if (radius <= 0) {
      return
    }
    const radiusSq = radius * radius
    for (let i = 0; i < this.allEntities.length; i++) {
      const target = this.allEntities[i]
      if (
        !target?.transform ||
        (target.render?.renderLayer ?? 0) !== renderLayer ||
        !target.terrainDebris?.receivesWeaponImpulse
      ) {
        continue
      }
      const dx = target.transform.x - centerX
      const dy = target.transform.y - centerY
      if (dx * dx + dy * dy > radiusSq) {
        continue
      }
      if (weapon?.hitEntityIds.has(target.id)) {
        continue
      }
      this.applyTerrainDebrisImpulse(
        target,
        impactX,
        impactY,
        impactLevel,
        dx >= 0 ? 1000 : -1000,
        dy >= 0 ? 1000 : -1000
      )
      weapon?.hitEntityIds.add(target.id)
    }
  }

  protected hitTerrainDebrisInOBB(
    centerX: number,
    centerY: number,
    width: number,
    height: number,
    rotation: number,
    renderLayer: number,
    impactLevel: ImpactLevel,
    impactX = centerX,
    impactY = centerY,
    weapon?: WeaponComponent
  ): void {
    if (width <= 0 || height <= 0) {
      return
    }
    for (let i = 0; i < this.allEntities.length; i++) {
      const target = this.allEntities[i]
      if (
        !target?.transform ||
        (target.render?.renderLayer ?? 0) !== renderLayer ||
        !target.terrainDebris?.receivesWeaponImpulse
      ) {
        continue
      }
      if (weapon?.hitEntityIds.has(target.id)) {
        continue
      }
      const debrisWidth = target.terrainDebris.width
      const debrisHeight = target.terrainDebris.height
      if (debrisWidth <= 0 || debrisHeight <= 0) {
        continue
      }
      const debrisRadius =
        target.render?.radius ?? Math.max(debrisWidth, debrisHeight) / 2
      const hit =
        checkOBBvsOBB(
          centerX,
          centerY,
          width,
          height,
          rotation,
          target.transform.x,
          target.transform.y,
          debrisWidth,
          debrisHeight,
          target.transform.rotation
        ) ||
        checkOBBvsCircle(
          centerX,
          centerY,
          width,
          height,
          rotation,
          target.transform.x,
          target.transform.y,
          debrisRadius
        )
      if (!hit) {
        continue
      }
      const fallbackDirX1000 = Math.round(Math.cos(rotation) * 1000)
      const fallbackDirY1000 = Math.round(Math.sin(rotation) * 1000)
      this.applyTerrainDebrisImpulse(
        target,
        impactX,
        impactY,
        impactLevel,
        fallbackDirX1000 !== 0 ? fallbackDirX1000 : 1000,
        fallbackDirY1000
      )
      weapon?.hitEntityIds.add(target.id)
    }
  }

  protected tryHitTerrainDebris(
    target: Entity,
    weapon: WeaponComponent,
    weaponX: number,
    weaponY: number,
    weaponWidth: number,
    weaponHeight: number,
    weaponRotation: number,
    attackRadius: number
  ): boolean {
    const debris = target.terrainDebris
    if (!debris || !target.transform) {
      return false
    }
    if (weapon.hitEntityIds.has(target.id)) {
      return false
    }

    const debrisWidth = debris.width
    const debrisHeight = debris.height
    if (debrisWidth <= 0 || debrisHeight <= 0) {
      return false
    }

    const debrisRadius =
      target.render?.radius ?? Math.max(debrisWidth, debrisHeight) / 2
    const dx = weaponX - target.transform.x
    const dy = weaponY - target.transform.y
    const hitRange = attackRadius + debrisRadius
    if (dx * dx + dy * dy > hitRange * hitRange) {
      return false
    }
    const overlap =
      checkOBBvsOBB(
        weaponX,
        weaponY,
        weaponWidth,
        weaponHeight,
        weaponRotation,
        target.transform.x,
        target.transform.y,
        debrisWidth,
        debrisHeight,
        target.transform.rotation
      ) ||
      checkOBBvsCircle(
        weaponX,
        weaponY,
        weaponWidth,
        weaponHeight,
        weaponRotation,
        target.transform.x,
        target.transform.y,
        debrisRadius
      )
    if (!overlap) {
      return false
    }

    const fallbackX1000 = Math.round(Math.cos(weaponRotation) * 1000)
    const fallbackY1000 = Math.round(Math.sin(weaponRotation) * 1000)
    this.applyTerrainDebrisImpulse(
      target,
      weaponX,
      weaponY,
      weapon.impactLevel,
      fallbackX1000 !== 0 ? fallbackX1000 : (weapon.attackFacing || 1) * 1000,
      fallbackY1000
    )
    weapon.isColliding = true
    weapon.hitEntityIds.add(target.id)
    return true
  }

  protected checkEntityHits(
    attacker: Entity,
    weapon: Entity['weapon']
  ): number {
    if (!attacker.transform) return 0
    if (!weapon || !weapon.hitEntityIds) return 0
    if (!weapon.isEquipped) return 0

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
      this.skeletalSegmentManager?.getMaxActiveCoverageRadius() ?? 0

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
    const attackerFaction = attacker.faction
    const statsSystem = this.statsSystem
    let entityHitCount = 0

    for (let i = 0; i < nearbyCount; i++) {
      const target = nearbyEntities[i]
      if (!target || target.id === attacker.id) continue
      if ((target.render?.renderLayer ?? 0) !== attackerLayer) continue
      if (
        target.terrainDebris?.receivesWeaponImpulse &&
        this.tryHitTerrainDebris(
          target,
          weapon,
          weaponX,
          weaponY,
          weaponWidth,
          weaponHeight,
          weaponRotation,
          attackRadius
        )
      ) {
        continue
      }
      if (!statsSystem || !attackerFaction) continue
      if (!target.transform || !target.stats || target.stats.isDead) continue
      if (
        !target.faction ||
        !attackerFaction.canAttackEntity(target.faction, target.id.toString())
      )
        continue

      const targetRadius = target.render?.radius ?? DEFAULT_PLAYER_RADIUS
      const segmentedCoverageRadius =
        this.skeletalSegmentManager?.getEntityCoverageRadius(target) ?? 0
      const collisionRadius =
        segmentedCoverageRadius > 0 ? segmentedCoverageRadius : targetRadius

      const hitRange = attackRadius + collisionRadius
      const dx = weaponX - target.transform.x
      const dy = weaponY - target.transform.y
      if (dx * dx + dy * dy > hitRange * hitRange) continue

      if (weapon.hitEntityIds.has(target.id)) continue

      const isSegmentHit =
        segmentedCoverageRadius > 0 &&
        this.skeletalSegmentManager?.testWeaponHit(
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
        statsSystem.applyWeaponHit(target, weapon, this.tempHitSource, attacker)
        entityHitCount += 1
        weapon.isColliding = true
        weapon.hitEntityIds.add(target.id)
      }
    }
    return entityHitCount
  }

  protected startRebound(
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

  protected handleReboundPhase(
    entity: Entity,
    weapon: Entity['weapon'],
    playerPos: { x: number; y: number },
    now: number
  ): void {
    if (!weapon) return

    // Allow canceling rebound with block
    if (entity.input && entity.input.blockRequested && !entity.npcAI) {
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
      this.enterAttackPause(weapon, playerPos, now)
    }
  }

  protected handleHammerCritPhases(
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
        weapon.hitRopeIds.clear()
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

      this.hitRopesWithSweptWeaponOBB(weapon)
      const entityHitCount = this.checkEntityHits(entity, weapon)
      if (entityHitCount > 0) {
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
