import {
  DEFAULT_PLAYER_RADIUS,
  ENEMY_HEARING_RANGE_MULTIPLIER,
  FOOTSTEP_INTERVAL_MS,
  FOOTSTEP_MIN_MOVE_SPEED,
  FOOTSTEP_SOUND_DB,
  FOOTSTEP_WAVE_DISTANCE_MULTIPLIER,
  FOOTSTEP_WAVE_SPEED,
} from '../../constants'
import { Faction } from '../Component'
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
      this.updateFootsteps(deltaMs)
    }
    this.updateWaves(entities, deltaTime)
  }

  private updateFootsteps(deltaMs: number): void {
    const player = this.player
    if (!player || !player.transform || !player.movement || !player.render) {
      return
    }
    if (player.stats?.isDead || player.movement.isRolling) {
      player.movement.footstepTimerMs = 0
      return
    }
    if (!player.movement.isGrounded) {
      player.movement.footstepTimerMs = 0
      return
    }

    const moveDir = player.input?.moveDirection ?? 0
    let isMoving = moveDir !== 0
    if (!isMoving && player.physics) {
      isMoving = Math.abs(player.physics.velX) >= FOOTSTEP_MIN_MOVE_SPEED
    }
    if (!isMoving) {
      player.movement.footstepTimerMs = 0
      return
    }

    player.movement.footstepTimerMs -= deltaMs
    if (player.movement.footstepTimerMs > 0) {
      return
    }

    if (this.activeWaves.length < MAX_SOUND_WAVES) {
      this.emitFootstep(player)
    }
    const interval =
      player.movement.footstepIntervalMs > 0
        ? player.movement.footstepIntervalMs
        : FOOTSTEP_INTERVAL_MS
    player.movement.footstepTimerMs = interval
  }

  private emitFootstep(player: Entity): void {
    if (!player.transform) return

    const radius = player.render?.radius ?? DEFAULT_PLAYER_RADIUS
    this.emitSoundAt(
      player.transform.x,
      player.transform.y + radius,
      radius,
      FOOTSTEP_SOUND_DB
    )
  }

  private updateWaves(entities: Entity[], deltaTime: number): void {
    if (this.activeWaves.length === 0) {
      return
    }

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

      this.checkWaveAgainstListeners(wave, entities)
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

  private checkWaveAgainstListeners(wave: SoundWave, entities: Entity[]): void {
    for (let i = 0; i < entities.length; i++) {
      const entity = entities[i]
      if (!entity.enemyAI || !entity.transform) continue
      if (entity.faction?.faction !== Faction.Enemy) continue
      if (entity.stats?.isDead || entity.stats?.isVanished) continue

      const hearingRange =
        entity.enemyAI.detectionRange * ENEMY_HEARING_RANGE_MULTIPLIER
      const dx = entity.transform.x - wave.x
      const dy = entity.transform.y - wave.y
      const distanceSq = dx * dx + dy * dy
      const hearingRangeSq = hearingRange * hearingRange
      if (distanceSq > hearingRangeSq) continue
      const prevRadiusSq = wave.prevRadius * wave.prevRadius
      const radiusSq = wave.radius * wave.radius
      if (distanceSq < prevRadiusSq || distanceSq > radiusSq) continue

      this.triggerSoundAlert(entity)
    }
  }

  private triggerSoundAlert(entity: Entity): void {
    if (entity.enemyAI) {
      entity.enemyAI.alertChaseActive = true
      entity.enemyAI.alertTimeRemainingMs = 0
      entity.enemyAI.state = 'approach'
    }
    if (entity.stats) {
      entity.stats.isInCombat = true
      entity.stats.combatExitTimer = 0
    }
  }
}
