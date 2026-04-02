import {
  DEFAULT_PLAYER_RADIUS,
  ENEMY_HEARING_RANGE_MULTIPLIER,
  FOOTSTEP_INTERVAL_MS,
  FOOTSTEP_MIN_MOVE_SPEED,
  FOOTSTEP_SOUND_DB,
  FOOTSTEP_WAVE_DISTANCE_MULTIPLIER,
  FOOTSTEP_WAVE_SPEED,
} from '../../constants'
import { componentRegistry } from '../ComponentRegistry'
import type { Entity } from '../Entity'
import { ObjectPool } from '../ObjectPool'
import { System } from '../System'

class SoundWave {
  x = 0
  y = 0
  radius = 0
  prevRadius = 0
  speed = 0
  maxRadius = 0
  baseDb = 0
  currentDb = 0
  sourceEntityId = 0

  reset(): void {
    this.x = 0
    this.y = 0
    this.radius = 0
    this.prevRadius = 0
    this.speed = 0
    this.maxRadius = 0
    this.baseDb = 0
    this.currentDb = 0
    this.sourceEntityId = 0
  }
}

const MAX_SOUND_WAVES = 64

export class SoundSystem extends System {
  private player?: Entity
  private wavePool = new ObjectPool(
    () => new SoundWave(),
    (wave) => wave.reset(),
    MAX_SOUND_WAVES
  )
  private activeWaves: SoundWave[] = []

  constructor() {
    super()
    const transformType = componentRegistry.getComponentType('Transform')
    this.setRequiredComponents([transformType])
  }

  setPlayer(player: Entity): void {
    this.player = player
  }

  getActiveWaves(): SoundWave[] {
    return this.activeWaves
  }

  emitSoundAt(
    x: number,
    y: number,
    sourceRadius: number,
    db: number,
    rangeMultiplier = 1
  ): void {
    if (this.activeWaves.length >= MAX_SOUND_WAVES) return
    if (db <= 0) return

    const wave = this.wavePool.acquire()
    wave.x = x
    wave.y = y
    wave.radius = 0
    wave.prevRadius = 0
    wave.speed = FOOTSTEP_WAVE_SPEED
    const loudnessScale = Math.max(0.1, db)
    wave.maxRadius =
      sourceRadius *
      FOOTSTEP_WAVE_DISTANCE_MULTIPLIER *
      rangeMultiplier *
      loudnessScale
    wave.baseDb = db
    wave.currentDb = db
    wave.sourceEntityId = 0
    this.activeWaves.push(wave)
  }

  update(entities: Entity[], deltaTime: number): void {
    const deltaMs = deltaTime > 0 ? deltaTime * 1000 : 0
    if (deltaMs > 0) {
      this.updateFootsteps(entities, deltaMs)
    }
    this.updateWaves(entities, deltaTime)
  }

  private updateFootsteps(entities: Entity[], deltaMs: number): void {
    for (const entity of entities) {
      if (!entity.transform || !entity.movement || !entity.render) continue
      if (entity.stats?.isDead || entity.movement.isRolling) {
        entity.movement.footstepTimerMs = 0
        continue
      }
      if (!entity.movement.isGrounded) {
        entity.movement.footstepTimerMs = 0
        continue
      }

      const moveDir = entity.input?.moveDirection ?? 0
      let isMoving = moveDir !== 0
      if (!isMoving && entity.physics) {
        isMoving = Math.abs(entity.physics.velX) >= FOOTSTEP_MIN_MOVE_SPEED
      }
      if (!isMoving) {
        entity.movement.footstepTimerMs = 0
        continue
      }

      entity.movement.footstepTimerMs -= deltaMs
      if (entity.movement.footstepTimerMs > 0) continue

      if (this.activeWaves.length < MAX_SOUND_WAVES) {
        this.emitFootstep(entity)
      }
      const interval =
        entity.movement.footstepIntervalMs > 0
          ? entity.movement.footstepIntervalMs
          : FOOTSTEP_INTERVAL_MS
      entity.movement.footstepTimerMs = interval
    }
  }

  private emitFootstep(entity: Entity): void {
    if (!entity.transform) return

    const radius = entity.render?.radius ?? DEFAULT_PLAYER_RADIUS
    if (this.activeWaves.length >= MAX_SOUND_WAVES) return
    const wave = this.wavePool.acquire()
    wave.x = entity.transform.x
    wave.y = entity.transform.y + radius
    wave.radius = 0
    wave.prevRadius = 0
    wave.speed = FOOTSTEP_WAVE_SPEED
    const loudnessScale = Math.max(0.1, FOOTSTEP_SOUND_DB)
    wave.maxRadius = radius * FOOTSTEP_WAVE_DISTANCE_MULTIPLIER * loudnessScale
    wave.baseDb = FOOTSTEP_SOUND_DB
    wave.currentDb = FOOTSTEP_SOUND_DB
    wave.sourceEntityId = entity.id
    this.activeWaves.push(wave)
  }

  private updateWaves(entities: Entity[], deltaTime: number): void {
    if (this.activeWaves.length === 0) {
      return
    }

    const entityMap = new Map<number, Entity>()
    for (const e of entities) entityMap.set(e.id, e)

    for (let i = 0; i < this.activeWaves.length; ) {
      const wave = this.activeWaves[i]
      wave.prevRadius = wave.radius
      wave.radius += wave.speed * deltaTime
      if (wave.radius >= wave.maxRadius) {
        wave.currentDb = 0
        this.releaseWave(i)
        continue
      }

      const ratio = wave.maxRadius > 0 ? 1 - wave.radius / wave.maxRadius : 0
      wave.currentDb = wave.baseDb * Math.max(0, ratio)
      if (wave.currentDb <= 0) {
        this.releaseWave(i)
        continue
      }

      this.checkWaveAgainstListeners(wave, entities, entityMap)
      i += 1
    }
  }

  private releaseWave(index: number): void {
    const wave = this.activeWaves[index]
    const lastIndex = this.activeWaves.length - 1
    if (index !== lastIndex) {
      this.activeWaves[index] = this.activeWaves[lastIndex]
    }
    this.activeWaves.length = lastIndex
    this.wavePool.release(wave)
  }

  private checkWaveAgainstListeners(
    wave: SoundWave,
    entities: Entity[],
    entityMap: Map<number, Entity>
  ): void {
    const source = wave.sourceEntityId
      ? entityMap.get(wave.sourceEntityId)
      : undefined

    for (let i = 0; i < entities.length; i++) {
      const entity = entities[i]
      if (!entity.npcAI || !entity.transform) continue
      if (entity.id === wave.sourceEntityId) continue
      if (entity.stats?.isDead || entity.stats?.isVanished) continue

      // 只对敌对阵营的声音产生警戒反应
      if (source?.faction && entity.faction) {
        if (!entity.faction.canAttack(source.faction)) continue
      }

      const hearingRange =
        entity.npcAI.detectionRange * ENEMY_HEARING_RANGE_MULTIPLIER
      const dx = entity.transform.x - wave.x
      const dy = entity.transform.y - wave.y
      const distanceSq = dx * dx + dy * dy
      const hearingRangeSq = hearingRange * hearingRange
      if (distanceSq > hearingRangeSq) continue
      const prevRadiusSq = wave.prevRadius * wave.prevRadius
      const radiusSq = wave.radius * wave.radius
      if (distanceSq < prevRadiusSq || distanceSq > radiusSq) continue

      this.triggerSoundAlert(entity, source)
    }
  }

  private triggerSoundAlert(entity: Entity, source?: Entity): void {
    if (entity.npcAI) {
      entity.npcAI.alertChaseActive = true
      entity.npcAI.alertTimeRemainingMs = 0
      entity.npcAI.state = 'approach'
    }
    if (entity.stats) {
      entity.stats.isInCombat = true
      entity.stats.combatExitTimer = 0
    }
    if (source && entity.input && entity.input.lockedTargetId == null) {
      entity.input.lockedTargetId = source.id
      entity.input.lockLostTimer = 0
    }
  }
}
