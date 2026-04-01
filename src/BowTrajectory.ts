import {
  BOW_GRAVITY_SCALE,
  BOW_MAX_SPEED,
  BOW_MIN_FORCE_RATIO,
  BOW_MIN_SPEED,
  DEFAULT_GRAVITY,
} from './constants'

export interface TrajectoryPoint {
  x: number
  y: number
  vx: number
  vy: number
  t: number
}

export class BowTrajectoryCalculator {
  private gravity: number
  private pointBuffer: TrajectoryPoint[] = []
  private pointCount = 0
  private readonly MAX_POINTS = 350 // ~5.6s at 60fps
  private intersectionPoint = { x: 0, y: 0 }
  private clipT0 = 0
  private clipT1 = 1

  constructor() {
    this.gravity = DEFAULT_GRAVITY * BOW_GRAVITY_SCALE
    for (let i = 0; i < this.MAX_POINTS; i++) {
      this.pointBuffer.push({ x: 0, y: 0, vx: 0, vy: 0, t: 0 })
    }
  }

  setGravityScale(gravityScale: number): void {
    this.gravity = DEFAULT_GRAVITY * gravityScale
  }

  getLaunchSpeed(
    drawRatio: number,
    minSpeed: number,
    maxSpeed: number
  ): number {
    const clampedRatio = Math.max(0, Math.min(1, drawRatio ?? 0))
    return minSpeed + (maxSpeed - minSpeed) * clampedRatio
  }

  getBowSpeed(drawRatio: number): number {
    return this.getLaunchSpeed(drawRatio, BOW_MIN_SPEED, BOW_MAX_SPEED)
  }

  calculateLaunchAngle(dx: number, dyUp: number, speed: number): number {
    const dxAbs = Math.abs(dx)
    if (dxAbs < 0.001) {
      return dyUp >= 0 ? -Math.PI / 2 : Math.PI / 2
    }

    const v2 = speed * speed
    const disc =
      v2 * v2 - this.gravity * (this.gravity * dxAbs * dxAbs + 2 * dyUp * v2)
    if (disc < 0) {
      return -Math.atan2(dyUp, dx)
    }

    const sqrtDisc = Math.sqrt(disc)
    const tan = (v2 - sqrtDisc) / (this.gravity * dxAbs)
    let angle = Math.atan(tan)
    if (dx < 0) {
      angle = Math.PI - angle
    }
    return -angle
  }

  simulateTrajectory(
    startX: number,
    startY: number,
    targetX: number,
    targetY: number,
    speed: number,
    maxTime: number = 5,
    timeStep: number = 0.016
  ): void {
    const dx = targetX - startX
    const dyUp = startY - targetY

    const angle = this.calculateLaunchAngle(dx, dyUp, speed)
    const vx0 = Math.cos(angle) * speed
    const vy0 = Math.sin(angle) * speed

    this.pointCount = 0
    let t = 0

    while (t <= maxTime && this.pointCount < this.MAX_POINTS) {
      const x = startX + vx0 * t
      const y = startY + vy0 * t + 0.5 * this.gravity * t * t
      const vx = vx0
      const vy = vy0 + this.gravity * t

      const point = this.pointBuffer[this.pointCount]
      point.x = x
      point.y = y
      point.vx = vx
      point.vy = vy
      point.t = t
      this.pointCount++

      if (y > startY + 20) {
        break
      }

      t += timeStep
    }
  }

  getPoints(): TrajectoryPoint[] {
    return this.pointBuffer
  }

  getPointCount(): number {
    return this.pointCount
  }

  findViewportIntersection(
    startX: number,
    startY: number,
    targetX: number,
    targetY: number,
    speed: number,
    viewLeft: number,
    viewRight: number,
    viewTop: number,
    viewBottom: number
  ): { x: number; y: number } | null {
    this.simulateTrajectory(startX, startY, targetX, targetY, speed, 5, 0.016)

    const points = this.pointBuffer
    const count = this.pointCount

    for (let i = 1; i < count; i++) {
      const prev = points[i - 1]
      const curr = points[i]
      const prevInside =
        prev.x >= viewLeft &&
        prev.x <= viewRight &&
        prev.y >= viewTop &&
        prev.y <= viewBottom
      const currInside =
        curr.x >= viewLeft &&
        curr.x <= viewRight &&
        curr.y >= viewTop &&
        curr.y <= viewBottom

      if (currInside) continue
      if (!prevInside && !currInside) continue

      if (
        this.intersectSegmentRect(
          prev.x,
          prev.y,
          curr.x,
          curr.y,
          viewLeft,
          viewRight,
          viewTop,
          viewBottom,
          prevInside,
          this.intersectionPoint
        )
      ) {
        return this.intersectionPoint
      }
    }

    return null
  }

  private intersectSegmentRect(
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    left: number,
    right: number,
    top: number,
    bottom: number,
    startInside: boolean,
    out: { x: number; y: number }
  ): boolean {
    const dx = x1 - x0
    const dy = y1 - y0
    this.clipT0 = 0
    this.clipT1 = 1

    if (
      !this.clipSegment(-dx, x0 - left) ||
      !this.clipSegment(dx, right - x0) ||
      !this.clipSegment(-dy, y0 - top) ||
      !this.clipSegment(dy, bottom - y0)
    ) {
      return false
    }

    const t = startInside ? this.clipT1 : this.clipT0
    out.x = x0 + dx * t
    out.y = y0 + dy * t
    return true
  }

  private clipSegment(p: number, q: number): boolean {
    if (p === 0) {
      return q >= 0
    }

    const r = q / p
    if (p < 0) {
      if (r > this.clipT1) return false
      if (r > this.clipT0) this.clipT0 = r
    } else {
      if (r < this.clipT0) return false
      if (r < this.clipT1) this.clipT1 = r
    }
    return true
  }
}
