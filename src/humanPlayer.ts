import type {
  MainModule,
  b2BodyId,
  b2JointId,
  b2ShapeId,
  b2Vec2,
  b2WorldId,
} from './types'

const boneId_hip = 0
const boneId_torso = 1
const boneId_head = 2
const boneId_upperLeftLeg = 3
const boneId_lowerLeftLeg = 4
const boneId_upperRightLeg = 5
const boneId_lowerRightLeg = 6
const boneId_upperLeftArm = 7
const boneId_lowerLeftArm = 8
const boneId_upperRightArm = 9
const boneId_lowerRightArm = 10
const boneId_count = 11
const armBoneIds = [
  boneId_upperLeftArm,
  boneId_lowerLeftArm,
  boneId_upperRightArm,
  boneId_lowerRightArm,
]

interface Bone {
  bodyId: b2BodyId
  jointId?: b2JointId
  shapeIds: Array<{
    id: b2ShapeId
    frictionType: 'body' | 'foot'
  }>
  frictionScale: number
  parentIndex: number
}

export class HumanPlayer {
  private box2d: MainModule
  private worldId: b2WorldId
  private bones: Bone[] = []
  private scale = 1.0
  private isAlive = true
  private facingRight = true

  private moveSpeed = 5
  private jumpForce = 15
  private maxJumpHeight = 1.2
  private isGrounded = false
  private isTouchingWall = false
  private lastMoveDirection = 0
  private wallJumpTime = 0
  private maxWallJumps = 1
  private wallJumpCount = 0
  private isJumping = false
  private jumpStartTime = 0
  private maxJumpDuration = 500
  private wallDirection = 0
  private groundedIgnoreUntil = 0
  private jumpGroundGraceMs = 80
  private debugJump = false
  private loggedGroundedCancel = false
  private wasGrounded = false
  private springEnabled = true
  private groundedLatchUntil = 0
  private groundedLatchMs = 160
  private groundedReleaseVelocity = -2.0
  private groundContact = false
  private wallContact = false
  private wallLatchUntil = 0
  private wallLatchMs = 120
  private wallLatchDirection = 0
  private wallProximityDirection = 0
  private airControlDrag = 0.985
  private renderOffsetY = 0
  private renderSmoothedY = 0
  private renderSmoothingGround = 0.25

  // Jump multipliers
  private wallJumpPushAwayMultiplier = 1.5
  private wallJumpUpwardMultiplier = 0.8
  private jumpForceMultiplier = 0.8

  private frictionTorque = 20.0
  private hertz = 8.0
  private dampingRatio = 1.0
  // Friction and damping parameters
  private bodyFriction = 1.0
  private footFriction = 20.0
  private hipLinearDamping = 0.5
  private bodyLinearDamping = 0.0

  constructor(
    box2d: MainModule,
    worldId: b2WorldId,
    x: number,
    y: number,
    scale = 1.0
  ) {
    this.box2d = box2d
    this.worldId = worldId
    this.scale = scale

    this.createBones(worldId, x, y)
    this.setupGroundCheck()
  }

  private createBones(worldId: b2WorldId, x: number, y: number) {
    const {
      b2DefaultBodyDef,
      b2BodyType,
      b2DefaultShapeDef,
      b2CreateBody,
      b2Capsule,
      b2CreateCapsuleShape,
      b2ComputeHull,
      b2MakePolygon,
      b2CreatePolygonShape,
      b2Vec2,
      B2_PI,
    } = this.box2d

    const position = new b2Vec2(x, y)

    const bodyDef = b2DefaultBodyDef()
    bodyDef.type = b2BodyType.b2_dynamicBody
    bodyDef.sleepThreshold = 0.1

    const shapeDef = b2DefaultShapeDef()
    shapeDef.material.friction = this.bodyFriction
    shapeDef.material.restitution = 0
    shapeDef.density = 50.0
    shapeDef.filter.groupIndex = -1

    const footShapeDef = b2DefaultShapeDef()
    footShapeDef.material.friction = this.footFriction
    footShapeDef.material.restitution = 0
    footShapeDef.density = 50.0
    footShapeDef.filter.groupIndex = -1

    const s = this.scale
    const maxTorque = this.frictionTorque * s
    const enableMotor = true
    const enableLimit = true

    this.bones[boneId_hip] = {
      bodyId: {} as b2BodyId,
      shapeIds: [],
      frictionScale: 1.0,
      parentIndex: -1,
    }

    bodyDef.position.Set(0.0, -0.95 * s)
    bodyDef.position.Add(position)
    bodyDef.linearDamping = this.hipLinearDamping
    bodyDef.motionLocks.angularZ = true
    this.bones[boneId_hip].bodyId = b2CreateBody(worldId, bodyDef)

    const hipCapsule = new b2Capsule()
    hipCapsule.center1.Set(0.0, -0.02 * s)
    hipCapsule.center2.Set(0.0, 0.02 * s)
    hipCapsule.radius = 0.095 * s
    const hipShapeId = b2CreateCapsuleShape(
      this.bones[boneId_hip].bodyId,
      shapeDef,
      hipCapsule
    )
    this.bones[boneId_hip].shapeIds.push({
      id: hipShapeId,
      frictionType: 'body',
    })
    hipCapsule.delete()

    this.bones[boneId_torso] = {
      bodyId: {} as b2BodyId,
      shapeIds: [],
      frictionScale: 0.5,
      parentIndex: boneId_hip,
    }
    bodyDef.position.Set(0.0, -1.2 * s)
    bodyDef.position.Add(position)
    bodyDef.linearDamping = this.bodyLinearDamping
    bodyDef.motionLocks.angularZ = true
    this.bones[boneId_torso].bodyId = b2CreateBody(worldId, bodyDef)

    const torsoCapsule = new b2Capsule()
    torsoCapsule.center1.Set(0.0, -0.135 * s)
    torsoCapsule.center2.Set(0.0, 0.135 * s)
    torsoCapsule.radius = 0.09 * s
    const torsoShapeId = b2CreateCapsuleShape(
      this.bones[boneId_torso].bodyId,
      shapeDef,
      torsoCapsule
    )
    this.bones[boneId_torso].shapeIds.push({
      id: torsoShapeId,
      frictionType: 'body',
    })
    torsoCapsule.delete()

    const torsoPivot = new b2Vec2(0.0, -1.0 * s)
    torsoPivot.Add(position)
    this.createJoint(
      worldId,
      this.bones[boneId_torso],
      torsoPivot,
      -0.25 * B2_PI,
      0.0,
      maxTorque,
      enableMotor,
      enableLimit
    )
    torsoPivot.delete()

    this.bones[boneId_head] = {
      bodyId: {} as b2BodyId,
      shapeIds: [],
      frictionScale: 0.25,
      parentIndex: boneId_torso,
    }
    bodyDef.position.Set(0.0, -1.475 * s)
    bodyDef.position.Add(position)
    bodyDef.linearDamping = 0.1
    this.bones[boneId_head].bodyId = b2CreateBody(worldId, bodyDef)

    const headCapsule = new b2Capsule()
    headCapsule.center1.Set(0.0, -0.038 * s)
    headCapsule.center2.Set(0.0, 0.039 * s)
    headCapsule.radius = 0.075 * s
    const headShapeId = b2CreateCapsuleShape(
      this.bones[boneId_head].bodyId,
      shapeDef,
      headCapsule
    )
    this.bones[boneId_head].shapeIds.push({
      id: headShapeId,
      frictionType: 'body',
    })
    headCapsule.delete()

    const headPivot = new b2Vec2(0.0, -1.4 * s)
    headPivot.Add(position)
    this.createJoint(
      worldId,
      this.bones[boneId_head],
      headPivot,
      -0.3 * B2_PI,
      0.1 * B2_PI,
      maxTorque,
      enableMotor,
      enableLimit
    )
    headPivot.delete()

    this.bones[boneId_upperLeftLeg] = {
      bodyId: {} as b2BodyId,
      shapeIds: [],
      frictionScale: 1.0,
      parentIndex: boneId_hip,
    }
    bodyDef.position.Set(-0.06 * s, -0.775 * s)
    bodyDef.position.Add(position)
    bodyDef.linearDamping = this.bodyLinearDamping
    this.bones[boneId_upperLeftLeg].bodyId = b2CreateBody(worldId, bodyDef)

    const upperLegCapsule = new b2Capsule()
    upperLegCapsule.center1.Set(0.0, -0.125 * s)
    upperLegCapsule.center2.Set(0.0, 0.125 * s)
    upperLegCapsule.radius = 0.06 * s
    const upperLeftLegShapeId = b2CreateCapsuleShape(
      this.bones[boneId_upperLeftLeg].bodyId,
      shapeDef,
      upperLegCapsule
    )
    this.bones[boneId_upperLeftLeg].shapeIds.push({
      id: upperLeftLegShapeId,
      frictionType: 'body',
    })

    const upperLeftLegPivot = new b2Vec2(-0.06 * s, -0.9 * s)
    upperLeftLegPivot.Add(position)
    this.createJoint(
      worldId,
      this.bones[boneId_upperLeftLeg],
      upperLeftLegPivot,
      -0.05 * B2_PI,
      0.4 * B2_PI,
      maxTorque,
      enableMotor,
      enableLimit
    )
    upperLeftLegPivot.delete()

    const footPoints = [
      new b2Vec2(-0.1 * s, -0.185 * s),
      new b2Vec2(0.1 * s, -0.185 * s),
      new b2Vec2(0.1 * s, -0.155 * s),
      new b2Vec2(-0.1 * s, -0.155 * s),
    ]
    const footHull = b2ComputeHull(footPoints)
    const footPolygon = b2MakePolygon(footHull, 0.0)

    this.bones[boneId_lowerLeftLeg] = {
      bodyId: {} as b2BodyId,
      shapeIds: [],
      frictionScale: 0.5,
      parentIndex: boneId_upperLeftLeg,
    }
    bodyDef.position.Set(-0.06 * s, -0.475 * s)
    bodyDef.position.Add(position)
    bodyDef.linearDamping = this.bodyLinearDamping
    this.bones[boneId_lowerLeftLeg].bodyId = b2CreateBody(worldId, bodyDef)

    const lowerLegCapsule = new b2Capsule()
    lowerLegCapsule.center1.Set(0.0, -0.125 * s)
    lowerLegCapsule.center2.Set(0.0, 0.125 * s)
    lowerLegCapsule.radius = 0.045 * s
    const lowerLeftLegShapeId = b2CreateCapsuleShape(
      this.bones[boneId_lowerLeftLeg].bodyId,
      shapeDef,
      lowerLegCapsule
    )
    this.bones[boneId_lowerLeftLeg].shapeIds.push({
      id: lowerLeftLegShapeId,
      frictionType: 'body',
    })
    const lowerLeftFootShapeId = b2CreatePolygonShape(
      this.bones[boneId_lowerLeftLeg].bodyId,
      footShapeDef,
      footPolygon
    )
    this.bones[boneId_lowerLeftLeg].shapeIds.push({
      id: lowerLeftFootShapeId,
      frictionType: 'foot',
    })

    const lowerLeftLegPivot = new b2Vec2(-0.06 * s, -0.625 * s)
    lowerLeftLegPivot.Add(position)
    this.createJoint(
      worldId,
      this.bones[boneId_lowerLeftLeg],
      lowerLeftLegPivot,
      -0.5 * B2_PI,
      -0.02 * B2_PI,
      maxTorque,
      enableMotor,
      enableLimit
    )
    lowerLeftLegPivot.delete()

    this.bones[boneId_upperRightLeg] = {
      bodyId: {} as b2BodyId,
      shapeIds: [],
      frictionScale: 1.0,
      parentIndex: boneId_hip,
    }
    bodyDef.position.Set(0.06 * s, -0.775 * s)
    bodyDef.position.Add(position)
    bodyDef.linearDamping = this.bodyLinearDamping
    this.bones[boneId_upperRightLeg].bodyId = b2CreateBody(worldId, bodyDef)

    const upperRightLegShapeId = b2CreateCapsuleShape(
      this.bones[boneId_upperRightLeg].bodyId,
      shapeDef,
      upperLegCapsule
    )
    this.bones[boneId_upperRightLeg].shapeIds.push({
      id: upperRightLegShapeId,
      frictionType: 'body',
    })
    upperLegCapsule.delete()

    const upperRightLegPivot = new b2Vec2(0.06 * s, -0.9 * s)
    upperRightLegPivot.Add(position)
    this.createJoint(
      worldId,
      this.bones[boneId_upperRightLeg],
      upperRightLegPivot,
      -0.05 * B2_PI,
      0.4 * B2_PI,
      maxTorque,
      enableMotor,
      enableLimit
    )
    upperRightLegPivot.delete()

    this.bones[boneId_lowerRightLeg] = {
      bodyId: {} as b2BodyId,
      shapeIds: [],
      frictionScale: 0.5,
      parentIndex: boneId_upperRightLeg,
    }
    bodyDef.position.Set(0.06 * s, -0.475 * s)
    bodyDef.position.Add(position)
    bodyDef.linearDamping = this.bodyLinearDamping
    this.bones[boneId_lowerRightLeg].bodyId = b2CreateBody(worldId, bodyDef)

    const lowerRightLegShapeId = b2CreateCapsuleShape(
      this.bones[boneId_lowerRightLeg].bodyId,
      shapeDef,
      lowerLegCapsule
    )
    this.bones[boneId_lowerRightLeg].shapeIds.push({
      id: lowerRightLegShapeId,
      frictionType: 'body',
    })
    const lowerRightFootShapeId = b2CreatePolygonShape(
      this.bones[boneId_lowerRightLeg].bodyId,
      footShapeDef,
      footPolygon
    )
    this.bones[boneId_lowerRightLeg].shapeIds.push({
      id: lowerRightFootShapeId,
      frictionType: 'foot',
    })
    lowerLegCapsule.delete()

    const lowerRightLegPivot = new b2Vec2(0.06 * s, -0.625 * s)
    lowerRightLegPivot.Add(position)
    this.createJoint(
      worldId,
      this.bones[boneId_lowerRightLeg],
      lowerRightLegPivot,
      -0.5 * B2_PI,
      -0.02 * B2_PI,
      maxTorque,
      enableMotor,
      enableLimit
    )
    lowerRightLegPivot.delete()

    this.bones[boneId_upperLeftArm] = {
      bodyId: {} as b2BodyId,
      shapeIds: [],
      frictionScale: 0.5,
      parentIndex: boneId_torso,
    }
    bodyDef.position.Set(0.0, -1.225 * s)
    bodyDef.position.Add(position)
    bodyDef.linearDamping = this.bodyLinearDamping
    this.bones[boneId_upperLeftArm].bodyId = b2CreateBody(worldId, bodyDef)

    const armCapsule = new b2Capsule()
    armCapsule.center1.Set(0.0, -0.125 * s)
    armCapsule.center2.Set(0.0, 0.125 * s)
    armCapsule.radius = 0.035 * s
    const upperLeftArmShapeId = b2CreateCapsuleShape(
      this.bones[boneId_upperLeftArm].bodyId,
      shapeDef,
      armCapsule
    )
    this.bones[boneId_upperLeftArm].shapeIds.push({
      id: upperLeftArmShapeId,
      frictionType: 'body',
    })

    const upperLeftArmPivot = new b2Vec2(0.0, -1.35 * s)
    upperLeftArmPivot.Add(position)
    this.createJoint(
      worldId,
      this.bones[boneId_upperLeftArm],
      upperLeftArmPivot,
      -0.1 * B2_PI,
      0.8 * B2_PI,
      maxTorque,
      enableMotor,
      enableLimit,
      -0.5 * B2_PI
    )
    upperLeftArmPivot.delete()

    this.bones[boneId_lowerLeftArm] = {
      bodyId: {} as b2BodyId,
      shapeIds: [],
      frictionScale: 0.1,
      parentIndex: boneId_upperLeftArm,
    }
    bodyDef.position.Set(0.0, -0.975 * s)
    bodyDef.position.Add(position)
    bodyDef.linearDamping = 0.1
    this.bones[boneId_lowerLeftArm].bodyId = b2CreateBody(worldId, bodyDef)

    const lowerArmCapsule = new b2Capsule()
    lowerArmCapsule.center1.Set(0.0, -0.125 * s)
    lowerArmCapsule.center2.Set(0.0, 0.125 * s)
    lowerArmCapsule.radius = 0.03 * s
    const lowerLeftArmShapeId = b2CreateCapsuleShape(
      this.bones[boneId_lowerLeftArm].bodyId,
      shapeDef,
      lowerArmCapsule
    )
    this.bones[boneId_lowerLeftArm].shapeIds.push({
      id: lowerLeftArmShapeId,
      frictionType: 'body',
    })

    const lowerLeftArmPivot = new b2Vec2(0.0, -1.1 * s)
    lowerLeftArmPivot.Add(position)
    this.createJoint(
      worldId,
      this.bones[boneId_lowerLeftArm],
      lowerLeftArmPivot,
      -0.4 * B2_PI,
      0.4 * B2_PI,
      maxTorque,
      enableMotor,
      enableLimit,
      0
    )
    lowerLeftArmPivot.delete()

    this.bones[boneId_upperRightArm] = {
      bodyId: {} as b2BodyId,
      shapeIds: [],
      frictionScale: 0.5,
      parentIndex: boneId_torso,
    }
    bodyDef.position.Set(0.0, -1.225 * s)
    bodyDef.position.Add(position)
    bodyDef.linearDamping = this.bodyLinearDamping
    this.bones[boneId_upperRightArm].bodyId = b2CreateBody(worldId, bodyDef)

    const upperRightArmShapeId = b2CreateCapsuleShape(
      this.bones[boneId_upperRightArm].bodyId,
      shapeDef,
      armCapsule
    )
    this.bones[boneId_upperRightArm].shapeIds.push({
      id: upperRightArmShapeId,
      frictionType: 'body',
    })
    armCapsule.delete()

    const upperRightArmPivot = new b2Vec2(0.0, -1.35 * s)
    upperRightArmPivot.Add(position)
    this.createJoint(
      worldId,
      this.bones[boneId_upperRightArm],
      upperRightArmPivot,
      -0.1 * B2_PI,
      0.8 * B2_PI,
      maxTorque,
      enableMotor,
      enableLimit,
      -0.5 * B2_PI
    )
    upperRightArmPivot.delete()

    this.bones[boneId_lowerRightArm] = {
      bodyId: {} as b2BodyId,
      shapeIds: [],
      frictionScale: 0.1,
      parentIndex: boneId_upperRightArm,
    }
    bodyDef.position.Set(0.0, -0.975 * s)
    bodyDef.position.Add(position)
    bodyDef.linearDamping = 0.1
    this.bones[boneId_lowerRightArm].bodyId = b2CreateBody(worldId, bodyDef)

    const lowerRightArmShapeId = b2CreateCapsuleShape(
      this.bones[boneId_lowerRightArm].bodyId,
      shapeDef,
      lowerArmCapsule
    )
    this.bones[boneId_lowerRightArm].shapeIds.push({
      id: lowerRightArmShapeId,
      frictionType: 'body',
    })
    lowerArmCapsule.delete()

    const lowerRightArmPivot = new b2Vec2(0.0, -1.1 * s)
    lowerRightArmPivot.Add(position)
    this.createJoint(
      worldId,
      this.bones[boneId_lowerRightArm],
      lowerRightArmPivot,
      -0.4 * B2_PI,
      0.4 * B2_PI,
      maxTorque,
      enableMotor,
      enableLimit,
      0
    )
    lowerRightArmPivot.delete()

    footPoints.forEach((point) => point.delete())
    footHull.delete()
    footPolygon.delete()
    bodyDef.delete()
    shapeDef.delete()
    footShapeDef.delete()
    position.delete()
  }

  private createJoint(
    worldId: b2WorldId,
    bone: Bone,
    pivot: b2Vec2,
    lowerAngle: number,
    upperAngle: number,
    maxTorque: number,
    enableMotor: boolean,
    enableLimit: boolean,
    referenceAngle = 0
  ) {
    const {
      b2DefaultRevoluteJointDef,
      b2CreateRevoluteJoint,
      b2Body_GetLocalPoint,
    } = this.box2d

    const jointDef = b2DefaultRevoluteJointDef()
    jointDef.base.bodyIdA = this.bones[bone.parentIndex].bodyId
    jointDef.base.bodyIdB = bone.bodyId

    const localPosA = b2Body_GetLocalPoint(jointDef.base.bodyIdA, pivot)
    const localPosB = b2Body_GetLocalPoint(jointDef.base.bodyIdB, pivot)

    jointDef.base.localFrameA.p.Copy(localPosA)
    jointDef.base.localFrameB.p.Copy(localPosB)
    jointDef.base.localFrameB.q.SetAngle(referenceAngle)
    jointDef.enableLimit = enableLimit
    jointDef.lowerAngle = lowerAngle
    jointDef.upperAngle = upperAngle
    jointDef.enableMotor = enableMotor
    jointDef.maxMotorTorque = bone.frictionScale * maxTorque
    jointDef.enableSpring = this.hertz > 0.0
    jointDef.hertz = this.hertz
    jointDef.dampingRatio = this.dampingRatio

    bone.jointId = b2CreateRevoluteJoint(worldId, jointDef)

    jointDef.delete()
    localPosA.delete()
    localPosB.delete()
  }

  private setupGroundCheck() {
    setInterval(() => {
      this.updateGroundedStatus()
      this.updateWallStatus()
    }, 50)
  }

  private updateWallStatus() {
    const { b2Body_GetContactData, b2Body_GetContactCapacity } = this.box2d
    const capacity = b2Body_GetContactCapacity(this.bones[boneId_torso].bodyId)
    const contactData = b2Body_GetContactData(
      this.bones[boneId_torso].bodyId,
      capacity
    )

    this.isTouchingWall = false
    this.wallContact = false
    let newWallDirection = 0

    for (let i = 0; i < contactData.length; i++) {
      const contact = contactData[i]
      const normal = contact.manifold.normal

      if (Math.abs(normal.x) > 0.7) {
        this.isTouchingWall = true
        this.wallContact = true
        if (normal.x > 0) {
          newWallDirection = -1
        } else {
          newWallDirection = 1
        }
        contact.delete()
        break
      }

      contact.delete()
    }

    if (this.isTouchingWall) {
      this.wallDirection = newWallDirection
      this.wallLatchUntil = Date.now() + this.wallLatchMs
      this.wallLatchDirection = newWallDirection
    } else {
      this.wallDirection = 0
    }
  }
  private getFootContactInfo(bodyId: b2BodyId) {
    const { b2Body_GetContactCapacity, b2Body_GetContactData } = this.box2d
    const capacity = b2Body_GetContactCapacity(bodyId)
    if (capacity === 0) {
      return { hasContact: false, maxAbsNormalY: 0 }
    }

    const contactData = b2Body_GetContactData(bodyId, capacity)
    let maxAbsNormalY = 0

    for (let i = 0; i < contactData.length; i++) {
      const contact = contactData[i]
      const normal = contact.manifold.normal
      maxAbsNormalY = Math.max(maxAbsNormalY, Math.abs(normal.y))
      contact.delete()
    }

    return { hasContact: true, maxAbsNormalY }
  }

  private updateGroundedStatus() {
    const { b2Body_GetLinearVelocity } = this.box2d
    const leftFootInfo = this.getFootContactInfo(
      this.bones[boneId_lowerLeftLeg].bodyId
    )
    const rightFootInfo = this.getFootContactInfo(
      this.bones[boneId_lowerRightLeg].bodyId
    )
    const maxAbsNormalY = Math.max(
      leftFootInfo.maxAbsNormalY,
      rightFootInfo.maxAbsNormalY
    )
    const hasFootContact = leftFootInfo.hasContact || rightFootInfo.hasContact
    this.groundContact = hasFootContact && maxAbsNormalY > 0.3

    const now = Date.now()
    const hasContact = this.groundContact
    if (hasContact) {
      this.groundedLatchUntil = now + this.groundedLatchMs
      this.isGrounded = true
      return
    }

    if (now < this.groundedLatchUntil) {
      const velocity = b2Body_GetLinearVelocity(this.bones[boneId_hip].bodyId)
      const shouldRelease = velocity.y < this.groundedReleaseVelocity
      velocity.delete()
      this.isGrounded = !shouldRelease
      return
    }

    this.isGrounded = false
  }

  setAlive(alive: boolean) {
    this.isAlive = alive
    const { b2Body_SetAngularVelocity } = this.box2d

    if (alive) {
      this.setJointSpringHertz(this.hertz)
      this.setJointFrictionTorque(this.frictionTorque * this.scale)
      this.setJointDampingRatio(this.dampingRatio)

      b2Body_SetAngularVelocity(this.bones[boneId_hip].bodyId, 0)
      b2Body_SetAngularVelocity(this.bones[boneId_torso].bodyId, 0)
    } else {
      this.setJointSpringHertz(0)
      this.setJointFrictionTorque(0)
    }
  }

  private setJointFrictionTorque(torque: number) {
    if (torque === 0.0) {
      for (let i = 1; i < boneId_count; i++) {
        const jointId = this.bones[i].jointId
        if (jointId) {
          this.box2d.b2RevoluteJoint_EnableMotor(jointId, false)
        }
      }
    } else {
      for (let i = 1; i < boneId_count; i++) {
        const jointId = this.bones[i].jointId
        if (jointId) {
          this.box2d.b2RevoluteJoint_EnableMotor(jointId, true)
          const scale = this.scale * this.bones[i].frictionScale
          this.box2d.b2RevoluteJoint_SetMaxMotorTorque(jointId, scale * torque)
        }
      }
    }
  }

  private setJointSpringHertz(hertz: number) {
    if (hertz === 0.0) {
      for (let i = 1; i < boneId_count; i++) {
        const jointId = this.bones[i].jointId
        if (jointId) {
          this.box2d.b2RevoluteJoint_EnableSpring(jointId, false)
        }
      }
    } else {
      for (let i = 1; i < boneId_count; i++) {
        const jointId = this.bones[i].jointId
        if (jointId) {
          this.box2d.b2RevoluteJoint_EnableSpring(jointId, true)
          this.box2d.b2RevoluteJoint_SetSpringHertz(jointId, hertz)
        }
      }
    }
  }

  private setJointSpringHertzForBones(boneIds: number[], hertz: number) {
    if (hertz === 0.0) {
      for (const boneId of boneIds) {
        const jointId = this.bones[boneId].jointId
        if (jointId) {
          this.box2d.b2RevoluteJoint_EnableSpring(jointId, false)
        }
      }
    } else {
      for (const boneId of boneIds) {
        const jointId = this.bones[boneId].jointId
        if (jointId) {
          this.box2d.b2RevoluteJoint_EnableSpring(jointId, true)
          this.box2d.b2RevoluteJoint_SetSpringHertz(jointId, hertz)
        }
      }
    }
  }

  private setJointDampingRatio(dampingRatio: number) {
    for (let i = 1; i < boneId_count; i++) {
      const jointId = this.bones[i].jointId
      if (jointId) {
        this.box2d.b2RevoluteJoint_SetSpringDampingRatio(jointId, dampingRatio)
      }
    }
  }

  private resetMovementDamping() {
    const { b2Body_SetLinearDamping } = this.box2d
    b2Body_SetLinearDamping(
      this.bones[boneId_hip].bodyId,
      this.hipLinearDamping
    )
    b2Body_SetLinearDamping(
      this.bones[boneId_upperLeftLeg].bodyId,
      this.bodyLinearDamping
    )
    b2Body_SetLinearDamping(
      this.bones[boneId_upperRightLeg].bodyId,
      this.bodyLinearDamping
    )
    b2Body_SetLinearDamping(
      this.bones[boneId_lowerLeftLeg].bodyId,
      this.bodyLinearDamping
    )
    b2Body_SetLinearDamping(
      this.bones[boneId_lowerRightLeg].bodyId,
      this.bodyLinearDamping
    )
  }

  private stopHorizontalMotion() {
    const { b2Body_GetLinearVelocity, b2Body_SetLinearVelocity, b2Vec2 } =
      this.box2d
    const stopVelocityThreshold = 0.05

    for (let i = 0; i < boneId_count; i++) {
      const bodyId = this.bones[i].bodyId
      const velocity = b2Body_GetLinearVelocity(bodyId)
      if (Math.abs(velocity.x) < stopVelocityThreshold) {
        continue
      }

      const stoppedVelocity = new b2Vec2(0, velocity.y)
      b2Body_SetLinearVelocity(bodyId, stoppedVelocity)
      stoppedVelocity.delete()
    }
  }

  private resetLandingMotion() {
    const {
      b2Body_GetLinearVelocity,
      b2Body_SetLinearVelocity,
      b2Body_SetAngularVelocity,
      b2Vec2,
    } = this.box2d

    for (let i = 0; i < boneId_count; i++) {
      const bodyId = this.bones[i].bodyId
      const velocity = b2Body_GetLinearVelocity(bodyId)
      const clampedVelocity = new b2Vec2(velocity.x, 0)
      b2Body_SetLinearVelocity(bodyId, clampedVelocity)
      b2Body_SetAngularVelocity(bodyId, 0)
      clampedVelocity.delete()
      velocity.delete()
    }
  }

  private setSpringEnabled(enabled: boolean) {
    if (this.springEnabled === enabled) {
      return
    }

    this.springEnabled = enabled
    if (enabled) {
      this.setJointSpringHertz(this.hertz)
    } else {
      this.setJointSpringHertz(0)
      this.setJointSpringHertzForBones(armBoneIds, this.hertz)
    }
  }

  private clampUpwardVelocityWhileGrounded() {
    const { b2Body_GetLinearVelocity, b2Body_SetLinearVelocity, b2Vec2 } =
      this.box2d

    for (let i = 0; i < boneId_count; i++) {
      const bodyId = this.bones[i].bodyId
      const velocity = b2Body_GetLinearVelocity(bodyId)
      if (velocity.y >= 0) {
        velocity.delete()
        continue
      }

      const clampedVelocity = new b2Vec2(velocity.x, 0)
      b2Body_SetLinearVelocity(bodyId, clampedVelocity)
      clampedVelocity.delete()
      velocity.delete()
    }
  }

  private applyDeltaVelocityToAllBones(deltaX: number, deltaY: number) {
    const { b2Body_ApplyLinearImpulseToCenter, b2Body_GetMass, b2Vec2 } =
      this.box2d

    for (let i = 0; i < boneId_count; i++) {
      const bodyId = this.bones[i].bodyId
      const mass = b2Body_GetMass(bodyId)
      const impulse = new b2Vec2(deltaX * mass, deltaY * mass)
      b2Body_ApplyLinearImpulseToCenter(bodyId, impulse, true)
      impulse.delete()
    }
  }

  private setVelocityForAllBones(x: number, y: number) {
    const { b2Body_SetLinearVelocity, b2Vec2 } = this.box2d

    for (let i = 0; i < boneId_count; i++) {
      const bodyId = this.bones[i].bodyId
      const velocity = new b2Vec2(x, y)
      b2Body_SetLinearVelocity(bodyId, velocity)
      velocity.delete()
    }
  }

  private applyJumpForceToAllBones() {
    const { b2Body_ApplyForceToCenter, b2Body_GetMass, b2Vec2 } = this.box2d

    for (let i = 0; i < boneId_count; i++) {
      const bodyId = this.bones[i].bodyId
      const mass = b2Body_GetMass(bodyId)
      const force = new b2Vec2(
        0,
        -this.jumpForce * mass * this.jumpForceMultiplier
      )
      b2Body_ApplyForceToCenter(bodyId, force, true)
      force.delete()
    }
  }

  private updateShapeFriction(frictionType: 'body' | 'foot', value: number) {
    const { b2Shape_SetFriction } = this.box2d

    for (let i = 0; i < boneId_count; i++) {
      const shapes = this.bones[i].shapeIds
      for (const shape of shapes) {
        if (shape.frictionType === frictionType) {
          b2Shape_SetFriction(shape.id, value)
        }
      }
    }
  }

  private getGravityMagnitude() {
    const { b2World_GetGravity } = this.box2d
    const gravity = b2World_GetGravity(this.worldId)
    const magnitude = Math.abs(gravity.y)
    gravity.delete()
    return magnitude
  }

  move(direction: number) {
    if (!this.isAlive) return

    const { b2Body_SetLinearVelocity, b2Body_GetLinearVelocity, b2Vec2 } =
      this.box2d
    const currentVel = b2Body_GetLinearVelocity(this.bones[boneId_hip].bodyId)

    this.lastMoveDirection = direction

    if (direction > 0) {
      this.facingRight = true
    } else if (direction < 0) {
      this.facingRight = false
    }

    const wallJumpCooldown = 150
    const isInWallJumpCooldown =
      Date.now() - this.wallJumpTime < wallJumpCooldown

    let adjustedDirection = direction
    if (isInWallJumpCooldown && this.isTouchingWall) {
      if (direction === this.wallDirection) {
        adjustedDirection = direction * 0.5
      }
    }

    const { b2Body_SetLinearDamping } = this.box2d
    if (direction === 0 && this.isGrounded && !this.isJumping) {
      const stopDamping = 100.0
      b2Body_SetLinearDamping(this.bones[boneId_hip].bodyId, stopDamping)
      b2Body_SetLinearDamping(
        this.bones[boneId_upperLeftLeg].bodyId,
        stopDamping
      )
      b2Body_SetLinearDamping(
        this.bones[boneId_upperRightLeg].bodyId,
        stopDamping
      )
      b2Body_SetLinearDamping(
        this.bones[boneId_lowerLeftLeg].bodyId,
        stopDamping
      )
      b2Body_SetLinearDamping(
        this.bones[boneId_lowerRightLeg].bodyId,
        stopDamping
      )
      this.stopHorizontalMotion()
    } else {
      this.resetMovementDamping()
    }

    const shouldPreserveAirVelocity = !this.isGrounded && direction === 0
    const targetX = shouldPreserveAirVelocity
      ? currentVel.x * this.airControlDrag
      : adjustedDirection * this.moveSpeed
    const velocity = new b2Vec2(targetX, currentVel.y)
    b2Body_SetLinearVelocity(this.bones[boneId_hip].bodyId, velocity)
    velocity.delete()
  }

  startJump() {
    if (!this.isAlive || this.isJumping) return

    const now = Date.now()
    const hasWallLatch = now < this.wallLatchUntil
    const effectiveWallDirection = this.isTouchingWall
      ? this.wallDirection
      : this.wallProximityDirection !== 0
        ? this.wallProximityDirection
        : hasWallLatch
          ? this.wallLatchDirection
          : 0
    const canWallJump =
      effectiveWallDirection !== 0 &&
      !this.groundContact &&
      this.wallJumpCount < this.maxWallJumps

    if (this.groundContact || canWallJump) {
      this.isJumping = true
      this.jumpStartTime = Date.now()
      this.groundedIgnoreUntil = this.jumpStartTime + this.jumpGroundGraceMs
      this.loggedGroundedCancel = false
      this.resetMovementDamping()
      const gravity = this.getGravityMagnitude()
      const baseJumpSpeed = -Math.sqrt(2 * gravity * this.maxJumpHeight)

      if (canWallJump) {
        const pushAwaySpeed =
          -effectiveWallDirection *
          this.moveSpeed *
          this.wallJumpPushAwayMultiplier
        const upwardSpeed = baseJumpSpeed * this.wallJumpUpwardMultiplier

        this.setVelocityForAllBones(pushAwaySpeed, upwardSpeed)

        this.wallJumpTime = Date.now()
        this.wallJumpCount++
        if (this.debugJump) {
          // eslint-disable-next-line no-console
          console.log('jump start (wall)', {
            wallDirection: effectiveWallDirection,
            isGrounded: this.isGrounded,
            canWallJump,
          })
        }
      } else if (this.groundContact) {
        this.wallJumpCount = 0
        this.applyDeltaVelocityToAllBones(0, baseJumpSpeed)
        if (this.debugJump) {
          // eslint-disable-next-line no-console
          console.log('jump start (ground)', {
            isGrounded: this.isGrounded,
            baseJumpSpeed,
          })
        }
      }
    }
  }

  updateJump() {
    if (!this.isAlive || !this.isJumping) return

    this.updateGroundedStatus()
    if (this.groundContact && Date.now() >= this.groundedIgnoreUntil) {
      if (this.debugJump && !this.loggedGroundedCancel) {
        this.loggedGroundedCancel = true
        // eslint-disable-next-line no-console
        console.log('jump cancelled by grounded', {
          groundedIgnoreUntil: this.groundedIgnoreUntil,
        })
      }
      this.isJumping = false
      return
    }

    const { b2Body_GetLinearVelocity } = this.box2d
    const vel = b2Body_GetLinearVelocity(this.bones[boneId_hip].bodyId)
    const jumpDuration = Date.now() - this.jumpStartTime

    if (vel.y < 0 && jumpDuration < this.maxJumpDuration) {
      this.applyJumpForceToAllBones()
    } else if (jumpDuration >= this.maxJumpDuration || vel.y >= 0) {
      this.isJumping = false
    }
  }

  stopJump() {
    this.isJumping = false
    this.groundedIgnoreUntil = 0
  }

  postStepUpdate() {
    const wasGrounded = this.isGrounded
    const wasGroundContact = this.groundContact
    this.updateGroundedStatus()
    this.updateWallStatus()

    if (this.isGrounded) {
      if (!wasGrounded) {
        this.resetLandingMotion()
        this.isJumping = false
      }
      this.setSpringEnabled(false)
      if (!this.isJumping) {
        this.clampUpwardVelocityWhileGrounded()
      }
    } else {
      this.setSpringEnabled(true)
    }

    if (this.groundContact && !wasGroundContact) {
      this.wallJumpCount = 0
    }

    const { b2Body_GetPosition } = this.box2d
    const hipPos = b2Body_GetPosition(this.bones[boneId_hip].bodyId)
    if (this.isGrounded) {
      if (!wasGrounded) {
        this.renderSmoothedY = hipPos.y
      } else {
        this.renderSmoothedY +=
          (hipPos.y - this.renderSmoothedY) * this.renderSmoothingGround
      }
    } else {
      this.renderSmoothedY = hipPos.y
    }
    this.renderOffsetY = this.renderSmoothedY - hipPos.y
    hipPos.delete()

    this.wasGrounded = this.isGrounded
  }

  getPosition(): b2Vec2 {
    const { b2Body_GetPosition } = this.box2d
    return b2Body_GetPosition(this.bones[boneId_hip].bodyId)
  }

  render(ctx: CanvasRenderingContext2D, pixelsPerMeter: number) {
    const { b2Body_GetPosition, b2Body_GetRotation } = this.box2d

    ctx.save()

    const hipPos = b2Body_GetPosition(this.bones[boneId_hip].bodyId)
    if (this.facingRight) {
      ctx.translate(hipPos.x * pixelsPerMeter * 2, 0)
      ctx.scale(-1, 1)
    }

    const colors = {
      head: '#FFD7A8',
      torso: '#4ECDC4',
      hip: '#1A535C',
      upperLeg: '#2B5E7B',
      lowerLeg: '#2B5E7B',
      upperArm: '#4ECDC4',
      lowerArm: '#FFD7A8',
    }

    const drawCapsule = (
      bodyId: b2BodyId,
      center1: { x: number; y: number },
      center2: { x: number; y: number },
      radius: number,
      color: string
    ) => {
      const pos = b2Body_GetPosition(bodyId)
      const rot = b2Body_GetRotation(bodyId)

      ctx.save()
      ctx.translate(
        pos.x * pixelsPerMeter,
        (pos.y + this.renderOffsetY) * pixelsPerMeter
      )
      ctx.rotate(rot.GetAngle())

      ctx.fillStyle = color
      ctx.strokeStyle = '#000'
      ctx.lineWidth = 2

      const c1x = center1.x * pixelsPerMeter
      const c1y = center1.y * pixelsPerMeter
      const c2x = center2.x * pixelsPerMeter
      const c2y = center2.y * pixelsPerMeter
      const r = radius * pixelsPerMeter

      ctx.beginPath()
      ctx.arc(c1x, c1y, r, 0, Math.PI * 2)
      ctx.fill()
      ctx.stroke()

      ctx.beginPath()
      ctx.arc(c2x, c2y, r, 0, Math.PI * 2)
      ctx.fill()
      ctx.stroke()

      const angle = Math.atan2(c2y - c1y, c2x - c1x)
      const perpX = Math.cos(angle + Math.PI / 2) * r
      const perpY = Math.sin(angle + Math.PI / 2) * r

      ctx.beginPath()
      ctx.moveTo(c1x + perpX, c1y + perpY)
      ctx.lineTo(c2x + perpX, c2y + perpY)
      ctx.lineTo(c2x - perpX, c2y - perpY)
      ctx.lineTo(c1x - perpX, c1y - perpY)
      ctx.closePath()
      ctx.fill()
      ctx.stroke()

      ctx.restore()
    }

    const s = this.scale

    drawCapsule(
      this.bones[boneId_hip].bodyId,
      { x: 0.0, y: -0.02 * s },
      { x: 0.0, y: 0.02 * s },
      0.095 * s,
      colors.hip
    )

    drawCapsule(
      this.bones[boneId_torso].bodyId,
      { x: 0.0, y: -0.135 * s },
      { x: 0.0, y: 0.135 * s },
      0.09 * s,
      colors.torso
    )

    drawCapsule(
      this.bones[boneId_head].bodyId,
      { x: 0.0, y: -0.038 * s },
      { x: 0.0, y: 0.039 * s },
      0.075 * s,
      colors.head
    )

    drawCapsule(
      this.bones[boneId_upperLeftLeg].bodyId,
      { x: 0.0, y: -0.125 * s },
      { x: 0.0, y: 0.125 * s },
      0.06 * s,
      colors.upperLeg
    )

    drawCapsule(
      this.bones[boneId_lowerLeftLeg].bodyId,
      { x: 0.0, y: -0.155 * s },
      { x: 0.0, y: 0.125 * s },
      0.045 * s,
      colors.lowerLeg
    )

    drawCapsule(
      this.bones[boneId_upperRightLeg].bodyId,
      { x: 0.0, y: -0.125 * s },
      { x: 0.0, y: 0.125 * s },
      0.06 * s,
      colors.upperLeg
    )

    drawCapsule(
      this.bones[boneId_lowerRightLeg].bodyId,
      { x: 0.0, y: -0.155 * s },
      { x: 0.0, y: 0.125 * s },
      0.045 * s,
      colors.lowerLeg
    )

    drawCapsule(
      this.bones[boneId_upperLeftArm].bodyId,
      { x: 0.0, y: -0.125 * s },
      { x: 0.0, y: 0.125 * s },
      0.035 * s,
      colors.upperArm
    )

    drawCapsule(
      this.bones[boneId_lowerLeftArm].bodyId,
      { x: 0.0, y: -0.125 * s },
      { x: 0.0, y: 0.125 * s },
      0.03 * s,
      colors.lowerArm
    )

    drawCapsule(
      this.bones[boneId_upperRightArm].bodyId,
      { x: 0.0, y: -0.125 * s },
      { x: 0.0, y: 0.125 * s },
      0.035 * s,
      colors.upperArm
    )

    drawCapsule(
      this.bones[boneId_lowerRightArm].bodyId,
      { x: 0.0, y: -0.125 * s },
      { x: 0.0, y: 0.125 * s },
      0.03 * s,
      colors.lowerArm
    )

    ctx.restore()
  }

  // Public parameter setters for control panel
  setJumpForce(value: number) {
    this.jumpForce = value
  }

  setMaxJumpHeight(value: number) {
    this.maxJumpHeight = value
  }

  setMaxJumpDuration(value: number) {
    this.maxJumpDuration = value
  }

  setHertz(value: number) {
    this.hertz = value
    if (this.isAlive && this.springEnabled) {
      this.setJointSpringHertz(value)
    }
  }

  setDampingRatio(value: number) {
    this.dampingRatio = value
    if (this.isAlive) {
      this.setJointDampingRatio(value)
    }
  }

  setFrictionTorque(value: number) {
    this.frictionTorque = value
    if (this.isAlive) {
      this.setJointFrictionTorque(value * this.scale)
    }
  }

  setMoveSpeed(value: number) {
    this.moveSpeed = value
  }

  setWallJumpPushAwayMultiplier(value: number) {
    this.wallJumpPushAwayMultiplier = value
  }

  setWallJumpUpwardMultiplier(value: number) {
    this.wallJumpUpwardMultiplier = value
  }

  setMaxWallJumps(value: number) {
    this.maxWallJumps = Math.max(0, Math.floor(value))
  }

  setWallProximity(direction: number) {
    this.wallProximityDirection = direction
  }

  setJumpForceMultiplier(value: number) {
    this.jumpForceMultiplier = value
  }

  setDebugJump(value: boolean) {
    this.debugJump = value
  }

  setBodyFriction(value: number) {
    this.bodyFriction = value
    this.updateShapeFriction('body', value)
  }

  setFootFriction(value: number) {
    this.footFriction = value
    this.updateShapeFriction('foot', value)
  }

  setHipLinearDamping(value: number) {
    this.hipLinearDamping = value
    const { b2Body_SetLinearDamping } = this.box2d
    b2Body_SetLinearDamping(this.bones[boneId_hip].bodyId, value)
  }

  setBodyLinearDamping(value: number) {
    this.bodyLinearDamping = value
    const { b2Body_SetLinearDamping } = this.box2d
    for (let i = 1; i < boneId_count; i++) {
      b2Body_SetLinearDamping(this.bones[i].bodyId, value)
    }
  }

  destroy() {
    const { b2DestroyBody } = this.box2d
    for (let i = 0; i < boneId_count; i++) {
      if (this.bones[i] && this.bones[i].bodyId) {
        b2DestroyBody(this.bones[i].bodyId)
      }
    }
  }

  logParameters() {
    console.log('=== 角色参数 ===')
    console.log({
      跳跃力度: this.jumpForce,
      最大跳跃持续时间: this.maxJumpDuration,
      持续跳跃力倍数: this.jumpForceMultiplier,
      蹬墙横向推离倍数: this.wallJumpPushAwayMultiplier,
      蹬墙向上速度倍数: this.wallJumpUpwardMultiplier,
      身体摩擦力: this.bodyFriction,
      脚部摩擦力: this.footFriction,
      髋部线性阻尼: this.hipLinearDamping,
      身体线性阻尼: this.bodyLinearDamping,
      最大跳跃高度: this.maxJumpHeight,
      关节弹簧频率: this.hertz,
      关节阻尼比: this.dampingRatio,
      关节摩擦扭矩: this.frictionTorque,
      移动速度: this.moveSpeed,
    })
  }
}
