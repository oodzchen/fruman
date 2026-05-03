import type { b2BodyId, b2JointId } from '../../../types'
import type { Entity } from '../../Entity'
import type { GrappleSystemContext } from './GrappleSystemContext'
import type {
  GrappleFrameState,
  PlayerTetherState,
  RopeBridgeRuntime,
  RopeCircleHitRequest,
  RopeClimbRuntime,
  RopeEndpointBuild,
  RopeHitRequest,
  RopeRuntime,
} from './GrappleTypes'

export interface GrappleStateApi {
  update(entities: Entity[], deltaTime: number): void
  updateGrappleRuntimes(deltaMs: number): void
  updateGrappleEntity(
    entity: Entity,
    grapple: NonNullable<Entity['grapple']>,
    deltaMs: number
  ): void
  refreshEntityAnchorAvailability(
    entity: Entity,
    grapple: NonNullable<Entity['grapple']>
  ): void
  resolveGrappleFrameState(
    entity: Entity,
    grapple: NonNullable<Entity['grapple']>,
    grappleActionActive: boolean
  ): GrappleFrameState
  processUnavailableGrapple(
    entity: Entity,
    grapple: NonNullable<Entity['grapple']>
  ): void
  processInterruptedGrapple(
    entity: Entity,
    grapple: NonNullable<Entity['grapple']>
  ): void
  processGrappleBreakRequest(
    entity: Entity,
    grapple: NonNullable<Entity['grapple']>,
    input: NonNullable<Entity['input']>,
    inputBuffer: NonNullable<Entity['input']>['inputBuffer']
  ): void
  processActiveTetherAction(
    entity: Entity,
    grapple: NonNullable<Entity['grapple']>,
    inputBuffer: NonNullable<Entity['input']>['inputBuffer']
  ): void
  tryStartGrappleAction(
    entity: Entity,
    grapple: NonNullable<Entity['grapple']>,
    excludedTargetX?: number,
    excludedTargetY?: number
  ): boolean
  tryStartAnchorGrappleAction(
    entity: Entity,
    grapple: NonNullable<Entity['grapple']>,
    excludedTargetX?: number,
    excludedTargetY?: number
  ): boolean
  startLockedTargetGrapple(
    entity: Entity,
    grapple: NonNullable<Entity['grapple']>,
    lockedTarget: Entity & { transform: NonNullable<Entity['transform']> }
  ): boolean
  startAnchorTargetGrapple(
    entity: Entity,
    grapple: NonNullable<Entity['grapple']>,
    anchorTarget: Entity,
    targetX: number,
    targetY: number
  ): boolean
  beginGrapplePull(
    entity: Entity,
    grapple: NonNullable<Entity['grapple']>,
    targetX: number,
    targetY: number,
    targetEntityId: number,
    desiredDistanceSq: number
  ): void
  tryStartPersistentTether(
    entity: Entity,
    grapple: NonNullable<Entity['grapple']>,
    anchorTarget: Entity
  ): boolean
}

export interface GrappleTargetingApi {
  refreshAnchorCache(): void
  findAnchorTarget(
    x: number,
    y: number,
    facing: number,
    out: { x: number; y: number },
    renderLayer: number,
    currentTargetX?: number,
    currentTargetY?: number
  ): Entity | null
  findGrappleTargetAnchor(
    x: number,
    y: number,
    facing: number,
    out: { x: number; y: number },
    renderLayer: number,
    currentTargetX?: number,
    currentTargetY?: number
  ): Entity | null
  canUseLockedTarget(
    owner: Entity,
    target: Entity
  ): target is Entity & { transform: NonNullable<Entity['transform']> }
  getTargetToughness(entity: Entity): number
  getAttackDistance(attacker: Entity, target: Entity): number
  applyNpcStun(entity: Entity, durationMs: number): void
  triggerNpcAggro(attacker: Entity, target: Entity): void
}

export interface GrappleLocomotionApi {
  updatePull(
    entity: Entity,
    grapple: NonNullable<Entity['grapple']>,
    deltaMs: number
  ): void
  syncPullTargetPosition(
    entity: Entity,
    grapple: NonNullable<Entity['grapple']>
  ): boolean
  getPullDistanceSq(
    entity: Entity,
    grapple: NonNullable<Entity['grapple']>
  ): number
  processPulledTarget(
    entity: Entity,
    grapple: NonNullable<Entity['grapple']>,
    isObjectPull: boolean
  ): void
  finishPulledTarget(
    entity: Entity,
    grapple: NonNullable<Entity['grapple']>,
    targetEntity: Entity,
    isObjectPull: boolean,
    allowImmediateRetry: boolean
  ): void
  processPlayerLinearPull(
    entity: Entity,
    grapple: NonNullable<Entity['grapple']>
  ): void
  processAnchorOrArcPull(
    entity: Entity,
    grapple: NonNullable<Entity['grapple']>
  ): void
  stopPull(
    entity: Entity,
    grapple: NonNullable<Entity['grapple']>,
    allowImmediateRetry: boolean
  ): void
  shouldRetainAirMomentumAfterStop(pullMode: number): boolean
  resetGrappleMotion(
    grapple: NonNullable<Entity['grapple']>,
    retainAirMomentum: boolean
  ): void
  applyLinearPull(entity: Entity, target: Entity | null, speed: number): void
  stopLinearMotion(entity: Entity): void
  applyGrappleImpulse(
    entity: Entity,
    grapple: NonNullable<Entity['grapple']>
  ): void
  performRopeJump(entity: Entity, grapple: NonNullable<Entity['grapple']>): void
  startRopeJumpMotion(entity: Entity): void
  beginRopeJumpState(entity: Entity): void
  handleSwingInput(
    entity: Entity,
    grapple: NonNullable<Entity['grapple']>,
    runtime: RopeRuntime,
    deltaMs: number
  ): void
}

export interface GrappleRopeRuntimeApi {
  updateExistingRopeSegments(): void
  updateExistingRopeJoints(): void
  getBridgeRopeLinearDamping(runtime: RopeBridgeRuntime): number
  getBridgeRopeHertz(runtime: RopeBridgeRuntime): number
  getBridgeRopeDampingRatio(runtime: RopeBridgeRuntime): number
  setBridgeRopeClimbTuning(runtime: RopeBridgeRuntime, active: boolean): void
  updateBridgeRopeSegmentDamping(runtime: RopeBridgeRuntime): void
  updateBridgeRopeJointTuning(runtime: RopeBridgeRuntime): void
  detachTetherTarget(targetEntityId: number): void
  getOrCreateRopeRuntime(entityId: number): RopeRuntime
  prepareNewAnchorTetherRuntime(
    entity: Entity,
    grapple: NonNullable<Entity['grapple']>
  ): RopeRuntime
  canCreateRopeOnTarget(
    targetEntityId: number,
    ignoredPlayerRuntime?: RopeRuntime | null,
    ignoredBridgeRuntime?: RopeBridgeRuntime | null
  ): boolean
  getRopeCountForTarget(
    targetEntityId: number,
    ignoredPlayerRuntime: RopeRuntime | null,
    ignoredBridgeRuntime: RopeBridgeRuntime | null
  ): number
  startAnchorTether(
    entity: Entity,
    grapple: NonNullable<Entity['grapple']>,
    anchorEntity?: Entity
  ): boolean
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
  ): boolean
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
  ): void
  createPlayerTetherFollowBody(
    entity: Entity,
    runtime: RopeRuntime
  ): b2BodyId | null
  switchPlayerTetherState(
    entity: Entity,
    runtime: RopeRuntime,
    nextState: PlayerTetherState
  ): boolean
  updatePlayerTetherState(
    entity: Entity,
    grapple: NonNullable<Entity['grapple']>,
    runtime: RopeRuntime,
    deltaMs: number
  ): boolean
  didMovementJumpStartThisTick(entity: Entity, deltaMs: number): boolean
  shouldDetachTetherForSuspendedJump(
    entity: Entity,
    grapple: NonNullable<Entity['grapple']>,
    runtime: RopeRuntime
  ): boolean
  isPlayerTetherSuspended(
    entity: Entity,
    grapple: NonNullable<Entity['grapple']>,
    runtime: RopeRuntime
  ): boolean
  hasPlayerTetherSuspensionGeometry(
    entity: Entity,
    grapple: NonNullable<Entity['grapple']>,
    runtime: RopeRuntime
  ): boolean
  syncPlayerTetherEndpointBody(
    entity: Entity,
    runtime: RopeRuntime,
    deltaMs: number
  ): boolean
  getPlayerTetherBodyId(entity: Entity, runtime: RopeRuntime): b2BodyId | null
  updateAnchorTether(
    entity: Entity,
    grapple: NonNullable<Entity['grapple']>,
    deltaMs: number
  ): void
  detachPlayerFromTetherForJump(
    entity: Entity,
    grapple: NonNullable<Entity['grapple']>,
    runtime: RopeRuntime
  ): void
  destroyConnectedPlayerRope(
    entity: Entity,
    grapple: NonNullable<Entity['grapple']>
  ): void
  detachPlayerFromTether(
    entity: Entity,
    grapple: NonNullable<Entity['grapple']>,
    runtime: RopeRuntime,
    applyJump: boolean,
    forceDestroy?: boolean
  ): void
  addDetachedPlayerRope(runtime: RopeRuntime): void
  adjustTetherLength(
    entity: Entity,
    runtime: RopeRuntime,
    deltaMs: number,
    playerBodyId: b2BodyId,
    useAnchorLocal: boolean
  ): void
  getPlayerTetherMinLength(entity: Entity, runtime: RopeRuntime): number
  getPlayerTetherMinLengthForTarget(
    entity: Entity,
    target: Entity | null | undefined
  ): number
  rebuildPlayerTetherJoint(
    runtime: RopeRuntime,
    playerBodyId: b2BodyId,
    useAnchorLocal: boolean
  ): void
  syncTetherAnchorTarget(
    runtime: RopeRuntime,
    grapple: NonNullable<Entity['grapple']>
  ): boolean
  resolveRuntimeAnchorEndpoint(
    runtime: RopeRuntime,
    out: RopeEndpointBuild
  ): boolean
  hasDynamicAnchorTether(entity: Entity): boolean
  syncDynamicTetherEndpointBodies(
    entity: Entity,
    runtime: RopeRuntime,
    deltaMs: number
  ): boolean
  syncKinematicAnchorBody(
    bodyId: b2BodyId,
    x: number,
    y: number,
    previousX: number,
    previousY: number,
    deltaMs: number
  ): void
  applyPlayerTetherLimitTension(
    entity: Entity,
    grapple: NonNullable<Entity['grapple']>,
    runtime: RopeRuntime,
    isRetractingTether: boolean
  ): void
  getPlayerTetherAnchorTensionBody(runtime: RopeRuntime): b2BodyId | null
  isTensionBodyMovable(bodyId: b2BodyId | null): bodyId is b2BodyId
  getRopeLimitTensionSpeed(
    stretch: number,
    relativeAwaySpeed: number,
    endpointCount: number
  ): number
  getRopeRetractTensionStretch(dist: number, ropeLength: number): number
  getRopeRetractTensionSpeed(stretch: number, endpointCount: number): number
  getBodyVelocityAlong(bodyId: b2BodyId, dirX: number, dirY: number): number
  repositionSegment(
    entity: Entity,
    runtime: RopeRuntime,
    segIndex: number
  ): void
  destroyAnchorTether(
    entity: Entity,
    grapple: NonNullable<Entity['grapple']>
  ): void
  destroyPlayerRopeRuntime(runtime: RopeRuntime): void
  transferTetherToSelectedTarget(
    entity: Entity,
    grapple: NonNullable<Entity['grapple']>
  ): boolean
  resolveTetherTransferTarget(
    entity: Entity,
    runtime: RopeRuntime,
    source: Entity
  ): Entity | null
  resolveGrappleEndpoint(
    entity: Entity,
    out: RopeEndpointBuild,
    requireTether: boolean
  ): boolean
}

export interface RopeClimbingApi {
  tryToggleRopeClimb(entity: Entity): boolean
  getOrCreateRopeClimbRuntime(entityId: number): RopeClimbRuntime
  tryStartPlayerRopeClimb(
    entity: Entity,
    grapple: NonNullable<Entity['grapple']>
  ): boolean
  tryStartDetachedPlayerRopeClimb(
    entity: Entity,
    grapple: NonNullable<Entity['grapple']>
  ): boolean
  tryStartBridgeRopeClimb(
    entity: Entity,
    grapple: NonNullable<Entity['grapple']>
  ): boolean
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
    pathDistance?: number,
    normalOffset?: number
  ): boolean
  updateRopeClimb(
    entity: Entity,
    grapple: NonNullable<Entity['grapple']>,
    deltaMs: number
  ): void
  updatePlayerRopeClimb(
    entity: Entity,
    grapple: NonNullable<Entity['grapple']>,
    climbRuntime: RopeClimbRuntime,
    deltaMs: number
  ): void
  updateBridgeRopeClimb(
    entity: Entity,
    grapple: NonNullable<Entity['grapple']>,
    climbRuntime: RopeClimbRuntime,
    deltaMs: number
  ): void
  tryPerformRopeClimbJump(
    entity: Entity,
    grapple: NonNullable<Entity['grapple']>,
    climbRuntime: RopeClimbRuntime
  ): boolean
  performBridgeRopeClimbJump(
    entity: Entity,
    climbRuntime: RopeClimbRuntime
  ): void
  advanceRopeClimb(
    entity: Entity,
    climbRuntime: RopeClimbRuntime,
    linkLength: number,
    deltaMs: number
  ): boolean
  stopRopeClimb(
    entity: Entity,
    grapple: NonNullable<Entity['grapple']>,
    destroyOwnedRope: boolean
  ): void
  resetRopeClimbRuntime(runtime: RopeClimbRuntime): void
  destroyRopeClimbJoint(runtime: RopeClimbRuntime): void
  rebuildRopeClimbJoint(entity: Entity, climbRuntime: RopeClimbRuntime): boolean
  isRopeClimbNodeValid(climbRuntime: RopeClimbRuntime): boolean
  syncBridgeRopeClimbAttachment(
    entity: Entity,
    runtime: RopeBridgeRuntime,
    climbRuntime: RopeClimbRuntime,
    deltaMs: number
  ): boolean
  applyBridgeRopeClimbWeight(entity: Entity, runtime: RopeBridgeRuntime): void
  hasActiveBridgeRopeClimber(runtime: RopeBridgeRuntime): boolean
  applyBridgeRopePointForce(
    runtime: RopeBridgeRuntime,
    forceX: number,
    forceY: number
  ): void
  applyBridgeRopePointImpulse(
    runtime: RopeBridgeRuntime,
    impulseX: number,
    impulseY: number
  ): void
  applyBridgeRopeNodeForce(
    runtime: RopeBridgeRuntime,
    nodeIndex: number,
    forceX: number,
    forceY: number
  ): void
  applyBridgeRopeNodeImpulse(
    runtime: RopeBridgeRuntime,
    nodeIndex: number,
    impulseX: number,
    impulseY: number
  ): void
  getBridgeRopeDynamicNodeBody(
    runtime: RopeBridgeRuntime,
    nodeIndex: number
  ): b2BodyId | null
  getRopeClimbNodeBody(climbRuntime: RopeClimbRuntime): b2BodyId | null
  getPlayerRopeNodeBody(
    runtime: RopeRuntime,
    nodeIndex: number
  ): b2BodyId | null
  getBridgeRopeNodeBody(
    runtime: RopeBridgeRuntime,
    nodeIndex: number
  ): b2BodyId | null
  findNearestPlayerRopeNode(
    runtime: RopeRuntime,
    x: number,
    y: number,
    maxNodeIndex: number,
    limitDistSq: number
  ): number
  resolveBridgeRopePoint(
    runtime: RopeBridgeRuntime,
    pathDistance: number
  ): boolean
  findNearestBridgeRopePoint(x: number, y: number, renderLayer: number): void
  findNearestDetachedPlayerRopeNode(
    x: number,
    y: number,
    renderLayer: number
  ): void
  stopRopeClimbersForPlayerRope(runtime: RopeRuntime): void
  stopRopeClimbersForBridge(runtime: RopeBridgeRuntime): void
  handleRopeNodeSwingInput(
    entity: Entity,
    climbRuntime: RopeClimbRuntime,
    deltaMs: number
  ): void
}

export interface BridgeRopeApi {
  createBridgeRope(
    source: Entity,
    target: Entity,
    ignoredPlayerRuntime?: RopeRuntime | null
  ): boolean
  resolveBridgeEndpoint(entity: Entity, out: RopeEndpointBuild): boolean
  acquireBridgeRope(): RopeBridgeRuntime
  findBridgeRope(
    endpointAEntityId: number,
    endpointBEntityId: number
  ): RopeBridgeRuntime | null
  updateBridgeRopes(deltaMs: number): void
  updateDetachedPlayerRopes(deltaMs: number): void
  syncDetachedPlayerRopeAnchor(runtime: RopeRuntime, deltaMs: number): boolean
  resolveBridgeRuntimeEndpoint(
    runtime: RopeBridgeRuntime,
    useEndpointA: boolean,
    out: RopeEndpointBuild
  ): boolean
  syncBridgeEndpoint(
    runtime: RopeBridgeRuntime,
    useEndpointA: boolean,
    deltaMs: number
  ): boolean
  applyBridgeLimitTension(runtime: RopeBridgeRuntime): void
  applyBridgeEndpointTension(
    bodyId: b2BodyId,
    pointX: number,
    pointY: number,
    dirX: number,
    dirY: number,
    targetAlong: number
  ): void
  detachBridgeRopesForTarget(targetEntityId: number): void
  destroyBridgeRope(runtime: RopeBridgeRuntime): void
}

export interface GrappleCombatApi {
  hitRopesInOBB(request: RopeHitRequest): boolean
  hitRopesInCircle(request: RopeCircleHitRequest): boolean
  tryHitPlayerRopeInOBB(runtime: RopeRuntime, request: RopeHitRequest): boolean
  tryHitBridgeRopeInOBB(
    runtime: RopeBridgeRuntime,
    request: RopeHitRequest
  ): boolean
  tryHitPlayerRopeInCircle(
    runtime: RopeRuntime,
    request: RopeCircleHitRequest
  ): boolean
  tryHitBridgeRopeInCircle(
    runtime: RopeBridgeRuntime,
    request: RopeCircleHitRequest
  ): boolean
  canHitRopeRuntime(
    runtime: RopeRuntime,
    request: RopeHitRequest | RopeCircleHitRequest
  ): boolean
  canHitBridgeRopeRuntime(
    runtime: RopeBridgeRuntime,
    request: RopeHitRequest | RopeCircleHitRequest
  ): boolean
  isRopeAlreadyHit(
    hitId: number,
    request: RopeHitRequest | RopeCircleHitRequest
  ): boolean
  markRopeHit(
    hitId: number,
    request: RopeHitRequest | RopeCircleHitRequest
  ): void
  getRopeHitDamage(request: RopeHitRequest | RopeCircleHitRequest): number
  findHitRopeSegmentInOBB(
    segmentBodies: b2BodyId[],
    segmentCount: number,
    request: RopeHitRequest
  ): boolean
  findHitRopeSegmentInCircle(
    segmentBodies: b2BodyId[],
    segmentCount: number,
    request: RopeCircleHitRequest
  ): boolean
  applyRopeHitFeedback(
    runtime: RopeRuntime | RopeBridgeRuntime,
    request: RopeHitRequest
  ): void
  applyRopeCircleHitFeedback(
    runtime: RopeRuntime | RopeBridgeRuntime,
    request: RopeCircleHitRequest
  ): void
  startRopeHitShake(
    runtime: RopeRuntime | RopeBridgeRuntime,
    request: RopeHitRequest
  ): void
  startRopeCircleHitShake(
    runtime: RopeRuntime | RopeBridgeRuntime,
    request: RopeCircleHitRequest
  ): void
  tryStartRopeHitShakeFromRequestDirection(
    runtime: RopeRuntime | RopeBridgeRuntime,
    request: RopeHitRequest | RopeCircleHitRequest
  ): boolean
  startRopeHitShakeWithDirection(
    runtime: RopeRuntime | RopeBridgeRuntime,
    dirX: number,
    dirY: number
  ): void
  emitRopeHitSound(x: number, y: number): void
}

export interface RopeRenderAdapterApi {
  writeActiveRopePoints(
    entity: Entity,
    targetBuffer: Float32Array<ArrayBufferLike>,
    startOffset: number,
    maxPoints: number
  ): number
  writePlayerRopePoints(
    entity: Entity,
    runtime: RopeRuntime | null,
    targetBuffer: Float32Array<ArrayBufferLike>,
    startOffset: number,
    maxPoints: number,
    pointCount: number
  ): number
  writePlayerRopeAnchorPoint(
    runtime: RopeRuntime,
    targetBuffer: Float32Array<ArrayBufferLike>,
    outOffset: number
  ): boolean
  writeBridgeRopePoints(
    runtime: RopeBridgeRuntime,
    targetBuffer: Float32Array<ArrayBufferLike>,
    startOffset: number,
    maxPoints: number,
    pointCount: number
  ): number
  writeRopeBreak(
    targetBuffer: Float32Array<ArrayBufferLike>,
    startOffset: number,
    pointCount: number
  ): void
  writeRopeSegmentPoint(
    runtime: RopeRuntime | RopeBridgeRuntime,
    segmentIndex: number,
    x: number,
    y: number,
    targetBuffer: Float32Array<ArrayBufferLike>,
    outOffset: number
  ): void
}

export type GrappleSystemRuntime = GrappleSystemContext &
  GrappleStateApi &
  GrappleTargetingApi &
  GrappleLocomotionApi &
  GrappleRopeRuntimeApi &
  RopeClimbingApi &
  BridgeRopeApi &
  GrappleCombatApi &
  RopeRenderAdapterApi
