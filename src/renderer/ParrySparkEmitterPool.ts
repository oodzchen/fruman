import type { BehaviorEntry } from '@pixi/particle-emitter'
import { Container, Texture } from 'pixi.js'

import type {
  ParticleEmitterConfig,
  ParticleEmitterConstructor,
  ParticleEmitterInstance,
} from './PixiParticleEmitterCompat'
import { loadPixiParticleEmitter } from './PixiParticleEmitterCompat'

const EMITTER_POOL_SIZE = 6
const EMITTER_FILL_POOL_SIZE = 32
const PENDING_EVENT_LIMIT = 16
const DEGREES_PER_RADIAN = 180 / Math.PI
const SPARK_TEXTURE_WIDTH = 36
const SPARK_TEXTURE_HEIGHT = 14
const FLASH_EMITTER_PARTICLES = 6
const CORE_EMITTER_PARTICLES = 20
const SPRAY_EMITTER_PARTICLES = 14
const ACTIVE_DETECTION_COUNT = 1
const FLASH_COLOR_BRIGHT = '#fffef2'
const FLASH_COLOR_MID = '#fff2a8'
const CORE_COLOR_BRIGHT = '#fffde6'
const CORE_COLOR_MID = '#ffe07c'
const CORE_COLOR_EDGE = '#ff8c2a'
const SPRAY_COLOR_BRIGHT = '#fff1b8'
const SPRAY_COLOR_MID = '#ffc45f'
const SPRAY_COLOR_EDGE = '#ff7a1f'

interface PooledParryEmitter {
  readonly container: Container
  readonly flash: ParticleEmitterInstance
  readonly core: ParticleEmitterInstance
  readonly spray: ParticleEmitterInstance
  readonly flashConfig: ParticleEmitterConfig
  readonly coreConfig: ParticleEmitterConfig
  readonly sprayConfig: ParticleEmitterConfig
}

export class ParrySparkEmitterPool {
  private readonly root: Container
  private readonly sparkTexture: Texture
  private readonly pendingX = new Int32Array(PENDING_EVENT_LIMIT)
  private readonly pendingY = new Int32Array(PENDING_EVENT_LIMIT)
  private readonly pendingDirection = new Int16Array(PENDING_EVENT_LIMIT)
  private readonly emitters: PooledParryEmitter[] = []
  private readonly activeEmitters: PooledParryEmitter[] = []
  private emitterCtor: ParticleEmitterConstructor | null = null
  private initializationRequested = false
  private initializationFinished = false
  private pendingCount = 0
  private activeCount = 0
  private nextEmitterIndex = 0

  constructor(parent: Container) {
    this.root = new Container()
    this.root.zIndex = 850100
    parent.addChild(this.root)

    this.sparkTexture = this.createSparkTexture()
    this.ensureInitialized()
  }

  update(deltaSec: number): void {
    if (!(deltaSec > 0)) {
      return
    }

    for (let i = 0; i < this.activeCount; ) {
      const emitter = this.activeEmitters[i]
      emitter.flash.update(deltaSec)
      emitter.core.update(deltaSec)
      emitter.spray.update(deltaSec)
      if (
        emitter.flash.particleCount >= ACTIVE_DETECTION_COUNT ||
        emitter.core.particleCount >= ACTIVE_DETECTION_COUNT ||
        emitter.spray.particleCount >= ACTIVE_DETECTION_COUNT
      ) {
        i += 1
        continue
      }

      emitter.container.visible = false
      this.activeCount -= 1
      this.activeEmitters[i] = this.activeEmitters[this.activeCount]
    }
  }

  emit(x: number, y: number, directionRad: number): void {
    const px = Math.round(x)
    const py = Math.round(y)
    const directionDeg = Math.round(directionRad * DEGREES_PER_RADIAN)

    if (!this.initializationFinished || !this.emitterCtor) {
      this.queuePending(px, py, directionDeg)
      this.ensureInitialized()
      return
    }

    this.emitInternal(px, py, directionDeg)
  }

  getActiveParticleCount(): number {
    let particleCount = 0
    for (let i = 0; i < this.activeCount; i++) {
      const emitter = this.activeEmitters[i]
      particleCount +=
        emitter.flash.particleCount +
        emitter.core.particleCount +
        emitter.spray.particleCount
    }
    return particleCount
  }

  destroy(): void {
    for (let i = 0; i < this.emitters.length; i++) {
      const emitter = this.emitters[i]
      emitter.flash.destroy()
      emitter.core.destroy()
      emitter.spray.destroy()
    }
    this.emitters.length = 0
    this.activeEmitters.length = 0
    this.root.destroy({ children: true })
    this.sparkTexture.destroy(true)
  }

  private ensureInitialized(): void {
    if (this.initializationRequested) {
      return
    }

    this.initializationRequested = true
    loadPixiParticleEmitter().then((emitterCtor) => {
      this.initializationFinished = true
      if (!emitterCtor) {
        return
      }

      this.emitterCtor = emitterCtor
      this.createEmitterPool(emitterCtor)
      this.flushPendingEvents()
    })
  }

  private createEmitterPool(emitterCtor: ParticleEmitterConstructor): void {
    for (let i = 0; i < EMITTER_POOL_SIZE; i++) {
      const container = new Container()
      container.visible = false
      this.root.addChild(container)

      const flashConfig = this.createFlashConfig()
      const coreConfig = this.createCoreConfig()
      const sprayConfig = this.createSprayConfig()
      const flash = new emitterCtor(container, flashConfig)
      const core = new emitterCtor(container, coreConfig)
      const spray = new emitterCtor(container, sprayConfig)
      flash.fillPool(EMITTER_FILL_POOL_SIZE)
      core.fillPool(EMITTER_FILL_POOL_SIZE)
      spray.fillPool(EMITTER_FILL_POOL_SIZE)
      flash.emit = false
      core.emit = false
      spray.emit = false
      this.emitters.push({
        container,
        flash,
        core,
        spray,
        flashConfig,
        coreConfig,
        sprayConfig,
      })
    }
  }

  private emitInternal(x: number, y: number, directionDeg: number): void {
    if (this.emitters.length === 0) {
      return
    }

    const emitter = this.emitters[this.nextEmitterIndex]
    this.nextEmitterIndex = (this.nextEmitterIndex + 1) % this.emitters.length

    emitter.container.visible = true
    emitter.container.position.set(x, y)
    emitter.flash.cleanup()
    emitter.core.cleanup()
    emitter.spray.cleanup()
    emitter.flash.init(emitter.flashConfig)
    emitter.core.init(emitter.coreConfig)
    emitter.spray.init(emitter.sprayConfig)
    emitter.flash.updateOwnerPos(0, 0)
    emitter.core.updateOwnerPos(0, 0)
    emitter.spray.updateOwnerPos(0, 0)
    emitter.flash.resetPositionTracking()
    emitter.core.resetPositionTracking()
    emitter.spray.resetPositionTracking()
    emitter.flash.rotate(directionDeg)
    emitter.core.rotate(directionDeg)
    emitter.spray.rotate(directionDeg)
    emitter.flash.emitNow()
    emitter.core.emitNow()
    emitter.spray.emitNow()
    this.markEmitterActive(emitter)
  }

  private markEmitterActive(emitter: PooledParryEmitter): void {
    for (let i = 0; i < this.activeCount; i++) {
      if (this.activeEmitters[i] === emitter) {
        return
      }
    }

    this.activeEmitters[this.activeCount] = emitter
    this.activeCount += 1
  }

  private queuePending(x: number, y: number, directionDeg: number): void {
    if (this.pendingCount < PENDING_EVENT_LIMIT) {
      const index = this.pendingCount
      this.pendingX[index] = x
      this.pendingY[index] = y
      this.pendingDirection[index] = directionDeg
      this.pendingCount += 1
      return
    }

    const lastIndex = PENDING_EVENT_LIMIT - 1
    this.pendingX[lastIndex] = x
    this.pendingY[lastIndex] = y
    this.pendingDirection[lastIndex] = directionDeg
  }

  private flushPendingEvents(): void {
    for (let i = 0; i < this.pendingCount; i++) {
      this.emitInternal(
        this.pendingX[i],
        this.pendingY[i],
        this.pendingDirection[i]
      )
    }
    this.pendingCount = 0
  }

  private createCoreConfig(): ParticleEmitterConfig {
    return {
      lifetime: {
        min: 0.2,
        max: 0.38,
      },
      frequency: 0.016,
      emitterLifetime: 0.016,
      maxParticles: CORE_EMITTER_PARTICLES,
      particlesPerWave: CORE_EMITTER_PARTICLES,
      addAtBack: false,
      pos: {
        x: 0,
        y: 0,
      },
      emit: false,
      autoUpdate: false,
      behaviors: [
        this.createSingleTextureBehavior(),
        {
          type: 'blendMode',
          config: {
            blendMode: 'add',
          },
        },
        {
          type: 'rotationStatic',
          config: {
            min: -132,
            max: 132,
          },
        },
        {
          type: 'moveAcceleration',
          config: {
            minStart: 220,
            maxStart: 640,
            accel: {
              x: 0,
              y: 780,
            },
            rotate: true,
            maxSpeed: 720,
          },
        },
        {
          type: 'scale',
          config: {
            scale: {
              list: [
                { time: 0, value: 1.6 },
                { time: 0.18, value: 1.18 },
                { time: 0.58, value: 0.56 },
                { time: 1, value: 0.1 },
              ],
            },
            minMult: 0.78,
          },
        },
        {
          type: 'alpha',
          config: {
            alpha: {
              list: [
                { time: 0, value: 1 },
                { time: 0.18, value: 0.94 },
                { time: 0.7, value: 0.5 },
                { time: 1, value: 0 },
              ],
            },
          },
        },
        {
          type: 'color',
          config: {
            color: {
              list: [
                { time: 0, value: CORE_COLOR_BRIGHT },
                { time: 0.28, value: CORE_COLOR_MID },
                { time: 1, value: CORE_COLOR_EDGE },
              ],
            },
          },
        },
      ],
    }
  }

  private createSprayConfig(): ParticleEmitterConfig {
    return {
      lifetime: {
        min: 0.16,
        max: 0.3,
      },
      frequency: 0.016,
      emitterLifetime: 0.016,
      maxParticles: SPRAY_EMITTER_PARTICLES,
      particlesPerWave: SPRAY_EMITTER_PARTICLES,
      addAtBack: true,
      pos: {
        x: 0,
        y: 0,
      },
      emit: false,
      autoUpdate: false,
      behaviors: [
        this.createSingleTextureBehavior(),
        {
          type: 'blendMode',
          config: {
            blendMode: 'add',
          },
        },
        {
          type: 'rotationStatic',
          config: {
            min: -180,
            max: 180,
          },
        },
        {
          type: 'moveAcceleration',
          config: {
            minStart: 160,
            maxStart: 360,
            accel: {
              x: 0,
              y: 740,
            },
            rotate: true,
            maxSpeed: 420,
          },
        },
        {
          type: 'scale',
          config: {
            scale: {
              list: [
                { time: 0, value: 1.02 },
                { time: 0.48, value: 0.42 },
                { time: 1, value: 0.08 },
              ],
            },
            minMult: 0.7,
          },
        },
        {
          type: 'alpha',
          config: {
            alpha: {
              list: [
                { time: 0, value: 0.82 },
                { time: 0.42, value: 0.4 },
                { time: 1, value: 0 },
              ],
            },
          },
        },
        {
          type: 'color',
          config: {
            color: {
              list: [
                { time: 0, value: SPRAY_COLOR_BRIGHT },
                { time: 0.34, value: SPRAY_COLOR_MID },
                { time: 1, value: SPRAY_COLOR_EDGE },
              ],
            },
          },
        },
      ],
    }
  }

  private createFlashConfig(): ParticleEmitterConfig {
    return {
      lifetime: {
        min: 0.08,
        max: 0.12,
      },
      frequency: 0.016,
      emitterLifetime: 0.016,
      maxParticles: FLASH_EMITTER_PARTICLES,
      particlesPerWave: FLASH_EMITTER_PARTICLES,
      addAtBack: false,
      pos: {
        x: 0,
        y: 0,
      },
      emit: false,
      autoUpdate: false,
      behaviors: [
        this.createSingleTextureBehavior(),
        {
          type: 'blendMode',
          config: {
            blendMode: 'add',
          },
        },
        {
          type: 'rotationStatic',
          config: {
            min: -180,
            max: 180,
          },
        },
        {
          type: 'moveAcceleration',
          config: {
            minStart: 20,
            maxStart: 80,
            accel: {
              x: 0,
              y: 0,
            },
            rotate: true,
            maxSpeed: 80,
          },
        },
        {
          type: 'scale',
          config: {
            scale: {
              list: [
                { time: 0, value: 2.2 },
                { time: 0.45, value: 1.28 },
                { time: 1, value: 0.14 },
              ],
            },
            minMult: 0.82,
          },
        },
        {
          type: 'alpha',
          config: {
            alpha: {
              list: [
                { time: 0, value: 1 },
                { time: 0.32, value: 0.9 },
                { time: 1, value: 0 },
              ],
            },
          },
        },
        {
          type: 'color',
          config: {
            color: {
              list: [
                { time: 0, value: FLASH_COLOR_BRIGHT },
                { time: 0.36, value: FLASH_COLOR_MID },
                { time: 1, value: CORE_COLOR_EDGE },
              ],
            },
          },
        },
      ],
    }
  }

  private createSingleTextureBehavior(): BehaviorEntry {
    return {
      type: 'textureSingle',
      config: {
        texture: this.sparkTexture,
      },
    }
  }

  private createSparkTexture(): Texture {
    const canvas = document.createElement('canvas')
    canvas.width = SPARK_TEXTURE_WIDTH
    canvas.height = SPARK_TEXTURE_HEIGHT
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      return Texture.EMPTY
    }

    const halfWidth = SPARK_TEXTURE_WIDTH / 2
    const halfHeight = SPARK_TEXTURE_HEIGHT / 2
    const glowGradient = ctx.createLinearGradient(
      0,
      halfHeight,
      SPARK_TEXTURE_WIDTH,
      halfHeight
    )
    glowGradient.addColorStop(0, 'rgba(255, 255, 255, 0)')
    glowGradient.addColorStop(0.12, 'rgba(255, 245, 196, 0.72)')
    glowGradient.addColorStop(0.46, 'rgba(255, 254, 236, 1)')
    glowGradient.addColorStop(0.8, 'rgba(255, 185, 88, 0.56)')
    glowGradient.addColorStop(1, 'rgba(255, 128, 0, 0)')

    ctx.fillStyle = glowGradient
    ctx.beginPath()
    ctx.moveTo(0, halfHeight)
    ctx.quadraticCurveTo(halfWidth, 0, SPARK_TEXTURE_WIDTH, halfHeight)
    ctx.quadraticCurveTo(halfWidth, SPARK_TEXTURE_HEIGHT, 0, halfHeight)
    ctx.fill()

    ctx.fillStyle = 'rgba(255, 255, 255, 1)'
    ctx.fillRect(halfWidth - 6, halfHeight - 1, 12, 2)

    return Texture.from(canvas)
  }
}
