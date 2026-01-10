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
  STAGGER_DAMAGE_MULTIPLIER,
  STAGGER_HIT_STUN_DURATION_MS,
  STAGGER_KNOCKBACK_MULTIPLIER,
} from '../../constants'
import type { MainModule, b2WorldId } from '../../types'
import { PhysicsComponent } from '../Component'
import { componentRegistry } from '../ComponentRegistry'
import type { Entity } from '../Entity'
import { System } from '../System'

export class StatsSystem extends System {
  private box2d?: MainModule
  private worldId?: b2WorldId
  private tempVec?: InstanceType<MainModule['b2Vec2']>
  private currentDeltaTime = 0

  constructor(box2d?: MainModule, worldId?: b2WorldId) {
    super()
    this.box2d = box2d
    this.worldId = worldId
    if (box2d) {
      this.tempVec = new box2d.b2Vec2(0, 0)
    }
    const statsType = componentRegistry.getComponentType('Stats')
    this.setRequiredComponents([statsType])
  }

  update(entities: Entity[], deltaTime: number): void {
    this.currentDeltaTime = deltaTime
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

      // 处理崩塌状态
      if (entity.stats.isStaggered) {
        entity.stats.staggerElapsedTime += deltaTime
        entity.stats.staggerAnimationElapsed += deltaMs
        this.updateStaggerAnimation(entity)

        const elapsedMs = entity.stats.staggerElapsedTime * 1000
        if (elapsedMs >= entity.stats.staggerDuration) {
          entity.stats.isStaggered = false
          entity.stats.staggerElapsedTime = 0
          entity.stats.staggerAnimationPhase = 'none'
          entity.stats.staggerAnimationElapsed = 0
          entity.stats.toughness = entity.stats.maxToughness

          // 崩塌自动恢复时重置连击状态
          if (entity.weapon) {
            entity.weapon.comboCount = 0
            entity.weapon.swingDirection = 'toFront'
            entity.weapon.nextSwingDirection = 'toFront'
            entity.weapon.attackPhase = 'idle'
            entity.weapon.attackElapsedMs = 0
            entity.weapon.attackQueued = false
            entity.weapon.hitEntityIds.clear()
          }

          if (entity.enemyAI) {
            entity.enemyAI.state = 'approach'
            entity.enemyAI.comboSwingsDone = 0
          }
        }
        continue
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

  private updateStaggerAnimation(entity: Entity): void {
    if (!entity.stats || !entity.movement) return

    const elapsed = entity.stats.staggerAnimationElapsed
    const facing = entity.input?.lastMoveDirection || 1

    // Phase 1: 向后旋转 (0 - 300ms)
    // 目标角度: 向后倾斜30度 (PI/6)
    // 如果面向右(1)，向后是逆时针(-)，即 -30度
    // 如果面向左(-1)，向后是顺时针(+)，即 +30度
    const backAngle = -facing * (Math.PI / 6)

    // Phase 2: 向前俯趴 (300 - 500ms)
    // 目标角度: 向前倒下90度 (PI/2)
    // 如果面向右(1)，向前是顺时针(+)，即 +90度
    // 如果面向左(-1)，向前是逆时针(-)，即 -90度
    const proneAngle = facing * (Math.PI / 2)

    if (elapsed < 1200) {
      entity.stats.staggerAnimationPhase = 'rotateBack'
      const t = elapsed / 1200
      // 缓动
      const easedT = 1 - Math.pow(1 - t, 2)
      entity.movement.rollAngle = backAngle * easedT
    } else if (elapsed < 1500) {
      entity.stats.staggerAnimationPhase = 'prone'
      const t = (elapsed - 1200) / 300
      // 缓动
      const easedT = t * t // 加速倒下
      entity.movement.rollAngle = backAngle + (proneAngle - backAngle) * easedT
    } else {
      // 保持俯趴姿态
      entity.stats.staggerAnimationPhase = 'prone'
      entity.movement.rollAngle = proneAngle
    }
  }

  applyStandardHit(entity: Entity): void {
    this.applyWeaponHit(entity)
  }

  applyWeaponHit(
    entity: Entity,
    weapon?: {
      attackDamage: number
      toughnessDamage: number
      knockback?: number
    },
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
    const knockback = Math.max(0, weapon?.knockback ?? 0)
    this.applyDamage(
      entity,
      attackDamage,
      toughnessDamage,
      knockback,
      hitSource
    )
  }

  private applyDamage(
    entity: Entity,
    healthDamage: number,
    toughnessDamage: number,
    knockback: number,
    hitSource?: { x: number; y: number }
  ): void {
    if (!entity.stats) return
    if (entity.stats.isDead) return

    // 翻滚期间无敌
    if (entity.movement?.isRolling) return

    // 崩塌过渡动画期间（前1500ms）无敌
    if (
      entity.stats.isStaggered &&
      entity.stats.staggerAnimationElapsed < 1500
    ) {
      return
    }

    let finalHealthDamage = Math.max(0, healthDamage)
    let finalToughnessDamage = Math.max(0, toughnessDamage)
    let finalKnockback = knockback

    // 崩塌期间受击：伤害翻倍、击退加强、解除崩塌
    const wasStaggered = entity.stats.isStaggered
    if (wasStaggered) {
      finalHealthDamage *= STAGGER_DAMAGE_MULTIPLIER
      finalKnockback *= STAGGER_KNOCKBACK_MULTIPLIER
      finalToughnessDamage = 0
      entity.stats.isStaggered = false
      entity.stats.staggerElapsedTime = 0
      entity.stats.staggerAnimationPhase = 'none'
      entity.stats.staggerAnimationElapsed = 0
      entity.stats.toughness = entity.stats.maxToughness

      // 崩塌受击解除时重置连击状态
      if (entity.weapon) {
        entity.weapon.comboCount = 0
        entity.weapon.swingDirection = 'toFront'
        entity.weapon.nextSwingDirection = 'toFront'
        entity.weapon.attackPhase = 'idle'
        entity.weapon.attackElapsedMs = 0
        entity.weapon.attackQueued = false
        entity.weapon.hitEntityIds.clear()
      }
    }

    // 格挡逻辑
    if (entity.weapon?.isBlocking && hitSource && entity.transform) {
      const dx = hitSource.x - entity.transform.x
      // 获取当前朝向
      const facing =
        entity.input?.lastMoveDirection !== 0
          ? (entity.input?.lastMoveDirection ?? 1)
          : entity.weapon.attackFacing || 1

      // 判断攻击来源是否在前方
      const isFrontalHit = (facing > 0 && dx > 0) || (facing < 0 && dx < 0)

      if (isFrontalHit) {
        finalHealthDamage = 0
      }
    }

    entity.stats.health = Math.max(0, entity.stats.health - finalHealthDamage)
    entity.stats.toughness = Math.max(
      0,
      entity.stats.toughness - finalToughnessDamage
    )

    if (hitSource && entity.transform) {
      const dirX = entity.transform.x - hitSource.x
      const distance = Math.hypot(dirX, entity.transform.y - hitSource.y)
      const normalizedDirX = distance > 0 ? dirX / distance : 1

      if (finalHealthDamage > 0) {
        entity.stats.hitShakeElapsedMs = 0
        entity.stats.hitShakeDurationMs = DEFAULT_HIT_SHAKE_DURATION_MS
        entity.stats.hitShakeIntensity = DEFAULT_HIT_SHAKE_INTENSITY
        entity.stats.hitShakeDirectionX = normalizedDirX
      }

      if (finalKnockback > 0 && entity.physics && this.box2d && this.tempVec) {
        const { b2Body_ApplyLinearImpulseToCenter, b2Body_GetMass } = this.box2d
        const mass = b2Body_GetMass(entity.physics.bodyId)

        const impulseX = normalizedDirX * finalKnockback * 2 * mass
        this.tempVec.x = impulseX
        this.tempVec.y = 0

        b2Body_ApplyLinearImpulseToCenter(
          entity.physics.bodyId,
          this.tempVec,
          true
        )

        // 设置击退硬直时间
        if (entity.movement) {
          const knockbackDuration = wasStaggered
            ? STAGGER_HIT_STUN_DURATION_MS
            : 200
          entity.movement.knockbackEndTime = Date.now() + knockbackDuration
          entity.movement.knockbackDuration = knockbackDuration
          entity.movement.knockbackElapsedTime = 0
        }

        // 受到击退时强制打断攻击动作并重置连击
        if (entity.weapon) {
          entity.weapon.attackPhase = 'idle'
          entity.weapon.attackElapsedMs = 0
          entity.weapon.attackQueued = false
          entity.weapon.isColliding = false
          entity.weapon.hitEntityIds.clear()
          entity.weapon.comboCount = 0
          entity.weapon.swingDirection = 'toFront'
          entity.weapon.nextSwingDirection = 'toFront'
          // 保持 isInCombat 为 true，因为受击通常意味着还在战斗中
        }

        // 重置敌人AI状态
        if (entity.enemyAI) {
          entity.enemyAI.state = 'approach'
          entity.enemyAI.comboSwingsDone = 0
        }
      }
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
    if (!this.box2d || !entity.physics || !this.tempVec) return

    const { b2Body_SetLinearVelocity, b2Body_SetLinearDamping } = this.box2d
    this.tempVec.x = 0
    this.tempVec.y = 0
    b2Body_SetLinearVelocity(entity.physics.bodyId, this.tempVec)
    b2Body_SetLinearDamping(entity.physics.bodyId, 10)

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
