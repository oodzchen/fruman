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
export type CheckpointEnteredHandler = (
  entity: Entity,
  alreadyActive: boolean
) => void
export type CheckpointSleepHandler = (entity: Entity) => void
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
  private onCheckpointEntered: CheckpointEnteredHandler | null = null
  private onCheckpointSleep: CheckpointSleepHandler | null = null
  private onPlayerDead: PlayerDeadHandler | null = null
  private deathNotified = false
  private currentPlayerCheckpoint: Entity | null = null

  constructor() {
    super()
    const transformType = componentRegistry.getComponentType('Transform')
    const checkpointType = componentRegistry.getComponentType('Checkpoint')
    this.setRequiredComponents([transformType, checkpointType])
  }

  setPlayer(player: Entity | null): void {
    this.player = player
    this.deathNotified = false
    this.currentPlayerCheckpoint = null
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

  setCheckpointEnteredHandler(handler: CheckpointEnteredHandler | null): void {
    this.onCheckpointEntered = handler
  }

  setCheckpointSleepHandler(handler: CheckpointSleepHandler | null): void {
    this.onCheckpointSleep = handler
  }

  setPlayerDeadHandler(handler: PlayerDeadHandler | null): void {
    this.onPlayerDead = handler
  }

  setActiveCheckpoint(entity: Entity | null, notify = true): void {
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
      if (this.onCheckpointActivated && notify) {
        this.onCheckpointActivated(entity)
      }
    } else {
      this.hasActiveCheckpoint = false
    }
  }

  readActiveCheckpointPosition(out: { x: number; y: number }): boolean {
    if (!this.hasActiveCheckpoint) {
      return false
    }
    out.x = this.activeCheckpointX
    out.y = this.activeCheckpointY
    return true
  }

  tryRequestSleep(entity: Entity): boolean {
    if (entity !== this.player) {
      return false
    }
    if (!entity.stats || entity.stats.isDead) {
      return false
    }
    if (!this.currentPlayerCheckpoint) {
      return false
    }
    if (this.onCheckpointSleep) {
      this.onCheckpointSleep(this.currentPlayerCheckpoint)
    }
    return true
  }

  update(entities: Entity[], _deltaTime: number): void {
    if (!this.player || !this.player.transform || !this.player.stats) {
      this.clearPlayerInsideState(entities)
      return
    }

    if (this.player.stats.isDead) {
      this.clearPlayerInsideState(entities)
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
    const playerLayer = this.player?.render?.renderLayer ?? 0
    let bestEntity: Entity | null = null
    let bestDist = 0
    let enteredEntity: Entity | null = null
    let enteredDist = 0

    for (let i = 0; i < entities.length; i += 1) {
      const entity = entities[i]
      if (!entity.transform || !entity.checkpoint) continue
      if ((entity.render?.renderLayer ?? 0) !== playerLayer) {
        entity.checkpoint.wasPlayerInside = false
        continue
      }

      const renderRadius = entity.render?.radius ?? 0
      const activationRadius = entity.checkpoint.activationRadius + renderRadius
      const activationCenterY = entity.transform.y + renderRadius * 0.75
      const radiusSq = activationRadius * activationRadius
      const dx = playerX - entity.transform.x
      const dy = playerY - activationCenterY
      const distSq = dx * dx + dy * dy
      const isInside = distSq <= radiusSq
      const wasInside = entity.checkpoint.wasPlayerInside

      entity.checkpoint.wasPlayerInside = isInside

      if (isInside && !wasInside) {
        if (!enteredEntity || distSq < enteredDist) {
          enteredEntity = entity
          enteredDist = distSq
        }
      }

      if (isInside) {
        if (!bestEntity || distSq < bestDist) {
          bestEntity = entity
          bestDist = distSq
        }
      }
    }

    this.currentPlayerCheckpoint = bestEntity

    if (enteredEntity && this.onCheckpointEntered) {
      this.onCheckpointEntered(
        enteredEntity,
        this.activeCheckpoint === enteredEntity
      )
    }

    if (bestEntity && this.activeCheckpoint !== bestEntity) {
      this.setActiveCheckpoint(bestEntity)
    }
  }

  hasDefaultSpawnPoint(): boolean {
    return this.hasDefaultSpawn
  }

  private clearPlayerInsideState(entities: Entity[]): void {
    this.currentPlayerCheckpoint = null
    for (let i = 0; i < entities.length; i += 1) {
      const checkpoint = entities[i].checkpoint
      if (checkpoint) {
        checkpoint.wasPlayerInside = false
      }
    }
  }
}
