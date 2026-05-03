import {
  DEFAULT_GRAPPLE_PULL_STOP_DISTANCE,
  DEFAULT_GRAPPLE_RANGE,
  DEFAULT_GRAPPLE_ROPE_BEND_STIFFNESS,
  DEFAULT_GRAPPLE_ROPE_CLIMB_DAMPING_RATIO,
  DEFAULT_GRAPPLE_ROPE_CLIMB_HERTZ,
  DEFAULT_GRAPPLE_ROPE_CLIMB_JUMP_RECOIL_SCALE,
  DEFAULT_GRAPPLE_ROPE_CLIMB_LINEAR_DAMPING,
  DEFAULT_GRAPPLE_ROPE_CLIMB_WEIGHT_FORCE_SCALE,
  DEFAULT_GRAPPLE_ROPE_DAMPING_RATIO,
  DEFAULT_GRAPPLE_ROPE_DENSITY,
  DEFAULT_GRAPPLE_ROPE_ELASTIC_LIMIT_SCALE,
  DEFAULT_GRAPPLE_ROPE_HEALTH,
  DEFAULT_GRAPPLE_ROPE_HERTZ,
  DEFAULT_GRAPPLE_ROPE_LINEAR_DAMPING,
  DEFAULT_GRAPPLE_ROPE_MAX_SEGMENTS,
  DEFAULT_GRAPPLE_ROPE_MAX_STABLE_HERTZ,
  DEFAULT_GRAPPLE_ROPE_MIN_HERTZ,
  DEFAULT_GRAPPLE_ROPE_SEGMENT_LENGTH,
  DEFAULT_GRAPPLE_ROPE_SEGMENT_RADIUS,
  DEFAULT_GRAPPLE_SWING_FORCE,
  DEFAULT_PLAYER_FOV_RAD,
  DEFAULT_PLAYER_RADIUS,
} from '../../../constants'
import {
  getRopeCollisionCategory,
  getRopeCollisionMask,
} from '../../../physicsLayers'
import type {
  MainModule,
  b2BodyId,
  b2JointId,
  b2Rot,
  b2Vec2,
  b2WorldId,
} from '../../../types'
import type { Entity } from '../../Entity'
import type { World } from '../../World'
import type { StatsSystem } from '../StatsSystem'
import type {
  RopeBridgeRuntime,
  RopeClimbRuntime,
  RopeEndpointBuild,
  RopeRuntime,
} from './GrappleTypes'

export class GrappleSystemContext {
  readonly ropeClimbSourceNone = 0
  readonly ropeClimbSourcePlayer = 1
  readonly ropeClimbSourceBridge = 2
  readonly ropeClimbInteractRadius =
    DEFAULT_PLAYER_RADIUS + DEFAULT_GRAPPLE_ROPE_SEGMENT_LENGTH * 4
  readonly ropeClimbInteractRadiusSq =
    (DEFAULT_PLAYER_RADIUS + DEFAULT_GRAPPLE_ROPE_SEGMENT_LENGTH * 4) *
    (DEFAULT_PLAYER_RADIUS + DEFAULT_GRAPPLE_ROPE_SEGMENT_LENGTH * 4)
  readonly ropeClimbMinJointLength = DEFAULT_GRAPPLE_ROPE_SEGMENT_RADIUS
  readonly dynamicTetherBaseSpeed = 2
  readonly dynamicTetherStretchSpeed = 8
  readonly dynamicTetherMaxSpeed = 14
  readonly dynamicTetherRopeDensity = 0.05
  readonly maxRopesPerTetherTarget = 4
  readonly ropeRetractTensionSlack = DEFAULT_GRAPPLE_ROPE_SEGMENT_RADIUS * 2
  readonly ropeJumpScale = 1000
  readonly ropeJumpBaseUpwardScale = 600
  readonly ropeJumpAmplitudeBoostScale = 350
  readonly ropeJumpSpeedBoostScale = 250
  readonly ropeJumpReferenceSpeedSq = 144
  readonly ropeJumpMaxSpeedScale = 1500
  world: World
  box2d: MainModule
  worldId: b2WorldId
  tempVec: b2Vec2
  tempPointVec: b2Vec2
  tempRot: b2Rot
  currentTimeMs = 0
  anchorsDirty = true
  anchorEntities: Entity[] = []
  grappleTargetEntities: Entity[] = []
  tempTarget = { x: 0, y: 0 }
  statsSystem?: StatsSystem
  cosHalfFov = Math.cos(DEFAULT_PLAYER_FOV_RAD * 0.5)
  rangeSq = DEFAULT_GRAPPLE_RANGE * DEFAULT_GRAPPLE_RANGE
  stopDistanceSq =
    DEFAULT_GRAPPLE_PULL_STOP_DISTANCE * DEFAULT_GRAPPLE_PULL_STOP_DISTANCE
  ropeHideDistanceSq = DEFAULT_PLAYER_RADIUS * 2 * (DEFAULT_PLAYER_RADIUS * 2)
  ropeRuntimeByEntityId = new Map<number, RopeRuntime>()
  detachedPlayerRopes: RopeRuntime[] = []
  ropeClimbRuntimeByEntityId = new Map<number, RopeClimbRuntime>()
  bridgeRopes: RopeBridgeRuntime[] = []
  nextRopeHitId = 1
  hitRopeSegmentIndex = -1
  hitRopeSegmentX = 0
  hitRopeSegmentY = 0
  climbCandidateBridgeRuntime: RopeBridgeRuntime | null = null
  climbCandidatePlayerRuntime: RopeRuntime | null = null
  climbCandidateNodeIndex = -1
  climbCandidateDistSq = 0
  climbCandidatePathDistance = 0
  climbCandidateNormalOffset = 0
  readonly climbPointA = { x: 0, y: 0 }
  readonly climbPointB = { x: 0, y: 0 }
  climbAttachX = 0
  climbAttachY = 0
  climbTangentX = 0
  climbTangentY = 1
  climbNormalX = -1
  climbNormalY = 0
  climbPathLength = 0
  climbSegmentStartNodeIndex = 0
  climbSegmentRatio = 0
  readonly ropeHitShakeDurationMs = 220
  readonly ropeHitShakeAmplitude = 0.24
  readonly tetherEndpoint: RopeEndpointBuild = {
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
  readonly bridgeEndpointA: RopeEndpointBuild = {
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
  readonly bridgeEndpointB: RopeEndpointBuild = {
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
  readonly ropeBendPointXs = new Float32Array(
    DEFAULT_GRAPPLE_ROPE_MAX_SEGMENTS + 2
  )
  readonly ropeBendPointYs = new Float32Array(
    DEFAULT_GRAPPLE_ROPE_MAX_SEGMENTS + 2
  )
  ropeDensity = DEFAULT_GRAPPLE_ROPE_DENSITY
  ropeLinearDamping = DEFAULT_GRAPPLE_ROPE_LINEAR_DAMPING
  ropeHertz = DEFAULT_GRAPPLE_ROPE_HERTZ
  ropeDampingRatio = DEFAULT_GRAPPLE_ROPE_DAMPING_RATIO
  ropeBendStiffness = DEFAULT_GRAPPLE_ROPE_BEND_STIFFNESS
  ropeElasticLimitScale = DEFAULT_GRAPPLE_ROPE_ELASTIC_LIMIT_SCALE
  ropeClimbLinearDamping = DEFAULT_GRAPPLE_ROPE_CLIMB_LINEAR_DAMPING
  ropeClimbHertz = DEFAULT_GRAPPLE_ROPE_CLIMB_HERTZ
  ropeClimbDampingRatio = DEFAULT_GRAPPLE_ROPE_CLIMB_DAMPING_RATIO
  ropeClimbWeightForceScale = DEFAULT_GRAPPLE_ROPE_CLIMB_WEIGHT_FORCE_SCALE
  ropeClimbJumpRecoilScale = DEFAULT_GRAPPLE_ROPE_CLIMB_JUMP_RECOIL_SCALE
  swingForce = DEFAULT_GRAPPLE_SWING_FORCE

  updateExistingRopeSegments!: () => void
  updateExistingRopeJoints!: () => void

  constructor(world: World, box2d: MainModule, worldId: b2WorldId) {
    this.world = world
    this.box2d = box2d
    this.worldId = worldId
    this.tempVec = new box2d.b2Vec2(0, 0)
    this.tempPointVec = new box2d.b2Vec2(0, 0)
    this.tempRot = new box2d.b2Rot()
    this.tempRot.SetAngle(0)
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
    this.ropeHertz = this.clampRopeHertz(value)
    this.updateExistingRopeJoints()
  }

  setRopeDampingRatio(value: number): void {
    this.ropeDampingRatio = value
    this.updateExistingRopeJoints()
  }

  setRopeBendStiffness(value: number): void {
    this.ropeBendStiffness = Math.max(0, value)
  }

  setRopeElasticLimitScale(value: number): void {
    this.ropeElasticLimitScale = Math.max(0, value)
    this.updateExistingRopeJoints()
  }

  setRopeClimbLinearDamping(value: number): void {
    this.ropeClimbLinearDamping = Math.max(0, value)
    this.updateExistingRopeSegments()
  }

  setRopeClimbHertz(value: number): void {
    this.ropeClimbHertz = this.clampRopeHertz(value)
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

  clampRopeHertz(value: number): number {
    return Math.min(
      DEFAULT_GRAPPLE_ROPE_MAX_STABLE_HERTZ,
      Math.max(DEFAULT_GRAPPLE_ROPE_MIN_HERTZ, value)
    )
  }

  resetRopeHitShake(runtime: RopeRuntime | RopeBridgeRuntime): void {
    runtime.hitShakeSegmentIndex = -1
    runtime.hitShakeStartTimeMs = 0
    runtime.hitShakeEndTimeMs = 0
    runtime.hitShakeDirX = 0
    runtime.hitShakeDirY = 0
  }

  getDefaultRopeHealth(): number {
    return Math.max(1, Math.trunc(DEFAULT_GRAPPLE_ROPE_HEALTH))
  }

  getValidBodyId(entity: Entity): b2BodyId | null {
    const bodyId = entity.physics?.bodyId ?? entity.grappleTarget?.bodyId
    if (!this.isBodyId(bodyId) || !this.box2d.b2Body_IsValid(bodyId)) {
      return null
    }
    return bodyId
  }

  isBodyId(bodyId: b2BodyId | null | undefined): bodyId is b2BodyId {
    return bodyId !== null && bodyId !== undefined && typeof bodyId === 'object'
  }

  isJointId(jointId: b2JointId | null | undefined): jointId is b2JointId {
    return (
      jointId !== null && jointId !== undefined && typeof jointId === 'object'
    )
  }

  areBodyIdsEqual(a: b2BodyId, b: b2BodyId): boolean {
    return (
      a.index1 === b.index1 &&
      a.world0 === b.world0 &&
      a.generation === b.generation
    )
  }

  writeGrappleTargetWorldPoint(
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

  applyBodyVelocityCorrectionAtPoint(
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

  applyRopeBendStiffnessToBodyChain(
    startBodyId: b2BodyId | null,
    segmentBodies: b2BodyId[],
    segmentCount: number,
    endBodyId: b2BodyId | null
  ): void {
    const stiffness = this.ropeBendStiffness
    if (!(stiffness > 0)) {
      return
    }
    if (
      !this.isBodyId(startBodyId) ||
      !this.box2d.b2Body_IsValid(startBodyId)
    ) {
      return
    }

    const clampedSegmentCount = Math.max(
      0,
      Math.min(
        DEFAULT_GRAPPLE_ROPE_MAX_SEGMENTS,
        segmentCount,
        segmentBodies.length
      )
    )
    const startPosition = this.box2d.b2Body_GetPosition(startBodyId)
    this.ropeBendPointXs[0] = startPosition.x
    this.ropeBendPointYs[0] = startPosition.y
    startPosition.delete()

    let pointCount = 1
    for (let i = 0; i < clampedSegmentCount; i++) {
      const bodyId = segmentBodies[i]
      if (!this.isBodyId(bodyId) || !this.box2d.b2Body_IsValid(bodyId)) {
        return
      }
      const position = this.box2d.b2Body_GetPosition(bodyId)
      this.ropeBendPointXs[pointCount] = position.x
      this.ropeBendPointYs[pointCount] = position.y
      pointCount++
      position.delete()
    }

    if (this.isBodyId(endBodyId) && this.box2d.b2Body_IsValid(endBodyId)) {
      const endPosition = this.box2d.b2Body_GetPosition(endBodyId)
      this.ropeBendPointXs[pointCount] = endPosition.x
      this.ropeBendPointYs[pointCount] = endPosition.y
      pointCount++
      endPosition.delete()
    }

    if (pointCount < 3) {
      return
    }

    const maxCorrectionSpeed = Math.min(80, Math.max(4, stiffness * 2))
    const maxCorrectionSpeedSq = maxCorrectionSpeed * maxCorrectionSpeed
    for (let i = 1; i < pointCount - 1; i++) {
      const bodyId = segmentBodies[i - 1]
      if (
        !this.isBodyId(bodyId) ||
        !this.box2d.b2Body_IsValid(bodyId) ||
        this.box2d.b2Body_GetMass(bodyId) <= 0
      ) {
        continue
      }

      const targetX =
        (this.ropeBendPointXs[i - 1] + this.ropeBendPointXs[i + 1]) * 0.5
      const targetY =
        (this.ropeBendPointYs[i - 1] + this.ropeBendPointYs[i + 1]) * 0.5
      let addX = targetX - this.ropeBendPointXs[i]
      let addY = targetY - this.ropeBendPointYs[i]
      const spanX = this.ropeBendPointXs[i + 1] - this.ropeBendPointXs[i - 1]
      const spanY = this.ropeBendPointYs[i + 1] - this.ropeBendPointYs[i - 1]
      const spanSq = spanX * spanX + spanY * spanY
      if (spanSq > 0.0001) {
        const invSpan = 1 / Math.sqrt(spanSq)
        const tangentX = spanX * invSpan
        const tangentY = spanY * invSpan
        const along = addX * tangentX + addY * tangentY
        addX -= tangentX * along
        addY -= tangentY * along
      }
      addX *= stiffness
      addY *= stiffness
      const addSpeedSq = addX * addX + addY * addY
      if (addSpeedSq > maxCorrectionSpeedSq && addSpeedSq > 0) {
        const scale = maxCorrectionSpeed / Math.sqrt(addSpeedSq)
        addX *= scale
        addY *= scale
      }

      const velocity = this.box2d.b2Body_GetLinearVelocity(bodyId)
      this.tempVec.x = velocity.x + addX
      this.tempVec.y = velocity.y + addY
      this.box2d.b2Body_SetLinearVelocity(bodyId, this.tempVec)
      this.box2d.b2Body_SetAwake(bodyId, true)
      velocity.delete()
    }
  }

  getEntityById(id: number): Entity | null {
    const entities = this.world.getEntities()
    for (let i = 0; i < entities.length; i++) {
      const entity = entities[i]
      if (entity.id === id) {
        return entity
      }
    }
    return null
  }

  readBodyPosition(
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

  createAnchorBody(x: number, y: number): b2BodyId {
    const bodyDef = this.box2d.b2DefaultBodyDef()
    bodyDef.type = this.box2d.b2BodyType.b2_staticBody
    bodyDef.position.Set(x, y)
    const bodyId = this.box2d.b2CreateBody(this.worldId, bodyDef)
    bodyDef.delete()
    return bodyId
  }

  createKinematicAnchorBody(x: number, y: number): b2BodyId {
    const bodyDef = this.box2d.b2DefaultBodyDef()
    bodyDef.type = this.box2d.b2BodyType.b2_kinematicBody
    bodyDef.position.Set(x, y)
    const bodyId = this.box2d.b2CreateBody(this.worldId, bodyDef)
    bodyDef.delete()
    return bodyId
  }

  createRopeSegmentBody(
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

  createFixedDistanceJoint(
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

  updateRopeJointLengthRange(jointId: b2JointId): void {
    if (!this.isJointId(jointId) || !this.box2d.b2Joint_IsValid(jointId)) {
      return
    }
    const length = this.box2d.b2DistanceJoint_GetLength(jointId)
    this.box2d.b2DistanceJoint_SetLengthRange(
      jointId,
      0,
      this.getRopeElasticLimitLength(length)
    )
  }

  createBodyCollisionFilterJoint(
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

  destroyJointIfValid(jointId: b2JointId | null): void {
    if (!this.isJointId(jointId) || !this.box2d.b2Joint_IsValid(jointId)) {
      return
    }
    this.box2d.b2DestroyJoint(jointId, true)
  }

  destroyBodyIfValid(bodyId: b2BodyId | null): void {
    if (!this.isBodyId(bodyId) || !this.box2d.b2Body_IsValid(bodyId)) {
      return
    }
    this.box2d.b2DestroyBody(bodyId)
  }

  calculateCurrentRopeLength(runtime: RopeRuntime): number {
    const attachedSegments = runtime.attachIndex + 1
    return attachedSegments * runtime.linkLength + runtime.jointMaxLen
  }

  getVisiblePlayerRopeSegmentCount(runtime: RopeRuntime): number {
    const climbRuntime = this.findPlayerRopeClimbRuntime(runtime)
    if (
      climbRuntime?.active === true &&
      climbRuntime.sourceType === this.ropeClimbSourcePlayer
    ) {
      return Math.min(climbRuntime.maxNodeIndex, runtime.segmentBodies.length)
    }
    return runtime.attachIndex + 1
  }

  findPlayerRopeClimbRuntime(runtime: RopeRuntime): RopeClimbRuntime | null {
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

  isDistanceAtRopeElasticLimit(distSq: number, ropeLength: number): boolean {
    if (!(ropeLength > 0)) {
      return false
    }
    const limitLength = ropeLength * this.ropeElasticLimitScale
    return distSq >= limitLength * limitLength
  }

  getRopeElasticLimitLength(ropeLength: number): number {
    return ropeLength * this.ropeElasticLimitScale
  }
}
