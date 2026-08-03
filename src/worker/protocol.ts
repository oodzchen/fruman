import type {
  RenderComponent,
  TransformComponent,
  WeaponComponent,
} from '../ecs/Component'
import type { EditorMapData } from '../editorMapTypes'
import type { PlayerUpgradeStat } from '../playerUpgrade'
import type {
  SaveCheckpointState,
  SaveData,
  SaveGroundSunPickupState,
  SaveGroundWeaponState,
  SaveNpcState,
  SavePlayerState,
} from '../saveTypes'

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
    maxPosture: number
    posture: number
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
  mouseX: number
  mouseY: number
  mouseDeltaX: number
  mouseDeltaY: number
  mouseCaptured: boolean
}

export type WorkerMobileLockTargetMessage = {
  type: 'mobile_lock_target'
  targetId: number
}

export type WorkerMobileInteractTargetMessage = {
  type: 'mobile_interact_target'
  targetId: number
}

export type WorkerMobileRecoverMessage = {
  type: 'mobile_recover'
}

export type MobileGrapplePhase = 'press' | 'release' | 'cancel'

export type WorkerMobileGrappleTargetMessage = {
  type: 'mobile_grapple_target'
  targetId: number
  phase: MobileGrapplePhase
}

export type WorkerBufferReleaseMessage = {
  type: 'buffer_release'
  buffer: ArrayBuffer
}

export type WorkerControlMessage = {
  type: 'control'
  action:
    | 'stop'
    | 'start'
    | 'restart'
    | 'update_param'
    | 'clear_map_preview'
    | 'reload_default_map'
  paramId?: string
  value?: number
}

export type WorkerMapPreviewMessage = {
  type: 'map_preview'
  map: EditorMapData
  thumbnailCapture?: boolean
}

export type WorkerSaveRequestMessage = {
  type: 'save_request'
  saveId: string
}

export type WorkerLoadSaveMessage = {
  type: 'load_save'
  saveData: SaveData
}

export type WorkerAllocatePlayerUpgradeMessage = {
  type: 'allocate_player_upgrade'
  stat: PlayerUpgradeStat
}

export type WorkerResizeMessage = {
  type: 'resize'
  canvasWidth: number
  canvasHeight: number
}

export type MainToWorkerMessage =
  | WorkerInitMessage
  | WorkerInputMessage
  | WorkerMobileLockTargetMessage
  | WorkerMobileInteractTargetMessage
  | WorkerMobileRecoverMessage
  | WorkerMobileGrappleTargetMessage
  | WorkerBufferReleaseMessage
  | WorkerControlMessage
  | WorkerMapPreviewMessage
  | WorkerSaveRequestMessage
  | WorkerLoadSaveMessage
  | WorkerAllocatePlayerUpgradeMessage
  | WorkerResizeMessage

export type WorkerStateMessage = {
  type: 'state'
  entitiesBuffer: ArrayBuffer | SharedArrayBuffer
  entityCount: number
  effectsCount: number
  ropePointCount: number
  camera: { x: number; y: number }
  zoom: number
  timeScale1000: number
}

export type SensorDebugData = {
  entityId: number
  x: number
  y: number
  radius: number
  facing: number
  fov: number
  eyeX: number
  eyeY: number
  rays: Array<{
    startX: number
    startY: number
    endX: number
    endY: number
    hit: boolean
    hitX?: number
    hitY?: number
    isHostile: boolean
  }>
}

export type SoundWaveDebugData = {
  x: number
  y: number
  radius: number
  maxRadius: number
  db: number
}

export type SoundListenerDebugData = {
  entityId: number
  x: number
  y: number
  radius: number
}

export type CameraDebugData = {
  topLimitRatio: number
  bottomLimitRatio: number
  playerScreenY: number
  playerFeetY: number
  cameraY: number
  zoom: number
  isOutsideVerticalZone: boolean
}

export type SkeletalCollisionDebugData = {
  entityId: number
  polygons: number[][]
}

export type WorkerDebugMessage = {
  type: 'debug'
  sensors: SensorDebugData[]
  soundWaves: SoundWaveDebugData[]
  soundListeners: SoundListenerDebugData[]
  camera: CameraDebugData | null
  skeletalCollisions: SkeletalCollisionDebugData[]
}

export type WorkerMapDataMessage = {
  type: 'map_data'
  map: EditorMapData
  runtimeTerrainUpdate?: boolean
}

export type WorkerPerfSnapshotMessage = {
  type: 'perf_snapshot'
  updateAvgUs: number
  updateMaxUs: number
  fixedAvgUs: number
  fixedMaxUs: number
  fixedStepsAvg100: number
  fixedStepsMax: number
  spatialHashAvgUs: number
  worldUpdateAvgUs: number
  pickupCollectAvgUs: number
  pickupUpdateAvgUs: number
  cleanupAvgUs: number
  cameraAvgUs: number
  sendStateAvgUs: number
  entityCount: number
  breakableCrateCount: number
  breakableCrateAwakeCount: number
  breakableCratePlankCount: number
  systemNames: string[]
  systemAvgUs: number[]
  systemMaxUs: number[]
}

export type WorkerSaveResponseMessage = {
  type: 'save_response'
  saveId: string
  playTimeMs: number
  activeCheckpoint: SaveCheckpointState | null
  player: SavePlayerState
  npcs: SaveNpcState[]
  groundWeapons: SaveGroundWeaponState[]
  groundSunPickups: SaveGroundSunPickupState[]
  camera: { x: number; y: number; zoom: number }
}

export type WorkerCheckpointActivatedMessage = {
  type: 'checkpoint_activated'
}

export type WorkerCheckpointSleepMessage = {
  type: 'checkpoint_sleep'
}

export type WorkerPlayerDeadMessage = {
  type: 'player_dead'
}

export type WorkerPlayerLevelUpMessage = {
  type: 'player_level_up'
  previousLevel: number
  level: number
  pendingPoints: number
  previousMaxHealth: number
  currentMaxHealth: number
  attackLevel: number
  defenseLevel: number
  agilityLevel: number
  toughnessLevel: number
}

export type WorkerToMainMessage =
  | WorkerStateMessage
  | WorkerDebugMessage
  | WorkerMapDataMessage
  | WorkerPerfSnapshotMessage
  | WorkerSaveResponseMessage
  | WorkerCheckpointActivatedMessage
  | WorkerCheckpointSleepMessage
  | WorkerPlayerDeadMessage
  | WorkerPlayerLevelUpMessage
