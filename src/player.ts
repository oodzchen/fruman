import type { MainModule, b2BodyId, b2Vec2, b2WorldId } from './types'

export class Player {
  private box2d: MainModule
  private bodyId: b2BodyId
  private moveSpeed = 5
  private jumpForce = 15
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

  constructor(box2d: MainModule, worldId: b2WorldId, x: number, y: number) {
    this.box2d = box2d

    const {
      b2DefaultBodyDef,
      b2CreateBody,
      b2BodyType,
      b2MakeBox,
      b2DefaultShapeDef,
      b2CreatePolygonShape,
    } = this.box2d

    const bodyDef = b2DefaultBodyDef()
    bodyDef.type = b2BodyType.b2_dynamicBody
    bodyDef.position.Set(x, y)
    bodyDef.motionLocks.angularZ = true
    bodyDef.linearDamping = 0
    this.bodyId = b2CreateBody(worldId, bodyDef)

    const shape = b2MakeBox(0.4, 0.6)
    const fixtureDef = b2DefaultShapeDef()
    fixtureDef.density = 1.0
    fixtureDef.material.friction = 0.05
    b2CreatePolygonShape(this.bodyId, fixtureDef, shape)

    bodyDef.delete()
    shape.delete()
    fixtureDef.delete()

    this.setupGroundCheck()
  }

  private setupGroundCheck() {
    setInterval(() => {
      const {
        b2Body_GetLinearVelocity,
        b2Body_GetContactData,
        b2Body_GetContactCapacity,
      } = this.box2d
      const vel = b2Body_GetLinearVelocity(this.bodyId)

      this.isGrounded = Math.abs(vel.y) < 0.1

      const capacity = b2Body_GetContactCapacity(this.bodyId)
      const contactData = b2Body_GetContactData(this.bodyId, capacity)

      this.isTouchingWall = false
      let newWallDirection = 0

      for (let i = 0; i < contactData.length; i++) {
        const contact = contactData[i]
        const normal = contact.manifold.normal

        if (Math.abs(normal.x) > 0.7) {
          this.isTouchingWall = true
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

      if (this.isTouchingWall && !this.isGrounded) {
        this.wallDirection = newWallDirection
      } else if (!this.isTouchingWall) {
        this.wallDirection = 0
      }
    }, 50)
  }

  move(direction: number) {
    const { b2Body_SetLinearVelocity, b2Body_GetLinearVelocity, b2Vec2 } =
      this.box2d
    const currentVel = b2Body_GetLinearVelocity(this.bodyId)

    this.lastMoveDirection = direction

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
    // 避免重复触发
    if (this.isJumping) return

    // 可以在地面上跳跃，或者在贴墙时跳跃（蹬墙跳）
    const canWallJump =
      this.isTouchingWall &&
      !this.isGrounded &&
      this.wallJumpCount < this.maxWallJumps

    if (this.isGrounded || canWallJump) {
      const {
        b2Body_ApplyLinearImpulseToCenter,
        b2Body_SetLinearVelocity,
        b2Body_GetMass,
        b2Vec2,
      } = this.box2d

      const mass = b2Body_GetMass(this.bodyId)
      this.isJumping = true
      this.jumpStartTime = Date.now()

      // 蹬墙跳时，给一个横向和向上的推力
      if (canWallJump) {
        // 直接设置速度：远离墙壁的横向速度 + 向上速度（初始）
        // wallDirection: 1 = 墙在右侧向左推, -1 = 墙在左侧向右推
        const pushAwaySpeed = -this.wallDirection * this.moveSpeed * 2.5
        const upwardSpeed = -this.jumpForce * 0.8

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
  }

  updateJump() {
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
      const force = new b2Vec2(0, -this.jumpForce * mass * 0.8)
      b2Body_ApplyForceToCenter(this.bodyId, force, true)
      force.delete()
    } else if (jumpDuration >= this.maxJumpDuration || vel.y >= 0) {
      this.isJumping = false
    }
  }

  stopJump() {
    this.isJumping = false
  }

  getPosition(): b2Vec2 {
    const { b2Body_GetPosition } = this.box2d
    return b2Body_GetPosition(this.bodyId)
  }

  render(ctx: CanvasRenderingContext2D, pixelsPerMeter: number) {
    const { b2Body_GetPosition } = this.box2d
    const pos = b2Body_GetPosition(this.bodyId)

    ctx.fillStyle = '#4CAF50'
    ctx.fillRect(
      (pos.x - 0.4) * pixelsPerMeter,
      (pos.y - 0.6) * pixelsPerMeter,
      0.8 * pixelsPerMeter,
      1.2 * pixelsPerMeter
    )

    ctx.strokeStyle = '#2E7D32'
    ctx.lineWidth = 2
    ctx.strokeRect(
      (pos.x - 0.4) * pixelsPerMeter,
      (pos.y - 0.6) * pixelsPerMeter,
      0.8 * pixelsPerMeter,
      1.2 * pixelsPerMeter
    )
  }
}
