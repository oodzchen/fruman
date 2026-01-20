import { DEFAULT_PLAYER_RADIUS } from '../../constants'
import type { MainModule } from '../../types'
import type { ArrowPools } from '../ArrowPools'
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
  private arrowPools?: ArrowPools
  private tempHitSource = { x: 0, y: 0 }
  private tempVec?: InstanceType<MainModule['b2Vec2']>

  constructor(box2d: MainModule, statsSystem?: StatsSystem) {
    super()
    this.box2d = box2d
    this.statsSystem = statsSystem
    this.tempVec = new box2d.b2Vec2(0, 0)

    const transformType = componentRegistry.getComponentType('Transform')
    const weaponType = componentRegistry.getComponentType('Weapon')
    const arrowType = componentRegistry.getComponentType('Arrow')
    this.setRequiredComponents([transformType, weaponType, arrowType])
  }

  setSpatialHash(spatialHash: SpatialHash): void {
    this.spatialHash = spatialHash
  }

  setWorld(world: World): void {
    this.world = world
  }

  setArrowPools(arrowPools: ArrowPools): void {
    this.arrowPools = arrowPools
  }

  update(entities: Entity[], deltaTime: number): void {
    const deltaMs = Math.max(0, deltaTime * 1000)
    const deltaSec = deltaMs > 0 ? deltaMs / 1000 : 0

    for (const entity of entities) {
      if (!entity.transform || !entity.weapon || !entity.arrow) continue

      const arrow = entity.arrow
      arrow.elapsedMs += deltaMs
      if (arrow.elapsedMs >= arrow.lifetimeMs) {
        this.destroyArrowEntity(entity)
        continue
      }

      if (arrow.isStuck) {
        const target =
          arrow.stuckEntityId !== null
            ? this.world?.getEntityById(arrow.stuckEntityId)
            : undefined
        if (!target?.transform || target.stats?.isDead) {
          this.destroyArrowEntity(entity)
          continue
        }
        entity.transform.x = target.transform.x + arrow.stuckOffsetX
        entity.transform.y = target.transform.y + arrow.stuckOffsetY
        entity.weapon.visual.x = entity.transform.x
        entity.weapon.visual.y = entity.transform.y
        entity.weapon.visual.rotation = arrow.stuckRotation
        arrow.prevX = entity.transform.x
        arrow.prevY = entity.transform.y
        arrow.hasPrev = true
        continue
      }

      if (!entity.physics) continue

      entity.weapon.visual.x = entity.transform.x
      entity.weapon.visual.y = entity.transform.y
      let velX = arrow.velocityX
      let velY = arrow.velocityY
      if (arrow.hasPrev && deltaSec > 0) {
        const dx = entity.transform.x - arrow.prevX
        const dy = entity.transform.y - arrow.prevY
        velX = dx / deltaSec
        velY = dy / deltaSec
      }
      arrow.velocityX = velX
      arrow.velocityY = velY
      arrow.prevX = entity.transform.x
      arrow.prevY = entity.transform.y
      arrow.hasPrev = true
      const speed = Math.hypot(velX, velY)
      const dirAngle =
        speed > 0.01
          ? Math.atan2(velY, velX)
          : entity.weapon.visual.rotation - Math.PI / 2
      entity.weapon.visual.rotation = dirAngle + Math.PI / 2

      if (!this.spatialHash || !this.statsSystem || !arrow.canHit) continue

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
          const blocked = this.isArrowBlocked(target, headX)
          this.statsSystem.applyWeaponHit(
            target,
            entity.weapon,
            this.tempHitSource
          )
          if (blocked) {
            this.deflectArrow(entity, dirX, dirY, speed)
          } else {
            this.stickArrow(entity, target, dirAngle + Math.PI / 2)
          }
          break
        }
      }
    }
  }

  private isArrowBlocked(target: Entity, hitX: number): boolean {
    if (!target.weapon?.isBlocking || !target.transform) return false
    const facing =
      target.input?.lastMoveDirection !== 0
        ? (target.input?.lastMoveDirection ?? 1)
        : target.weapon.attackFacing || 1
    const dx = hitX - target.transform.x
    return (facing > 0 && dx > 0) || (facing < 0 && dx < 0)
  }

  private deflectArrow(
    entity: Entity,
    dirX: number,
    dirY: number,
    speed: number
  ): void {
    const arrow = entity.arrow
    if (!arrow || !entity.physics || !this.tempVec) return
    const deflectX = -dirX * speed * 0.6
    const deflectY = Math.abs(dirY) * speed * 0.6 + 2
    this.tempVec.x = deflectX
    this.tempVec.y = deflectY
    this.box2d.b2Body_SetLinearVelocity(entity.physics.bodyId, this.tempVec)
    arrow.canHit = false
  }

  private stickArrow(entity: Entity, target: Entity, rotation: number): void {
    const arrow = entity.arrow
    if (!arrow || !target.transform || !entity.transform || !entity.weapon) {
      return
    }
    const weaponLength = entity.weapon.width
    const targetRadius = target.render?.radius ?? DEFAULT_PLAYER_RADIUS
    const penetration = Math.min(0.15, targetRadius * 0.3)
    const dirAngle = rotation - Math.PI / 2
    const forwardDirX = Math.cos(dirAngle)
    const forwardDirY = Math.sin(dirAngle)
    const tipDirX = -forwardDirX
    const tipDirY = -forwardDirY
    const tipX = target.transform.x + tipDirX * (targetRadius - penetration)
    const tipY = target.transform.y + tipDirY * (targetRadius - penetration)
    const stickX = tipX + tipDirX * weaponLength
    const stickY = tipY + tipDirY * weaponLength
    arrow.canHit = false
    arrow.isStuck = true
    arrow.stuckEntityId = target.id
    arrow.stuckOffsetX = stickX - target.transform.x
    arrow.stuckOffsetY = stickY - target.transform.y
    arrow.stuckRotation = rotation
    if (entity.physics) {
      this.box2d.b2DestroyBody(entity.physics.bodyId)
      if (this.arrowPools) {
        this.arrowPools.releasePhysics(entity.physics)
      }
      entity.removeComponent('Physics')
    }
    entity.transform.x = stickX
    entity.transform.y = stickY
    entity.weapon.visual.x = stickX
    entity.weapon.visual.y = stickY
    entity.weapon.visual.rotation = rotation
  }

  private destroyArrowEntity(entity: Entity): void {
    if (entity.physics) {
      this.box2d.b2DestroyBody(entity.physics.bodyId)
    }
    this.world?.destroyEntity(entity)
  }
}
