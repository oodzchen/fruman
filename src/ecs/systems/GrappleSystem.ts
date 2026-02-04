import {
  DEFAULT_GRAPPLE_PULL_STOP_DISTANCE,
  DEFAULT_GRAPPLE_RANGE,
  DEFAULT_GRAVITY,
  DEFAULT_PLAYER_FOV_RAD,
} from '../../constants'
import type { MainModule, b2Vec2 } from '../../types'
import { componentRegistry } from '../ComponentRegistry'
import type { Entity } from '../Entity'
import { System } from '../System'
import type { World } from '../World'

export class GrappleSystem extends System {
  private world: World
  private box2d: MainModule
  private tempVec: b2Vec2
  private currentTimeMs = 0
  private anchorsDirty = true
  private anchorEntities: Entity[] = []
  private tempTarget = { x: 0, y: 0 }
  private cosHalfFov = Math.cos(DEFAULT_PLAYER_FOV_RAD * 0.5)
  private rangeSq = DEFAULT_GRAPPLE_RANGE * DEFAULT_GRAPPLE_RANGE
  private stopDistanceSq =
    DEFAULT_GRAPPLE_PULL_STOP_DISTANCE * DEFAULT_GRAPPLE_PULL_STOP_DISTANCE

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

      const canUse = !entity.isStunned() && this.anchorEntities.length > 0

      if (canUse) {
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
          grapple.pullElapsedMs = 0
          grapple.isPulling = true
          grapple.cooldownEndTime = this.currentTimeMs
          this.applyGrappleImpulse(entity, grapple)
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
    const dx = grapple.targetX - entity.transform.x
    const dy = grapple.targetY - entity.transform.y
    const distSq = dx * dx + dy * dy
    const radius = entity.render?.radius ?? 0.5
    const clearance = radius + 0.1

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
    grapple.retainAirMomentum = true
    if (allowImmediateRetry) {
      grapple.cooldownEndTime = this.currentTimeMs
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
