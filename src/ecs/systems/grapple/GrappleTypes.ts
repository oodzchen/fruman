import type { b2BodyId, b2JointId } from '../../../types'

export type RopeHitWeaponState = {
  hitRopeIds: Set<number>
  groundHitSoundTriggered: boolean
  groundHitSoundPending: number
}

export type RopeHitRequest = {
  centerX: number
  centerY: number
  width: number
  height: number
  rotation: number
  renderLayer: number
  impactX: number
  impactY: number
  damage: number
  hitDirX?: number
  hitDirY?: number
  weapon?: RopeHitWeaponState
}

export type RopeCircleHitRequest = {
  centerX: number
  centerY: number
  radius: number
  renderLayer: number
  impactX: number
  impactY: number
  damage: number
  hitDirX?: number
  hitDirY?: number
  weapon?: RopeHitWeaponState
}

export const enum GrapplePullMode {
  Anchor = 0,
  Npc = 1,
  PlayerLinear = 2,
  PlayerArc = 3,
  AnchorTether = 4,
  Object = 5,
}

export const enum PlayerTetherState {
  Airborne = 0,
  GroundFollow = 1,
  Suspended = 2,
}

export const enum GrappleFrameState {
  Unavailable = 0,
  Interrupted = 1,
  BreakRequested = 2,
  RopeClimb = 3,
  ActiveTetherAction = 4,
  ActivePull = 5,
  Idle = 6,
  Cooldown = 7,
  StartAction = 8,
}

export type RopeRuntime = {
  active: boolean
  ownerEntityId: number
  hitId: number
  health: number
  hitShakeSegmentIndex: number
  hitShakeStartTimeMs: number
  hitShakeEndTimeMs: number
  hitShakeDirX: number
  hitShakeDirY: number
  renderLayer: number
  anchorBodyId: b2BodyId | null
  anchorBodyOwned: boolean
  anchorIsDynamicTarget: boolean
  anchorEntityId: number
  anchorLocalX: number
  anchorLocalY: number
  playerAnchorBodyId: b2BodyId | null
  playerAttached: boolean
  playerTetherState: PlayerTetherState
  playerGroundJumpActive: boolean
  airJumpDetachArmed: boolean
  pendingPlayerVelocityTransfer: boolean
  lastSwingInputDirection: number
  anchorFollowX: number
  anchorFollowY: number
  playerFollowX: number
  playerFollowY: number
  segmentCount: number
  linkLength: number
  attachIndex: number
  playerJointId: b2JointId | null
  segmentBodies: b2BodyId[]
  segmentJoints: b2JointId[]
  segmentFilterJoints: b2JointId[]
  jointMaxLen: number
  maxRopeLength: number
}

export type RopeEndpointBuild = {
  entityId: number
  bodyId: b2BodyId | null
  bodyOwned: boolean
  localX: number
  localY: number
  x: number
  y: number
  renderLayer: number
  hasDynamicBody: boolean
}

export type RopeBridgeRuntime = {
  active: boolean
  hitId: number
  health: number
  hitShakeSegmentIndex: number
  hitShakeStartTimeMs: number
  hitShakeEndTimeMs: number
  hitShakeDirX: number
  hitShakeDirY: number
  endpointAEntityId: number
  endpointBEntityId: number
  bodyAId: b2BodyId | null
  bodyAOwned: boolean
  bodyBId: b2BodyId | null
  bodyBOwned: boolean
  targetABodyId: b2BodyId | null
  targetBBodyId: b2BodyId | null
  endpointAHasDynamicBody: boolean
  endpointBHasDynamicBody: boolean
  localAX: number
  localAY: number
  localBX: number
  localBY: number
  followAX: number
  followAY: number
  followBX: number
  followBY: number
  renderLayer: number
  segmentCount: number
  linkLength: number
  maxRopeLength: number
  segmentBodies: b2BodyId[]
  segmentJoints: b2JointId[]
  segmentFilterJoints: b2JointId[]
  climbTuningActive: boolean
}

export type RopeClimbRuntime = {
  active: boolean
  sourceType: number
  ownerEntityId: number
  playerRuntime: RopeRuntime | null
  bridgeRuntime: RopeBridgeRuntime | null
  bridgeHitId: number
  nodeIndex: number
  maxNodeIndex: number
  pathDistance: number
  normalOffset: number
  jointLength: number
  travelRemainder: number
  lastMoveStep: number
  jointId: b2JointId | null
}
