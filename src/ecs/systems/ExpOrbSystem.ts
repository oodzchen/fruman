import {
  DEFAULT_PLAYER_MAX_HEALTH,
  EXP_TABLE,
  PLAYER_HEALTH_PER_LEVEL,
  PLAYER_MAX_LEVEL,
} from '../../constants'
import { SOUND_IDS } from '../../worker/effectsProtocol'
import type { Entity } from '../Entity'

type EffectsEmitter = {
  playSound: (soundId: number, playbackRate?: number) => void
}

const PICKUP_DELAY = 0.3

export class ExpOrbSystem {
  private readonly pendingRemove: Entity[] = []
  private effectsEmitter?: EffectsEmitter

  setEffectsEmitter(emitter: EffectsEmitter | null): void {
    this.effectsEmitter = emitter ?? undefined
  }

  update(orbEntities: Entity[], players: Entity[], deltaTime: number): void {
    this.pendingRemove.length = 0
    for (let i = 0; i < orbEntities.length; i++) {
      const orb = orbEntities[i]
      if (!orb.transform || !orb.expOrb) continue

      const eo = orb.expOrb
      eo.dropElapsedTime += deltaTime
      if (eo.dropElapsedTime < PICKUP_DELAY) continue

      for (let j = 0; j < players.length; j++) {
        const player = players[j]
        if (!player.transform || !player.level || player.stats?.isDead) continue
        const dx = orb.transform.x - player.transform.x
        const dy = orb.transform.y - player.transform.y
        if (dx * dx + dy * dy > eo.pickupRadiusSq) continue

        const lv = player.level
        if (lv.level < PLAYER_MAX_LEVEL) {
          lv.exp += 4
          const needed = EXP_TABLE[lv.level - 1]
          if (lv.exp >= needed) {
            lv.exp -= needed
            lv.level++
            if (player.stats) {
              player.stats.maxHealth = Math.min(
                DEFAULT_PLAYER_MAX_HEALTH +
                  (lv.level - 1) * PLAYER_HEALTH_PER_LEVEL,
                100
              )
              player.stats.health = Math.min(
                player.stats.health + PLAYER_HEALTH_PER_LEVEL,
                player.stats.maxHealth
              )
              player.stats.hudVisibleTimer = player.stats.combatExitTimeout
            }
          }
        }

        this.effectsEmitter?.playSound(SOUND_IDS.PICKUP_ITEM)
        this.pendingRemove.push(orb)
        break
      }
    }
  }

  getPendingRemove(): Entity[] {
    return this.pendingRemove
  }
}
