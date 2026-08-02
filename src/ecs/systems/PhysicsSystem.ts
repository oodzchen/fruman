import { KNOCKBACK_SLIDE_DECELERATION } from '../../constants'
import type { MainModule, b2WorldId } from '../../types'
import { componentRegistry } from '../ComponentRegistry'
import type { Entity } from '../Entity'
import { System } from '../System'

export class PhysicsSystem extends System {
  private box2d: MainModule
  private worldId: b2WorldId
  private readonly afterStepCallbacks: Array<() => void> = []

  constructor(box2d: MainModule, worldId: b2WorldId) {
    super()
    this.box2d = box2d
    this.worldId = worldId

    const transformType = componentRegistry.getComponentType('Transform')
    const physicsType = componentRegistry.getComponentType('Physics')
    this.setRequiredComponents([transformType, physicsType])
  }

  addAfterStepCallback(callback: () => void): void {
    this.afterStepCallbacks.push(callback)
  }

  update(entities: Entity[], deltaTime: number): void {
    const {
      b2World_Step,
      b2Body_GetLinearVelocity,
      b2Body_GetPosition,
      b2Body_SetLinearVelocity,
    } = this.box2d
    const timeStep = 1 / 60
    b2World_Step(this.worldId, timeStep, 8)

    for (const entity of entities) {
      if (!entity.transform || !entity.physics) continue
      if (entity.stats?.isVanished) continue

      const pos = b2Body_GetPosition(entity.physics.bodyId)
      const vel = b2Body_GetLinearVelocity(entity.physics.bodyId)
      const posX = pos.x
      const posY = pos.y
      if (
        entity.movement &&
        entity.movement.currentFriction === 0 &&
        (entity.movement.isGrounded || entity.movement.wasGrounded) &&
        entity.isStunned()
      ) {
        const deceleration = KNOCKBACK_SLIDE_DECELERATION * deltaTime
        const velocityX = vel.x
        if (vel.x > deceleration) {
          vel.x -= deceleration
        } else if (vel.x < -deceleration) {
          vel.x += deceleration
        } else {
          vel.x = 0
        }
        if (vel.x !== velocityX) {
          b2Body_SetLinearVelocity(entity.physics.bodyId, vel)
        }
      }
      entity.transform.x = posX
      entity.transform.y = posY
      entity.physics.posX = posX
      entity.physics.posY = posY
      entity.physics.velX = vel.x
      entity.physics.velY = vel.y
      entity.physics.prevX = posX
      entity.physics.prevY = posY
      entity.physics.hasPrev = true
      pos.delete()
      vel.delete()
    }

    for (let i = 0; i < this.afterStepCallbacks.length; i++) {
      this.afterStepCallbacks[i]()
    }
  }
}
