const TWO_PI = Math.PI * 2

const PARTICLE_TYPE_SPARK = 0
const PARTICLE_TYPE_BLOOD = 1

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

  render(ctx: CanvasRenderingContext2D, pixelsPerMeter: number): void {
    if (this.activeCount === 0) return

    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    ctx.lineCap = 'round'
    for (let i = 0; i < this.activeCount; i++) {
      const particle = this.active[i]
      if (particle.type !== PARTICLE_TYPE_SPARK) continue
      const lifeRatio = particle.age / particle.life
      const alpha = 1 - lifeRatio
      const sizeScale = 1.8 - lifeRatio * 1.5
      const radius = particle.size * sizeScale
      const glowRadius = radius * (1.4 - lifeRatio * 0.4)
      const color = this.getColorString(particle.color)
      const px = particle.x * pixelsPerMeter
      const py = particle.y * pixelsPerMeter
      const trailAlpha = alpha * 0.6
      const trailSeconds = 0.05 + (1 - lifeRatio) * 0.07
      const tailX = particle.x - particle.vx * trailSeconds
      const tailY = particle.y - particle.vy * trailSeconds

      ctx.fillStyle = color
      ctx.strokeStyle = color

      ctx.globalAlpha = trailAlpha
      const trailWidth = radius * pixelsPerMeter * 0.65
      ctx.lineWidth = trailWidth < 1 ? 1 : trailWidth
      ctx.beginPath()
      ctx.moveTo(tailX * pixelsPerMeter, tailY * pixelsPerMeter)
      ctx.lineTo(px, py)
      ctx.stroke()

      ctx.globalAlpha = alpha * 0.45
      ctx.beginPath()
      ctx.arc(px, py, glowRadius * pixelsPerMeter, 0, TWO_PI)
      ctx.fill()

      const coreAlpha = alpha * 1.1
      ctx.globalAlpha = coreAlpha > 1 ? 1 : coreAlpha
      ctx.beginPath()
      ctx.arc(px, py, radius * pixelsPerMeter, 0, TWO_PI)
      ctx.fill()
    }
    ctx.restore()

    ctx.save()
    for (let i = 0; i < this.activeCount; i++) {
      const particle = this.active[i]
      if (particle.type !== PARTICLE_TYPE_BLOOD) continue
      const lifeRatio = particle.age / particle.life
      const alpha = 1 - lifeRatio
      const radius = particle.size * (0.4 + alpha * 0.6)
      ctx.globalAlpha = alpha
      ctx.fillStyle = this.getColorString(particle.color)
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
    ctx.restore()
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
