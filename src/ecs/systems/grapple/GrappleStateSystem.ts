import { SOUND_IDS } from '../../../worker/effectsProtocol'
import type { Entity } from '../../Entity'
import type { GrappleSystemRuntime } from './GrappleRuntime'
import { GrappleFrameState, GrapplePullMode } from './GrappleTypes'

export class GrappleStateSystem {
  constructor(private readonly runtime: GrappleSystemRuntime) {}

  update(entities: Entity[], deltaTime: number): void {
    const deltaMs = Math.max(0, deltaTime * 1000)
    this.runtime.currentTimeMs += deltaMs

    this.runtime.updateGrappleRuntimes(deltaMs)

    for (let i = 0; i < entities.length; i++) {
      const entity = entities[i]
      if (!entity.transform || !entity.physics || !entity.input) {
        continue
      }
      const grapple = entity.grapple
      if (!grapple) continue

      this.runtime.updateGrappleEntity(entity, grapple, deltaMs)
    }
  }

  updateGrappleRuntimes(deltaMs: number): void {
    if (this.runtime.anchorsDirty) {
      this.runtime.refreshAnchorCache()
    }

    this.runtime.updateBridgeRopes(deltaMs)
    this.runtime.updateDetachedPlayerRopes(deltaMs)
  }

  updateGrappleEntity(
    entity: Entity,
    grapple: NonNullable<Entity['grapple']>,
    deltaMs: number
  ): void {
    const input = entity.input
    if (!input) {
      return
    }
    this.runtime.refreshEntityAnchorAvailability(entity, grapple)

    const inputBuffer = input.inputBuffer
    const grappleActionActive = inputBuffer.hasActiveAction('grapple')
    const state = this.runtime.resolveGrappleFrameState(
      entity,
      grapple,
      grappleActionActive
    )

    if (state !== GrappleFrameState.BreakRequested) {
      input.grappleBreakRequested = false
    }

    switch (state) {
      case GrappleFrameState.Unavailable:
        this.runtime.processUnavailableGrapple(entity, grapple)
        return
      case GrappleFrameState.Interrupted:
        this.runtime.processInterruptedGrapple(entity, grapple)
        return
      case GrappleFrameState.BreakRequested:
        this.runtime.processGrappleBreakRequest(
          entity,
          grapple,
          input,
          inputBuffer
        )
        return
      case GrappleFrameState.RopeClimb:
        this.runtime.updateRopeClimb(entity, grapple, deltaMs)
        return
      case GrappleFrameState.ActiveTetherAction:
        this.runtime.processActiveTetherAction(entity, grapple, inputBuffer)
        return
      case GrappleFrameState.ActivePull:
        this.runtime.updatePull(entity, grapple, deltaMs)
        return
      case GrappleFrameState.Idle:
        input.grappleLengthAdjustSteps = 0
        return
      case GrappleFrameState.Cooldown:
        input.grappleLengthAdjustSteps = 0
        inputBuffer.clearAction('grapple')
        return
      case GrappleFrameState.StartAction:
        input.grappleLengthAdjustSteps = 0
        this.runtime.tryStartGrappleAction(entity, grapple)
        inputBuffer.clearAction('grapple')
        return
    }
  }

  refreshEntityAnchorAvailability(
    entity: Entity,
    grapple: NonNullable<Entity['grapple']>
  ): void {
    const transform = entity.transform
    const input = entity.input
    if (!transform || !input) {
      grapple.hasAnchorNearby = false
      return
    }

    const facing = input.lastMoveDirection !== 0 ? input.lastMoveDirection : 1
    const currentTargetX = grapple.isTethering ? grapple.targetX : undefined
    const currentTargetY = grapple.isTethering ? grapple.targetY : undefined
    grapple.hasAnchorNearby =
      this.runtime.findAnchorTarget(
        transform.x,
        transform.y,
        facing,
        this.runtime.tempTarget,
        entity.render?.renderLayer ?? 0,
        currentTargetX,
        currentTargetY
      ) !== null
  }

  resolveGrappleFrameState(
    entity: Entity,
    grapple: NonNullable<Entity['grapple']>,
    grappleActionActive: boolean
  ): GrappleFrameState {
    if (!grapple.hasGrapple) {
      return GrappleFrameState.Unavailable
    }
    if (entity.stats?.isDead || entity.isStunned()) {
      return GrappleFrameState.Interrupted
    }
    if (entity.input?.grappleBreakRequested && grappleActionActive) {
      return GrappleFrameState.BreakRequested
    }
    if (grapple.isRopeClimbing) {
      return GrappleFrameState.RopeClimb
    }
    if (
      grapple.isPulling &&
      grapple.isTethering &&
      grappleActionActive &&
      this.runtime.currentTimeMs >= grapple.cooldownEndTime
    ) {
      return GrappleFrameState.ActiveTetherAction
    }
    if (grapple.isPulling) {
      return GrappleFrameState.ActivePull
    }
    if (!grappleActionActive) {
      return GrappleFrameState.Idle
    }
    if (this.runtime.currentTimeMs < grapple.cooldownEndTime) {
      return GrappleFrameState.Cooldown
    }
    return GrappleFrameState.StartAction
  }

  processUnavailableGrapple(
    entity: Entity,
    grapple: NonNullable<Entity['grapple']>
  ): void {
    if (grapple.isRopeClimbing) {
      this.runtime.stopRopeClimb(entity, grapple, false)
    }
    if (grapple.isTethering) {
      this.runtime.destroyAnchorTether(entity, grapple)
    }
    this.runtime.resetGrappleMotion(grapple, false)
    if (entity.input) {
      entity.input.grappleLengthAdjustSteps = 0
    }
  }

  processInterruptedGrapple(
    entity: Entity,
    grapple: NonNullable<Entity['grapple']>
  ): void {
    if (grapple.isRopeClimbing) {
      this.runtime.stopRopeClimb(entity, grapple, true)
    } else {
      this.runtime.stopPull(entity, grapple, false)
    }
    if (entity.input) {
      entity.input.grappleLengthAdjustSteps = 0
    }
  }

  processGrappleBreakRequest(
    entity: Entity,
    grapple: NonNullable<Entity['grapple']>,
    input: NonNullable<Entity['input']>,
    inputBuffer: NonNullable<Entity['input']>['inputBuffer']
  ): void {
    const previousTargetX = grapple.targetX
    const previousTargetY = grapple.targetY
    const shouldStartAnchorPull =
      input.grappleTargetId !== null || grapple.hasAnchorNearby

    this.runtime.destroyConnectedPlayerRope(entity, grapple)
    input.grappleBreakRequested = false
    input.grapplePersistentRequested = false

    if (shouldStartAnchorPull) {
      this.runtime.tryStartGrappleAction(
        entity,
        grapple,
        previousTargetX,
        previousTargetY
      )
    }

    inputBuffer.clearAction('grapple')
  }

  processActiveTetherAction(
    entity: Entity,
    grapple: NonNullable<Entity['grapple']>,
    inputBuffer: NonNullable<Entity['input']>['inputBuffer']
  ): void {
    const input = entity.input
    if (!input) {
      inputBuffer.clearAction('grapple')
      return
    }

    if (input.grapplePersistentRequested) {
      this.runtime.transferTetherToSelectedTarget(entity, grapple)
      input.grappleTargetId = null
      inputBuffer.clearAction('grapple')
      return
    }

    const previousTargetX = grapple.targetX
    const previousTargetY = grapple.targetY
    const shouldStartPullAfterDetach =
      input.lockedTargetId !== null || grapple.hasAnchorNearby
    const runtime = this.runtime.ropeRuntimeByEntityId.get(entity.id)
    if (runtime?.active === true && runtime.playerAttached) {
      const shouldDestroyCurrentTether =
        runtime.anchorIsDynamicTarget ||
        (shouldStartPullAfterDetach &&
          !this.runtime.isPlayerTetherSuspended(entity, grapple, runtime))
      this.runtime.detachPlayerFromTether(
        entity,
        grapple,
        runtime,
        false,
        shouldDestroyCurrentTether
      )
    }
    if (shouldStartPullAfterDetach) {
      this.runtime.tryStartGrappleAction(
        entity,
        grapple,
        previousTargetX,
        previousTargetY
      )
    }
    inputBuffer.clearAction('grapple')
  }

  tryStartGrappleAction(
    entity: Entity,
    grapple: NonNullable<Entity['grapple']>,
    excludedTargetX?: number,
    excludedTargetY?: number
  ): boolean {
    if (!entity.input || !entity.transform) {
      return false
    }

    const grappleTargetId = entity.input.grappleTargetId
    if (grappleTargetId !== null) {
      entity.input.grappleTargetId = null
      const grappleTarget = this.runtime.getEntityById(grappleTargetId)
      if (
        !grappleTarget ||
        !this.runtime.canUseLockedTarget(entity, grappleTarget)
      ) {
        return false
      }
      return this.runtime.startLockedTargetGrapple(
        entity,
        grapple,
        grappleTarget
      )
    }

    const lockedTargetId = entity.input.lockedTargetId
    if (lockedTargetId !== null) {
      const lockedTarget = this.runtime.getEntityById(lockedTargetId)
      if (
        !lockedTarget ||
        !this.runtime.canUseLockedTarget(entity, lockedTarget)
      ) {
        return false
      }
      return this.runtime.startLockedTargetGrapple(
        entity,
        grapple,
        lockedTarget
      )
    }

    return this.runtime.tryStartAnchorGrappleAction(
      entity,
      grapple,
      excludedTargetX,
      excludedTargetY
    )
  }

  tryStartAnchorGrappleAction(
    entity: Entity,
    grapple: NonNullable<Entity['grapple']>,
    excludedTargetX?: number,
    excludedTargetY?: number
  ): boolean {
    if (!entity.input || !entity.transform) {
      return false
    }

    const facing =
      entity.input.lastMoveDirection !== 0 ? entity.input.lastMoveDirection : 1
    const anchorTarget = this.runtime.findAnchorTarget(
      entity.transform.x,
      entity.transform.y,
      facing,
      this.runtime.tempTarget,
      entity.render?.renderLayer ?? 0,
      excludedTargetX,
      excludedTargetY
    )
    if (!anchorTarget) {
      return false
    }

    return this.runtime.startAnchorTargetGrapple(
      entity,
      grapple,
      anchorTarget,
      this.runtime.tempTarget.x,
      this.runtime.tempTarget.y
    )
  }

  startLockedTargetGrapple(
    entity: Entity,
    grapple: NonNullable<Entity['grapple']>,
    lockedTarget: Entity & { transform: NonNullable<Entity['transform']> }
  ): boolean {
    if (!entity.input || !entity.transform) {
      return false
    }

    const dx = lockedTarget.transform.x - entity.transform.x
    const dy = lockedTarget.transform.y - entity.transform.y
    const distSq = dx * dx + dy * dy
    if (distSq > this.runtime.rangeSq) {
      return false
    }

    const playerToughness = entity.stats?.toughness ?? 0
    const targetToughness = this.runtime.getTargetToughness(lockedTarget)
    const desiredDistance = this.runtime.getAttackDistance(entity, lockedTarget)
    this.runtime.beginGrapplePull(
      entity,
      grapple,
      lockedTarget.transform.x,
      lockedTarget.transform.y,
      lockedTarget.id,
      desiredDistance * desiredDistance
    )

    if (lockedTarget.grappleAnchor) {
      if (
        this.runtime.tryStartPersistentTether(entity, grapple, lockedTarget)
      ) {
        return true
      }
      grapple.pullMode = GrapplePullMode.Anchor
      grapple.isTethering = false
      grapple.isTetherSuspended = false
      this.runtime.applyGrappleImpulse(entity, grapple)
      return true
    }

    if (
      entity.input.grapplePersistentRequested &&
      lockedTarget.grappleTarget?.canTether === true
    ) {
      this.runtime.tryStartPersistentTether(entity, grapple, lockedTarget)
      return true
    }

    this.runtime.triggerNpcAggro(entity, lockedTarget)
    if (targetToughness <= playerToughness) {
      if (lockedTarget.grappleTarget) {
        grapple.pullMode = GrapplePullMode.Object
      } else {
        grapple.pullMode = GrapplePullMode.Npc
        this.runtime.applyNpcStun(lockedTarget, grapple.pullDurationMs)
      }
    } else {
      const isGrounded = lockedTarget.movement?.isGrounded ?? false
      grapple.pullMode = isGrounded
        ? GrapplePullMode.PlayerLinear
        : GrapplePullMode.PlayerArc
      if (grapple.pullMode === GrapplePullMode.PlayerArc) {
        this.runtime.applyGrappleImpulse(entity, grapple)
      }
    }
    return true
  }

  startAnchorTargetGrapple(
    entity: Entity,
    grapple: NonNullable<Entity['grapple']>,
    anchorTarget: Entity,
    targetX: number,
    targetY: number
  ): boolean {
    if (!entity.input || !entity.transform) {
      return false
    }

    this.runtime.beginGrapplePull(
      entity,
      grapple,
      targetX,
      targetY,
      anchorTarget.id,
      0
    )

    grapple.pullMode = GrapplePullMode.Anchor
    if (this.runtime.tryStartPersistentTether(entity, grapple, anchorTarget)) {
      return true
    }
    grapple.isTethering = false
    grapple.isTetherSuspended = false
    this.runtime.applyGrappleImpulse(entity, grapple)
    return true
  }

  beginGrapplePull(
    entity: Entity,
    grapple: NonNullable<Entity['grapple']>,
    targetX: number,
    targetY: number,
    targetEntityId: number,
    desiredDistanceSq: number
  ): void {
    grapple.targetX = targetX
    grapple.targetY = targetY
    grapple.targetEntityId = targetEntityId
    grapple.desiredDistanceSq = desiredDistanceSq
    grapple.pullElapsedMs = 0
    grapple.isPulling = true
    grapple.cooldownEndTime = this.runtime.currentTimeMs
    if (entity.transform) {
      this.runtime.statsSystem?.playSoundAt(
        SOUND_IDS.GRAPPLE_PULL_START,
        entity.transform.x,
        entity.transform.y
      )
    }
  }

  tryStartPersistentTether(
    entity: Entity,
    grapple: NonNullable<Entity['grapple']>,
    anchorTarget: Entity
  ): boolean {
    if (entity.input?.grapplePersistentRequested !== true) {
      return false
    }

    if (this.runtime.startAnchorTether(entity, grapple, anchorTarget)) {
      grapple.pullMode = GrapplePullMode.AnchorTether
      grapple.isTethering = true
      grapple.isTetherSuspended = false
    } else {
      this.runtime.stopPull(entity, grapple, false)
    }
    return true
  }
}
