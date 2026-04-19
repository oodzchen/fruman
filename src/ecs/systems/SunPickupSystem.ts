import { getCharacterGroundPickupRadius } from '../../characterBodyProfile'
import { DEFAULT_PLAYER_RADIUS } from '../../constants'
import { SOUND_IDS } from '../../worker/effectsProtocol'
import type { Entity } from '../Entity'
import { showEntityHud } from '../hudVisibility'

type EffectsEmitter = {
  playSound: (soundId: number, playbackRate?: number) => void
}

// 生成后多久才可以被拾取（避免生成瞬间就被附近玩家吃掉）
const PICKUP_DELAY = 0.3

export class SunPickupSystem {
  private readonly pendingRemove: Entity[] = []
  private effectsEmitter?: EffectsEmitter

  setEffectsEmitter(emitter: EffectsEmitter | null): void {
    this.effectsEmitter = emitter ?? undefined
  }

  update(pickupEntities: Entity[], players: Entity[], deltaTime: number): void {
    this.pendingRemove.length = 0
    for (let i = 0; i < pickupEntities.length; i++) {
      const pickup = pickupEntities[i]
      if (!pickup.transform || !pickup.sunPickup) continue

      const sp = pickup.sunPickup
      sp.dropElapsedTime += deltaTime
      if (sp.dropElapsedTime < PICKUP_DELAY) continue

      for (let j = 0; j < players.length; j++) {
        const player = players[j]
        if (!player.transform || !player.solarEnergy || player.stats?.isDead)
          continue
        if (
          (player.render?.renderLayer ?? 0) !==
          (pickup.render?.renderLayer ?? 0)
        )
          continue
        const dx = pickup.transform.x - player.transform.x
        const dy = pickup.transform.y - player.transform.y
        const bodyRadius = player.render?.radius ?? DEFAULT_PLAYER_RADIUS
        const pickupRadius = getCharacterGroundPickupRadius(
          player.render?.bodyProfile,
          bodyRadius,
          player.render?.bodyHeight ?? 0,
          Math.sqrt(sp.pickupRadiusSq)
        )
        if (dx * dx + dy * dy > pickupRadius * pickupRadius) continue

        const solar = player.solarEnergy
        if (sp.isLarge) {
          solar.largeMaxCount++
          if (solar.largeCount < solar.largeMaxCount) solar.largeCount++
          // 大太阳道具：立即回满血
          if (player.stats) {
            player.stats.health = player.stats.maxHealth
          }
        } else {
          solar.smallCount++
          if (solar.smallCount >= solar.smallPerLarge) {
            solar.smallCount -= solar.smallPerLarge
            if (solar.largeCount < solar.largeMaxCount) solar.largeCount++
          }
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
}
