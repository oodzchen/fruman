import {
  DEFAULT_PLAYER_RADIUS,
  DEFAULT_WEAPON_ATTACK_RADIUS,
} from '../../../constants'
import type { Entity } from '../../Entity'
import type { GrappleSystemRuntime } from './GrappleRuntime'

export class GrappleTargetingSystem {
  constructor(private readonly runtime: GrappleSystemRuntime) {}

  refreshAnchorCache(): void {
    this.runtime.anchorEntities.length = 0
    this.runtime.grappleTargetEntities.length = 0
    const entities = this.runtime.world.getEntities()
    for (let i = 0; i < entities.length; i++) {
      const entity = entities[i]
      if (entity.grappleAnchor && entity.transform) {
        this.runtime.anchorEntities.push(entity)
      }
      if (entity.grappleTarget && entity.transform) {
        this.runtime.grappleTargetEntities.push(entity)
      }
    }
    this.runtime.anchorsDirty = false
  }

  findAnchorTarget(
    x: number,
    y: number,
    facing: number,
    out: { x: number; y: number },
    renderLayer: number,
    currentTargetX?: number,
    currentTargetY?: number
  ): Entity | null {
    let bestDistSq = this.runtime.rangeSq + 1
    let bestTarget: Entity | null = null
    const forwardX = facing >= 0 ? 1 : -1

    for (let i = 0; i < this.runtime.anchorEntities.length; i++) {
      const anchor = this.runtime.anchorEntities[i]
      const anchorPos = anchor.transform
      if (!anchorPos) continue
      if ((anchor.render?.renderLayer ?? 0) !== renderLayer) continue

      if (
        currentTargetX !== undefined &&
        currentTargetY !== undefined &&
        Math.abs(anchorPos.x - currentTargetX) < 0.01 &&
        Math.abs(anchorPos.y - currentTargetY) < 0.01
      ) {
        continue
      }

      const dx = anchorPos.x - x
      const dy = anchorPos.y - y
      const distSq = dx * dx + dy * dy
      if (distSq > this.runtime.rangeSq || distSq <= 0) continue
      const invDist = 1 / Math.sqrt(distSq)
      const dot = dx * forwardX * invDist
      if (dot < this.runtime.cosHalfFov) continue
      if (distSq < bestDistSq) {
        bestDistSq = distSq
        bestTarget = anchor
      }
    }

    if (bestTarget?.transform) {
      out.x = bestTarget.transform.x
      out.y = bestTarget.transform.y
      return bestTarget
    }

    return null
  }

  findGrappleTargetAnchor(
    x: number,
    y: number,
    facing: number,
    out: { x: number; y: number },
    renderLayer: number,
    currentTargetX?: number,
    currentTargetY?: number
  ): Entity | null {
    let bestDistSq = this.runtime.rangeSq + 1
    let bestTarget: Entity | null = null
    const forwardX = facing >= 0 ? 1 : -1

    for (let i = 0; i < this.runtime.grappleTargetEntities.length; i++) {
      const target = this.runtime.grappleTargetEntities[i]
      const targetPos = target.transform
      if (!targetPos || !target.grappleTarget?.canTether) continue
      if ((target.render?.renderLayer ?? 0) !== renderLayer) continue
      if (!this.runtime.getValidBodyId(target)) continue

      if (
        currentTargetX !== undefined &&
        currentTargetY !== undefined &&
        Math.abs(targetPos.x - currentTargetX) < 0.01 &&
        Math.abs(targetPos.y - currentTargetY) < 0.01
      ) {
        continue
      }

      const dx = targetPos.x - x
      const dy = targetPos.y - y
      const distSq = dx * dx + dy * dy
      if (distSq > this.runtime.rangeSq || distSq <= 0) continue
      const invDist = 1 / Math.sqrt(distSq)
      const dot = dx * forwardX * invDist
      if (dot < this.runtime.cosHalfFov) continue
      if (distSq < bestDistSq) {
        bestDistSq = distSq
        bestTarget = target
      }
    }

    if (bestTarget?.transform) {
      out.x = bestTarget.transform.x
      out.y = bestTarget.transform.y
      return bestTarget
    }

    return null
  }

  canUseLockedTarget(
    owner: Entity,
    target: Entity
  ): target is Entity & { transform: NonNullable<Entity['transform']> } {
    if (target.id === owner.id || !target.transform) {
      return false
    }
    if (
      (target.render?.renderLayer ?? 0) !== (owner.render?.renderLayer ?? 0)
    ) {
      return false
    }
    if (target.stats && (target.stats.isDead || target.stats.isVanished)) {
      return false
    }
    if (target.grappleAnchor) {
      return true
    }
    if (target.grappleTarget) {
      return (
        target.grappleTarget.canPull &&
        this.runtime.getValidBodyId(target) !== null
      )
    }
    return (
      target.stats !== undefined && this.runtime.getValidBodyId(target) !== null
    )
  }

  getTargetToughness(entity: Entity): number {
    if (entity.grappleTarget) {
      return entity.grappleTarget.toughness
    }
    return entity.stats?.toughness ?? 0
  }

  getAttackDistance(attacker: Entity, target: Entity): number {
    const attackerRadius = attacker.render?.radius ?? DEFAULT_PLAYER_RADIUS
    const targetRadius = target.render?.radius ?? DEFAULT_PLAYER_RADIUS
    const weaponWidth = attacker.weapon?.width ?? 0
    if (attacker.weapon?.weaponType !== undefined) {
      return attackerRadius + weaponWidth / 2 + targetRadius
    }
    return DEFAULT_WEAPON_ATTACK_RADIUS + targetRadius
  }

  applyNpcStun(entity: Entity, durationMs: number): void {
    if (!entity.movement) return
    if (durationMs <= 0) return
    if (this.runtime.statsSystem) {
      this.runtime.statsSystem.applyForcedHitStun(entity, 'light', durationMs)
      return
    }
    entity.movement.knockbackDuration = durationMs
    entity.movement.knockbackElapsedTime = 0
    entity.movement.knockbackEndTime = this.runtime.currentTimeMs + durationMs
  }

  triggerNpcAggro(attacker: Entity, target: Entity): void {
    if (!target.npcAI) return
    if (!target.npcAI || !target.input) return
    if (target.stats?.isDead) return

    target.npcAI.alertChaseActive = true
    target.npcAI.alertTimeRemainingMs = 0
    target.npcAI.state = 'approach'
    target.npcAI.targetLostTimer = 0
    if (attacker.transform && target.transform) {
      const dx = attacker.transform.x - target.transform.x
      target.npcAI.forcedChaseDirection = dx >= 0 ? 1 : -1
      target.npcAI.forcedChaseDistanceRemaining = Math.max(
        3,
        target.npcAI.detectionRange / 2
      )
      target.npcAI.forcedChaseLastX = target.transform.x
    }

    target.input.lockedTargetId = attacker.id
    target.input.lockLostTimer = 0

    if (target.stats) {
      target.stats.isInCombat = true
      target.stats.combatExitTimer = 0
    }
  }
}
