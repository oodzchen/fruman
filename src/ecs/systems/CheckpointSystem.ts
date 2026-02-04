import {
  CHECKPOINT_TREE_TOP_COLOR_ACTIVE,
  CHECKPOINT_TREE_TOP_COLOR_INACTIVE,
  CHECKPOINT_TREE_TRUNK_COLOR_ACTIVE,
  CHECKPOINT_TREE_TRUNK_COLOR_INACTIVE,
} from '../../constants'
import { componentRegistry } from '../ComponentRegistry'
import type { Entity } from '../Entity'
import { System } from '../System'

export type CheckpointActivatedHandler = (entity: Entity) => void
export type PlayerDeadHandler = () => void

export class CheckpointSystem extends System {
  private player: Entity | null = null
  private defaultSpawnX = 0
  private defaultSpawnY = 0
  private hasDefaultSpawn = false
  private activeCheckpoint: Entity | null = null
  private activeCheckpointX = 0
  private activeCheckpointY = 0
  private hasActiveCheckpoint = false
  private onCheckpointActivated: CheckpointActivatedHandler | null = null
  private onPlayerDead: PlayerDeadHandler | null = null
  private deathNotified = false

  constructor() {
    super()
    const transformType = componentRegistry.getComponentType('Transform')
    const checkpointType = componentRegistry.getComponentType('Checkpoint')
    this.setRequiredComponents([transformType, checkpointType])
  }

  setPlayer(player: Entity | null): void {
    this.player = player
    this.deathNotified = false
  }

  setDefaultSpawn(x: number, y: number): void {
    this.defaultSpawnX = x
    this.defaultSpawnY = y
    this.hasDefaultSpawn = true
  }

  setCheckpointActivatedHandler(
    handler: CheckpointActivatedHandler | null
  ): void {
    this.onCheckpointActivated = handler
  }

  setPlayerDeadHandler(handler: PlayerDeadHandler | null): void {
    this.onPlayerDead = handler
  }

  setActiveCheckpoint(entity: Entity | null): void {
    if (this.activeCheckpoint === entity) {
      return
    }
    if (this.activeCheckpoint?.checkpoint) {
      this.activeCheckpoint.checkpoint.isActive = false
      if (this.activeCheckpoint.render) {
        this.activeCheckpoint.render.color = CHECKPOINT_TREE_TOP_COLOR_INACTIVE
        this.activeCheckpoint.render.borderColor =
          CHECKPOINT_TREE_TRUNK_COLOR_INACTIVE
      }
    }
    this.activeCheckpoint = entity
    if (entity?.transform && entity.checkpoint) {
      entity.checkpoint.isActive = true
      if (entity.render) {
        entity.render.color = CHECKPOINT_TREE_TOP_COLOR_ACTIVE
        entity.render.borderColor = CHECKPOINT_TREE_TRUNK_COLOR_ACTIVE
      }
      this.activeCheckpointX = entity.transform.x
      this.activeCheckpointY = entity.transform.y
      this.hasActiveCheckpoint = true
      if (this.onCheckpointActivated) {
        this.onCheckpointActivated(entity)
      }
    } else {
      this.hasActiveCheckpoint = false
    }
  }

  update(entities: Entity[], _deltaTime: number): void {
    if (!this.player || !this.player.transform || !this.player.stats) {
      return
    }

    if (this.player.stats.isDead) {
      if (this.player.stats.isVanished) {
        if (!this.deathNotified) {
          this.deathNotified = true
          if (this.onPlayerDead) {
            this.onPlayerDead()
          }
        }
      }
      return
    }

    this.deathNotified = false
    this.updateActiveCheckpoint(
      entities,
      this.player.transform.x,
      this.player.transform.y
    )
  }

  private updateActiveCheckpoint(
    entities: Entity[],
    playerX: number,
    playerY: number
  ): void {
    let bestEntity: Entity | null = null
    let bestDist = 0

    for (let i = 0; i < entities.length; i += 1) {
      const entity = entities[i]
      if (!entity.transform || !entity.checkpoint) continue

      const radius = entity.checkpoint.activationRadius
      const radiusSq = radius * radius
      const dx = playerX - entity.transform.x
      const dy = playerY - entity.transform.y
      const distSq = dx * dx + dy * dy

      if (distSq <= radiusSq) {
        if (!bestEntity || distSq < bestDist) {
          bestEntity = entity
          bestDist = distSq
        }
      }
    }

    if (bestEntity) {
      this.setActiveCheckpoint(bestEntity)
    }
  }

  hasDefaultSpawnPoint(): boolean {
    return this.hasDefaultSpawn
  }
}
