import {
  DEFAULT_GRAPPLE_RANGE,
  DEFAULT_GRAPPLE_ROPE_MAX_SEGMENTS,
  DEFAULT_GRAPPLE_ROPE_SEGMENT_LENGTH,
  DEFAULT_GRAPPLE_ROPE_SEGMENT_RADIUS,
  DEFAULT_GRAPPLE_TETHER_MIN_LENGTH,
  DEFAULT_PLAYER_RADIUS,
  GRAPPLE_CLIMB_SPEED,
} from '../../../constants'
import {
  getGroundCollisionCategory,
  getObstacleCollisionCategory,
  getRopeCollisionCategory,
  getWeaponCollisionCategory,
} from '../../../physicsLayers'
import type { b2BodyId } from '../../../types'
import type { Entity } from '../../Entity'
import type { GrappleSystemRuntime } from './GrappleRuntime'
import {
  GrapplePullMode,
  PlayerTetherState,
  type RopeBridgeRuntime,
  type RopeEndpointBuild,
  type RopeRuntime,
} from './GrappleTypes'

export class GrappleRopeRuntimeSystem {
  constructor(private readonly runtime: GrappleSystemRuntime) {}

  private getActivePlayerRopeSegmentCount(runtime: RopeRuntime): number {
    const activeCount = runtime.attachIndex + 1
    if (activeCount <= 0) {
      return 0
    }
    return Math.min(activeCount, runtime.segmentBodies.length)
  }

  private setPlayerRopeSegmentEnabled(
    bodyId: b2BodyId,
    enabled: boolean
  ): void {
    if (
      !this.runtime.isBodyId(bodyId) ||
      !this.runtime.box2d.b2Body_IsValid(bodyId) ||
      this.runtime.box2d.b2Body_IsEnabled(bodyId) === enabled
    ) {
      return
    }

    if (enabled) {
      this.runtime.box2d.b2Body_Enable(bodyId)
      this.runtime.box2d.b2Body_SetAwake(bodyId, true)
      return
    }

    this.runtime.box2d.b2Body_Disable(bodyId)
  }

  private setPlayerRopeSegmentEnabledAt(
    runtime: RopeRuntime,
    segmentIndex: number,
    enabled: boolean
  ): void {
    if (segmentIndex < 0 || segmentIndex >= runtime.segmentBodies.length) {
      return
    }
    this.setPlayerRopeSegmentEnabled(
      runtime.segmentBodies[segmentIndex],
      enabled
    )
  }

  private syncPlayerRopeSegmentActivity(runtime: RopeRuntime): void {
    const activeCount = this.getActivePlayerRopeSegmentCount(runtime)
    for (let i = 0; i < runtime.segmentBodies.length; i++) {
      this.setPlayerRopeSegmentEnabled(
        runtime.segmentBodies[i],
        i < activeCount
      )
    }
  }

  private syncChangedPlayerRopeSegmentActivity(
    runtime: RopeRuntime,
    previousActiveCount: number
  ): void {
    const activeCount = this.getActivePlayerRopeSegmentCount(runtime)
    if (activeCount === previousActiveCount) {
      return
    }

    if (activeCount > previousActiveCount) {
      for (let i = previousActiveCount; i < activeCount; i++) {
        this.setPlayerRopeSegmentEnabledAt(runtime, i, true)
      }
      return
    }

    for (let i = activeCount; i < previousActiveCount; i++) {
      this.setPlayerRopeSegmentEnabledAt(runtime, i, false)
    }
  }

  updateExistingRopeSegments(): void {
    this.runtime.ropeRuntimeByEntityId.forEach((runtime) => {
      if (!runtime.active) return
      for (let i = 0; i < runtime.segmentBodies.length; i++) {
        const bodyId = runtime.segmentBodies[i]
        if (
          this.runtime.isBodyId(bodyId) &&
          this.runtime.box2d.b2Body_IsValid(bodyId)
        ) {
          this.runtime.box2d.b2Body_SetLinearDamping(
            bodyId,
            this.runtime.ropeLinearDamping
          )
        }
      }
    })
    for (let i = 0; i < this.runtime.detachedPlayerRopes.length; i++) {
      const runtime = this.runtime.detachedPlayerRopes[i]
      if (!runtime.active) continue
      for (let j = 0; j < runtime.segmentBodies.length; j++) {
        const bodyId = runtime.segmentBodies[j]
        if (
          this.runtime.isBodyId(bodyId) &&
          this.runtime.box2d.b2Body_IsValid(bodyId)
        ) {
          this.runtime.box2d.b2Body_SetLinearDamping(
            bodyId,
            this.runtime.ropeLinearDamping
          )
        }
      }
    }
    this.runtime.ropeClimbRuntimeByEntityId.forEach((runtime) => {
      if (
        runtime.active &&
        this.runtime.isJointId(runtime.jointId) &&
        this.runtime.box2d.b2Joint_IsValid(runtime.jointId)
      ) {
        this.runtime.box2d.b2DistanceJoint_SetSpringHertz(
          runtime.jointId,
          this.runtime.ropeHertz
        )
        this.runtime.box2d.b2DistanceJoint_SetSpringDampingRatio(
          runtime.jointId,
          this.runtime.ropeDampingRatio
        )
      }
    })
    for (let i = 0; i < this.runtime.bridgeRopes.length; i++) {
      const runtime = this.runtime.bridgeRopes[i]
      if (!runtime.active) continue
      const linearDamping = this.runtime.getBridgeRopeLinearDamping(runtime)
      for (let j = 0; j < runtime.segmentBodies.length; j++) {
        const bodyId = runtime.segmentBodies[j]
        if (
          this.runtime.isBodyId(bodyId) &&
          this.runtime.box2d.b2Body_IsValid(bodyId)
        ) {
          this.runtime.box2d.b2Body_SetLinearDamping(bodyId, linearDamping)
        }
      }
    }
  }

  updateExistingRopeJoints(): void {
    this.runtime.ropeRuntimeByEntityId.forEach((runtime) => {
      if (!runtime.active) return
      for (let i = 0; i < runtime.segmentJoints.length; i++) {
        const jointId = runtime.segmentJoints[i]
        if (
          this.runtime.isJointId(jointId) &&
          this.runtime.box2d.b2Joint_IsValid(jointId)
        ) {
          this.runtime.box2d.b2DistanceJoint_SetSpringHertz(
            jointId,
            this.runtime.ropeHertz
          )
          this.runtime.box2d.b2DistanceJoint_SetSpringDampingRatio(
            jointId,
            this.runtime.ropeDampingRatio
          )
          this.runtime.updateRopeJointLengthRange(jointId)
        }
      }
      if (
        this.runtime.isJointId(runtime.playerJointId) &&
        this.runtime.box2d.b2Joint_IsValid(runtime.playerJointId)
      ) {
        this.runtime.box2d.b2DistanceJoint_SetSpringHertz(
          runtime.playerJointId,
          this.runtime.ropeHertz
        )
        this.runtime.box2d.b2DistanceJoint_SetSpringDampingRatio(
          runtime.playerJointId,
          this.runtime.ropeDampingRatio
        )
        this.runtime.updateRopeJointLengthRange(runtime.playerJointId)
      }
    })
    for (let i = 0; i < this.runtime.detachedPlayerRopes.length; i++) {
      const runtime = this.runtime.detachedPlayerRopes[i]
      if (!runtime.active) continue
      for (let j = 0; j < runtime.segmentJoints.length; j++) {
        const jointId = runtime.segmentJoints[j]
        if (
          this.runtime.isJointId(jointId) &&
          this.runtime.box2d.b2Joint_IsValid(jointId)
        ) {
          this.runtime.box2d.b2DistanceJoint_SetSpringHertz(
            jointId,
            this.runtime.ropeHertz
          )
          this.runtime.box2d.b2DistanceJoint_SetSpringDampingRatio(
            jointId,
            this.runtime.ropeDampingRatio
          )
          this.runtime.updateRopeJointLengthRange(jointId)
        }
      }
    }
    this.runtime.ropeClimbRuntimeByEntityId.forEach((runtime) => {
      if (
        runtime.active &&
        this.runtime.isJointId(runtime.jointId) &&
        this.runtime.box2d.b2Joint_IsValid(runtime.jointId)
      ) {
        this.runtime.box2d.b2DistanceJoint_SetSpringHertz(
          runtime.jointId,
          this.runtime.ropeHertz
        )
        this.runtime.box2d.b2DistanceJoint_SetSpringDampingRatio(
          runtime.jointId,
          this.runtime.ropeDampingRatio
        )
        this.runtime.updateRopeJointLengthRange(runtime.jointId)
      }
    })
    for (let i = 0; i < this.runtime.bridgeRopes.length; i++) {
      const runtime = this.runtime.bridgeRopes[i]
      if (!runtime.active) continue
      const hertz = this.runtime.getBridgeRopeHertz(runtime)
      const dampingRatio = this.runtime.getBridgeRopeDampingRatio(runtime)
      for (let j = 0; j < runtime.segmentJoints.length; j++) {
        const jointId = runtime.segmentJoints[j]
        if (
          this.runtime.isJointId(jointId) &&
          this.runtime.box2d.b2Joint_IsValid(jointId)
        ) {
          this.runtime.box2d.b2DistanceJoint_SetSpringHertz(jointId, hertz)
          this.runtime.box2d.b2DistanceJoint_SetSpringDampingRatio(
            jointId,
            dampingRatio
          )
          this.runtime.updateRopeJointLengthRange(jointId)
        }
      }
    }
  }

  getBridgeRopeLinearDamping(runtime: RopeBridgeRuntime): number {
    return runtime.climbTuningActive
      ? this.runtime.ropeClimbLinearDamping
      : this.runtime.ropeLinearDamping
  }

  getBridgeRopeHertz(runtime: RopeBridgeRuntime): number {
    return runtime.climbTuningActive
      ? this.runtime.ropeClimbHertz
      : this.runtime.ropeHertz
  }

  getBridgeRopeDampingRatio(runtime: RopeBridgeRuntime): number {
    return runtime.climbTuningActive
      ? this.runtime.ropeClimbDampingRatio
      : this.runtime.ropeDampingRatio
  }

  setBridgeRopeClimbTuning(runtime: RopeBridgeRuntime, active: boolean): void {
    if (runtime.climbTuningActive === active) {
      return
    }

    runtime.climbTuningActive = active
    this.runtime.updateBridgeRopeSegmentDamping(runtime)
    this.runtime.updateBridgeRopeJointTuning(runtime)
  }

  updateBridgeRopeSegmentDamping(runtime: RopeBridgeRuntime): void {
    const linearDamping = this.runtime.getBridgeRopeLinearDamping(runtime)
    for (let i = 0; i < runtime.segmentBodies.length; i++) {
      const bodyId = runtime.segmentBodies[i]
      if (
        this.runtime.isBodyId(bodyId) &&
        this.runtime.box2d.b2Body_IsValid(bodyId)
      ) {
        this.runtime.box2d.b2Body_SetLinearDamping(bodyId, linearDamping)
      }
    }
  }

  updateBridgeRopeJointTuning(runtime: RopeBridgeRuntime): void {
    const hertz = this.runtime.getBridgeRopeHertz(runtime)
    const dampingRatio = this.runtime.getBridgeRopeDampingRatio(runtime)
    for (let i = 0; i < runtime.segmentJoints.length; i++) {
      const jointId = runtime.segmentJoints[i]
      if (
        !this.runtime.isJointId(jointId) ||
        !this.runtime.box2d.b2Joint_IsValid(jointId)
      ) {
        continue
      }
      this.runtime.box2d.b2DistanceJoint_SetSpringHertz(jointId, hertz)
      this.runtime.box2d.b2DistanceJoint_SetSpringDampingRatio(
        jointId,
        dampingRatio
      )
      this.runtime.updateRopeJointLengthRange(jointId)
    }
  }

  detachTetherTarget(targetEntityId: number): void {
    if (targetEntityId < 0) {
      return
    }

    this.runtime.ropeRuntimeByEntityId.forEach((runtime, ownerEntityId) => {
      if (!runtime.active || runtime.anchorEntityId !== targetEntityId) {
        return
      }

      const owner = this.runtime.getEntityById(ownerEntityId)
      const grapple = owner?.grapple
      if (!owner || !grapple) {
        return
      }

      this.runtime.destroyAnchorTether(owner, grapple)
      this.runtime.resetGrappleMotion(grapple, false)
    })

    for (let i = 0; i < this.runtime.detachedPlayerRopes.length; i++) {
      const runtime = this.runtime.detachedPlayerRopes[i]
      if (!runtime.active || runtime.anchorEntityId !== targetEntityId) {
        continue
      }
      this.runtime.destroyPlayerRopeRuntime(runtime)
    }

    this.runtime.detachBridgeRopesForTarget(targetEntityId)
  }

  getOrCreateRopeRuntime(entityId: number): RopeRuntime {
    const existing = this.runtime.ropeRuntimeByEntityId.get(entityId)
    if (existing) {
      return existing
    }
    const runtime: RopeRuntime = {
      active: false,
      ownerEntityId: entityId,
      hitId: 0,
      health: 0,
      hitShakeSegmentIndex: -1,
      hitShakeStartTimeMs: 0,
      hitShakeEndTimeMs: 0,
      hitShakeDirX: 0,
      hitShakeDirY: 0,
      renderLayer: 0,
      anchorBodyId: null,
      anchorBodyOwned: false,
      anchorIsDynamicTarget: false,
      anchorEntityId: -1,
      anchorLocalX: 0,
      anchorLocalY: 0,
      playerAnchorBodyId: null,
      playerAttached: false,
      playerTetherState: PlayerTetherState.Airborne,
      playerGroundJumpActive: false,
      airJumpDetachArmed: true,
      pendingPlayerVelocityTransfer: false,
      lastSwingInputDirection: 0,
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
    this.runtime.ropeRuntimeByEntityId.set(entityId, runtime)
    return runtime
  }

  prepareNewAnchorTetherRuntime(
    entity: Entity,
    grapple: NonNullable<Entity['grapple']>
  ): RopeRuntime {
    const activeRuntime = this.runtime.ropeRuntimeByEntityId.get(entity.id)
    if (activeRuntime?.active === true) {
      this.runtime.detachPlayerFromTether(entity, grapple, activeRuntime, false)
    }
    return this.runtime.getOrCreateRopeRuntime(entity.id)
  }

  canCreateRopeOnTarget(
    targetEntityId: number,
    ignoredPlayerRuntime: RopeRuntime | null = null,
    ignoredBridgeRuntime: RopeBridgeRuntime | null = null
  ): boolean {
    if (targetEntityId < 0) {
      return true
    }

    return (
      this.runtime.getRopeCountForTarget(
        targetEntityId,
        ignoredPlayerRuntime,
        ignoredBridgeRuntime
      ) < this.runtime.maxRopesPerTetherTarget
    )
  }

  getRopeCountForTarget(
    targetEntityId: number,
    ignoredPlayerRuntime: RopeRuntime | null,
    ignoredBridgeRuntime: RopeBridgeRuntime | null
  ): number {
    let count = 0

    for (const runtime of this.runtime.ropeRuntimeByEntityId.values()) {
      if (
        runtime !== ignoredPlayerRuntime &&
        runtime.active &&
        runtime.anchorEntityId === targetEntityId
      ) {
        count++
      }
    }

    for (let i = 0; i < this.runtime.detachedPlayerRopes.length; i++) {
      const runtime = this.runtime.detachedPlayerRopes[i]
      if (
        runtime !== ignoredPlayerRuntime &&
        runtime.active &&
        runtime.anchorEntityId === targetEntityId
      ) {
        count++
      }
    }

    for (let i = 0; i < this.runtime.bridgeRopes.length; i++) {
      const runtime = this.runtime.bridgeRopes[i]
      if (
        runtime !== ignoredBridgeRuntime &&
        runtime.active &&
        (runtime.endpointAEntityId === targetEntityId ||
          runtime.endpointBEntityId === targetEntityId)
      ) {
        count++
      }
    }

    return count
  }

  startAnchorTether(
    entity: Entity,
    grapple: NonNullable<Entity['grapple']>,
    anchorEntity?: Entity
  ): boolean {
    if (!entity.transform || !entity.physics) {
      return false
    }

    let anchorBodyId: b2BodyId | null = null
    let anchorBodyOwned = true
    let anchorEntityId = -1
    let anchorLocalX = 0
    let anchorLocalY = 0
    let anchorIsDynamicTarget = false
    const startsGrounded = entity.movement?.isGrounded === true

    if (anchorEntity) {
      const endpoint = this.runtime.tetherEndpoint
      if (!this.runtime.resolveGrappleEndpoint(anchorEntity, endpoint, true)) {
        return false
      }
      if (!this.runtime.canCreateRopeOnTarget(endpoint.entityId)) {
        return false
      }

      grapple.targetX = endpoint.x
      grapple.targetY = endpoint.y
      grapple.targetEntityId = endpoint.entityId
      anchorEntityId = endpoint.entityId
      anchorLocalX = endpoint.localX
      anchorLocalY = endpoint.localY
      anchorIsDynamicTarget = endpoint.hasDynamicBody

      if (endpoint.hasDynamicBody) {
        if (!this.runtime.isBodyId(endpoint.bodyId)) {
          return false
        }
        const anchorDx = entity.transform.x - endpoint.x
        const anchorDy = entity.transform.y - endpoint.y
        const anchorDist = Math.sqrt(anchorDx * anchorDx + anchorDy * anchorDy)
        const runtime = this.runtime.prepareNewAnchorTetherRuntime(
          entity,
          grapple
        )
        if (
          !this.runtime.buildDynamicAnchorTether(
            entity,
            runtime,
            endpoint.entityId,
            endpoint.bodyId,
            endpoint.x,
            endpoint.y,
            anchorLocalX,
            anchorLocalY,
            anchorDist,
            startsGrounded
          )
        ) {
          return false
        }
        runtime.active = true
        if (!startsGrounded) {
          this.syncTetherEndpointVelocityFromPlayer(entity, runtime)
        }
        return true
      }

      anchorBodyId = this.runtime.createAnchorBody(endpoint.x, endpoint.y)
    } else {
      anchorBodyId = this.runtime.createAnchorBody(
        grapple.targetX,
        grapple.targetY
      )
      grapple.targetEntityId = -1
    }

    if (!this.runtime.isBodyId(anchorBodyId)) {
      return false
    }

    const dx = entity.transform.x - grapple.targetX
    const dy = entity.transform.y - grapple.targetY
    const currentDist = Math.sqrt(dx * dx + dy * dy)
    const runtime = this.runtime.prepareNewAnchorTetherRuntime(entity, grapple)
    runtime.maxRopeLength = DEFAULT_GRAPPLE_RANGE
    this.runtime.buildAnchorTether(
      entity,
      runtime,
      grapple.targetX,
      grapple.targetY,
      currentDist,
      anchorBodyId,
      anchorBodyOwned,
      anchorEntityId,
      anchorLocalX,
      anchorLocalY,
      anchorIsDynamicTarget,
      startsGrounded
    )
    runtime.active = true

    if (!startsGrounded) {
      this.syncTetherEndpointVelocityFromPlayer(entity, runtime)
    }

    return true
  }

  buildDynamicAnchorTether(
    entity: Entity,
    runtime: RopeRuntime,
    anchorEntityId: number,
    connectedBodyId: b2BodyId,
    anchorX: number,
    anchorY: number,
    anchorLocalX: number,
    anchorLocalY: number,
    initialLength: number,
    startsGrounded: boolean
  ): boolean {
    if (!entity.transform || !entity.physics) {
      return false
    }

    const playerX = entity.transform.x
    const playerY = entity.transform.y
    const anchorEntity = this.runtime.getEntityById(anchorEntityId)
    const minRopeLength = this.runtime.getPlayerTetherMinLengthForTarget(
      entity,
      anchorEntity
    )
    const initialRopeLength = Math.max(minRopeLength, initialLength)
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
    const anchorBodyId = this.runtime.createKinematicAnchorBody(
      anchorX,
      anchorY
    )
    const playerAnchorBodyId = startsGrounded
      ? this.runtime.createKinematicAnchorBody(playerX, playerY)
      : null

    runtime.anchorBodyId = anchorBodyId
    runtime.ownerEntityId = entity.id
    runtime.anchorBodyOwned = true
    runtime.anchorIsDynamicTarget = true
    runtime.anchorEntityId = anchorEntityId
    runtime.anchorLocalX = anchorLocalX
    runtime.anchorLocalY = anchorLocalY
    runtime.playerAnchorBodyId = playerAnchorBodyId
    runtime.playerAttached = true
    runtime.playerTetherState = startsGrounded
      ? PlayerTetherState.GroundFollow
      : PlayerTetherState.Airborne
    runtime.playerGroundJumpActive = false
    runtime.airJumpDetachArmed = entity.input?.jumpRequested !== true
    runtime.pendingPlayerVelocityTransfer = startsGrounded
    runtime.lastSwingInputDirection = 0
    runtime.hitId = this.runtime.nextRopeHitId++
    runtime.health = this.runtime.getDefaultRopeHealth()
    this.runtime.resetRopeHitShake(runtime)
    runtime.renderLayer = renderLayer
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
      const segmentBodyId = this.runtime.createRopeSegmentBody(
        centerX,
        centerY,
        renderLayer,
        this.runtime.dynamicTetherRopeDensity,
        categoryBits,
        maskBits
      )
      runtime.segmentBodies.push(segmentBodyId)
      runtime.segmentFilterJoints.push(
        this.runtime.createBodyCollisionFilterJoint(
          segmentBodyId,
          connectedBodyId
        )
      )
      const segmentJointId = this.runtime.createFixedDistanceJoint(
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
    this.syncPlayerRopeSegmentActivity(runtime)
    const playerBodyId = startsGrounded
      ? playerAnchorBodyId
      : entity.physics.bodyId
    if (!this.runtime.isBodyId(playerBodyId)) {
      return false
    }
    runtime.playerJointId = this.runtime.createFixedDistanceJoint(
      attachBodyId,
      playerBodyId,
      runtime.jointMaxLen
    )
    return true
  }

  buildAnchorTether(
    entity: Entity,
    runtime: RopeRuntime,
    anchorX: number,
    anchorY: number,
    initialLength: number,
    anchorBodyId: b2BodyId,
    anchorBodyOwned: boolean,
    anchorEntityId: number,
    anchorLocalX: number,
    anchorLocalY: number,
    anchorIsDynamicTarget: boolean,
    startsGrounded: boolean
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
    runtime.ownerEntityId = entity.id
    runtime.anchorBodyOwned = anchorBodyOwned
    runtime.anchorIsDynamicTarget = anchorIsDynamicTarget
    runtime.anchorEntityId = anchorEntityId
    runtime.anchorLocalX = anchorLocalX
    runtime.anchorLocalY = anchorLocalY
    runtime.playerAttached = true
    runtime.playerTetherState = startsGrounded
      ? PlayerTetherState.GroundFollow
      : PlayerTetherState.Airborne
    runtime.playerGroundJumpActive = false
    runtime.airJumpDetachArmed = entity.input?.jumpRequested !== true
    runtime.pendingPlayerVelocityTransfer = startsGrounded
    runtime.lastSwingInputDirection = 0
    runtime.hitId = this.runtime.nextRopeHitId++
    runtime.health = this.runtime.getDefaultRopeHealth()
    this.runtime.resetRopeHitShake(runtime)
    runtime.renderLayer = entity.render?.renderLayer ?? 0
    runtime.anchorFollowX = anchorX
    runtime.anchorFollowY = anchorY
    runtime.playerFollowX = entity.transform.x
    runtime.playerFollowY = entity.transform.y

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
      const segmentBodyId = this.runtime.createRopeSegmentBody(
        centerX,
        centerY,
        entity.render?.renderLayer ?? 0
      )
      runtime.segmentBodies.push(segmentBodyId)
      const localAX = i === 0 ? runtime.anchorLocalX : 0
      const localAY = i === 0 ? runtime.anchorLocalY : 0
      const segmentJointId = this.runtime.createFixedDistanceJoint(
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
    this.syncPlayerRopeSegmentActivity(runtime)
    const playerBodyId = startsGrounded
      ? this.runtime.createPlayerTetherFollowBody(entity, runtime)
      : entity.physics.bodyId
    if (!this.runtime.isBodyId(playerBodyId)) {
      return
    }
    runtime.playerJointId = this.runtime.createFixedDistanceJoint(
      attachBodyId,
      playerBodyId,
      runtime.jointMaxLen,
      attachLocalX,
      attachLocalY
    )
  }

  createPlayerTetherFollowBody(
    entity: Entity,
    runtime: RopeRuntime
  ): b2BodyId | null {
    if (!entity.transform) {
      return null
    }

    const bodyId = this.runtime.createKinematicAnchorBody(
      entity.transform.x,
      entity.transform.y
    )
    runtime.playerAnchorBodyId = bodyId
    runtime.playerFollowX = entity.transform.x
    runtime.playerFollowY = entity.transform.y
    return bodyId
  }

  switchPlayerTetherState(
    entity: Entity,
    runtime: RopeRuntime,
    nextState: PlayerTetherState
  ): boolean {
    if (runtime.playerTetherState === nextState) {
      return true
    }
    if (!entity.physics) {
      return false
    }

    const currentUsesPlayerBody =
      runtime.playerTetherState !== PlayerTetherState.GroundFollow
    const nextUsesPlayerBody = nextState !== PlayerTetherState.GroundFollow
    if (currentUsesPlayerBody && nextUsesPlayerBody) {
      runtime.playerTetherState = nextState
      return true
    }

    this.runtime.destroyJointIfValid(runtime.playerJointId)
    runtime.playerJointId = null

    let playerBodyId: b2BodyId | null = entity.physics.bodyId
    if (nextState === PlayerTetherState.GroundFollow) {
      playerBodyId = this.runtime.createPlayerTetherFollowBody(entity, runtime)
    } else {
      this.runtime.destroyBodyIfValid(runtime.playerAnchorBodyId)
      runtime.playerAnchorBodyId = null
    }
    if (!this.runtime.isBodyId(playerBodyId)) {
      return false
    }

    runtime.playerTetherState = nextState
    this.runtime.rebuildPlayerTetherJoint(
      runtime,
      playerBodyId,
      !runtime.anchorIsDynamicTarget
    )
    return this.runtime.isJointId(runtime.playerJointId)
  }

  updatePlayerTetherState(
    entity: Entity,
    grapple: NonNullable<Entity['grapple']>,
    runtime: RopeRuntime,
    deltaMs: number
  ): boolean {
    if (!entity.input || !entity.movement || !entity.transform) {
      return false
    }

    const jumpHeld = entity.input.jumpRequested
    const jumpStartedByMovement = this.runtime.didMovementJumpStartThisTick(
      entity,
      deltaMs
    )

    if (!jumpHeld) {
      runtime.airJumpDetachArmed = true
      runtime.playerGroundJumpActive = false
    }

    if (jumpHeld && jumpStartedByMovement) {
      runtime.playerGroundJumpActive = true
      runtime.airJumpDetachArmed = false
    }

    const hasSuspensionGeometry =
      this.runtime.hasPlayerTetherSuspensionGeometry(entity, grapple, runtime)
    const hasRetractTension =
      entity.input.grappleClimbHeld < 0 &&
      this.hasPlayerTetherRetractTension(entity, grapple, runtime, deltaMs)
    const isSuspended =
      hasSuspensionGeometry ||
      hasRetractTension ||
      (runtime.playerTetherState === PlayerTetherState.Suspended &&
        !entity.movement.isGrounded)

    if (!isSuspended) {
      runtime.playerGroundJumpActive = entity.movement.isJumping && jumpHeld
      if (jumpHeld) {
        runtime.airJumpDetachArmed = false
      }
      if (
        !this.runtime.switchPlayerTetherState(
          entity,
          runtime,
          PlayerTetherState.GroundFollow
        )
      ) {
        return false
      }
      runtime.pendingPlayerVelocityTransfer = true
      runtime.lastSwingInputDirection = entity.input.moveDirection
    } else {
      if (runtime.playerGroundJumpActive) {
        runtime.playerGroundJumpActive = false
      }

      if (
        runtime.playerTetherState !== PlayerTetherState.Suspended &&
        !this.runtime.switchPlayerTetherState(
          entity,
          runtime,
          PlayerTetherState.Suspended
        )
      ) {
        return false
      }
      if (runtime.pendingPlayerVelocityTransfer) {
        this.syncTetherEndpointVelocityFromPlayer(entity, runtime)
        runtime.pendingPlayerVelocityTransfer = false
        runtime.lastSwingInputDirection = 0
      }
    }

    grapple.isTetherSuspended =
      runtime.playerTetherState === PlayerTetherState.Suspended
    return this.runtime.syncPlayerTetherEndpointBody(entity, runtime, deltaMs)
  }

  didMovementJumpStartThisTick(entity: Entity, deltaMs: number): boolean {
    const movement = entity.movement
    if (!movement?.isJumping) {
      return false
    }

    const jumpElapsedMs = movement.jumpElapsedTime * 1000
    return jumpElapsedMs <= deltaMs + 0.001
  }

  shouldDetachTetherForSuspendedJump(
    entity: Entity,
    _grapple: NonNullable<Entity['grapple']>,
    runtime: RopeRuntime
  ): boolean {
    if (!entity.input?.jumpRequested) {
      return false
    }
    if (!runtime.airJumpDetachArmed) {
      return false
    }
    if (!entity.input.inputBuffer.hasActiveAction('jump')) {
      return false
    }
    return this.canDetachPlayerTetherForAirJump(entity, runtime)
  }

  private canDetachPlayerTetherForAirJump(
    entity: Entity,
    runtime: RopeRuntime
  ): boolean {
    if (!runtime.playerAttached || runtime.playerGroundJumpActive) {
      return false
    }
    if (entity.movement?.isGrounded !== false) {
      return false
    }
    return runtime.playerTetherState !== PlayerTetherState.GroundFollow
  }

  isPlayerTetherSuspended(
    _entity: Entity,
    _grapple: NonNullable<Entity['grapple']>,
    runtime: RopeRuntime
  ): boolean {
    if (runtime.playerGroundJumpActive) {
      return false
    }
    return runtime.playerTetherState === PlayerTetherState.Suspended
  }

  hasPlayerTetherSuspensionGeometry(
    entity: Entity,
    grapple: NonNullable<Entity['grapple']>,
    runtime: RopeRuntime
  ): boolean {
    if (!entity.transform || !entity.movement || entity.movement.isGrounded) {
      return false
    }

    const dx = entity.transform.x - grapple.targetX
    const dy = entity.transform.y - grapple.targetY
    const minVerticalDrop = entity.render?.radius ?? DEFAULT_PLAYER_RADIUS
    if (!(dy > minVerticalDrop)) {
      return false
    }

    const distSq = dx * dx + dy * dy
    if (distSq <= 0.0001) {
      return false
    }
    if (dy * dy * 2 < distSq) {
      return false
    }

    const ropeLength = Math.max(
      0.01,
      this.runtime.calculateCurrentRopeLength(runtime)
    )
    const slack = DEFAULT_GRAPPLE_ROPE_SEGMENT_LENGTH * 2
    const tautLength = Math.max(0.01, ropeLength - slack)
    return distSq >= tautLength * tautLength
  }

  private hasPlayerTetherRetractTension(
    entity: Entity,
    grapple: NonNullable<Entity['grapple']>,
    runtime: RopeRuntime,
    deltaMs: number
  ): boolean {
    if (!entity.transform) {
      return false
    }

    const dx = entity.transform.x - grapple.targetX
    const dy = entity.transform.y - grapple.targetY
    const distSq = dx * dx + dy * dy
    if (distSq <= 0.0001) {
      return false
    }

    const retractDelta = (GRAPPLE_CLIMB_SPEED * deltaMs) / 1000
    const ropeLength = Math.max(
      0.01,
      this.runtime.calculateCurrentRopeLength(runtime) - retractDelta
    )
    const tautLength = ropeLength + DEFAULT_GRAPPLE_ROPE_SEGMENT_RADIUS
    return distSq >= tautLength * tautLength
  }

  syncPlayerTetherEndpointBody(
    entity: Entity,
    runtime: RopeRuntime,
    deltaMs: number
  ): boolean {
    if (!entity.transform) {
      return false
    }

    const x = entity.transform.x
    const y = entity.transform.y
    if (runtime.playerTetherState === PlayerTetherState.GroundFollow) {
      const playerAnchorBodyId = runtime.playerAnchorBodyId
      if (
        !this.runtime.isBodyId(playerAnchorBodyId) ||
        !this.runtime.box2d.b2Body_IsValid(playerAnchorBodyId)
      ) {
        return false
      }
      this.runtime.syncKinematicAnchorBody(
        playerAnchorBodyId,
        x,
        y,
        runtime.playerFollowX,
        runtime.playerFollowY,
        deltaMs
      )
    }
    runtime.playerFollowX = x
    runtime.playerFollowY = y
    return true
  }

  private syncTetherEndpointVelocityFromPlayer(
    entity: Entity,
    runtime: RopeRuntime
  ): void {
    if (!entity.physics) {
      return
    }

    const attachBodyId =
      runtime.attachIndex >= 0
        ? runtime.segmentBodies[runtime.attachIndex]
        : runtime.anchorBodyId
    if (
      !this.runtime.isBodyId(attachBodyId) ||
      !this.runtime.box2d.b2Body_IsValid(attachBodyId) ||
      this.runtime.box2d.b2Body_GetMass(attachBodyId) <= 0
    ) {
      return
    }

    const playerVelocity = this.runtime.box2d.b2Body_GetLinearVelocity(
      entity.physics.bodyId
    )
    this.runtime.tempVec.x = playerVelocity.x
    this.runtime.tempVec.y = playerVelocity.y
    this.runtime.box2d.b2Body_SetLinearVelocity(
      attachBodyId,
      this.runtime.tempVec
    )
    this.runtime.box2d.b2Body_SetAwake(attachBodyId, true)
    playerVelocity.delete()
  }

  getPlayerTetherBodyId(entity: Entity, runtime: RopeRuntime): b2BodyId | null {
    if (runtime.playerTetherState === PlayerTetherState.GroundFollow) {
      return runtime.playerAnchorBodyId
    }
    return entity.physics?.bodyId ?? null
  }

  updateAnchorTether(
    entity: Entity,
    grapple: NonNullable<Entity['grapple']>,
    deltaMs: number
  ): void {
    if (!entity.input || !entity.physics || !entity.movement) {
      this.runtime.stopPull(entity, grapple, false)
      return
    }

    const runtime = this.runtime.ropeRuntimeByEntityId.get(entity.id)
    if (!runtime || !runtime.active) {
      this.runtime.stopPull(entity, grapple, false)
      return
    }

    const isDynamicAnchor = runtime.anchorIsDynamicTarget

    if (!this.runtime.syncTetherAnchorTarget(runtime, grapple)) {
      this.runtime.stopPull(entity, grapple, false)
      return
    }

    // MovementSystem 会先于 GrappleSystem 消费跳跃输入，因此这里补偿本帧已起跳的情况。
    // 只有角色处于“悬空吊起”的绳索状态时，跳跃才销毁绳索；落地状态必须保留绳索，
    // 并继续在 updatePlayerTetherState() 中让绳索端点跟随角色身体。
    if (
      this.runtime.didMovementJumpStartThisTick(entity, deltaMs) &&
      runtime.airJumpDetachArmed &&
      this.canDetachPlayerTetherForAirJump(entity, runtime)
    ) {
      this.runtime.detachPlayerFromTether(entity, grapple, runtime, false, true)
      return
    }

    if (
      !this.runtime.updatePlayerTetherState(entity, grapple, runtime, deltaMs)
    ) {
      this.runtime.stopPull(entity, grapple, false)
      return
    }

    if (
      this.runtime.shouldDetachTetherForSuspendedJump(entity, grapple, runtime)
    ) {
      this.runtime.detachPlayerFromTetherForJump(entity, grapple, runtime)
      return
    }

    entity.input.grappleLengthAdjustSteps = 0
    const isRetractingTether = entity.input.grappleClimbHeld < 0
    const playerBodyId = this.runtime.getPlayerTetherBodyId(entity, runtime)
    if (!this.runtime.isBodyId(playerBodyId)) {
      this.runtime.stopPull(entity, grapple, false)
      return
    }

    const isTetherSuspended = this.runtime.isPlayerTetherSuspended(
      entity,
      grapple,
      runtime
    )
    if (isTetherSuspended) {
      this.runtime.handleSwingInput(entity, grapple, runtime, deltaMs)
    }

    if (isDynamicAnchor) {
      if (
        !this.runtime.syncDynamicTetherEndpointBodies(entity, runtime, deltaMs)
      ) {
        this.runtime.stopPull(entity, grapple, false)
        return
      }
      this.runtime.adjustTetherLength(
        entity,
        runtime,
        deltaMs,
        playerBodyId,
        false
      )
      this.applyPlayerRopeBendStiffness(runtime, playerBodyId)
      if (isTetherSuspended || isDynamicAnchor) {
        this.runtime.applyPlayerTetherLimitTension(
          entity,
          grapple,
          runtime,
          isRetractingTether
        )
      }
      return
    }

    const anchorBodyId = runtime.anchorBodyId
    if (!this.runtime.isBodyId(anchorBodyId)) {
      this.runtime.stopPull(entity, grapple, false)
      return
    }

    this.runtime.adjustTetherLength(
      entity,
      runtime,
      deltaMs,
      playerBodyId,
      true
    )
    this.applyPlayerRopeBendStiffness(runtime, playerBodyId)
    if (isTetherSuspended) {
      this.runtime.applyPlayerTetherLimitTension(
        entity,
        grapple,
        runtime,
        isRetractingTether
      )
    }
  }

  private applyPlayerRopeBendStiffness(
    runtime: RopeRuntime,
    playerBodyId: b2BodyId
  ): void {
    this.runtime.applyRopeBendStiffnessToBodyChain(
      runtime.anchorBodyId,
      runtime.segmentBodies,
      this.getActivePlayerRopeSegmentCount(runtime),
      playerBodyId
    )
  }

  detachPlayerFromTetherForJump(
    entity: Entity,
    grapple: NonNullable<Entity['grapple']>,
    runtime: RopeRuntime
  ): void {
    if (!entity.input) {
      return
    }

    entity.input.inputBuffer.clearAction('jump')
    entity.input.jumpRequested = false
    this.runtime.detachPlayerFromTether(entity, grapple, runtime, true)
  }

  destroyConnectedPlayerRope(
    entity: Entity,
    grapple: NonNullable<Entity['grapple']>
  ): void {
    if (grapple.isRopeClimbing) {
      this.runtime.stopRopeClimb(entity, grapple, false)
    }

    const runtime = this.runtime.ropeRuntimeByEntityId.get(entity.id)
    if (runtime?.active === true) {
      if (runtime.playerAttached) {
        this.runtime.detachPlayerFromTether(
          entity,
          grapple,
          runtime,
          false,
          true
        )
      } else {
        this.runtime.destroyPlayerRopeRuntime(runtime)
      }
      return
    }

    if (grapple.isTethering) {
      this.runtime.stopPull(entity, grapple, false)
    }
  }

  detachPlayerFromTether(
    entity: Entity,
    grapple: NonNullable<Entity['grapple']>,
    runtime: RopeRuntime,
    applyJump: boolean,
    forceDestroy = false
  ): void {
    if (!entity.input) {
      return
    }

    entity.input.grappleLengthAdjustSteps = 0
    const destroyOnDetach =
      forceDestroy ||
      applyJump ||
      this.runtime.hasPlayerTetherSuspensionGeometry(entity, grapple, runtime)

    this.runtime.destroyJointIfValid(runtime.playerJointId)
    runtime.playerJointId = null
    this.runtime.destroyBodyIfValid(runtime.playerAnchorBodyId)
    runtime.playerAnchorBodyId = null
    runtime.playerAttached = false
    runtime.playerTetherState = PlayerTetherState.Airborne
    runtime.playerGroundJumpActive = false
    runtime.airJumpDetachArmed = true
    runtime.pendingPlayerVelocityTransfer = false
    runtime.lastSwingInputDirection = 0
    grapple.isTetherSuspended = false

    if (
      this.runtime.ropeRuntimeByEntityId.get(runtime.ownerEntityId) === runtime
    ) {
      this.runtime.ropeRuntimeByEntityId.delete(runtime.ownerEntityId)
    }

    if (applyJump) {
      this.runtime.performRopeJump(entity, grapple)
    }

    this.runtime.resetGrappleMotion(grapple, true)

    if (destroyOnDetach) {
      this.runtime.destroyPlayerRopeRuntime(runtime)
    } else {
      this.runtime.addDetachedPlayerRope(runtime)
    }
  }

  addDetachedPlayerRope(runtime: RopeRuntime): void {
    for (let i = 0; i < this.runtime.detachedPlayerRopes.length; i++) {
      if (this.runtime.detachedPlayerRopes[i] === runtime) {
        return
      }
    }
    this.runtime.detachedPlayerRopes.push(runtime)
  }

  adjustTetherLength(
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
    const previousActiveCount = this.getActivePlayerRopeSegmentCount(runtime)

    if (climbDir < 0) {
      const currentTotalLength =
        this.runtime.calculateCurrentRopeLength(runtime)
      const minTotalLength = this.runtime.getPlayerTetherMinLength(
        entity,
        runtime
      )
      const retractDelta = Math.min(
        delta,
        Math.max(0, currentTotalLength - minTotalLength)
      )
      if (!(retractDelta > 0)) {
        return
      }

      runtime.jointMaxLen -= retractDelta

      while (runtime.jointMaxLen <= 0 && runtime.attachIndex > -1) {
        runtime.attachIndex--
        runtime.jointMaxLen += linkLen
      }
      if (runtime.attachIndex <= -1) {
        runtime.attachIndex = -1
        if (runtime.jointMaxLen < 0) runtime.jointMaxLen = 0
      }
    } else {
      const currentTotalLength =
        this.runtime.calculateCurrentRopeLength(runtime)
      if (currentTotalLength >= runtime.maxRopeLength) {
        return
      }

      runtime.jointMaxLen += delta

      while (
        runtime.jointMaxLen >= linkLen * 2 &&
        runtime.attachIndex < runtime.segmentCount - 1
      ) {
        const nextIdx = runtime.attachIndex + 1
        this.setPlayerRopeSegmentEnabledAt(runtime, nextIdx, true)
        this.runtime.repositionSegment(entity, runtime, nextIdx)
        runtime.attachIndex = nextIdx
        runtime.jointMaxLen -= linkLen
      }
      if (runtime.attachIndex >= runtime.segmentCount - 1) {
        if (runtime.jointMaxLen > linkLen) runtime.jointMaxLen = linkLen
      }
    }

    this.runtime.rebuildPlayerTetherJoint(runtime, playerBodyId, useAnchorLocal)
    this.syncChangedPlayerRopeSegmentActivity(runtime, previousActiveCount)
  }

  getPlayerTetherMinLength(entity: Entity, runtime: RopeRuntime): number {
    if (!runtime.anchorIsDynamicTarget || runtime.anchorEntityId < 0) {
      return DEFAULT_GRAPPLE_TETHER_MIN_LENGTH
    }

    return this.runtime.getPlayerTetherMinLengthForTarget(
      entity,
      this.runtime.getEntityById(runtime.anchorEntityId)
    )
  }

  getPlayerTetherMinLengthForTarget(
    entity: Entity,
    target: Entity | null | undefined
  ): number {
    const playerRadius = Math.max(
      DEFAULT_PLAYER_RADIUS,
      entity.render?.radius ?? DEFAULT_PLAYER_RADIUS
    )
    const targetRadius = Math.max(0, target?.render?.radius ?? 0)
    return Math.max(
      DEFAULT_GRAPPLE_TETHER_MIN_LENGTH,
      playerRadius + targetRadius + DEFAULT_GRAPPLE_ROPE_SEGMENT_RADIUS
    )
  }

  rebuildPlayerTetherJoint(
    runtime: RopeRuntime,
    playerBodyId: b2BodyId,
    useAnchorLocal: boolean
  ): void {
    const anchorBodyId = runtime.anchorBodyId
    if (!this.runtime.isBodyId(anchorBodyId)) return
    this.runtime.destroyJointIfValid(runtime.playerJointId)
    const attachBodyId =
      runtime.attachIndex >= 0
        ? runtime.segmentBodies[runtime.attachIndex]
        : anchorBodyId
    const attachLocalX =
      useAnchorLocal && runtime.attachIndex < 0 ? runtime.anchorLocalX : 0
    const attachLocalY =
      useAnchorLocal && runtime.attachIndex < 0 ? runtime.anchorLocalY : 0
    runtime.playerJointId = this.runtime.createFixedDistanceJoint(
      attachBodyId,
      playerBodyId,
      Math.max(0.01, runtime.jointMaxLen),
      attachLocalX,
      attachLocalY
    )
  }

  syncTetherAnchorTarget(
    runtime: RopeRuntime,
    grapple: NonNullable<Entity['grapple']>
  ): boolean {
    if (runtime.anchorEntityId < 0) {
      return true
    }
    const endpoint = this.runtime.tetherEndpoint
    if (!this.runtime.resolveRuntimeAnchorEndpoint(runtime, endpoint)) {
      return false
    }
    grapple.targetX = endpoint.x
    grapple.targetY = endpoint.y
    grapple.targetEntityId = endpoint.entityId
    if (
      !runtime.anchorIsDynamicTarget &&
      runtime.anchorBodyOwned &&
      this.runtime.isBodyId(runtime.anchorBodyId) &&
      this.runtime.box2d.b2Body_IsValid(runtime.anchorBodyId)
    ) {
      this.runtime.tempVec.x = endpoint.x
      this.runtime.tempVec.y = endpoint.y
      this.runtime.box2d.b2Body_SetTransform(
        runtime.anchorBodyId,
        this.runtime.tempVec,
        this.runtime.tempRot
      )
    }
    return true
  }

  resolveRuntimeAnchorEndpoint(
    runtime: RopeRuntime,
    out: RopeEndpointBuild
  ): boolean {
    if (runtime.anchorEntityId < 0) {
      return false
    }
    const anchorEntity = this.runtime.getEntityById(runtime.anchorEntityId)
    if (!anchorEntity) {
      return false
    }
    if (!this.runtime.resolveGrappleEndpoint(anchorEntity, out, false)) {
      return false
    }
    if (out.hasDynamicBody !== runtime.anchorIsDynamicTarget) {
      return false
    }
    if (!runtime.anchorIsDynamicTarget) {
      return true
    }
    if (!this.runtime.isBodyId(out.bodyId)) {
      return false
    }
    out.localX = runtime.anchorLocalX
    out.localY = runtime.anchorLocalY
    this.runtime.writeGrappleTargetWorldPoint(
      anchorEntity,
      out.bodyId,
      out.localX,
      out.localY,
      out
    )
    return true
  }

  hasDynamicAnchorTether(entity: Entity): boolean {
    const runtime = this.runtime.ropeRuntimeByEntityId.get(entity.id)
    return runtime?.active === true && runtime.anchorIsDynamicTarget
  }

  syncDynamicTetherEndpointBodies(
    entity: Entity,
    runtime: RopeRuntime,
    deltaMs: number
  ): boolean {
    if (
      !entity.transform ||
      runtime.anchorEntityId < 0 ||
      !runtime.anchorIsDynamicTarget
    ) {
      return false
    }
    const endpoint = this.runtime.tetherEndpoint
    if (
      !this.runtime.isBodyId(runtime.anchorBodyId) ||
      !this.runtime.resolveRuntimeAnchorEndpoint(runtime, endpoint)
    ) {
      return false
    }

    this.runtime.syncKinematicAnchorBody(
      runtime.anchorBodyId,
      endpoint.x,
      endpoint.y,
      runtime.anchorFollowX,
      runtime.anchorFollowY,
      deltaMs
    )
    runtime.anchorFollowX = endpoint.x
    runtime.anchorFollowY = endpoint.y
    return true
  }

  syncKinematicAnchorBody(
    bodyId: b2BodyId,
    x: number,
    y: number,
    previousX: number,
    previousY: number,
    deltaMs: number
  ): void {
    const invDelta = deltaMs > 0 ? 1000 / deltaMs : 0
    this.runtime.tempVec.x = (x - previousX) * invDelta
    this.runtime.tempVec.y = (y - previousY) * invDelta
    this.runtime.box2d.b2Body_SetLinearVelocity(bodyId, this.runtime.tempVec)
    this.runtime.tempVec.x = x
    this.runtime.tempVec.y = y
    this.runtime.box2d.b2Body_SetTransform(
      bodyId,
      this.runtime.tempVec,
      this.runtime.tempRot
    )
  }

  applyPlayerTetherLimitTension(
    entity: Entity,
    grapple: NonNullable<Entity['grapple']>,
    runtime: RopeRuntime,
    isRetractingTether: boolean
  ): void {
    if (!entity.transform || !entity.physics) {
      return
    }

    const anchorX = grapple.targetX
    const anchorY = grapple.targetY
    const playerX = entity.transform.x
    const playerY = entity.transform.y
    const dx = playerX - anchorX
    const dy = playerY - anchorY
    const distSq = dx * dx + dy * dy
    if (distSq <= 0.0001) {
      return
    }

    const ropeLength = Math.max(
      0.01,
      this.runtime.calculateCurrentRopeLength(runtime)
    )
    const dist = Math.sqrt(distSq)
    const elasticLimit = this.runtime.getRopeElasticLimitLength(ropeLength)
    const isAtElasticLimit = this.runtime.isDistanceAtRopeElasticLimit(
      distSq,
      ropeLength
    )
    const retractTensionStretch = isRetractingTether
      ? this.runtime.getRopeRetractTensionStretch(dist, ropeLength)
      : 0
    if (!isAtElasticLimit && !(retractTensionStretch > 0)) {
      return
    }

    const stretch = Math.max(0, dist - elasticLimit)
    const anchorBodyId = this.runtime.getPlayerTetherAnchorTensionBody(runtime)
    const playerBodyId = entity.physics.bodyId
    const anchorMovable = this.runtime.isTensionBodyMovable(anchorBodyId)
    const playerMovable = this.runtime.isTensionBodyMovable(playerBodyId)
    if (!anchorMovable && !playerMovable) {
      return
    }

    const invDist = 1 / dist
    const dirX = dx * invDist
    const dirY = dy * invDist
    const anchorSpeed = anchorMovable
      ? this.runtime.getBodyVelocityAlong(anchorBodyId, dirX, dirY)
      : 0
    const playerSpeed = playerMovable
      ? this.runtime.getBodyVelocityAlong(playerBodyId, dirX, dirY)
      : 0
    const relativeAwaySpeed = playerSpeed - anchorSpeed

    const endpointCount = (anchorMovable ? 1 : 0) + (playerMovable ? 1 : 0)
    const sharedLimitCorrectionSpeed = isAtElasticLimit
      ? this.runtime.getRopeLimitTensionSpeed(
          stretch,
          relativeAwaySpeed,
          endpointCount
        )
      : 0
    const fullLimitCorrectionSpeed = isAtElasticLimit
      ? this.runtime.getRopeLimitTensionSpeed(stretch, relativeAwaySpeed, 1)
      : 0
    const retractCorrectionSpeed = this.runtime.getRopeRetractTensionSpeed(
      retractTensionStretch,
      endpointCount
    )
    const anchorCorrectionSpeed = Math.max(
      playerMovable ? sharedLimitCorrectionSpeed : fullLimitCorrectionSpeed,
      retractCorrectionSpeed
    )
    const playerCorrectionSpeed = Math.max(
      fullLimitCorrectionSpeed,
      retractCorrectionSpeed
    )
    if (!(anchorCorrectionSpeed > 0) && !(playerCorrectionSpeed > 0)) {
      return
    }

    if (anchorMovable) {
      this.runtime.applyBodyVelocityCorrectionAtPoint(
        anchorBodyId,
        anchorX,
        anchorY,
        dirX,
        dirY,
        anchorCorrectionSpeed
      )
    }
    if (playerMovable) {
      this.runtime.applyBodyVelocityCorrectionAtPoint(
        playerBodyId,
        playerX,
        playerY,
        -dirX,
        -dirY,
        playerCorrectionSpeed
      )
    }
  }

  getPlayerTetherAnchorTensionBody(runtime: RopeRuntime): b2BodyId | null {
    if (!runtime.anchorIsDynamicTarget) {
      return runtime.anchorBodyId
    }

    if (runtime.anchorEntityId < 0) {
      return null
    }
    const anchorEntity = this.runtime.getEntityById(runtime.anchorEntityId)
    return anchorEntity ? this.runtime.getValidBodyId(anchorEntity) : null
  }

  isTensionBodyMovable(bodyId: b2BodyId | null): bodyId is b2BodyId {
    if (
      !this.runtime.isBodyId(bodyId) ||
      !this.runtime.box2d.b2Body_IsValid(bodyId)
    ) {
      return false
    }
    return this.runtime.box2d.b2Body_GetMass(bodyId) > 0
  }

  getRopeLimitTensionSpeed(
    stretch: number,
    relativeAwaySpeed: number,
    endpointCount: number
  ): number {
    if (endpointCount <= 0) {
      return 0
    }

    const pullbackSpeed =
      stretch > 0
        ? Math.min(
            this.runtime.dynamicTetherMaxSpeed,
            this.runtime.dynamicTetherBaseSpeed +
              stretch * this.runtime.dynamicTetherStretchSpeed
          )
        : 0
    const correctionSpeed = Math.max(0, relativeAwaySpeed + pullbackSpeed)
    if (!(correctionSpeed > 0)) {
      return 0
    }

    return correctionSpeed / endpointCount
  }

  getRopeRetractTensionStretch(dist: number, ropeLength: number): number {
    const stretch = dist - ropeLength - this.runtime.ropeRetractTensionSlack
    return stretch > 0 ? stretch : 0
  }

  getRopeRetractTensionSpeed(stretch: number, endpointCount: number): number {
    if (endpointCount <= 0 || !(stretch > 0)) {
      return 0
    }
    return (
      Math.min(
        GRAPPLE_CLIMB_SPEED,
        stretch * this.runtime.dynamicTetherStretchSpeed
      ) / endpointCount
    )
  }

  getBodyVelocityAlong(bodyId: b2BodyId, dirX: number, dirY: number): number {
    const velocity = this.runtime.box2d.b2Body_GetLinearVelocity(bodyId)
    const speed = velocity.x * dirX + velocity.y * dirY
    velocity.delete()
    return speed
  }

  repositionSegment(
    entity: Entity,
    runtime: RopeRuntime,
    segIndex: number
  ): void {
    if (segIndex < 0 || segIndex >= runtime.segmentCount) return
    if (!entity.physics) return
    const anchorBodyId = runtime.anchorBodyId
    if (segIndex <= 0 && !this.runtime.isBodyId(anchorBodyId)) return
    const prevBodyId =
      segIndex > 0 ? runtime.segmentBodies[segIndex - 1] : anchorBodyId
    if (!this.runtime.isBodyId(prevBodyId)) return
    const anchorEntity =
      segIndex === 0 &&
      runtime.anchorEntityId >= 0 &&
      runtime.anchorIsDynamicTarget
        ? this.runtime.getEntityById(runtime.anchorEntityId)
        : null
    const prevPos =
      anchorEntity?.transform === undefined
        ? this.runtime.box2d.b2Body_GetPosition(prevBodyId)
        : null
    const pPos = this.runtime.box2d.b2Body_GetPosition(entity.physics.bodyId)
    const prevX = anchorEntity?.transform?.x ?? prevPos?.x ?? 0
    const prevY = anchorEntity?.transform?.y ?? prevPos?.y ?? 0
    const dx = pPos.x - prevX
    const dy = pPos.y - prevY
    const d = Math.sqrt(dx * dx + dy * dy)
    const linkLen = runtime.linkLength
    if (d > 0.001) {
      const inv = linkLen / d
      this.runtime.tempVec.x = prevX + dx * inv
      this.runtime.tempVec.y = prevY + dy * inv
    } else {
      this.runtime.tempVec.x = prevX
      this.runtime.tempVec.y = prevY + linkLen
    }
    const segBody = runtime.segmentBodies[segIndex]
    if (
      !this.runtime.isBodyId(segBody) ||
      !this.runtime.box2d.b2Body_IsValid(segBody)
    ) {
      prevPos?.delete()
      pPos.delete()
      return
    }
    this.runtime.box2d.b2Body_SetTransform(
      segBody,
      this.runtime.tempVec,
      this.runtime.box2d.b2Body_GetRotation(segBody)
    )
    this.runtime.tempVec.Set(0, 0)
    this.runtime.box2d.b2Body_SetLinearVelocity(segBody, this.runtime.tempVec)
    prevPos?.delete()
    pPos.delete()
  }

  destroyAnchorTether(
    entity: Entity,
    grapple: NonNullable<Entity['grapple']>
  ): void {
    if (grapple.isRopeClimbing) {
      this.runtime.stopRopeClimb(entity, grapple, false)
    }

    const runtime = this.runtime.ropeRuntimeByEntityId.get(entity.id)
    if (!runtime || !runtime.active) {
      grapple.isTethering = false
      grapple.isTetherSuspended = false
      return
    }

    this.runtime.destroyPlayerRopeRuntime(runtime)
    if (this.runtime.ropeRuntimeByEntityId.get(entity.id) === runtime) {
      this.runtime.ropeRuntimeByEntityId.delete(entity.id)
    }
    grapple.isTethering = false
    grapple.isTetherSuspended = false
  }

  destroyPlayerRopeRuntime(runtime: RopeRuntime): void {
    this.runtime.stopRopeClimbersForPlayerRope(runtime)

    const ownerEntityId = runtime.ownerEntityId
    if (this.runtime.ropeRuntimeByEntityId.get(ownerEntityId) === runtime) {
      const owner = this.runtime.getEntityById(ownerEntityId)
      const grapple = owner?.grapple
      if (grapple) {
        this.runtime.resetGrappleMotion(grapple, false)
      }
      this.runtime.ropeRuntimeByEntityId.delete(ownerEntityId)
    }

    this.runtime.destroyJointIfValid(runtime.playerJointId)
    runtime.playerJointId = null

    for (let i = 0; i < runtime.segmentJoints.length; i++) {
      this.runtime.destroyJointIfValid(runtime.segmentJoints[i])
    }
    runtime.segmentJoints.length = 0

    for (let i = 0; i < runtime.segmentFilterJoints.length; i++) {
      this.runtime.destroyJointIfValid(runtime.segmentFilterJoints[i])
    }
    runtime.segmentFilterJoints.length = 0

    for (let i = 0; i < runtime.segmentBodies.length; i++) {
      this.runtime.destroyBodyIfValid(runtime.segmentBodies[i])
    }
    runtime.segmentBodies.length = 0

    if (runtime.anchorBodyOwned) {
      this.runtime.destroyBodyIfValid(runtime.anchorBodyId)
    }
    runtime.anchorBodyId = null
    runtime.ownerEntityId = -1
    runtime.anchorBodyOwned = false
    runtime.anchorIsDynamicTarget = false
    runtime.anchorEntityId = -1
    runtime.anchorLocalX = 0
    runtime.anchorLocalY = 0
    this.runtime.destroyBodyIfValid(runtime.playerAnchorBodyId)
    runtime.playerAnchorBodyId = null
    runtime.playerAttached = false
    runtime.playerTetherState = PlayerTetherState.Airborne
    runtime.playerGroundJumpActive = false
    runtime.airJumpDetachArmed = true
    runtime.pendingPlayerVelocityTransfer = false
    runtime.lastSwingInputDirection = 0
    runtime.anchorFollowX = 0
    runtime.anchorFollowY = 0
    runtime.playerFollowX = 0
    runtime.playerFollowY = 0

    runtime.segmentCount = 0
    runtime.linkLength = DEFAULT_GRAPPLE_ROPE_SEGMENT_LENGTH
    runtime.attachIndex = -1
    runtime.hitId = 0
    runtime.health = 0
    runtime.renderLayer = 0
    this.runtime.resetRopeHitShake(runtime)
    runtime.active = false
  }

  transferTetherToSelectedTarget(
    entity: Entity,
    grapple: NonNullable<Entity['grapple']>
  ): boolean {
    if (!entity.input) {
      return false
    }
    const runtime = this.runtime.ropeRuntimeByEntityId.get(entity.id)
    if (!runtime?.active || runtime.anchorEntityId < 0) {
      return false
    }

    const source = this.runtime.getEntityById(runtime.anchorEntityId)
    if (!source?.transform) {
      return false
    }

    const target = this.runtime.resolveTetherTransferTarget(
      entity,
      runtime,
      source
    )
    if (!target || !this.runtime.canUseLockedTarget(entity, target)) {
      return false
    }

    if (!this.runtime.createBridgeRope(source, target, runtime)) {
      return false
    }

    this.runtime.destroyAnchorTether(entity, grapple)
    this.runtime.resetGrappleMotion(grapple, false)
    entity.input.grappleLengthAdjustSteps = 0
    entity.input.grapplePersistentRequested = false
    return true
  }

  resolveTetherTransferTarget(
    entity: Entity,
    runtime: RopeRuntime,
    source: Entity
  ): Entity | null {
    const lockedTargetId = entity.input?.lockedTargetId ?? null
    if (lockedTargetId !== null && lockedTargetId !== runtime.anchorEntityId) {
      return this.runtime.getEntityById(lockedTargetId)
    }

    if (!entity.transform || !source.transform) {
      return null
    }

    const facing =
      entity.input?.lastMoveDirection !== undefined &&
      entity.input.lastMoveDirection !== 0
        ? entity.input.lastMoveDirection
        : 1
    return this.runtime.findAnchorTarget(
      entity.transform.x,
      entity.transform.y,
      facing,
      this.runtime.tempTarget,
      entity.render?.renderLayer ?? 0,
      source.transform.x,
      source.transform.y
    )
  }

  resolveGrappleEndpoint(
    entity: Entity,
    out: RopeEndpointBuild,
    requireTether: boolean
  ): boolean {
    const transform = entity.transform
    if (!transform) {
      return false
    }

    out.entityId = entity.id
    out.bodyId = null
    out.bodyOwned = false
    out.localX = 0
    out.localY = 0
    out.x = transform.x
    out.y = transform.y
    out.renderLayer = entity.render?.renderLayer ?? 0
    out.hasDynamicBody = false

    const target = entity.grappleTarget
    if (target) {
      if (requireTether && !target.canTether) {
        return false
      }
      const bodyId = this.runtime.getValidBodyId(entity)
      if (!bodyId) {
        return false
      }
      out.bodyId = bodyId
      out.localX = target.anchorLocalX
      out.localY = target.anchorLocalY
      this.runtime.writeGrappleTargetWorldPoint(
        entity,
        bodyId,
        out.localX,
        out.localY,
        out
      )
      out.hasDynamicBody = true
      return true
    }

    return entity.grappleAnchor !== undefined
  }
}
