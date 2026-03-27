import type { Entity } from '../Entity'

// 生成后多久才可以被拾取（避免生成瞬间就被附近玩家吃掉）
const PICKUP_DELAY = 0.3

export class SunPickupSystem {
  private readonly pendingRemove: Entity[] = []

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
        const dx = pickup.transform.x - player.transform.x
        const dy = pickup.transform.y - player.transform.y
        if (dx * dx + dy * dy > sp.pickupRadiusSq) continue

        const solar = player.solarEnergy
        if (sp.isLarge) {
          solar.largeMaxCount++
          if (solar.largeCount < solar.largeMaxCount) solar.largeCount++
        } else {
          solar.smallCount++
          if (solar.smallCount >= solar.smallPerLarge) {
            solar.smallCount -= solar.smallPerLarge
            if (solar.largeCount < solar.largeMaxCount) solar.largeCount++
          }
        }
        this.pendingRemove.push(pickup)
        break
      }
    }
  }

  getPendingRemove(): Entity[] {
    return this.pendingRemove
  }
}
