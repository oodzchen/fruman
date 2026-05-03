import type { MainModule, b2WorldId } from '../../types'
import { componentRegistry } from '../ComponentRegistry'
import type { Entity } from '../Entity'
import { System } from '../System'
import type { World } from '../World'
import type { StatsSystem } from './StatsSystem'
import { BridgeRopeSystem } from './grapple/BridgeRopeSystem'
import { GrappleCombatSystem } from './grapple/GrappleCombatSystem'
import { GrappleLocomotionSystem } from './grapple/GrappleLocomotionSystem'
import { GrappleRopeRuntimeSystem } from './grapple/GrappleRopeRuntimeSystem'
import type { GrappleSystemRuntime } from './grapple/GrappleRuntime'
import { GrappleStateSystem } from './grapple/GrappleStateSystem'
import { GrappleSystemContext } from './grapple/GrappleSystemContext'
import { GrappleTargetingSystem } from './grapple/GrappleTargetingSystem'
import type {
  RopeCircleHitRequest,
  RopeHitRequest,
} from './grapple/GrappleTypes'
import { RopeClimbingSystem } from './grapple/RopeClimbingSystem'
import { RopeRenderAdapterSystem } from './grapple/RopeRenderAdapterSystem'

export type {
  RopeCircleHitRequest,
  RopeHitRequest,
  RopeHitWeaponState,
} from './grapple/GrappleTypes'

export class GrappleSystem extends System {
  private readonly runtime: GrappleSystemRuntime
  private readonly state: GrappleStateSystem
  private readonly targeting: GrappleTargetingSystem
  private readonly locomotion: GrappleLocomotionSystem
  private readonly ropeRuntime: GrappleRopeRuntimeSystem
  private readonly climbing: RopeClimbingSystem
  private readonly bridgeRope: BridgeRopeSystem
  private readonly combat: GrappleCombatSystem
  private readonly renderAdapter: RopeRenderAdapterSystem

  constructor(world: World, box2d: MainModule, worldId: b2WorldId) {
    super()
    const runtime = new GrappleSystemContext(
      world,
      box2d,
      worldId
    ) as GrappleSystemRuntime
    this.runtime = runtime
    this.state = new GrappleStateSystem(runtime)
    this.targeting = new GrappleTargetingSystem(runtime)
    this.locomotion = new GrappleLocomotionSystem(runtime)
    this.ropeRuntime = new GrappleRopeRuntimeSystem(runtime)
    this.climbing = new RopeClimbingSystem(runtime)
    this.bridgeRope = new BridgeRopeSystem(runtime)
    this.combat = new GrappleCombatSystem(runtime)
    this.renderAdapter = new RopeRenderAdapterSystem(runtime)
    this.bindRuntimeApi()

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

  private bindRuntimeApi(): void {
    const runtime = this.runtime
    runtime.update = this.state.update.bind(this.state)
    runtime.updateGrappleRuntimes = this.state.updateGrappleRuntimes.bind(
      this.state
    )
    runtime.updateGrappleEntity = this.state.updateGrappleEntity.bind(
      this.state
    )
    runtime.refreshEntityAnchorAvailability =
      this.state.refreshEntityAnchorAvailability.bind(this.state)
    runtime.resolveGrappleFrameState = this.state.resolveGrappleFrameState.bind(
      this.state
    )
    runtime.processUnavailableGrapple =
      this.state.processUnavailableGrapple.bind(this.state)
    runtime.processInterruptedGrapple =
      this.state.processInterruptedGrapple.bind(this.state)
    runtime.processGrappleBreakRequest =
      this.state.processGrappleBreakRequest.bind(this.state)
    runtime.processActiveTetherAction =
      this.state.processActiveTetherAction.bind(this.state)
    runtime.tryStartGrappleAction = this.state.tryStartGrappleAction.bind(
      this.state
    )
    runtime.tryStartAnchorGrappleAction =
      this.state.tryStartAnchorGrappleAction.bind(this.state)
    runtime.startLockedTargetGrapple = this.state.startLockedTargetGrapple.bind(
      this.state
    )
    runtime.startAnchorTargetGrapple = this.state.startAnchorTargetGrapple.bind(
      this.state
    )
    runtime.beginGrapplePull = this.state.beginGrapplePull.bind(this.state)
    runtime.tryStartPersistentTether = this.state.tryStartPersistentTether.bind(
      this.state
    )
    runtime.refreshAnchorCache = this.targeting.refreshAnchorCache.bind(
      this.targeting
    )
    runtime.findAnchorTarget = this.targeting.findAnchorTarget.bind(
      this.targeting
    )
    runtime.findGrappleTargetAnchor =
      this.targeting.findGrappleTargetAnchor.bind(this.targeting)
    runtime.canUseLockedTarget = this.targeting.canUseLockedTarget.bind(
      this.targeting
    )
    runtime.getTargetToughness = this.targeting.getTargetToughness.bind(
      this.targeting
    )
    runtime.getAttackDistance = this.targeting.getAttackDistance.bind(
      this.targeting
    )
    runtime.applyNpcStun = this.targeting.applyNpcStun.bind(this.targeting)
    runtime.triggerNpcAggro = this.targeting.triggerNpcAggro.bind(
      this.targeting
    )
    runtime.updatePull = this.locomotion.updatePull.bind(this.locomotion)
    runtime.syncPullTargetPosition =
      this.locomotion.syncPullTargetPosition.bind(this.locomotion)
    runtime.getPullDistanceSq = this.locomotion.getPullDistanceSq.bind(
      this.locomotion
    )
    runtime.processPulledTarget = this.locomotion.processPulledTarget.bind(
      this.locomotion
    )
    runtime.finishPulledTarget = this.locomotion.finishPulledTarget.bind(
      this.locomotion
    )
    runtime.processPlayerLinearPull =
      this.locomotion.processPlayerLinearPull.bind(this.locomotion)
    runtime.processAnchorOrArcPull =
      this.locomotion.processAnchorOrArcPull.bind(this.locomotion)
    runtime.stopPull = this.locomotion.stopPull.bind(this.locomotion)
    runtime.shouldRetainAirMomentumAfterStop =
      this.locomotion.shouldRetainAirMomentumAfterStop.bind(this.locomotion)
    runtime.resetGrappleMotion = this.locomotion.resetGrappleMotion.bind(
      this.locomotion
    )
    runtime.applyLinearPull = this.locomotion.applyLinearPull.bind(
      this.locomotion
    )
    runtime.stopLinearMotion = this.locomotion.stopLinearMotion.bind(
      this.locomotion
    )
    runtime.applyGrappleImpulse = this.locomotion.applyGrappleImpulse.bind(
      this.locomotion
    )
    runtime.performRopeJump = this.locomotion.performRopeJump.bind(
      this.locomotion
    )
    runtime.startRopeJumpMotion = this.locomotion.startRopeJumpMotion.bind(
      this.locomotion
    )
    runtime.beginRopeJumpState = this.locomotion.beginRopeJumpState.bind(
      this.locomotion
    )
    runtime.handleSwingInput = this.locomotion.handleSwingInput.bind(
      this.locomotion
    )
    runtime.updateExistingRopeSegments =
      this.ropeRuntime.updateExistingRopeSegments.bind(this.ropeRuntime)
    runtime.updateExistingRopeJoints =
      this.ropeRuntime.updateExistingRopeJoints.bind(this.ropeRuntime)
    runtime.getBridgeRopeLinearDamping =
      this.ropeRuntime.getBridgeRopeLinearDamping.bind(this.ropeRuntime)
    runtime.getBridgeRopeHertz = this.ropeRuntime.getBridgeRopeHertz.bind(
      this.ropeRuntime
    )
    runtime.getBridgeRopeDampingRatio =
      this.ropeRuntime.getBridgeRopeDampingRatio.bind(this.ropeRuntime)
    runtime.setBridgeRopeClimbTuning =
      this.ropeRuntime.setBridgeRopeClimbTuning.bind(this.ropeRuntime)
    runtime.updateBridgeRopeSegmentDamping =
      this.ropeRuntime.updateBridgeRopeSegmentDamping.bind(this.ropeRuntime)
    runtime.updateBridgeRopeJointTuning =
      this.ropeRuntime.updateBridgeRopeJointTuning.bind(this.ropeRuntime)
    runtime.detachTetherTarget = this.ropeRuntime.detachTetherTarget.bind(
      this.ropeRuntime
    )
    runtime.getOrCreateRopeRuntime =
      this.ropeRuntime.getOrCreateRopeRuntime.bind(this.ropeRuntime)
    runtime.prepareNewAnchorTetherRuntime =
      this.ropeRuntime.prepareNewAnchorTetherRuntime.bind(this.ropeRuntime)
    runtime.canCreateRopeOnTarget = this.ropeRuntime.canCreateRopeOnTarget.bind(
      this.ropeRuntime
    )
    runtime.getRopeCountForTarget = this.ropeRuntime.getRopeCountForTarget.bind(
      this.ropeRuntime
    )
    runtime.startAnchorTether = this.ropeRuntime.startAnchorTether.bind(
      this.ropeRuntime
    )
    runtime.buildDynamicAnchorTether =
      this.ropeRuntime.buildDynamicAnchorTether.bind(this.ropeRuntime)
    runtime.buildAnchorTether = this.ropeRuntime.buildAnchorTether.bind(
      this.ropeRuntime
    )
    runtime.createPlayerTetherFollowBody =
      this.ropeRuntime.createPlayerTetherFollowBody.bind(this.ropeRuntime)
    runtime.switchPlayerTetherState =
      this.ropeRuntime.switchPlayerTetherState.bind(this.ropeRuntime)
    runtime.updatePlayerTetherState =
      this.ropeRuntime.updatePlayerTetherState.bind(this.ropeRuntime)
    runtime.didMovementJumpStartThisTick =
      this.ropeRuntime.didMovementJumpStartThisTick.bind(this.ropeRuntime)
    runtime.shouldDetachTetherForSuspendedJump =
      this.ropeRuntime.shouldDetachTetherForSuspendedJump.bind(this.ropeRuntime)
    runtime.isPlayerTetherSuspended =
      this.ropeRuntime.isPlayerTetherSuspended.bind(this.ropeRuntime)
    runtime.hasPlayerTetherSuspensionGeometry =
      this.ropeRuntime.hasPlayerTetherSuspensionGeometry.bind(this.ropeRuntime)
    runtime.syncPlayerTetherEndpointBody =
      this.ropeRuntime.syncPlayerTetherEndpointBody.bind(this.ropeRuntime)
    runtime.getPlayerTetherBodyId = this.ropeRuntime.getPlayerTetherBodyId.bind(
      this.ropeRuntime
    )
    runtime.updateAnchorTether = this.ropeRuntime.updateAnchorTether.bind(
      this.ropeRuntime
    )
    runtime.detachPlayerFromTetherForJump =
      this.ropeRuntime.detachPlayerFromTetherForJump.bind(this.ropeRuntime)
    runtime.destroyConnectedPlayerRope =
      this.ropeRuntime.destroyConnectedPlayerRope.bind(this.ropeRuntime)
    runtime.detachPlayerFromTether =
      this.ropeRuntime.detachPlayerFromTether.bind(this.ropeRuntime)
    runtime.addDetachedPlayerRope = this.ropeRuntime.addDetachedPlayerRope.bind(
      this.ropeRuntime
    )
    runtime.adjustTetherLength = this.ropeRuntime.adjustTetherLength.bind(
      this.ropeRuntime
    )
    runtime.getPlayerTetherMinLength =
      this.ropeRuntime.getPlayerTetherMinLength.bind(this.ropeRuntime)
    runtime.getPlayerTetherMinLengthForTarget =
      this.ropeRuntime.getPlayerTetherMinLengthForTarget.bind(this.ropeRuntime)
    runtime.rebuildPlayerTetherJoint =
      this.ropeRuntime.rebuildPlayerTetherJoint.bind(this.ropeRuntime)
    runtime.syncTetherAnchorTarget =
      this.ropeRuntime.syncTetherAnchorTarget.bind(this.ropeRuntime)
    runtime.resolveRuntimeAnchorEndpoint =
      this.ropeRuntime.resolveRuntimeAnchorEndpoint.bind(this.ropeRuntime)
    runtime.hasDynamicAnchorTether =
      this.ropeRuntime.hasDynamicAnchorTether.bind(this.ropeRuntime)
    runtime.syncDynamicTetherEndpointBodies =
      this.ropeRuntime.syncDynamicTetherEndpointBodies.bind(this.ropeRuntime)
    runtime.syncKinematicAnchorBody =
      this.ropeRuntime.syncKinematicAnchorBody.bind(this.ropeRuntime)
    runtime.applyPlayerTetherLimitTension =
      this.ropeRuntime.applyPlayerTetherLimitTension.bind(this.ropeRuntime)
    runtime.getPlayerTetherAnchorTensionBody =
      this.ropeRuntime.getPlayerTetherAnchorTensionBody.bind(this.ropeRuntime)
    runtime.isTensionBodyMovable = this.ropeRuntime.isTensionBodyMovable.bind(
      this.ropeRuntime
    )
    runtime.getRopeLimitTensionSpeed =
      this.ropeRuntime.getRopeLimitTensionSpeed.bind(this.ropeRuntime)
    runtime.getRopeRetractTensionStretch =
      this.ropeRuntime.getRopeRetractTensionStretch.bind(this.ropeRuntime)
    runtime.getRopeRetractTensionSpeed =
      this.ropeRuntime.getRopeRetractTensionSpeed.bind(this.ropeRuntime)
    runtime.getBodyVelocityAlong = this.ropeRuntime.getBodyVelocityAlong.bind(
      this.ropeRuntime
    )
    runtime.repositionSegment = this.ropeRuntime.repositionSegment.bind(
      this.ropeRuntime
    )
    runtime.destroyAnchorTether = this.ropeRuntime.destroyAnchorTether.bind(
      this.ropeRuntime
    )
    runtime.destroyPlayerRopeRuntime =
      this.ropeRuntime.destroyPlayerRopeRuntime.bind(this.ropeRuntime)
    runtime.transferTetherToSelectedTarget =
      this.ropeRuntime.transferTetherToSelectedTarget.bind(this.ropeRuntime)
    runtime.resolveTetherTransferTarget =
      this.ropeRuntime.resolveTetherTransferTarget.bind(this.ropeRuntime)
    runtime.resolveGrappleEndpoint =
      this.ropeRuntime.resolveGrappleEndpoint.bind(this.ropeRuntime)
    runtime.tryToggleRopeClimb = this.climbing.tryToggleRopeClimb.bind(
      this.climbing
    )
    runtime.getOrCreateRopeClimbRuntime =
      this.climbing.getOrCreateRopeClimbRuntime.bind(this.climbing)
    runtime.tryStartPlayerRopeClimb =
      this.climbing.tryStartPlayerRopeClimb.bind(this.climbing)
    runtime.tryStartDetachedPlayerRopeClimb =
      this.climbing.tryStartDetachedPlayerRopeClimb.bind(this.climbing)
    runtime.tryStartBridgeRopeClimb =
      this.climbing.tryStartBridgeRopeClimb.bind(this.climbing)
    runtime.startRopeClimb = this.climbing.startRopeClimb.bind(this.climbing)
    runtime.updateRopeClimb = this.climbing.updateRopeClimb.bind(this.climbing)
    runtime.updatePlayerRopeClimb = this.climbing.updatePlayerRopeClimb.bind(
      this.climbing
    )
    runtime.updateBridgeRopeClimb = this.climbing.updateBridgeRopeClimb.bind(
      this.climbing
    )
    runtime.tryPerformRopeClimbJump =
      this.climbing.tryPerformRopeClimbJump.bind(this.climbing)
    runtime.performBridgeRopeClimbJump =
      this.climbing.performBridgeRopeClimbJump.bind(this.climbing)
    runtime.advanceRopeClimb = this.climbing.advanceRopeClimb.bind(
      this.climbing
    )
    runtime.stopRopeClimb = this.climbing.stopRopeClimb.bind(this.climbing)
    runtime.resetRopeClimbRuntime = this.climbing.resetRopeClimbRuntime.bind(
      this.climbing
    )
    runtime.destroyRopeClimbJoint = this.climbing.destroyRopeClimbJoint.bind(
      this.climbing
    )
    runtime.rebuildRopeClimbJoint = this.climbing.rebuildRopeClimbJoint.bind(
      this.climbing
    )
    runtime.isRopeClimbNodeValid = this.climbing.isRopeClimbNodeValid.bind(
      this.climbing
    )
    runtime.syncBridgeRopeClimbAttachment =
      this.climbing.syncBridgeRopeClimbAttachment.bind(this.climbing)
    runtime.applyBridgeRopeClimbWeight =
      this.climbing.applyBridgeRopeClimbWeight.bind(this.climbing)
    runtime.hasActiveBridgeRopeClimber =
      this.climbing.hasActiveBridgeRopeClimber.bind(this.climbing)
    runtime.applyBridgeRopePointForce =
      this.climbing.applyBridgeRopePointForce.bind(this.climbing)
    runtime.applyBridgeRopePointImpulse =
      this.climbing.applyBridgeRopePointImpulse.bind(this.climbing)
    runtime.applyBridgeRopeNodeForce =
      this.climbing.applyBridgeRopeNodeForce.bind(this.climbing)
    runtime.applyBridgeRopeNodeImpulse =
      this.climbing.applyBridgeRopeNodeImpulse.bind(this.climbing)
    runtime.getBridgeRopeDynamicNodeBody =
      this.climbing.getBridgeRopeDynamicNodeBody.bind(this.climbing)
    runtime.getRopeClimbNodeBody = this.climbing.getRopeClimbNodeBody.bind(
      this.climbing
    )
    runtime.getPlayerRopeNodeBody = this.climbing.getPlayerRopeNodeBody.bind(
      this.climbing
    )
    runtime.getBridgeRopeNodeBody = this.climbing.getBridgeRopeNodeBody.bind(
      this.climbing
    )
    runtime.findNearestPlayerRopeNode =
      this.climbing.findNearestPlayerRopeNode.bind(this.climbing)
    runtime.resolveBridgeRopePoint = this.climbing.resolveBridgeRopePoint.bind(
      this.climbing
    )
    runtime.findNearestBridgeRopePoint =
      this.climbing.findNearestBridgeRopePoint.bind(this.climbing)
    runtime.findNearestDetachedPlayerRopeNode =
      this.climbing.findNearestDetachedPlayerRopeNode.bind(this.climbing)
    runtime.stopRopeClimbersForPlayerRope =
      this.climbing.stopRopeClimbersForPlayerRope.bind(this.climbing)
    runtime.stopRopeClimbersForBridge =
      this.climbing.stopRopeClimbersForBridge.bind(this.climbing)
    runtime.handleRopeNodeSwingInput =
      this.climbing.handleRopeNodeSwingInput.bind(this.climbing)
    runtime.createBridgeRope = this.bridgeRope.createBridgeRope.bind(
      this.bridgeRope
    )
    runtime.resolveBridgeEndpoint = this.bridgeRope.resolveBridgeEndpoint.bind(
      this.bridgeRope
    )
    runtime.acquireBridgeRope = this.bridgeRope.acquireBridgeRope.bind(
      this.bridgeRope
    )
    runtime.findBridgeRope = this.bridgeRope.findBridgeRope.bind(
      this.bridgeRope
    )
    runtime.updateBridgeRopes = this.bridgeRope.updateBridgeRopes.bind(
      this.bridgeRope
    )
    runtime.updateDetachedPlayerRopes =
      this.bridgeRope.updateDetachedPlayerRopes.bind(this.bridgeRope)
    runtime.syncDetachedPlayerRopeAnchor =
      this.bridgeRope.syncDetachedPlayerRopeAnchor.bind(this.bridgeRope)
    runtime.resolveBridgeRuntimeEndpoint =
      this.bridgeRope.resolveBridgeRuntimeEndpoint.bind(this.bridgeRope)
    runtime.syncBridgeEndpoint = this.bridgeRope.syncBridgeEndpoint.bind(
      this.bridgeRope
    )
    runtime.applyBridgeLimitTension =
      this.bridgeRope.applyBridgeLimitTension.bind(this.bridgeRope)
    runtime.applyBridgeEndpointTension =
      this.bridgeRope.applyBridgeEndpointTension.bind(this.bridgeRope)
    runtime.detachBridgeRopesForTarget =
      this.bridgeRope.detachBridgeRopesForTarget.bind(this.bridgeRope)
    runtime.destroyBridgeRope = this.bridgeRope.destroyBridgeRope.bind(
      this.bridgeRope
    )
    runtime.hitRopesInOBB = this.combat.hitRopesInOBB.bind(this.combat)
    runtime.hitRopesInCircle = this.combat.hitRopesInCircle.bind(this.combat)
    runtime.tryHitPlayerRopeInOBB = this.combat.tryHitPlayerRopeInOBB.bind(
      this.combat
    )
    runtime.tryHitBridgeRopeInOBB = this.combat.tryHitBridgeRopeInOBB.bind(
      this.combat
    )
    runtime.tryHitPlayerRopeInCircle =
      this.combat.tryHitPlayerRopeInCircle.bind(this.combat)
    runtime.tryHitBridgeRopeInCircle =
      this.combat.tryHitBridgeRopeInCircle.bind(this.combat)
    runtime.canHitRopeRuntime = this.combat.canHitRopeRuntime.bind(this.combat)
    runtime.canHitBridgeRopeRuntime = this.combat.canHitBridgeRopeRuntime.bind(
      this.combat
    )
    runtime.isRopeAlreadyHit = this.combat.isRopeAlreadyHit.bind(this.combat)
    runtime.markRopeHit = this.combat.markRopeHit.bind(this.combat)
    runtime.getRopeHitDamage = this.combat.getRopeHitDamage.bind(this.combat)
    runtime.findHitRopeSegmentInOBB = this.combat.findHitRopeSegmentInOBB.bind(
      this.combat
    )
    runtime.findHitRopeSegmentInCircle =
      this.combat.findHitRopeSegmentInCircle.bind(this.combat)
    runtime.applyRopeHitFeedback = this.combat.applyRopeHitFeedback.bind(
      this.combat
    )
    runtime.applyRopeCircleHitFeedback =
      this.combat.applyRopeCircleHitFeedback.bind(this.combat)
    runtime.startRopeHitShake = this.combat.startRopeHitShake.bind(this.combat)
    runtime.startRopeCircleHitShake = this.combat.startRopeCircleHitShake.bind(
      this.combat
    )
    runtime.tryStartRopeHitShakeFromRequestDirection =
      this.combat.tryStartRopeHitShakeFromRequestDirection.bind(this.combat)
    runtime.startRopeHitShakeWithDirection =
      this.combat.startRopeHitShakeWithDirection.bind(this.combat)
    runtime.emitRopeHitSound = this.combat.emitRopeHitSound.bind(this.combat)
    runtime.writeActiveRopePoints =
      this.renderAdapter.writeActiveRopePoints.bind(this.renderAdapter)
    runtime.writePlayerRopePoints =
      this.renderAdapter.writePlayerRopePoints.bind(this.renderAdapter)
    runtime.writePlayerRopeAnchorPoint =
      this.renderAdapter.writePlayerRopeAnchorPoint.bind(this.renderAdapter)
    runtime.writeBridgeRopePoints =
      this.renderAdapter.writeBridgeRopePoints.bind(this.renderAdapter)
    runtime.writeRopeBreak = this.renderAdapter.writeRopeBreak.bind(
      this.renderAdapter
    )
    runtime.writeRopeSegmentPoint =
      this.renderAdapter.writeRopeSegmentPoint.bind(this.renderAdapter)
  }

  markAnchorsDirty(): void {
    this.runtime.markAnchorsDirty()
  }

  setStatsSystem(statsSystem: StatsSystem): void {
    this.runtime.setStatsSystem(statsSystem)
  }

  setRopeDensity(value: number): void {
    this.runtime.setRopeDensity(value)
  }

  setRopeLinearDamping(value: number): void {
    this.runtime.setRopeLinearDamping(value)
  }

  setRopeHertz(value: number): void {
    this.runtime.setRopeHertz(value)
  }

  setRopeDampingRatio(value: number): void {
    this.runtime.setRopeDampingRatio(value)
  }

  setRopeBendStiffness(value: number): void {
    this.runtime.setRopeBendStiffness(value)
  }

  setRopeElasticLimitScale(value: number): void {
    this.runtime.setRopeElasticLimitScale(value)
  }

  setRopeClimbLinearDamping(value: number): void {
    this.runtime.setRopeClimbLinearDamping(value)
  }

  setRopeClimbHertz(value: number): void {
    this.runtime.setRopeClimbHertz(value)
  }

  setRopeClimbDampingRatio(value: number): void {
    this.runtime.setRopeClimbDampingRatio(value)
  }

  setRopeClimbWeightForceScale(value: number): void {
    this.runtime.setRopeClimbWeightForceScale(value)
  }

  setRopeClimbJumpRecoilScale(value: number): void {
    this.runtime.setRopeClimbJumpRecoilScale(value)
  }

  setSwingForce(value: number): void {
    this.runtime.setSwingForce(value)
  }

  tryToggleRopeClimb(entity: Entity): boolean {
    return this.climbing.tryToggleRopeClimb(entity)
  }

  detachTetherTarget(targetEntityId: number): void {
    this.ropeRuntime.detachTetherTarget(targetEntityId)
  }

  update(entities: Entity[], deltaTime: number): void {
    this.state.update(entities, deltaTime)
  }

  writeActiveRopePoints(
    entity: Entity,
    targetBuffer: Float32Array<ArrayBufferLike>,
    startOffset: number,
    maxPoints: number
  ): number {
    return this.renderAdapter.writeActiveRopePoints(
      entity,
      targetBuffer,
      startOffset,
      maxPoints
    )
  }

  hitRopesInOBB(request: RopeHitRequest): boolean {
    return this.combat.hitRopesInOBB(request)
  }

  hitRopesInCircle(request: RopeCircleHitRequest): boolean {
    return this.combat.hitRopesInCircle(request)
  }
}
