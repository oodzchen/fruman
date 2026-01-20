import { DEFAULT_BOW_AMMO_ENEMY, DEFAULT_BOW_AMMO_PLAYER } from '../constants'
import {
  ArrowComponent,
  Faction,
  PhysicsComponent,
  TransformComponent,
  WeaponComponent,
} from './Component'
import type { Entity } from './Entity'
import type { EntityComponentPool } from './EntityComponentPool'
import { ObjectPool } from './ObjectPool'

const PLAYER_ARROW_LIMIT = DEFAULT_BOW_AMMO_PLAYER
const ENEMY_ARROW_LIMIT = DEFAULT_BOW_AMMO_ENEMY
const MAX_ARROWS_TOTAL = PLAYER_ARROW_LIMIT + ENEMY_ARROW_LIMIT

export class ArrowPools implements EntityComponentPool {
  private transformPool = new ObjectPool(
    () => new TransformComponent(),
    (component) => component.reset(),
    MAX_ARROWS_TOTAL
  )
  private physicsPool = new ObjectPool(
    () => new PhysicsComponent(),
    (component) => component.reset(),
    MAX_ARROWS_TOTAL
  )
  private weaponPool = new ObjectPool(
    () => new WeaponComponent(),
    (component) => component.reset(),
    MAX_ARROWS_TOTAL
  )
  private arrowPool = new ObjectPool(
    () => new ArrowComponent(),
    (component) => component.reset(),
    MAX_ARROWS_TOTAL
  )
  private playerCount = 0
  private enemyCount = 0

  acquireTransform(): TransformComponent {
    return this.transformPool.acquire()
  }

  acquirePhysics(): PhysicsComponent {
    return this.physicsPool.acquire()
  }

  acquireWeapon(): WeaponComponent {
    return this.weaponPool.acquire()
  }

  acquireArrow(): ArrowComponent {
    return this.arrowPool.acquire()
  }

  releasePhysics(component: PhysicsComponent): void {
    this.physicsPool.release(component)
  }

  canSpawn(faction: Faction): boolean {
    switch (faction) {
      case Faction.Player:
        return this.playerCount < PLAYER_ARROW_LIMIT
      case Faction.Enemy:
        return this.enemyCount < ENEMY_ARROW_LIMIT
      default:
        return true
    }
  }

  registerSpawn(faction: Faction): void {
    if (faction === Faction.Player) {
      this.playerCount += 1
    } else if (faction === Faction.Enemy) {
      this.enemyCount += 1
    }
  }

  releaseEntityComponents(entity: Entity): void {
    if (!entity.arrow) return

    if (entity.arrow.faction === Faction.Player) {
      this.playerCount = Math.max(0, this.playerCount - 1)
    } else if (entity.arrow.faction === Faction.Enemy) {
      this.enemyCount = Math.max(0, this.enemyCount - 1)
    }
    this.arrowPool.release(entity.arrow)
    if (entity.weapon) {
      this.weaponPool.release(entity.weapon)
    }
    if (entity.physics) {
      this.physicsPool.release(entity.physics)
    }
    if (entity.transform) {
      this.transformPool.release(entity.transform)
    }
  }

  reset(): void {
    this.playerCount = 0
    this.enemyCount = 0
  }
}
