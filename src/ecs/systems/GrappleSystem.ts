import {
  DEFAULT_GRAPPLE_ENEMY_COOLDOWN_MS,
  DEFAULT_GRAPPLE_ENEMY_STUN_EXTRA_MS,
  DEFAULT_GRAPPLE_PULL_STOP_DISTANCE,
  DEFAULT_GRAPPLE_RANGE,
  DEFAULT_GRAPPLE_ROPE_DAMPING_RATIO,
  DEFAULT_GRAPPLE_ROPE_DENSITY,
  DEFAULT_GRAPPLE_ROPE_HERTZ,
  DEFAULT_GRAPPLE_ROPE_LINEAR_DAMPING,
  DEFAULT_GRAPPLE_ROPE_MAX_SEGMENTS,
  DEFAULT_GRAPPLE_ROPE_SEGMENT_LENGTH,
  DEFAULT_GRAPPLE_ROPE_SEGMENT_RADIUS,
  DEFAULT_GRAPPLE_SWING_FORCE,
  DEFAULT_GRAPPLE_TETHER_MIN_LENGTH,
  DEFAULT_GRAVITY,
  DEFAULT_PLAYER_FOV_RAD,
  DEFAULT_PLAYER_RADIUS,
  DEFAULT_WEAPON_ATTACK_RADIUS,
  GRAPPLE_CLIMB_SPEED,
} from '../../constants'
import {
  getGroundCollisionCategory,
  getObstacleCollisionCategory,
  getRopeCollisionCategory,
  getRopeCollisionMask,
  getWeaponCollisionCategory,
} from '../../physicsLayers'
import type {
  MainModule,
  b2BodyId,
  b2JointId,
  b2Rot,
  b2Vec2,
  b2WorldId,
} from '../../types'
import { SOUND_IDS } from '../../worker/effectsProtocol'
import { Faction } from '../Component'
import { componentRegistry } from '../ComponentRegistry'
import type { Entity } from '../Entity'
import { System } from '../System'
import type { World } from '../World'
import type { StatsSystem } from './StatsSystem'

type RopeRuntime = {
  active: boolean
  anchorBodyId: b2BodyId | null
  anchorBodyOwned: boolean
  anchorEntityId: number
  anchorLocalX: number
  anchorLocalY: number
  playerAnchorBodyId: b2BodyId | null
  anchorFollowX: number
  anchorFollowY: number
  playerFollowX: number
  playerFollowY: number
  segmentCount: number
  linkLength: number
  attachIndex: number
  playerJointId: b2JointId | null
  segmentBodies: b2BodyId[]
  segmentJoints: b2JointId[]
  segmentFilterJoints: b2JointId[]
  jointMaxLen: number
  maxRopeLength: number
}

export class GrappleSystem extends System {
  private readonly pullModeAnchor = 0
  private readonly pullModeNpc = 1
  private readonly pullModePlayerLinear = 2
  private readonly pullModePlayerArc = 3
  private readonly pullModeAnchorTether = 4
  private readonly pullModeObject = 5
  private readonly dynamicTetherBaseSpeed = 2
  private readonly dynamicTetherStretchSpeed = 8
  private readonly dynamicTetherMaxSpeed = 14
  private readonly dynamicTetherRopeDensity = 0.05
  private readonly ropeJumpScale = 1000
  private readonly ropeJumpBaseUpwardScale = 600
  private readonly ropeJumpAmplitudeBoostScale = 350
  private readonly ropeJumpSpeedBoostScale = 250
  private readonly ropeJumpReferenceSpeedSq = 144
  private readonly ropeJumpMaxSpeedScale = 1500
  private world: World
  private box2d: MainModule
  private worldId: b2WorldId
  private tempVec: b2Vec2
  private tempRot: b2Rot
  private currentTimeMs = 0
  private anchorsDirty = true
  private anchorEntities: Entity[] = []
  private grappleTargetEntities: Entity[] = []
  private tempTarget = { x: 0, y: 0 }
  private statsSystem?: StatsSystem
  private cosHalfFov = Math.cos(DEFAULT_PLAYER_FOV_RAD * 0.5)
  private rangeSq = DEFAULT_GRAPPLE_RANGE * DEFAULT_GRAPPLE_RANGE
  private stopDistanceSq =
    DEFAULT_GRAPPLE_PULL_STOP_DISTANCE * DEFAULT_GRAPPLE_PULL_STOP_DISTANCE
  private ropeHideDistanceSq =
    DEFAULT_PLAYER_RADIUS * 2 * (DEFAULT_PLAYER_RADIUS * 2)
  private ropeRuntimeByEntityId = new Map<number, RopeRuntime>()
  private ropeDensity = DEFAULT_GRAPPLE_ROPE_DENSITY
  private ropeLinearDamping = DEFAULT_GRAPPLE_ROPE_LINEAR_DAMPING
  private ropeHertz = DEFAULT_GRAPPLE_ROPE_HERTZ
  private ropeDampingRatio = DEFAULT_GRAPPLE_ROPE_DAMPING_RATIO
  private swingForce = DEFAULT_GRAPPLE_SWING_FORCE

  constructor(world: World, box2d: MainModule, worldId: b2WorldId) {
    super()
    this.world = world
    this.box2d = box2d
    this.worldId = worldId
    this.tempVec = new box2d.b2Vec2(0, 0)
    this.tempRot = new box2d.b2Rot()
    this.tempRot.SetAngle(0)

    const transformType = componentRegistry.getComponentType('Transform')
    const physicsType = componentRegistry.getComponentType('Physics')
    const inputType = componentRegistry.getComponentType('Input')
    const grappleType = componentRegistry.getComponentType('Grapple')
    this.setRequiredComponents([
      transformType,
      physicsType,
      inputType,
      grappleType,
    ])
  }

  markAnchorsDirty(): void {
    this.anchorsDirty = true
  }

  setStatsSystem(statsSystem: StatsSystem): void {
    this.statsSystem = statsSystem
  }

  setRopeDensity(value: number): void {
    this.ropeDensity = value
    this.updateExistingRopeSegments()
  }

  setRopeLinearDamping(value: number): void {
    this.ropeLinearDamping = value
    this.updateExistingRopeSegments()
  }

  setRopeHertz(value: number): void {
    this.ropeHertz = value
    this.updateExistingRopeJoints()
  }

  setRopeDampingRatio(value: number): void {
    this.ropeDampingRatio = value
    this.updateExistingRopeJoints()
  }

  setSwingForce(value: number): void {
    this.swingForce = value
  }

  detachTetherTarget(targetEntityId: number): void {
    if (targetEntityId < 0) {
      return
    }

    this.ropeRuntimeByEntityId.forEach((runtime, ownerEntityId) => {
      if (!runtime.active || runtime.anchorEntityId !== targetEntityId) {
        return
      }

      const owner = this.getEntityById(ownerEntityId)
      const grapple = owner?.grapple
      if (!owner || !grapple) {
        return
      }

      this.destroyAnchorTether(owner, grapple)
      grapple.isPulling = false
      grapple.retainAirMomentum = false
      grapple.pullMode = this.pullModeAnchor
      grapple.targetEntityId = -1
      grapple.desiredDistanceSq = 0
      grapple.moveLockEndTime = 0
    })
  }

  private updateExistingRopeSegments(): void {
    this.ropeRuntimeByEntityId.forEach((runtime) => {
      if (!runtime.active) return
      for (let i = 0; i < runtime.segmentBodies.length; i++) {
        const bodyId = runtime.segmentBodies[i]
        if (this.isBodyId(bodyId) && this.box2d.b2Body_IsValid(bodyId)) {
          this.box2d.b2Body_SetLinearDamping(bodyId, this.ropeLinearDamping)
        }
      }
    })
  }

  private updateExistingRopeJoints(): void {
    this.ropeRuntimeByEntityId.forEach((runtime) => {
      if (!runtime.active) return
      for (let i = 0; i < runtime.segmentJoints.length; i++) {
        const jointId = runtime.segmentJoints[i]
        if (this.isJointId(jointId) && this.box2d.b2Joint_IsValid(jointId)) {
          this.box2d.b2DistanceJoint_SetSpringHertz(jointId, this.ropeHertz)
          this.box2d.b2DistanceJoint_SetSpringDampingRatio(
            jointId,
            this.ropeDampingRatio
          )
        }
      }
      if (
        this.isJointId(runtime.playerJointId) &&
        this.box2d.b2Joint_IsValid(runtime.playerJointId)
      ) {
        this.box2d.b2DistanceJoint_SetSpringHertz(
          runtime.playerJointId,
          this.ropeHertz
        )
        this.box2d.b2DistanceJoint_SetSpringDampingRatio(
          runtime.playerJointId,
          this.ropeDampingRatio
        )
      }
    })
  }

  update(entities: Entity[], deltaTime: number): void {
    const deltaMs = Math.max(0, deltaTime * 1000)
    this.currentTimeMs += deltaMs

    if (this.anchorsDirty) {
      this.refreshAnchorCache()
    }

    for (let i = 0; i < entities.length; i++) {
      const entity = entities[i]
      if (!entity.transform || !entity.physics || !entity.input) {
        continue
      }
      const grapple = entity.grapple
      if (!grapple) continue

      const facing =
        entity.input.lastMoveDirection !== 0
          ? entity.input.lastMoveDirection
          : 1
      grapple.hasAnchorNearby = this.findAnchorTarget(
        entity.transform.x,
        entity.transform.y,
        facing,
        this.tempTarget,
        entity.render?.renderLayer ?? 0
      )

      if (!grapple.hasGrapple) {
        if (grapple.isTethering) {
          this.destroyAnchorTether(entity, grapple)
        }
        grapple.isPulling = false
        grapple.retainAirMomentum = false
        grapple.pullMode = this.pullModeAnchor
        grapple.targetEntityId = -1
        entity.input.grappleLengthAdjustSteps = 0
        continue
      }

      if (entity.stats?.isDead) {
        this.stopPull(entity, grapple, false)
        entity.input.grappleLengthAdjustSteps = 0
        continue
      }

      if (entity.isStunned()) {
        this.stopPull(entity, grapple, false)
        entity.input.grappleLengthAdjustSteps = 0
        continue
      }

      const inputBuffer = entity.input.inputBuffer
      const grappleActionActive = inputBuffer.hasActiveAction('grapple')

      if (
        grapple.isPulling &&
        grapple.isTethering &&
        grappleActionActive &&
        this.currentTimeMs >= grapple.cooldownEndTime
      ) {
        this.destroyAnchorTether(entity, grapple)
        grapple.isPulling = false
        grapple.isTethering = false
        grapple.retainAirMomentum = false
        grapple.pullMode = this.pullModeAnchor
        grapple.targetEntityId = -1
        grapple.desiredDistanceSq = 0
        grapple.moveLockEndTime = 0
        inputBuffer.clearAction('grapple')
        continue
      }

      if (grapple.isPulling) {
        this.updatePull(entity, grapple, deltaMs)
        continue
      }

      entity.input.grappleLengthAdjustSteps = 0

      if (!grappleActionActive) {
        continue
      }

      if (this.currentTimeMs < grapple.cooldownEndTime) {
        inputBuffer.clearAction('grapple')
        continue
      }

      const canUse = !entity.isStunned()

      if (canUse) {
        const lockedTargetId = entity.input.lockedTargetId
        if (lockedTargetId !== null) {
          const lockedTarget = this.getEntityById(lockedTargetId)
          if (lockedTarget && this.canUseLockedTarget(entity, lockedTarget)) {
            const dx = lockedTarget.transform.x - entity.transform.x
            const dy = lockedTarget.transform.y - entity.transform.y
            const distSq = dx * dx + dy * dy
            if (distSq <= this.rangeSq) {
              const playerToughness = entity.stats?.toughness ?? 0
              const targetToughness = this.getTargetToughness(lockedTarget)
              const desiredDistance = this.getAttackDistance(
                entity,
                lockedTarget
              )
              grapple.targetX = lockedTarget.transform.x
              grapple.targetY = lockedTarget.transform.y
              grapple.targetEntityId = lockedTarget.id
              grapple.pullElapsedMs = 0
              grapple.isPulling = true
              grapple.cooldownEndTime = this.currentTimeMs
              grapple.desiredDistanceSq = desiredDistance * desiredDistance
              this.statsSystem?.playSoundAt(
                SOUND_IDS.GRAPPLE_PULL_START,
                entity.transform.x,
                entity.transform.y
              )

              if (
                entity.input.grapplePersistentRequested &&
                lockedTarget.grappleTarget?.canTether === true
              ) {
                if (this.startAnchorTether(entity, grapple, lockedTarget)) {
                  grapple.pullMode = this.pullModeAnchorTether
                  grapple.isTethering = true
                } else {
                  this.stopPull(entity, grapple, false)
                }
              } else {
                this.triggerNpcAggro(entity, lockedTarget)
                if (targetToughness <= playerToughness) {
                  if (lockedTarget.grappleTarget) {
                    grapple.pullMode = this.pullModeObject
                  } else {
                    grapple.pullMode = this.pullModeNpc
                    this.applyNpcStun(lockedTarget, grapple.pullDurationMs)
                  }
                } else {
                  const isGrounded = lockedTarget.movement?.isGrounded ?? false
                  grapple.pullMode = isGrounded
                    ? this.pullModePlayerLinear
                    : this.pullModePlayerArc
                  if (grapple.pullMode === this.pullModePlayerArc) {
                    this.applyGrappleImpulse(entity, grapple)
                  }
                }
              }
            }
          }
        } else {
          const facing =
            entity.input.lastMoveDirection !== 0
              ? entity.input.lastMoveDirection
              : 1
          const currentTargetX = grapple.isTethering
            ? grapple.targetX
            : undefined
          const currentTargetY = grapple.isTethering
            ? grapple.targetY
            : undefined
          const wantsPersistent = entity.input.grapplePersistentRequested
          const grappleTarget = wantsPersistent
            ? this.findGrappleTargetAnchor(
                entity.transform.x,
                entity.transform.y,
                facing,
                this.tempTarget,
                entity.render?.renderLayer ?? 0,
                currentTargetX,
                currentTargetY
              )
            : null

          if (grappleTarget) {
            grapple.targetX = this.tempTarget.x
            grapple.targetY = this.tempTarget.y
            grapple.targetEntityId = grappleTarget.id
            grapple.desiredDistanceSq = 0
            grapple.pullElapsedMs = 0
            grapple.isPulling = true
            grapple.cooldownEndTime = this.currentTimeMs
            this.statsSystem?.playSoundAt(
              SOUND_IDS.GRAPPLE_PULL_START,
              entity.transform.x,
              entity.transform.y
            )

            if (this.startAnchorTether(entity, grapple, grappleTarget)) {
              grapple.pullMode = this.pullModeAnchorTether
              grapple.isTethering = true
            } else {
              this.stopPull(entity, grapple, false)
            }
          } else if (
            this.findAnchorTarget(
              entity.transform.x,
              entity.transform.y,
              facing,
              this.tempTarget,
              entity.render?.renderLayer ?? 0,
              currentTargetX,
              currentTargetY
            )
          ) {
            grapple.targetX = this.tempTarget.x
            grapple.targetY = this.tempTarget.y
            grapple.targetEntityId = -1
            grapple.desiredDistanceSq = 0
            grapple.pullElapsedMs = 0
            grapple.isPulling = true
            grapple.cooldownEndTime = this.currentTimeMs
            this.statsSystem?.playSoundAt(
              SOUND_IDS.GRAPPLE_PULL_START,
              entity.transform.x,
              entity.transform.y
            )

            if (wantsPersistent) {
              if (this.startAnchorTether(entity, grapple)) {
                grapple.pullMode = this.pullModeAnchorTether
                grapple.isTethering = true
              } else {
                this.stopPull(entity, grapple, false)
              }
            } else {
              grapple.pullMode = this.pullModeAnchor
              grapple.isTethering = false
              this.applyGrappleImpulse(entity, grapple)
            }
          }
        }
      }

      inputBuffer.clearAction('grapple')
    }
  }

  writeActiveRopePoints(
    entity: Entity,
    targetBuffer: Float32Array<ArrayBufferLike>,
    startOffset: number,
    maxPoints: number
  ): number {
    const grapple = entity.grapple
    if (!grapple || !grapple.isTethering || !grapple.isPulling) {
      return 0
    }
    const runtime = this.ropeRuntimeByEntityId.get(entity.id)
    if (!runtime || !runtime.active || maxPoints < 2) {
      return 0
    }

    let pointCount = 0
    let outOffset = startOffset

    targetBuffer[outOffset] = grapple.targetX
    targetBuffer[outOffset + 1] = grapple.targetY
    pointCount += 1
    outOffset += 2

    const visibleCount = runtime.attachIndex + 1
    for (let i = 0; i < visibleCount && pointCount < maxPoints - 1; i++) {
      const bodyId = runtime.segmentBodies[i]
      if (!this.isBodyId(bodyId) || !this.box2d.b2Body_IsValid(bodyId)) {
        continue
      }
      const pos = this.box2d.b2Body_GetPosition(bodyId)
      targetBuffer[outOffset] = pos.x
      targetBuffer[outOffset + 1] = pos.y
      pointCount += 1
      outOffset += 2
      pos.delete()
    }

    if (entity.transform && pointCount < maxPoints) {
      targetBuffer[outOffset] = entity.transform.x
      targetBuffer[outOffset + 1] = entity.transform.y
      pointCount += 1
    }

    return pointCount
  }

  private refreshAnchorCache(): void {
    this.anchorEntities.length = 0
    this.grappleTargetEntities.length = 0
    const entities = this.world.getEntities()
    for (let i = 0; i < entities.length; i++) {
      const entity = entities[i]
      if (entity.grappleAnchor && entity.transform) {
        this.anchorEntities.push(entity)
      }
      if (entity.grappleTarget && entity.transform) {
        this.grappleTargetEntities.push(entity)
      }
    }
    this.anchorsDirty = false
  }

  private findAnchorTarget(
    x: number,
    y: number,
    facing: number,
    out: { x: number; y: number },
    renderLayer: number,
    currentTargetX?: number,
    currentTargetY?: number
  ): boolean {
    let bestDistSq = this.rangeSq + 1
    let bestX = 0
    let bestY = 0
    const forwardX = facing >= 0 ? 1 : -1

    for (let i = 0; i < this.anchorEntities.length; i++) {
      const anchor = this.anchorEntities[i]
      const anchorPos = anchor.transform
      if (!anchorPos) continue
      if ((anchor.render?.renderLayer ?? 0) !== renderLayer) continue

      if (
        currentTargetX !== undefined &&
        currentTargetY !== undefined &&
        Math.abs(anchorPos.x - currentTargetX) < 0.01 &&
        Math.abs(anchorPos.y - currentTargetY) < 0.01
      ) {
        continue
      }

      const dx = anchorPos.x - x
      const dy = anchorPos.y - y
      const distSq = dx * dx + dy * dy
      if (distSq > this.rangeSq || distSq <= 0) continue
      const invDist = 1 / Math.sqrt(distSq)
      const dot = dx * forwardX * invDist
      if (dot < this.cosHalfFov) continue
      if (distSq < bestDistSq) {
        bestDistSq = distSq
        bestX = anchorPos.x
        bestY = anchorPos.y
      }
    }

    if (bestDistSq <= this.rangeSq) {
      out.x = bestX
      out.y = bestY
      return true
    }

    return false
  }

  private findGrappleTargetAnchor(
    x: number,
    y: number,
    facing: number,
    out: { x: number; y: number },
    renderLayer: number,
    currentTargetX?: number,
    currentTargetY?: number
  ): Entity | null {
    let bestDistSq = this.rangeSq + 1
    let bestTarget: Entity | null = null
    const forwardX = facing >= 0 ? 1 : -1

    for (let i = 0; i < this.grappleTargetEntities.length; i++) {
      const target = this.grappleTargetEntities[i]
      const targetPos = target.transform
      if (!targetPos || !target.grappleTarget?.canTether) continue
      if ((target.render?.renderLayer ?? 0) !== renderLayer) continue
      if (!this.getValidBodyId(target)) continue

      if (
        currentTargetX !== undefined &&
        currentTargetY !== undefined &&
        Math.abs(targetPos.x - currentTargetX) < 0.01 &&
        Math.abs(targetPos.y - currentTargetY) < 0.01
      ) {
        continue
      }

      const dx = targetPos.x - x
      const dy = targetPos.y - y
      const distSq = dx * dx + dy * dy
      if (distSq > this.rangeSq || distSq <= 0) continue
      const invDist = 1 / Math.sqrt(distSq)
      const dot = dx * forwardX * invDist
      if (dot < this.cosHalfFov) continue
      if (distSq < bestDistSq) {
        bestDistSq = distSq
        bestTarget = target
      }
    }

    if (bestTarget?.transform) {
      out.x = bestTarget.transform.x
      out.y = bestTarget.transform.y
      return bestTarget
    }

    return null
  }

  private updatePull(
    entity: Entity,
    grapple: NonNullable<Entity['grapple']>,
    deltaMs: number
  ): void {
    if (!entity.physics || !entity.transform || !entity.input) {
      grapple.isPulling = false
      return
    }

    grapple.pullElapsedMs += deltaMs

    if (grapple.pullMode === this.pullModeAnchorTether) {
      this.updateAnchorTether(entity, grapple, deltaMs)
      return
    }

    if (grapple.targetEntityId >= 0) {
      const targetEntity = this.getEntityById(grapple.targetEntityId)
      if (!targetEntity || !targetEntity.transform) {
        this.stopPull(entity, grapple, false)
        return
      }
      grapple.targetX = targetEntity.transform.x
      grapple.targetY = targetEntity.transform.y
    }
    const dx = grapple.targetX - entity.transform.x
    const dy = grapple.targetY - entity.transform.y
    const distSq = dx * dx + dy * dy
    const radius = entity.render?.radius ?? 0.5
    const clearance = radius + 0.1

    if (
      grapple.pullMode === this.pullModeNpc ||
      grapple.pullMode === this.pullModeObject
    ) {
      const isObjectPull = grapple.pullMode === this.pullModeObject
      const targetEntity = this.getEntityById(grapple.targetEntityId)
      if (
        !targetEntity ||
        !targetEntity.transform ||
        !this.getValidBodyId(targetEntity)
      ) {
        this.stopPull(entity, grapple, false)
        return
      }
      if (grapple.pullElapsedMs >= grapple.pullDurationMs) {
        this.stopLinearMotion(targetEntity)
        this.stopPull(entity, grapple, false)
        if (!isObjectPull) {
          this.applyNpcStun(targetEntity, DEFAULT_GRAPPLE_ENEMY_STUN_EXTRA_MS)
        }
        return
      }
      if (distSq <= grapple.desiredDistanceSq) {
        this.stopLinearMotion(targetEntity)
        this.stopPull(entity, grapple, true)
        if (!isObjectPull) {
          this.applyNpcStun(targetEntity, DEFAULT_GRAPPLE_ENEMY_STUN_EXTRA_MS)
        }
        return
      }
      this.applyLinearPull(targetEntity, entity, grapple.pullSpeed)
      return
    }

    if (grapple.pullMode === this.pullModePlayerLinear) {
      if (grapple.pullElapsedMs >= grapple.pullDurationMs) {
        this.stopLinearMotion(entity)
        this.stopPull(entity, grapple, false)
        return
      }
      if (distSq <= grapple.desiredDistanceSq) {
        this.stopLinearMotion(entity)
        this.stopPull(entity, grapple, true)
        return
      }
      this.applyLinearPull(entity, null, grapple.pullSpeed)
      return
    }

    if (
      grapple.pullMode === this.pullModeAnchor &&
      distSq <= this.ropeHideDistanceSq
    ) {
      this.stopPull(entity, grapple, true)
      return
    }

    if (
      distSq <= this.stopDistanceSq ||
      grapple.pullElapsedMs >= grapple.pullDurationMs
    ) {
      this.stopPull(entity, grapple, false)
      return
    }
    if (entity.transform.y <= grapple.targetY - clearance) {
      this.stopPull(entity, grapple, true)
    }
  }

  private stopPull(
    entity: Entity,
    grapple: NonNullable<Entity['grapple']>,
    allowImmediateRetry: boolean
  ): void {
    if (grapple.isTethering) {
      this.destroyAnchorTether(entity, grapple)
    }

    grapple.isPulling = false
    grapple.moveLockEndTime = 0
    if (
      grapple.pullMode === this.pullModeAnchor ||
      grapple.pullMode === this.pullModePlayerArc ||
      grapple.pullMode === this.pullModePlayerLinear ||
      grapple.pullMode === this.pullModeAnchorTether
    ) {
      grapple.retainAirMomentum = true
    }
    if (grapple.pullMode === this.pullModeNpc) {
      grapple.cooldownEndTime =
        this.currentTimeMs + DEFAULT_GRAPPLE_ENEMY_COOLDOWN_MS
    } else if (allowImmediateRetry) {
      grapple.cooldownEndTime = this.currentTimeMs
    }
    grapple.pullMode = this.pullModeAnchor
    grapple.targetEntityId = -1
    grapple.desiredDistanceSq = 0
  }

  private applyLinearPull(
    entity: Entity,
    target: Entity | null,
    speed: number
  ): void {
    const bodyId = this.getValidBodyId(entity)
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
    this.tempVec.x = dx * invDist * speed
    this.tempVec.y = dy * invDist * speed
    this.box2d.b2Body_SetLinearVelocity(bodyId, this.tempVec)
  }

  private stopLinearMotion(entity: Entity): void {
    const bodyId = this.getValidBodyId(entity)
    if (!bodyId) return
    this.tempVec.x = 0
    this.tempVec.y = 0
    this.box2d.b2Body_SetLinearVelocity(bodyId, this.tempVec)
  }

  private getValidBodyId(entity: Entity): b2BodyId | null {
    const bodyId = entity.physics?.bodyId ?? entity.grappleTarget?.bodyId
    if (!this.isBodyId(bodyId) || !this.box2d.b2Body_IsValid(bodyId)) {
      return null
    }
    return bodyId
  }

  private isBodyId(bodyId: b2BodyId | null | undefined): bodyId is b2BodyId {
    return bodyId !== null && bodyId !== undefined && typeof bodyId === 'object'
  }

  private isJointId(
    jointId: b2JointId | null | undefined
  ): jointId is b2JointId {
    return (
      jointId !== null && jointId !== undefined && typeof jointId === 'object'
    )
  }

  private canUseLockedTarget(
    owner: Entity,
    target: Entity
  ): target is Entity & { transform: NonNullable<Entity['transform']> } {
    if (target.id === owner.id || !target.transform) {
      return false
    }
    if (
      (target.render?.renderLayer ?? 0) !== (owner.render?.renderLayer ?? 0)
    ) {
      return false
    }
    if (target.stats && (target.stats.isDead || target.stats.isVanished)) {
      return false
    }
    if (target.grappleTarget) {
      return (
        target.grappleTarget.canPull && this.getValidBodyId(target) !== null
      )
    }
    return target.stats !== undefined && this.getValidBodyId(target) !== null
  }

  private getTargetToughness(entity: Entity): number {
    if (entity.grappleTarget) {
      return entity.grappleTarget.toughness
    }
    return entity.stats?.toughness ?? 0
  }

  private getEntityById(id: number): Entity | null {
    const entities = this.world.getEntities()
    for (let i = 0; i < entities.length; i++) {
      const entity = entities[i]
      if (entity.id === id) {
        return entity
      }
    }
    return null
  }

  private getAttackDistance(attacker: Entity, target: Entity): number {
    const attackerRadius = attacker.render?.radius ?? DEFAULT_PLAYER_RADIUS
    const targetRadius = target.render?.radius ?? DEFAULT_PLAYER_RADIUS
    const weaponWidth = attacker.weapon?.width ?? 0
    if (attacker.weapon?.weaponType !== undefined) {
      return attackerRadius + weaponWidth / 2 + targetRadius
    }
    return DEFAULT_WEAPON_ATTACK_RADIUS + targetRadius
  }

  private applyNpcStun(entity: Entity, durationMs: number): void {
    if (!entity.movement) return
    if (durationMs <= 0) return
    entity.movement.knockbackDuration = durationMs
    entity.movement.knockbackElapsedTime = 0
    entity.movement.knockbackEndTime = this.currentTimeMs + durationMs
  }

  private triggerNpcAggro(attacker: Entity, target: Entity): void {
    if (!target.npcAI) return
    if (!target.npcAI || !target.input) return
    if (target.stats?.isDead) return

    target.npcAI.alertChaseActive = true
    target.npcAI.alertTimeRemainingMs = 0
    target.npcAI.state = 'approach'
    target.npcAI.targetLostTimer = 0
    if (attacker.transform && target.transform) {
      const dx = attacker.transform.x - target.transform.x
      target.npcAI.forcedChaseDirection = dx >= 0 ? 1 : -1
      target.npcAI.forcedChaseDistanceRemaining = Math.max(
        3,
        target.npcAI.detectionRange / 2
      )
      target.npcAI.forcedChaseLastX = target.transform.x
    }

    target.input.lockedTargetId = attacker.id
    target.input.lockLostTimer = 0

    if (target.stats) {
      target.stats.isInCombat = true
      target.stats.combatExitTimer = 0
    }
  }

  private applyGrappleImpulse(
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

    this.tempVec.x = vx
    this.tempVec.y = vy
    grapple.startX = startX
    grapple.startY = startY
    grapple.velocityX = this.tempVec.x
    grapple.velocityY = this.tempVec.y
    this.box2d.b2Body_SetLinearVelocity(entity.physics.bodyId, this.tempVec)
  }

  private getOrCreateRopeRuntime(entityId: number): RopeRuntime {
    const existing = this.ropeRuntimeByEntityId.get(entityId)
    if (existing) {
      return existing
    }
    const runtime: RopeRuntime = {
      active: false,
      anchorBodyId: null,
      anchorBodyOwned: false,
      anchorEntityId: -1,
      anchorLocalX: 0,
      anchorLocalY: 0,
      playerAnchorBodyId: null,
      anchorFollowX: 0,
      anchorFollowY: 0,
      playerFollowX: 0,
      playerFollowY: 0,
      segmentCount: 0,
      linkLength: DEFAULT_GRAPPLE_ROPE_SEGMENT_LENGTH,
      attachIndex: -1,
      playerJointId: null,
      segmentBodies: [],
      segmentJoints: [],
      segmentFilterJoints: [],
      jointMaxLen: 0,
      maxRopeLength: 0,
    }
    this.ropeRuntimeByEntityId.set(entityId, runtime)
    return runtime
  }

  private startAnchorTether(
    entity: Entity,
    grapple: NonNullable<Entity['grapple']>,
    anchorEntity?: Entity
  ): boolean {
    if (!entity.transform || !entity.physics) {
      return false
    }

    const runtime = this.getOrCreateRopeRuntime(entity.id)
    this.destroyAnchorTether(entity, grapple)

    let anchorBodyId: b2BodyId | null = null
    let anchorBodyOwned = true
    let anchorEntityId = -1
    let anchorLocalX = 0
    let anchorLocalY = 0
    const dx = entity.transform.x - grapple.targetX
    const dy = entity.transform.y - grapple.targetY
    const currentDist = Math.sqrt(dx * dx + dy * dy)

    if (anchorEntity) {
      if (!anchorEntity.transform) {
        return false
      }
      const targetBodyId = this.getValidBodyId(anchorEntity)
      if (!targetBodyId) {
        return false
      }
      anchorBodyId = targetBodyId
      anchorBodyOwned = false
      anchorEntityId = anchorEntity.id
      anchorLocalX = anchorEntity.grappleTarget?.anchorLocalX ?? 0
      anchorLocalY = anchorEntity.grappleTarget?.anchorLocalY ?? 0
      grapple.targetX = anchorEntity.transform.x
      grapple.targetY = anchorEntity.transform.y
      grapple.targetEntityId = anchorEntity.id
      if (
        !this.buildDynamicAnchorTether(
          entity,
          runtime,
          anchorEntity.id,
          targetBodyId,
          anchorEntity.transform.x,
          anchorEntity.transform.y,
          anchorLocalX,
          anchorLocalY,
          currentDist
        )
      ) {
        return false
      }
      runtime.active = true
      return true
    } else {
      anchorBodyId = this.createAnchorBody(grapple.targetX, grapple.targetY)
      grapple.targetEntityId = -1
    }

    if (!this.isBodyId(anchorBodyId)) {
      return false
    }

    runtime.maxRopeLength = DEFAULT_GRAPPLE_RANGE
    this.buildAnchorTether(
      entity,
      runtime,
      grapple.targetX,
      grapple.targetY,
      currentDist,
      anchorBodyId,
      anchorBodyOwned,
      anchorEntityId,
      anchorLocalX,
      anchorLocalY
    )
    runtime.active = true

    this.applyTetherSwingImpulse(entity, grapple)

    return true
  }

  private buildDynamicAnchorTether(
    entity: Entity,
    runtime: RopeRuntime,
    anchorEntityId: number,
    connectedBodyId: b2BodyId,
    anchorX: number,
    anchorY: number,
    anchorLocalX: number,
    anchorLocalY: number,
    initialLength: number
  ): boolean {
    if (!entity.transform) {
      return false
    }

    const playerX = entity.transform.x
    const playerY = entity.transform.y
    const initialRopeLength = Math.max(
      DEFAULT_GRAPPLE_TETHER_MIN_LENGTH,
      initialLength
    )
    const maxLength = Math.max(DEFAULT_GRAPPLE_RANGE, initialRopeLength)
    const linkCount = Math.max(
      2,
      Math.min(
        DEFAULT_GRAPPLE_ROPE_MAX_SEGMENTS,
        Math.ceil(maxLength / DEFAULT_GRAPPLE_ROPE_SEGMENT_LENGTH)
      )
    )
    const segmentCount = linkCount - 1
    const linkLength = maxLength / linkCount
    const initialLinkCount = Math.max(
      1,
      Math.min(linkCount, Math.ceil(initialRopeLength / linkLength))
    )
    const initialSegmentCount = initialLinkCount - 1
    const renderLayer = entity.render?.renderLayer ?? 0
    const anchorBodyId = this.createKinematicAnchorBody(anchorX, anchorY)
    const playerAnchorBodyId = this.createKinematicAnchorBody(playerX, playerY)

    runtime.anchorBodyId = anchorBodyId
    runtime.anchorBodyOwned = true
    runtime.anchorEntityId = anchorEntityId
    runtime.anchorLocalX = anchorLocalX
    runtime.anchorLocalY = anchorLocalY
    runtime.playerAnchorBodyId = playerAnchorBodyId
    runtime.anchorFollowX = anchorX
    runtime.anchorFollowY = anchorY
    runtime.playerFollowX = playerX
    runtime.playerFollowY = playerY
    runtime.segmentCount = segmentCount
    runtime.linkLength = linkLength
    runtime.attachIndex = initialSegmentCount - 1
    runtime.jointMaxLen = Math.max(
      0.01,
      Math.min(linkLength, initialRopeLength - initialSegmentCount * linkLength)
    )
    runtime.maxRopeLength = maxLength
    runtime.segmentBodies.length = 0
    runtime.segmentJoints.length = 0
    runtime.segmentFilterJoints.length = 0

    const dx = playerX - anchorX
    const dy = playerY - anchorY
    const distSq = dx * dx + dy * dy
    const invDist = distSq > 0.0001 ? 1 / Math.sqrt(distSq) : 0
    const dirX = distSq > 0.0001 ? dx * invDist : 0
    const dirY = distSq > 0.0001 ? dy * invDist : 1
    const categoryBits =
      getRopeCollisionCategory(renderLayer) |
      getWeaponCollisionCategory(renderLayer)
    const maskBits =
      getGroundCollisionCategory(renderLayer) |
      getObstacleCollisionCategory(renderLayer)

    let previousBodyId = anchorBodyId
    for (let i = 0; i < segmentCount; i++) {
      const centerFactor = i + 1
      const centerX = anchorX + dirX * (centerFactor * linkLength)
      const centerY = anchorY + dirY * (centerFactor * linkLength)
      const segmentBodyId = this.createRopeSegmentBody(
        centerX,
        centerY,
        renderLayer,
        this.dynamicTetherRopeDensity,
        categoryBits,
        maskBits
      )
      runtime.segmentBodies.push(segmentBodyId)
      runtime.segmentFilterJoints.push(
        this.createBodyCollisionFilterJoint(segmentBodyId, connectedBodyId)
      )
      const segmentJointId = this.createFixedDistanceJoint(
        previousBodyId,
        segmentBodyId,
        linkLength
      )
      runtime.segmentJoints.push(segmentJointId)
      previousBodyId = segmentBodyId
    }

    const attachBodyId =
      runtime.attachIndex >= 0
        ? runtime.segmentBodies[runtime.attachIndex]
        : anchorBodyId
    runtime.playerJointId = this.createFixedDistanceJoint(
      attachBodyId,
      playerAnchorBodyId,
      runtime.jointMaxLen
    )
    return true
  }

  private buildAnchorTether(
    entity: Entity,
    runtime: RopeRuntime,
    anchorX: number,
    anchorY: number,
    initialLength: number,
    anchorBodyId: b2BodyId,
    anchorBodyOwned: boolean,
    anchorEntityId: number,
    anchorLocalX: number,
    anchorLocalY: number
  ): void {
    if (!entity.transform || !entity.physics) return
    const maxLength = DEFAULT_GRAPPLE_RANGE
    const linkCount = Math.max(
      1,
      Math.min(
        DEFAULT_GRAPPLE_ROPE_MAX_SEGMENTS,
        Math.ceil(maxLength / DEFAULT_GRAPPLE_ROPE_SEGMENT_LENGTH)
      )
    )
    const segmentCount = linkCount - 1
    const linkLength = maxLength / linkCount

    const initialLinkCount = Math.max(
      1,
      Math.min(linkCount, Math.ceil(initialLength / linkLength))
    )
    const initialSegmentCount = initialLinkCount - 1

    runtime.anchorBodyId = anchorBodyId
    runtime.anchorBodyOwned = anchorBodyOwned
    runtime.anchorEntityId = anchorEntityId
    runtime.anchorLocalX = anchorLocalX
    runtime.anchorLocalY = anchorLocalY

    const dx = entity.transform.x - anchorX
    const dy = entity.transform.y - anchorY
    const distSq = dx * dx + dy * dy
    const invDist = distSq > 0.0001 ? 1 / Math.sqrt(distSq) : 0
    const dirX = distSq > 0.0001 ? dx * invDist : 0
    const dirY = distSq > 0.0001 ? dy * invDist : 1

    runtime.segmentBodies.length = 0
    runtime.segmentJoints.length = 0
    runtime.segmentFilterJoints.length = 0

    let previousBodyId = anchorBodyId
    for (let i = 0; i < segmentCount; i++) {
      const centerFactor = i + 1
      const centerX = anchorX + dirX * (centerFactor * linkLength)
      const centerY = anchorY + dirY * (centerFactor * linkLength)
      const segmentBodyId = this.createRopeSegmentBody(
        centerX,
        centerY,
        entity.render?.renderLayer ?? 0
      )
      runtime.segmentBodies.push(segmentBodyId)
      const localAX = i === 0 ? runtime.anchorLocalX : 0
      const localAY = i === 0 ? runtime.anchorLocalY : 0
      const segmentJointId = this.createFixedDistanceJoint(
        previousBodyId,
        segmentBodyId,
        linkLength,
        localAX,
        localAY
      )
      runtime.segmentJoints.push(segmentJointId)
      previousBodyId = segmentBodyId
    }

    runtime.segmentCount = segmentCount
    runtime.linkLength = linkLength
    runtime.attachIndex = initialSegmentCount - 1

    const attachBodyId =
      runtime.attachIndex >= 0
        ? runtime.segmentBodies[runtime.attachIndex]
        : anchorBodyId
    const attachLocalX = runtime.attachIndex >= 0 ? 0 : runtime.anchorLocalX
    const attachLocalY = runtime.attachIndex >= 0 ? 0 : runtime.anchorLocalY
    const initialRemainder = initialLength - initialSegmentCount * linkLength
    runtime.jointMaxLen = Math.max(0.01, Math.min(linkLength, initialRemainder))
    runtime.playerJointId = this.createFixedDistanceJoint(
      attachBodyId,
      entity.physics.bodyId,
      runtime.jointMaxLen,
      attachLocalX,
      attachLocalY
    )
  }

  private updateAnchorTether(
    entity: Entity,
    grapple: NonNullable<Entity['grapple']>,
    deltaMs: number
  ): void {
    if (!entity.input || !entity.physics || !entity.movement) {
      this.stopPull(entity, grapple, false)
      return
    }

    const runtime = this.ropeRuntimeByEntityId.get(entity.id)
    if (!runtime || !runtime.active) {
      this.stopPull(entity, grapple, false)
      return
    }

    const isDynamicAnchor = runtime.anchorEntityId >= 0

    if (entity.input.jumpRequested && !entity.movement.isGrounded) {
      if (!isDynamicAnchor) {
        entity.input.jumpRequested = false
        this.stopPull(entity, grapple, true)
        this.performRopeJump(entity, grapple)
        return
      }
    }

    if (!this.syncTetherAnchorTarget(runtime, grapple)) {
      this.stopPull(entity, grapple, false)
      return
    }

    entity.input.grappleLengthAdjustSteps = 0

    if (isDynamicAnchor) {
      if (!this.syncDynamicTetherEndpointBodies(entity, runtime, deltaMs)) {
        this.stopPull(entity, grapple, false)
        return
      }
      const playerAnchorBodyId = runtime.playerAnchorBodyId
      if (!this.isBodyId(playerAnchorBodyId)) {
        this.stopPull(entity, grapple, false)
        return
      }
      this.adjustTetherLength(
        entity,
        runtime,
        deltaMs,
        playerAnchorBodyId,
        false
      )
      this.applyDynamicTetherTension(entity, runtime)
      return
    }

    const anchorBodyId = runtime.anchorBodyId
    if (!this.isBodyId(anchorBodyId)) {
      this.stopPull(entity, grapple, false)
      return
    }

    this.handleSwingInput(entity, grapple, deltaMs)
    this.adjustTetherLength(
      entity,
      runtime,
      deltaMs,
      entity.physics.bodyId,
      true
    )
  }

  private adjustTetherLength(
    entity: Entity,
    runtime: RopeRuntime,
    deltaMs: number,
    playerBodyId: b2BodyId,
    useAnchorLocal: boolean
  ): void {
    if (!entity.input) return
    const climbDir = entity.input.grappleClimbHeld
    if (climbDir === 0) return

    const linkLen = runtime.linkLength
    const delta = (GRAPPLE_CLIMB_SPEED * deltaMs) / 1000

    if (climbDir < 0) {
      runtime.jointMaxLen -= delta

      while (runtime.jointMaxLen <= 0 && runtime.attachIndex > -1) {
        runtime.attachIndex--
        runtime.jointMaxLen += linkLen
      }
      if (runtime.attachIndex <= -1) {
        runtime.attachIndex = -1
        if (runtime.jointMaxLen < 0) runtime.jointMaxLen = 0
      }
    } else {
      const currentTotalLength = this.calculateCurrentRopeLength(runtime)
      if (currentTotalLength >= runtime.maxRopeLength) {
        return
      }

      runtime.jointMaxLen += delta

      while (
        runtime.jointMaxLen >= linkLen * 2 &&
        runtime.attachIndex < runtime.segmentCount - 1
      ) {
        const nextIdx = runtime.attachIndex + 1
        this.repositionSegment(entity, runtime, nextIdx)
        runtime.attachIndex = nextIdx
        runtime.jointMaxLen -= linkLen
      }
      if (runtime.attachIndex >= runtime.segmentCount - 1) {
        if (runtime.jointMaxLen > linkLen) runtime.jointMaxLen = linkLen
      }
    }

    this.rebuildPlayerTetherJoint(runtime, playerBodyId, useAnchorLocal)
  }

  private rebuildPlayerTetherJoint(
    runtime: RopeRuntime,
    playerBodyId: b2BodyId,
    useAnchorLocal: boolean
  ): void {
    const anchorBodyId = runtime.anchorBodyId
    if (!this.isBodyId(anchorBodyId)) return
    this.destroyJointIfValid(runtime.playerJointId)
    const attachBodyId =
      runtime.attachIndex >= 0
        ? runtime.segmentBodies[runtime.attachIndex]
        : anchorBodyId
    const attachLocalX =
      useAnchorLocal && runtime.attachIndex < 0 ? runtime.anchorLocalX : 0
    const attachLocalY =
      useAnchorLocal && runtime.attachIndex < 0 ? runtime.anchorLocalY : 0
    runtime.playerJointId = this.createFixedDistanceJoint(
      attachBodyId,
      playerBodyId,
      Math.max(0.01, runtime.jointMaxLen),
      attachLocalX,
      attachLocalY
    )
  }

  private syncTetherAnchorTarget(
    runtime: RopeRuntime,
    grapple: NonNullable<Entity['grapple']>
  ): boolean {
    if (runtime.anchorEntityId < 0) {
      return true
    }
    const anchorEntity = this.getEntityById(runtime.anchorEntityId)
    if (!anchorEntity?.transform || !this.getValidBodyId(anchorEntity)) {
      return false
    }
    grapple.targetX = anchorEntity.transform.x
    grapple.targetY = anchorEntity.transform.y
    grapple.targetEntityId = anchorEntity.id
    return true
  }

  private hasDynamicAnchorTether(entity: Entity): boolean {
    const runtime = this.ropeRuntimeByEntityId.get(entity.id)
    return runtime?.active === true && runtime.anchorEntityId >= 0
  }

  private syncDynamicTetherEndpointBodies(
    entity: Entity,
    runtime: RopeRuntime,
    deltaMs: number
  ): boolean {
    if (!entity.transform || runtime.anchorEntityId < 0) {
      return false
    }
    const anchorEntity = this.getEntityById(runtime.anchorEntityId)
    if (
      !anchorEntity?.transform ||
      !this.isBodyId(runtime.anchorBodyId) ||
      !this.isBodyId(runtime.playerAnchorBodyId)
    ) {
      return false
    }

    this.syncKinematicAnchorBody(
      runtime.anchorBodyId,
      anchorEntity.transform.x,
      anchorEntity.transform.y,
      runtime.anchorFollowX,
      runtime.anchorFollowY,
      deltaMs
    )
    runtime.anchorFollowX = anchorEntity.transform.x
    runtime.anchorFollowY = anchorEntity.transform.y

    this.syncKinematicAnchorBody(
      runtime.playerAnchorBodyId,
      entity.transform.x,
      entity.transform.y,
      runtime.playerFollowX,
      runtime.playerFollowY,
      deltaMs
    )
    runtime.playerFollowX = entity.transform.x
    runtime.playerFollowY = entity.transform.y
    return true
  }

  private syncKinematicAnchorBody(
    bodyId: b2BodyId,
    x: number,
    y: number,
    previousX: number,
    previousY: number,
    deltaMs: number
  ): void {
    const invDelta = deltaMs > 0 ? 1000 / deltaMs : 0
    this.tempVec.x = (x - previousX) * invDelta
    this.tempVec.y = (y - previousY) * invDelta
    this.box2d.b2Body_SetLinearVelocity(bodyId, this.tempVec)
    this.tempVec.x = x
    this.tempVec.y = y
    this.box2d.b2Body_SetTransform(bodyId, this.tempVec, this.tempRot)
  }

  private applyDynamicTetherTension(
    entity: Entity,
    runtime: RopeRuntime
  ): void {
    if (!entity.transform || runtime.anchorEntityId < 0) {
      return
    }

    const anchorEntity = this.getEntityById(runtime.anchorEntityId)
    if (!anchorEntity?.transform) {
      return
    }

    const anchorBodyId = this.getValidBodyId(anchorEntity)
    if (!anchorBodyId) {
      return
    }

    const dx = entity.transform.x - anchorEntity.transform.x
    const dy = entity.transform.y - anchorEntity.transform.y
    const distSq = dx * dx + dy * dy
    if (distSq <= 0.0001) {
      return
    }

    const dist = Math.sqrt(distSq)
    const ropeLength = Math.max(
      DEFAULT_GRAPPLE_TETHER_MIN_LENGTH,
      this.calculateCurrentRopeLength(runtime)
    )
    const stretch = dist - ropeLength
    if (stretch <= 0) {
      return
    }

    const invDist = 1 / dist
    const dirX = dx * invDist
    const dirY = dy * invDist
    const currentVel = this.box2d.b2Body_GetLinearVelocity(anchorBodyId)
    const currentAlong = currentVel.x * dirX + currentVel.y * dirY
    const targetAlong = Math.min(
      this.dynamicTetherMaxSpeed,
      this.dynamicTetherBaseSpeed + stretch * this.dynamicTetherStretchSpeed
    )

    if (currentAlong >= targetAlong) {
      currentVel.delete()
      return
    }

    const addSpeed = targetAlong - currentAlong
    this.tempVec.x = currentVel.x + dirX * addSpeed
    this.tempVec.y = currentVel.y + dirY * addSpeed
    this.box2d.b2Body_SetLinearVelocity(anchorBodyId, this.tempVec)
    currentVel.delete()
  }

  private repositionSegment(
    entity: Entity,
    runtime: RopeRuntime,
    segIndex: number
  ): void {
    if (segIndex < 0 || segIndex >= runtime.segmentCount) return
    if (!entity.physics) return
    const anchorBodyId = runtime.anchorBodyId
    if (segIndex <= 0 && !this.isBodyId(anchorBodyId)) return
    const prevBodyId =
      segIndex > 0 ? runtime.segmentBodies[segIndex - 1] : anchorBodyId
    if (!this.isBodyId(prevBodyId)) return
    const anchorEntity =
      segIndex === 0 && runtime.anchorEntityId >= 0
        ? this.getEntityById(runtime.anchorEntityId)
        : null
    const prevPos =
      anchorEntity?.transform === undefined
        ? this.box2d.b2Body_GetPosition(prevBodyId)
        : null
    const pPos = this.box2d.b2Body_GetPosition(entity.physics.bodyId)
    const prevX = anchorEntity?.transform?.x ?? prevPos?.x ?? 0
    const prevY = anchorEntity?.transform?.y ?? prevPos?.y ?? 0
    const dx = pPos.x - prevX
    const dy = pPos.y - prevY
    const d = Math.sqrt(dx * dx + dy * dy)
    const linkLen = runtime.linkLength
    if (d > 0.001) {
      const inv = linkLen / d
      this.tempVec.x = prevX + dx * inv
      this.tempVec.y = prevY + dy * inv
    } else {
      this.tempVec.x = prevX
      this.tempVec.y = prevY + linkLen
    }
    const segBody = runtime.segmentBodies[segIndex]
    if (!this.isBodyId(segBody) || !this.box2d.b2Body_IsValid(segBody)) {
      prevPos?.delete()
      pPos.delete()
      return
    }
    this.box2d.b2Body_SetTransform(
      segBody,
      this.tempVec,
      this.box2d.b2Body_GetRotation(segBody)
    )
    this.tempVec.Set(0, 0)
    this.box2d.b2Body_SetLinearVelocity(segBody, this.tempVec)
    prevPos?.delete()
    pPos.delete()
  }

  private destroyAnchorTether(
    entity: Entity,
    grapple: NonNullable<Entity['grapple']>
  ): void {
    const runtime = this.ropeRuntimeByEntityId.get(entity.id)
    if (!runtime || !runtime.active) {
      grapple.isTethering = false
      return
    }

    this.destroyJointIfValid(runtime.playerJointId)
    runtime.playerJointId = null

    for (let i = 0; i < runtime.segmentJoints.length; i++) {
      this.destroyJointIfValid(runtime.segmentJoints[i])
    }
    runtime.segmentJoints.length = 0

    for (let i = 0; i < runtime.segmentFilterJoints.length; i++) {
      this.destroyJointIfValid(runtime.segmentFilterJoints[i])
    }
    runtime.segmentFilterJoints.length = 0

    for (let i = 0; i < runtime.segmentBodies.length; i++) {
      this.destroyBodyIfValid(runtime.segmentBodies[i])
    }
    runtime.segmentBodies.length = 0

    if (runtime.anchorBodyOwned) {
      this.destroyBodyIfValid(runtime.anchorBodyId)
    }
    runtime.anchorBodyId = null
    runtime.anchorBodyOwned = false
    runtime.anchorEntityId = -1
    runtime.anchorLocalX = 0
    runtime.anchorLocalY = 0
    this.destroyBodyIfValid(runtime.playerAnchorBodyId)
    runtime.playerAnchorBodyId = null
    runtime.anchorFollowX = 0
    runtime.anchorFollowY = 0
    runtime.playerFollowX = 0
    runtime.playerFollowY = 0

    runtime.segmentCount = 0
    runtime.linkLength = DEFAULT_GRAPPLE_ROPE_SEGMENT_LENGTH
    runtime.attachIndex = -1
    runtime.active = false

    grapple.isTethering = false
  }

  private createAnchorBody(x: number, y: number): b2BodyId {
    const bodyDef = this.box2d.b2DefaultBodyDef()
    bodyDef.type = this.box2d.b2BodyType.b2_staticBody
    bodyDef.position.Set(x, y)
    const bodyId = this.box2d.b2CreateBody(this.worldId, bodyDef)
    bodyDef.delete()
    return bodyId
  }

  private createKinematicAnchorBody(x: number, y: number): b2BodyId {
    const bodyDef = this.box2d.b2DefaultBodyDef()
    bodyDef.type = this.box2d.b2BodyType.b2_kinematicBody
    bodyDef.position.Set(x, y)
    const bodyId = this.box2d.b2CreateBody(this.worldId, bodyDef)
    bodyDef.delete()
    return bodyId
  }

  private createRopeSegmentBody(
    x: number,
    y: number,
    renderLayer: number,
    density = this.ropeDensity,
    categoryBits = getRopeCollisionCategory(renderLayer),
    maskBits = getRopeCollisionMask(renderLayer)
  ): b2BodyId {
    const bodyDef = this.box2d.b2DefaultBodyDef()
    bodyDef.type = this.box2d.b2BodyType.b2_dynamicBody
    bodyDef.position.Set(x, y)
    bodyDef.linearDamping = this.ropeLinearDamping
    const bodyId = this.box2d.b2CreateBody(this.worldId, bodyDef)
    bodyDef.delete()

    const shapeDef = this.box2d.b2DefaultShapeDef()
    shapeDef.density = density
    shapeDef.material.friction = 0.1
    shapeDef.material.restitution = 0
    shapeDef.filter.categoryBits = categoryBits
    shapeDef.filter.maskBits = maskBits

    const circle = new this.box2d.b2Circle()
    circle.center.Set(0, 0)
    circle.radius = DEFAULT_GRAPPLE_ROPE_SEGMENT_RADIUS

    this.box2d.b2CreateCircleShape(bodyId, shapeDef, circle)

    circle.delete()
    shapeDef.delete()

    return bodyId
  }

  private createFixedDistanceJoint(
    bodyIdA: b2BodyId,
    bodyIdB: b2BodyId,
    length: number,
    localAX = 0,
    localAY = 0,
    localBX = 0,
    localBY = 0
  ): b2JointId {
    const jointDef = this.box2d.b2DefaultDistanceJointDef()
    jointDef.base.bodyIdA = bodyIdA
    jointDef.base.bodyIdB = bodyIdB
    jointDef.base.collideConnected = false
    jointDef.base.localFrameA.p.Set(localAX, localAY)
    jointDef.base.localFrameA.q.SetAngle(0)
    jointDef.base.localFrameB.p.Set(localBX, localBY)
    jointDef.base.localFrameB.q.SetAngle(0)
    jointDef.enableSpring = true
    jointDef.hertz = this.ropeHertz
    jointDef.dampingRatio = this.ropeDampingRatio
    jointDef.enableLimit = true
    jointDef.enableMotor = false
    jointDef.length = length
    jointDef.minLength = 0
    jointDef.maxLength = length

    const jointId = this.box2d.b2CreateDistanceJoint(this.worldId, jointDef)
    jointDef.delete()
    return jointId
  }

  private createBodyCollisionFilterJoint(
    bodyIdA: b2BodyId,
    bodyIdB: b2BodyId
  ): b2JointId {
    const jointDef = this.box2d.b2DefaultFilterJointDef()
    jointDef.base.bodyIdA = bodyIdA
    jointDef.base.bodyIdB = bodyIdB
    jointDef.base.collideConnected = false
    const jointId = this.box2d.b2CreateFilterJoint(this.worldId, jointDef)
    jointDef.delete()
    return jointId
  }

  private destroyJointIfValid(jointId: b2JointId | null): void {
    if (!this.isJointId(jointId) || !this.box2d.b2Joint_IsValid(jointId)) {
      return
    }
    this.box2d.b2DestroyJoint(jointId, true)
  }

  private destroyBodyIfValid(bodyId: b2BodyId | null): void {
    if (!this.isBodyId(bodyId) || !this.box2d.b2Body_IsValid(bodyId)) {
      return
    }
    this.box2d.b2DestroyBody(bodyId)
  }

  private calculateCurrentRopeLength(runtime: RopeRuntime): number {
    const attachedSegments = runtime.attachIndex + 1
    return attachedSegments * runtime.linkLength + runtime.jointMaxLen
  }

  private performRopeJump(
    entity: Entity,
    grapple: NonNullable<Entity['grapple']>
  ): void {
    if (!entity.physics || !entity.movement || !entity.transform) return

    const currentVel = this.box2d.b2Body_GetLinearVelocity(
      entity.physics.bodyId
    )
    const currentVx = currentVel.x
    const currentVy = currentVel.y
    currentVel.delete()

    const jumpDeltaY =
      (-entity.movement.jumpForce * this.ropeJumpBaseUpwardScale) /
      this.ropeJumpScale
    const ropeDx = entity.transform.x - grapple.targetX
    const ropeDy = entity.transform.y - grapple.targetY
    const distSq = ropeDx * ropeDx + ropeDy * ropeDy

    this.tempVec.x = currentVx
    this.tempVec.y = currentVy + jumpDeltaY

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
        (tangentSpeed * tangentSpeed) / this.ropeJumpReferenceSpeedSq
      )
      const boostScale =
        (amplitudeRatio * this.ropeJumpAmplitudeBoostScale +
          speedRatio * this.ropeJumpSpeedBoostScale) /
        this.ropeJumpScale
      const tangentBoostSpeed = tangentSpeed * boostScale

      this.tempVec.x += tangentX * tangentBoostSpeed
      this.tempVec.y += tangentY * tangentBoostSpeed
    }

    const maxReleaseSpeed =
      (Math.max(entity.movement.jumpForce, entity.movement.moveSpeed * 4) *
        this.ropeJumpMaxSpeedScale) /
      this.ropeJumpScale
    const releaseSpeedSq =
      this.tempVec.x * this.tempVec.x + this.tempVec.y * this.tempVec.y
    const maxReleaseSpeedSq = maxReleaseSpeed * maxReleaseSpeed
    if (releaseSpeedSq > maxReleaseSpeedSq && releaseSpeedSq > 0) {
      const speedScale = maxReleaseSpeed / Math.sqrt(releaseSpeedSq)
      this.tempVec.x *= speedScale
      this.tempVec.y *= speedScale
    }

    grapple.velocityX = this.tempVec.x
    grapple.velocityY = this.tempVec.y
    this.box2d.b2Body_SetLinearVelocity(entity.physics.bodyId, this.tempVec)
  }

  private applyTetherSwingImpulse(
    entity: Entity,
    grapple: NonNullable<Entity['grapple']>
  ): void {
    if (!entity.physics || !entity.transform) {
      return
    }

    const currentVel = this.box2d.b2Body_GetLinearVelocity(
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

    const facingDir = entity.input?.lastMoveDirection ?? 1
    const swingSpeed = 12
    const addVx = tangentX * swingSpeed * facingDir
    const addVy = tangentY * swingSpeed * facingDir

    this.tempVec.x = currentVx + addVx
    this.tempVec.y = currentVy + addVy
    this.box2d.b2Body_SetLinearVelocity(entity.physics.bodyId, this.tempVec)
  }

  private handleSwingInput(
    entity: Entity,
    grapple: NonNullable<Entity['grapple']>,
    deltaMs: number
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
      return
    }

    entity.input.lastMoveDirection = moveDir

    const currentVel = this.box2d.b2Body_GetLinearVelocity(
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

    const tangentVel = currentVx * tangentX + currentVy * tangentY

    if (Math.abs(tangentVel) < 0.1) {
      return
    }

    const swingDir = tangentVel > 0 ? 1 : -1
    const horizontalSwingDir = tangentX * swingDir > 0 ? 1 : -1

    const isSameDirection = moveDir === horizontalSwingDir
    const mass = this.box2d.b2Body_GetMass(entity.physics.bodyId)
    const swingForce = isSameDirection
      ? this.swingForce
      : -this.swingForce * 0.67
    const deltaTime = deltaMs / 1000

    const forceX = tangentX * swingDir * swingForce * mass * deltaTime
    const forceY = tangentY * swingDir * swingForce * mass * deltaTime

    this.tempVec.x = forceX
    this.tempVec.y = forceY
    this.box2d.b2Body_ApplyForceToCenter(
      entity.physics.bodyId,
      this.tempVec,
      true
    )
  }
}
