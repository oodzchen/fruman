import type { Entity } from '../Entity'

export class SkillHandler {
  handleSkillRequest(entity: Entity): void {
    const weapon = entity.weapon
    if (!weapon || !weapon.skillId) return

    if (weapon.skillId === 'hammer_crit') {
      weapon.skillPhase = 'hammer_crit_windup'
      weapon.skillElapsedMs = 0
      weapon.skillFacing =
        entity.input?.lastMoveDirection || weapon.attackFacing || 1
      weapon.hitEntityIds.clear()
      weapon.hitRopeIds.clear()
      weapon.attackStartTransform.x = weapon.visual.x
      weapon.attackStartTransform.y = weapon.visual.y
      weapon.attackStartTransform.rotation = weapon.visual.rotation
    }
  }
}
