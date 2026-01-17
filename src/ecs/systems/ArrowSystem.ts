import { DEFAULT_PLAYER_RADIUS } from '../../constants'
import type { MainModule } from '../../types'
import { componentRegistry } from '../ComponentRegistry'
import type { Entity } from '../Entity'
import type { SpatialHash } from '../SpatialHash'
import { System } from '../System'
import type { World } from '../World'
import type { StatsSystem } from './StatsSystem'

export class ArrowSystem extends System {
  private box2d: MainModule
  private spatialHash: SpatialHash | null = null
  private statsSystem?: StatsSystem
  private world?: World
  private tempHitSource = { x: 0, y: 0 }

  constructor(box2d: MainModule, statsSystem?: StatsSystem) {
    super()
    this.box2d = box2d
    this.statsSystem = statsSystem

    const transformType = componentRegistry.getComponentType('Transform')
    const weaponType = componentRegistry.getComponentType('Weapon')
    const arrowType = componentRegistry.getComponentType('Arrow')
    const physicsType = componentRegistry.getComponentType('Physics')
    this.setRequiredComponents([
      transformType,
      weaponType,
      arrowType,
      physicsType,
    ])
  }

  setSpatialHash(spatialHash: SpatialHash): void {
    this.spatialHash = spatialHash
  }

  setWorld(world: World): void {
    this.world = world
  }

  update(entities: Entity[], deltaTime: number): void {
    const deltaMs = Math.max(0, deltaTime * 1000)

    for (const entity of entities) {
      if (
        !entity.transform ||
        !entity.weapon ||
        !entity.arrow ||
        !entity.physics
      )
        continue

      const arrow = entity.arrow
      arrow.elapsedMs += deltaMs
      if (arrow.elapsedMs >= arrow.lifetimeMs) {
        this.destroyArrowEntity(entity)
        continue
      }

      entity.weapon.visual.x = entity.transform.x
      entity.weapon.visual.y = entity.transform.y
      const velocity = this.box2d.b2Body_GetLinearVelocity(
        entity.physics.bodyId
      )
      const speed = Math.hypot(velocity.x, velocity.y)
      const dirAngle =
        speed > 0.01
          ? Math.atan2(velocity.y, velocity.x)
          : entity.weapon.visual.rotation - Math.PI / 2
      entity.weapon.visual.rotation = dirAngle + Math.PI / 2
      velocity.delete()

      if (!this.spatialHash || !this.statsSystem) continue

      const dirX = Math.cos(dirAngle)
      const dirY = Math.sin(dirAngle)
      const headX = entity.transform.x + dirX * entity.weapon.width
      const headY = entity.transform.y + dirY * entity.weapon.width
      const queryRadius = arrow.hitRadius + DEFAULT_PLAYER_RADIUS
      const nearby = this.spatialHash.query(headX, headY, queryRadius)
      const nearbyCount = this.spatialHash.getQueryResultLength()

      for (let i = 0; i < nearbyCount; i++) {
        const target = nearby[i]
        if (!target.stats || !target.faction || !target.transform) continue
        if (target.id === arrow.ownerId) continue
        if (target.faction.faction === arrow.faction) continue

        const targetRadius = target.render?.radius ?? DEFAULT_PLAYER_RADIUS
        const dx = headX - target.transform.x
        const dy = headY - target.transform.y
        const hitRadius = targetRadius + arrow.hitRadius

        if (dx * dx + dy * dy <= hitRadius * hitRadius) {
          this.tempHitSource.x = headX
          this.tempHitSource.y = headY
          this.statsSystem.applyWeaponHit(
            target,
            entity.weapon,
            this.tempHitSource
          )
          this.destroyArrowEntity(entity)
          break
        }
      }
    }
  }

  private destroyArrowEntity(entity: Entity): void {
    if (entity.physics) {
      this.box2d.b2DestroyBody(entity.physics.bodyId)
      entity.removeComponent('Physics')
    }
    this.world?.destroyEntity(entity)
  }
}
