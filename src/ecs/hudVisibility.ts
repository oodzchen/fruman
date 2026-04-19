import type { Entity } from './Entity'

export function showEntityHud(entity: Entity): void {
  if (!entity.stats) {
    return
  }
  entity.stats.hudVisibleTimer = entity.stats.combatExitTimeout
}
