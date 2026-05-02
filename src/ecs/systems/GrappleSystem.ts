import {
  DEFAULT_GRAPPLE_ENEMY_COOLDOWN_MS,
  DEFAULT_GRAPPLE_ENEMY_STUN_EXTRA_MS,
  DEFAULT_GRAPPLE_PULL_STOP_DISTANCE,
  DEFAULT_GRAPPLE_RANGE,
  DEFAULT_GRAPPLE_ROPE_CLIMB_DAMPING_RATIO,
  DEFAULT_GRAPPLE_ROPE_CLIMB_HERTZ,
  DEFAULT_GRAPPLE_ROPE_CLIMB_JUMP_RECOIL_SCALE,
  DEFAULT_GRAPPLE_ROPE_CLIMB_LINEAR_DAMPING,
  DEFAULT_GRAPPLE_ROPE_CLIMB_WEIGHT_FORCE_SCALE,
  DEFAULT_GRAPPLE_ROPE_DAMPING_RATIO,
  DEFAULT_GRAPPLE_ROPE_DENSITY,
  DEFAULT_GRAPPLE_ROPE_HEALTH,
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
  GRAPPLE_ROPE_ELASTIC_LIMIT_DENOMINATOR,
  GRAPPLE_ROPE_ELASTIC_LIMIT_NUMERATOR,
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
import { checkOBBvsCircle } from '../OBBCollision'
import { System } from '../System'
import type { World } from '../World'
import type { StatsSystem } from './StatsSystem'

export type RopeHitWeaponState = {
  hitRopeIds: Set<number>
  groundHitSoundTriggered: boolean
  groundHitSoundPending: number
}

export type RopeHitRequest = {
  centerX: number
  centerY: number
  width: number
  height: number
  rotation: number
  renderLayer: number
  impactX: number
  impactY: number
  damage: number
  hitDirX?: number
  hitDirY?: number
  weapon?: RopeHitWeaponState
}

export type RopeCircleHitRequest = {
  centerX: number
  centerY: number
  radius: number
  renderLayer: number
  impactX: number
  impactY: number
  damage: number
  hitDirX?: number
  hitDirY?: number
  weapon?: RopeHitWeaponState
}

type RopeRuntime = {
  active: boolean
  ownerEntityId: number
  hitId: number
  health: number
  hitShakeSegmentIndex: number
  hitShakeStartTimeMs: number
  hitShakeEndTimeMs: number
  hitShakeDirX: number
  hitShakeDirY: number
  renderLayer: number
  anchorBodyId: b2BodyId | null
  anchorBodyOwned: boolean
  anchorIsDynamicTarget: boolean
  anchorEntityId: number
  anchorLocalX: number
  anchorLocalY: number
  playerAnchorBodyId: b2BodyId | null
  playerAttached: boolean
  playerTetherState: number
  playerGroundJumpActive: boolean
  airJumpDetachArmed: boolean
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

type RopeBridgeEndpointBuild = {
  entityId: number
  bodyId: b2BodyId | null
  bodyOwned: boolean
  localX: number
  localY: number
  x: number
  y: number
  renderLayer: number
  hasDynamicBody: boolean
}

type RopeBridgeRuntime = {
  active: boolean
  hitId: number
  health: number
  hitShakeSegmentIndex: number
  hitShakeStartTimeMs: number
  hitShakeEndTimeMs: number
  hitShakeDirX: number
  hitShakeDirY: number
  endpointAEntityId: number
  endpointBEntityId: number
  bodyAId: b2BodyId | null
  bodyAOwned: boolean
  bodyBId: b2BodyId | null
  bodyBOwned: boolean
  targetABodyId: b2BodyId | null
  targetBBodyId: b2BodyId | null
  endpointAHasDynamicBody: boolean
  endpointBHasDynamicBody: boolean
  localAX: number
  localAY: number
  localBX: number
  localBY: number
  followAX: number
  followAY: number
  followBX: number
  followBY: number
  renderLayer: number
  segmentCount: number
  linkLength: number
  maxRopeLength: number
  segmentBodies: b2BodyId[]
  segmentJoints: b2JointId[]
  segmentFilterJoints: b2JointId[]
  climbTuningActive: boolean
}

type RopeClimbRuntime = {
  active: boolean
  sourceType: number
  ownerEntityId: number
  playerRuntime: RopeRuntime | null
  bridgeRuntime: RopeBridgeRuntime | null
  bridgeHitId: number
  nodeIndex: number
  maxNodeIndex: number
  pathDistance: number
  normalOffset: number
  jointLength: number
  travelRemainder: number
  lastMoveStep: number
  jointId: b2JointId | null
}

export class GrappleSystem extends System {
  private readonly pullModeAnchor = 0
  private readonly pullModeNpc = 1
  private readonly pullModePlayerLinear = 2
  private readonly pullModePlayerArc = 3
  private readonly pullModeAnchorTether = 4
  private readonly pullModeObject = 5
  private readonly playerTetherStateAir = 0
  private readonly playerTetherStateGround = 1
  private readonly ropeClimbSourceNone = 0
  private readonly ropeClimbSourcePlayer = 1
  private readonly ropeClimbSourceBridge = 2
  private readonly ropeClimbInteractRadius =
    DEFAULT_PLAYER_RADIUS + DEFAULT_GRAPPLE_ROPE_SEGMENT_LENGTH * 4
  private readonly ropeClimbInteractRadiusSq =
    (DEFAULT_PLAYER_RADIUS + DEFAULT_GRAPPLE_ROPE_SEGMENT_LENGTH * 4) *
    (DEFAULT_PLAYER_RADIUS + DEFAULT_GRAPPLE_ROPE_SEGMENT_LENGTH * 4)
  private readonly ropeClimbMinJointLength = DEFAULT_GRAPPLE_ROPE_SEGMENT_RADIUS
  private readonly dynamicTetherBaseSpeed = 2
  private readonly dynamicTetherStretchSpeed = 8
  private readonly dynamicTetherMaxSpeed = 14
  private readonly dynamicTetherRopeDensity = 0.05
  private readonly maxRopesPerTetherTarget = 4
  private readonly ropeRetractTensionSlack =
    DEFAULT_GRAPPLE_ROPE_SEGMENT_RADIUS * 2
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
  private tempPointVec: b2Vec2
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
  private detachedPlayerRopes: RopeRuntime[] = []
  private ropeClimbRuntimeByEntityId = new Map<number, RopeClimbRuntime>()
  private bridgeRopes: RopeBridgeRuntime[] = []
  private nextRopeHitId = 1
  private hitRopeSegmentIndex = -1
  private hitRopeSegmentX = 0
  private hitRopeSegmentY = 0
  private climbCandidateBridgeRuntime: RopeBridgeRuntime | null = null
  private climbCandidatePlayerRuntime: RopeRuntime | null = null
  private climbCandidateNodeIndex = -1
  private climbCandidateDistSq = 0
  private climbCandidatePathDistance = 0
  private climbCandidateNormalOffset = 0
  private readonly climbPointA = { x: 0, y: 0 }
  private readonly climbPointB = { x: 0, y: 0 }
  private climbAttachX = 0
  private climbAttachY = 0
  private climbTangentX = 0
  private climbTangentY = 1
  private climbNormalX = -1
  private climbNormalY = 0
  private climbPathLength = 0
  private climbSegmentStartNodeIndex = 0
  private climbSegmentRatio = 0
  private readonly ropeHitShakeDurationMs = 220
  private readonly ropeHitShakeAmplitude = 0.24
  private readonly bridgeEndpointA: RopeBridgeEndpointBuild = {
    entityId: -1,
    bodyId: null,
    bodyOwned: false,
    localX: 0,
    localY: 0,
    x: 0,
    y: 0,
    renderLayer: 0,
    hasDynamicBody: false,
  }
  private readonly bridgeEndpointB: RopeBridgeEndpointBuild = {
    entityId: -1,
    bodyId: null,
    bodyOwned: false,
    localX: 0,
    localY: 0,
    x: 0,
    y: 0,
    renderLayer: 0,
    hasDynamicBody: false,
  }
  private ropeDensity = DEFAULT_GRAPPLE_ROPE_DENSITY
  private ropeLinearDamping = DEFAULT_GRAPPLE_ROPE_LINEAR_DAMPING
  private ropeHertz = DEFAULT_GRAPPLE_ROPE_HERTZ
  private ropeDampingRatio = DEFAULT_GRAPPLE_ROPE_DAMPING_RATIO
  private ropeClimbLinearDamping = DEFAULT_GRAPPLE_ROPE_CLIMB_LINEAR_DAMPING
  private ropeClimbHertz = DEFAULT_GRAPPLE_ROPE_CLIMB_HERTZ
  private ropeClimbDampingRatio = DEFAULT_GRAPPLE_ROPE_CLIMB_DAMPING_RATIO
  private ropeClimbWeightForceScale =
    DEFAULT_GRAPPLE_ROPE_CLIMB_WEIGHT_FORCE_SCALE
  private ropeClimbJumpRecoilScale =
    DEFAULT_GRAPPLE_ROPE_CLIMB_JUMP_RECOIL_SCALE
  private swingForce = DEFAULT_GRAPPLE_SWING_FORCE

  constructor(world: World, box2d: MainModule, worldId: b2WorldId) {
    super()
    this.world = world
    this.box2d = box2d
    this.worldId = worldId
    this.tempVec = new box2d.b2Vec2(0, 0)
    this.tempPointVec = new box2d.b2Vec2(0, 0)
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

  setRopeClimbLinearDamping(value: number): void {
    this.ropeClimbLinearDamping = Math.max(0, value)
    this.updateExistingRopeSegments()
  }

  setRopeClimbHertz(value: number): void {
    this.ropeClimbHertz = Math.max(0, value)
    this.updateExistingRopeJoints()
  }

  setRopeClimbDampingRatio(value: number): void {
    this.ropeClimbDampingRatio = Math.max(0, value)
    this.updateExistingRopeJoints()
  }

  setRopeClimbWeightForceScale(value: number): void {
    this.ropeClimbWeightForceScale = Math.max(0, value)
  }

  setRopeClimbJumpRecoilScale(value: number): void {
    this.ropeClimbJumpRecoilScale = Math.max(0, value)
  }

  setSwingForce(value: number): void {
    this.swingForce = value
  }

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
      this.stopRopeClimb(entity, grapple, true)
      return true
    }

    if (this.tryStartPlayerRopeClimb(entity, grapple)) {
      return true
    }

    if (this.tryStartDetachedPlayerRopeClimb(entity, grapple)) {
      return true
    }

    return this.tryStartBridgeRopeClimb(entity, grapple)
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

    for (let i = 0; i < this.detachedPlayerRopes.length; i++) {
      const runtime = this.detachedPlayerRopes[i]
      if (!runtime.active || runtime.anchorEntityId !== targetEntityId) {
        continue
      }
      this.destroyPlayerRopeRuntime(runtime)
    }

    this.detachBridgeRopesForTarget(targetEntityId)
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
    for (let i = 0; i < this.detachedPlayerRopes.length; i++) {
      const runtime = this.detachedPlayerRopes[i]
      if (!runtime.active) continue
      for (let j = 0; j < runtime.segmentBodies.length; j++) {
        const bodyId = runtime.segmentBodies[j]
        if (this.isBodyId(bodyId) && this.box2d.b2Body_IsValid(bodyId)) {
          this.box2d.b2Body_SetLinearDamping(bodyId, this.ropeLinearDamping)
        }
      }
    }
    this.ropeClimbRuntimeByEntityId.forEach((runtime) => {
      if (
        runtime.active &&
        this.isJointId(runtime.jointId) &&
        this.box2d.b2Joint_IsValid(runtime.jointId)
      ) {
        this.box2d.b2DistanceJoint_SetSpringHertz(
          runtime.jointId,
          this.ropeHertz
        )
        this.box2d.b2DistanceJoint_SetSpringDampingRatio(
          runtime.jointId,
          this.ropeDampingRatio
        )
      }
    })
    for (let i = 0; i < this.bridgeRopes.length; i++) {
      const runtime = this.bridgeRopes[i]
      if (!runtime.active) continue
      const linearDamping = this.getBridgeRopeLinearDamping(runtime)
      for (let j = 0; j < runtime.segmentBodies.length; j++) {
        const bodyId = runtime.segmentBodies[j]
        if (this.isBodyId(bodyId) && this.box2d.b2Body_IsValid(bodyId)) {
          this.box2d.b2Body_SetLinearDamping(bodyId, linearDamping)
        }
      }
    }
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
    for (let i = 0; i < this.detachedPlayerRopes.length; i++) {
      const runtime = this.detachedPlayerRopes[i]
      if (!runtime.active) continue
      for (let j = 0; j < runtime.segmentJoints.length; j++) {
        const jointId = runtime.segmentJoints[j]
        if (this.isJointId(jointId) && this.box2d.b2Joint_IsValid(jointId)) {
          this.box2d.b2DistanceJoint_SetSpringHertz(jointId, this.ropeHertz)
          this.box2d.b2DistanceJoint_SetSpringDampingRatio(
            jointId,
            this.ropeDampingRatio
          )
        }
      }
    }
    for (let i = 0; i < this.bridgeRopes.length; i++) {
      const runtime = this.bridgeRopes[i]
      if (!runtime.active) continue
      const hertz = this.getBridgeRopeHertz(runtime)
      const dampingRatio = this.getBridgeRopeDampingRatio(runtime)
      for (let j = 0; j < runtime.segmentJoints.length; j++) {
        const jointId = runtime.segmentJoints[j]
        if (this.isJointId(jointId) && this.box2d.b2Joint_IsValid(jointId)) {
          this.box2d.b2DistanceJoint_SetSpringHertz(jointId, hertz)
          this.box2d.b2DistanceJoint_SetSpringDampingRatio(
            jointId,
            dampingRatio
          )
        }
      }
    }
  }

  private getBridgeRopeLinearDamping(runtime: RopeBridgeRuntime): number {
    return runtime.climbTuningActive
      ? this.ropeClimbLinearDamping
      : this.ropeLinearDamping
  }

  private getBridgeRopeHertz(runtime: RopeBridgeRuntime): number {
    return runtime.climbTuningActive ? this.ropeClimbHertz : this.ropeHertz
  }

  private getBridgeRopeDampingRatio(runtime: RopeBridgeRuntime): number {
    return runtime.climbTuningActive
      ? this.ropeClimbDampingRatio
      : this.ropeDampingRatio
  }

  private setBridgeRopeClimbTuning(
    runtime: RopeBridgeRuntime,
    active: boolean
  ): void {
    if (runtime.climbTuningActive === active) {
      return
    }

    runtime.climbTuningActive = active
    this.updateBridgeRopeSegmentDamping(runtime)
    this.updateBridgeRopeJointTuning(runtime)
  }

  private updateBridgeRopeSegmentDamping(runtime: RopeBridgeRuntime): void {
    const linearDamping = this.getBridgeRopeLinearDamping(runtime)
    for (let i = 0; i < runtime.segmentBodies.length; i++) {
      const bodyId = runtime.segmentBodies[i]
      if (this.isBodyId(bodyId) && this.box2d.b2Body_IsValid(bodyId)) {
        this.box2d.b2Body_SetLinearDamping(bodyId, linearDamping)
      }
    }
  }

  private updateBridgeRopeJointTuning(runtime: RopeBridgeRuntime): void {
    const hertz = this.getBridgeRopeHertz(runtime)
    const dampingRatio = this.getBridgeRopeDampingRatio(runtime)
    for (let i = 0; i < runtime.segmentJoints.length; i++) {
      const jointId = runtime.segmentJoints[i]
      if (!this.isJointId(jointId) || !this.box2d.b2Joint_IsValid(jointId)) {
        continue
      }
      this.box2d.b2DistanceJoint_SetSpringHertz(jointId, hertz)
      this.box2d.b2DistanceJoint_SetSpringDampingRatio(jointId, dampingRatio)
    }
  }

  update(entities: Entity[], deltaTime: number): void {
    const deltaMs = Math.max(0, deltaTime * 1000)
    this.currentTimeMs += deltaMs

    if (this.anchorsDirty) {
      this.refreshAnchorCache()
    }

    this.updateBridgeRopes(deltaMs)
    this.updateDetachedPlayerRopes(deltaMs)

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
      const currentTargetX = grapple.isTethering ? grapple.targetX : undefined
      const currentTargetY = grapple.isTethering ? grapple.targetY : undefined
      grapple.hasAnchorNearby =
        this.findAnchorTarget(
          entity.transform.x,
          entity.transform.y,
          facing,
          this.tempTarget,
          entity.render?.renderLayer ?? 0,
          currentTargetX,
          currentTargetY
        ) !== null

      if (!grapple.hasGrapple) {
        if (grapple.isRopeClimbing) {
          this.stopRopeClimb(entity, grapple, false)
        }
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
        if (grapple.isRopeClimbing) {
          this.stopRopeClimb(entity, grapple, true)
        } else {
          this.stopPull(entity, grapple, false)
        }
        entity.input.grappleLengthAdjustSteps = 0
        continue
      }

      if (entity.isStunned()) {
        if (grapple.isRopeClimbing) {
          this.stopRopeClimb(entity, grapple, true)
        } else {
          this.stopPull(entity, grapple, false)
        }
        entity.input.grappleLengthAdjustSteps = 0
        continue
      }

      if (grapple.isRopeClimbing) {
        this.updateRopeClimb(entity, grapple, deltaMs)
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
        if (entity.input.grapplePersistentRequested) {
          if (this.transferTetherToSelectedTarget(entity, grapple)) {
            inputBuffer.clearAction('grapple')
            continue
          }
          inputBuffer.clearAction('grapple')
          continue
        }
        const previousTargetX = grapple.targetX
        const previousTargetY = grapple.targetY
        const shouldStartPullAfterDetach =
          entity.input.lockedTargetId !== null || grapple.hasAnchorNearby
        const runtime = this.ropeRuntimeByEntityId.get(entity.id)
        if (runtime?.active === true && runtime.playerAttached) {
          // 这里的“地面状态”不是 movement.isGrounded，而是绳索还没有将角色悬空吊起。
          // 它包含落地和从地面起跳后的跟随阶段；此时新拉取会快速移动身体，
          // 旧绳索的跟随端可能追不上，因此启动新拉取前直接销毁旧绳索。
          const shouldDestroyCurrentTether =
            runtime.anchorIsDynamicTarget ||
            (shouldStartPullAfterDetach &&
              !this.isPlayerTetherSuspended(entity, grapple, runtime))
          this.detachPlayerFromTether(
            entity,
            grapple,
            runtime,
            false,
            shouldDestroyCurrentTether
          )
        }
        if (shouldStartPullAfterDetach) {
          this.tryStartGrappleAction(
            entity,
            grapple,
            previousTargetX,
            previousTargetY
          )
        }
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

      this.tryStartGrappleAction(entity, grapple)
      inputBuffer.clearAction('grapple')
    }
  }

  private tryStartGrappleAction(
    entity: Entity,
    grapple: NonNullable<Entity['grapple']>,
    excludedTargetX?: number,
    excludedTargetY?: number
  ): boolean {
    if (!entity.input || !entity.transform) {
      return false
    }

    const lockedTargetId = entity.input.lockedTargetId
    if (lockedTargetId !== null) {
      const lockedTarget = this.getEntityById(lockedTargetId)
      if (!lockedTarget || !this.canUseLockedTarget(entity, lockedTarget)) {
        return false
      }
      return this.startLockedTargetGrapple(entity, grapple, lockedTarget)
    }

    const facing =
      entity.input.lastMoveDirection !== 0 ? entity.input.lastMoveDirection : 1
    const anchorTarget = this.findAnchorTarget(
      entity.transform.x,
      entity.transform.y,
      facing,
      this.tempTarget,
      entity.render?.renderLayer ?? 0,
      excludedTargetX,
      excludedTargetY
    )
    if (!anchorTarget) {
      return false
    }

    return this.startAnchorTargetGrapple(
      entity,
      grapple,
      anchorTarget,
      this.tempTarget.x,
      this.tempTarget.y
    )
  }

  private startLockedTargetGrapple(
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
    if (distSq > this.rangeSq) {
      return false
    }

    const playerToughness = entity.stats?.toughness ?? 0
    const targetToughness = this.getTargetToughness(lockedTarget)
    const desiredDistance = this.getAttackDistance(entity, lockedTarget)
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

    if (lockedTarget.grappleAnchor) {
      if (entity.input.grapplePersistentRequested) {
        if (this.startAnchorTether(entity, grapple, lockedTarget)) {
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
      return true
    }

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
      return true
    }

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
    return true
  }

  private startAnchorTargetGrapple(
    entity: Entity,
    grapple: NonNullable<Entity['grapple']>,
    anchorTarget: Entity,
    targetX: number,
    targetY: number
  ): boolean {
    if (!entity.input || !entity.transform) {
      return false
    }

    grapple.targetX = targetX
    grapple.targetY = targetY
    grapple.targetEntityId = anchorTarget.id
    grapple.desiredDistanceSq = 0
    grapple.pullElapsedMs = 0
    grapple.isPulling = true
    grapple.cooldownEndTime = this.currentTimeMs
    this.statsSystem?.playSoundAt(
      SOUND_IDS.GRAPPLE_PULL_START,
      entity.transform.x,
      entity.transform.y
    )

    grapple.pullMode = this.pullModeAnchor
    if (entity.input.grapplePersistentRequested) {
      if (this.startAnchorTether(entity, grapple, anchorTarget)) {
        grapple.pullMode = this.pullModeAnchorTether
        grapple.isTethering = true
      } else {
        this.stopPull(entity, grapple, false)
      }
    } else {
      grapple.isTethering = false
      this.applyGrappleImpulse(entity, grapple)
    }
    return true
  }

  writeActiveRopePoints(
    entity: Entity,
    targetBuffer: Float32Array<ArrayBufferLike>,
    startOffset: number,
    maxPoints: number
  ): number {
    if (maxPoints < 2) {
      return 0
    }

    let pointCount = 0
    pointCount = this.writePlayerRopePoints(
      entity,
      this.ropeRuntimeByEntityId.get(entity.id) ?? null,
      targetBuffer,
      startOffset,
      maxPoints,
      pointCount
    )

    for (let i = 0; i < this.detachedPlayerRopes.length; i++) {
      if (pointCount >= maxPoints) break
      const runtime = this.detachedPlayerRopes[i]
      if (!runtime.active) continue
      pointCount = this.writePlayerRopePoints(
        entity,
        runtime,
        targetBuffer,
        startOffset,
        maxPoints,
        pointCount
      )
    }

    for (let i = 0; i < this.bridgeRopes.length; i++) {
      if (pointCount >= maxPoints) break
      const runtime = this.bridgeRopes[i]
      if (!runtime.active) continue
      pointCount = this.writeBridgeRopePoints(
        runtime,
        targetBuffer,
        startOffset,
        maxPoints,
        pointCount
      )
    }

    return pointCount
  }

  private writePlayerRopePoints(
    entity: Entity,
    runtime: RopeRuntime | null,
    targetBuffer: Float32Array<ArrayBufferLike>,
    startOffset: number,
    maxPoints: number,
    pointCount: number
  ): number {
    const grapple = entity.grapple
    if (!runtime || !runtime.active) {
      return pointCount
    }
    const climbRuntime = this.findPlayerRopeClimbRuntime(runtime)
    const isPlayerRopeClimbing =
      climbRuntime?.active === true &&
      climbRuntime.sourceType === this.ropeClimbSourcePlayer

    if (pointCount > 0) {
      if (pointCount >= maxPoints) return pointCount
      this.writeRopeBreak(targetBuffer, startOffset, pointCount)
      pointCount += 1
    }

    let outOffset = startOffset + pointCount * 2

    if (!this.writePlayerRopeAnchorPoint(runtime, targetBuffer, outOffset)) {
      return pointCount
    }
    pointCount += 1
    outOffset += 2

    const visibleCount = isPlayerRopeClimbing
      ? climbRuntime.maxNodeIndex
      : runtime.attachIndex + 1
    const reservedEndPointCount = isPlayerRopeClimbing
      ? maxPoints
      : maxPoints - 1
    for (
      let i = 0;
      i < visibleCount && pointCount < reservedEndPointCount;
      i++
    ) {
      const bodyId = runtime.segmentBodies[i]
      if (!this.isBodyId(bodyId) || !this.box2d.b2Body_IsValid(bodyId)) {
        continue
      }
      const pos = this.box2d.b2Body_GetPosition(bodyId)
      this.writeRopeSegmentPoint(
        runtime,
        i,
        pos.x,
        pos.y,
        targetBuffer,
        outOffset
      )
      pointCount += 1
      outOffset += 2
      pos.delete()
    }

    if (
      runtime.playerAttached &&
      !isPlayerRopeClimbing &&
      runtime.ownerEntityId === entity.id &&
      entity.transform &&
      pointCount < maxPoints
    ) {
      targetBuffer[outOffset] = entity.transform.x
      targetBuffer[outOffset + 1] = entity.transform.y
      pointCount += 1
    }

    return pointCount
  }

  private writePlayerRopeAnchorPoint(
    runtime: RopeRuntime,
    targetBuffer: Float32Array<ArrayBufferLike>,
    outOffset: number
  ): boolean {
    if (!this.readBodyPosition(runtime.anchorBodyId, this.climbPointA)) {
      return false
    }
    targetBuffer[outOffset] = this.climbPointA.x
    targetBuffer[outOffset + 1] = this.climbPointA.y
    return true
  }

  private writeBridgeRopePoints(
    runtime: RopeBridgeRuntime,
    targetBuffer: Float32Array<ArrayBufferLike>,
    startOffset: number,
    maxPoints: number,
    pointCount: number
  ): number {
    const entityA = this.getEntityById(runtime.endpointAEntityId)
    const entityB = this.getEntityById(runtime.endpointBEntityId)
    if (!entityA?.transform || !entityB?.transform) {
      return pointCount
    }

    if (pointCount > 0) {
      if (pointCount >= maxPoints) return pointCount
      this.writeRopeBreak(targetBuffer, startOffset, pointCount)
      pointCount += 1
    }

    let outOffset = startOffset + pointCount * 2
    targetBuffer[outOffset] = entityA.transform.x
    targetBuffer[outOffset + 1] = entityA.transform.y
    pointCount += 1
    outOffset += 2

    for (let i = 0; i < runtime.segmentBodies.length; i++) {
      if (pointCount >= maxPoints - 1) break
      const bodyId = runtime.segmentBodies[i]
      if (!this.isBodyId(bodyId) || !this.box2d.b2Body_IsValid(bodyId)) {
        continue
      }
      const pos = this.box2d.b2Body_GetPosition(bodyId)
      this.writeRopeSegmentPoint(
        runtime,
        i,
        pos.x,
        pos.y,
        targetBuffer,
        outOffset
      )
      pointCount += 1
      outOffset += 2
      pos.delete()
    }

    if (pointCount < maxPoints) {
      targetBuffer[outOffset] = entityB.transform.x
      targetBuffer[outOffset + 1] = entityB.transform.y
      pointCount += 1
    }

    return pointCount
  }

  private writeRopeBreak(
    targetBuffer: Float32Array<ArrayBufferLike>,
    startOffset: number,
    pointCount: number
  ): void {
    const outOffset = startOffset + pointCount * 2
    targetBuffer[outOffset] = Number.NaN
    targetBuffer[outOffset + 1] = Number.NaN
  }

  private writeRopeSegmentPoint(
    runtime: RopeRuntime | RopeBridgeRuntime,
    segmentIndex: number,
    x: number,
    y: number,
    targetBuffer: Float32Array<ArrayBufferLike>,
    outOffset: number
  ): void {
    if (
      segmentIndex === runtime.hitShakeSegmentIndex &&
      this.currentTimeMs < runtime.hitShakeEndTimeMs
    ) {
      const elapsedMs = this.currentTimeMs - runtime.hitShakeStartTimeMs
      const progress = Math.min(
        1,
        Math.max(0, elapsedMs / this.ropeHitShakeDurationMs)
      )
      const amplitude =
        this.ropeHitShakeAmplitude * Math.sin(progress * Math.PI)
      targetBuffer[outOffset] = x + runtime.hitShakeDirX * amplitude
      targetBuffer[outOffset + 1] = y + runtime.hitShakeDirY * amplitude
      return
    }

    targetBuffer[outOffset] = x
    targetBuffer[outOffset + 1] = y
  }

  private resetRopeHitShake(runtime: RopeRuntime | RopeBridgeRuntime): void {
    runtime.hitShakeSegmentIndex = -1
    runtime.hitShakeStartTimeMs = 0
    runtime.hitShakeEndTimeMs = 0
    runtime.hitShakeDirX = 0
    runtime.hitShakeDirY = 0
  }

  private getDefaultRopeHealth(): number {
    return Math.max(1, Math.trunc(DEFAULT_GRAPPLE_ROPE_HEALTH))
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
  ): Entity | null {
    let bestDistSq = this.rangeSq + 1
    let bestTarget: Entity | null = null
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
        bestTarget = anchor
      }
    }

    if (bestTarget?.transform) {
      out.x = bestTarget.transform.x
      out.y = bestTarget.transform.y
      return bestTarget
    }

    return null
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
    if (grapple.isRopeClimbing) {
      this.stopRopeClimb(entity, grapple, false)
    }

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

  private areBodyIdsEqual(a: b2BodyId, b: b2BodyId): boolean {
    return (
      a.index1 === b.index1 &&
      a.world0 === b.world0 &&
      a.generation === b.generation
    )
  }

  private writeGrappleTargetWorldPoint(
    entity: Entity,
    bodyId: b2BodyId,
    localX: number,
    localY: number,
    out: { x: number; y: number }
  ): void {
    const transform = entity.transform
    if (!transform) {
      out.x = 0
      out.y = 0
      return
    }

    out.x = transform.x
    out.y = transform.y
    const physicsBodyId = entity.physics?.bodyId
    if (
      !this.isBodyId(physicsBodyId) ||
      !this.areBodyIdsEqual(physicsBodyId, bodyId) ||
      (localX === 0 && localY === 0)
    ) {
      return
    }

    const cos = Math.cos(transform.rotation)
    const sin = Math.sin(transform.rotation)
    out.x = transform.x + localX * cos - localY * sin
    out.y = transform.y + localX * sin + localY * cos
  }

  private applyBodyVelocityCorrectionAtPoint(
    bodyId: b2BodyId,
    pointX: number,
    pointY: number,
    dirX: number,
    dirY: number,
    targetAlong: number
  ): void {
    if (!this.box2d.b2Body_IsValid(bodyId)) {
      return
    }

    const mass = this.box2d.b2Body_GetMass(bodyId)
    if (!(mass > 0)) {
      return
    }

    const currentVel = this.box2d.b2Body_GetLinearVelocity(bodyId)
    const currentAlong = currentVel.x * dirX + currentVel.y * dirY
    if (currentAlong >= targetAlong) {
      currentVel.delete()
      return
    }

    const addSpeed = targetAlong - currentAlong
    this.tempVec.x = dirX * addSpeed * mass
    this.tempVec.y = dirY * addSpeed * mass
    this.tempPointVec.x = pointX
    this.tempPointVec.y = pointY
    this.box2d.b2Body_ApplyLinearImpulse(
      bodyId,
      this.tempVec,
      this.tempPointVec,
      true
    )
    currentVel.delete()
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
    if (target.grappleAnchor) {
      return true
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
      playerTetherState: this.playerTetherStateAir,
      playerGroundJumpActive: false,
      airJumpDetachArmed: true,
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

  private prepareNewAnchorTetherRuntime(
    entity: Entity,
    grapple: NonNullable<Entity['grapple']>
  ): RopeRuntime {
    const activeRuntime = this.ropeRuntimeByEntityId.get(entity.id)
    if (activeRuntime?.active === true) {
      this.detachPlayerFromTether(entity, grapple, activeRuntime, false)
    }
    return this.getOrCreateRopeRuntime(entity.id)
  }

  private canCreateRopeOnTarget(
    targetEntityId: number,
    ignoredPlayerRuntime: RopeRuntime | null = null,
    ignoredBridgeRuntime: RopeBridgeRuntime | null = null
  ): boolean {
    if (targetEntityId < 0) {
      return true
    }

    return (
      this.getRopeCountForTarget(
        targetEntityId,
        ignoredPlayerRuntime,
        ignoredBridgeRuntime
      ) < this.maxRopesPerTetherTarget
    )
  }

  private getRopeCountForTarget(
    targetEntityId: number,
    ignoredPlayerRuntime: RopeRuntime | null,
    ignoredBridgeRuntime: RopeBridgeRuntime | null
  ): number {
    let count = 0

    for (const runtime of this.ropeRuntimeByEntityId.values()) {
      if (
        runtime !== ignoredPlayerRuntime &&
        runtime.active &&
        runtime.anchorEntityId === targetEntityId
      ) {
        count++
      }
    }

    for (let i = 0; i < this.detachedPlayerRopes.length; i++) {
      const runtime = this.detachedPlayerRopes[i]
      if (
        runtime !== ignoredPlayerRuntime &&
        runtime.active &&
        runtime.anchorEntityId === targetEntityId
      ) {
        count++
      }
    }

    for (let i = 0; i < this.bridgeRopes.length; i++) {
      const runtime = this.bridgeRopes[i]
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

  private getOrCreateRopeClimbRuntime(entityId: number): RopeClimbRuntime {
    const existing = this.ropeClimbRuntimeByEntityId.get(entityId)
    if (existing) {
      return existing
    }
    const runtime: RopeClimbRuntime = {
      active: false,
      sourceType: this.ropeClimbSourceNone,
      ownerEntityId: -1,
      playerRuntime: null,
      bridgeRuntime: null,
      bridgeHitId: 0,
      nodeIndex: 0,
      maxNodeIndex: 0,
      pathDistance: 0,
      normalOffset: 0,
      jointLength: this.ropeClimbMinJointLength,
      travelRemainder: 0,
      lastMoveStep: 0,
      jointId: null,
    }
    this.ropeClimbRuntimeByEntityId.set(entityId, runtime)
    return runtime
  }

  private tryStartPlayerRopeClimb(
    entity: Entity,
    grapple: NonNullable<Entity['grapple']>
  ): boolean {
    const runtime = this.ropeRuntimeByEntityId.get(entity.id)
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
    const nodeIndex = this.findNearestPlayerRopeNode(
      runtime,
      entity.transform.x,
      entity.transform.y,
      maxNodeIndex,
      Number.POSITIVE_INFINITY
    )
    if (nodeIndex < 0) {
      return false
    }

    this.destroyJointIfValid(runtime.playerJointId)
    runtime.playerJointId = null

    const radius = entity.render?.radius ?? DEFAULT_PLAYER_RADIUS
    const jointLength = Math.max(
      this.ropeClimbMinJointLength,
      Math.min(radius, runtime.jointMaxLen)
    )
    return this.startRopeClimb(
      entity,
      grapple,
      this.ropeClimbSourcePlayer,
      entity.id,
      runtime,
      null,
      nodeIndex,
      maxNodeIndex,
      jointLength
    )
  }

  private tryStartDetachedPlayerRopeClimb(
    entity: Entity,
    grapple: NonNullable<Entity['grapple']>
  ): boolean {
    if (!entity.transform || grapple.isPulling || grapple.isTethering) {
      return false
    }

    this.findNearestDetachedPlayerRopeNode(
      entity.transform.x,
      entity.transform.y,
      entity.render?.renderLayer ?? 0
    )
    const runtime = this.climbCandidatePlayerRuntime
    if (!runtime || this.climbCandidateNodeIndex < 0) {
      return false
    }

    const maxNodeIndex = Math.max(
      0,
      Math.min(runtime.attachIndex + 1, runtime.segmentBodies.length)
    )
    const radius = entity.render?.radius ?? DEFAULT_PLAYER_RADIUS
    if (
      !this.startRopeClimb(
        entity,
        grapple,
        this.ropeClimbSourcePlayer,
        runtime.ownerEntityId,
        runtime,
        null,
        this.climbCandidateNodeIndex,
        maxNodeIndex,
        radius
      )
    ) {
      return false
    }

    if (this.readBodyPosition(runtime.anchorBodyId, this.climbPointA)) {
      grapple.targetX = this.climbPointA.x
      grapple.targetY = this.climbPointA.y
    }
    return true
  }

  private tryStartBridgeRopeClimb(
    entity: Entity,
    grapple: NonNullable<Entity['grapple']>
  ): boolean {
    if (!entity.transform || grapple.isPulling || grapple.isTethering) {
      return false
    }

    this.findNearestBridgeRopePoint(
      entity.transform.x,
      entity.transform.y,
      entity.render?.renderLayer ?? 0
    )
    const bridgeRuntime = this.climbCandidateBridgeRuntime
    if (!bridgeRuntime || this.climbCandidateNodeIndex < 0) {
      return false
    }

    const maxNodeIndex = bridgeRuntime.segmentBodies.length + 1
    return this.startRopeClimb(
      entity,
      grapple,
      this.ropeClimbSourceBridge,
      -1,
      null,
      bridgeRuntime,
      this.climbCandidateNodeIndex,
      maxNodeIndex,
      entity.render?.radius ?? DEFAULT_PLAYER_RADIUS,
      this.climbCandidatePathDistance,
      this.climbCandidateNormalOffset
    )
  }

  private startRopeClimb(
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
    const climbRuntime = this.getOrCreateRopeClimbRuntime(entity.id)
    this.destroyRopeClimbJoint(climbRuntime)

    climbRuntime.active = true
    climbRuntime.sourceType = sourceType
    climbRuntime.ownerEntityId = ownerEntityId
    climbRuntime.playerRuntime = playerRuntime
    climbRuntime.bridgeRuntime = bridgeRuntime
    climbRuntime.bridgeHitId = bridgeRuntime?.hitId ?? 0
    climbRuntime.nodeIndex = Math.max(0, Math.min(nodeIndex, maxNodeIndex))
    climbRuntime.maxNodeIndex = Math.max(0, maxNodeIndex)
    climbRuntime.pathDistance = pathDistance
    const normalLimit = Math.max(jointLength, this.ropeClimbMinJointLength)
    climbRuntime.normalOffset =
      normalOffset < -normalLimit
        ? -normalLimit
        : normalOffset > normalLimit
          ? normalLimit
          : normalOffset
    climbRuntime.jointLength = Math.max(
      this.ropeClimbMinJointLength,
      jointLength
    )
    climbRuntime.travelRemainder = 0
    climbRuntime.lastMoveStep = 0

    if (sourceType === this.ropeClimbSourceBridge) {
      if (
        !bridgeRuntime ||
        !this.resolveBridgeRopePoint(bridgeRuntime, climbRuntime.pathDistance)
      ) {
        this.resetRopeClimbRuntime(climbRuntime)
        return false
      }
      this.setBridgeRopeClimbTuning(bridgeRuntime, true)
    } else {
      if (!this.rebuildRopeClimbJoint(entity, climbRuntime)) {
        this.resetRopeClimbRuntime(climbRuntime)
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
    if (sourceType === this.ropeClimbSourceBridge) {
      grapple.isPulling = false
      grapple.isTethering = false
      grapple.pullMode = this.pullModeAnchor
      grapple.targetEntityId = -1
      grapple.desiredDistanceSq = 0
    }
    entity.input!.grappleLengthAdjustSteps = 0
    return true
  }

  private updateRopeClimb(
    entity: Entity,
    grapple: NonNullable<Entity['grapple']>,
    deltaMs: number
  ): void {
    if (!entity.input) {
      this.stopRopeClimb(entity, grapple, true)
      return
    }

    const climbRuntime = this.ropeClimbRuntimeByEntityId.get(entity.id)
    if (!climbRuntime?.active) {
      grapple.isRopeClimbing = false
      grapple.ropeClimbSource = this.ropeClimbSourceNone
      return
    }

    if (this.tryPerformRopeClimbJump(entity, grapple, climbRuntime)) {
      return
    }

    entity.input.grappleLengthAdjustSteps = 0
    if (climbRuntime.sourceType === this.ropeClimbSourcePlayer) {
      this.updatePlayerRopeClimb(entity, grapple, climbRuntime, deltaMs)
      return
    }
    if (climbRuntime.sourceType === this.ropeClimbSourceBridge) {
      this.updateBridgeRopeClimb(entity, grapple, climbRuntime, deltaMs)
      return
    }

    this.stopRopeClimb(entity, grapple, false)
  }

  private updatePlayerRopeClimb(
    entity: Entity,
    grapple: NonNullable<Entity['grapple']>,
    climbRuntime: RopeClimbRuntime,
    deltaMs: number
  ): void {
    const runtime =
      climbRuntime.playerRuntime ?? this.ropeRuntimeByEntityId.get(entity.id)
    if (!runtime?.active) {
      this.stopRopeClimb(entity, grapple, true)
      return
    }

    const isCurrentAttachedRope =
      runtime.playerAttached &&
      this.ropeRuntimeByEntityId.get(entity.id) === runtime
    if (isCurrentAttachedRope) {
      if (!grapple.isPulling || !grapple.isTethering) {
        this.stopRopeClimb(entity, grapple, true)
        return
      }
      if (!this.syncTetherAnchorTarget(runtime, grapple)) {
        this.stopRopeClimb(entity, grapple, true)
        return
      }
    } else {
      if (!this.syncDetachedPlayerRopeAnchor(runtime, deltaMs)) {
        this.stopRopeClimb(entity, grapple, false)
        return
      }
      if (this.readBodyPosition(runtime.anchorBodyId, this.climbPointA)) {
        grapple.targetX = this.climbPointA.x
        grapple.targetY = this.climbPointA.y
      }
    }

    this.handleRopeNodeSwingInput(entity, climbRuntime, deltaMs)
    if (
      !this.advanceRopeClimb(entity, climbRuntime, runtime.linkLength, deltaMs)
    ) {
      this.stopRopeClimb(entity, grapple, true)
    }
  }

  private updateBridgeRopeClimb(
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
      this.stopRopeClimb(entity, grapple, false)
      return
    }

    if (
      !this.syncBridgeRopeClimbAttachment(
        entity,
        bridgeRuntime,
        climbRuntime,
        deltaMs
      )
    ) {
      this.stopRopeClimb(entity, grapple, false)
    }
  }

  private tryPerformRopeClimbJump(
    entity: Entity,
    grapple: NonNullable<Entity['grapple']>,
    climbRuntime: RopeClimbRuntime
  ): boolean {
    if (!entity.input?.inputBuffer.hasActiveAction('jump')) {
      return false
    }

    entity.input.inputBuffer.clearAction('jump')
    entity.input.jumpRequested = false

    if (climbRuntime.sourceType === this.ropeClimbSourceBridge) {
      this.performBridgeRopeClimbJump(entity, climbRuntime)
      this.stopRopeClimb(entity, grapple, false)
      return true
    }

    const playerRuntime = climbRuntime.playerRuntime
    this.stopRopeClimb(entity, grapple, true)
    if (playerRuntime?.active === true && !playerRuntime.playerAttached) {
      this.destroyPlayerRopeRuntime(playerRuntime)
    }
    this.performRopeJump(entity, grapple)
    return true
  }

  private performBridgeRopeClimbJump(
    entity: Entity,
    climbRuntime: RopeClimbRuntime
  ): void {
    if (!entity.physics || !entity.movement || !entity.transform) {
      return
    }

    const runtime = climbRuntime.bridgeRuntime
    if (
      this.ropeClimbJumpRecoilScale > 0 &&
      runtime?.active === true &&
      runtime.hitId === climbRuntime.bridgeHitId &&
      this.resolveBridgeRopePoint(runtime, climbRuntime.pathDistance)
    ) {
      const mass = this.box2d.b2Body_GetMass(entity.physics.bodyId)
      const jumpDeltaY =
        (-entity.movement.jumpForce * this.ropeJumpBaseUpwardScale) /
        this.ropeJumpScale
      this.applyBridgeRopePointImpulse(
        runtime,
        0,
        -jumpDeltaY * mass * this.ropeClimbJumpRecoilScale
      )
    }

    this.startRopeJumpMotion(entity)
  }

  private advanceRopeClimb(
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
      if (climbRuntime.sourceType === this.ropeClimbSourceBridge) {
        if (!this.isRopeClimbNodeValid(climbRuntime)) {
          return false
        }
      } else {
        if (!this.rebuildRopeClimbJoint(entity, climbRuntime)) {
          return false
        }
      }
    }
    return true
  }

  private stopRopeClimb(
    entity: Entity,
    grapple: NonNullable<Entity['grapple']>,
    destroyOwnedRope: boolean
  ): void {
    const climbRuntime = this.ropeClimbRuntimeByEntityId.get(entity.id)
    const sourceType =
      climbRuntime?.active === true
        ? climbRuntime.sourceType
        : grapple.ropeClimbSource
    const bridgeRuntime =
      climbRuntime?.active === true &&
      climbRuntime.sourceType === this.ropeClimbSourceBridge
        ? climbRuntime.bridgeRuntime
        : null

    if (climbRuntime) {
      this.destroyRopeClimbJoint(climbRuntime)
      this.resetRopeClimbRuntime(climbRuntime)
    }

    grapple.isRopeClimbing = false
    grapple.ropeClimbSource = this.ropeClimbSourceNone
    if (sourceType === this.ropeClimbSourceBridge) {
      grapple.retainAirMomentum = true
      if (
        bridgeRuntime?.active === true &&
        !this.hasActiveBridgeRopeClimber(bridgeRuntime)
      ) {
        this.setBridgeRopeClimbTuning(bridgeRuntime, false)
      }
    }

    if (
      destroyOwnedRope &&
      sourceType === this.ropeClimbSourcePlayer &&
      grapple.isTethering
    ) {
      this.stopPull(entity, grapple, false)
    }
  }

  private resetRopeClimbRuntime(runtime: RopeClimbRuntime): void {
    runtime.active = false
    runtime.sourceType = this.ropeClimbSourceNone
    runtime.ownerEntityId = -1
    runtime.playerRuntime = null
    runtime.bridgeRuntime = null
    runtime.bridgeHitId = 0
    runtime.nodeIndex = 0
    runtime.maxNodeIndex = 0
    runtime.pathDistance = 0
    runtime.normalOffset = 0
    runtime.jointLength = this.ropeClimbMinJointLength
    runtime.travelRemainder = 0
    runtime.lastMoveStep = 0
    runtime.jointId = null
  }

  private destroyRopeClimbJoint(runtime: RopeClimbRuntime): void {
    this.destroyJointIfValid(runtime.jointId)
    runtime.jointId = null
  }

  private rebuildRopeClimbJoint(
    entity: Entity,
    climbRuntime: RopeClimbRuntime
  ): boolean {
    if (!entity.physics) {
      return false
    }

    const nodeBodyId = this.getRopeClimbNodeBody(climbRuntime)
    if (!this.isBodyId(nodeBodyId) || !this.box2d.b2Body_IsValid(nodeBodyId)) {
      return false
    }

    this.destroyRopeClimbJoint(climbRuntime)
    climbRuntime.jointId = this.createFixedDistanceJoint(
      nodeBodyId,
      entity.physics.bodyId,
      climbRuntime.jointLength
    )
    return true
  }

  private isRopeClimbNodeValid(climbRuntime: RopeClimbRuntime): boolean {
    const nodeBodyId = this.getRopeClimbNodeBody(climbRuntime)
    return this.isBodyId(nodeBodyId) && this.box2d.b2Body_IsValid(nodeBodyId)
  }

  private syncBridgeRopeClimbAttachment(
    entity: Entity,
    runtime: RopeBridgeRuntime,
    climbRuntime: RopeClimbRuntime,
    deltaMs: number
  ): boolean {
    if (!entity.input || !entity.physics || !entity.transform) {
      return false
    }

    if (!this.resolveBridgeRopePoint(runtime, climbRuntime.pathDistance)) {
      return false
    }
    if (climbRuntime.pathDistance > this.climbPathLength) {
      climbRuntime.pathDistance = this.climbPathLength
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
      const alongInput = dirX * this.climbTangentX + dirY * this.climbTangentY
      const normalInput = dirX * this.climbNormalX + dirY * this.climbNormalY
      climbRuntime.pathDistance += alongInput * GRAPPLE_CLIMB_SPEED * deltaSec
      if (climbRuntime.pathDistance < 0) {
        climbRuntime.pathDistance = 0
      } else if (climbRuntime.pathDistance > this.climbPathLength) {
        climbRuntime.pathDistance = this.climbPathLength
      }

      const normalLimit = Math.max(
        entity.render?.radius ?? DEFAULT_PLAYER_RADIUS,
        this.ropeClimbMinJointLength
      )
      climbRuntime.normalOffset += normalInput * GRAPPLE_CLIMB_SPEED * deltaSec
      if (climbRuntime.normalOffset < -normalLimit) {
        climbRuntime.normalOffset = -normalLimit
      } else if (climbRuntime.normalOffset > normalLimit) {
        climbRuntime.normalOffset = normalLimit
      }
    }

    if (!this.resolveBridgeRopePoint(runtime, climbRuntime.pathDistance)) {
      return false
    }

    this.applyBridgeRopeClimbWeight(entity, runtime)

    const targetX =
      this.climbAttachX + this.climbNormalX * climbRuntime.normalOffset
    const targetY =
      this.climbAttachY + this.climbNormalY * climbRuntime.normalOffset
    const invDelta = deltaMs > 0 ? 1000 / deltaMs : 0

    this.tempVec.x = (targetX - entity.transform.x) * invDelta
    this.tempVec.y = (targetY - entity.transform.y) * invDelta
    this.box2d.b2Body_SetLinearVelocity(entity.physics.bodyId, this.tempVec)
    return true
  }

  private applyBridgeRopeClimbWeight(
    entity: Entity,
    runtime: RopeBridgeRuntime
  ): void {
    if (!entity.physics) {
      return
    }

    const mass = this.box2d.b2Body_GetMass(entity.physics.bodyId)
    if (!(mass > 0)) {
      return
    }

    this.applyBridgeRopePointForce(
      runtime,
      0,
      mass * DEFAULT_GRAVITY * this.ropeClimbWeightForceScale
    )
  }

  private hasActiveBridgeRopeClimber(runtime: RopeBridgeRuntime): boolean {
    for (const climbRuntime of this.ropeClimbRuntimeByEntityId.values()) {
      if (
        climbRuntime.active &&
        climbRuntime.sourceType === this.ropeClimbSourceBridge &&
        climbRuntime.bridgeRuntime === runtime
      ) {
        return true
      }
    }
    return false
  }

  private applyBridgeRopePointForce(
    runtime: RopeBridgeRuntime,
    forceX: number,
    forceY: number
  ): void {
    const startWeight = 1 - this.climbSegmentRatio
    const endWeight = this.climbSegmentRatio
    this.applyBridgeRopeNodeForce(
      runtime,
      this.climbSegmentStartNodeIndex,
      forceX * startWeight,
      forceY * startWeight
    )
    this.applyBridgeRopeNodeForce(
      runtime,
      this.climbSegmentStartNodeIndex + 1,
      forceX * endWeight,
      forceY * endWeight
    )
  }

  private applyBridgeRopePointImpulse(
    runtime: RopeBridgeRuntime,
    impulseX: number,
    impulseY: number
  ): void {
    const startWeight = 1 - this.climbSegmentRatio
    const endWeight = this.climbSegmentRatio
    this.applyBridgeRopeNodeImpulse(
      runtime,
      this.climbSegmentStartNodeIndex,
      impulseX * startWeight,
      impulseY * startWeight
    )
    this.applyBridgeRopeNodeImpulse(
      runtime,
      this.climbSegmentStartNodeIndex + 1,
      impulseX * endWeight,
      impulseY * endWeight
    )
  }

  private applyBridgeRopeNodeForce(
    runtime: RopeBridgeRuntime,
    nodeIndex: number,
    forceX: number,
    forceY: number
  ): void {
    if (forceX === 0 && forceY === 0) {
      return
    }

    const bodyId = this.getBridgeRopeDynamicNodeBody(runtime, nodeIndex)
    if (!bodyId) {
      return
    }

    this.tempVec.x = forceX
    this.tempVec.y = forceY
    this.box2d.b2Body_ApplyForceToCenter(bodyId, this.tempVec, true)
  }

  private applyBridgeRopeNodeImpulse(
    runtime: RopeBridgeRuntime,
    nodeIndex: number,
    impulseX: number,
    impulseY: number
  ): void {
    if (impulseX === 0 && impulseY === 0) {
      return
    }

    const bodyId = this.getBridgeRopeDynamicNodeBody(runtime, nodeIndex)
    if (!bodyId) {
      return
    }

    this.tempVec.x = impulseX
    this.tempVec.y = impulseY
    this.box2d.b2Body_ApplyLinearImpulseToCenter(bodyId, this.tempVec, true)
  }

  private getBridgeRopeDynamicNodeBody(
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
    if (!this.isBodyId(bodyId) || !this.box2d.b2Body_IsValid(bodyId)) {
      return null
    }
    return bodyId
  }

  private getRopeClimbNodeBody(
    climbRuntime: RopeClimbRuntime
  ): b2BodyId | null {
    if (climbRuntime.sourceType === this.ropeClimbSourcePlayer) {
      const runtime =
        climbRuntime.playerRuntime ??
        this.ropeRuntimeByEntityId.get(climbRuntime.ownerEntityId)
      if (!runtime?.active) {
        return null
      }
      return this.getPlayerRopeNodeBody(runtime, climbRuntime.nodeIndex)
    }
    if (climbRuntime.sourceType === this.ropeClimbSourceBridge) {
      const runtime = climbRuntime.bridgeRuntime
      if (!runtime?.active || runtime.hitId !== climbRuntime.bridgeHitId) {
        return null
      }
      return this.getBridgeRopeNodeBody(runtime, climbRuntime.nodeIndex)
    }
    return null
  }

  private getPlayerRopeNodeBody(
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

  private getBridgeRopeNodeBody(
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

  private findNearestPlayerRopeNode(
    runtime: RopeRuntime,
    x: number,
    y: number,
    maxNodeIndex: number,
    limitDistSq: number
  ): number {
    let nearestNodeIndex = -1
    let nearestDistSq = limitDistSq
    for (let nodeIndex = 0; nodeIndex <= maxNodeIndex; nodeIndex++) {
      const bodyId = this.getPlayerRopeNodeBody(runtime, nodeIndex)
      if (!this.readBodyPosition(bodyId, this.climbPointA)) {
        continue
      }
      const dx = this.climbPointA.x - x
      const dy = this.climbPointA.y - y
      const distSq = dx * dx + dy * dy
      if (distSq <= nearestDistSq) {
        nearestDistSq = distSq
        nearestNodeIndex = nodeIndex
      }
    }
    return nearestNodeIndex
  }

  private resolveBridgeRopePoint(
    runtime: RopeBridgeRuntime,
    pathDistance: number
  ): boolean {
    const maxNodeIndex = runtime.segmentBodies.length + 1
    if (!this.readBodyPosition(runtime.bodyAId, this.climbPointA)) {
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
    let lastPointX = this.climbPointA.x
    let lastPointY = this.climbPointA.y

    for (let nodeIndex = 1; nodeIndex <= maxNodeIndex; nodeIndex++) {
      const bodyId = this.getBridgeRopeNodeBody(runtime, nodeIndex)
      if (!this.readBodyPosition(bodyId, this.climbPointB)) {
        continue
      }

      const dx = this.climbPointB.x - this.climbPointA.x
      const dy = this.climbPointB.y - this.climbPointA.y
      const lenSq = dx * dx + dy * dy
      if (lenSq > 0.0001) {
        const len = Math.sqrt(lenSq)
        const nextDistance = accumulated + len
        const tangentX = dx / len
        const tangentY = dy / len

        if (!resolved && targetDistance <= nextDistance) {
          const t = (targetDistance - accumulated) / len
          this.climbAttachX = this.climbPointA.x + dx * t
          this.climbAttachY = this.climbPointA.y + dy * t
          this.climbTangentX = tangentX
          this.climbTangentY = tangentY
          this.climbNormalX = -tangentY
          this.climbNormalY = tangentX
          this.climbSegmentStartNodeIndex = nodeIndex - 1
          this.climbSegmentRatio = t
          resolved = true
        }

        accumulated = nextDistance
        lastTangentX = tangentX
        lastTangentY = tangentY
        lastPointX = this.climbPointB.x
        lastPointY = this.climbPointB.y
      }

      this.climbPointA.x = this.climbPointB.x
      this.climbPointA.y = this.climbPointB.y
    }

    this.climbPathLength = accumulated
    if (!(accumulated > 0)) {
      return false
    }

    if (!resolved) {
      this.climbAttachX = lastPointX
      this.climbAttachY = lastPointY
      this.climbTangentX = lastTangentX
      this.climbTangentY = lastTangentY
      this.climbNormalX = -lastTangentY
      this.climbNormalY = lastTangentX
      this.climbSegmentStartNodeIndex = Math.max(0, maxNodeIndex - 1)
      this.climbSegmentRatio = 1
    }

    return true
  }

  private findNearestBridgeRopePoint(
    x: number,
    y: number,
    renderLayer: number
  ): void {
    this.climbCandidateBridgeRuntime = null
    this.climbCandidateNodeIndex = -1
    this.climbCandidateDistSq = this.ropeClimbInteractRadiusSq
    this.climbCandidatePathDistance = 0
    this.climbCandidateNormalOffset = 0

    for (let i = 0; i < this.bridgeRopes.length; i++) {
      const runtime = this.bridgeRopes[i]
      if (!runtime.active || runtime.renderLayer !== renderLayer) {
        continue
      }
      const maxNodeIndex = runtime.segmentBodies.length + 1
      if (!this.readBodyPosition(runtime.bodyAId, this.climbPointA)) {
        continue
      }

      let accumulated = 0
      for (let nodeIndex = 1; nodeIndex <= maxNodeIndex; nodeIndex++) {
        const bodyId = this.getBridgeRopeNodeBody(runtime, nodeIndex)
        if (!this.readBodyPosition(bodyId, this.climbPointB)) {
          continue
        }

        const segDx = this.climbPointB.x - this.climbPointA.x
        const segDy = this.climbPointB.y - this.climbPointA.y
        const lenSq = segDx * segDx + segDy * segDy
        if (lenSq > 0.0001) {
          const len = Math.sqrt(lenSq)
          const rawT =
            ((x - this.climbPointA.x) * segDx +
              (y - this.climbPointA.y) * segDy) /
            lenSq
          const t = rawT < 0 ? 0 : rawT > 1 ? 1 : rawT
          const pointX = this.climbPointA.x + segDx * t
          const pointY = this.climbPointA.y + segDy * t
          const dx = pointX - x
          const dy = pointY - y
          const distSq = dx * dx + dy * dy
          if (distSq <= this.climbCandidateDistSq) {
            const tangentX = segDx / len
            const tangentY = segDy / len
            const normalX = -tangentY
            const normalY = tangentX
            this.climbCandidateDistSq = distSq
            this.climbCandidateBridgeRuntime = runtime
            this.climbCandidateNodeIndex = nodeIndex - 1
            this.climbCandidatePathDistance = accumulated + len * t
            this.climbCandidateNormalOffset =
              (x - pointX) * normalX + (y - pointY) * normalY
          }
          accumulated += len
        }

        this.climbPointA.x = this.climbPointB.x
        this.climbPointA.y = this.climbPointB.y
      }
    }
  }

  private findNearestDetachedPlayerRopeNode(
    x: number,
    y: number,
    renderLayer: number
  ): void {
    this.climbCandidatePlayerRuntime = null
    this.climbCandidateNodeIndex = -1
    this.climbCandidateDistSq = this.ropeClimbInteractRadiusSq

    for (let i = 0; i < this.detachedPlayerRopes.length; i++) {
      const runtime = this.detachedPlayerRopes[i]
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
        const bodyId = this.getPlayerRopeNodeBody(runtime, nodeIndex)
        if (!this.readBodyPosition(bodyId, this.climbPointA)) {
          continue
        }

        const dx = this.climbPointA.x - x
        const dy = this.climbPointA.y - y
        const distSq = dx * dx + dy * dy
        if (distSq <= this.climbCandidateDistSq) {
          this.climbCandidateDistSq = distSq
          this.climbCandidatePlayerRuntime = runtime
          this.climbCandidateNodeIndex = nodeIndex
        }
      }
    }
  }

  private readBodyPosition(
    bodyId: b2BodyId | null,
    out: { x: number; y: number }
  ): boolean {
    if (!this.isBodyId(bodyId) || !this.box2d.b2Body_IsValid(bodyId)) {
      return false
    }
    const pos = this.box2d.b2Body_GetPosition(bodyId)
    out.x = pos.x
    out.y = pos.y
    pos.delete()
    return true
  }

  private startAnchorTether(
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
    const dx = entity.transform.x - grapple.targetX
    const dy = entity.transform.y - grapple.targetY
    const currentDist = Math.sqrt(dx * dx + dy * dy)
    const startsGrounded = entity.movement?.isGrounded === true

    if (anchorEntity) {
      if (!anchorEntity.transform) {
        return false
      }
      if (anchorEntity.grappleTarget) {
        const targetBodyId = this.getValidBodyId(anchorEntity)
        if (!targetBodyId) {
          return false
        }
        anchorBodyId = targetBodyId
        anchorBodyOwned = false
        anchorIsDynamicTarget = true
        anchorLocalX = anchorEntity.grappleTarget.anchorLocalX
        anchorLocalY = anchorEntity.grappleTarget.anchorLocalY
        this.writeGrappleTargetWorldPoint(
          anchorEntity,
          targetBodyId,
          anchorLocalX,
          anchorLocalY,
          this.tempTarget
        )
        anchorEntityId = anchorEntity.id
        if (!this.canCreateRopeOnTarget(anchorEntityId)) {
          return false
        }
        grapple.targetX = this.tempTarget.x
        grapple.targetY = this.tempTarget.y
        grapple.targetEntityId = anchorEntity.id
        const anchorDx = entity.transform.x - this.tempTarget.x
        const anchorDy = entity.transform.y - this.tempTarget.y
        const anchorDist = Math.sqrt(anchorDx * anchorDx + anchorDy * anchorDy)
        const runtime = this.prepareNewAnchorTetherRuntime(entity, grapple)
        if (
          !this.buildDynamicAnchorTether(
            entity,
            runtime,
            anchorEntity.id,
            targetBodyId,
            this.tempTarget.x,
            this.tempTarget.y,
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
          this.applyTetherSwingImpulse(entity, grapple)
        }
        return true
      }
      if (!anchorEntity.grappleAnchor) {
        return false
      }
      anchorEntityId = anchorEntity.id
      if (!this.canCreateRopeOnTarget(anchorEntityId)) {
        return false
      }
      grapple.targetX = anchorEntity.transform.x
      grapple.targetY = anchorEntity.transform.y
      grapple.targetEntityId = anchorEntity.id
      anchorBodyId = this.createAnchorBody(
        anchorEntity.transform.x,
        anchorEntity.transform.y
      )
    } else {
      anchorBodyId = this.createAnchorBody(grapple.targetX, grapple.targetY)
      grapple.targetEntityId = -1
    }

    if (!this.isBodyId(anchorBodyId)) {
      return false
    }

    const runtime = this.prepareNewAnchorTetherRuntime(entity, grapple)
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
      anchorLocalY,
      anchorIsDynamicTarget,
      startsGrounded
    )
    runtime.active = true

    if (!startsGrounded) {
      this.applyTetherSwingImpulse(entity, grapple)
    }

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
    initialLength: number,
    startsGrounded: boolean
  ): boolean {
    if (!entity.transform || !entity.physics) {
      return false
    }

    const playerX = entity.transform.x
    const playerY = entity.transform.y
    const anchorEntity = this.getEntityById(anchorEntityId)
    const minRopeLength = this.getPlayerTetherMinLengthForTarget(
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
    const anchorBodyId = this.createKinematicAnchorBody(anchorX, anchorY)
    const playerAnchorBodyId = startsGrounded
      ? this.createKinematicAnchorBody(playerX, playerY)
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
      ? this.playerTetherStateGround
      : this.playerTetherStateAir
    runtime.playerGroundJumpActive = false
    runtime.airJumpDetachArmed = entity.input?.jumpRequested !== true
    runtime.hitId = this.nextRopeHitId++
    runtime.health = this.getDefaultRopeHealth()
    this.resetRopeHitShake(runtime)
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
    const playerBodyId = startsGrounded
      ? playerAnchorBodyId
      : entity.physics.bodyId
    if (!this.isBodyId(playerBodyId)) {
      return false
    }
    runtime.playerJointId = this.createFixedDistanceJoint(
      attachBodyId,
      playerBodyId,
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
      ? this.playerTetherStateGround
      : this.playerTetherStateAir
    runtime.playerGroundJumpActive = false
    runtime.airJumpDetachArmed = entity.input?.jumpRequested !== true
    runtime.hitId = this.nextRopeHitId++
    runtime.health = this.getDefaultRopeHealth()
    this.resetRopeHitShake(runtime)
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
    const playerBodyId = startsGrounded
      ? this.createPlayerTetherFollowBody(entity, runtime)
      : entity.physics.bodyId
    if (!this.isBodyId(playerBodyId)) {
      return
    }
    runtime.playerJointId = this.createFixedDistanceJoint(
      attachBodyId,
      playerBodyId,
      runtime.jointMaxLen,
      attachLocalX,
      attachLocalY
    )
  }

  private createPlayerTetherFollowBody(
    entity: Entity,
    runtime: RopeRuntime
  ): b2BodyId | null {
    if (!entity.transform) {
      return null
    }

    const bodyId = this.createKinematicAnchorBody(
      entity.transform.x,
      entity.transform.y
    )
    runtime.playerAnchorBodyId = bodyId
    runtime.playerFollowX = entity.transform.x
    runtime.playerFollowY = entity.transform.y
    return bodyId
  }

  private switchPlayerTetherState(
    entity: Entity,
    runtime: RopeRuntime,
    nextState: number
  ): boolean {
    if (runtime.playerTetherState === nextState) {
      return true
    }
    if (!entity.physics) {
      return false
    }

    this.destroyJointIfValid(runtime.playerJointId)
    runtime.playerJointId = null

    let playerBodyId: b2BodyId | null = entity.physics.bodyId
    if (nextState === this.playerTetherStateGround) {
      playerBodyId = this.createPlayerTetherFollowBody(entity, runtime)
    } else {
      this.destroyBodyIfValid(runtime.playerAnchorBodyId)
      runtime.playerAnchorBodyId = null
    }
    if (!this.isBodyId(playerBodyId)) {
      return false
    }

    runtime.playerTetherState = nextState
    this.rebuildPlayerTetherJoint(
      runtime,
      playerBodyId,
      !runtime.anchorIsDynamicTarget
    )
    return this.isJointId(runtime.playerJointId)
  }

  private updatePlayerTetherState(
    entity: Entity,
    grapple: NonNullable<Entity['grapple']>,
    runtime: RopeRuntime,
    deltaMs: number
  ): boolean {
    if (!entity.input || !entity.movement || !entity.transform) {
      return false
    }

    const jumpHeld = entity.input.jumpRequested
    const jumpStartedByMovement = this.didMovementJumpStartThisTick(
      entity,
      deltaMs
    )

    if (!entity.input.jumpRequested) {
      runtime.airJumpDetachArmed = true
    }

    if (jumpHeld && jumpStartedByMovement) {
      runtime.playerGroundJumpActive = true
      runtime.airJumpDetachArmed = false
    }

    if (entity.movement.isGrounded) {
      runtime.playerGroundJumpActive = entity.movement.isJumping && jumpHeld
      if (jumpHeld) {
        runtime.airJumpDetachArmed = false
      }
      if (
        !this.switchPlayerTetherState(
          entity,
          runtime,
          this.playerTetherStateGround
        )
      ) {
        return false
      }
    } else {
      if (
        runtime.playerGroundJumpActive &&
        this.hasPlayerTetherSuspensionGeometry(entity, grapple, runtime)
      ) {
        runtime.playerGroundJumpActive = false
      }

      if (
        runtime.playerTetherState === this.playerTetherStateGround &&
        !runtime.playerGroundJumpActive
      ) {
        if (
          !this.switchPlayerTetherState(
            entity,
            runtime,
            this.playerTetherStateAir
          )
        ) {
          return false
        }
      }
    }

    return this.syncPlayerTetherEndpointBody(entity, runtime, deltaMs)
  }

  private didMovementJumpStartThisTick(
    entity: Entity,
    deltaMs: number
  ): boolean {
    const movement = entity.movement
    if (!movement?.isJumping) {
      return false
    }

    const jumpElapsedMs = movement.jumpElapsedTime * 1000
    return jumpElapsedMs <= deltaMs + 0.001
  }

  private shouldDetachTetherForSuspendedJump(
    entity: Entity,
    grapple: NonNullable<Entity['grapple']>,
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
    return this.isPlayerTetherSuspended(entity, grapple, runtime)
  }

  private isPlayerTetherSuspended(
    entity: Entity,
    grapple: NonNullable<Entity['grapple']>,
    runtime: RopeRuntime
  ): boolean {
    if (
      runtime.playerTetherState !== this.playerTetherStateAir ||
      runtime.playerGroundJumpActive
    ) {
      return false
    }
    return this.hasPlayerTetherSuspensionGeometry(entity, grapple, runtime)
  }

  private hasPlayerTetherSuspensionGeometry(
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

    const ropeLength = Math.max(0.01, this.calculateCurrentRopeLength(runtime))
    const slack = DEFAULT_GRAPPLE_ROPE_SEGMENT_LENGTH * 2
    const tautLength = Math.max(0.01, ropeLength - slack)
    return distSq >= tautLength * tautLength
  }

  private syncPlayerTetherEndpointBody(
    entity: Entity,
    runtime: RopeRuntime,
    deltaMs: number
  ): boolean {
    if (!entity.transform) {
      return false
    }

    const x = entity.transform.x
    const y = entity.transform.y
    if (runtime.playerTetherState === this.playerTetherStateGround) {
      const playerAnchorBodyId = runtime.playerAnchorBodyId
      if (
        !this.isBodyId(playerAnchorBodyId) ||
        !this.box2d.b2Body_IsValid(playerAnchorBodyId)
      ) {
        return false
      }
      this.syncKinematicAnchorBody(
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

  private getPlayerTetherBodyId(
    entity: Entity,
    runtime: RopeRuntime
  ): b2BodyId | null {
    if (runtime.playerTetherState === this.playerTetherStateGround) {
      return runtime.playerAnchorBodyId
    }
    return entity.physics?.bodyId ?? null
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

    const isDynamicAnchor = runtime.anchorIsDynamicTarget

    if (!this.syncTetherAnchorTarget(runtime, grapple)) {
      this.stopPull(entity, grapple, false)
      return
    }

    // MovementSystem 会先于 GrappleSystem 消费跳跃输入，因此这里补偿本帧已起跳的情况。
    // 只有角色处于“悬空吊起”的绳索状态时，跳跃才销毁绳索；落地状态必须保留绳索，
    // 并继续在 updatePlayerTetherState() 中让绳索端点跟随角色身体。
    if (
      this.didMovementJumpStartThisTick(entity, deltaMs) &&
      runtime.airJumpDetachArmed &&
      this.isPlayerTetherSuspended(entity, grapple, runtime)
    ) {
      this.detachPlayerFromTether(entity, grapple, runtime, false, true)
      return
    }

    if (!this.updatePlayerTetherState(entity, grapple, runtime, deltaMs)) {
      this.stopPull(entity, grapple, false)
      return
    }

    if (this.shouldDetachTetherForSuspendedJump(entity, grapple, runtime)) {
      this.detachPlayerFromTetherForJump(entity, grapple, runtime)
      return
    }

    entity.input.grappleLengthAdjustSteps = 0
    const isRetractingTether = entity.input.grappleClimbHeld < 0
    const playerBodyId = this.getPlayerTetherBodyId(entity, runtime)
    if (!this.isBodyId(playerBodyId)) {
      this.stopPull(entity, grapple, false)
      return
    }

    if (runtime.playerTetherState === this.playerTetherStateAir) {
      this.handleSwingInput(entity, grapple, deltaMs)
    }

    if (isDynamicAnchor) {
      if (!this.syncDynamicTetherEndpointBodies(entity, runtime, deltaMs)) {
        this.stopPull(entity, grapple, false)
        return
      }
      this.adjustTetherLength(entity, runtime, deltaMs, playerBodyId, false)
      this.applyPlayerTetherLimitTension(
        entity,
        grapple,
        runtime,
        isRetractingTether
      )
      return
    }

    const anchorBodyId = runtime.anchorBodyId
    if (!this.isBodyId(anchorBodyId)) {
      this.stopPull(entity, grapple, false)
      return
    }

    this.adjustTetherLength(entity, runtime, deltaMs, playerBodyId, true)
    this.applyPlayerTetherLimitTension(
      entity,
      grapple,
      runtime,
      isRetractingTether
    )
  }

  private detachPlayerFromTetherForJump(
    entity: Entity,
    grapple: NonNullable<Entity['grapple']>,
    runtime: RopeRuntime
  ): void {
    if (!entity.input) {
      return
    }

    entity.input.inputBuffer.clearAction('jump')
    entity.input.jumpRequested = false
    this.detachPlayerFromTether(entity, grapple, runtime, true)
  }

  private detachPlayerFromTether(
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
      this.hasPlayerTetherSuspensionGeometry(entity, grapple, runtime)

    this.destroyJointIfValid(runtime.playerJointId)
    runtime.playerJointId = null
    this.destroyBodyIfValid(runtime.playerAnchorBodyId)
    runtime.playerAnchorBodyId = null
    runtime.playerAttached = false
    runtime.playerTetherState = this.playerTetherStateAir
    runtime.playerGroundJumpActive = false
    runtime.airJumpDetachArmed = true

    if (this.ropeRuntimeByEntityId.get(runtime.ownerEntityId) === runtime) {
      this.ropeRuntimeByEntityId.delete(runtime.ownerEntityId)
    }

    if (applyJump) {
      this.performRopeJump(entity, grapple)
    }

    grapple.isPulling = false
    grapple.isTethering = false
    grapple.retainAirMomentum = true
    grapple.pullMode = this.pullModeAnchor
    grapple.targetEntityId = -1
    grapple.desiredDistanceSq = 0
    grapple.moveLockEndTime = 0

    if (destroyOnDetach) {
      this.destroyPlayerRopeRuntime(runtime)
    } else {
      this.addDetachedPlayerRope(runtime)
    }
  }

  private addDetachedPlayerRope(runtime: RopeRuntime): void {
    for (let i = 0; i < this.detachedPlayerRopes.length; i++) {
      if (this.detachedPlayerRopes[i] === runtime) {
        return
      }
    }
    this.detachedPlayerRopes.push(runtime)
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
      const currentTotalLength = this.calculateCurrentRopeLength(runtime)
      const minTotalLength = this.getPlayerTetherMinLength(entity, runtime)
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

  private getPlayerTetherMinLength(
    entity: Entity,
    runtime: RopeRuntime
  ): number {
    if (!runtime.anchorIsDynamicTarget || runtime.anchorEntityId < 0) {
      return DEFAULT_GRAPPLE_TETHER_MIN_LENGTH
    }

    return this.getPlayerTetherMinLengthForTarget(
      entity,
      this.getEntityById(runtime.anchorEntityId)
    )
  }

  private getPlayerTetherMinLengthForTarget(
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
    if (!anchorEntity?.transform) {
      return false
    }
    if (runtime.anchorIsDynamicTarget) {
      const anchorBodyId = this.getValidBodyId(anchorEntity)
      if (!anchorBodyId) {
        return false
      }
      this.writeGrappleTargetWorldPoint(
        anchorEntity,
        anchorBodyId,
        runtime.anchorLocalX,
        runtime.anchorLocalY,
        this.tempTarget
      )
      grapple.targetX = this.tempTarget.x
      grapple.targetY = this.tempTarget.y
    } else {
      grapple.targetX = anchorEntity.transform.x
      grapple.targetY = anchorEntity.transform.y
    }
    grapple.targetEntityId = anchorEntity.id
    if (
      !runtime.anchorIsDynamicTarget &&
      runtime.anchorBodyOwned &&
      this.isBodyId(runtime.anchorBodyId) &&
      this.box2d.b2Body_IsValid(runtime.anchorBodyId)
    ) {
      this.tempVec.x = anchorEntity.transform.x
      this.tempVec.y = anchorEntity.transform.y
      this.box2d.b2Body_SetTransform(
        runtime.anchorBodyId,
        this.tempVec,
        this.tempRot
      )
    }
    return true
  }

  private hasDynamicAnchorTether(entity: Entity): boolean {
    const runtime = this.ropeRuntimeByEntityId.get(entity.id)
    return runtime?.active === true && runtime.anchorIsDynamicTarget
  }

  private syncDynamicTetherEndpointBodies(
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
    const anchorEntity = this.getEntityById(runtime.anchorEntityId)
    if (!anchorEntity?.transform || !this.isBodyId(runtime.anchorBodyId)) {
      return false
    }

    const anchorBodyId = this.getValidBodyId(anchorEntity)
    if (!anchorBodyId) {
      return false
    }
    this.writeGrappleTargetWorldPoint(
      anchorEntity,
      anchorBodyId,
      runtime.anchorLocalX,
      runtime.anchorLocalY,
      this.tempTarget
    )

    this.syncKinematicAnchorBody(
      runtime.anchorBodyId,
      this.tempTarget.x,
      this.tempTarget.y,
      runtime.anchorFollowX,
      runtime.anchorFollowY,
      deltaMs
    )
    runtime.anchorFollowX = this.tempTarget.x
    runtime.anchorFollowY = this.tempTarget.y
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

  private applyPlayerTetherLimitTension(
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

    const ropeLength = Math.max(0.01, this.calculateCurrentRopeLength(runtime))
    const dist = Math.sqrt(distSq)
    const elasticLimit = this.getRopeElasticLimitLength(ropeLength)
    const isAtElasticLimit = this.isDistanceAtRopeElasticLimit(
      distSq,
      ropeLength
    )
    const retractTensionStretch = isRetractingTether
      ? this.getRopeRetractTensionStretch(dist, ropeLength)
      : 0
    if (!isAtElasticLimit && !(retractTensionStretch > 0)) {
      return
    }

    const stretch = Math.max(0, dist - elasticLimit)
    const anchorBodyId = this.getPlayerTetherAnchorTensionBody(runtime)
    const playerBodyId = entity.physics.bodyId
    const anchorMovable = this.isTensionBodyMovable(anchorBodyId)
    const playerMovable = this.isTensionBodyMovable(playerBodyId)
    if (!anchorMovable && !playerMovable) {
      return
    }

    const invDist = 1 / dist
    const dirX = dx * invDist
    const dirY = dy * invDist
    const anchorSpeed = anchorMovable
      ? this.getBodyVelocityAlong(anchorBodyId, dirX, dirY)
      : 0
    const playerSpeed = playerMovable
      ? this.getBodyVelocityAlong(playerBodyId, dirX, dirY)
      : 0
    const relativeAwaySpeed = playerSpeed - anchorSpeed

    const endpointCount = (anchorMovable ? 1 : 0) + (playerMovable ? 1 : 0)
    const sharedLimitCorrectionSpeed = isAtElasticLimit
      ? this.getRopeLimitTensionSpeed(stretch, relativeAwaySpeed, endpointCount)
      : 0
    const fullLimitCorrectionSpeed = isAtElasticLimit
      ? this.getRopeLimitTensionSpeed(stretch, relativeAwaySpeed, 1)
      : 0
    const retractCorrectionSpeed = this.getRopeRetractTensionSpeed(
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
      this.applyBodyVelocityCorrectionAtPoint(
        anchorBodyId,
        anchorX,
        anchorY,
        dirX,
        dirY,
        anchorSpeed + anchorCorrectionSpeed
      )
    }
    if (playerMovable) {
      this.applyBodyVelocityCorrectionAtPoint(
        playerBodyId,
        playerX,
        playerY,
        -dirX,
        -dirY,
        -playerSpeed + playerCorrectionSpeed
      )
    }
  }

  private getPlayerTetherAnchorTensionBody(
    runtime: RopeRuntime
  ): b2BodyId | null {
    if (!runtime.anchorIsDynamicTarget) {
      return runtime.anchorBodyId
    }

    if (runtime.anchorEntityId < 0) {
      return null
    }
    const anchorEntity = this.getEntityById(runtime.anchorEntityId)
    return anchorEntity ? this.getValidBodyId(anchorEntity) : null
  }

  private isTensionBodyMovable(bodyId: b2BodyId | null): bodyId is b2BodyId {
    if (!this.isBodyId(bodyId) || !this.box2d.b2Body_IsValid(bodyId)) {
      return false
    }
    return this.box2d.b2Body_GetMass(bodyId) > 0
  }

  private getRopeLimitTensionSpeed(
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
            this.dynamicTetherMaxSpeed,
            this.dynamicTetherBaseSpeed +
              stretch * this.dynamicTetherStretchSpeed
          )
        : 0
    const correctionSpeed = Math.max(0, relativeAwaySpeed + pullbackSpeed)
    if (!(correctionSpeed > 0)) {
      return 0
    }

    return correctionSpeed / endpointCount
  }

  private getRopeRetractTensionStretch(
    dist: number,
    ropeLength: number
  ): number {
    const stretch = dist - ropeLength - this.ropeRetractTensionSlack
    return stretch > 0 ? stretch : 0
  }

  private getRopeRetractTensionSpeed(
    stretch: number,
    endpointCount: number
  ): number {
    if (endpointCount <= 0 || !(stretch > 0)) {
      return 0
    }
    return (
      Math.min(GRAPPLE_CLIMB_SPEED, stretch * this.dynamicTetherStretchSpeed) /
      endpointCount
    )
  }

  private getBodyVelocityAlong(
    bodyId: b2BodyId,
    dirX: number,
    dirY: number
  ): number {
    const velocity = this.box2d.b2Body_GetLinearVelocity(bodyId)
    const speed = velocity.x * dirX + velocity.y * dirY
    velocity.delete()
    return speed
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
      segIndex === 0 &&
      runtime.anchorEntityId >= 0 &&
      runtime.anchorIsDynamicTarget
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
    if (grapple.isRopeClimbing) {
      this.stopRopeClimb(entity, grapple, false)
    }

    const runtime = this.ropeRuntimeByEntityId.get(entity.id)
    if (!runtime || !runtime.active) {
      grapple.isTethering = false
      return
    }

    this.destroyPlayerRopeRuntime(runtime)
    if (this.ropeRuntimeByEntityId.get(entity.id) === runtime) {
      this.ropeRuntimeByEntityId.delete(entity.id)
    }
    grapple.isTethering = false
  }

  private destroyPlayerRopeRuntime(runtime: RopeRuntime): void {
    this.stopRopeClimbersForPlayerRope(runtime)

    const ownerEntityId = runtime.ownerEntityId
    if (this.ropeRuntimeByEntityId.get(ownerEntityId) === runtime) {
      const owner = this.getEntityById(ownerEntityId)
      const grapple = owner?.grapple
      if (grapple) {
        grapple.isPulling = false
        grapple.isTethering = false
        grapple.retainAirMomentum = false
        grapple.pullMode = this.pullModeAnchor
        grapple.targetEntityId = -1
        grapple.desiredDistanceSq = 0
        grapple.moveLockEndTime = 0
      }
      this.ropeRuntimeByEntityId.delete(ownerEntityId)
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
    runtime.ownerEntityId = -1
    runtime.anchorBodyOwned = false
    runtime.anchorIsDynamicTarget = false
    runtime.anchorEntityId = -1
    runtime.anchorLocalX = 0
    runtime.anchorLocalY = 0
    this.destroyBodyIfValid(runtime.playerAnchorBodyId)
    runtime.playerAnchorBodyId = null
    runtime.playerAttached = false
    runtime.playerTetherState = this.playerTetherStateAir
    runtime.playerGroundJumpActive = false
    runtime.airJumpDetachArmed = true
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
    this.resetRopeHitShake(runtime)
    runtime.active = false
  }

  private stopRopeClimbersForPlayerRope(runtime: RopeRuntime): void {
    this.ropeClimbRuntimeByEntityId.forEach((climbRuntime, entityId) => {
      if (
        !climbRuntime.active ||
        climbRuntime.sourceType !== this.ropeClimbSourcePlayer ||
        climbRuntime.playerRuntime !== runtime
      ) {
        return
      }

      const entity = this.getEntityById(entityId)
      const grapple = entity?.grapple
      if (entity && grapple) {
        this.stopRopeClimb(entity, grapple, false)
        return
      }

      this.destroyRopeClimbJoint(climbRuntime)
      this.resetRopeClimbRuntime(climbRuntime)
    })
  }

  private transferTetherToSelectedTarget(
    entity: Entity,
    grapple: NonNullable<Entity['grapple']>
  ): boolean {
    if (!entity.input) {
      return false
    }
    const runtime = this.ropeRuntimeByEntityId.get(entity.id)
    if (!runtime?.active || runtime.anchorEntityId < 0) {
      return false
    }

    const source = this.getEntityById(runtime.anchorEntityId)
    if (!source?.transform) {
      return false
    }

    const target = this.resolveTetherTransferTarget(entity, runtime, source)
    if (!target || !this.canUseLockedTarget(entity, target)) {
      return false
    }

    if (!this.createBridgeRope(source, target, runtime)) {
      return false
    }

    this.destroyAnchorTether(entity, grapple)
    grapple.isPulling = false
    grapple.isTethering = false
    grapple.retainAirMomentum = false
    grapple.pullMode = this.pullModeAnchor
    grapple.targetEntityId = -1
    grapple.desiredDistanceSq = 0
    grapple.moveLockEndTime = 0
    entity.input.grappleLengthAdjustSteps = 0
    entity.input.grapplePersistentRequested = false
    return true
  }

  private resolveTetherTransferTarget(
    entity: Entity,
    runtime: RopeRuntime,
    source: Entity
  ): Entity | null {
    const lockedTargetId = entity.input?.lockedTargetId ?? null
    if (lockedTargetId !== null && lockedTargetId !== runtime.anchorEntityId) {
      return this.getEntityById(lockedTargetId)
    }

    if (!entity.transform || !source.transform) {
      return null
    }

    const facing =
      entity.input?.lastMoveDirection !== undefined &&
      entity.input.lastMoveDirection !== 0
        ? entity.input.lastMoveDirection
        : 1
    return this.findAnchorTarget(
      entity.transform.x,
      entity.transform.y,
      facing,
      this.tempTarget,
      entity.render?.renderLayer ?? 0,
      source.transform.x,
      source.transform.y
    )
  }

  private createBridgeRope(
    source: Entity,
    target: Entity,
    ignoredPlayerRuntime: RopeRuntime | null = null
  ): boolean {
    if (source.id === target.id) {
      return false
    }

    const endpointA = this.bridgeEndpointA
    const endpointB = this.bridgeEndpointB
    if (!this.resolveBridgeEndpoint(source, endpointA)) {
      return false
    }
    if (!this.resolveBridgeEndpoint(target, endpointB)) {
      return false
    }

    if (endpointA.renderLayer !== endpointB.renderLayer) {
      return false
    }

    if (
      endpointA.hasDynamicBody &&
      endpointB.hasDynamicBody &&
      this.isBodyId(endpointA.bodyId) &&
      this.isBodyId(endpointB.bodyId) &&
      this.areBodyIdsEqual(endpointA.bodyId, endpointB.bodyId)
    ) {
      return false
    }

    const dx = endpointB.x - endpointA.x
    const dy = endpointB.y - endpointA.y
    const distSq = dx * dx + dy * dy
    if (distSq <= 0.0001) {
      return false
    }

    const existing = this.findBridgeRope(source.id, target.id)
    if (
      !this.canCreateRopeOnTarget(
        endpointA.entityId,
        ignoredPlayerRuntime,
        existing
      ) ||
      !this.canCreateRopeOnTarget(
        endpointB.entityId,
        ignoredPlayerRuntime,
        existing
      )
    ) {
      return false
    }

    if (existing) {
      this.destroyBridgeRope(existing)
    }

    const runtime = this.acquireBridgeRope()
    runtime.active = false
    runtime.climbTuningActive = false
    runtime.endpointAEntityId = endpointA.entityId
    runtime.endpointBEntityId = endpointB.entityId
    runtime.bodyAId = this.createKinematicAnchorBody(endpointA.x, endpointA.y)
    runtime.bodyAOwned = true
    runtime.bodyBId = this.createKinematicAnchorBody(endpointB.x, endpointB.y)
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
    runtime.hitId = this.nextRopeHitId++
    runtime.health = this.getDefaultRopeHealth()
    this.resetRopeHitShake(runtime)
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
      if (!this.isBodyId(previousBodyId)) {
        this.destroyBridgeRope(runtime)
        return false
      }
      const centerFactor = i + 1
      const centerX = endpointA.x + dirX * (centerFactor * linkLength)
      const centerY = endpointA.y + dirY * (centerFactor * linkLength)
      const segmentBodyId = this.createRopeSegmentBody(
        centerX,
        centerY,
        runtime.renderLayer,
        this.dynamicTetherRopeDensity,
        categoryBits,
        maskBits
      )
      runtime.segmentBodies.push(segmentBodyId)
      if (endpointA.hasDynamicBody && this.isBodyId(endpointA.bodyId)) {
        runtime.segmentFilterJoints.push(
          this.createBodyCollisionFilterJoint(segmentBodyId, endpointA.bodyId)
        )
      }
      if (endpointB.hasDynamicBody && this.isBodyId(endpointB.bodyId)) {
        runtime.segmentFilterJoints.push(
          this.createBodyCollisionFilterJoint(segmentBodyId, endpointB.bodyId)
        )
      }
      runtime.segmentJoints.push(
        this.createFixedDistanceJoint(previousBodyId, segmentBodyId, linkLength)
      )
      previousBodyId = segmentBodyId
    }

    if (!this.isBodyId(previousBodyId) || !this.isBodyId(runtime.bodyBId)) {
      this.destroyBridgeRope(runtime)
      return false
    }
    runtime.segmentJoints.push(
      this.createFixedDistanceJoint(previousBodyId, runtime.bodyBId, linkLength)
    )

    runtime.active = true
    return true
  }

  private resolveBridgeEndpoint(
    entity: Entity,
    out: RopeBridgeEndpointBuild
  ): boolean {
    if (!entity.transform) {
      return false
    }

    out.entityId = entity.id
    out.bodyId = null
    out.bodyOwned = false
    out.localX = 0
    out.localY = 0
    out.x = entity.transform.x
    out.y = entity.transform.y
    out.renderLayer = entity.render?.renderLayer ?? 0
    out.hasDynamicBody = false

    if (entity.grappleTarget) {
      if (!entity.grappleTarget.canTether) {
        return false
      }
      const bodyId = this.getValidBodyId(entity)
      if (!bodyId) {
        return false
      }
      out.bodyId = bodyId
      out.localX = entity.grappleTarget.anchorLocalX
      out.localY = entity.grappleTarget.anchorLocalY
      this.writeGrappleTargetWorldPoint(
        entity,
        bodyId,
        out.localX,
        out.localY,
        out
      )
      out.hasDynamicBody = true
      return true
    }

    if (entity.grappleAnchor) {
      return true
    }

    return false
  }

  private acquireBridgeRope(): RopeBridgeRuntime {
    for (let i = 0; i < this.bridgeRopes.length; i++) {
      const runtime = this.bridgeRopes[i]
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
    this.bridgeRopes.push(runtime)
    return runtime
  }

  private findBridgeRope(
    endpointAEntityId: number,
    endpointBEntityId: number
  ): RopeBridgeRuntime | null {
    for (let i = 0; i < this.bridgeRopes.length; i++) {
      const runtime = this.bridgeRopes[i]
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

  private updateBridgeRopes(deltaMs: number): void {
    for (let i = 0; i < this.bridgeRopes.length; i++) {
      const runtime = this.bridgeRopes[i]
      if (!runtime.active) continue
      if (!this.syncBridgeEndpoint(runtime, true, deltaMs)) {
        this.destroyBridgeRope(runtime)
        continue
      }
      if (!this.syncBridgeEndpoint(runtime, false, deltaMs)) {
        this.destroyBridgeRope(runtime)
        continue
      }
      this.applyBridgeLimitTension(runtime)
    }
  }

  private updateDetachedPlayerRopes(deltaMs: number): void {
    for (let i = 0; i < this.detachedPlayerRopes.length; i++) {
      const runtime = this.detachedPlayerRopes[i]
      if (!runtime.active || runtime.playerAttached) {
        continue
      }
      if (this.syncDetachedPlayerRopeAnchor(runtime, deltaMs)) {
        continue
      }
      this.destroyPlayerRopeRuntime(runtime)
    }
  }

  private syncDetachedPlayerRopeAnchor(
    runtime: RopeRuntime,
    deltaMs: number
  ): boolean {
    const anchorBodyId = runtime.anchorBodyId
    if (
      !this.isBodyId(anchorBodyId) ||
      !this.box2d.b2Body_IsValid(anchorBodyId)
    ) {
      return false
    }
    if (runtime.anchorEntityId < 0) {
      return true
    }

    const anchorEntity = this.getEntityById(runtime.anchorEntityId)
    if (!anchorEntity?.transform) {
      return false
    }

    if (runtime.anchorIsDynamicTarget) {
      const targetBodyId = this.getValidBodyId(anchorEntity)
      if (!targetBodyId) {
        return false
      }
      this.writeGrappleTargetWorldPoint(
        anchorEntity,
        targetBodyId,
        runtime.anchorLocalX,
        runtime.anchorLocalY,
        this.tempTarget
      )
      this.syncKinematicAnchorBody(
        anchorBodyId,
        this.tempTarget.x,
        this.tempTarget.y,
        runtime.anchorFollowX,
        runtime.anchorFollowY,
        deltaMs
      )
      runtime.anchorFollowX = this.tempTarget.x
      runtime.anchorFollowY = this.tempTarget.y
      return true
    }

    this.tempVec.x = anchorEntity.transform.x
    this.tempVec.y = anchorEntity.transform.y
    this.box2d.b2Body_SetTransform(anchorBodyId, this.tempVec, this.tempRot)
    runtime.anchorFollowX = anchorEntity.transform.x
    runtime.anchorFollowY = anchorEntity.transform.y
    return true
  }

  private syncBridgeEndpoint(
    runtime: RopeBridgeRuntime,
    useEndpointA: boolean,
    deltaMs: number
  ): boolean {
    const entityId = useEndpointA
      ? runtime.endpointAEntityId
      : runtime.endpointBEntityId
    const bodyId = useEndpointA ? runtime.bodyAId : runtime.bodyBId
    const targetBodyId = useEndpointA
      ? runtime.targetABodyId
      : runtime.targetBBodyId
    const hasDynamicBody = useEndpointA
      ? runtime.endpointAHasDynamicBody
      : runtime.endpointBHasDynamicBody
    const entity = this.getEntityById(entityId)
    if (!entity?.transform) {
      return false
    }

    if (!this.isBodyId(bodyId) || !this.box2d.b2Body_IsValid(bodyId)) {
      return false
    }

    if (hasDynamicBody) {
      const currentBodyId = this.getValidBodyId(entity)
      if (
        currentBodyId === null ||
        !this.isBodyId(targetBodyId) ||
        !this.areBodyIdsEqual(currentBodyId, targetBodyId)
      ) {
        return false
      }
    } else if (!entity.grappleAnchor) {
      return false
    }

    if (hasDynamicBody && this.isBodyId(targetBodyId)) {
      const localX = useEndpointA ? runtime.localAX : runtime.localBX
      const localY = useEndpointA ? runtime.localAY : runtime.localBY
      this.writeGrappleTargetWorldPoint(
        entity,
        targetBodyId,
        localX,
        localY,
        this.tempTarget
      )
    } else {
      this.tempTarget.x = entity.transform.x
      this.tempTarget.y = entity.transform.y
    }

    if (useEndpointA) {
      this.syncKinematicAnchorBody(
        bodyId,
        this.tempTarget.x,
        this.tempTarget.y,
        runtime.followAX,
        runtime.followAY,
        deltaMs
      )
      runtime.followAX = this.tempTarget.x
      runtime.followAY = this.tempTarget.y
    } else {
      this.syncKinematicAnchorBody(
        bodyId,
        this.tempTarget.x,
        this.tempTarget.y,
        runtime.followBX,
        runtime.followBY,
        deltaMs
      )
      runtime.followBX = this.tempTarget.x
      runtime.followBY = this.tempTarget.y
    }

    return true
  }

  private applyBridgeLimitTension(runtime: RopeBridgeRuntime): void {
    const dx = runtime.followBX - runtime.followAX
    const dy = runtime.followBY - runtime.followAY
    const distSq = dx * dx + dy * dy
    if (distSq <= 0.0001) {
      return
    }

    if (!this.isDistanceAtRopeElasticLimit(distSq, runtime.maxRopeLength)) {
      return
    }

    const dist = Math.sqrt(distSq)
    const elasticLimit = this.getRopeElasticLimitLength(runtime.maxRopeLength)
    const stretch = Math.max(0, dist - elasticLimit)
    const invDist = 1 / dist
    const dirX = dx * invDist
    const dirY = dy * invDist
    const bodyAId = runtime.targetABodyId
    const bodyBId = runtime.targetBBodyId
    const endpointAMovable =
      runtime.endpointAHasDynamicBody && this.isTensionBodyMovable(bodyAId)
    const endpointBMovable =
      runtime.endpointBHasDynamicBody && this.isTensionBodyMovable(bodyBId)
    if (!endpointAMovable && !endpointBMovable) {
      return
    }

    const speedA = endpointAMovable
      ? this.getBodyVelocityAlong(bodyAId, dirX, dirY)
      : 0
    const speedB = endpointBMovable
      ? this.getBodyVelocityAlong(bodyBId, dirX, dirY)
      : 0
    const relativeAwaySpeed = speedB - speedA
    if (!(relativeAwaySpeed > 0) && !(stretch > 0)) {
      return
    }

    const endpointCount =
      (endpointAMovable ? 1 : 0) + (endpointBMovable ? 1 : 0)
    const correctionSpeed = this.getRopeLimitTensionSpeed(
      stretch,
      relativeAwaySpeed,
      endpointCount
    )
    if (!(correctionSpeed > 0)) {
      return
    }

    if (endpointAMovable) {
      this.applyBridgeEndpointTension(
        bodyAId,
        runtime.followAX,
        runtime.followAY,
        dirX,
        dirY,
        speedA + correctionSpeed
      )
    }
    if (endpointBMovable) {
      this.applyBridgeEndpointTension(
        bodyBId,
        runtime.followBX,
        runtime.followBY,
        -dirX,
        -dirY,
        -speedB + correctionSpeed
      )
    }
  }

  private applyBridgeEndpointTension(
    bodyId: b2BodyId,
    pointX: number,
    pointY: number,
    dirX: number,
    dirY: number,
    targetAlong: number
  ): void {
    this.applyBodyVelocityCorrectionAtPoint(
      bodyId,
      pointX,
      pointY,
      dirX,
      dirY,
      targetAlong
    )
  }

  private detachBridgeRopesForTarget(targetEntityId: number): void {
    for (let i = 0; i < this.bridgeRopes.length; i++) {
      const runtime = this.bridgeRopes[i]
      if (!runtime.active) continue
      if (
        runtime.endpointAEntityId === targetEntityId ||
        runtime.endpointBEntityId === targetEntityId
      ) {
        this.destroyBridgeRope(runtime)
      }
    }
  }

  private destroyBridgeRope(runtime: RopeBridgeRuntime): void {
    if (!runtime.active) {
      return
    }

    this.stopRopeClimbersForBridge(runtime)

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

    if (runtime.bodyAOwned) {
      this.destroyBodyIfValid(runtime.bodyAId)
    }
    if (runtime.bodyBOwned) {
      this.destroyBodyIfValid(runtime.bodyBId)
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
    this.resetRopeHitShake(runtime)
  }

  private stopRopeClimbersForBridge(runtime: RopeBridgeRuntime): void {
    this.ropeClimbRuntimeByEntityId.forEach((climbRuntime, entityId) => {
      if (
        !climbRuntime.active ||
        climbRuntime.sourceType !== this.ropeClimbSourceBridge ||
        climbRuntime.bridgeRuntime !== runtime
      ) {
        return
      }

      const entity = this.getEntityById(entityId)
      const grapple = entity?.grapple
      if (entity && grapple) {
        this.stopRopeClimb(entity, grapple, false)
        return
      }

      this.destroyRopeClimbJoint(climbRuntime)
      this.resetRopeClimbRuntime(climbRuntime)
    })
  }

  hitRopesInOBB(request: RopeHitRequest): boolean {
    if (request.width <= 0 || request.height <= 0) {
      return false
    }

    let hit = false
    for (const runtime of this.ropeRuntimeByEntityId.values()) {
      if (this.tryHitPlayerRopeInOBB(runtime, request)) {
        hit = true
      }
    }

    for (let i = 0; i < this.detachedPlayerRopes.length; i++) {
      const runtime = this.detachedPlayerRopes[i]
      if (this.tryHitPlayerRopeInOBB(runtime, request)) {
        hit = true
      }
    }

    for (let i = 0; i < this.bridgeRopes.length; i++) {
      if (this.tryHitBridgeRopeInOBB(this.bridgeRopes[i], request)) {
        hit = true
      }
    }

    return hit
  }

  hitRopesInCircle(request: RopeCircleHitRequest): boolean {
    if (request.radius <= 0) {
      return false
    }

    let hit = false
    for (const runtime of this.ropeRuntimeByEntityId.values()) {
      if (this.tryHitPlayerRopeInCircle(runtime, request)) {
        hit = true
      }
    }

    for (let i = 0; i < this.detachedPlayerRopes.length; i++) {
      const runtime = this.detachedPlayerRopes[i]
      if (this.tryHitPlayerRopeInCircle(runtime, request)) {
        hit = true
      }
    }

    for (let i = 0; i < this.bridgeRopes.length; i++) {
      if (this.tryHitBridgeRopeInCircle(this.bridgeRopes[i], request)) {
        hit = true
      }
    }

    return hit
  }

  private tryHitPlayerRopeInOBB(
    runtime: RopeRuntime,
    request: RopeHitRequest
  ): boolean {
    if (!this.canHitRopeRuntime(runtime, request)) {
      return false
    }

    const visibleSegmentCount = this.getVisiblePlayerRopeSegmentCount(runtime)
    if (
      !this.findHitRopeSegmentInOBB(
        runtime.segmentBodies,
        visibleSegmentCount,
        request
      )
    ) {
      return false
    }

    const damage = this.getRopeHitDamage(request)
    if (damage <= 0) {
      return false
    }
    this.markRopeHit(runtime.hitId, request)
    runtime.health -= damage
    if (runtime.health <= 0) {
      runtime.health = 0
      this.emitRopeHitSound(this.hitRopeSegmentX, this.hitRopeSegmentY)
      this.destroyPlayerRopeRuntime(runtime)
      return true
    }

    this.applyRopeHitFeedback(runtime, request)
    return true
  }

  private tryHitBridgeRopeInOBB(
    runtime: RopeBridgeRuntime,
    request: RopeHitRequest
  ): boolean {
    if (!this.canHitBridgeRopeRuntime(runtime, request)) {
      return false
    }

    if (
      !this.findHitRopeSegmentInOBB(
        runtime.segmentBodies,
        runtime.segmentBodies.length,
        request
      )
    ) {
      return false
    }

    const damage = this.getRopeHitDamage(request)
    if (damage <= 0) {
      return false
    }
    this.markRopeHit(runtime.hitId, request)
    runtime.health -= damage
    if (runtime.health <= 0) {
      runtime.health = 0
      this.emitRopeHitSound(this.hitRopeSegmentX, this.hitRopeSegmentY)
      this.destroyBridgeRope(runtime)
      return true
    }

    this.applyRopeHitFeedback(runtime, request)
    return true
  }

  private tryHitPlayerRopeInCircle(
    runtime: RopeRuntime,
    request: RopeCircleHitRequest
  ): boolean {
    if (!this.canHitRopeRuntime(runtime, request)) {
      return false
    }

    const visibleSegmentCount = this.getVisiblePlayerRopeSegmentCount(runtime)
    if (
      !this.findHitRopeSegmentInCircle(
        runtime.segmentBodies,
        visibleSegmentCount,
        request
      )
    ) {
      return false
    }

    const damage = this.getRopeHitDamage(request)
    if (damage <= 0) {
      return false
    }
    this.markRopeHit(runtime.hitId, request)
    runtime.health -= damage
    if (runtime.health <= 0) {
      runtime.health = 0
      this.emitRopeHitSound(this.hitRopeSegmentX, this.hitRopeSegmentY)
      this.destroyPlayerRopeRuntime(runtime)
      return true
    }

    this.applyRopeCircleHitFeedback(runtime, request)
    return true
  }

  private tryHitBridgeRopeInCircle(
    runtime: RopeBridgeRuntime,
    request: RopeCircleHitRequest
  ): boolean {
    if (!this.canHitBridgeRopeRuntime(runtime, request)) {
      return false
    }

    if (
      !this.findHitRopeSegmentInCircle(
        runtime.segmentBodies,
        runtime.segmentBodies.length,
        request
      )
    ) {
      return false
    }

    const damage = this.getRopeHitDamage(request)
    if (damage <= 0) {
      return false
    }
    this.markRopeHit(runtime.hitId, request)
    runtime.health -= damage
    if (runtime.health <= 0) {
      runtime.health = 0
      this.emitRopeHitSound(this.hitRopeSegmentX, this.hitRopeSegmentY)
      this.destroyBridgeRope(runtime)
      return true
    }

    this.applyRopeCircleHitFeedback(runtime, request)
    return true
  }

  private canHitRopeRuntime(
    runtime: RopeRuntime,
    request: RopeHitRequest | RopeCircleHitRequest
  ): boolean {
    return (
      runtime.active &&
      runtime.health > 0 &&
      runtime.hitId > 0 &&
      runtime.renderLayer === request.renderLayer &&
      !this.isRopeAlreadyHit(runtime.hitId, request)
    )
  }

  private canHitBridgeRopeRuntime(
    runtime: RopeBridgeRuntime,
    request: RopeHitRequest | RopeCircleHitRequest
  ): boolean {
    return (
      runtime.active &&
      runtime.health > 0 &&
      runtime.hitId > 0 &&
      runtime.renderLayer === request.renderLayer &&
      !this.isRopeAlreadyHit(runtime.hitId, request)
    )
  }

  private isRopeAlreadyHit(
    hitId: number,
    request: RopeHitRequest | RopeCircleHitRequest
  ): boolean {
    return request.weapon?.hitRopeIds.has(hitId) === true
  }

  private markRopeHit(
    hitId: number,
    request: RopeHitRequest | RopeCircleHitRequest
  ): void {
    const weapon = request.weapon
    if (!weapon) {
      return
    }
    weapon.hitRopeIds.add(hitId)
    weapon.groundHitSoundTriggered = true
    weapon.groundHitSoundPending = 0
  }

  private getRopeHitDamage(
    request: RopeHitRequest | RopeCircleHitRequest
  ): number {
    if (!(request.damage > 0)) {
      return 0
    }
    return Math.max(1, Math.trunc(request.damage))
  }

  private findHitRopeSegmentInOBB(
    segmentBodies: b2BodyId[],
    segmentCount: number,
    request: RopeHitRequest
  ): boolean {
    const count = Math.min(segmentCount, segmentBodies.length)
    if (count <= 0) {
      return false
    }

    this.hitRopeSegmentIndex = -1
    for (let i = 0; i < count; i++) {
      const bodyId = segmentBodies[i]
      if (!this.isBodyId(bodyId) || !this.box2d.b2Body_IsValid(bodyId)) {
        continue
      }
      const pos = this.box2d.b2Body_GetPosition(bodyId)
      const hit = checkOBBvsCircle(
        request.centerX,
        request.centerY,
        request.width,
        request.height,
        request.rotation,
        pos.x,
        pos.y,
        DEFAULT_GRAPPLE_ROPE_SEGMENT_RADIUS
      )
      if (hit) {
        this.hitRopeSegmentIndex = i
        this.hitRopeSegmentX = pos.x
        this.hitRopeSegmentY = pos.y
        pos.delete()
        return true
      }
      pos.delete()
    }

    return false
  }

  private findHitRopeSegmentInCircle(
    segmentBodies: b2BodyId[],
    segmentCount: number,
    request: RopeCircleHitRequest
  ): boolean {
    const count = Math.min(segmentCount, segmentBodies.length)
    if (count <= 0) {
      return false
    }

    const radius = request.radius + DEFAULT_GRAPPLE_ROPE_SEGMENT_RADIUS
    const radiusSq = radius * radius
    this.hitRopeSegmentIndex = -1
    for (let i = 0; i < count; i++) {
      const bodyId = segmentBodies[i]
      if (!this.isBodyId(bodyId) || !this.box2d.b2Body_IsValid(bodyId)) {
        continue
      }
      const pos = this.box2d.b2Body_GetPosition(bodyId)
      const dx = pos.x - request.centerX
      const dy = pos.y - request.centerY
      if (dx * dx + dy * dy <= radiusSq) {
        this.hitRopeSegmentIndex = i
        this.hitRopeSegmentX = pos.x
        this.hitRopeSegmentY = pos.y
        pos.delete()
        return true
      }
      pos.delete()
    }

    return false
  }

  private applyRopeHitFeedback(
    runtime: RopeRuntime | RopeBridgeRuntime,
    request: RopeHitRequest
  ): void {
    this.startRopeHitShake(runtime, request)
    this.emitRopeHitSound(this.hitRopeSegmentX, this.hitRopeSegmentY)
  }

  private applyRopeCircleHitFeedback(
    runtime: RopeRuntime | RopeBridgeRuntime,
    request: RopeCircleHitRequest
  ): void {
    this.startRopeCircleHitShake(runtime, request)
    this.emitRopeHitSound(this.hitRopeSegmentX, this.hitRopeSegmentY)
  }

  private startRopeHitShake(
    runtime: RopeRuntime | RopeBridgeRuntime,
    request: RopeHitRequest
  ): void {
    if (this.tryStartRopeHitShakeFromRequestDirection(runtime, request)) {
      return
    }
    const dx = this.hitRopeSegmentX - request.centerX
    const dy = this.hitRopeSegmentY - request.centerY
    const distSq = dx * dx + dy * dy
    let dirX = 0
    let dirY = 0
    if (distSq > 0.0001) {
      const invDist = 1 / Math.sqrt(distSq)
      dirX = dx * invDist
      dirY = dy * invDist
    } else {
      dirX = Math.cos(request.rotation)
      dirY = Math.sin(request.rotation)
    }

    this.startRopeHitShakeWithDirection(runtime, dirX, dirY)
  }

  private startRopeCircleHitShake(
    runtime: RopeRuntime | RopeBridgeRuntime,
    request: RopeCircleHitRequest
  ): void {
    if (this.tryStartRopeHitShakeFromRequestDirection(runtime, request)) {
      return
    }
    const dx = this.hitRopeSegmentX - request.centerX
    const dy = this.hitRopeSegmentY - request.centerY
    const distSq = dx * dx + dy * dy
    let dirX = 0
    let dirY = -1
    if (distSq > 0.0001) {
      const invDist = 1 / Math.sqrt(distSq)
      dirX = dx * invDist
      dirY = dy * invDist
    }

    this.startRopeHitShakeWithDirection(runtime, dirX, dirY)
  }

  private tryStartRopeHitShakeFromRequestDirection(
    runtime: RopeRuntime | RopeBridgeRuntime,
    request: RopeHitRequest | RopeCircleHitRequest
  ): boolean {
    const dirX = request.hitDirX ?? 0
    const dirY = request.hitDirY ?? 0
    const distSq = dirX * dirX + dirY * dirY
    if (distSq <= 0.0001) {
      return false
    }
    const invDist = 1 / Math.sqrt(distSq)
    this.startRopeHitShakeWithDirection(runtime, dirX * invDist, dirY * invDist)
    return true
  }

  private startRopeHitShakeWithDirection(
    runtime: RopeRuntime | RopeBridgeRuntime,
    dirX: number,
    dirY: number
  ): void {
    runtime.hitShakeSegmentIndex = this.hitRopeSegmentIndex
    runtime.hitShakeStartTimeMs = this.currentTimeMs
    runtime.hitShakeEndTimeMs = this.currentTimeMs + this.ropeHitShakeDurationMs
    runtime.hitShakeDirX = dirX
    runtime.hitShakeDirY = dirY
  }

  private emitRopeHitSound(x: number, y: number): void {
    this.statsSystem?.playSoundAt(SOUND_IDS.BODY_HIT, x, y)
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
    jointDef.maxLength = this.getRopeElasticLimitLength(length)

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

  private getVisiblePlayerRopeSegmentCount(runtime: RopeRuntime): number {
    const climbRuntime = this.findPlayerRopeClimbRuntime(runtime)
    if (
      climbRuntime?.active === true &&
      climbRuntime.sourceType === this.ropeClimbSourcePlayer
    ) {
      return Math.min(climbRuntime.maxNodeIndex, runtime.segmentBodies.length)
    }
    return runtime.attachIndex + 1
  }

  private findPlayerRopeClimbRuntime(
    runtime: RopeRuntime
  ): RopeClimbRuntime | null {
    for (const climbRuntime of this.ropeClimbRuntimeByEntityId.values()) {
      if (
        climbRuntime.active &&
        climbRuntime.sourceType === this.ropeClimbSourcePlayer &&
        climbRuntime.playerRuntime === runtime
      ) {
        return climbRuntime
      }
    }
    return null
  }

  private isDistanceAtRopeElasticLimit(
    distSq: number,
    ropeLength: number
  ): boolean {
    if (!(ropeLength > 0)) {
      return false
    }

    const denominatorSq =
      GRAPPLE_ROPE_ELASTIC_LIMIT_DENOMINATOR *
      GRAPPLE_ROPE_ELASTIC_LIMIT_DENOMINATOR
    const numeratorLength = ropeLength * GRAPPLE_ROPE_ELASTIC_LIMIT_NUMERATOR
    return distSq * denominatorSq >= numeratorLength * numeratorLength
  }

  private getRopeElasticLimitLength(ropeLength: number): number {
    return (
      (ropeLength * GRAPPLE_ROPE_ELASTIC_LIMIT_NUMERATOR) /
      GRAPPLE_ROPE_ELASTIC_LIMIT_DENOMINATOR
    )
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
    this.beginRopeJumpState(entity)
  }

  private startRopeJumpMotion(entity: Entity): void {
    if (!entity.physics || !entity.movement) {
      return
    }

    const currentVel = this.box2d.b2Body_GetLinearVelocity(
      entity.physics.bodyId
    )
    const currentVx = currentVel.x
    const currentVy = currentVel.y
    currentVel.delete()

    const jumpDeltaY =
      (-entity.movement.jumpForce * this.ropeJumpBaseUpwardScale) /
      this.ropeJumpScale

    this.tempVec.x = currentVx
    this.tempVec.y = currentVy + jumpDeltaY

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

    this.box2d.b2Body_SetLinearVelocity(entity.physics.bodyId, this.tempVec)
    this.beginRopeJumpState(entity)
  }

  private beginRopeJumpState(entity: Entity): void {
    if (!entity.movement) {
      return
    }

    entity.movement.isJumping = true
    entity.movement.jumpStartTime = this.currentTimeMs
    entity.movement.jumpElapsedTime = 0
    entity.movement.maxFallVelocity = 0
    entity.movement.fallStartY = 0
    entity.movement.isGrounded = false
  }

  private applyTetherSwingImpulse(
    entity: Entity,
    grapple: NonNullable<Entity['grapple']>
  ): void {
    if (!entity.physics || !entity.transform || entity.movement?.isGrounded) {
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

  private handleRopeNodeSwingInput(
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

    const nodeBodyId = this.getRopeClimbNodeBody(climbRuntime)
    if (!this.readBodyPosition(nodeBodyId, this.climbPointA)) {
      return
    }

    entity.input.lastMoveDirection = moveDir

    const currentVel = this.box2d.b2Body_GetLinearVelocity(
      entity.physics.bodyId
    )
    const currentVx = currentVel.x
    const currentVy = currentVel.y
    currentVel.delete()

    const dx = this.climbPointA.x - entity.transform.x
    const dy = this.climbPointA.y - entity.transform.y
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

    const mass = this.box2d.b2Body_GetMass(entity.physics.bodyId)
    const forceScale = useAssistForce
      ? this.swingForce
      : -this.swingForce * 0.67
    const deltaTime = deltaMs / 1000

    this.tempVec.x = tangentX * swingDir * forceScale * mass * deltaTime
    this.tempVec.y = tangentY * swingDir * forceScale * mass * deltaTime
    this.box2d.b2Body_ApplyForceToCenter(
      entity.physics.bodyId,
      this.tempVec,
      true
    )
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
