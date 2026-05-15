import {
  hasUnlockedAttackPickup,
  syncAttackSlotsForWeaponType,
  unlockAttackPickup,
} from '../../attackPickupUtils'
import { getCharacterGroundPickupRadius } from '../../characterBodyProfile'
import { DEFAULT_PLAYER_RADIUS } from '../../constants'
import type { WeaponType } from '../../types'
import { normalizeWeaponType } from '../../weaponTypeUtils'
import { SOUND_IDS } from '../../worker/effectsProtocol'
import type { AttackPickupComponent } from '../Component'
import type { Entity } from '../Entity'
import { showEntityHud } from '../hudVisibility'

type EffectsEmitter = {
  playSound: (soundId: number, playbackRate?: number) => void
}

const PICKUP_DELAY = 0.3

export class AttackPickupSystem {
  private readonly pendingRemove: Entity[] = []
  private effectsEmitter?: EffectsEmitter

  setEffectsEmitter(emitter: EffectsEmitter | null): void {
    this.effectsEmitter = emitter ?? undefined
  }

  update(pickupEntities: Entity[], players: Entity[], deltaTime: number): void {
    this.pendingRemove.length = 0
    for (let i = 0; i < pickupEntities.length; i++) {
      const pickup = pickupEntities[i]
      if (!pickup.transform || !pickup.attackPickup) continue

      const attackPickup = pickup.attackPickup
      attackPickup.dropElapsedTime += deltaTime
      if (attackPickup.dropElapsedTime < PICKUP_DELAY) continue

      const weaponType = normalizeWeaponType(attackPickup.weaponType)
      if (!weaponType) {
        this.pendingRemove.push(pickup)
        continue
      }

      for (let j = 0; j < players.length; j++) {
        const player = players[j]
        if (!player.transform || !player.attackSlots || player.stats?.isDead) {
          continue
        }
        if (
          (player.render?.renderLayer ?? 0) !==
          (pickup.render?.renderLayer ?? 0)
        ) {
          continue
        }
        if (!this.canPlayerPickAttackPickup(player, attackPickup, weaponType)) {
          continue
        }
        const dx = pickup.transform.x - player.transform.x
        const dy = pickup.transform.y - player.transform.y
        const bodyRadius = player.render?.radius ?? DEFAULT_PLAYER_RADIUS
        const pickupRadius = getCharacterGroundPickupRadius(
          player.render?.bodyProfile,
          bodyRadius,
          player.render?.bodyHeight ?? 0,
          Math.sqrt(attackPickup.pickupRadiusSq)
        )
        if (dx * dx + dy * dy > pickupRadius * pickupRadius) continue

        if (
          !unlockAttackPickup(player.attackSlots, weaponType, attackPickup.kind)
        ) {
          continue
        }
        if (player.weapon) {
          syncAttackSlotsForWeaponType(
            player.attackSlots,
            player.weapon.weaponType
          )
          player.weapon.skillId = player.attackSlots.skill.skillId
          player.weapon.skillCharges = player.attackSlots.skill.chargesRemaining
        }
        showEntityHud(player)
        this.effectsEmitter?.playSound(SOUND_IDS.PICKUP_ITEM)
        this.pendingRemove.push(pickup)
        break
      }
    }
  }

  getPendingRemove(): Entity[] {
    return this.pendingRemove
  }

  private canPlayerPickAttackPickup(
    player: Entity,
    attackPickup: AttackPickupComponent,
    weaponType: WeaponType
  ): boolean {
    if (!player.attackSlots || !player.weapon?.isEquipped) {
      return false
    }
    const currentWeaponType = normalizeWeaponType(player.weapon.weaponType)
    return (
      currentWeaponType === weaponType &&
      !hasUnlockedAttackPickup(
        player.attackSlots,
        weaponType,
        attackPickup.kind
      )
    )
  }
}
