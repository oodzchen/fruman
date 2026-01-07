import {
  DEFAULT_BODY_FRICTION,
  DEFAULT_BODY_LINEAR_DAMPING,
  DEFAULT_JUMP_BUFFER_WINDOW,
  DEFAULT_JUMP_FORCE,
  DEFAULT_JUMP_FORCE_MULTIPLIER,
  DEFAULT_MAX_JUMP_DURATION,
  DEFAULT_MAX_WALL_JUMPS,
  DEFAULT_MOVE_SPEED,
  DEFAULT_PLAYER_RADIUS,
  DEFAULT_WALL_JUMP_PUSH_AWAY_MULTIPLIER,
  DEFAULT_WALL_JUMP_UPWARD_MULTIPLIER,
} from './constants'
import { InputBuffer } from './inputBuffer'
import type {
  MainModule,
  b2BodyId,
  b2ShapeId,
  b2Vec2,
  b2WorldId,
} from './types'

export class Player {
  private box2d: MainModule
  private bodyId: b2BodyId
  private shapeId!: b2ShapeId
  private moveSpeed = DEFAULT_MOVE_SPEED
  private jumpForce = DEFAULT_JUMP_FORCE
  private isGrounded = false
  private isTouchingWall = false
  private lastMoveDirection = 0
  private wallJumpTime = 0
  private maxWallJumps = DEFAULT_MAX_WALL_JUMPS
  private wallJumpCount = 0
  private isJumping = false
  private jumpStartTime = 0
  private maxJumpDuration = DEFAULT_MAX_JUMP_DURATION
  private wallDirection = 0
  private jumpForceMultiplier = DEFAULT_JUMP_FORCE_MULTIPLIER
  private wallJumpPushAwayMultiplier = DEFAULT_WALL_JUMP_PUSH_AWAY_MULTIPLIER
  private wallJumpUpwardMultiplier = DEFAULT_WALL_JUMP_UPWARD_MULTIPLIER
  private inputBuffer = new InputBuffer()
  private lastContactUpdate = 0
  private contactUpdateIntervalMs = 16

  constructor(box2d: MainModule, worldId: b2WorldId, x: number, y: number) {
    this.box2d = box2d
    this.inputBuffer.setDefaultBufferWindow(DEFAULT_JUMP_BUFFER_WINDOW)

    const {
      b2DefaultBodyDef,
      b2CreateBody,
      b2BodyType,
      b2Capsule,
      b2DefaultShapeDef,
      b2CreateCapsuleShape,
    } = this.box2d

    const bodyDef = b2DefaultBodyDef()
    bodyDef.type = b2BodyType.b2_dynamicBody
    bodyDef.position.Set(x, y)
    bodyDef.motionLocks.angularZ = true
    bodyDef.linearDamping = DEFAULT_BODY_LINEAR_DAMPING
    this.bodyId = b2CreateBody(worldId, bodyDef)

    const shape = new b2Capsule()
    shape.center1.Set(0, 0)
    shape.center2.Set(0, 0)
    shape.radius = DEFAULT_PLAYER_RADIUS
    const fixtureDef = b2DefaultShapeDef()
    fixtureDef.density = 1.0
    fixtureDef.material.friction = DEFAULT_BODY_FRICTION
    this.shapeId = b2CreateCapsuleShape(this.bodyId, fixtureDef, shape)

    bodyDef.delete()
    shape.delete()
    fixtureDef.delete()
  }

  private updateContactState() {
    const {
      b2Body_GetContactData,
      b2Body_GetContactCapacity,
      b2Body_GetLinearVelocity,
    } = this.box2d

    const now = Date.now()
    if (now - this.lastContactUpdate < this.contactUpdateIntervalMs) return
    this.lastContactUpdate = now

    const velocity = b2Body_GetLinearVelocity(this.bodyId)
    const isFallingOrStill = velocity.y >= -0.1
    const capacity = b2Body_GetContactCapacity(this.bodyId)
    const contactData = b2Body_GetContactData(this.bodyId, capacity)

    let grounded = false
    let touchingWall = false
    let newWallDirection = 0

    for (let i = 0; i < contactData.length; i++) {
      const contact = contactData[i]
      const normal = contact.manifold.normal
      const absX = Math.abs(normal.x)
      const absY = Math.abs(normal.y)

      if (absY > 0.7 && isFallingOrStill) {
        grounded = true
      }

      if (absX > 0.7) {
        touchingWall = true
        newWallDirection = normal.x > 0 ? -1 : 1
      }

      contact.delete()
    }

    velocity.delete()

    this.isGrounded = grounded
    this.isTouchingWall = touchingWall

    if (this.isTouchingWall && !this.isGrounded) {
      this.wallDirection = newWallDirection
    } else {
      this.wallDirection = 0
    }
  }

  move(direction: number) {
    const { b2Body_SetLinearVelocity, b2Body_GetLinearVelocity, b2Vec2 } =
      this.box2d
    const currentVel = b2Body_GetLinearVelocity(this.bodyId)

    // 只有当有实际移动方向时才更新lastMoveDirection，保持最后的朝向
    if (direction !== 0) {
      this.lastMoveDirection = direction
    }

    // 蹬墙跳后短时间内，忽略朝向墙壁的移动输入
    const wallJumpCooldown = 150 // 毫秒
    const isInWallJumpCooldown =
      Date.now() - this.wallJumpTime < wallJumpCooldown

    if (isInWallJumpCooldown) {
      // 在冷却时间内，不修改横向速度，让蹬墙跳的推离速度生效
      return
    }

    const velocity = new b2Vec2(direction * this.moveSpeed, currentVel.y)
    b2Body_SetLinearVelocity(this.bodyId, velocity)
    velocity.delete()
  }

  startJump() {
    this.inputBuffer.bufferAction('jump')
  }

  private canJump(): boolean {
    // 避免重复触发
    if (this.isJumping) return false

    // 可以在地面上跳跃，或者在贴墙时跳跃（蹬墙跳）
    const canWallJump =
      this.isTouchingWall &&
      !this.isGrounded &&
      this.wallJumpCount < this.maxWallJumps

    return this.isGrounded || canWallJump
  }

  private doJump() {
    const {
      b2Body_ApplyLinearImpulseToCenter,
      b2Body_SetLinearVelocity,
      b2Body_GetMass,
      b2Vec2,
    } = this.box2d

    const mass = b2Body_GetMass(this.bodyId)
    this.isJumping = true
    this.jumpStartTime = Date.now()

    const canWallJump =
      this.isTouchingWall &&
      !this.isGrounded &&
      this.wallJumpCount < this.maxWallJumps

    // 蹬墙跳时，给一个横向和向上的推力
    if (canWallJump) {
      // 直接设置速度：远离墙壁的横向速度 + 向上速度（初始）
      // wallDirection: 1 = 墙在右侧向左推, -1 = 墙在左侧向右推
      const pushAwaySpeed =
        -this.wallDirection * this.moveSpeed * this.wallJumpPushAwayMultiplier
      const upwardSpeed = -this.jumpForce * this.wallJumpUpwardMultiplier

      const velocity = new b2Vec2(pushAwaySpeed, upwardSpeed)
      b2Body_SetLinearVelocity(this.bodyId, velocity)
      velocity.delete()

      // 记录蹬墙跳时间并增加计数
      this.wallJumpTime = Date.now()
      this.wallJumpCount++
    } else if (this.isGrounded) {
      // 普通跳跃：从地面起跳，施加初始冲量，重置蹬墙次数
      this.wallJumpCount = 0
      const impulse = new b2Vec2(0, -this.jumpForce * mass * 0.6)
      b2Body_ApplyLinearImpulseToCenter(this.bodyId, impulse, true)
      impulse.delete()
    }
  }

  updateJump() {
    this.updateContactState()
    this.inputBuffer.update()
    this.inputBuffer.tryExecute(
      'jump',
      this.canJump.bind(this),
      this.doJump.bind(this)
    )

    if (!this.isJumping) return

    const {
      b2Body_GetLinearVelocity,
      b2Body_ApplyForceToCenter,
      b2Body_GetMass,
      b2Vec2,
    } = this.box2d
    const vel = b2Body_GetLinearVelocity(this.bodyId)
    const mass = b2Body_GetMass(this.bodyId)
    const jumpDuration = Date.now() - this.jumpStartTime

    // 只在上升阶段且未超过最大时长时继续施加向上的力
    if (vel.y < 0 && jumpDuration < this.maxJumpDuration) {
      const force = new b2Vec2(
        0,
        -this.jumpForce * mass * this.jumpForceMultiplier
      )
      b2Body_ApplyForceToCenter(this.bodyId, force, true)
      force.delete()
    } else if (jumpDuration >= this.maxJumpDuration || vel.y >= 0) {
      this.isJumping = false
    }
  }

  stopJump() {
    this.isJumping = false
  }

  getDebugInfo(): string[] {
    return this.inputBuffer.getDebugInfo()
  }

  getPosition(): b2Vec2 {
    const { b2Body_GetPosition } = this.box2d
    return b2Body_GetPosition(this.bodyId)
  }

  getFacingDirection(): number {
    return this.lastMoveDirection !== 0 ? this.lastMoveDirection : 1
  }

  render(ctx: CanvasRenderingContext2D, pixelsPerMeter: number) {
    const { b2Body_GetPosition } = this.box2d
    const pos = b2Body_GetPosition(this.bodyId)

    const centerX = pos.x * pixelsPerMeter
    const centerY = pos.y * pixelsPerMeter
    const radius = 0.5 * pixelsPerMeter

    // 绘制圆球主体
    ctx.fillStyle = '#4CAF50'
    ctx.beginPath()
    ctx.arc(centerX, centerY, radius, 0, 2 * Math.PI)
    ctx.fill()

    // 绘制黄色边框
    ctx.strokeStyle = '#FFD700'
    ctx.lineWidth = 3
    ctx.stroke()

    // 绘制眼睛（黑色圆点）
    const eyeRadius = 0.08 * pixelsPerMeter
    const eyeOffsetX = 0.25 * pixelsPerMeter
    const eyeOffsetY = -0.25 * pixelsPerMeter

    // 根据移动方向决定眼睛位置（默认向右）
    const direction = this.lastMoveDirection !== 0 ? this.lastMoveDirection : 1
    const eyeX = centerX + (direction < 0 ? -eyeOffsetX : eyeOffsetX)
    const eyeY = centerY + eyeOffsetY

    ctx.fillStyle = '#000000'
    ctx.beginPath()
    ctx.arc(eyeX, eyeY, eyeRadius, 0, 2 * Math.PI)
    ctx.fill()
  }

  setMoveSpeed(value: number) {
    this.moveSpeed = value
  }

  setJumpForce(value: number) {
    this.jumpForce = value
  }

  setMaxJumpDuration(value: number) {
    this.maxJumpDuration = value
  }

  setJumpForceMultiplier(value: number) {
    this.jumpForceMultiplier = value
  }

  setWallJumpPushAwayMultiplier(value: number) {
    this.wallJumpPushAwayMultiplier = value
  }

  setWallJumpUpwardMultiplier(value: number) {
    this.wallJumpUpwardMultiplier = value
  }

  setMaxWallJumps(value: number) {
    this.maxWallJumps = Math.floor(value)
  }

  setBodyFriction(value: number) {
    const { b2Shape_SetFriction } = this.box2d
    b2Shape_SetFriction(this.shapeId, value)
  }

  setBodyLinearDamping(value: number) {
    const { b2Body_SetLinearDamping } = this.box2d
    b2Body_SetLinearDamping(this.bodyId, value)
  }

  setJumpBufferWindow(value: number) {
    this.inputBuffer.setDefaultBufferWindow(value)
  }
}
