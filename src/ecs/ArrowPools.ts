import {
  DEFAULT_BOW_AMMO_ENEMY,
  DEFAULT_BOW_AMMO_PLAYER,
  DEFAULT_GRAPE_AMMO_ENEMY,
  DEFAULT_GRAPE_AMMO_PLAYER,
} from '../constants'
import {
  ArrowComponent,
  Faction,
  PhysicsComponent,
  RenderComponent,
  TerrainDebrisComponent,
  TransformComponent,
  WeaponComponent,
} from './Component'
import type { Entity } from './Entity'
import type { EntityComponentPool } from './EntityComponentPool'
import { ObjectPool } from './ObjectPool'

const PLAYER_ARROW_LIMIT = Math.max(
  DEFAULT_BOW_AMMO_PLAYER,
  DEFAULT_GRAPE_AMMO_PLAYER
)
const ENEMY_ARROW_LIMIT = Math.max(
  DEFAULT_BOW_AMMO_ENEMY,
  DEFAULT_GRAPE_AMMO_ENEMY
)
const MAX_ARROWS_TOTAL = PLAYER_ARROW_LIMIT + ENEMY_ARROW_LIMIT
const MAX_TERRAIN_DEBRIS_TOTAL = 96
const MAX_DYNAMIC_ENTITY_COMPONENTS =
  MAX_ARROWS_TOTAL + MAX_TERRAIN_DEBRIS_TOTAL

export class ArrowPools implements EntityComponentPool {
  private transformPool = new ObjectPool(
    () => new TransformComponent(),
    (component) => component.reset(),
    MAX_DYNAMIC_ENTITY_COMPONENTS
  )
  private physicsPool = new ObjectPool(
    () => new PhysicsComponent(),
    (component) => component.reset(),
    MAX_DYNAMIC_ENTITY_COMPONENTS
  )
  private weaponPool = new ObjectPool(
    () => new WeaponComponent(),
    (component) => component.reset(),
    MAX_ARROWS_TOTAL
  )
  private renderPool = new ObjectPool(
    () => new RenderComponent(),
    (component) => component.reset(),
    MAX_TERRAIN_DEBRIS_TOTAL
  )
  private arrowPool = new ObjectPool(
    () => new ArrowComponent(),
    (component) => component.reset(),
    MAX_ARROWS_TOTAL
  )
  private terrainDebrisPool = new ObjectPool(
    () => new TerrainDebrisComponent(),
    (component) => component.reset(),
    MAX_TERRAIN_DEBRIS_TOTAL
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

  acquireRender(): RenderComponent {
    return this.renderPool.acquire()
  }

  acquireTerrainDebris(): TerrainDebrisComponent {
    return this.terrainDebrisPool.acquire()
  }

  releasePhysics(component: PhysicsComponent): void {
    this.physicsPool.release(component)
  }

  canSpawn(factionId: string): boolean {
    if (factionId === Faction.Player)
      return this.playerCount < PLAYER_ARROW_LIMIT
    if (factionId === Faction.Enemy) return this.enemyCount < ENEMY_ARROW_LIMIT
    return true
  }

  registerSpawn(factionId: string): void {
    if (factionId === Faction.Player) {
      this.playerCount += 1
    } else if (factionId === Faction.Enemy) {
      this.enemyCount += 1
    }
  }

  releaseEntityComponents(entity: Entity): void {
    if (entity.arrow) {
      if (entity.arrow.factionId === Faction.Player) {
        this.playerCount = Math.max(0, this.playerCount - 1)
      } else if (entity.arrow.factionId === Faction.Enemy) {
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
      return
    }

    if (!entity.terrainDebris) {
      return
    }

    this.terrainDebrisPool.release(entity.terrainDebris)
    if (entity.render) {
      this.renderPool.release(entity.render)
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
