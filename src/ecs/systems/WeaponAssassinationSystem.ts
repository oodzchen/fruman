import {
  getCharacterBodyHalfHeight,
  getCharacterBodyHalfWidth,
  getCharacterEyeOffsetX,
  getCharacterEyeOffsetY,
} from '../../characterBodyProfile'
import {
  DEFAULT_PLAYER_FOV_RAD,
  DEFAULT_PLAYER_RADIUS,
  DEFAULT_WEAPON_PLAYER_CLEARANCE,
} from '../../constants'
import { getEnvironmentCollisionMask } from '../../physicsLayers'
import { Faction, WeaponComponent } from '../Component'
import type { Entity } from '../Entity'
import {
  clamp01,
  copyTransform,
  getFrontTransform,
  getThrustTransforms,
  lerpTransform,
} from '../WeaponPoseUtils'
import { WeaponSystemCore } from './WeaponSystemCore'
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
} from './WeaponSystemShared'

export abstract class WeaponAssassinationSystem extends WeaponSystemCore {
  protected updateAssassinationAvailability(entity: Entity): void {
    if (
      !entity.input ||
      !entity.transform ||
      !entity.weapon ||
      !entity.stats ||
      entity.stats.isDead
    ) {
      this.clearAssassinationAvailability(entity)
      return
    }
    if (entity.faction?.factionId !== Faction.Player) {
      this.clearAssassinationAvailability(entity)
      return
    }
    if (!entity.weapon.isEquipped) {
      this.clearAssassinationAvailability(entity)
      return
    }
    if (!this.canUseAssassinationWeapon(entity)) {
      this.clearAssassinationAvailability(entity)
      return
    }
    if (entity.weapon.attackPhase !== 'idle') {
      this.clearAssassinationAvailability(entity)
      return
    }

    const assassinationRange = ASSASSINATION_FIXED_RANGE
    const assassinationRangeSq = assassinationRange * assassinationRange
    let bestTargetId: number | null = null
    let bestDistanceSq = assassinationRangeSq
    const attackerLayer = entity.render?.renderLayer ?? 0
    const candidates = this.spatialHash
      ? this.spatialHash.query(
          entity.transform.x,
          entity.transform.y,
          assassinationRange + 1
        )
      : this.allEntities
    const candidateCount = this.spatialHash
      ? this.spatialHash.getQueryResultLength()
      : candidates.length

    for (let i = 0; i < candidateCount; i++) {
      const target = candidates[i]
      if (!this.canAssassinateTarget(entity, target, attackerLayer)) {
        continue
      }
      const distanceSq = this.getAssassinationDistanceSq(entity, target)
      if (distanceSq > bestDistanceSq) {
        continue
      }
      bestDistanceSq = distanceSq
      bestTargetId = target.id
    }

    entity.input.assassinationTargetId = bestTargetId
  }

  protected clearAssassinationAvailability(entity: Entity): void {
    if (entity.input && entity.weapon?.assassinationPhase === null) {
      entity.input.assassinationTargetId = null
    }
  }

  protected canUseAssassinationWeapon(entity: Entity): boolean {
    const weaponType = entity.weapon?.weaponType
    return (
      weaponType === 'sword' ||
      weaponType === 'spear' ||
      weaponType === 'hammer'
    )
  }

  protected canAssassinateTarget(
    attacker: Entity,
    target: Entity | undefined,
    attackerLayer: number
  ): boolean {
    if (!target || target.id === attacker.id) {
      return false
    }
    if (!target.transform || !target.stats || target.stats.isDead) {
      return false
    }
    if (!attacker.faction || !target.faction) {
      return false
    }
    if ((target.render?.renderLayer ?? 0) !== attackerLayer) {
      return false
    }
    if (
      !attacker.faction.canAttackEntity(target.faction, target.id.toString())
    ) {
      return false
    }
    if (target.stats.isVanished || target.stats.isInCombat) {
      return false
    }
    if (target.npcAI?.alertChaseActive) {
      return false
    }
    if (
      target.input?.lockedTargetId != null ||
      target.sensor?.detectedTargetId != null
    ) {
      return false
    }
    if (this.canEntitySeeTarget(target, attacker)) {
      return false
    }
    return true
  }

  protected getAssassinationDistanceSq(
    attacker: Entity,
    target: Entity
  ): number {
    if (!attacker.transform || !target.transform) {
      return Number.POSITIVE_INFINITY
    }

    const targetRender = target.render
    const targetRadius = targetRender?.radius ?? DEFAULT_PLAYER_RADIUS
    const targetHalfWidth =
      targetRender?.segmentedCollision &&
      targetRender.segmentedProxyHalfWidth > 0
        ? targetRender.segmentedProxyHalfWidth
        : getCharacterBodyHalfWidth(targetRender?.bodyProfile, targetRadius)
    const targetHalfHeight =
      targetRender?.segmentedCollision &&
      targetRender.segmentedProxyHalfHeight > 0
        ? targetRender.segmentedProxyHalfHeight
        : getCharacterBodyHalfHeight(
            targetRender?.bodyProfile,
            targetRadius,
            targetRender?.bodyHeight ?? 0
          )
    const targetCenterY =
      target.transform.y +
      (targetRender?.segmentedCollision
        ? targetRender.segmentedProxyOffsetY
        : 0)
    const deltaX = Math.abs(attacker.transform.x - target.transform.x)
    const deltaY = Math.abs(attacker.transform.y - targetCenterY)
    const edgeGapX = Math.max(0, deltaX - targetHalfWidth)
    const edgeGapY = Math.max(0, deltaY - targetHalfHeight)
    return edgeGapX * edgeGapX + edgeGapY * edgeGapY
  }

  protected canEntitySeeTarget(observer: Entity, target: Entity): boolean {
    if (!observer.transform || !target.transform) {
      return false
    }

    const dx = target.transform.x - observer.transform.x
    const dy = target.transform.y - observer.transform.y
    const facing = this.getEntityFacingForVision(observer)
    const facingAngle = facing > 0 ? 0 : Math.PI
    const halfFov =
      observer.sensor?.fov && observer.sensor.fov > 0
        ? observer.sensor.fov / 2
        : DEFAULT_PLAYER_FOV_RAD / 2
    const targetAngle = Math.atan2(dy, dx)
    const angleDelta = Math.abs(this.normalizeAngle(targetAngle - facingAngle))
    if (angleDelta > halfFov) {
      return false
    }
    return this.hasLineOfSight(observer, target)
  }

  protected getEntityFacingForVision(entity: Entity): number {
    if (
      entity.input?.lastMoveDirection === -1 ||
      entity.input?.lastMoveDirection === 1
    ) {
      return entity.input.lastMoveDirection
    }
    if (
      entity.weapon?.attackFacing === -1 ||
      entity.weapon?.attackFacing === 1
    ) {
      return entity.weapon.attackFacing
    }
    return 1
  }

  protected normalizeAngle(angle: number): number {
    if (angle > Math.PI) {
      return angle - Math.PI * 2
    }
    if (angle < -Math.PI) {
      return angle + Math.PI * 2
    }
    return angle
  }

  protected hasLineOfSight(observer: Entity, target: Entity): boolean {
    if (
      !this.box2d ||
      !this.rayStart ||
      !this.rayTranslation ||
      !this.rayFilter ||
      !this.worldId ||
      !observer.transform ||
      !target.transform
    ) {
      return true
    }

    const facing = this.getEntityFacingForVision(observer)
    const radius = observer.render?.radius || DEFAULT_PLAYER_RADIUS
    const eyeOffsetX = getCharacterEyeOffsetX(
      observer.render?.bodyProfile,
      radius,
      facing
    )
    const eyeOffsetY = getCharacterEyeOffsetY(
      observer.render?.bodyProfile,
      radius,
      observer.render?.bodyHeight ?? 0
    )
    const startX = observer.transform.x + eyeOffsetX
    const startY = observer.transform.y + eyeOffsetY

    this.rayStart.Set(startX, startY)
    this.rayTranslation.Set(
      target.transform.x - startX,
      target.transform.y - startY
    )
    this.rayFilter.categoryBits = 0xffffffff
    this.rayFilter.maskBits = getEnvironmentCollisionMask(
      observer.render?.renderLayer ?? 0
    )

    const output = this.box2d.b2World_CastRayClosest(
      this.worldId,
      this.rayStart,
      this.rayTranslation,
      this.rayFilter
    )
    return !output.hit
  }

  protected getEntityById(id: number): Entity | undefined {
    if (this.entityLookup) {
      return this.entityLookup(id)
    }
    for (let i = 0; i < this.allEntities.length; i++) {
      const entity = this.allEntities[i]
      if (entity.id === id) {
        return entity
      }
    }
    return undefined
  }

  protected getAssassinationTarget(entity: Entity): Entity | null {
    const targetId = entity.input?.assassinationTargetId
    if (targetId === null || targetId === undefined) {
      return null
    }
    const target = this.getEntityById(targetId)
    if (!target) {
      return null
    }
    const attackerLayer = entity.render?.renderLayer ?? 0
    if (!this.canAssassinateTarget(entity, target, attackerLayer)) {
      return null
    }
    const range = ASSASSINATION_FIXED_RANGE
    return this.getAssassinationDistanceSq(entity, target) <= range * range
      ? target
      : null
  }

  protected startAssassination(attacker: Entity, target: Entity): boolean {
    if (!attacker.transform || !attacker.input || !attacker.weapon) {
      return false
    }

    const weapon = attacker.weapon
    if (
      weapon.assassinationPhase !== null ||
      !this.canUseAssassinationWeapon(attacker)
    ) {
      return false
    }

    const facing = target.transform!.x >= attacker.transform.x ? 1 : -1
    weapon.assassinationPhase = 'windup'
    weapon.assassinationElapsedMs = 0
    weapon.assassinationTargetId = target.id
    weapon.assassinationStyle =
      weapon.weaponType === 'hammer' ? 'strike' : 'thrust'
    weapon.assassinationImpactApplied = false
    weapon.assassinationKillApplied = false
    weapon.hitSoundPlaybackRate = 1
    weapon.attackPhase = 'idle'
    weapon.attackElapsedMs = 0
    weapon.attackQueued = false
    weapon.comboCount = 0
    weapon.hitEntityIds.clear()
    weapon.isBlocking = false
    weapon.isParrying = false
    weapon.parryElapsedTime = 0
    weapon.parryCounterActive = false
    weapon.attackFacing = facing
    attacker.input.assassinationTargetId = target.id
    attacker.input.facingOverride = facing
    this.populateAssassinationTransforms(attacker, weapon, target, facing)
    copyTransform(weapon.visual, weapon.assassinationStartTransform)
    if (target.weapon) {
      this.resetAttackStateForInterrupt(target.weapon)
      target.weapon.attackPhase = 'idle'
      target.weapon.isBlocking = false
      target.weapon.isParrying = false
      target.weapon.parryElapsedTime = 0
      target.weapon.parryHitWeaponIds.clear()
      target.weapon.width = target.weapon.baseWidth
    }
    this.lockAssassinationVictim(target)
    this.statsSystem?.applyForcedHitStun(
      target,
      'light',
      ASSASSINATION_TOTAL_DURATION_MS
    )
    this.freezeEntityMotion(attacker)
    this.freezeEntityMotion(target)
    return true
  }

  protected handleAssassinationPhases(
    attacker: Entity,
    weapon: WeaponComponent,
    deltaMs: number
  ): void {
    if (!attacker.transform || !attacker.input) {
      this.resetAssassinationState(attacker, true)
      return
    }

    const target = this.getEntityById(weapon.assassinationTargetId)
    if (!target?.transform || !target.stats || target.stats.isVanished) {
      this.resetAssassinationState(attacker, true)
      return
    }

    const facing = target.transform.x >= attacker.transform.x ? 1 : -1
    weapon.attackFacing = facing
    attacker.input.facingOverride = facing
    attacker.input.assassinationTargetId = target.id
    this.populateAssassinationTransforms(attacker, weapon, target, facing)
    this.freezeEntityMotion(attacker)
    this.lockAssassinationVictim(target)
    this.freezeEntityMotion(target)
    weapon.assassinationElapsedMs += deltaMs

    if (weapon.assassinationPhase === 'windup') {
      const t = clamp01(weapon.assassinationElapsedMs / ASSASSINATION_WINDUP_MS)
      lerpTransform(
        weapon.assassinationStartTransform,
        weapon.assassinationHitTransform,
        t,
        weapon.visual
      )
      if (t >= 1) {
        weapon.assassinationPhase = 'strike'
        weapon.assassinationElapsedMs = 0
      }
      return
    }

    if (weapon.assassinationPhase === 'strike') {
      const t = clamp01(weapon.assassinationElapsedMs / ASSASSINATION_STRIKE_MS)
      lerpTransform(
        weapon.assassinationHitTransform,
        weapon.assassinationRecoverTransform,
        t,
        weapon.visual
      )
      const impactReached =
        weapon.assassinationStyle === 'strike' ? t >= 0.35 : t >= 0.85
      if (!weapon.assassinationImpactApplied && impactReached) {
        weapon.assassinationImpactApplied = true
        this.statsSystem?.emitHitFeedback(
          target,
          weapon.assassinationHitTransform,
          ASSASSINATION_DEATH_SOUND_PLAYBACK_RATE,
          true,
          true
        )
      }
      if (t >= 1) {
        weapon.assassinationPhase = 'recover'
        weapon.assassinationElapsedMs = 0
      }
      return
    }

    const radius = attacker.render?.radius || DEFAULT_PLAYER_RADIUS
    getFrontTransform(
      attacker.transform,
      facing,
      this.tempTransform,
      radius,
      weapon.weaponType,
      weapon.width
    )
    const t = clamp01(weapon.assassinationElapsedMs / ASSASSINATION_RECOVER_MS)
    lerpTransform(
      weapon.assassinationRecoverTransform,
      this.tempTransform,
      t,
      weapon.visual
    )
    if (t >= 1) {
      if (!weapon.assassinationKillApplied) {
        this.applyAssassinationKill(attacker, target, weapon)
      }
      this.resetAssassinationState(attacker, true)
    }
  }

  protected populateAssassinationTransforms(
    attacker: Entity,
    weapon: WeaponComponent,
    target: Entity,
    facing: number
  ): void {
    const attackerRadius = attacker.render?.radius || DEFAULT_PLAYER_RADIUS
    const targetRadius = target.render?.radius || DEFAULT_PLAYER_RADIUS
    const attackerTransform = attacker.transform!
    const attackerX = attackerTransform.x
    const attackerY = attackerTransform.y
    const targetX = target.transform!.x
    const targetY = target.transform!.y
    const thrustRotation =
      facing > 0
        ? -ASSASSINATION_THRUST_ANGLE_RAD
        : Math.PI + ASSASSINATION_THRUST_ANGLE_RAD
    const strikeRotation = facing > 0 ? 0 : Math.PI

    if (weapon.assassinationStyle === 'thrust') {
      getThrustTransforms(
        attackerRadius + weapon.width / 2 + DEFAULT_WEAPON_PLAYER_CLEARANCE,
        facing,
        attackerTransform,
        weapon.weaponType,
        weapon.width,
        weapon.assassinationStartTransform,
        weapon.assassinationHitTransform
      )
      const thrustTravelDistance = Math.abs(
        weapon.assassinationHitTransform.x -
          weapon.assassinationStartTransform.x
      )
      const thrustDirX = Math.cos(thrustRotation)
      const thrustDirY = Math.sin(thrustRotation)
      const hitBackOffset = Math.max(0.06, weapon.width * 0.08)
      const hitX = targetX - thrustDirX * hitBackOffset
      const hitY = targetY - targetRadius * 0.18 - thrustDirY * hitBackOffset
      const windupDistance = Math.max(
        thrustTravelDistance,
        attackerRadius + targetRadius + weapon.width * 0.35
      )
      const recoverDistance = Math.max(
        weapon.width * 0.32,
        (windupDistance * 38) / 100
      )
      weapon.assassinationStartTransform.x = hitX - thrustDirX * windupDistance
      weapon.assassinationStartTransform.y = hitY - thrustDirY * windupDistance
      weapon.assassinationStartTransform.rotation = thrustRotation
      weapon.assassinationHitTransform.x = hitX
      weapon.assassinationHitTransform.y = hitY
      weapon.assassinationHitTransform.rotation = thrustRotation
      weapon.assassinationRecoverTransform.x =
        hitX - thrustDirX * recoverDistance
      weapon.assassinationRecoverTransform.y =
        hitY - thrustDirY * recoverDistance
      weapon.assassinationRecoverTransform.rotation = thrustRotation
      return
    }

    weapon.assassinationStartTransform.x =
      attackerX - facing * (attackerRadius + weapon.width * 0.7)
    weapon.assassinationStartTransform.y = attackerY - attackerRadius * 0.12
    weapon.assassinationStartTransform.rotation = strikeRotation
    weapon.assassinationHitTransform.x = targetX
    weapon.assassinationHitTransform.y = targetY
    weapon.assassinationHitTransform.rotation = strikeRotation
    weapon.assassinationRecoverTransform.x =
      targetX + facing * (targetRadius + weapon.width * 0.2)
    weapon.assassinationRecoverTransform.y = targetY
    weapon.assassinationRecoverTransform.rotation = strikeRotation
  }

  protected freezeEntityMotion(entity: Entity): void {
    entity.input?.inputBuffer.clearAction('attack')
    if (entity.input) {
      entity.input.moveDirection = 0
      entity.input.jumpRequested = false
      entity.input.sprintRequested = false
      entity.input.blockRequested = false
    }
    if (entity.physics && this.box2d && this.tempVec) {
      this.tempVec.x = 0
      this.tempVec.y = 0
      this.box2d.b2Body_SetLinearVelocity(entity.physics.bodyId, this.tempVec)
    }
  }

  protected lockAssassinationVictim(entity: Entity): void {
    if (!entity.stats) {
      return
    }

    if (!entity.stats.assassinationLocked) {
      entity.stats.assassinationLockedFacing =
        entity.input?.lastMoveDirection === -1 ? -1 : 1
    }
    entity.stats.assassinationLocked = true

    const lockedFacing = entity.stats.assassinationLockedFacing
    if (entity.input) {
      entity.input.inputBuffer.clearAll()
      entity.input.moveDirection = 0
      entity.input.jumpRequested = false
      entity.input.sprintRequested = false
      entity.input.attackRequested = false
      entity.input.ultimateRequested = false
      entity.input.skillRequested = false
      entity.input.blockRequested = false
      entity.input.lockedTargetId = null
      entity.input.lockLostTimer = 0
      entity.input.facingOverride = lockedFacing
      entity.input.lastMoveDirection = lockedFacing
    }

    if (!entity.weapon) {
      return
    }

    entity.weapon.attackPhase = 'idle'
    entity.weapon.attackElapsedMs = 0
    entity.weapon.attackQueued = false
    entity.weapon.isColliding = false
    entity.weapon.isBlocking = false
    entity.weapon.isParrying = false
    entity.weapon.parryElapsedTime = 0
    entity.weapon.comboCount = 0
    entity.weapon.width = entity.weapon.baseWidth
    entity.weapon.hitEntityIds.clear()
    entity.weapon.parryHitWeaponIds.clear()
  }

  protected unlockAssassinationVictim(entity: Entity): void {
    if (!entity.stats?.assassinationLocked) {
      return
    }

    entity.stats.assassinationLocked = false
    entity.stats.assassinationLockedFacing = 1
    if (entity.input) {
      entity.input.facingOverride = null
    }
  }

  protected applyAssassinationKill(
    attacker: Entity,
    target: Entity,
    weapon: WeaponComponent
  ): void {
    if (!target.stats || target.stats.isDead) {
      weapon.assassinationKillApplied = true
      return
    }

    weapon.assassinationKillApplied = true
    const savedAttackDamage = weapon.attackDamage
    const savedPostureDamage = weapon.postureDamage
    const savedToughnessDamage = weapon.toughnessDamage
    const savedImpactLevel = weapon.impactLevel
    const savedPlaybackRate = weapon.hitSoundPlaybackRate

    weapon.attackDamage = Math.max(
      savedAttackDamage,
      target.stats.maxHealth * 10
    )
    weapon.postureDamage = 0
    weapon.toughnessDamage = 0
    weapon.impactLevel = 'small'
    weapon.hitSoundPlaybackRate = ASSASSINATION_SOUND_PLAYBACK_RATE
    this.tempHitSource.x = weapon.visual.x
    this.tempHitSource.y = weapon.visual.y
    this.statsSystem?.applyWeaponHit(
      target,
      {
        attackDamage: weapon.attackDamage,
        postureDamage: weapon.postureDamage,
        toughnessDamage: weapon.toughnessDamage,
        impactLevel: weapon.impactLevel,
        weaponType: weapon.weaponType,
        sizeLevel: weapon.sizeLevel,
        hitSoundPlaybackRate: weapon.hitSoundPlaybackRate,
        suppressImpactEffects: true,
      },
      this.tempHitSource,
      attacker
    )
    weapon.attackDamage = savedAttackDamage
    weapon.postureDamage = savedPostureDamage
    weapon.toughnessDamage = savedToughnessDamage
    weapon.impactLevel = savedImpactLevel
    weapon.hitSoundPlaybackRate = savedPlaybackRate
    this.statsSystem?.emitCameraShake(
      target.transform!.x,
      target.transform!.y,
      ASSASSINATION_CAMERA_SHAKE_INTENSITY_PX,
      ASSASSINATION_CAMERA_SHAKE_DURATION_MS
    )
  }

  protected resetAssassinationState(
    entity: Entity,
    clearTargetId: boolean
  ): void {
    const weapon = entity.weapon
    if (!weapon) {
      if (clearTargetId && entity.input) {
        entity.input.assassinationTargetId = null
      }
      return
    }
    const target =
      weapon.assassinationTargetId > 0
        ? this.getEntityById(weapon.assassinationTargetId)
        : null
    if (target) {
      this.unlockAssassinationVictim(target)
    }
    weapon.assassinationPhase = null
    weapon.assassinationElapsedMs = 0
    weapon.assassinationTargetId = 0
    weapon.assassinationStyle = 'thrust'
    weapon.assassinationImpactApplied = false
    weapon.assassinationKillApplied = false
    weapon.hitSoundPlaybackRate = 1
    if (entity.input) {
      entity.input.facingOverride = null
      if (clearTargetId) {
        entity.input.assassinationTargetId = null
      }
    }
  }
}
