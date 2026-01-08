import {
  DEFAULT_BODY_FRICTION,
  DEFAULT_BODY_LINEAR_DAMPING,
  DEFAULT_DEATH_FLASH_DURATION,
  DEFAULT_DEATH_FLATTEN_DURATION,
  DEFAULT_HIT_SHAKE_DURATION_MS,
  DEFAULT_HIT_SHAKE_INTENSITY,
  DEFAULT_PLAYER_RADIUS,
  DEFAULT_WEAPON_ATTACK_DAMAGE,
  DEFAULT_WEAPON_TOUGHNESS_DAMAGE,
} from '../../constants'
import type { MainModule, b2WorldId } from '../../types'
import { PhysicsComponent } from '../Component'
import { componentRegistry } from '../ComponentRegistry'
import type { Entity } from '../Entity'
import { System } from '../System'

export class StatsSystem extends System {
  private box2d?: MainModule
  private worldId?: b2WorldId

  constructor(box2d?: MainModule, worldId?: b2WorldId) {
    super()
    this.box2d = box2d
    this.worldId = worldId
    const statsType = componentRegistry.getComponentType('Stats')
    this.setRequiredComponents([statsType])
  }

  update(entities: Entity[], deltaTime: number): void {
    const deltaSeconds = deltaTime > 0 ? deltaTime : 0
    const deltaMs = deltaSeconds * 1000
    for (const entity of entities) {
      if (!entity.stats) continue
      if (entity.stats.isDead) {
        if (!entity.stats.isVanished) {
          entity.stats.deathElapsedSec += deltaSeconds
          const totalDuration =
            entity.stats.deathFlashDurationSec +
            entity.stats.deathFlattenDurationSec
          if (entity.stats.deathElapsedSec >= totalDuration) {
            entity.stats.isVanished = true
            if (entity.render) {
              entity.render.visible = false
            }
            this.removePhysics(entity)
          }
        }
        continue
      }

      if (entity.stats.hitShakeDurationMs > 0) {
        entity.stats.hitShakeElapsedMs += deltaMs
        if (entity.stats.hitShakeElapsedMs >= entity.stats.hitShakeDurationMs) {
          entity.stats.hitShakeDurationMs = 0
          entity.stats.hitShakeElapsedMs = 0
        }
      }

      if (entity.stats.toughness < entity.stats.maxToughness) {
        const recovery = entity.stats.toughnessRecoveryPerSecond * deltaSeconds
        entity.stats.toughness = Math.min(
          entity.stats.maxToughness,
          entity.stats.toughness + recovery
        )
      }
    }
  }

  applyStandardHit(entity: Entity): void {
    this.applyWeaponHit(entity)
  }

  applyWeaponHit(
    entity: Entity,
    weapon?: { attackDamage: number; toughnessDamage: number },
    hitSource?: { x: number; y: number }
  ): void {
    const attackDamage = Math.max(
      0,
      weapon?.attackDamage ?? DEFAULT_WEAPON_ATTACK_DAMAGE
    )
    const toughnessDamage = Math.max(
      0,
      weapon?.toughnessDamage ?? DEFAULT_WEAPON_TOUGHNESS_DAMAGE
    )
    this.applyDamage(entity, attackDamage, toughnessDamage, hitSource)
  }

  private applyDamage(
    entity: Entity,
    healthDamage: number,
    toughnessDamage: number,
    hitSource?: { x: number; y: number }
  ): void {
    if (!entity.stats) return
    if (entity.stats.isDead) return

    // 翻滚期间无敌
    if (entity.movement?.isRolling) return

    const clampedHealthDamage = Math.max(0, healthDamage)
    const clampedToughnessDamage = Math.max(0, toughnessDamage)

    entity.stats.health = Math.max(0, entity.stats.health - clampedHealthDamage)
    entity.stats.toughness = Math.max(
      0,
      entity.stats.toughness - clampedToughnessDamage
    )

    if (hitSource && entity.transform) {
      const dirX = entity.transform.x - hitSource.x
      const distance = Math.hypot(dirX, entity.transform.y - hitSource.y)
      const normalizedDirX = distance > 0 ? dirX / distance : 1

      entity.stats.hitShakeElapsedMs = 0
      entity.stats.hitShakeDurationMs = DEFAULT_HIT_SHAKE_DURATION_MS
      entity.stats.hitShakeIntensity = DEFAULT_HIT_SHAKE_INTENSITY
      entity.stats.hitShakeDirectionX = normalizedDirX
    }

    if (entity.stats.health === 0) {
      entity.stats.isDead = true
      entity.stats.isVanished = false
      entity.stats.deathElapsedSec = 0
      entity.stats.deathFlashDurationSec = DEFAULT_DEATH_FLASH_DURATION
      entity.stats.deathFlattenDurationSec = DEFAULT_DEATH_FLATTEN_DURATION
      if (entity.render) {
        entity.render.visible = true
      }
      if (entity.input) {
        entity.input.moveDirection = 0
        entity.input.jumpRequested = false
        entity.input.attackRequested = false
      }
      if (entity.weapon) {
        entity.weapon.attackPhase = 'idle'
        entity.weapon.attackElapsedMs = 0
        entity.weapon.attackQueued = false
        entity.weapon.isInCombat = false
        entity.weapon.isColliding = false
        entity.weapon.hitEntityIds.clear()
      }
      this.stabilizeBody(entity)
    }
  }

  revive(entity: Entity): void {
    if (!entity.stats) return

    entity.stats.health = entity.stats.maxHealth
    entity.stats.toughness = entity.stats.maxToughness
    entity.stats.isDead = false
    entity.stats.isVanished = false
    entity.stats.deathElapsedSec = 0
    if (entity.render) {
      entity.render.visible = true
    }
    if (!entity.physics) {
      this.recreatePhysics(entity)
    }
  }

  private stabilizeBody(entity: Entity): void {
    if (!this.box2d || !entity.physics) return

    const { b2Body_SetLinearVelocity, b2Vec2, b2Body_SetLinearDamping } =
      this.box2d
    const stopVelocity = new b2Vec2(0, 0)
    b2Body_SetLinearVelocity(entity.physics.bodyId, stopVelocity)
    b2Body_SetLinearDamping(entity.physics.bodyId, 10)
    stopVelocity.delete()

    if (entity.physics.shapeId) {
      const { b2Shape_SetFriction } = this.box2d
      b2Shape_SetFriction(entity.physics.shapeId, 3)
    }
  }

  private removePhysics(entity: Entity): void {
    if (!this.box2d) return
    if (!entity.physics) return

    const { b2DestroyBody } = this.box2d
    b2DestroyBody(entity.physics.bodyId)
    entity.removeComponent('Physics')
  }

  private recreatePhysics(entity: Entity): void {
    if (!this.box2d || !this.worldId) return
    if (!entity.transform) return

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
    bodyDef.position.Set(entity.transform.x, entity.transform.y)
    bodyDef.motionLocks.angularZ = true
    bodyDef.linearDamping = DEFAULT_BODY_LINEAR_DAMPING
    const bodyId = b2CreateBody(this.worldId, bodyDef)

    const shape = new b2Capsule()
    shape.center1.Set(0, 0)
    shape.center2.Set(0, 0)
    shape.radius = DEFAULT_PLAYER_RADIUS
    const fixtureDef = b2DefaultShapeDef()
    fixtureDef.density = 1.0
    fixtureDef.material.friction = DEFAULT_BODY_FRICTION
    const shapeId = b2CreateCapsuleShape(bodyId, fixtureDef, shape)

    bodyDef.delete()
    shape.delete()
    fixtureDef.delete()

    const physics = new PhysicsComponent()
    physics.bodyId = bodyId
    physics.shapeId = shapeId
    entity.addComponent(physics)
  }
}
