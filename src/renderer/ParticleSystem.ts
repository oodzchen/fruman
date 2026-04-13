import type { RenderContext2D } from './RenderContext2D'

const TWO_PI = Math.PI * 2

export const PARTICLE_TYPE_SPARK = 0
export const PARTICLE_TYPE_BLOOD = 1
export const PARTICLE_TYPE_DEATH = 2
export const PARTICLE_TYPE_HEAL = 3
export const PARTICLE_TYPE_CHECKPOINT_PULSE = 4
const CHECKPOINT_PULSE_EDGE_COLOR = '#ffe260'
const CHECKPOINT_PULSE_MID_COLOR = '#ffec8a'
const CHECKPOINT_PULSE_CORE_COLOR = '#fff6bc'
const CHECKPOINT_PULSE_START_RADIUS_NUMERATOR = 3
const CHECKPOINT_PULSE_START_RADIUS_DENOMINATOR = 20
const CHECKPOINT_PULSE_EXPAND_DISTANCE_NUMERATOR = 3
const CHECKPOINT_PULSE_EXPAND_DISTANCE_DENOMINATOR = 2
const CHECKPOINT_PULSE_RING_WIDTH_NUMERATOR = 1
const CHECKPOINT_PULSE_RING_WIDTH_DENOMINATOR = 10
const CHECKPOINT_PULSE_SOFT_EDGE_NUMERATOR = 2
const CHECKPOINT_PULSE_SOFT_EDGE_DENOMINATOR = 5

type Particle = {
  x: number
  y: number
  vx: number
  vy: number
  prevX: number
  prevY: number
  age: number
  life: number
  size: number
  color: number
  gravity: number
  drag: number
  type: number
  curve: number
}

export interface ParticleSnapshot {
  readonly x: number
  readonly y: number
  readonly vx: number
  readonly vy: number
  readonly prevX: number
  readonly prevY: number
  readonly age: number
  readonly life: number
  readonly size: number
  readonly color: number
  readonly gravity: number
  readonly drag: number
  readonly type: number
  readonly curve: number
}

export class ParticleSystem {
  private pool: Particle[] = []
  private poolIndex = 0
  private active: Particle[] = []
  private activeCount = 0
  private colorCache = new Map<number, string>()

  constructor(maxParticles: number) {
    this.pool = new Array(maxParticles)
    this.active = new Array(maxParticles)
    for (let i = 0; i < maxParticles; i++) {
      this.pool[i] = {
        x: 0,
        y: 0,
        vx: 0,
        vy: 0,
        prevX: 0,
        prevY: 0,
        age: 0,
        life: 0,
        size: 0,
        color: 0,
        gravity: 0,
        drag: 0,
        type: 0,
        curve: 0,
      }
    }
    this.poolIndex = maxParticles
  }

  hasActiveParticles(): boolean {
    return this.activeCount > 0
  }

  getActiveParticleCount(): number {
    return this.activeCount
  }

  getActiveParticle(index: number): ParticleSnapshot | null {
    if (index < 0 || index >= this.activeCount) {
      return null
    }
    return this.active[index]
  }

  update(deltaTime: number): void {
    if (this.activeCount === 0) return
    const dt = deltaTime > 0 ? deltaTime : 0

    for (let i = 0; i < this.activeCount; ) {
      const particle = this.active[i]
      particle.age += dt
      if (particle.age >= particle.life) {
        this.activeCount -= 1
        this.active[i] = this.active[this.activeCount]
        this.release(particle)
        continue
      }

      particle.prevX = particle.x
      particle.prevY = particle.y

      const curve = particle.curve
      let vx = particle.vx
      let vy = particle.vy
      if (curve !== 0) {
        const curveStep = curve * dt
        const curvedVx = vx - vy * curveStep
        const curvedVy = vy + vx * curveStep
        vx = curvedVx
        vy = curvedVy
      }

      let damping = 1 - particle.drag * dt
      if (damping < 0) damping = 0
      vx *= damping
      vy = vy * damping + particle.gravity * dt
      particle.vx = vx
      particle.vy = vy
      particle.x += vx * dt
      particle.y += vy * dt
      i += 1
    }
  }

  render(ctx: RenderContext2D, pixelsPerMeter: number): void {
    if (this.activeCount === 0) return

    const savedAlpha = ctx.globalAlpha
    const savedComposite = ctx.globalCompositeOperation
    ctx.globalCompositeOperation = 'lighter'
    ctx.lineCap = 'round'

    let lastColor = ''

    // 火花/回血粒子：单次遍历绘制尾迹+发光+核心
    for (let i = 0; i < this.activeCount; i++) {
      const particle = this.active[i]
      if (
        particle.type !== PARTICLE_TYPE_SPARK &&
        particle.type !== PARTICLE_TYPE_HEAL
      )
        continue

      const lifeRatio = particle.age / particle.life
      const alpha = 1 - lifeRatio
      const sizeScale = 1.8 - lifeRatio * 1.5
      const radius = particle.size * sizeScale
      const px = particle.x * pixelsPerMeter
      const py = particle.y * pixelsPerMeter
      const color = this.getColorString(particle.color)

      if (color !== lastColor) {
        ctx.fillStyle = color
        ctx.strokeStyle = color
        lastColor = color
      }

      // 尾迹
      const trailSeconds = 0.05 + (1 - lifeRatio) * 0.07
      const tailX = (particle.x - particle.vx * trailSeconds) * pixelsPerMeter
      const tailY = (particle.y - particle.vy * trailSeconds) * pixelsPerMeter
      const trailWidth = radius * pixelsPerMeter * 0.65
      ctx.globalAlpha = alpha * 0.6
      ctx.lineWidth = trailWidth < 1 ? 1 : trailWidth
      ctx.beginPath()
      ctx.moveTo(tailX, tailY)
      ctx.lineTo(px, py)
      ctx.stroke()

      // 发光层
      const glowRadius = radius * (1.4 - lifeRatio * 0.4)
      ctx.globalAlpha = alpha * 0.45
      ctx.beginPath()
      ctx.arc(px, py, glowRadius * pixelsPerMeter, 0, TWO_PI)
      ctx.fill()

      // 核心层
      const coreAlpha = alpha * 1.1
      ctx.globalAlpha = coreAlpha > 1 ? 1 : coreAlpha
      ctx.beginPath()
      ctx.arc(px, py, radius * pixelsPerMeter, 0, TWO_PI)
      ctx.fill()
    }

    // 存档点扩散光晕
    for (let i = 0; i < this.activeCount; i++) {
      const particle = this.active[i]
      if (particle.type !== PARTICLE_TYPE_CHECKPOINT_PULSE) continue

      const lifeRatio = particle.age / particle.life
      const alpha = 1 - lifeRatio
      const px = particle.x * pixelsPerMeter
      const py = particle.y * pixelsPerMeter
      const startRadius =
        (particle.size * CHECKPOINT_PULSE_START_RADIUS_NUMERATOR) /
        CHECKPOINT_PULSE_START_RADIUS_DENOMINATOR
      const expandDistance =
        (particle.size * CHECKPOINT_PULSE_EXPAND_DISTANCE_NUMERATOR) /
        CHECKPOINT_PULSE_EXPAND_DISTANCE_DENOMINATOR
      const ringWidth = Math.max(
        particle.size / 10,
        (particle.size * CHECKPOINT_PULSE_RING_WIDTH_NUMERATOR) /
          CHECKPOINT_PULSE_RING_WIDTH_DENOMINATOR
      )
      const softEdge = Math.max(
        particle.size / 20,
        (ringWidth * CHECKPOINT_PULSE_SOFT_EDGE_NUMERATOR) /
          CHECKPOINT_PULSE_SOFT_EDGE_DENOMINATOR
      )
      const outerStartRadius = startRadius > ringWidth ? startRadius : ringWidth
      const ringOuterRadius = outerStartRadius + expandDistance * lifeRatio
      const ringWidthPx = Math.max(3, ringWidth * pixelsPerMeter)
      const softEdgePx = Math.max(2, softEdge * pixelsPerMeter)
      const ringOuterRadiusPx = ringOuterRadius * pixelsPerMeter
      const ringInnerRadiusPx = Math.max(0, ringOuterRadiusPx - ringWidthPx)
      const peakAlpha = alpha * 0.82
      const edgeAlpha = alpha * 0.28
      ctx.fillStyle = CHECKPOINT_PULSE_EDGE_COLOR
      ctx.globalAlpha = edgeAlpha
      this.fillCheckpointRing(
        ctx,
        px,
        py,
        ringInnerRadiusPx,
        ringOuterRadiusPx + softEdgePx * 2
      )
      ctx.fillStyle = CHECKPOINT_PULSE_MID_COLOR
      ctx.globalAlpha = peakAlpha * 0.7
      this.fillCheckpointRing(
        ctx,
        px,
        py,
        ringInnerRadiusPx,
        ringOuterRadiusPx + softEdgePx
      )
      ctx.fillStyle = CHECKPOINT_PULSE_CORE_COLOR
      ctx.globalAlpha = peakAlpha
      this.fillCheckpointRing(ctx, px, py, ringInnerRadiusPx, ringOuterRadiusPx)
    }

    ctx.globalCompositeOperation = savedComposite
    lastColor = ''

    // 血液和死亡粒子
    for (let i = 0; i < this.activeCount; i++) {
      const particle = this.active[i]
      if (
        particle.type !== PARTICLE_TYPE_BLOOD &&
        particle.type !== PARTICLE_TYPE_DEATH
      )
        continue

      const lifeRatio = particle.age / particle.life
      const alpha = 1 - lifeRatio
      let radius = particle.size * (0.4 + alpha * 0.6)
      if (particle.type === PARTICLE_TYPE_DEATH) {
        radius = particle.size * (1 - lifeRatio)
      }
      if (radius <= 0) continue

      const color = this.getColorString(particle.color)
      if (color !== lastColor) {
        ctx.fillStyle = color
        lastColor = color
      }
      ctx.globalAlpha = alpha
      ctx.beginPath()
      ctx.arc(
        particle.x * pixelsPerMeter,
        particle.y * pixelsPerMeter,
        radius * pixelsPerMeter,
        0,
        TWO_PI
      )
      ctx.fill()
    }

    ctx.globalAlpha = savedAlpha
  }

  spawnSpark(x: number, y: number, color: number): void {
    const count = 16
    for (let i = 0; i < count; i++) {
      const particle = this.acquire()
      if (!particle) return
      const angle = Math.random() * TWO_PI
      const speed = 5.5 + Math.random() * 4.5
      particle.x = x
      particle.y = y
      particle.prevX = x
      particle.prevY = y
      particle.vx = Math.cos(angle) * speed
      particle.vy = Math.sin(angle) * speed
      particle.age = 0
      particle.life = 0.18 + Math.random() * 0.22
      particle.size = 0.026 + Math.random() * 0.022
      particle.color = color
      particle.gravity = 10
      particle.drag = 8
      particle.type = PARTICLE_TYPE_SPARK
      particle.curve = (Math.random() * 2 - 1) * 2.5
      this.active[this.activeCount] = particle
      this.activeCount += 1
    }
  }

  spawnBlood(x: number, y: number, color: number): void {
    const count = 16
    for (let i = 0; i < count; i++) {
      const particle = this.acquire()
      if (!particle) return
      const angle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 0.9
      const speed = 2 + Math.random() * 4
      particle.x = x
      particle.y = y
      particle.prevX = x
      particle.prevY = y
      particle.vx = Math.cos(angle) * speed
      particle.vy = Math.sin(angle) * speed
      particle.age = 0
      particle.life = 0.5 + Math.random() * 0.5
      particle.size = 0.04 + Math.random() * 0.05
      particle.color = color
      particle.gravity = 50
      particle.drag = 1.2
      particle.type = PARTICLE_TYPE_BLOOD
      particle.curve = 0
      this.active[this.activeCount] = particle
      this.activeCount += 1
    }
  }

  spawnDeath(x: number, y: number, color: number, radius: number): void {
    if (radius <= 0) return
    const count = Math.min(160, Math.max(48, Math.floor(radius * 110 + 36)))
    for (let i = 0; i < count; i++) {
      const particle = this.acquire()
      if (!particle) return
      const angle = Math.random() * TWO_PI
      const dist = Math.sqrt(Math.random()) * radius
      const dirX = Math.cos(angle)
      const dirY = Math.sin(angle)
      const speed = 1.6 + Math.random() * 2.6
      particle.x = x + dirX * dist
      particle.y = y + dirY * dist
      particle.prevX = particle.x
      particle.prevY = particle.y
      particle.vx = dirX * speed + (Math.random() - 0.5) * 0.6
      particle.vy = dirY * speed + (Math.random() - 0.5) * 0.6
      particle.age = 0
      particle.life = 0.8 + Math.random() * 0.6
      particle.size = radius * (0.08 + Math.random() * 0.06)
      particle.color = color
      particle.gravity = 14
      particle.drag = 2.6
      particle.type = PARTICLE_TYPE_DEATH
      particle.curve = (Math.random() * 2 - 1) * 0.8
      this.active[this.activeCount] = particle
      this.activeCount += 1
    }
  }

  spawnHeal(x: number, y: number, color: number): void {
    const count = 20
    for (let i = 0; i < count; i++) {
      const particle = this.acquire()
      if (!particle) return
      const angle = (i / count) * TWO_PI + Math.random() * 0.4
      const dist = 1.0 + Math.random() * 0.8
      const dirX = Math.cos(angle)
      const dirY = Math.sin(angle)
      // 从外围向中心出发
      particle.x = x + dirX * dist
      particle.y = y + dirY * dist
      particle.prevX = particle.x
      particle.prevY = particle.y
      particle.vx = -dirX * (4 + Math.random() * 2)
      particle.vy = -dirY * (4 + Math.random() * 2)
      particle.age = 0
      particle.life = 0.4 + Math.random() * 0.1
      particle.size = 0.025 + Math.random() * 0.02
      particle.color = color
      particle.gravity = 0
      particle.drag = 6
      particle.type = PARTICLE_TYPE_HEAL
      particle.curve = 0
      this.active[this.activeCount] = particle
      this.activeCount += 1
    }
  }

  spawnCheckpointPulse(
    x: number,
    y: number,
    color: number,
    radius: number
  ): void {
    if (radius <= 0) return
    const particle = this.acquire()
    if (!particle) return
    particle.x = x
    particle.y = y
    particle.prevX = x
    particle.prevY = y
    particle.vx = 0
    particle.vy = 0
    particle.age = 0
    particle.life = 0.55
    particle.size = radius
    particle.color = color
    particle.gravity = 0
    particle.drag = 0
    particle.type = PARTICLE_TYPE_CHECKPOINT_PULSE
    particle.curve = 0
    this.active[this.activeCount] = particle
    this.activeCount += 1
  }

  private fillCheckpointRing(
    ctx: RenderContext2D,
    x: number,
    y: number,
    innerRadius: number,
    outerRadius: number
  ): void {
    if (!(outerRadius > 0) || outerRadius <= innerRadius) {
      return
    }
    if (ctx.fillRing) {
      ctx.fillRing(x, y, innerRadius, outerRadius)
      return
    }
    const centerRadius = (innerRadius + outerRadius) * 0.5
    const ringWidth = outerRadius - innerRadius
    ctx.strokeStyle = ctx.fillStyle
    ctx.lineWidth = ringWidth < 1 ? 1 : ringWidth
    ctx.beginPath()
    ctx.arc(x, y, centerRadius, 0, TWO_PI)
    ctx.stroke()
  }

  private acquire(): Particle | null {
    if (this.poolIndex === 0) return null
    this.poolIndex -= 1
    return this.pool[this.poolIndex]
  }

  private release(particle: Particle): void {
    this.pool[this.poolIndex] = particle
    this.poolIndex += 1
  }

  private getColorString(colorInt: number): string {
    const cached = this.colorCache.get(colorInt)
    if (cached) return cached
    const str = `#${colorInt.toString(16).padStart(6, '0')}`
    this.colorCache.set(colorInt, str)
    return str
  }
}
