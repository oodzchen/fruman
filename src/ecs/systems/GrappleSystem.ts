import {
  DEFAULT_GRAPPLE_ENEMY_COOLDOWN_MS,
  DEFAULT_GRAPPLE_ENEMY_STUN_EXTRA_MS,
  DEFAULT_GRAPPLE_PULL_STOP_DISTANCE,
  DEFAULT_GRAPPLE_RANGE,
  DEFAULT_GRAVITY,
  DEFAULT_PLAYER_FOV_RAD,
  DEFAULT_PLAYER_RADIUS,
  DEFAULT_WEAPON_ATTACK_RADIUS,
} from '../../constants'
import type { MainModule, b2Vec2 } from '../../types'
import { SOUND_IDS } from '../../worker/effectsProtocol'
import { Faction } from '../Component'
import { componentRegistry } from '../ComponentRegistry'
import type { Entity } from '../Entity'
import { System } from '../System'
import type { World } from '../World'
import type { StatsSystem } from './StatsSystem'

export class GrappleSystem extends System {
  private readonly pullModeAnchor = 0
  private readonly pullModeEnemy = 1
  private readonly pullModePlayerLinear = 2
  private readonly pullModePlayerArc = 3
  private world: World
  private box2d: MainModule
  private tempVec: b2Vec2
  private currentTimeMs = 0
  private anchorsDirty = true
  private anchorEntities: Entity[] = []
  private tempTarget = { x: 0, y: 0 }
  private statsSystem?: StatsSystem
  private cosHalfFov = Math.cos(DEFAULT_PLAYER_FOV_RAD * 0.5)
  private rangeSq = DEFAULT_GRAPPLE_RANGE * DEFAULT_GRAPPLE_RANGE
  private stopDistanceSq =
    DEFAULT_GRAPPLE_PULL_STOP_DISTANCE * DEFAULT_GRAPPLE_PULL_STOP_DISTANCE
  private ropeHideDistanceSq =
    DEFAULT_PLAYER_RADIUS * 2 * (DEFAULT_PLAYER_RADIUS * 2)

  constructor(world: World, box2d: MainModule) {
    super()
    this.world = world
    this.box2d = box2d
    this.tempVec = new box2d.b2Vec2(0, 0)

    const transformType = componentRegistry.getComponentType('Transform')
    const physicsType = componentRegistry.getComponentType('Physics')
    const inputType = componentRegistry.getComponentType('Input')
    const grappleType = componentRegistry.getComponentType('Grapple')
    this.setRequiredComponents([
      transformType,
      physicsType,
      inputType,
      grappleType,
    ])
  }

  markAnchorsDirty(): void {
    this.anchorsDirty = true
  }

  setStatsSystem(statsSystem: StatsSystem): void {
    this.statsSystem = statsSystem
  }

  update(entities: Entity[], deltaTime: number): void {
    const deltaMs = Math.max(0, deltaTime * 1000)
    this.currentTimeMs += deltaMs

    if (this.anchorsDirty) {
      this.refreshAnchorCache()
    }

    for (let i = 0; i < entities.length; i++) {
      const entity = entities[i]
      if (!entity.transform || !entity.physics || !entity.input) {
        continue
      }
      const grapple = entity.grapple
      if (!grapple) continue

      if (!grapple.hasGrapple) {
        grapple.isPulling = false
        grapple.retainAirMomentum = false
        grapple.pullMode = this.pullModeAnchor
        grapple.targetEntityId = -1
        continue
      }

      if (entity.stats?.isDead) {
        this.stopPull(grapple, false)
        continue
      }

      if (entity.isStunned()) {
        this.stopPull(grapple, false)
        continue
      }

      if (grapple.isPulling) {
        this.updatePull(entity, grapple, deltaMs)
        continue
      }

      const inputBuffer = entity.input.inputBuffer
      if (!inputBuffer.hasActiveAction('grapple')) {
        continue
      }

      if (this.currentTimeMs < grapple.cooldownEndTime) {
        inputBuffer.clearAction('grapple')
        continue
      }

      const canUse = !entity.isStunned()

      if (canUse) {
        const lockedTargetId = entity.input.lockedTargetId
        if (lockedTargetId !== null) {
          const lockedTarget = this.getEntityById(lockedTargetId)
          if (
            lockedTarget &&
            lockedTarget.id !== entity.id &&
            lockedTarget.transform &&
            lockedTarget.physics &&
            lockedTarget.stats &&
            !lockedTarget.stats.isDead
          ) {
            const dx = lockedTarget.transform.x - entity.transform.x
            const dy = lockedTarget.transform.y - entity.transform.y
            const distSq = dx * dx + dy * dy
            if (distSq <= this.rangeSq) {
              const playerToughness = entity.stats?.toughness ?? 0
              const targetToughness = lockedTarget.stats.toughness
              const desiredDistance = this.getAttackDistance(
                entity,
                lockedTarget
              )
              grapple.targetX = lockedTarget.transform.x
              grapple.targetY = lockedTarget.transform.y
              grapple.targetEntityId = lockedTarget.id
              grapple.pullElapsedMs = 0
              grapple.isPulling = true
              grapple.cooldownEndTime = this.currentTimeMs
              grapple.desiredDistanceSq = desiredDistance * desiredDistance
              this.statsSystem?.playSound(SOUND_IDS.GRAPPLE_PULL_START)
              this.triggerEnemyAggro(entity, lockedTarget)
              if (targetToughness <= playerToughness) {
                grapple.pullMode = this.pullModeEnemy
                this.applyEnemyStun(lockedTarget, grapple.pullDurationMs)
              } else {
                const isGrounded = lockedTarget.movement?.isGrounded ?? false
                grapple.pullMode = isGrounded
                  ? this.pullModePlayerLinear
                  : this.pullModePlayerArc
                if (grapple.pullMode === this.pullModePlayerArc) {
                  this.applyGrappleImpulse(entity, grapple)
                }
              }
            }
          }
        } else if (this.anchorEntities.length > 0) {
          const facing =
            entity.input.lastMoveDirection !== 0
              ? entity.input.lastMoveDirection
              : 1
          if (
            this.findAnchorTarget(
              entity.transform.x,
              entity.transform.y,
              facing,
              this.tempTarget
            )
          ) {
            grapple.targetX = this.tempTarget.x
            grapple.targetY = this.tempTarget.y
            grapple.targetEntityId = -1
            grapple.pullMode = this.pullModeAnchor
            grapple.desiredDistanceSq = 0
            grapple.pullElapsedMs = 0
            grapple.isPulling = true
            grapple.cooldownEndTime = this.currentTimeMs
            this.statsSystem?.playSound(SOUND_IDS.GRAPPLE_PULL_START)
            this.applyGrappleImpulse(entity, grapple)
          }
        }
      }

      inputBuffer.clearAction('grapple')
    }
  }

  private refreshAnchorCache(): void {
    this.anchorEntities.length = 0
    const entities = this.world.getEntities()
    for (let i = 0; i < entities.length; i++) {
      const entity = entities[i]
      if (entity.grappleAnchor && entity.transform) {
        this.anchorEntities.push(entity)
      }
    }
    this.anchorsDirty = false
  }

  private findAnchorTarget(
    x: number,
    y: number,
    facing: number,
    out: { x: number; y: number }
  ): boolean {
    let bestDistSq = this.rangeSq + 1
    let bestX = 0
    let bestY = 0
    const forwardX = facing >= 0 ? 1 : -1

    for (let i = 0; i < this.anchorEntities.length; i++) {
      const anchor = this.anchorEntities[i]
      const anchorPos = anchor.transform
      if (!anchorPos) continue
      const dx = anchorPos.x - x
      const dy = anchorPos.y - y
      const distSq = dx * dx + dy * dy
      if (distSq > this.rangeSq || distSq <= 0) continue
      const invDist = 1 / Math.sqrt(distSq)
      const dot = dx * forwardX * invDist
      if (dot < this.cosHalfFov) continue
      if (distSq < bestDistSq) {
        bestDistSq = distSq
        bestX = anchorPos.x
        bestY = anchorPos.y
      }
    }

    if (bestDistSq <= this.rangeSq) {
      out.x = bestX
      out.y = bestY
      return true
    }

    return false
  }

  private updatePull(
    entity: Entity,
    grapple: NonNullable<Entity['grapple']>,
    deltaMs: number
  ): void {
    if (!entity.physics || !entity.transform) {
      grapple.isPulling = false
      return
    }

    grapple.pullElapsedMs += deltaMs
    if (grapple.targetEntityId >= 0) {
      const targetEntity = this.getEntityById(grapple.targetEntityId)
      if (!targetEntity || !targetEntity.transform) {
        this.stopPull(grapple, false)
        return
      }
      grapple.targetX = targetEntity.transform.x
      grapple.targetY = targetEntity.transform.y
    }
    const dx = grapple.targetX - entity.transform.x
    const dy = grapple.targetY - entity.transform.y
    const distSq = dx * dx + dy * dy
    const radius = entity.render?.radius ?? 0.5
    const clearance = radius + 0.1

    if (grapple.pullMode === this.pullModeEnemy) {
      const targetEntity = this.getEntityById(grapple.targetEntityId)
      if (!targetEntity || !targetEntity.transform || !targetEntity.physics) {
        this.stopPull(grapple, false)
        return
      }
      if (grapple.pullElapsedMs >= grapple.pullDurationMs) {
        this.stopLinearMotion(targetEntity)
        this.stopPull(grapple, false)
        this.applyEnemyStun(targetEntity, DEFAULT_GRAPPLE_ENEMY_STUN_EXTRA_MS)
        return
      }
      if (distSq <= grapple.desiredDistanceSq) {
        this.stopLinearMotion(targetEntity)
        this.stopPull(grapple, true)
        this.applyEnemyStun(targetEntity, DEFAULT_GRAPPLE_ENEMY_STUN_EXTRA_MS)
        return
      }
      this.applyLinearPull(targetEntity, entity, grapple.pullSpeed)
      return
    }

    if (grapple.pullMode === this.pullModePlayerLinear) {
      if (grapple.pullElapsedMs >= grapple.pullDurationMs) {
        this.stopLinearMotion(entity)
        this.stopPull(grapple, false)
        return
      }
      if (distSq <= grapple.desiredDistanceSq) {
        this.stopLinearMotion(entity)
        this.stopPull(grapple, true)
        return
      }
      this.applyLinearPull(entity, null, grapple.pullSpeed)
      return
    }

    if (
      grapple.pullMode === this.pullModeAnchor &&
      distSq <= this.ropeHideDistanceSq
    ) {
      this.stopPull(grapple, true)
      return
    }

    if (
      distSq <= this.stopDistanceSq ||
      grapple.pullElapsedMs >= grapple.pullDurationMs
    ) {
      this.stopPull(grapple, false)
      return
    }
    if (entity.transform.y <= grapple.targetY - clearance) {
      this.stopPull(grapple, true)
      return
    }
  }

  private stopPull(
    grapple: NonNullable<Entity['grapple']>,
    allowImmediateRetry: boolean
  ): void {
    grapple.isPulling = false
    grapple.moveLockEndTime = 0
    if (
      grapple.pullMode === this.pullModeAnchor ||
      grapple.pullMode === this.pullModePlayerArc ||
      grapple.pullMode === this.pullModePlayerLinear
    ) {
      grapple.retainAirMomentum = true
    }
    if (grapple.pullMode === this.pullModeEnemy) {
      grapple.cooldownEndTime =
        this.currentTimeMs + DEFAULT_GRAPPLE_ENEMY_COOLDOWN_MS
    } else if (allowImmediateRetry) {
      grapple.cooldownEndTime = this.currentTimeMs
    }
    grapple.pullMode = this.pullModeAnchor
    grapple.targetEntityId = -1
    grapple.desiredDistanceSq = 0
  }

  private applyLinearPull(
    entity: Entity,
    target: Entity | null,
    speed: number
  ): void {
    if (!entity.physics || !entity.transform) {
      return
    }
    let targetX = 0
    let targetY = 0
    if (target && target.transform) {
      targetX = target.transform.x
      targetY = target.transform.y
    } else if (entity.grapple) {
      targetX = entity.grapple.targetX
      targetY = entity.grapple.targetY
    } else {
      return
    }
    const dx = targetX - entity.transform.x
    const dy = targetY - entity.transform.y
    const distSq = dx * dx + dy * dy
    if (distSq <= 0) return
    const invDist = 1 / Math.sqrt(distSq)
    this.tempVec.x = dx * invDist * speed
    this.tempVec.y = dy * invDist * speed
    this.box2d.b2Body_SetLinearVelocity(entity.physics.bodyId, this.tempVec)
  }

  private stopLinearMotion(entity: Entity): void {
    if (!entity.physics) return
    this.tempVec.x = 0
    this.tempVec.y = 0
    this.box2d.b2Body_SetLinearVelocity(entity.physics.bodyId, this.tempVec)
  }

  private getEntityById(id: number): Entity | null {
    const entities = this.world.getEntities()
    for (let i = 0; i < entities.length; i++) {
      const entity = entities[i]
      if (entity.id === id) {
        return entity
      }
    }
    return null
  }

  private getAttackDistance(attacker: Entity, target: Entity): number {
    const attackerRadius = attacker.render?.radius ?? DEFAULT_PLAYER_RADIUS
    const targetRadius = target.render?.radius ?? DEFAULT_PLAYER_RADIUS
    const weaponWidth = attacker.weapon?.width ?? 0
    if (attacker.weapon?.weaponType !== undefined) {
      return attackerRadius + weaponWidth / 2 + targetRadius
    }
    return DEFAULT_WEAPON_ATTACK_RADIUS + targetRadius
  }

  private applyEnemyStun(entity: Entity, durationMs: number): void {
    if (!entity.movement) return
    if (durationMs <= 0) return
    entity.movement.knockbackDuration = durationMs
    entity.movement.knockbackElapsedTime = 0
    entity.movement.knockbackEndTime = this.currentTimeMs + durationMs
  }

  private triggerEnemyAggro(attacker: Entity, target: Entity): void {
    if (target.faction?.faction !== Faction.Enemy) return
    if (!target.enemyAI || !target.input) return
    if (target.stats?.isDead) return

    target.enemyAI.alertChaseActive = true
    target.enemyAI.alertTimeRemainingMs = 0
    target.enemyAI.state = 'approach'
    target.enemyAI.targetLostTimer = 0
    if (attacker.transform && target.transform) {
      const dx = attacker.transform.x - target.transform.x
      target.enemyAI.forcedChaseDirection = dx >= 0 ? 1 : -1
      target.enemyAI.forcedChaseDistanceRemaining =
        target.enemyAI.detectionRange * 2
      target.enemyAI.forcedChaseLastX = target.transform.x
    }

    target.input.lockedTargetId = attacker.id
    target.input.lockLostTimer = 0

    if (target.stats) {
      target.stats.isInCombat = true
      target.stats.combatExitTimer = 0
    }
  }

  private applyGrappleImpulse(
    entity: Entity,
    grapple: NonNullable<Entity['grapple']>
  ): void {
    if (!entity.physics || !entity.transform) {
      return
    }

    const startX = entity.transform.x
    const startY = entity.transform.y
    const targetX = grapple.targetX
    const targetY = grapple.targetY

    const dx = targetX - startX

    const radius = entity.render?.radius ?? 0.5
    const clearance = radius + 0.1
    const apexY = Math.min(startY - 0.2, targetY - clearance)
    const height = Math.max(0.1, startY - apexY)
    const vy = -Math.sqrt(2 * DEFAULT_GRAVITY * height)

    const timeToApex = Math.max(0.01, -vy / DEFAULT_GRAVITY)
    const vx = dx / timeToApex

    this.tempVec.x = vx
    this.tempVec.y = vy
    grapple.startX = startX
    grapple.startY = startY
    grapple.velocityX = this.tempVec.x
    grapple.velocityY = this.tempVec.y
    this.box2d.b2Body_SetLinearVelocity(entity.physics.bodyId, this.tempVec)
  }
}
