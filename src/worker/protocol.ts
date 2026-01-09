import type { StatsComponent, WeaponComponent, RenderComponent, TransformComponent, MovementComponent, InputComponent } from '../ecs/Component'

export type RenderEntity = {
  id: number
  transform: TransformComponent
  render: RenderComponent
  weapon?: {
    visual: WeaponComponent['visual']
    width: number
    height: number
    cornerRadius: number
    isEquipped: boolean
  }
  stats?: {
    health: number
    maxHealth: number
    maxToughness: number
    toughness: number
    isDead: boolean
    isVanished: boolean
    deathElapsedSec: number
    deathFlashDurationSec: number
    deathFlattenDurationSec: number
    hitShakeDurationMs: number
    hitShakeElapsedMs: number
    hitShakeIntensity: number
    hitShakeDirectionX: number
  }
  input?: {
    lastMoveDirection: number
    lockedTargetId: number | null
  }
  movement?: {
    isRolling: boolean
    rollAngle: number
  }
}

export type WorkerInitMessage = {
  type: 'init'
  canvasWidth: number
  canvasHeight: number
  pixelsPerMeter: number
}

export type WorkerInputMessage = {
  type: 'input'
  keys: string[] // Active keys
  mouseZoom: number // Target zoom
}

export type WorkerControlMessage = {
  type: 'control'
  action: 'stop' | 'start' | 'restart' | 'update_param'
  paramId?: string
  value?: number
}

export type MainToWorkerMessage = WorkerInitMessage | WorkerInputMessage | WorkerControlMessage

export type WorkerStateMessage = {
  type: 'state'
  entities: RenderEntity[]
  camera: { x: number; y: number }
}

export type WorkerToMainMessage = WorkerStateMessage
