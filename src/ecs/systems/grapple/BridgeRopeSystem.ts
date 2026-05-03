import {
  DEFAULT_GRAPPLE_ROPE_MAX_SEGMENTS,
  DEFAULT_GRAPPLE_ROPE_SEGMENT_LENGTH,
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
import type {
  RopeBridgeRuntime,
  RopeEndpointBuild,
  RopeRuntime,
} from './GrappleTypes'

export class BridgeRopeSystem {
  constructor(private readonly runtime: GrappleSystemRuntime) {}

  createBridgeRope(
    source: Entity,
    target: Entity,
    ignoredPlayerRuntime: RopeRuntime | null = null
  ): boolean {
    if (source.id === target.id) {
      return false
    }

    const endpointA = this.runtime.bridgeEndpointA
    const endpointB = this.runtime.bridgeEndpointB
    if (!this.runtime.resolveBridgeEndpoint(source, endpointA)) {
      return false
    }
    if (!this.runtime.resolveBridgeEndpoint(target, endpointB)) {
      return false
    }

    if (endpointA.renderLayer !== endpointB.renderLayer) {
      return false
    }

    if (
      endpointA.hasDynamicBody &&
      endpointB.hasDynamicBody &&
      this.runtime.isBodyId(endpointA.bodyId) &&
      this.runtime.isBodyId(endpointB.bodyId) &&
      this.runtime.areBodyIdsEqual(endpointA.bodyId, endpointB.bodyId)
    ) {
      return false
    }

    const dx = endpointB.x - endpointA.x
    const dy = endpointB.y - endpointA.y
    const distSq = dx * dx + dy * dy
    if (distSq <= 0.0001) {
      return false
    }

    const existing = this.runtime.findBridgeRope(source.id, target.id)
    if (
      !this.runtime.canCreateRopeOnTarget(
        endpointA.entityId,
        ignoredPlayerRuntime,
        existing
      ) ||
      !this.runtime.canCreateRopeOnTarget(
        endpointB.entityId,
        ignoredPlayerRuntime,
        existing
      )
    ) {
      return false
    }

    if (existing) {
      this.runtime.destroyBridgeRope(existing)
    }

    const runtime = this.runtime.acquireBridgeRope()
    runtime.active = false
    runtime.climbTuningActive = false
    runtime.endpointAEntityId = endpointA.entityId
    runtime.endpointBEntityId = endpointB.entityId
    runtime.bodyAId = this.runtime.createKinematicAnchorBody(
      endpointA.x,
      endpointA.y
    )
    runtime.bodyAOwned = true
    runtime.bodyBId = this.runtime.createKinematicAnchorBody(
      endpointB.x,
      endpointB.y
    )
    runtime.bodyBOwned = true
    runtime.targetABodyId = endpointA.bodyId
    runtime.targetBBodyId = endpointB.bodyId
    runtime.endpointAHasDynamicBody = endpointA.hasDynamicBody
    runtime.endpointBHasDynamicBody = endpointB.hasDynamicBody
    runtime.localAX = endpointA.localX
    runtime.localAY = endpointA.localY
    runtime.localBX = endpointB.localX
    runtime.localBY = endpointB.localY
    runtime.followAX = endpointA.x
    runtime.followAY = endpointA.y
    runtime.followBX = endpointB.x
    runtime.followBY = endpointB.y
    runtime.renderLayer = endpointA.renderLayer
    runtime.hitId = this.runtime.nextRopeHitId++
    runtime.health = this.runtime.getDefaultRopeHealth()
    this.runtime.resetRopeHitShake(runtime)
    runtime.segmentBodies.length = 0
    runtime.segmentJoints.length = 0
    runtime.segmentFilterJoints.length = 0

    const ropeLength = Math.sqrt(distSq)
    const linkCount = Math.max(
      1,
      Math.min(
        DEFAULT_GRAPPLE_ROPE_MAX_SEGMENTS,
        Math.ceil(ropeLength / DEFAULT_GRAPPLE_ROPE_SEGMENT_LENGTH)
      )
    )
    const segmentCount = linkCount - 1
    const linkLength = ropeLength / linkCount
    runtime.segmentCount = segmentCount
    runtime.linkLength = linkLength
    runtime.maxRopeLength = ropeLength

    const invDist = 1 / ropeLength
    const dirX = dx * invDist
    const dirY = dy * invDist
    const categoryBits =
      getRopeCollisionCategory(runtime.renderLayer) |
      getWeaponCollisionCategory(runtime.renderLayer)
    const maskBits =
      getGroundCollisionCategory(runtime.renderLayer) |
      getObstacleCollisionCategory(runtime.renderLayer)

    let previousBodyId = runtime.bodyAId
    for (let i = 0; i < segmentCount; i++) {
      if (!this.runtime.isBodyId(previousBodyId)) {
        this.runtime.destroyBridgeRope(runtime)
        return false
      }
      const centerFactor = i + 1
      const centerX = endpointA.x + dirX * (centerFactor * linkLength)
      const centerY = endpointA.y + dirY * (centerFactor * linkLength)
      const segmentBodyId = this.runtime.createRopeSegmentBody(
        centerX,
        centerY,
        runtime.renderLayer,
        this.runtime.dynamicTetherRopeDensity,
        categoryBits,
        maskBits
      )
      runtime.segmentBodies.push(segmentBodyId)
      if (endpointA.hasDynamicBody && this.runtime.isBodyId(endpointA.bodyId)) {
        runtime.segmentFilterJoints.push(
          this.runtime.createBodyCollisionFilterJoint(
            segmentBodyId,
            endpointA.bodyId
          )
        )
      }
      if (endpointB.hasDynamicBody && this.runtime.isBodyId(endpointB.bodyId)) {
        runtime.segmentFilterJoints.push(
          this.runtime.createBodyCollisionFilterJoint(
            segmentBodyId,
            endpointB.bodyId
          )
        )
      }
      runtime.segmentJoints.push(
        this.runtime.createFixedDistanceJoint(
          previousBodyId,
          segmentBodyId,
          linkLength
        )
      )
      previousBodyId = segmentBodyId
    }

    if (
      !this.runtime.isBodyId(previousBodyId) ||
      !this.runtime.isBodyId(runtime.bodyBId)
    ) {
      this.runtime.destroyBridgeRope(runtime)
      return false
    }
    runtime.segmentJoints.push(
      this.runtime.createFixedDistanceJoint(
        previousBodyId,
        runtime.bodyBId,
        linkLength
      )
    )

    runtime.active = true
    return true
  }

  resolveBridgeEndpoint(entity: Entity, out: RopeEndpointBuild): boolean {
    return this.runtime.resolveGrappleEndpoint(entity, out, true)
  }

  acquireBridgeRope(): RopeBridgeRuntime {
    for (let i = 0; i < this.runtime.bridgeRopes.length; i++) {
      const runtime = this.runtime.bridgeRopes[i]
      if (!runtime.active) {
        return runtime
      }
    }

    const runtime: RopeBridgeRuntime = {
      active: false,
      hitId: 0,
      health: 0,
      hitShakeSegmentIndex: -1,
      hitShakeStartTimeMs: 0,
      hitShakeEndTimeMs: 0,
      hitShakeDirX: 0,
      hitShakeDirY: 0,
      endpointAEntityId: -1,
      endpointBEntityId: -1,
      bodyAId: null,
      bodyAOwned: false,
      bodyBId: null,
      bodyBOwned: false,
      targetABodyId: null,
      targetBBodyId: null,
      endpointAHasDynamicBody: false,
      endpointBHasDynamicBody: false,
      localAX: 0,
      localAY: 0,
      localBX: 0,
      localBY: 0,
      followAX: 0,
      followAY: 0,
      followBX: 0,
      followBY: 0,
      renderLayer: 0,
      segmentCount: 0,
      linkLength: DEFAULT_GRAPPLE_ROPE_SEGMENT_LENGTH,
      maxRopeLength: 0,
      segmentBodies: [],
      segmentJoints: [],
      segmentFilterJoints: [],
      climbTuningActive: false,
    }
    this.runtime.bridgeRopes.push(runtime)
    return runtime
  }

  findBridgeRope(
    endpointAEntityId: number,
    endpointBEntityId: number
  ): RopeBridgeRuntime | null {
    for (let i = 0; i < this.runtime.bridgeRopes.length; i++) {
      const runtime = this.runtime.bridgeRopes[i]
      if (!runtime.active) continue
      if (
        (runtime.endpointAEntityId === endpointAEntityId &&
          runtime.endpointBEntityId === endpointBEntityId) ||
        (runtime.endpointAEntityId === endpointBEntityId &&
          runtime.endpointBEntityId === endpointAEntityId)
      ) {
        return runtime
      }
    }
    return null
  }

  updateBridgeRopes(deltaMs: number): void {
    for (let i = 0; i < this.runtime.bridgeRopes.length; i++) {
      const runtime = this.runtime.bridgeRopes[i]
      if (!runtime.active) continue
      if (!this.runtime.syncBridgeEndpoint(runtime, true, deltaMs)) {
        this.runtime.destroyBridgeRope(runtime)
        continue
      }
      if (!this.runtime.syncBridgeEndpoint(runtime, false, deltaMs)) {
        this.runtime.destroyBridgeRope(runtime)
        continue
      }
      this.runtime.applyBridgeLimitTension(runtime)
    }
  }

  updateDetachedPlayerRopes(deltaMs: number): void {
    for (let i = 0; i < this.runtime.detachedPlayerRopes.length; i++) {
      const runtime = this.runtime.detachedPlayerRopes[i]
      if (!runtime.active || runtime.playerAttached) {
        continue
      }
      if (this.runtime.syncDetachedPlayerRopeAnchor(runtime, deltaMs)) {
        continue
      }
      this.runtime.destroyPlayerRopeRuntime(runtime)
    }
  }

  syncDetachedPlayerRopeAnchor(runtime: RopeRuntime, deltaMs: number): boolean {
    const anchorBodyId = runtime.anchorBodyId
    if (
      !this.runtime.isBodyId(anchorBodyId) ||
      !this.runtime.box2d.b2Body_IsValid(anchorBodyId)
    ) {
      return false
    }
    if (runtime.anchorEntityId < 0) {
      return true
    }

    const endpoint = this.runtime.tetherEndpoint
    if (!this.runtime.resolveRuntimeAnchorEndpoint(runtime, endpoint)) {
      return false
    }

    if (runtime.anchorIsDynamicTarget) {
      this.runtime.syncKinematicAnchorBody(
        anchorBodyId,
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

    this.runtime.tempVec.x = endpoint.x
    this.runtime.tempVec.y = endpoint.y
    this.runtime.box2d.b2Body_SetTransform(
      anchorBodyId,
      this.runtime.tempVec,
      this.runtime.tempRot
    )
    runtime.anchorFollowX = endpoint.x
    runtime.anchorFollowY = endpoint.y
    return true
  }

  resolveBridgeRuntimeEndpoint(
    runtime: RopeBridgeRuntime,
    useEndpointA: boolean,
    out: RopeEndpointBuild
  ): boolean {
    const entityId = useEndpointA
      ? runtime.endpointAEntityId
      : runtime.endpointBEntityId
    const targetBodyId = useEndpointA
      ? runtime.targetABodyId
      : runtime.targetBBodyId
    const hasDynamicBody = useEndpointA
      ? runtime.endpointAHasDynamicBody
      : runtime.endpointBHasDynamicBody
    const entity = this.runtime.getEntityById(entityId)
    if (!entity || !this.runtime.resolveGrappleEndpoint(entity, out, false)) {
      return false
    }
    if (out.hasDynamicBody !== hasDynamicBody) {
      return false
    }
    if (!hasDynamicBody) {
      return true
    }
    if (
      !this.runtime.isBodyId(out.bodyId) ||
      !this.runtime.isBodyId(targetBodyId) ||
      !this.runtime.areBodyIdsEqual(out.bodyId, targetBodyId)
    ) {
      return false
    }
    out.localX = useEndpointA ? runtime.localAX : runtime.localBX
    out.localY = useEndpointA ? runtime.localAY : runtime.localBY
    this.runtime.writeGrappleTargetWorldPoint(
      entity,
      targetBodyId,
      out.localX,
      out.localY,
      out
    )
    return true
  }

  syncBridgeEndpoint(
    runtime: RopeBridgeRuntime,
    useEndpointA: boolean,
    deltaMs: number
  ): boolean {
    const bodyId = useEndpointA ? runtime.bodyAId : runtime.bodyBId
    if (
      !this.runtime.isBodyId(bodyId) ||
      !this.runtime.box2d.b2Body_IsValid(bodyId)
    ) {
      return false
    }

    const endpoint = this.runtime.tetherEndpoint
    if (
      !this.runtime.resolveBridgeRuntimeEndpoint(
        runtime,
        useEndpointA,
        endpoint
      )
    ) {
      return false
    }

    if (useEndpointA) {
      this.runtime.syncKinematicAnchorBody(
        bodyId,
        endpoint.x,
        endpoint.y,
        runtime.followAX,
        runtime.followAY,
        deltaMs
      )
      runtime.followAX = endpoint.x
      runtime.followAY = endpoint.y
    } else {
      this.runtime.syncKinematicAnchorBody(
        bodyId,
        endpoint.x,
        endpoint.y,
        runtime.followBX,
        runtime.followBY,
        deltaMs
      )
      runtime.followBX = endpoint.x
      runtime.followBY = endpoint.y
    }

    return true
  }

  applyBridgeLimitTension(runtime: RopeBridgeRuntime): void {
    const dx = runtime.followBX - runtime.followAX
    const dy = runtime.followBY - runtime.followAY
    const distSq = dx * dx + dy * dy
    if (distSq <= 0.0001) {
      return
    }

    if (
      !this.runtime.isDistanceAtRopeElasticLimit(distSq, runtime.maxRopeLength)
    ) {
      return
    }

    const dist = Math.sqrt(distSq)
    const elasticLimit = this.runtime.getRopeElasticLimitLength(
      runtime.maxRopeLength
    )
    const stretch = Math.max(0, dist - elasticLimit)
    const invDist = 1 / dist
    const dirX = dx * invDist
    const dirY = dy * invDist
    const bodyAId = runtime.targetABodyId
    const bodyBId = runtime.targetBBodyId
    const endpointAMovable =
      runtime.endpointAHasDynamicBody &&
      this.runtime.isTensionBodyMovable(bodyAId)
    const endpointBMovable =
      runtime.endpointBHasDynamicBody &&
      this.runtime.isTensionBodyMovable(bodyBId)
    if (!endpointAMovable && !endpointBMovable) {
      return
    }

    const speedA = endpointAMovable
      ? this.runtime.getBodyVelocityAlong(bodyAId, dirX, dirY)
      : 0
    const speedB = endpointBMovable
      ? this.runtime.getBodyVelocityAlong(bodyBId, dirX, dirY)
      : 0
    const relativeAwaySpeed = speedB - speedA
    if (!(relativeAwaySpeed > 0) && !(stretch > 0)) {
      return
    }

    const endpointCount =
      (endpointAMovable ? 1 : 0) + (endpointBMovable ? 1 : 0)
    const correctionSpeed = this.runtime.getRopeLimitTensionSpeed(
      stretch,
      relativeAwaySpeed,
      endpointCount
    )
    if (!(correctionSpeed > 0)) {
      return
    }

    if (endpointAMovable) {
      this.runtime.applyBridgeEndpointTension(
        bodyAId,
        runtime.followAX,
        runtime.followAY,
        dirX,
        dirY,
        speedA + correctionSpeed
      )
    }
    if (endpointBMovable) {
      this.runtime.applyBridgeEndpointTension(
        bodyBId,
        runtime.followBX,
        runtime.followBY,
        -dirX,
        -dirY,
        -speedB + correctionSpeed
      )
    }
  }

  applyBridgeEndpointTension(
    bodyId: b2BodyId,
    pointX: number,
    pointY: number,
    dirX: number,
    dirY: number,
    targetAlong: number
  ): void {
    this.runtime.applyBodyVelocityCorrectionAtPoint(
      bodyId,
      pointX,
      pointY,
      dirX,
      dirY,
      targetAlong
    )
  }

  detachBridgeRopesForTarget(targetEntityId: number): void {
    for (let i = 0; i < this.runtime.bridgeRopes.length; i++) {
      const runtime = this.runtime.bridgeRopes[i]
      if (!runtime.active) continue
      if (
        runtime.endpointAEntityId === targetEntityId ||
        runtime.endpointBEntityId === targetEntityId
      ) {
        this.runtime.destroyBridgeRope(runtime)
      }
    }
  }

  destroyBridgeRope(runtime: RopeBridgeRuntime): void {
    if (!runtime.active) {
      return
    }

    this.runtime.stopRopeClimbersForBridge(runtime)

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

    if (runtime.bodyAOwned) {
      this.runtime.destroyBodyIfValid(runtime.bodyAId)
    }
    if (runtime.bodyBOwned) {
      this.runtime.destroyBodyIfValid(runtime.bodyBId)
    }

    runtime.active = false
    runtime.endpointAEntityId = -1
    runtime.endpointBEntityId = -1
    runtime.bodyAId = null
    runtime.bodyAOwned = false
    runtime.bodyBId = null
    runtime.bodyBOwned = false
    runtime.targetABodyId = null
    runtime.targetBBodyId = null
    runtime.endpointAHasDynamicBody = false
    runtime.endpointBHasDynamicBody = false
    runtime.localAX = 0
    runtime.localAY = 0
    runtime.localBX = 0
    runtime.localBY = 0
    runtime.followAX = 0
    runtime.followAY = 0
    runtime.followBX = 0
    runtime.followBY = 0
    runtime.renderLayer = 0
    runtime.segmentCount = 0
    runtime.linkLength = DEFAULT_GRAPPLE_ROPE_SEGMENT_LENGTH
    runtime.maxRopeLength = 0
    runtime.climbTuningActive = false
    runtime.hitId = 0
    runtime.health = 0
    this.runtime.resetRopeHitShake(runtime)
  }
}
