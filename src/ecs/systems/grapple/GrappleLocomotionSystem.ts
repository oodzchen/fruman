import {
  DEFAULT_GRAPPLE_ENEMY_COOLDOWN_MS,
  DEFAULT_GRAPPLE_ENEMY_STUN_EXTRA_MS,
  DEFAULT_GRAVITY,
} from '../../../constants'
import type { Entity } from '../../Entity'
import type { GrappleSystemRuntime } from './GrappleRuntime'
import { GrapplePullMode, type RopeRuntime } from './GrappleTypes'

export class GrappleLocomotionSystem {
  constructor(private readonly runtime: GrappleSystemRuntime) {}

  updatePull(
    entity: Entity,
    grapple: NonNullable<Entity['grapple']>,
    deltaMs: number
  ): void {
    if (!entity.physics || !entity.transform || !entity.input) {
      grapple.isPulling = false
      return
    }

    grapple.pullElapsedMs += deltaMs

    switch (grapple.pullMode) {
      case GrapplePullMode.AnchorTether:
        this.runtime.updateAnchorTether(entity, grapple, deltaMs)
        return
      case GrapplePullMode.Npc:
        this.runtime.processPulledTarget(entity, grapple, false)
        return
      case GrapplePullMode.Object:
        this.runtime.processPulledTarget(entity, grapple, true)
        return
      case GrapplePullMode.PlayerLinear:
        this.runtime.processPlayerLinearPull(entity, grapple)
        return
      case GrapplePullMode.Anchor:
      case GrapplePullMode.PlayerArc:
      default:
        this.runtime.processAnchorOrArcPull(entity, grapple)
        return
    }
  }

  syncPullTargetPosition(
    entity: Entity,
    grapple: NonNullable<Entity['grapple']>
  ): boolean {
    if (grapple.targetEntityId < 0) {
      return true
    }

    const targetEntity = this.runtime.getEntityById(grapple.targetEntityId)
    if (!targetEntity?.transform) {
      this.runtime.stopPull(entity, grapple, false)
      return false
    }
    grapple.targetX = targetEntity.transform.x
    grapple.targetY = targetEntity.transform.y
    return true
  }

  getPullDistanceSq(
    entity: Entity,
    grapple: NonNullable<Entity['grapple']>
  ): number {
    const transform = entity.transform
    if (!transform) {
      return 0
    }
    const dx = grapple.targetX - transform.x
    const dy = grapple.targetY - transform.y
    return dx * dx + dy * dy
  }

  processPulledTarget(
    entity: Entity,
    grapple: NonNullable<Entity['grapple']>,
    isObjectPull: boolean
  ): void {
    if (!this.runtime.syncPullTargetPosition(entity, grapple)) {
      return
    }

    const targetEntity = this.runtime.getEntityById(grapple.targetEntityId)
    if (
      !targetEntity ||
      !targetEntity.transform ||
      !this.runtime.getValidBodyId(targetEntity)
    ) {
      this.runtime.stopPull(entity, grapple, false)
      return
    }

    if (grapple.pullElapsedMs >= grapple.pullDurationMs) {
      this.runtime.finishPulledTarget(
        entity,
        grapple,
        targetEntity,
        isObjectPull,
        false
      )
      return
    }

    if (
      this.runtime.getPullDistanceSq(entity, grapple) <=
      grapple.desiredDistanceSq
    ) {
      this.runtime.finishPulledTarget(
        entity,
        grapple,
        targetEntity,
        isObjectPull,
        true
      )
      return
    }

    this.runtime.applyLinearPull(targetEntity, entity, grapple.pullSpeed)
  }

  finishPulledTarget(
    entity: Entity,
    grapple: NonNullable<Entity['grapple']>,
    targetEntity: Entity,
    isObjectPull: boolean,
    allowImmediateRetry: boolean
  ): void {
    this.runtime.stopLinearMotion(targetEntity)
    this.runtime.stopPull(entity, grapple, allowImmediateRetry)
    if (!isObjectPull) {
      this.runtime.applyNpcStun(
        targetEntity,
        DEFAULT_GRAPPLE_ENEMY_STUN_EXTRA_MS
      )
    }
  }

  processPlayerLinearPull(
    entity: Entity,
    grapple: NonNullable<Entity['grapple']>
  ): void {
    if (!this.runtime.syncPullTargetPosition(entity, grapple)) {
      return
    }

    if (grapple.pullElapsedMs >= grapple.pullDurationMs) {
      this.runtime.stopLinearMotion(entity)
      this.runtime.stopPull(entity, grapple, false)
      return
    }

    if (
      this.runtime.getPullDistanceSq(entity, grapple) <=
      grapple.desiredDistanceSq
    ) {
      this.runtime.stopLinearMotion(entity)
      this.runtime.stopPull(entity, grapple, true)
      return
    }

    this.runtime.applyLinearPull(entity, null, grapple.pullSpeed)
  }

  processAnchorOrArcPull(
    entity: Entity,
    grapple: NonNullable<Entity['grapple']>
  ): void {
    if (
      !entity.transform ||
      !this.runtime.syncPullTargetPosition(entity, grapple)
    ) {
      return
    }

    const distSq = this.runtime.getPullDistanceSq(entity, grapple)
    if (
      grapple.pullMode === GrapplePullMode.Anchor &&
      distSq <= this.runtime.ropeHideDistanceSq
    ) {
      this.runtime.stopPull(entity, grapple, true)
      return
    }

    if (
      distSq <= this.runtime.stopDistanceSq ||
      grapple.pullElapsedMs >= grapple.pullDurationMs
    ) {
      this.runtime.stopPull(entity, grapple, false)
      return
    }

    const radius = entity.render?.radius ?? 0.5
    const clearance = radius + 0.1
    if (entity.transform.y <= grapple.targetY - clearance) {
      this.runtime.stopPull(entity, grapple, true)
    }
  }

  stopPull(
    entity: Entity,
    grapple: NonNullable<Entity['grapple']>,
    allowImmediateRetry: boolean
  ): void {
    const pullMode = grapple.pullMode
    if (grapple.isRopeClimbing) {
      this.runtime.stopRopeClimb(entity, grapple, false)
    }

    if (grapple.isTethering) {
      this.runtime.destroyAnchorTether(entity, grapple)
    }

    const retainAirMomentum =
      this.runtime.shouldRetainAirMomentumAfterStop(pullMode)
    if (pullMode === GrapplePullMode.Npc) {
      grapple.cooldownEndTime =
        this.runtime.currentTimeMs + DEFAULT_GRAPPLE_ENEMY_COOLDOWN_MS
    } else if (allowImmediateRetry) {
      grapple.cooldownEndTime = this.runtime.currentTimeMs
    }
    this.runtime.resetGrappleMotion(grapple, retainAirMomentum)
  }

  shouldRetainAirMomentumAfterStop(pullMode: number): boolean {
    return (
      pullMode === GrapplePullMode.Anchor ||
      pullMode === GrapplePullMode.PlayerArc ||
      pullMode === GrapplePullMode.PlayerLinear ||
      pullMode === GrapplePullMode.AnchorTether
    )
  }

  resetGrappleMotion(
    grapple: NonNullable<Entity['grapple']>,
    retainAirMomentum: boolean
  ): void {
    grapple.isPulling = false
    grapple.isTethering = false
    grapple.isTetherSuspended = false
    grapple.retainAirMomentum = retainAirMomentum
    grapple.pullMode = GrapplePullMode.Anchor
    grapple.targetEntityId = -1
    grapple.desiredDistanceSq = 0
    grapple.moveLockEndTime = 0
  }

  applyLinearPull(entity: Entity, target: Entity | null, speed: number): void {
    const bodyId = this.runtime.getValidBodyId(entity)
    if (!bodyId || !entity.transform) {
      return
    }
    let targetX = 0
    let targetY = 0
    if (target && target.transform) {
      targetX = target.transform.x
      targetY = target.transform.y
    } else if (entity.grapple) {
      targetX = entity.grapple.targetX
      targetY = entity.grapple.targetY
    } else {
      return
    }
    const dx = targetX - entity.transform.x
    const dy = targetY - entity.transform.y
    const distSq = dx * dx + dy * dy
    if (distSq <= 0) return
    const invDist = 1 / Math.sqrt(distSq)
    this.runtime.tempVec.x = dx * invDist * speed
    this.runtime.tempVec.y = dy * invDist * speed
    this.runtime.box2d.b2Body_SetLinearVelocity(bodyId, this.runtime.tempVec)
  }

  stopLinearMotion(entity: Entity): void {
    const bodyId = this.runtime.getValidBodyId(entity)
    if (!bodyId) return
    this.runtime.tempVec.x = 0
    this.runtime.tempVec.y = 0
    this.runtime.box2d.b2Body_SetLinearVelocity(bodyId, this.runtime.tempVec)
  }

  applyGrappleImpulse(
    entity: Entity,
    grapple: NonNullable<Entity['grapple']>
  ): void {
    if (!entity.physics || !entity.transform) {
      return
    }

    const startX = entity.transform.x
    const startY = entity.transform.y
    const targetX = grapple.targetX
    const targetY = grapple.targetY

    const dx = targetX - startX

    const radius = entity.render?.radius ?? 0.5
    const clearance = radius + 0.1
    const apexY = Math.min(startY - 0.2, targetY - clearance)
    const height = Math.max(0.1, startY - apexY)
    const vy = -Math.sqrt(2 * DEFAULT_GRAVITY * height)

    const timeToApex = Math.max(0.01, -vy / DEFAULT_GRAVITY)
    const vx = dx / timeToApex

    this.runtime.tempVec.x = vx
    this.runtime.tempVec.y = vy
    grapple.startX = startX
    grapple.startY = startY
    grapple.velocityX = this.runtime.tempVec.x
    grapple.velocityY = this.runtime.tempVec.y
    this.runtime.box2d.b2Body_SetLinearVelocity(
      entity.physics.bodyId,
      this.runtime.tempVec
    )
  }

  performRopeJump(
    entity: Entity,
    grapple: NonNullable<Entity['grapple']>
  ): void {
    if (!entity.physics || !entity.movement || !entity.transform) return

    const currentVel = this.runtime.box2d.b2Body_GetLinearVelocity(
      entity.physics.bodyId
    )
    const currentVx = currentVel.x
    const currentVy = currentVel.y
    currentVel.delete()

    const jumpDeltaY =
      (-entity.movement.jumpForce * this.runtime.ropeJumpBaseUpwardScale) /
      this.runtime.ropeJumpScale
    const ropeDx = entity.transform.x - grapple.targetX
    const ropeDy = entity.transform.y - grapple.targetY
    const distSq = ropeDx * ropeDx + ropeDy * ropeDy

    this.runtime.tempVec.x = currentVx
    this.runtime.tempVec.y = currentVy + jumpDeltaY

    if (distSq > 0.01) {
      const invDist = 1 / Math.sqrt(distSq)
      const ropeX = ropeDx * invDist
      const ropeY = ropeDy * invDist
      const tangentX = -ropeY
      const tangentY = ropeX
      const tangentSpeed = currentVx * tangentX + currentVy * tangentY
      const amplitudeRatio = Math.min(1, Math.abs(ropeX))
      const speedRatio = Math.min(
        1,
        (tangentSpeed * tangentSpeed) / this.runtime.ropeJumpReferenceSpeedSq
      )
      const boostScale =
        (amplitudeRatio * this.runtime.ropeJumpAmplitudeBoostScale +
          speedRatio * this.runtime.ropeJumpSpeedBoostScale) /
        this.runtime.ropeJumpScale
      const tangentBoostSpeed = tangentSpeed * boostScale

      this.runtime.tempVec.x += tangentX * tangentBoostSpeed
      this.runtime.tempVec.y += tangentY * tangentBoostSpeed
    }

    const maxReleaseSpeed =
      (Math.max(entity.movement.jumpForce, entity.movement.moveSpeed * 4) *
        this.runtime.ropeJumpMaxSpeedScale) /
      this.runtime.ropeJumpScale
    const releaseSpeedSq =
      this.runtime.tempVec.x * this.runtime.tempVec.x +
      this.runtime.tempVec.y * this.runtime.tempVec.y
    const maxReleaseSpeedSq = maxReleaseSpeed * maxReleaseSpeed
    if (releaseSpeedSq > maxReleaseSpeedSq && releaseSpeedSq > 0) {
      const speedScale = maxReleaseSpeed / Math.sqrt(releaseSpeedSq)
      this.runtime.tempVec.x *= speedScale
      this.runtime.tempVec.y *= speedScale
    }

    grapple.velocityX = this.runtime.tempVec.x
    grapple.velocityY = this.runtime.tempVec.y
    this.runtime.box2d.b2Body_SetLinearVelocity(
      entity.physics.bodyId,
      this.runtime.tempVec
    )
    this.runtime.beginRopeJumpState(entity)
  }

  startRopeJumpMotion(entity: Entity): void {
    if (!entity.physics || !entity.movement) {
      return
    }

    const currentVel = this.runtime.box2d.b2Body_GetLinearVelocity(
      entity.physics.bodyId
    )
    const currentVx = currentVel.x
    const currentVy = currentVel.y
    currentVel.delete()

    const jumpDeltaY =
      (-entity.movement.jumpForce * this.runtime.ropeJumpBaseUpwardScale) /
      this.runtime.ropeJumpScale

    this.runtime.tempVec.x = currentVx
    this.runtime.tempVec.y = currentVy + jumpDeltaY

    const maxReleaseSpeed =
      (Math.max(entity.movement.jumpForce, entity.movement.moveSpeed * 4) *
        this.runtime.ropeJumpMaxSpeedScale) /
      this.runtime.ropeJumpScale
    const releaseSpeedSq =
      this.runtime.tempVec.x * this.runtime.tempVec.x +
      this.runtime.tempVec.y * this.runtime.tempVec.y
    const maxReleaseSpeedSq = maxReleaseSpeed * maxReleaseSpeed
    if (releaseSpeedSq > maxReleaseSpeedSq && releaseSpeedSq > 0) {
      const speedScale = maxReleaseSpeed / Math.sqrt(releaseSpeedSq)
      this.runtime.tempVec.x *= speedScale
      this.runtime.tempVec.y *= speedScale
    }

    this.runtime.box2d.b2Body_SetLinearVelocity(
      entity.physics.bodyId,
      this.runtime.tempVec
    )
    this.runtime.beginRopeJumpState(entity)
  }

  beginRopeJumpState(entity: Entity): void {
    if (!entity.movement) {
      return
    }

    entity.movement.isJumping = true
    entity.movement.jumpStartTime = this.runtime.currentTimeMs
    entity.movement.jumpElapsedTime = 0
    entity.movement.fallTrackingActive = true
    entity.movement.maxFallVelocity = 0
    entity.movement.fallStartY = entity.transform?.y ?? 0
    entity.movement.isGrounded = false
  }

  handleSwingInput(
    entity: Entity,
    grapple: NonNullable<Entity['grapple']>,
    runtime: RopeRuntime,
    _deltaMs: number
  ): void {
    if (
      !entity.physics ||
      !entity.transform ||
      !entity.input ||
      !entity.movement
    ) {
      return
    }

    if (entity.movement.isGrounded) {
      return
    }

    const moveDir = entity.input.moveDirection
    if (moveDir === 0) {
      runtime.lastSwingInputDirection = 0
      return
    }

    entity.input.lastMoveDirection = moveDir
    if (runtime.lastSwingInputDirection === moveDir) {
      return
    }

    const inputSwingSpeed = this.runtime.swingForce / 500
    this.applyTetherTangentialSpeed(entity, grapple, inputSwingSpeed, moveDir)
    runtime.lastSwingInputDirection = moveDir
  }

  private applyTetherTangentialSpeed(
    entity: Entity,
    grapple: NonNullable<Entity['grapple']>,
    swingSpeed: number,
    preferredMoveDirection: number
  ): void {
    if (!entity.physics || !entity.transform || entity.movement?.isGrounded) {
      return
    }

    const currentVel = this.runtime.box2d.b2Body_GetLinearVelocity(
      entity.physics.bodyId
    )
    const currentVx = currentVel.x
    const currentVy = currentVel.y
    currentVel.delete()

    const dx = grapple.targetX - entity.transform.x
    const dy = grapple.targetY - entity.transform.y
    const dist = Math.sqrt(dx * dx + dy * dy)

    if (dist < 0.1) {
      return
    }

    const ropeX = dx / dist
    const ropeY = dy / dist
    const tangentX = -ropeY
    const tangentY = ropeX
    const swingDir = this.resolveTetherSwingDirection(
      tangentX,
      tangentY,
      currentVx,
      currentVy,
      preferredMoveDirection,
      entity.input?.lastMoveDirection ?? 1
    )

    this.runtime.tempVec.x = currentVx + tangentX * swingSpeed * swingDir
    this.runtime.tempVec.y = currentVy + tangentY * swingSpeed * swingDir
    this.runtime.box2d.b2Body_SetLinearVelocity(
      entity.physics.bodyId,
      this.runtime.tempVec
    )
  }

  private resolveTetherSwingDirection(
    tangentX: number,
    tangentY: number,
    currentVx: number,
    currentVy: number,
    preferredMoveDirection: number,
    fallbackMoveDirection: number
  ): number {
    if (preferredMoveDirection !== 0 && Math.abs(tangentX) > 0.001) {
      return tangentX * preferredMoveDirection > 0 ? 1 : -1
    }

    const tangentSpeed = currentVx * tangentX + currentVy * tangentY
    if (Math.abs(tangentSpeed) >= 0.1) {
      return tangentSpeed > 0 ? 1 : -1
    }

    if (Math.abs(tangentX) > 0.001) {
      return tangentX * fallbackMoveDirection > 0 ? 1 : -1
    }

    return tangentY < 0 ? -1 : 1
  }
}
