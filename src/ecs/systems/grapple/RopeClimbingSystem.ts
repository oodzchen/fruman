import {
  DEFAULT_GRAPPLE_ROPE_SEGMENT_RADIUS,
  DEFAULT_GRAVITY,
  DEFAULT_PLAYER_RADIUS,
  GRAPPLE_CLIMB_SPEED,
} from '../../../constants'
import type { b2BodyId } from '../../../types'
import type { Entity } from '../../Entity'
import type { GrappleSystemRuntime } from './GrappleRuntime'
import {
  GrapplePullMode,
  type RopeBridgeRuntime,
  type RopeClimbRuntime,
  type RopeRuntime,
} from './GrappleTypes'

export class RopeClimbingSystem {
  constructor(private readonly runtime: GrappleSystemRuntime) {}

  tryToggleRopeClimb(entity: Entity): boolean {
    const grapple = entity.grapple
    if (
      !grapple ||
      !grapple.hasGrapple ||
      !entity.input ||
      !entity.physics ||
      !entity.transform ||
      entity.isStunned()
    ) {
      return false
    }
    if (entity.movement?.isRolling || entity.movement?.isBackstepping) {
      return false
    }

    if (grapple.isRopeClimbing) {
      this.runtime.stopRopeClimb(entity, grapple, true)
      return true
    }

    if (this.runtime.tryStartPlayerRopeClimb(entity, grapple)) {
      return true
    }

    if (this.runtime.tryStartDetachedPlayerRopeClimb(entity, grapple)) {
      return true
    }

    return this.runtime.tryStartBridgeRopeClimb(entity, grapple)
  }

  getOrCreateRopeClimbRuntime(entityId: number): RopeClimbRuntime {
    const existing = this.runtime.ropeClimbRuntimeByEntityId.get(entityId)
    if (existing) {
      return existing
    }
    const runtime: RopeClimbRuntime = {
      active: false,
      sourceType: this.runtime.ropeClimbSourceNone,
      ownerEntityId: -1,
      playerRuntime: null,
      bridgeRuntime: null,
      bridgeHitId: 0,
      nodeIndex: 0,
      maxNodeIndex: 0,
      pathDistance: 0,
      normalOffset: 0,
      jointLength: this.runtime.ropeClimbMinJointLength,
      travelRemainder: 0,
      lastMoveStep: 0,
      jointId: null,
    }
    this.runtime.ropeClimbRuntimeByEntityId.set(entityId, runtime)
    return runtime
  }

  tryStartPlayerRopeClimb(
    entity: Entity,
    grapple: NonNullable<Entity['grapple']>
  ): boolean {
    const runtime = this.runtime.ropeRuntimeByEntityId.get(entity.id)
    if (
      !entity.transform ||
      !runtime?.active ||
      !grapple.isPulling ||
      !grapple.isTethering ||
      !runtime.playerAttached ||
      runtime.anchorIsDynamicTarget
    ) {
      return false
    }

    const maxNodeIndex = Math.max(
      0,
      Math.min(runtime.attachIndex + 1, runtime.segmentBodies.length)
    )
    const nodeIndex = this.runtime.findNearestPlayerRopeNode(
      runtime,
      entity.transform.x,
      entity.transform.y,
      maxNodeIndex,
      Number.POSITIVE_INFINITY
    )
    if (nodeIndex < 0) {
      return false
    }

    this.runtime.destroyJointIfValid(runtime.playerJointId)
    runtime.playerJointId = null

    const radius = entity.render?.radius ?? DEFAULT_PLAYER_RADIUS
    const jointLength = Math.max(
      this.runtime.ropeClimbMinJointLength,
      Math.min(radius, runtime.jointMaxLen)
    )
    return this.runtime.startRopeClimb(
      entity,
      grapple,
      this.runtime.ropeClimbSourcePlayer,
      entity.id,
      runtime,
      null,
      nodeIndex,
      maxNodeIndex,
      jointLength
    )
  }

  tryStartDetachedPlayerRopeClimb(
    entity: Entity,
    grapple: NonNullable<Entity['grapple']>
  ): boolean {
    if (!entity.transform || grapple.isPulling || grapple.isTethering) {
      return false
    }

    this.runtime.findNearestDetachedPlayerRopeNode(
      entity.transform.x,
      entity.transform.y,
      entity.render?.renderLayer ?? 0
    )
    const runtime = this.runtime.climbCandidatePlayerRuntime
    if (!runtime || this.runtime.climbCandidateNodeIndex < 0) {
      return false
    }

    const maxNodeIndex = Math.max(
      0,
      Math.min(runtime.attachIndex + 1, runtime.segmentBodies.length)
    )
    const radius = entity.render?.radius ?? DEFAULT_PLAYER_RADIUS
    if (
      !this.runtime.startRopeClimb(
        entity,
        grapple,
        this.runtime.ropeClimbSourcePlayer,
        runtime.ownerEntityId,
        runtime,
        null,
        this.runtime.climbCandidateNodeIndex,
        maxNodeIndex,
        radius
      )
    ) {
      return false
    }

    if (
      this.runtime.readBodyPosition(
        runtime.anchorBodyId,
        this.runtime.climbPointA
      )
    ) {
      grapple.targetX = this.runtime.climbPointA.x
      grapple.targetY = this.runtime.climbPointA.y
    }
    return true
  }

  tryStartBridgeRopeClimb(
    entity: Entity,
    grapple: NonNullable<Entity['grapple']>
  ): boolean {
    if (!entity.transform || grapple.isPulling || grapple.isTethering) {
      return false
    }

    this.runtime.findNearestBridgeRopePoint(
      entity.transform.x,
      entity.transform.y,
      entity.render?.renderLayer ?? 0
    )
    const bridgeRuntime = this.runtime.climbCandidateBridgeRuntime
    if (!bridgeRuntime || this.runtime.climbCandidateNodeIndex < 0) {
      return false
    }

    const maxNodeIndex = bridgeRuntime.segmentBodies.length + 1
    return this.runtime.startRopeClimb(
      entity,
      grapple,
      this.runtime.ropeClimbSourceBridge,
      -1,
      null,
      bridgeRuntime,
      this.runtime.climbCandidateNodeIndex,
      maxNodeIndex,
      entity.render?.radius ?? DEFAULT_PLAYER_RADIUS,
      this.runtime.climbCandidatePathDistance,
      this.runtime.climbCandidateNormalOffset
    )
  }

  startRopeClimb(
    entity: Entity,
    grapple: NonNullable<Entity['grapple']>,
    sourceType: number,
    ownerEntityId: number,
    playerRuntime: RopeRuntime | null,
    bridgeRuntime: RopeBridgeRuntime | null,
    nodeIndex: number,
    maxNodeIndex: number,
    jointLength: number,
    pathDistance = 0,
    normalOffset = 0
  ): boolean {
    const climbRuntime = this.runtime.getOrCreateRopeClimbRuntime(entity.id)
    this.runtime.destroyRopeClimbJoint(climbRuntime)

    climbRuntime.active = true
    climbRuntime.sourceType = sourceType
    climbRuntime.ownerEntityId = ownerEntityId
    climbRuntime.playerRuntime = playerRuntime
    climbRuntime.bridgeRuntime = bridgeRuntime
    climbRuntime.bridgeHitId = bridgeRuntime?.hitId ?? 0
    climbRuntime.nodeIndex = Math.max(0, Math.min(nodeIndex, maxNodeIndex))
    climbRuntime.maxNodeIndex = Math.max(0, maxNodeIndex)
    climbRuntime.pathDistance = pathDistance
    const normalLimit = Math.max(
      jointLength,
      this.runtime.ropeClimbMinJointLength
    )
    climbRuntime.normalOffset =
      normalOffset < -normalLimit
        ? -normalLimit
        : normalOffset > normalLimit
          ? normalLimit
          : normalOffset
    climbRuntime.jointLength = Math.max(
      this.runtime.ropeClimbMinJointLength,
      jointLength
    )
    climbRuntime.travelRemainder = 0
    climbRuntime.lastMoveStep = 0

    if (sourceType === this.runtime.ropeClimbSourceBridge) {
      if (
        !bridgeRuntime ||
        !this.runtime.resolveBridgeRopePoint(
          bridgeRuntime,
          climbRuntime.pathDistance
        )
      ) {
        this.runtime.resetRopeClimbRuntime(climbRuntime)
        return false
      }
      this.runtime.setBridgeRopeClimbTuning(bridgeRuntime, true)
    } else {
      if (!this.runtime.rebuildRopeClimbJoint(entity, climbRuntime)) {
        this.runtime.resetRopeClimbRuntime(climbRuntime)
        return false
      }
    }

    if (entity.movement) {
      entity.movement.isJumping = false
      entity.movement.jumpElapsedTime = 0
    }
    if (entity.input) {
      entity.input.inputBuffer.clearAction('jump')
      entity.input.jumpRequested = false
    }

    grapple.isRopeClimbing = true
    grapple.ropeClimbSource = sourceType
    grapple.retainAirMomentum = false
    grapple.moveLockEndTime = 0
    if (sourceType === this.runtime.ropeClimbSourceBridge) {
      grapple.isPulling = false
      grapple.isTethering = false
      grapple.isTetherSuspended = false
      grapple.pullMode = GrapplePullMode.Anchor
      grapple.targetEntityId = -1
      grapple.desiredDistanceSq = 0
    }
    entity.input!.grappleLengthAdjustSteps = 0
    return true
  }

  updateRopeClimb(
    entity: Entity,
    grapple: NonNullable<Entity['grapple']>,
    deltaMs: number
  ): void {
    if (!entity.input) {
      this.runtime.stopRopeClimb(entity, grapple, true)
      return
    }

    const climbRuntime = this.runtime.ropeClimbRuntimeByEntityId.get(entity.id)
    if (!climbRuntime?.active) {
      grapple.isRopeClimbing = false
      grapple.ropeClimbSource = this.runtime.ropeClimbSourceNone
      return
    }

    if (this.runtime.tryPerformRopeClimbJump(entity, grapple, climbRuntime)) {
      return
    }

    entity.input.grappleLengthAdjustSteps = 0
    if (climbRuntime.sourceType === this.runtime.ropeClimbSourcePlayer) {
      this.runtime.updatePlayerRopeClimb(entity, grapple, climbRuntime, deltaMs)
      return
    }
    if (climbRuntime.sourceType === this.runtime.ropeClimbSourceBridge) {
      this.runtime.updateBridgeRopeClimb(entity, grapple, climbRuntime, deltaMs)
      return
    }

    this.runtime.stopRopeClimb(entity, grapple, false)
  }

  updatePlayerRopeClimb(
    entity: Entity,
    grapple: NonNullable<Entity['grapple']>,
    climbRuntime: RopeClimbRuntime,
    deltaMs: number
  ): void {
    const runtime =
      climbRuntime.playerRuntime ??
      this.runtime.ropeRuntimeByEntityId.get(entity.id)
    if (!runtime?.active) {
      this.runtime.stopRopeClimb(entity, grapple, true)
      return
    }

    const isCurrentAttachedRope =
      runtime.playerAttached &&
      this.runtime.ropeRuntimeByEntityId.get(entity.id) === runtime
    if (isCurrentAttachedRope) {
      if (!grapple.isPulling || !grapple.isTethering) {
        this.runtime.stopRopeClimb(entity, grapple, true)
        return
      }
      if (!this.runtime.syncTetherAnchorTarget(runtime, grapple)) {
        this.runtime.stopRopeClimb(entity, grapple, true)
        return
      }
    } else {
      if (!this.runtime.syncDetachedPlayerRopeAnchor(runtime, deltaMs)) {
        this.runtime.stopRopeClimb(entity, grapple, false)
        return
      }
      if (
        this.runtime.readBodyPosition(
          runtime.anchorBodyId,
          this.runtime.climbPointA
        )
      ) {
        grapple.targetX = this.runtime.climbPointA.x
        grapple.targetY = this.runtime.climbPointA.y
      }
    }

    this.runtime.handleRopeNodeSwingInput(entity, climbRuntime, deltaMs)
    if (
      !this.runtime.advanceRopeClimb(
        entity,
        climbRuntime,
        runtime.linkLength,
        deltaMs
      )
    ) {
      this.runtime.stopRopeClimb(entity, grapple, true)
    }
  }

  updateBridgeRopeClimb(
    entity: Entity,
    grapple: NonNullable<Entity['grapple']>,
    climbRuntime: RopeClimbRuntime,
    deltaMs: number
  ): void {
    const bridgeRuntime = climbRuntime.bridgeRuntime
    if (
      !bridgeRuntime?.active ||
      bridgeRuntime.hitId !== climbRuntime.bridgeHitId
    ) {
      this.runtime.stopRopeClimb(entity, grapple, false)
      return
    }

    if (
      !this.runtime.syncBridgeRopeClimbAttachment(
        entity,
        bridgeRuntime,
        climbRuntime,
        deltaMs
      )
    ) {
      this.runtime.stopRopeClimb(entity, grapple, false)
    }
  }

  tryPerformRopeClimbJump(
    entity: Entity,
    grapple: NonNullable<Entity['grapple']>,
    climbRuntime: RopeClimbRuntime
  ): boolean {
    if (!entity.input?.inputBuffer.hasActiveAction('jump')) {
      return false
    }

    entity.input.inputBuffer.clearAction('jump')
    entity.input.jumpRequested = false

    if (climbRuntime.sourceType === this.runtime.ropeClimbSourceBridge) {
      this.runtime.performBridgeRopeClimbJump(entity, climbRuntime)
      this.runtime.stopRopeClimb(entity, grapple, false)
      return true
    }

    const playerRuntime = climbRuntime.playerRuntime
    this.runtime.stopRopeClimb(entity, grapple, true)
    if (playerRuntime?.active === true && !playerRuntime.playerAttached) {
      this.runtime.destroyPlayerRopeRuntime(playerRuntime)
    }
    this.runtime.performRopeJump(entity, grapple)
    return true
  }

  performBridgeRopeClimbJump(
    entity: Entity,
    climbRuntime: RopeClimbRuntime
  ): void {
    if (!entity.physics || !entity.movement || !entity.transform) {
      return
    }

    const runtime = climbRuntime.bridgeRuntime
    if (
      this.runtime.ropeClimbJumpRecoilScale > 0 &&
      runtime?.active === true &&
      runtime.hitId === climbRuntime.bridgeHitId &&
      this.runtime.resolveBridgeRopePoint(runtime, climbRuntime.pathDistance)
    ) {
      const mass = this.runtime.box2d.b2Body_GetMass(entity.physics.bodyId)
      const jumpDeltaY =
        (-entity.movement.jumpForce * this.runtime.ropeJumpBaseUpwardScale) /
        this.runtime.ropeJumpScale
      this.runtime.applyBridgeRopePointImpulse(
        runtime,
        0,
        -jumpDeltaY * mass * this.runtime.ropeClimbJumpRecoilScale
      )
    }

    this.runtime.startRopeJumpMotion(entity)
  }

  advanceRopeClimb(
    entity: Entity,
    climbRuntime: RopeClimbRuntime,
    linkLength: number,
    deltaMs: number
  ): boolean {
    const climbDir = entity.input?.grappleClimbHeld ?? 0
    if (climbDir === 0 || !(linkLength > 0)) {
      climbRuntime.travelRemainder = 0
      climbRuntime.lastMoveStep = 0
      return true
    }

    const moveStep = climbDir < 0 ? -1 : 1
    if (moveStep !== climbRuntime.lastMoveStep) {
      climbRuntime.travelRemainder = 0
      climbRuntime.lastMoveStep = moveStep
    }

    climbRuntime.travelRemainder += (GRAPPLE_CLIMB_SPEED * deltaMs) / 1000
    while (climbRuntime.travelRemainder >= linkLength) {
      const nextNodeIndex = climbRuntime.nodeIndex + moveStep
      if (nextNodeIndex < 0 || nextNodeIndex > climbRuntime.maxNodeIndex) {
        climbRuntime.travelRemainder = 0
        return true
      }
      climbRuntime.nodeIndex = nextNodeIndex
      climbRuntime.travelRemainder -= linkLength
      if (climbRuntime.sourceType === this.runtime.ropeClimbSourceBridge) {
        if (!this.runtime.isRopeClimbNodeValid(climbRuntime)) {
          return false
        }
      } else {
        if (!this.runtime.rebuildRopeClimbJoint(entity, climbRuntime)) {
          return false
        }
      }
    }
    return true
  }

  stopRopeClimb(
    entity: Entity,
    grapple: NonNullable<Entity['grapple']>,
    destroyOwnedRope: boolean
  ): void {
    const climbRuntime = this.runtime.ropeClimbRuntimeByEntityId.get(entity.id)
    const sourceType =
      climbRuntime?.active === true
        ? climbRuntime.sourceType
        : grapple.ropeClimbSource
    const bridgeRuntime =
      climbRuntime?.active === true &&
      climbRuntime.sourceType === this.runtime.ropeClimbSourceBridge
        ? climbRuntime.bridgeRuntime
        : null

    if (climbRuntime) {
      this.runtime.destroyRopeClimbJoint(climbRuntime)
      this.runtime.resetRopeClimbRuntime(climbRuntime)
    }

    grapple.isRopeClimbing = false
    grapple.ropeClimbSource = this.runtime.ropeClimbSourceNone
    if (sourceType === this.runtime.ropeClimbSourceBridge) {
      grapple.retainAirMomentum = true
      if (
        bridgeRuntime?.active === true &&
        !this.runtime.hasActiveBridgeRopeClimber(bridgeRuntime)
      ) {
        this.runtime.setBridgeRopeClimbTuning(bridgeRuntime, false)
      }
    }

    if (
      destroyOwnedRope &&
      sourceType === this.runtime.ropeClimbSourcePlayer &&
      grapple.isTethering
    ) {
      this.runtime.stopPull(entity, grapple, false)
    }
  }

  resetRopeClimbRuntime(runtime: RopeClimbRuntime): void {
    runtime.active = false
    runtime.sourceType = this.runtime.ropeClimbSourceNone
    runtime.ownerEntityId = -1
    runtime.playerRuntime = null
    runtime.bridgeRuntime = null
    runtime.bridgeHitId = 0
    runtime.nodeIndex = 0
    runtime.maxNodeIndex = 0
    runtime.pathDistance = 0
    runtime.normalOffset = 0
    runtime.jointLength = this.runtime.ropeClimbMinJointLength
    runtime.travelRemainder = 0
    runtime.lastMoveStep = 0
    runtime.jointId = null
  }

  destroyRopeClimbJoint(runtime: RopeClimbRuntime): void {
    this.runtime.destroyJointIfValid(runtime.jointId)
    runtime.jointId = null
  }

  rebuildRopeClimbJoint(
    entity: Entity,
    climbRuntime: RopeClimbRuntime
  ): boolean {
    if (!entity.physics) {
      return false
    }

    const nodeBodyId = this.runtime.getRopeClimbNodeBody(climbRuntime)
    if (
      !this.runtime.isBodyId(nodeBodyId) ||
      !this.runtime.box2d.b2Body_IsValid(nodeBodyId)
    ) {
      return false
    }

    this.runtime.destroyRopeClimbJoint(climbRuntime)
    climbRuntime.jointId = this.runtime.createFixedDistanceJoint(
      nodeBodyId,
      entity.physics.bodyId,
      climbRuntime.jointLength
    )
    return true
  }

  isRopeClimbNodeValid(climbRuntime: RopeClimbRuntime): boolean {
    const nodeBodyId = this.runtime.getRopeClimbNodeBody(climbRuntime)
    return (
      this.runtime.isBodyId(nodeBodyId) &&
      this.runtime.box2d.b2Body_IsValid(nodeBodyId)
    )
  }

  syncBridgeRopeClimbAttachment(
    entity: Entity,
    runtime: RopeBridgeRuntime,
    climbRuntime: RopeClimbRuntime,
    deltaMs: number
  ): boolean {
    if (!entity.input || !entity.physics || !entity.transform) {
      return false
    }

    if (
      !this.runtime.resolveBridgeRopePoint(runtime, climbRuntime.pathDistance)
    ) {
      return false
    }
    if (climbRuntime.pathDistance > this.runtime.climbPathLength) {
      climbRuntime.pathDistance = this.runtime.climbPathLength
    }

    const deltaSec = deltaMs / 1000
    const inputX = entity.input.moveDirection
    const inputY = entity.input.grappleClimbHeld
    const inputScale = inputX !== 0 && inputY !== 0 ? Math.SQRT1_2 : 1
    const dirX = inputX * inputScale
    const dirY = inputY * inputScale

    if (inputX !== 0) {
      entity.input.lastMoveDirection = inputX
    }

    if (dirX !== 0 || dirY !== 0) {
      const alongInput =
        dirX * this.runtime.climbTangentX + dirY * this.runtime.climbTangentY
      const normalInput =
        dirX * this.runtime.climbNormalX + dirY * this.runtime.climbNormalY
      climbRuntime.pathDistance += alongInput * GRAPPLE_CLIMB_SPEED * deltaSec
      if (climbRuntime.pathDistance < 0) {
        climbRuntime.pathDistance = 0
      } else if (climbRuntime.pathDistance > this.runtime.climbPathLength) {
        climbRuntime.pathDistance = this.runtime.climbPathLength
      }

      const normalLimit = Math.max(
        entity.render?.radius ?? DEFAULT_PLAYER_RADIUS,
        this.runtime.ropeClimbMinJointLength
      )
      climbRuntime.normalOffset += normalInput * GRAPPLE_CLIMB_SPEED * deltaSec
      if (climbRuntime.normalOffset < -normalLimit) {
        climbRuntime.normalOffset = -normalLimit
      } else if (climbRuntime.normalOffset > normalLimit) {
        climbRuntime.normalOffset = normalLimit
      }
    }

    if (
      !this.runtime.resolveBridgeRopePoint(runtime, climbRuntime.pathDistance)
    ) {
      return false
    }

    this.runtime.applyBridgeRopeClimbWeight(entity, runtime)

    const targetX =
      this.runtime.climbAttachX +
      this.runtime.climbNormalX * climbRuntime.normalOffset
    const targetY =
      this.runtime.climbAttachY +
      this.runtime.climbNormalY * climbRuntime.normalOffset
    const invDelta = deltaMs > 0 ? 1000 / deltaMs : 0

    this.runtime.tempVec.x = (targetX - entity.transform.x) * invDelta
    this.runtime.tempVec.y = (targetY - entity.transform.y) * invDelta
    this.runtime.box2d.b2Body_SetLinearVelocity(
      entity.physics.bodyId,
      this.runtime.tempVec
    )
    return true
  }

  applyBridgeRopeClimbWeight(entity: Entity, runtime: RopeBridgeRuntime): void {
    if (!entity.physics) {
      return
    }

    const mass = this.runtime.box2d.b2Body_GetMass(entity.physics.bodyId)
    if (!(mass > 0)) {
      return
    }

    this.runtime.applyBridgeRopePointForce(
      runtime,
      0,
      mass * DEFAULT_GRAVITY * this.runtime.ropeClimbWeightForceScale
    )
  }

  hasActiveBridgeRopeClimber(runtime: RopeBridgeRuntime): boolean {
    for (const climbRuntime of this.runtime.ropeClimbRuntimeByEntityId.values()) {
      if (
        climbRuntime.active &&
        climbRuntime.sourceType === this.runtime.ropeClimbSourceBridge &&
        climbRuntime.bridgeRuntime === runtime
      ) {
        return true
      }
    }
    return false
  }

  applyBridgeRopePointForce(
    runtime: RopeBridgeRuntime,
    forceX: number,
    forceY: number
  ): void {
    const startWeight = 1 - this.runtime.climbSegmentRatio
    const endWeight = this.runtime.climbSegmentRatio
    this.runtime.applyBridgeRopeNodeForce(
      runtime,
      this.runtime.climbSegmentStartNodeIndex,
      forceX * startWeight,
      forceY * startWeight
    )
    this.runtime.applyBridgeRopeNodeForce(
      runtime,
      this.runtime.climbSegmentStartNodeIndex + 1,
      forceX * endWeight,
      forceY * endWeight
    )
  }

  applyBridgeRopePointImpulse(
    runtime: RopeBridgeRuntime,
    impulseX: number,
    impulseY: number
  ): void {
    const startWeight = 1 - this.runtime.climbSegmentRatio
    const endWeight = this.runtime.climbSegmentRatio
    this.runtime.applyBridgeRopeNodeImpulse(
      runtime,
      this.runtime.climbSegmentStartNodeIndex,
      impulseX * startWeight,
      impulseY * startWeight
    )
    this.runtime.applyBridgeRopeNodeImpulse(
      runtime,
      this.runtime.climbSegmentStartNodeIndex + 1,
      impulseX * endWeight,
      impulseY * endWeight
    )
  }

  applyBridgeRopeNodeForce(
    runtime: RopeBridgeRuntime,
    nodeIndex: number,
    forceX: number,
    forceY: number
  ): void {
    if (forceX === 0 && forceY === 0) {
      return
    }

    const bodyId = this.runtime.getBridgeRopeDynamicNodeBody(runtime, nodeIndex)
    if (!bodyId) {
      return
    }

    this.runtime.tempVec.x = forceX
    this.runtime.tempVec.y = forceY
    this.runtime.box2d.b2Body_ApplyForceToCenter(
      bodyId,
      this.runtime.tempVec,
      true
    )
  }

  applyBridgeRopeNodeImpulse(
    runtime: RopeBridgeRuntime,
    nodeIndex: number,
    impulseX: number,
    impulseY: number
  ): void {
    if (impulseX === 0 && impulseY === 0) {
      return
    }

    const bodyId = this.runtime.getBridgeRopeDynamicNodeBody(runtime, nodeIndex)
    if (!bodyId) {
      return
    }

    this.runtime.tempVec.x = impulseX
    this.runtime.tempVec.y = impulseY
    this.runtime.box2d.b2Body_ApplyLinearImpulseToCenter(
      bodyId,
      this.runtime.tempVec,
      true
    )
  }

  getBridgeRopeDynamicNodeBody(
    runtime: RopeBridgeRuntime,
    nodeIndex: number
  ): b2BodyId | null {
    if (runtime.segmentBodies.length <= 0) {
      return null
    }

    let segmentIndex = nodeIndex - 1
    if (segmentIndex < 0) {
      segmentIndex = 0
    } else if (segmentIndex >= runtime.segmentBodies.length) {
      segmentIndex = runtime.segmentBodies.length - 1
    }

    const bodyId = runtime.segmentBodies[segmentIndex]
    if (
      !this.runtime.isBodyId(bodyId) ||
      !this.runtime.box2d.b2Body_IsValid(bodyId)
    ) {
      return null
    }
    return bodyId
  }

  getRopeClimbNodeBody(climbRuntime: RopeClimbRuntime): b2BodyId | null {
    if (climbRuntime.sourceType === this.runtime.ropeClimbSourcePlayer) {
      const runtime =
        climbRuntime.playerRuntime ??
        this.runtime.ropeRuntimeByEntityId.get(climbRuntime.ownerEntityId)
      if (!runtime?.active) {
        return null
      }
      return this.runtime.getPlayerRopeNodeBody(runtime, climbRuntime.nodeIndex)
    }
    if (climbRuntime.sourceType === this.runtime.ropeClimbSourceBridge) {
      const runtime = climbRuntime.bridgeRuntime
      if (!runtime?.active || runtime.hitId !== climbRuntime.bridgeHitId) {
        return null
      }
      return this.runtime.getBridgeRopeNodeBody(runtime, climbRuntime.nodeIndex)
    }
    return null
  }

  getPlayerRopeNodeBody(
    runtime: RopeRuntime,
    nodeIndex: number
  ): b2BodyId | null {
    if (nodeIndex === 0) {
      return runtime.anchorBodyId
    }
    const segmentIndex = nodeIndex - 1
    if (segmentIndex < 0 || segmentIndex >= runtime.segmentBodies.length) {
      return null
    }
    return runtime.segmentBodies[segmentIndex]
  }

  getBridgeRopeNodeBody(
    runtime: RopeBridgeRuntime,
    nodeIndex: number
  ): b2BodyId | null {
    if (nodeIndex === 0) {
      return runtime.bodyAId
    }
    const maxNodeIndex = runtime.segmentBodies.length + 1
    if (nodeIndex === maxNodeIndex) {
      return runtime.bodyBId
    }
    const segmentIndex = nodeIndex - 1
    if (segmentIndex < 0 || segmentIndex >= runtime.segmentBodies.length) {
      return null
    }
    return runtime.segmentBodies[segmentIndex]
  }

  findNearestPlayerRopeNode(
    runtime: RopeRuntime,
    x: number,
    y: number,
    maxNodeIndex: number,
    limitDistSq: number
  ): number {
    let nearestNodeIndex = -1
    let nearestDistSq = limitDistSq
    for (let nodeIndex = 0; nodeIndex <= maxNodeIndex; nodeIndex++) {
      const bodyId = this.runtime.getPlayerRopeNodeBody(runtime, nodeIndex)
      if (!this.runtime.readBodyPosition(bodyId, this.runtime.climbPointA)) {
        continue
      }
      const dx = this.runtime.climbPointA.x - x
      const dy = this.runtime.climbPointA.y - y
      const distSq = dx * dx + dy * dy
      if (distSq <= nearestDistSq) {
        nearestDistSq = distSq
        nearestNodeIndex = nodeIndex
      }
    }
    return nearestNodeIndex
  }

  resolveBridgeRopePoint(
    runtime: RopeBridgeRuntime,
    pathDistance: number
  ): boolean {
    const maxNodeIndex = runtime.segmentBodies.length + 1
    if (
      !this.runtime.readBodyPosition(runtime.bodyAId, this.runtime.climbPointA)
    ) {
      return false
    }

    let targetDistance = pathDistance
    if (targetDistance < 0) {
      targetDistance = 0
    }

    let accumulated = 0
    let resolved = false
    let lastTangentX = 0
    let lastTangentY = 1
    let lastPointX = this.runtime.climbPointA.x
    let lastPointY = this.runtime.climbPointA.y

    for (let nodeIndex = 1; nodeIndex <= maxNodeIndex; nodeIndex++) {
      const bodyId = this.runtime.getBridgeRopeNodeBody(runtime, nodeIndex)
      if (!this.runtime.readBodyPosition(bodyId, this.runtime.climbPointB)) {
        continue
      }

      const dx = this.runtime.climbPointB.x - this.runtime.climbPointA.x
      const dy = this.runtime.climbPointB.y - this.runtime.climbPointA.y
      const lenSq = dx * dx + dy * dy
      if (lenSq > 0.0001) {
        const len = Math.sqrt(lenSq)
        const nextDistance = accumulated + len
        const tangentX = dx / len
        const tangentY = dy / len

        if (!resolved && targetDistance <= nextDistance) {
          const t = (targetDistance - accumulated) / len
          this.runtime.climbAttachX = this.runtime.climbPointA.x + dx * t
          this.runtime.climbAttachY = this.runtime.climbPointA.y + dy * t
          this.runtime.climbTangentX = tangentX
          this.runtime.climbTangentY = tangentY
          this.runtime.climbNormalX = -tangentY
          this.runtime.climbNormalY = tangentX
          this.runtime.climbSegmentStartNodeIndex = nodeIndex - 1
          this.runtime.climbSegmentRatio = t
          resolved = true
        }

        accumulated = nextDistance
        lastTangentX = tangentX
        lastTangentY = tangentY
        lastPointX = this.runtime.climbPointB.x
        lastPointY = this.runtime.climbPointB.y
      }

      this.runtime.climbPointA.x = this.runtime.climbPointB.x
      this.runtime.climbPointA.y = this.runtime.climbPointB.y
    }

    this.runtime.climbPathLength = accumulated
    if (!(accumulated > 0)) {
      return false
    }

    if (!resolved) {
      this.runtime.climbAttachX = lastPointX
      this.runtime.climbAttachY = lastPointY
      this.runtime.climbTangentX = lastTangentX
      this.runtime.climbTangentY = lastTangentY
      this.runtime.climbNormalX = -lastTangentY
      this.runtime.climbNormalY = lastTangentX
      this.runtime.climbSegmentStartNodeIndex = Math.max(0, maxNodeIndex - 1)
      this.runtime.climbSegmentRatio = 1
    }

    return true
  }

  findNearestBridgeRopePoint(x: number, y: number, renderLayer: number): void {
    this.runtime.climbCandidateBridgeRuntime = null
    this.runtime.climbCandidateNodeIndex = -1
    this.runtime.climbCandidateDistSq = this.runtime.ropeClimbInteractRadiusSq
    this.runtime.climbCandidatePathDistance = 0
    this.runtime.climbCandidateNormalOffset = 0

    for (let i = 0; i < this.runtime.bridgeRopes.length; i++) {
      const runtime = this.runtime.bridgeRopes[i]
      if (!runtime.active || runtime.renderLayer !== renderLayer) {
        continue
      }
      const maxNodeIndex = runtime.segmentBodies.length + 1
      if (
        !this.runtime.readBodyPosition(
          runtime.bodyAId,
          this.runtime.climbPointA
        )
      ) {
        continue
      }

      let accumulated = 0
      for (let nodeIndex = 1; nodeIndex <= maxNodeIndex; nodeIndex++) {
        const bodyId = this.runtime.getBridgeRopeNodeBody(runtime, nodeIndex)
        if (!this.runtime.readBodyPosition(bodyId, this.runtime.climbPointB)) {
          continue
        }

        const segDx = this.runtime.climbPointB.x - this.runtime.climbPointA.x
        const segDy = this.runtime.climbPointB.y - this.runtime.climbPointA.y
        const lenSq = segDx * segDx + segDy * segDy
        if (lenSq > 0.0001) {
          const len = Math.sqrt(lenSq)
          const rawT =
            ((x - this.runtime.climbPointA.x) * segDx +
              (y - this.runtime.climbPointA.y) * segDy) /
            lenSq
          const t = rawT < 0 ? 0 : rawT > 1 ? 1 : rawT
          const pointX = this.runtime.climbPointA.x + segDx * t
          const pointY = this.runtime.climbPointA.y + segDy * t
          const dx = pointX - x
          const dy = pointY - y
          const distSq = dx * dx + dy * dy
          if (distSq <= this.runtime.climbCandidateDistSq) {
            const tangentX = segDx / len
            const tangentY = segDy / len
            const normalX = -tangentY
            const normalY = tangentX
            this.runtime.climbCandidateDistSq = distSq
            this.runtime.climbCandidateBridgeRuntime = runtime
            this.runtime.climbCandidateNodeIndex = nodeIndex - 1
            this.runtime.climbCandidatePathDistance = accumulated + len * t
            this.runtime.climbCandidateNormalOffset =
              (x - pointX) * normalX + (y - pointY) * normalY
          }
          accumulated += len
        }

        this.runtime.climbPointA.x = this.runtime.climbPointB.x
        this.runtime.climbPointA.y = this.runtime.climbPointB.y
      }
    }
  }

  findNearestDetachedPlayerRopeNode(
    x: number,
    y: number,
    renderLayer: number
  ): void {
    this.runtime.climbCandidatePlayerRuntime = null
    this.runtime.climbCandidateNodeIndex = -1
    this.runtime.climbCandidateDistSq = this.runtime.ropeClimbInteractRadiusSq

    for (let i = 0; i < this.runtime.detachedPlayerRopes.length; i++) {
      const runtime = this.runtime.detachedPlayerRopes[i]
      if (
        !runtime.active ||
        runtime.playerAttached ||
        runtime.renderLayer !== renderLayer
      ) {
        continue
      }

      const maxNodeIndex = Math.max(
        0,
        Math.min(runtime.attachIndex + 1, runtime.segmentBodies.length)
      )
      for (let nodeIndex = 0; nodeIndex <= maxNodeIndex; nodeIndex++) {
        const bodyId = this.runtime.getPlayerRopeNodeBody(runtime, nodeIndex)
        if (!this.runtime.readBodyPosition(bodyId, this.runtime.climbPointA)) {
          continue
        }

        const dx = this.runtime.climbPointA.x - x
        const dy = this.runtime.climbPointA.y - y
        const distSq = dx * dx + dy * dy
        if (distSq <= this.runtime.climbCandidateDistSq) {
          this.runtime.climbCandidateDistSq = distSq
          this.runtime.climbCandidatePlayerRuntime = runtime
          this.runtime.climbCandidateNodeIndex = nodeIndex
        }
      }
    }
  }

  stopRopeClimbersForPlayerRope(runtime: RopeRuntime): void {
    this.runtime.ropeClimbRuntimeByEntityId.forEach(
      (climbRuntime, entityId) => {
        if (
          !climbRuntime.active ||
          climbRuntime.sourceType !== this.runtime.ropeClimbSourcePlayer ||
          climbRuntime.playerRuntime !== runtime
        ) {
          return
        }

        const entity = this.runtime.getEntityById(entityId)
        const grapple = entity?.grapple
        if (entity && grapple) {
          this.runtime.stopRopeClimb(entity, grapple, false)
          return
        }

        this.runtime.destroyRopeClimbJoint(climbRuntime)
        this.runtime.resetRopeClimbRuntime(climbRuntime)
      }
    )
  }

  stopRopeClimbersForBridge(runtime: RopeBridgeRuntime): void {
    this.runtime.ropeClimbRuntimeByEntityId.forEach(
      (climbRuntime, entityId) => {
        if (
          !climbRuntime.active ||
          climbRuntime.sourceType !== this.runtime.ropeClimbSourceBridge ||
          climbRuntime.bridgeRuntime !== runtime
        ) {
          return
        }

        const entity = this.runtime.getEntityById(entityId)
        const grapple = entity?.grapple
        if (entity && grapple) {
          this.runtime.stopRopeClimb(entity, grapple, false)
          return
        }

        this.runtime.destroyRopeClimbJoint(climbRuntime)
        this.runtime.resetRopeClimbRuntime(climbRuntime)
      }
    )
  }

  handleRopeNodeSwingInput(
    entity: Entity,
    climbRuntime: RopeClimbRuntime,
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

    const nodeBodyId = this.runtime.getRopeClimbNodeBody(climbRuntime)
    if (!this.runtime.readBodyPosition(nodeBodyId, this.runtime.climbPointA)) {
      return
    }

    entity.input.lastMoveDirection = moveDir

    const currentVel = this.runtime.box2d.b2Body_GetLinearVelocity(
      entity.physics.bodyId
    )
    const currentVx = currentVel.x
    const currentVy = currentVel.y
    currentVel.delete()

    const dx = this.runtime.climbPointA.x - entity.transform.x
    const dy = this.runtime.climbPointA.y - entity.transform.y
    const dist = Math.sqrt(dx * dx + dy * dy)

    let tangentX = 1
    let tangentY = 0
    let swingDir = moveDir
    let useAssistForce = true

    if (dist >= 0.1) {
      const ropeX = dx / dist
      const ropeY = dy / dist
      tangentX = -ropeY
      tangentY = ropeX

      const tangentVel = currentVx * tangentX + currentVy * tangentY
      if (Math.abs(tangentVel) >= 0.1) {
        swingDir = tangentVel > 0 ? 1 : -1
        const horizontalSwingDir = tangentX * swingDir > 0 ? 1 : -1
        useAssistForce = moveDir === horizontalSwingDir
      } else if (tangentX < 0) {
        swingDir = -moveDir
      }
    }

    const mass = this.runtime.box2d.b2Body_GetMass(entity.physics.bodyId)
    const forceScale = useAssistForce
      ? this.runtime.swingForce
      : -this.runtime.swingForce * 0.67
    const deltaTime = deltaMs / 1000

    this.runtime.tempVec.x = tangentX * swingDir * forceScale * mass * deltaTime
    this.runtime.tempVec.y = tangentY * swingDir * forceScale * mass * deltaTime
    this.runtime.box2d.b2Body_ApplyForceToCenter(
      entity.physics.bodyId,
      this.runtime.tempVec,
      true
    )
  }
}
