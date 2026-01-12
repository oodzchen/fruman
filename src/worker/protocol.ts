import type {
  RenderComponent,
  TransformComponent,
  WeaponComponent,
} from '../ecs/Component'

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
  mouseButtons: number[] // Active mouse buttons (0=Left, 2=Right)
  mouseZoom: number // Target zoom
}

export type WorkerBufferReleaseMessage = {
  type: 'buffer_release'
  buffer: ArrayBuffer
}

export type WorkerControlMessage = {
  type: 'control'
  action: 'stop' | 'start' | 'restart' | 'update_param'
  paramId?: string
  value?: number
}

export type MainToWorkerMessage =
  | WorkerInitMessage
  | WorkerInputMessage
  | WorkerBufferReleaseMessage
  | WorkerControlMessage

export type WorkerStateMessage = {
  type: 'state'
  entitiesBuffer: ArrayBuffer | SharedArrayBuffer
  entityCount: number
  effectsCount: number
  camera: { x: number; y: number }
}

export type WorkerToMainMessage = WorkerStateMessage
