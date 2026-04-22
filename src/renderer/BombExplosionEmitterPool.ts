import type { BehaviorEntry } from '@pixi/particle-emitter'
import { Container, type ContainerChild, Texture } from 'pixi.js'

import type {
  ParticleEmitterConfig,
  ParticleEmitterConstructor,
  ParticleEmitterInstance,
} from './PixiParticleEmitterCompat'
import { loadPixiParticleEmitter } from './PixiParticleEmitterCompat'

class PooledParticleParent extends Container {
  override removeChild<U extends ContainerChild[]>(...children: U): U[0] {
    for (let i = 0; i < children.length; i++) {
      children[i].visible = false
    }
    return children[0]
  }

  override addChild<U extends ContainerChild[]>(...children: U): U[0] {
    for (let i = 0; i < children.length; i++) {
      const child = children[i]
      if (child.parent === this) {
        continue
      }
      super.addChild(child)
    }
    return children[0]
  }

  override addChildAt<U extends ContainerChild>(child: U, index: number): U {
    if (child.parent === this) {
      return child
    }
    return super.addChildAt(child, index)
  }
}

const EMITTER_POOL_SIZE = 6
const EMITTER_FILL_POOL_SIZE = 48
const PENDING_EVENT_LIMIT = 16
const FLASH_PARTICLES = 10
const FIREBALL_PARTICLES = 28
const SPARK_PARTICLES = 34
const ACTIVE_DETECTION_COUNT = 1
const BASE_RADIUS_PX = 160
const MIN_SCALE = 0.7
const MAX_SCALE = 1.5

interface PooledBombEmitter {
  readonly container: Container
  readonly flash: ParticleEmitterInstance
  readonly fireball: ParticleEmitterInstance
  readonly sparks: ParticleEmitterInstance
}

export class BombExplosionEmitterPool {
  private readonly root: Container
  private readonly particleTexture: Texture
  private readonly pendingX = new Int32Array(PENDING_EVENT_LIMIT)
  private readonly pendingY = new Int32Array(PENDING_EVENT_LIMIT)
  private readonly pendingRadius = new Float32Array(PENDING_EVENT_LIMIT)
  private readonly emitters: PooledBombEmitter[] = []
  private readonly activeEmitters: PooledBombEmitter[] = []
  private emitterCtor: ParticleEmitterConstructor | null = null
  private initializationRequested = false
  private initializationFinished = false
  private pendingCount = 0
  private activeCount = 0
  private nextEmitterIndex = 0

  constructor(parent: Container) {
    this.root = new Container()
    this.root.zIndex = 850050
    parent.addChild(this.root)

    this.particleTexture = this.createParticleTexture()
    this.ensureInitialized()
  }

  update(deltaSec: number): void {
    if (!(deltaSec > 0)) {
      return
    }

    for (let i = 0; i < this.activeCount; ) {
      const emitter = this.activeEmitters[i]
      emitter.flash.update(deltaSec)
      emitter.fireball.update(deltaSec)
      emitter.sparks.update(deltaSec)
      if (
        emitter.flash.particleCount >= ACTIVE_DETECTION_COUNT ||
        emitter.fireball.particleCount >= ACTIVE_DETECTION_COUNT ||
        emitter.sparks.particleCount >= ACTIVE_DETECTION_COUNT
      ) {
        i += 1
        continue
      }

      emitter.container.visible = false
      this.activeCount -= 1
      this.activeEmitters[i] = this.activeEmitters[this.activeCount]
    }
  }

  emit(x: number, y: number, radiusPx: number): void {
    const px = Math.round(x)
    const py = Math.round(y)
    const clampedRadius = Math.max(48, radiusPx)
    if (!this.initializationFinished || !this.emitterCtor) {
      this.queuePending(px, py, clampedRadius)
      this.ensureInitialized()
      return
    }

    this.emitInternal(px, py, clampedRadius)
  }

  destroy(): void {
    for (let i = 0; i < this.emitters.length; i++) {
      const emitter = this.emitters[i]
      emitter.flash.destroy()
      emitter.fireball.destroy()
      emitter.sparks.destroy()
    }
    this.emitters.length = 0
    this.activeEmitters.length = 0
    this.root.destroy({ children: true })
    this.particleTexture.destroy(true)
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
      const container = new PooledParticleParent()
      container.visible = false
      this.root.addChild(container)

      const flash = new emitterCtor(container, this.createFlashConfig())
      const fireball = new emitterCtor(container, this.createFireballConfig())
      const sparks = new emitterCtor(container, this.createSparkConfig())
      flash.fillPool(EMITTER_FILL_POOL_SIZE)
      fireball.fillPool(EMITTER_FILL_POOL_SIZE)
      sparks.fillPool(EMITTER_FILL_POOL_SIZE)
      flash.emit = false
      fireball.emit = false
      sparks.emit = false

      this.emitters.push({
        container,
        flash,
        fireball,
        sparks,
      })
    }
  }

  private emitInternal(x: number, y: number, radiusPx: number): void {
    if (this.emitters.length === 0) {
      return
    }

    const emitter = this.emitters[this.nextEmitterIndex]
    this.nextEmitterIndex = (this.nextEmitterIndex + 1) % this.emitters.length

    const scale = Math.max(
      MIN_SCALE,
      Math.min(MAX_SCALE, radiusPx / BASE_RADIUS_PX)
    )
    emitter.container.visible = true
    emitter.container.position.set(x, y)
    emitter.container.scale.set(scale)

    emitter.flash.cleanup()
    emitter.fireball.cleanup()
    emitter.sparks.cleanup()

    emitter.flash.updateOwnerPos(0, 0)
    emitter.fireball.updateOwnerPos(0, 0)
    emitter.sparks.updateOwnerPos(0, 0)
    emitter.flash.resetPositionTracking()
    emitter.fireball.resetPositionTracking()
    emitter.sparks.resetPositionTracking()

    emitter.flash.emitNow()
    emitter.fireball.emitNow()
    emitter.sparks.emitNow()

    this.markEmitterActive(emitter)
  }

  private markEmitterActive(emitter: PooledBombEmitter): void {
    for (let i = 0; i < this.activeCount; i++) {
      if (this.activeEmitters[i] === emitter) {
        return
      }
    }

    this.activeEmitters[this.activeCount] = emitter
    this.activeCount += 1
  }

  private queuePending(x: number, y: number, radiusPx: number): void {
    if (this.pendingCount < PENDING_EVENT_LIMIT) {
      const index = this.pendingCount
      this.pendingX[index] = x
      this.pendingY[index] = y
      this.pendingRadius[index] = radiusPx
      this.pendingCount += 1
      return
    }

    const lastIndex = PENDING_EVENT_LIMIT - 1
    this.pendingX[lastIndex] = x
    this.pendingY[lastIndex] = y
    this.pendingRadius[lastIndex] = radiusPx
  }

  private flushPendingEvents(): void {
    for (let i = 0; i < this.pendingCount; i++) {
      this.emitInternal(
        this.pendingX[i],
        this.pendingY[i],
        this.pendingRadius[i]
      )
    }
    this.pendingCount = 0
  }

  private createFlashConfig(): ParticleEmitterConfig {
    return {
      lifetime: { min: 0.1, max: 0.16 },
      frequency: 0.016,
      emitterLifetime: 0.016,
      maxParticles: FLASH_PARTICLES,
      particlesPerWave: FLASH_PARTICLES,
      addAtBack: false,
      pos: { x: 0, y: 0 },
      emit: false,
      autoUpdate: false,
      behaviors: [
        this.createSingleTextureBehavior(),
        { type: 'blendMode', config: { blendMode: 'add' } },
        { type: 'rotationStatic', config: { min: -180, max: 180 } },
        {
          type: 'moveAcceleration',
          config: {
            minStart: 10,
            maxStart: 80,
            accel: { x: 0, y: 0 },
            rotate: true,
            maxSpeed: 80,
          },
        },
        {
          type: 'scale',
          config: {
            scale: {
              list: [
                { time: 0, value: 2.6 },
                { time: 0.4, value: 1.2 },
                { time: 1, value: 0.08 },
              ],
            },
            minMult: 0.85,
          },
        },
        {
          type: 'alpha',
          config: {
            alpha: {
              list: [
                { time: 0, value: 1 },
                { time: 0.35, value: 0.82 },
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
                { time: 0, value: '#fff7d6' },
                { time: 0.32, value: '#ffd58a' },
                { time: 1, value: '#ff7a1f' },
              ],
            },
          },
        },
      ],
    }
  }

  private createFireballConfig(): ParticleEmitterConfig {
    return {
      lifetime: { min: 0.22, max: 0.36 },
      frequency: 0.016,
      emitterLifetime: 0.024,
      maxParticles: FIREBALL_PARTICLES,
      particlesPerWave: FIREBALL_PARTICLES,
      addAtBack: true,
      pos: { x: 0, y: 0 },
      emit: false,
      autoUpdate: false,
      behaviors: [
        this.createSingleTextureBehavior(),
        { type: 'blendMode', config: { blendMode: 'add' } },
        { type: 'rotationStatic', config: { min: -180, max: 180 } },
        {
          type: 'moveAcceleration',
          config: {
            minStart: 90,
            maxStart: 260,
            accel: { x: 0, y: 520 },
            rotate: true,
            maxSpeed: 300,
          },
        },
        {
          type: 'scale',
          config: {
            scale: {
              list: [
                { time: 0, value: 1.7 },
                { time: 0.28, value: 1.1 },
                { time: 0.7, value: 0.42 },
                { time: 1, value: 0.08 },
              ],
            },
            minMult: 0.8,
          },
        },
        {
          type: 'alpha',
          config: {
            alpha: {
              list: [
                { time: 0, value: 0.95 },
                { time: 0.42, value: 0.58 },
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
                { time: 0, value: '#fff1bf' },
                { time: 0.32, value: '#ffb65c' },
                { time: 1, value: '#ff5a17' },
              ],
            },
          },
        },
      ],
    }
  }

  private createSparkConfig(): ParticleEmitterConfig {
    return {
      lifetime: { min: 0.2, max: 0.34 },
      frequency: 0.016,
      emitterLifetime: 0.02,
      maxParticles: SPARK_PARTICLES,
      particlesPerWave: SPARK_PARTICLES,
      addAtBack: false,
      pos: { x: 0, y: 0 },
      emit: false,
      autoUpdate: false,
      behaviors: [
        this.createSingleTextureBehavior(),
        { type: 'blendMode', config: { blendMode: 'add' } },
        { type: 'rotationStatic', config: { min: -180, max: 180 } },
        {
          type: 'moveAcceleration',
          config: {
            minStart: 220,
            maxStart: 620,
            accel: { x: 0, y: 760 },
            rotate: true,
            maxSpeed: 720,
          },
        },
        {
          type: 'scale',
          config: {
            scale: {
              list: [
                { time: 0, value: 1.08 },
                { time: 0.48, value: 0.38 },
                { time: 1, value: 0.06 },
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
                { time: 0, value: 1 },
                { time: 0.24, value: 0.72 },
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
                { time: 0, value: '#fff8de' },
                { time: 0.26, value: '#ffc56a' },
                { time: 1, value: '#ff7b21' },
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
        texture: this.particleTexture,
      },
    }
  }

  private createParticleTexture(): Texture {
    const canvas = document.createElement('canvas')
    canvas.width = 40
    canvas.height = 40
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      return Texture.EMPTY
    }

    const center = canvas.width / 2
    const gradient = ctx.createRadialGradient(
      center,
      center,
      2,
      center,
      center,
      18
    )
    gradient.addColorStop(0, 'rgba(255,255,255,1)')
    gradient.addColorStop(0.28, 'rgba(255,235,177,0.95)')
    gradient.addColorStop(0.62, 'rgba(255,168,74,0.58)')
    gradient.addColorStop(1, 'rgba(255,110,26,0)')
    ctx.fillStyle = gradient
    ctx.beginPath()
    ctx.arc(center, center, 18, 0, Math.PI * 2)
    ctx.fill()

    return Texture.from(canvas)
  }
}
