import {
  DEFAULT_PLAYER_RADIUS,
  DEFAULT_PLAYER_WEIGHT,
  PLAYER_WEIGHT_REFERENCE,
} from '../../constants'
import type { MainModule } from '../../types'
import { componentRegistry } from '../ComponentRegistry'
import type { Entity } from '../Entity'
import { System } from '../System'

export class MovementSystem extends System {
  private box2d: MainModule
  private allEntities: Entity[] = []

  constructor(box2d: MainModule) {
    super()
    this.box2d = box2d

    const physicsType = componentRegistry.getComponentType('Physics')
    const movementType = componentRegistry.getComponentType('Movement')
    const inputType = componentRegistry.getComponentType('Input')
    this.setRequiredComponents([physicsType, movementType, inputType])
  }

  setEntities(entities: Entity[]): void {
    this.allEntities = entities
  }

  update(entities: Entity[], _deltaTime: number): void {
    for (const entity of entities) {
      if (!entity.physics || !entity.movement || !entity.input) continue
      if (entity.stats?.isDead) {
        entity.input.moveDirection = 0
        entity.input.jumpRequested = false
        continue
      }

      this.updateContactState(entity)
      this.handleInput(entity)
    }
  }

  private updateContactState(entity: Entity): void {
    if (!entity.physics || !entity.movement) return

    const {
      b2Body_GetContactData,
      b2Body_GetContactCapacity,
      b2Body_GetLinearVelocity,
    } = this.box2d

    const now = Date.now()
    if (
      now - entity.movement.lastContactUpdate <
      entity.movement.contactUpdateIntervalMs
    ) {
      return
    }
    entity.movement.lastContactUpdate = now

    const velocity = b2Body_GetLinearVelocity(entity.physics.bodyId)
    const isFallingOrStill = velocity.y >= -0.1
    const capacity = b2Body_GetContactCapacity(entity.physics.bodyId)
    const contactData = b2Body_GetContactData(entity.physics.bodyId, capacity)

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

    entity.movement.isGrounded = grounded
    entity.movement.isTouchingWall = touchingWall

    if (entity.movement.isTouchingWall && !entity.movement.isGrounded) {
      entity.movement.wallDirection = newWallDirection
    } else {
      entity.movement.wallDirection = 0
    }
  }

  private handleInput(entity: Entity): void {
    if (!entity.physics || !entity.movement || !entity.input) return

    this.handleMove(entity)
    this.handleJump(entity)
  }

  private handleMove(entity: Entity): void {
    if (!entity.physics || !entity.movement || !entity.input) return

    const { b2Body_SetLinearVelocity, b2Body_GetLinearVelocity, b2Vec2 } =
      this.box2d
    const currentVel = b2Body_GetLinearVelocity(entity.physics.bodyId)

    let direction = entity.input.moveDirection

    const isInAttackAction =
      entity.weapon &&
      entity.weapon.isEquipped &&
      (entity.weapon.attackPhase === 'swing' ||
        entity.weapon.attackPhase === 'pause' ||
        entity.weapon.attackPhase === 'recover' ||
        entity.weapon.attackPhase === 'rebound')

    if (!isInAttackAction) {
      if (entity.input.facingOverride !== null) {
        entity.input.lastMoveDirection = entity.input.facingOverride
      } else if (direction !== 0) {
        entity.input.lastMoveDirection = direction
      }
    }

    const wallJumpCooldown = 150
    const isInWallJumpCooldown =
      Date.now() - entity.movement.wallJumpTime < wallJumpCooldown

    if (isInWallJumpCooldown) {
      return
    }

    if (isInAttackAction) {
      direction = 0
    }

    if (direction !== 0 && this.isEnemyBlocking(entity, direction)) {
      direction = 0
    }

    const velocity = new b2Vec2(
      direction * entity.movement.moveSpeed,
      currentVel.y
    )
    b2Body_SetLinearVelocity(entity.physics.bodyId, velocity)
    velocity.delete()
  }

  private handleJump(entity: Entity): void {
    if (!entity.physics || !entity.movement || !entity.input) return

    entity.input.inputBuffer.update()
    entity.input.inputBuffer.tryExecute(
      'jump',
      () => this.canJump(entity),
      () => this.doJump(entity)
    )

    if (!entity.movement.isJumping) return

    const {
      b2Body_GetLinearVelocity,
      b2Body_ApplyForceToCenter,
      b2Body_GetMass,
      b2Vec2,
    } = this.box2d
    const vel = b2Body_GetLinearVelocity(entity.physics.bodyId)
    const mass = b2Body_GetMass(entity.physics.bodyId)
    const jumpDuration = Date.now() - entity.movement.jumpStartTime
    const weightFactor = this.getWeightFactor(entity)
    const jumpScale = 1 / weightFactor

    if (
      vel.y < 0 &&
      jumpDuration < entity.movement.maxJumpDuration &&
      entity.input.jumpRequested
    ) {
      const force = new b2Vec2(
        0,
        -entity.movement.jumpForce *
          mass *
          entity.movement.jumpForceMultiplier *
          jumpScale
      )
      b2Body_ApplyForceToCenter(entity.physics.bodyId, force, true)
      force.delete()
    } else if (
      jumpDuration >= entity.movement.maxJumpDuration ||
      vel.y >= 0 ||
      !entity.input.jumpRequested
    ) {
      entity.movement.isJumping = false
    }
  }

  private canJump(entity: Entity): boolean {
    if (!entity.movement) return false

    if (entity.movement.isJumping) return false

    const canWallJump =
      entity.movement.isTouchingWall &&
      !entity.movement.isGrounded &&
      entity.movement.wallJumpCount < entity.movement.maxWallJumps

    return entity.movement.isGrounded || canWallJump
  }

  private doJump(entity: Entity): void {
    if (!entity.physics || !entity.movement) return

    const {
      b2Body_ApplyLinearImpulseToCenter,
      b2Body_SetLinearVelocity,
      b2Body_GetMass,
      b2Vec2,
    } = this.box2d

    const mass = b2Body_GetMass(entity.physics.bodyId)
    const weightFactor = this.getWeightFactor(entity)
    const jumpScale = 1 / weightFactor

    entity.movement.isJumping = true
    entity.movement.jumpStartTime = Date.now()

    const canWallJump =
      entity.movement.isTouchingWall &&
      !entity.movement.isGrounded &&
      entity.movement.wallJumpCount < entity.movement.maxWallJumps

    if (canWallJump) {
      const pushAwaySpeed =
        -entity.movement.wallDirection *
        entity.movement.moveSpeed *
        entity.movement.wallJumpPushAwayMultiplier *
        jumpScale
      const upwardSpeed =
        -entity.movement.jumpForce *
        entity.movement.wallJumpUpwardMultiplier *
        jumpScale

      const velocity = new b2Vec2(pushAwaySpeed, upwardSpeed)
      b2Body_SetLinearVelocity(entity.physics.bodyId, velocity)
      velocity.delete()

      entity.movement.wallJumpTime = Date.now()
      entity.movement.wallJumpCount++
    } else if (entity.movement.isGrounded) {
      entity.movement.wallJumpCount = 0
      const impulse = new b2Vec2(
        0,
        -entity.movement.jumpForce * mass * 0.6 * jumpScale
      )
      b2Body_ApplyLinearImpulseToCenter(entity.physics.bodyId, impulse, true)
      impulse.delete()
    }
  }

  private getWeightFactor(entity: Entity): number {
    if (!entity.movement) return 1
    const baseWeight =
      entity.movement.baseWeight > 0
        ? entity.movement.baseWeight
        : DEFAULT_PLAYER_WEIGHT
    const carryWeight = Math.max(0, entity.movement.carryWeight)
    const effectiveWeight = baseWeight + carryWeight
    const referenceWeight =
      PLAYER_WEIGHT_REFERENCE > 0
        ? PLAYER_WEIGHT_REFERENCE
        : DEFAULT_PLAYER_WEIGHT
    const factor = effectiveWeight / referenceWeight
    return factor > 0 ? factor : 1
  }

  private isEnemyBlocking(entity: Entity, direction: number): boolean {
    if (!entity.transform || !entity.faction) return false

    const myRadius = entity.render?.radius ?? DEFAULT_PLAYER_RADIUS
    const myX = entity.transform.x

    for (const other of this.allEntities) {
      if (other.id === entity.id) continue
      if (!other.transform || !other.faction) continue
      if (other.stats?.isDead) continue

      if (!entity.faction.canAttack(other.faction)) continue

      const otherRadius = other.render?.radius ?? DEFAULT_PLAYER_RADIUS
      const otherX = other.transform.x

      const dx = otherX - myX
      const dy = other.transform.y - entity.transform.y
      const distance = Math.hypot(dx, dy)
      const touchDistance = myRadius + otherRadius

      if (distance > touchDistance) continue

      const isInFront = (direction > 0 && dx > 0) || (direction < 0 && dx < 0)
      if (isInFront) {
        return true
      }
    }

    return false
  }
}
