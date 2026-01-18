import { DEFAULT_GRAVITY } from './constants'

export const BOW_GRAVITY_SCALE = 0.5
export const BOW_MIN_FORCE_RATIO = 0.6
export const BOW_MIN_SPEED = 10
export const BOW_MAX_SPEED = 22
export const BOW_MIN_WINDUP_MS = 200
export const BOW_MAX_DRAW_MS = 900

export interface TrajectoryPoint {
  x: number
  y: number
  vx: number
  vy: number
  t: number
}

export class BowTrajectoryCalculator {
  private gravity: number

  constructor() {
    this.gravity = DEFAULT_GRAVITY * BOW_GRAVITY_SCALE
  }

  getBowSpeed(drawRatio: number): number {
    const clampedRatio = Math.max(
      BOW_MIN_FORCE_RATIO,
      Math.min(1, drawRatio || BOW_MIN_FORCE_RATIO)
    )
    return BOW_MIN_SPEED + (BOW_MAX_SPEED - BOW_MIN_SPEED) * clampedRatio
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
  ): TrajectoryPoint[] {
    const dx = targetX - startX
    const dyUp = startY - targetY

    const angle = this.calculateLaunchAngle(dx, dyUp, speed)
    const vx0 = Math.cos(angle) * speed
    const vy0 = Math.sin(angle) * speed

    const points: TrajectoryPoint[] = []
    let t = 0

    while (t <= maxTime) {
      const x = startX + vx0 * t
      const y = startY + vy0 * t + 0.5 * this.gravity * t * t
      const vx = vx0
      const vy = vy0 + this.gravity * t

      points.push({ x, y, vx, vy, t })

      if (y > startY + 20) {
        break
      }

      t += timeStep
    }

    return points
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
    const points = this.simulateTrajectory(
      startX,
      startY,
      targetX,
      targetY,
      speed,
      5,
      0.016
    )

    for (const point of points) {
      const outsideLeft = point.x < viewLeft
      const outsideRight = point.x > viewRight
      const outsideTop = point.y < viewTop
      const outsideBottom = point.y > viewBottom

      if (outsideLeft || outsideRight || outsideTop || outsideBottom) {
        const clampedX = Math.max(viewLeft, Math.min(viewRight, point.x))
        const clampedY = Math.max(viewTop, Math.min(viewBottom, point.y))
        return { x: clampedX, y: clampedY }
      }
    }

    return null
  }
}
