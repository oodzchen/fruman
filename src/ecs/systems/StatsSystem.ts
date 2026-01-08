import {
  DEFAULT_WEAPON_ATTACK_DAMAGE,
  DEFAULT_WEAPON_TOUGHNESS_DAMAGE,
} from '../../constants'
import { componentRegistry } from '../ComponentRegistry'
import type { Entity } from '../Entity'
import { System } from '../System'

export class StatsSystem extends System {
  constructor() {
    super()
    const statsType = componentRegistry.getComponentType('Stats')
    this.setRequiredComponents([statsType])
  }

  update(entities: Entity[], deltaTime: number): void {
    const deltaSeconds = deltaTime > 0 ? deltaTime : 0
    for (const entity of entities) {
      if (!entity.stats) continue
      if (entity.stats.isDead) continue

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
    weapon?: { attackDamage: number; toughnessDamage: number }
  ): void {
    const attackDamage = Math.max(
      0,
      weapon?.attackDamage ?? DEFAULT_WEAPON_ATTACK_DAMAGE
    )
    const toughnessDamage = Math.max(
      0,
      weapon?.toughnessDamage ?? DEFAULT_WEAPON_TOUGHNESS_DAMAGE
    )
    this.applyDamage(entity, attackDamage, toughnessDamage)
  }

  private applyDamage(
    entity: Entity,
    healthDamage: number,
    toughnessDamage: number
  ): void {
    if (!entity.stats) return
    if (entity.stats.isDead) return

    const clampedHealthDamage = Math.max(0, healthDamage)
    const clampedToughnessDamage = Math.max(0, toughnessDamage)

    entity.stats.health = Math.max(0, entity.stats.health - clampedHealthDamage)
    entity.stats.toughness = Math.max(
      0,
      entity.stats.toughness - clampedToughnessDamage
    )

    if (entity.stats.health === 0) {
      entity.stats.isDead = true
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
      }
    }
  }

  revive(entity: Entity): void {
    if (!entity.stats) return

    entity.stats.health = entity.stats.maxHealth
    entity.stats.toughness = entity.stats.maxToughness
    entity.stats.isDead = false
  }
}
