import {
  DEFAULT_FRAME_RATE,
  DEFAULT_PARRY_WINDOW_MS,
  DEFAULT_PLAYER_RADIUS,
  PARRY_COUNTER_WINDOW_MS,
} from '../../constants'
import type { MainModule } from '../../types'
import { SOUND_IDS } from '../../worker/effectsProtocol'
import type { ArrowPools } from '../ArrowPools'
import { componentRegistry } from '../ComponentRegistry'
import type { Entity } from '../Entity'
import type { SpatialHash } from '../SpatialHash'
import { System } from '../System'
import type { World } from '../World'
import type { StatsSystem } from './StatsSystem'

const PARRY_WINDOW_FRAMES =
  (DEFAULT_PARRY_WINDOW_MS * DEFAULT_FRAME_RATE) / 1000
const PARRY_ACTIVE_START_FRAME = PARRY_WINDOW_FRAMES * 0.5

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

        const facing = this.getTargetFacing(target)
        const rollAngle = target.movement?.rollAngle ?? 0
        const cosAngle = Math.cos(rollAngle)
        const sinAngle = Math.sin(rollAngle)
        const localFacingX = arrow.stuckOffsetX * facing
        const offsetX = localFacingX * cosAngle - arrow.stuckOffsetY * sinAngle
        const offsetY = localFacingX * sinAngle + arrow.stuckOffsetY * cosAngle

        const worldX = target.transform.x + offsetX
        const worldY = target.transform.y + offsetY
        const dirFacingX = arrow.stuckDirX * facing
        const dirX = dirFacingX * cosAngle - arrow.stuckDirY * sinAngle
        const dirY = dirFacingX * sinAngle + arrow.stuckDirY * cosAngle
        const dirAngle = Math.atan2(dirY, dirX)
        const rotation = dirAngle + Math.PI / 2

        entity.transform.x = worldX
        entity.transform.y = worldY
        entity.weapon.visual.x = entity.transform.x
        entity.weapon.visual.y = entity.transform.y
        entity.weapon.visual.rotation = rotation
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
          if (this.isArrowParried(target)) {
            this.handleArrowParry(
              target,
              entity,
              headX,
              headY,
              dirX,
              dirY,
              speed
            )
          } else {
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
          }
          break
        }
      }
    }
  }

  private isArrowParried(target: Entity): boolean {
    const weapon = target.weapon
    if (!weapon || !weapon.isParrying) return false
    return weapon.parryElapsedTime >= PARRY_ACTIVE_START_FRAME
  }

  private handleArrowParry(
    defender: Entity,
    arrowEntity: Entity,
    hitX: number,
    hitY: number,
    dirX: number,
    dirY: number,
    speed: number
  ): void {
    if (!this.statsSystem) return

    this.statsSystem.emitSpark(hitX, hitY)
    this.statsSystem.playSound(SOUND_IDS.SWORD_PARRY)
    this.statsSystem.applyParryRecovery(defender)
    if (defender.weapon) {
      defender.weapon.parryCounterTimerMs = PARRY_COUNTER_WINDOW_MS
      defender.weapon.parryCounterActive = false
    }
    this.deflectArrow(arrowEntity, dirX, dirY, speed)
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
    const facing = this.getTargetFacing(target)
    const rollAngle = target.movement?.rollAngle ?? 0
    const cosAngle = Math.cos(rollAngle)
    const sinAngle = Math.sin(rollAngle)
    const dx = stickX - target.transform.x
    const dy = stickY - target.transform.y
    const localFacingX = dx * cosAngle + dy * sinAngle
    const localY = -dx * sinAngle + dy * cosAngle
    const localX = localFacingX * facing
    arrow.stuckOffsetX = localX
    arrow.stuckOffsetY = localY
    arrow.stuckRotation = rotation

    const worldDirX = Math.cos(dirAngle)
    const worldDirY = Math.sin(dirAngle)
    const localDirFacingX = worldDirX * cosAngle + worldDirY * sinAngle
    const localDirY = -worldDirX * sinAngle + worldDirY * cosAngle
    const localDirX = localDirFacingX * facing
    arrow.stuckDirX = localDirX
    arrow.stuckDirY = localDirY
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

  private getTargetFacing(target: Entity): number {
    if (target.input && target.input.lastMoveDirection !== 0) {
      return target.input.lastMoveDirection
    }
    return target.weapon?.attackFacing || 1
  }

  private destroyArrowEntity(entity: Entity): void {
    if (entity.physics) {
      this.box2d.b2DestroyBody(entity.physics.bodyId)
    }
    this.world?.destroyEntity(entity)
  }
}
