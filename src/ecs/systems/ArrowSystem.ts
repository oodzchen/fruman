import {
  DEFAULT_FRAME_RATE,
  DEFAULT_PARRY_WINDOW_MS,
  DEFAULT_PLAYER_RADIUS,
  PARRY_COUNTER_WINDOW_MS,
  SOUND_DB_PARRY,
  SOUND_RANGE_MULTIPLIER_WEAPON,
} from '../../constants'
import type { MainModule } from '../../types'
import { SOUND_IDS } from '../../worker/effectsProtocol'
import type { ArrowPools } from '../ArrowPools'
import type { ImpactLevel } from '../AttackMoveData'
import { componentRegistry } from '../ComponentRegistry'
import type { Entity } from '../Entity'
import {
  checkOBBvsAABB,
  checkOBBvsCircle,
  checkOBBvsOBB,
  checkOBBvsPolygon,
} from '../OBBCollision'
import type { SpatialHash } from '../SpatialHash'
import { System } from '../System'
import type { World } from '../World'
import type { SoundSystem } from './SoundSystem'
import type { StatsSystem } from './StatsSystem'
import type { BreakableObstacleHit, ObstacleCollider } from './WeaponSystem'

const PARRY_WINDOW_FRAMES =
  (DEFAULT_PARRY_WINDOW_MS * DEFAULT_FRAME_RATE) / 1000
const PARRY_ACTIVE_START_FRAME = PARRY_WINDOW_FRAMES * 0.5
const TERRAIN_DEBRIS_ARROW_IMPULSE_SMALL1000 = 3000
const TERRAIN_DEBRIS_ARROW_IMPULSE_MEDIUM1000 = 5500
const TERRAIN_DEBRIS_ARROW_IMPULSE_LARGE1000 = 8500
const TERRAIN_DEBRIS_ARROW_IMPULSE_EXTREME1000 = 13000
const TERRAIN_DEBRIS_ARROW_LIFT_SMALL1000 = 900
const TERRAIN_DEBRIS_ARROW_LIFT_MEDIUM1000 = 1500
const TERRAIN_DEBRIS_ARROW_LIFT_LARGE1000 = 2300
const TERRAIN_DEBRIS_ARROW_LIFT_EXTREME1000 = 3400
const TERRAIN_DEBRIS_ARROW_ANGULAR_SMALL1000 = 220
const TERRAIN_DEBRIS_ARROW_ANGULAR_MEDIUM1000 = 360
const TERRAIN_DEBRIS_ARROW_ANGULAR_LARGE1000 = 520
const TERRAIN_DEBRIS_ARROW_ANGULAR_EXTREME1000 = 760

export class ArrowSystem extends System {
  private box2d: MainModule
  private spatialHash: SpatialHash | null = null
  private statsSystem?: StatsSystem
  private soundSystem: SoundSystem | null = null
  private obstacles: ObstacleCollider[] = []
  private onBreakableObstacleHit: ((hit: BreakableObstacleHit) => void) | null =
    null
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

  setSoundSystem(soundSystem: SoundSystem): void {
    this.soundSystem = soundSystem
  }

  setObstacles(obstacles: ObstacleCollider[]): void {
    this.obstacles = obstacles
  }

  setBreakableObstacleHitHandler(
    handler: ((hit: BreakableObstacleHit) => void) | null
  ): void {
    this.onBreakableObstacleHit = handler
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
      const headX =
        arrow.projectileType === 'grapeShot'
          ? entity.transform.x
          : entity.transform.x + dirX * entity.weapon.width
      const headY =
        arrow.projectileType === 'grapeShot'
          ? entity.transform.y
          : entity.transform.y + dirY * entity.weapon.width
      if (this.checkTerrainDebrisCollision(entity, headX, dirX, dirY)) {
        if (arrow.projectileType === 'grapeShot') {
          this.shatterProjectile(entity, headX, headY)
        } else {
          this.destroyArrowEntity(entity)
        }
        continue
      }
      if (this.checkBreakableObstacleCollision(entity, headX, headY)) {
        if (arrow.projectileType === 'grapeShot') {
          this.shatterProjectile(entity, headX, headY)
        } else {
          this.destroyArrowEntity(entity)
        }
        continue
      }
      const queryRadius = arrow.hitRadius + DEFAULT_PLAYER_RADIUS
      const nearby = this.spatialHash.query(headX, headY, queryRadius)
      const nearbyCount = this.spatialHash.getQueryResultLength()
      const arrowLayer = entity.weapon.renderLayer

      for (let i = 0; i < nearbyCount; i++) {
        const target = nearby[i]
        if (!target.stats || !target.faction || !target.transform) continue
        if (target.id === arrow.ownerId) continue
        if ((target.render?.renderLayer ?? 0) !== arrowLayer) continue
        if (!arrow.npcFactions.includes(target.faction.factionId)) continue

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
            const attacker = this.world?.getEntityById(arrow.ownerId)
            this.statsSystem.applyWeaponHit(
              target,
              entity.weapon,
              this.tempHitSource,
              attacker
            )
            if (arrow.projectileType === 'grapeShot') {
              this.shatterProjectile(entity, headX, headY)
            } else if (blocked) {
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

  private getTerrainDebrisImpulse1000(impactLevel: ImpactLevel): number {
    if (impactLevel === 'small') {
      return TERRAIN_DEBRIS_ARROW_IMPULSE_SMALL1000
    }
    if (impactLevel === 'medium') {
      return TERRAIN_DEBRIS_ARROW_IMPULSE_MEDIUM1000
    }
    if (impactLevel === 'large') {
      return TERRAIN_DEBRIS_ARROW_IMPULSE_LARGE1000
    }
    return TERRAIN_DEBRIS_ARROW_IMPULSE_EXTREME1000
  }

  private getTerrainDebrisLift1000(impactLevel: ImpactLevel): number {
    if (impactLevel === 'small') {
      return TERRAIN_DEBRIS_ARROW_LIFT_SMALL1000
    }
    if (impactLevel === 'medium') {
      return TERRAIN_DEBRIS_ARROW_LIFT_MEDIUM1000
    }
    if (impactLevel === 'large') {
      return TERRAIN_DEBRIS_ARROW_LIFT_LARGE1000
    }
    return TERRAIN_DEBRIS_ARROW_LIFT_EXTREME1000
  }

  private getTerrainDebrisAngularImpulse1000(impactLevel: ImpactLevel): number {
    if (impactLevel === 'small') {
      return TERRAIN_DEBRIS_ARROW_ANGULAR_SMALL1000
    }
    if (impactLevel === 'medium') {
      return TERRAIN_DEBRIS_ARROW_ANGULAR_MEDIUM1000
    }
    if (impactLevel === 'large') {
      return TERRAIN_DEBRIS_ARROW_ANGULAR_LARGE1000
    }
    return TERRAIN_DEBRIS_ARROW_ANGULAR_EXTREME1000
  }

  private applyTerrainDebrisImpulse(
    target: Entity,
    impactLevel: ImpactLevel,
    impactX: number,
    dirX1000: number,
    dirY1000: number
  ): boolean {
    if (!target.transform || !target.physics || !this.tempVec) {
      return false
    }
    const { b2Body_ApplyAngularImpulse, b2Body_ApplyLinearImpulseToCenter } =
      this.box2d
    const mass = this.box2d.b2Body_GetMass(target.physics.bodyId)
    const impulse1000 = this.getTerrainDebrisImpulse1000(impactLevel)
    const lift1000 = this.getTerrainDebrisLift1000(impactLevel)
    const angularImpulse1000 =
      this.getTerrainDebrisAngularImpulse1000(impactLevel)

    this.tempVec.x = (dirX1000 * impulse1000 * mass) / 1000000
    this.tempVec.y =
      ((dirY1000 * impulse1000 - lift1000 * 1000) * mass) / 1000000
    b2Body_ApplyLinearImpulseToCenter(target.physics.bodyId, this.tempVec, true)

    const dx = target.transform.x - impactX
    const angularSign = dx === 0 ? (dirX1000 >= 0 ? 1 : -1) : dx > 0 ? 1 : -1
    b2Body_ApplyAngularImpulse(
      target.physics.bodyId,
      (angularImpulse1000 * angularSign * mass) / 1000,
      true
    )
    return true
  }

  private checkTerrainDebrisCollision(
    entity: Entity,
    impactX: number,
    dirX: number,
    dirY: number
  ): boolean {
    const weapon = entity.weapon
    const world = this.world
    if (!weapon || !world) {
      return false
    }
    const weaponX = weapon.visual.x
    const weaponY = weapon.visual.y
    const weaponWidth = weapon.width
    const weaponHeight = weapon.height
    if (weaponWidth <= 0 || weaponHeight <= 0) {
      return false
    }

    const entities = world.getEntities()
    const dirX1000 = Math.round(dirX * 1000)
    const dirY1000 = Math.round(dirY * 1000)
    const fallbackDirX1000 = dirX1000 !== 0 ? dirX1000 : 1000

    for (let i = 0; i < entities.length; i++) {
      const target = entities[i]
      const debris = target?.terrainDebris
      if (
        !target?.transform ||
        !target.physics ||
        !debris?.receivesWeaponImpulse ||
        (target.render?.renderLayer ?? 0) !== weapon.renderLayer
      ) {
        continue
      }
      const debrisWidth = debris.width
      const debrisHeight = debris.height
      if (debrisWidth <= 0 || debrisHeight <= 0) {
        continue
      }
      const dx = target.transform.x - weaponX
      const dy = target.transform.y - weaponY
      const reachX = weaponWidth + debrisWidth
      const reachY = weaponHeight + debrisHeight
      if (Math.abs(dx) > reachX || Math.abs(dy) > reachY) {
        continue
      }
      const debrisRadius =
        target.render?.radius ?? Math.max(debrisWidth, debrisHeight) / 2
      const hit =
        checkOBBvsOBB(
          weaponX,
          weaponY,
          weaponWidth,
          weaponHeight,
          weapon.visual.rotation,
          target.transform.x,
          target.transform.y,
          debrisWidth,
          debrisHeight,
          target.transform.rotation
        ) ||
        checkOBBvsCircle(
          weaponX,
          weaponY,
          weaponWidth,
          weaponHeight,
          weapon.visual.rotation,
          target.transform.x,
          target.transform.y,
          debrisRadius
        )
      if (!hit) {
        continue
      }
      this.applyTerrainDebrisImpulse(
        target,
        weapon.impactLevel,
        impactX,
        fallbackDirX1000,
        dirY1000
      )
      return true
    }
    return false
  }

  private checkBreakableObstacleCollision(
    entity: Entity,
    impactX: number,
    impactY: number
  ): boolean {
    const weapon = entity.weapon
    if (!weapon || this.obstacles.length === 0) {
      return false
    }
    const weaponX = weapon.visual.x
    const weaponY = weapon.visual.y
    const weaponWidth = weapon.width
    const weaponHeight = weapon.height
    const weaponRotation = weapon.visual.rotation

    for (let i = 0; i < this.obstacles.length; i++) {
      const obstacle = this.obstacles[i]
      if (
        obstacle.breakableId === undefined ||
        obstacle.renderLayer !== weapon.renderLayer
      ) {
        continue
      }
      const worldVertices = obstacle.worldVertices
      let hit = false
      if (worldVertices) {
        hit = checkOBBvsPolygon(
          weaponX,
          weaponY,
          weaponWidth,
          weaponHeight,
          weaponRotation,
          worldVertices
        )
      } else if (obstacle.radius !== undefined && obstacle.radius > 0) {
        hit = checkOBBvsCircle(
          weaponX,
          weaponY,
          weaponWidth,
          weaponHeight,
          weaponRotation,
          obstacle.centerX,
          obstacle.centerY,
          obstacle.radius
        )
      } else {
        hit = checkOBBvsAABB(
          weaponX,
          weaponY,
          weaponWidth,
          weaponHeight,
          weaponRotation,
          obstacle.centerX,
          obstacle.centerY,
          obstacle.width,
          obstacle.height
        )
      }
      if (!hit) {
        continue
      }
      this.onBreakableObstacleHit?.({
        obstacle,
        impactLevel: weapon.impactLevel,
        impactX,
        impactY,
        weapon,
        attacker:
          entity.arrow?.ownerId != null
            ? this.world?.getEntityById(entity.arrow.ownerId)
            : undefined,
      })
      return true
    }
    return false
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

    this.statsSystem.emitParrySpark(hitX, hitY, Math.atan2(dirY, dirX))
    this.statsSystem.playSoundAt(SOUND_IDS.SWORD_PARRY, hitX, hitY)
    if (this.soundSystem) {
      const radius = defender.render?.radius ?? DEFAULT_PLAYER_RADIUS
      this.soundSystem.emitSoundAt(
        hitX,
        hitY,
        radius,
        SOUND_DB_PARRY,
        SOUND_RANGE_MULTIPLIER_WEAPON
      )
    }
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

  private shatterProjectile(entity: Entity, hitX: number, hitY: number): void {
    if (this.statsSystem) {
      this.statsSystem.emitSpark(hitX, hitY)
      this.statsSystem.emitSpark(hitX + 0.08, hitY - 0.04)
    }
    this.destroyArrowEntity(entity)
  }

  private destroyArrowEntity(entity: Entity): void {
    if (entity.physics) {
      this.box2d.b2DestroyBody(entity.physics.bodyId)
    }
    this.world?.destroyEntity(entity)
  }
}
