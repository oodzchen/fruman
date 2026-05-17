import {
  DEBUG_DRAW_BREAKABLE_CRATE_HEALTH,
  DEFAULT_GRAVITY,
  DEFAULT_HIT_SHAKE_DURATION_MS,
  DEFAULT_HIT_SHAKE_INTENSITY,
  DEFAULT_PLAYER_RADIUS,
  FALL_DAMAGE_KINETIC_FATAL,
  FALL_DAMAGE_KINETIC_THRESHOLD,
  FALL_DAMAGE_KINETIC_TO_HEALTH_DIVISOR,
  IMPACT_LEVEL_KNOCKBACK,
  PLAYER_WEIGHT_REFERENCE,
} from '../constants'
import type { ImpactLevel } from '../ecs/AttackMoveData'
import type { StatsComponent } from '../ecs/Component'
import type { Entity } from '../ecs/Entity'
import type { World } from '../ecs/World'
import type { GrappleSystem } from '../ecs/systems/GrappleSystem'
import type { EffectsEmitter, StatsSystem } from '../ecs/systems/StatsSystem'
import type { BreakableObstacleHit } from '../ecs/systems/WeaponSystem'
import {
  isCharacterCollisionCategory,
  isGroundCollisionCategory,
  isObstacleCollisionCategory,
} from '../physicsLayers'
import type { MainModule, b2BodyId, b2ShapeId } from '../types'
import { SOUND_IDS } from './effectsProtocol'

export interface BreakableCratePlankRuntime {
  crateId: number
  entity: Entity | null
  bodyId: b2BodyId
  shapeId: b2ShapeId
  obstacleIndex: number
  localCenterX: number
  localCenterY: number
  centerX: number
  centerY: number
  halfWidth: number
  halfHeight: number
  rotationRad: number
  debrisVariant: number
}

export interface BreakableCrateRuntime {
  id: number
  envIndex: number
  seed: number
  renderLayer: number
  destroyed: boolean
  health: number
  bodyId: b2BodyId
  centerX: number
  centerY: number
  rotationRad: number
  isGrounded: boolean
  wasGrounded: boolean
  fallTrackingActive: boolean
  fallDamageIgnoreUntilMs: number
  maxFallVelocity1000: number
  fallStartY1000: number
  fallContactCount: number
  fallSolidContactCount: number
  sleepSynced: boolean
  hitObstacleIndex: number
  hitLocalCenterX: number
  hitLocalCenterY: number
  hitHalfWidth: number
  hitHalfHeight: number
  planks: BreakableCratePlankRuntime[]
}

export interface BreakableCrateBreakRequest {
  crateId: number
  impactX: number
  impactY: number
  impactLevel: ImpactLevel
  sourceEntityId: number
}

export const BREAKABLE_CRATE_MAX_HEALTH = 2
export const BREAKABLE_CRATE_SPAWN_FALL_DAMAGE_GRACE_MS = 500

const BREAKABLE_CRATE_IMPACT_DAMAGE_SMALL = 1
const BREAKABLE_CRATE_IMPACT_DAMAGE_LARGE = 2
export const FALL_IMPACT_CONTACT_NORMAL_Y_MIN = 0.2
const FALL_IMPACT_EMBED_TOLERANCE1000 = 150
const FALL_IMPACT_LARGE_DISTANCE1000 = 10000
const FALL_IMPACT_EXTREME_DISTANCE1000 = 16000
const FALL_IMPACT_SOURCE_UNSTICK_SIDE_VELOCITY1000 = 700
const FALL_IMPACT_SOURCE_UNSTICK_UP_VELOCITY1000 = 1600
const FALL_IMPACT_TARGET_UNSTICK_VELOCITY1000 = 900

interface ImpactPhysicsRuntime {
  box2d: MainModule
  world: World
  statsSystem: StatsSystem
  grappleSystem: GrappleSystem
  breakableCrates: Map<number, BreakableCrateRuntime>
  breakableCratePlanksByShapeId: Map<b2ShapeId, BreakableCratePlankRuntime>
  effectsEmitter: EffectsEmitter
}

export class ImpactPhysics {
  private runtime: ImpactPhysicsRuntime | null = null
  private readonly pendingBreakableCrateBreaks: BreakableCrateBreakRequest[] =
    []
  private readonly pendingBreakableCrateBreakIds = new Set<number>()
  private readonly fallImpactEntityIds: number[] = []
  private readonly fallImpactCrateIds: number[] = []
  private readonly fallImpactWeaponHit: {
    attackDamage: number
    postureDamage: number
    toughnessDamage: number
    impactLevel: ImpactLevel
    knockbackDirectionX: number
    knockbackDirectionY: number
  } = {
    attackDamage: 0,
    postureDamage: 0,
    toughnessDamage: 0,
    impactLevel: 'small',
    knockbackDirectionX: 0,
    knockbackDirectionY: 1,
  }
  private readonly fallImpactHitSource = { x: 0, y: 0 }
  private fallImpactImpulseVec: InstanceType<MainModule['b2Vec2']> | null = null
  private fallImpactDirectionX = 0
  private fallImpactDirectionY = 1

  syncRuntime(runtime: ImpactPhysicsRuntime): void {
    this.runtime = runtime
  }

  clearPendingBreaks(): void {
    this.pendingBreakableCrateBreaks.length = 0
    this.pendingBreakableCrateBreakIds.clear()
  }

  flushPendingBreakableCrateBreaks(
    breakCrate: (request: BreakableCrateBreakRequest) => void
  ): void {
    if (this.pendingBreakableCrateBreaks.length === 0) {
      return
    }
    while (this.pendingBreakableCrateBreaks.length > 0) {
      const request = this.pendingBreakableCrateBreaks.pop()
      if (!request) {
        continue
      }
      this.pendingBreakableCrateBreakIds.delete(request.crateId)
      breakCrate(request)
    }
  }

  syncBreakableCrateDebugStats(crate: BreakableCrateRuntime): void {
    const stats = this.getBreakableCrateDebugStats(crate)
    if (!stats) {
      return
    }
    stats.maxHealth = BREAKABLE_CRATE_MAX_HEALTH
    stats.health = crate.health
  }

  applyBreakableCrateDamage(
    crateId: number,
    damage: number,
    impactX: number,
    impactY: number,
    impactLevel: ImpactLevel,
    sourceEntityId = 0
  ): void {
    const runtime = this.runtime
    if (!runtime) {
      return
    }
    const crate = runtime.breakableCrates.get(crateId)
    if (
      !crate ||
      crate.destroyed ||
      this.pendingBreakableCrateBreakIds.has(crateId)
    ) {
      return
    }

    const damageValue = Math.max(1, Math.trunc(damage))
    crate.health -= damageValue
    const debugStats = this.getBreakableCrateDebugStats(crate)
    if (debugStats) {
      debugStats.maxHealth = BREAKABLE_CRATE_MAX_HEALTH
      debugStats.health = Math.max(0, crate.health)
      debugStats.healthBarTimerMs = 3000
      debugStats.pendingDamageTextValue += damageValue
      debugStats.pendingDamageTextToken += 1
    }
    if (crate.health <= 0) {
      crate.health = 0
      this.queueBreakableCrateBreak(
        crateId,
        impactX,
        impactY,
        impactLevel,
        sourceEntityId
      )
      return
    }

    this.emitBreakableCrateHitFeedback(crate, impactX, impactY)
  }

  handleBreakableObstacleHit(hit: BreakableObstacleHit): void {
    const crateId = hit.obstacle.breakableId
    if (crateId === undefined) {
      return
    }
    this.applyBreakableCrateDamage(
      crateId,
      this.getBreakableCrateHitDamage(hit),
      hit.impactX,
      hit.impactY,
      hit.impactLevel,
      hit.attacker?.id ?? 0
    )
  }

  handleEntityFallImpact(
    entity: Entity,
    damage: number,
    fallDistance1000: number
  ): void {
    if (
      !entity.physics ||
      !entity.transform ||
      damage < 0 ||
      fallDistance1000 <= 0
    ) {
      return
    }
    const sourceRadius = entity.render?.radius ?? DEFAULT_PLAYER_RADIUS
    const impactLevel = this.getFallImpactLevel(fallDistance1000)
    this.applyFallImpactTargetsFromBody(
      entity.physics.bodyId,
      damage,
      entity.transform.x,
      entity.transform.y + sourceRadius,
      impactLevel,
      entity.id,
      0,
      true
    )
  }

  handleBreakableCrateFallDamage(
    crate: BreakableCrateRuntime,
    velocityY1000: number,
    playTimeMs: number
  ): void {
    const runtime = this.runtime
    if (!runtime) {
      return
    }
    const grounded = this.isBreakableCrateGrounded(crate)
    const wasGrounded = crate.wasGrounded
    crate.isGrounded = grounded
    crate.wasGrounded = grounded
    const ignoreSpawnFallDamage = playTimeMs < crate.fallDamageIgnoreUntilMs

    if (ignoreSpawnFallDamage) {
      if (grounded) {
        if (crate.fallTrackingActive) {
          runtime.box2d.b2Body_SetBullet(crate.bodyId, false)
        }
        crate.fallTrackingActive = false
        crate.maxFallVelocity1000 = 0
        crate.fallStartY1000 = 0
        return
      }
      if (velocityY1000 > 0) {
        if (!crate.fallTrackingActive) {
          crate.fallTrackingActive = true
          crate.fallStartY1000 = Math.round(crate.centerY * 1000)
          runtime.box2d.b2Body_SetBullet(crate.bodyId, true)
        }
        if (velocityY1000 > crate.maxFallVelocity1000) {
          crate.maxFallVelocity1000 = velocityY1000
        }
      }
      return
    }

    if (!grounded && velocityY1000 > 0) {
      if (!crate.fallTrackingActive) {
        crate.fallTrackingActive = true
        crate.fallStartY1000 = Math.round(crate.centerY * 1000)
        runtime.box2d.b2Body_SetBullet(crate.bodyId, true)
      }
      if (velocityY1000 > crate.maxFallVelocity1000) {
        crate.maxFallVelocity1000 = velocityY1000
      }
      return
    }

    if (wasGrounded || !grounded || !crate.fallTrackingActive) {
      return
    }

    const landingY1000 = Math.round(crate.centerY * 1000)
    const damage = this.getBreakableCrateFallDamage(
      crate.maxFallVelocity1000,
      crate.fallStartY1000,
      landingY1000
    )
    const fallDistance1000 = Math.max(0, landingY1000 - crate.fallStartY1000)
    runtime.box2d.b2Body_SetBullet(crate.bodyId, false)
    crate.fallTrackingActive = false
    crate.maxFallVelocity1000 = 0
    crate.fallStartY1000 = 0
    if (damage <= 0) {
      return
    }
    const impactX = crate.centerX
    const impactY = crate.centerY + crate.hitHalfHeight
    const impactLevel = this.getFallImpactLevel(fallDistance1000)
    if (fallDistance1000 > 0) {
      this.applyFallImpactTargetsFromBody(
        crate.bodyId,
        damage,
        impactX,
        impactY,
        impactLevel,
        0,
        crate.id
      )
    }
    this.applyBreakableCrateDamage(
      crate.id,
      damage,
      impactX,
      impactY,
      impactLevel
    )
  }

  private getBreakableCrateByBodyId(
    bodyId: b2BodyId
  ): BreakableCrateRuntime | undefined {
    const runtime = this.runtime
    if (!runtime) {
      return undefined
    }
    for (const crate of runtime.breakableCrates.values()) {
      if (!crate.destroyed && areBodyIdsEqual(crate.bodyId, bodyId)) {
        return crate
      }
    }
    return undefined
  }

  private getBreakableCrateByShapeId(
    shapeId: b2ShapeId
  ): BreakableCrateRuntime | undefined {
    const runtime = this.runtime
    if (!runtime) {
      return undefined
    }
    const plank = runtime.breakableCratePlanksByShapeId.get(shapeId)
    if (!plank) {
      return undefined
    }
    const crate = runtime.breakableCrates.get(plank.crateId)
    return crate && !crate.destroyed ? crate : undefined
  }

  private getDamageableEntityByBodyId(
    bodyId: b2BodyId,
    skippedEntityId: number
  ): Entity | undefined {
    const runtime = this.runtime
    if (!runtime) {
      return undefined
    }
    const entities = runtime.world.getEntities()
    for (let i = 0; i < entities.length; i++) {
      const entity = entities[i]
      if (
        entity.id === skippedEntityId ||
        !entity.physics ||
        !entity.stats ||
        entity.stats.isDead
      ) {
        continue
      }
      if (areBodyIdsEqual(entity.physics.bodyId, bodyId)) {
        return entity
      }
    }
    return undefined
  }

  private getBreakableCrateVelocityEnergy(maxFallVelocity1000: number): number {
    if (maxFallVelocity1000 <= 0) {
      return 0
    }
    return Math.trunc(
      (PLAYER_WEIGHT_REFERENCE * maxFallVelocity1000 * maxFallVelocity1000) /
        2000000
    )
  }

  private getBreakableCrateHeightEnergy(
    fallStartY1000: number,
    landingY1000: number
  ): number {
    const fallHeight1000 = landingY1000 - fallStartY1000
    if (fallHeight1000 <= 0) {
      return 0
    }
    return Math.trunc(
      (PLAYER_WEIGHT_REFERENCE * DEFAULT_GRAVITY * fallHeight1000) / 1000
    )
  }

  private getBreakableCrateFallDamage(
    maxFallVelocity1000: number,
    fallStartY1000: number,
    landingY1000: number
  ): number {
    const velocityEnergy =
      this.getBreakableCrateVelocityEnergy(maxFallVelocity1000)
    const heightEnergy = this.getBreakableCrateHeightEnergy(
      fallStartY1000,
      landingY1000
    )
    const kineticEnergy =
      velocityEnergy > heightEnergy ? velocityEnergy : heightEnergy
    if (kineticEnergy >= FALL_DAMAGE_KINETIC_FATAL) {
      return BREAKABLE_CRATE_MAX_HEALTH
    }
    if (kineticEnergy < FALL_DAMAGE_KINETIC_THRESHOLD) {
      return 0
    }
    const excessKinetic = kineticEnergy - FALL_DAMAGE_KINETIC_THRESHOLD
    return Math.max(
      1,
      Math.trunc(excessKinetic / FALL_DAMAGE_KINETIC_TO_HEALTH_DIVISOR)
    )
  }

  private isBreakableCrateGrounded(crate: BreakableCrateRuntime): boolean {
    const runtime = this.runtime
    if (!runtime) {
      return false
    }
    const {
      b2Body_GetContactCapacity,
      b2Body_GetContactData,
      b2Shape_GetBody,
      b2Shape_GetFilter,
    } = runtime.box2d
    const capacity = b2Body_GetContactCapacity(crate.bodyId)
    if (capacity <= 0) {
      crate.fallContactCount = 0
      crate.fallSolidContactCount = 0
      return false
    }
    const contactData = b2Body_GetContactData(crate.bodyId, capacity)
    let grounded = false
    crate.fallContactCount = contactData.length
    crate.fallSolidContactCount = 0
    for (let i = 0; i < contactData.length; i++) {
      const contact = contactData[i]
      const normalY = contact.manifold.normal.y
      const absNormalY = normalY < 0 ? -normalY : normalY
      const filterA = b2Shape_GetFilter(contact.shapeIdA)
      const filterB = b2Shape_GetFilter(contact.shapeIdB)
      const categoryA = filterA.categoryBits
      const categoryB = filterB.categoryBits
      const bodyA = b2Shape_GetBody(contact.shapeIdA)
      const bodyB = b2Shape_GetBody(contact.shapeIdB)
      let otherCategory = 0
      if (areBodyIdsEqual(bodyA, crate.bodyId)) {
        otherCategory = categoryB
      } else if (areBodyIdsEqual(bodyB, crate.bodyId)) {
        otherCategory = categoryA
      }
      if (
        otherCategory !== 0 &&
        absNormalY > FALL_IMPACT_CONTACT_NORMAL_Y_MIN &&
        (isGroundCollisionCategory(otherCategory) ||
          isObstacleCollisionCategory(otherCategory) ||
          isCharacterCollisionCategory(otherCategory))
      ) {
        crate.fallSolidContactCount += 1
        grounded = true
      }
      contact.delete()
    }
    return grounded
  }

  private getFallImpactLevel(fallDistance1000: number): ImpactLevel {
    if (fallDistance1000 >= FALL_IMPACT_EXTREME_DISTANCE1000) {
      return 'extreme'
    }
    if (fallDistance1000 >= FALL_IMPACT_LARGE_DISTANCE1000) {
      return 'large'
    }
    return 'medium'
  }

  private updateFallImpactDirection(
    targetX: number,
    targetY: number,
    impactX: number,
    impactY: number
  ): void {
    const dirX = targetX - impactX
    const dirY = Math.abs(targetY - impactY)
    const distance = Math.hypot(dirX, dirY)
    if (distance > 0) {
      this.fallImpactDirectionX = dirX / distance
      this.fallImpactDirectionY = dirY / distance
      return
    }
    this.fallImpactDirectionX = 0
    this.fallImpactDirectionY = 1
  }

  private isValidFallImpactTargetPosition(
    impactY: number,
    targetCenterY: number,
    targetHalfHeight: number
  ): boolean {
    const targetBottomY = targetCenterY + targetHalfHeight
    const embedDepth1000 = Math.round((impactY - targetBottomY) * 1000)
    return embedDepth1000 <= FALL_IMPACT_EMBED_TOLERANCE1000
  }

  private getFallImpactImpulseVec(): InstanceType<MainModule['b2Vec2']> | null {
    const runtime = this.runtime
    if (!runtime) {
      return null
    }
    if (!this.fallImpactImpulseVec) {
      this.fallImpactImpulseVec = new runtime.box2d.b2Vec2(0, 0)
    }
    return this.fallImpactImpulseVec
  }

  private applyFallImpactImpulseToBody(
    bodyId: b2BodyId,
    impactLevel: ImpactLevel
  ): void {
    const runtime = this.runtime
    if (!runtime) {
      return
    }
    const knockback = IMPACT_LEVEL_KNOCKBACK[impactLevel]
    if (knockback <= 0) {
      return
    }
    const { b2Body_ApplyLinearImpulseToCenter, b2Body_GetMass } = runtime.box2d
    const mass = b2Body_GetMass(bodyId)
    const impulseVec = this.getFallImpactImpulseVec()
    if (!impulseVec) {
      return
    }
    impulseVec.x = this.fallImpactDirectionX * knockback * 2 * mass
    impulseVec.y = this.fallImpactDirectionY * knockback * 2 * mass
    b2Body_ApplyLinearImpulseToCenter(bodyId, impulseVec, true)
  }

  private applyFallImpactTargetUnstickImpulse(bodyId: b2BodyId): void {
    const runtime = this.runtime
    if (!runtime) {
      return
    }
    const { b2Body_ApplyLinearImpulseToCenter, b2Body_GetMass } = runtime.box2d
    const mass = b2Body_GetMass(bodyId)
    const impulseVec = this.getFallImpactImpulseVec()
    if (!impulseVec) {
      return
    }
    impulseVec.x =
      (this.fallImpactDirectionX *
        FALL_IMPACT_TARGET_UNSTICK_VELOCITY1000 *
        mass) /
      1000
    impulseVec.y =
      (this.fallImpactDirectionY *
        FALL_IMPACT_TARGET_UNSTICK_VELOCITY1000 *
        mass) /
      1000
    b2Body_ApplyLinearImpulseToCenter(bodyId, impulseVec, true)
  }

  private applyFallImpactSourceUnstickImpulse(bodyId: b2BodyId): void {
    const runtime = this.runtime
    if (!runtime) {
      return
    }
    const { b2Body_ApplyLinearImpulseToCenter, b2Body_GetMass } = runtime.box2d
    const mass = b2Body_GetMass(bodyId)
    const impulseVec = this.getFallImpactImpulseVec()
    if (!impulseVec) {
      return
    }
    impulseVec.x =
      (-this.fallImpactDirectionX *
        FALL_IMPACT_SOURCE_UNSTICK_SIDE_VELOCITY1000 *
        mass) /
      1000
    impulseVec.y = -(FALL_IMPACT_SOURCE_UNSTICK_UP_VELOCITY1000 * mass) / 1000
    b2Body_ApplyLinearImpulseToCenter(bodyId, impulseVec, true)
  }

  private applyFallImpactDamageToEntity(
    entity: Entity,
    damage: number,
    impactX: number,
    impactY: number,
    impactLevel: ImpactLevel
  ): void {
    const runtime = this.runtime
    if (!runtime || !entity.stats || entity.stats.isDead) {
      return
    }
    this.fallImpactWeaponHit.attackDamage = damage
    this.fallImpactWeaponHit.impactLevel = impactLevel
    this.fallImpactWeaponHit.knockbackDirectionX = this.fallImpactDirectionX
    this.fallImpactWeaponHit.knockbackDirectionY = this.fallImpactDirectionY
    this.fallImpactHitSource.x = impactX
    this.fallImpactHitSource.y = impactY
    runtime.statsSystem.applyWeaponHit(
      entity,
      this.fallImpactWeaponHit,
      this.fallImpactHitSource
    )
  }

  private applyFallImpactTargetsFromBody(
    sourceBodyId: b2BodyId,
    damage: number,
    impactX: number,
    impactY: number,
    impactLevel: ImpactLevel,
    skippedEntityId: number,
    skippedCrateId: number,
    allowSourceCrateUnstick = false
  ): void {
    const runtime = this.runtime
    if (!runtime || damage < 0) {
      return
    }
    const {
      b2Body_GetContactCapacity,
      b2Body_GetContactData,
      b2Shape_GetBody,
      b2Shape_GetFilter,
    } = runtime.box2d
    const capacity = b2Body_GetContactCapacity(sourceBodyId)
    if (capacity <= 0) {
      return
    }

    this.fallImpactEntityIds.length = 0
    this.fallImpactCrateIds.length = 0
    const contactData = b2Body_GetContactData(sourceBodyId, capacity)
    for (let i = 0; i < contactData.length; i++) {
      const contact = contactData[i]
      const normalY = contact.manifold.normal.y
      const absNormalY = normalY < 0 ? -normalY : normalY
      if (absNormalY <= FALL_IMPACT_CONTACT_NORMAL_Y_MIN) {
        contact.delete()
        continue
      }

      const bodyA = b2Shape_GetBody(contact.shapeIdA)
      const bodyB = b2Shape_GetBody(contact.shapeIdB)
      const filterA = b2Shape_GetFilter(contact.shapeIdA)
      const filterB = b2Shape_GetFilter(contact.shapeIdB)
      let otherBody: b2BodyId | null = null
      let otherShapeId: b2ShapeId | null = null
      let otherCategory = 0
      if (areBodyIdsEqual(bodyA, sourceBodyId)) {
        otherBody = bodyB
        otherShapeId = contact.shapeIdB
        otherCategory = filterB.categoryBits
      } else if (areBodyIdsEqual(bodyB, sourceBodyId)) {
        otherBody = bodyA
        otherShapeId = contact.shapeIdA
        otherCategory = filterA.categoryBits
      }

      if (otherBody) {
        if (isObstacleCollisionCategory(otherCategory)) {
          const targetCrate =
            this.getBreakableCrateByBodyId(otherBody) ||
            (otherShapeId
              ? this.getBreakableCrateByShapeId(otherShapeId)
              : undefined)
          if (
            targetCrate &&
            targetCrate.id !== skippedCrateId &&
            !hasNumberValue(this.fallImpactCrateIds, targetCrate.id)
          ) {
            this.fallImpactCrateIds.push(targetCrate.id)
            this.updateFallImpactDirection(
              targetCrate.centerX,
              targetCrate.centerY,
              impactX,
              impactY
            )
            if (damage > 0) {
              this.applyFallImpactImpulseToBody(targetCrate.bodyId, impactLevel)
              this.applyBreakableCrateDamage(
                targetCrate.id,
                damage,
                impactX,
                impactY,
                impactLevel,
                skippedEntityId
              )
              if (targetCrate.health > 0 && allowSourceCrateUnstick) {
                this.applyFallImpactSourceUnstickImpulse(sourceBodyId)
              }
            } else if (allowSourceCrateUnstick) {
              this.applyFallImpactTargetUnstickImpulse(targetCrate.bodyId)
              this.applyFallImpactSourceUnstickImpulse(sourceBodyId)
            }
          }
        } else if (isCharacterCollisionCategory(otherCategory) && damage > 0) {
          const targetEntity = this.getDamageableEntityByBodyId(
            otherBody,
            skippedEntityId
          )
          if (
            targetEntity &&
            targetEntity.transform &&
            this.isValidFallImpactTargetPosition(
              impactY,
              targetEntity.transform.y,
              targetEntity.render?.radius ?? DEFAULT_PLAYER_RADIUS
            ) &&
            !hasNumberValue(this.fallImpactEntityIds, targetEntity.id)
          ) {
            this.fallImpactEntityIds.push(targetEntity.id)
            this.updateFallImpactDirection(
              targetEntity.transform.x,
              targetEntity.transform.y,
              impactX,
              impactY
            )
            this.applyFallImpactDamageToEntity(
              targetEntity,
              damage,
              impactX,
              impactY,
              impactLevel
            )
          }
        }
      }
      contact.delete()
    }
  }

  private queueBreakableCrateBreak(
    crateId: number,
    impactX: number,
    impactY: number,
    impactLevel: ImpactLevel,
    sourceEntityId: number
  ): void {
    const runtime = this.runtime
    if (!runtime) {
      return
    }
    const crate = runtime.breakableCrates.get(crateId)
    if (!crate || crate.destroyed) {
      return
    }
    this.detachBreakableCrateGrappleTethers(crate)
    if (this.pendingBreakableCrateBreakIds.has(crateId)) {
      return
    }
    this.pendingBreakableCrateBreakIds.add(crateId)
    this.pendingBreakableCrateBreaks.push({
      crateId,
      impactX,
      impactY,
      impactLevel,
      sourceEntityId,
    })
  }

  private getBreakableCrateImpactDamage(impactLevel: ImpactLevel): number {
    return impactLevel === 'large' || impactLevel === 'extreme'
      ? BREAKABLE_CRATE_IMPACT_DAMAGE_LARGE
      : BREAKABLE_CRATE_IMPACT_DAMAGE_SMALL
  }

  private getBreakableCrateHitDamage(hit: BreakableObstacleHit): number {
    const weaponDamage = hit.weapon?.attackDamage
    if (weaponDamage !== undefined && weaponDamage > 0) {
      return Math.max(1, Math.trunc(weaponDamage))
    }
    return this.getBreakableCrateImpactDamage(hit.impactLevel)
  }

  private emitBreakableCrateHitFeedback(
    crate: BreakableCrateRuntime,
    impactX: number,
    impactY: number
  ): void {
    const runtime = this.runtime
    if (!runtime) {
      return
    }
    const dirX = crate.centerX >= impactX ? 1 : -1

    for (let i = 0; i < crate.planks.length; i++) {
      const stats = crate.planks[i].entity?.stats
      if (!stats) {
        continue
      }
      stats.hitShakeElapsedMs = 0
      stats.hitShakeDurationMs = DEFAULT_HIT_SHAKE_DURATION_MS
      stats.hitShakeIntensity = DEFAULT_HIT_SHAKE_INTENSITY
      stats.hitShakeDirectionX = dirX
    }

    runtime.effectsEmitter.playSoundAt(SOUND_IDS.BODY_HIT, impactX, impactY)
  }

  private getBreakableCrateDebugStats(
    crate: BreakableCrateRuntime
  ): StatsComponent | undefined {
    if (!DEBUG_DRAW_BREAKABLE_CRATE_HEALTH) {
      return undefined
    }
    return crate.planks[0]?.entity?.stats
  }

  private detachBreakableCrateGrappleTethers(
    crate: BreakableCrateRuntime
  ): void {
    const runtime = this.runtime
    if (!runtime) {
      return
    }

    for (let i = 0; i < crate.planks.length; i++) {
      const plankEntity = crate.planks[i].entity
      if (plankEntity) {
        runtime.grappleSystem.detachTetherTarget(plankEntity.id)
      }
    }
  }
}

export function areBodyIdsEqual(a: b2BodyId, b: b2BodyId): boolean {
  return (
    a.index1 === b.index1 &&
    a.world0 === b.world0 &&
    a.generation === b.generation
  )
}

function hasNumberValue(values: readonly number[], value: number): boolean {
  for (let i = 0; i < values.length; i++) {
    if (values[i] === value) {
      return true
    }
  }
  return false
}
