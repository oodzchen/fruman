import type { MainModule, b2WorldId } from '../../types'
import { componentRegistry } from '../ComponentRegistry'
import type { Entity } from '../Entity'
import { System } from '../System'

export class PhysicsSystem extends System {
  private box2d: MainModule
  private worldId: b2WorldId

  constructor(box2d: MainModule, worldId: b2WorldId) {
    super()
    this.box2d = box2d
    this.worldId = worldId

    const transformType = componentRegistry.getComponentType('Transform')
    const physicsType = componentRegistry.getComponentType('Physics')
    this.setRequiredComponents([transformType, physicsType])
  }

  update(entities: Entity[], _deltaTime: number): void {
    const { b2World_Step, b2Body_GetLinearVelocity, b2Body_GetPosition } =
      this.box2d
    const timeStep = 1 / 60
    b2World_Step(this.worldId, timeStep, 4)

    for (const entity of entities) {
      if (!entity.transform || !entity.physics) continue
      if (entity.stats?.isVanished) continue

      const pos = b2Body_GetPosition(entity.physics.bodyId)
      const vel = b2Body_GetLinearVelocity(entity.physics.bodyId)
      const posX = pos.x
      const posY = pos.y
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
  }
}
