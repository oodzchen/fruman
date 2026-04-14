import { getCharacterGroundPickupRadius } from '../../characterBodyProfile'
import { DEFAULT_PLAYER_RADIUS } from '../../constants'
import { EXP_TABLE, PLAYER_MAX_LEVEL } from '../../constants'
import { SOUND_IDS } from '../../worker/effectsProtocol'
import type { Entity } from '../Entity'

type EffectsEmitter = {
  playSound: (soundId: number, playbackRate?: number) => void
}

type LevelUpHandler = (player: Entity) => void

const PICKUP_DELAY = 0.3

export class ExpOrbSystem {
  private readonly pendingRemove: Entity[] = []
  private effectsEmitter?: EffectsEmitter
  private levelUpHandler?: LevelUpHandler

  setEffectsEmitter(emitter: EffectsEmitter | null): void {
    this.effectsEmitter = emitter ?? undefined
  }

  setLevelUpHandler(handler: LevelUpHandler | null): void {
    this.levelUpHandler = handler ?? undefined
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
        if (
          (player.render?.renderLayer ?? 0) !== (orb.render?.renderLayer ?? 0)
        )
          continue
        const dx = orb.transform.x - player.transform.x
        const dy = orb.transform.y - player.transform.y
        const bodyRadius = player.render?.radius ?? DEFAULT_PLAYER_RADIUS
        const pickupRadius = getCharacterGroundPickupRadius(
          player.render?.bodyProfile,
          bodyRadius,
          player.render?.bodyHeight ?? 0,
          Math.sqrt(eo.pickupRadiusSq)
        )
        if (dx * dx + dy * dy > pickupRadius * pickupRadius) continue

        const lv = player.level
        if (lv.level < PLAYER_MAX_LEVEL) {
          lv.exp += 4
          const needed = EXP_TABLE[lv.level - 1]
          if (lv.exp >= needed) {
            lv.exp -= needed
            lv.level++
            lv.pendingUpgradePoints++
            this.levelUpHandler?.(player)
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
