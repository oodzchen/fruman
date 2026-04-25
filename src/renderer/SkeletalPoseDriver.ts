import { Physics, type Skeleton } from '@esotericsoftware/spine-core'

import { OFFSETS } from '../worker/binaryProtocol'

// SIN LUT: 1000 entries, amplitude 100, integers only
const SIN_LUT = new Int16Array(1000)
for (let i = 0; i < 1000; i++) {
  SIN_LUT[i] = Math.round(Math.sin((i / 1000) * Math.PI * 2) * 100)
}

export interface GaitState {
  phaseInt: number
  footLX: number
  footLY: number
  footRX: number
  footRY: number
}

export interface SkeletalPoseInput {
  entityX: number
  entityY: number
  weaponActive: boolean
  weaponX: number
  weaponY: number
  moveDir: number
  facing: number
  ppm: number
  deltaMsInt: number
  phaseInt?: number
}

const gaitPool: GaitState[] = []

export function acquireGaitState(): GaitState {
  const state = gaitPool.pop() ?? {
    phaseInt: 0,
    footLX: 0,
    footLY: 0,
    footRX: 0,
    footRY: 0,
  }
  resetGaitState(state)
  return state
}

export function resetGaitState(state: GaitState): void {
  state.phaseInt = 0
  state.footLX = 0
  state.footLY = 0
  state.footRX = 0
  state.footRY = 0
}

export function releaseGaitState(state: GaitState): void {
  gaitPool.push(state)
}

// Step speed: phases advanced per millisecond at moveDir=±1
const STEP_SPEED = 1 // 1000 phases = 1 second per full cycle
const STEP_HALF_WIDTH_RATIO = 0.3 // fraction of arm-reach used as step half-width
const LIFT_HEIGHT_RATIO = 0.4 // fraction of step-half-width lifted
// resting hand position offset from shoulder (body-local units)
const REST_HAND_OFFSET_Y = 30 // pixels below shoulder

export function updateSkeletalPose(
  skeleton: Skeleton,
  boneIndex: ReadonlyMap<string, number>,
  gait: GaitState,
  buf: Float32Array,
  offset: number,
  facing: number,
  ppm: number,
  deltaMsInt: number
): void {
  updateSkeletalPoseFromInput(skeleton, boneIndex, gait, {
    entityX: buf[offset + OFFSETS.X],
    entityY: buf[offset + OFFSETS.Y],
    weaponActive: buf[offset + OFFSETS.WEAPON_ACTIVE] === 1,
    weaponX: buf[offset + OFFSETS.WEAPON_X],
    weaponY: buf[offset + OFFSETS.WEAPON_Y],
    moveDir: buf[offset + OFFSETS.MOVE_DIR] | 0,
    facing,
    ppm,
    deltaMsInt,
    phaseInt: buf[offset + OFFSETS.SKELETAL_GAIT_PHASE] | 0,
  })
}

export function updateSkeletalPoseFromInput(
  skeleton: Skeleton,
  boneIndex: ReadonlyMap<string, number>,
  gait: GaitState,
  input: SkeletalPoseInput
): void {
  const bones = skeleton.bones

  const entityX = input.entityX
  const entityY = input.entityY
  const weaponActive = input.weaponActive
  const weaponX = input.weaponX
  const weaponY = input.weaponY
  const moveDir = input.moveDir | 0
  const facing = input.facing
  const ppm = input.ppm
  const deltaMsInt = input.deltaMsInt | 0
  const facingSign = facing < 0 ? -1 : 1
  const poseMoveDir = moveDir * facingSign

  // -- HAND IK --
  // Weapon grip converted from world-facing space into unflipped skeleton space.
  const weaponLocalX = Math.round((weaponX - entityX) * ppm) * facingSign
  const weaponLocalY = Math.round((weaponY - entityY) * ppm)

  const handTRIdx = boneIndex.get('handTarget_R')!
  const handTLIdx = boneIndex.get('handTarget_L')!
  const handTR = bones[handTRIdx]
  const handTL = bones[handTLIdx]

  // shoulder world-y reference for resting hand
  const shoulderRIdx = boneIndex.get('shoulder_R')
  const shoulderLIdx = boneIndex.get('shoulder_L')
  const restY =
    shoulderRIdx !== undefined
      ? bones[shoulderRIdx].worldY + REST_HAND_OFFSET_Y
      : weaponLocalY

  if (weaponActive) {
    handTR.x = weaponLocalX
    handTR.y = weaponLocalY
    if (shoulderLIdx !== undefined) {
      const sl = bones[shoulderLIdx]
      handTL.x = sl.worldX - REST_HAND_OFFSET_Y
      handTL.y = restY
    }
  } else {
    // no weapon: both arms in relaxed position at sides
    if (shoulderRIdx !== undefined && shoulderLIdx !== undefined) {
      const sr = bones[shoulderRIdx]
      const sl = bones[shoulderLIdx]
      handTR.x = sr.worldX
      handTR.y = restY
      handTL.x = sl.worldX
      handTL.y = restY
    }
  }

  // -- LEG GAIT --
  const footTRIdx = boneIndex.get('footTarget_R')!
  const footTLIdx = boneIndex.get('footTarget_L')!
  const footTR = bones[footTRIdx]
  const footTL = bones[footTLIdx]

  // step dimensions derived from thigh length
  const thighIdx = boneIndex.get('thigh_R')
  const stepHalfWidth =
    thighIdx !== undefined
      ? Math.round(skeleton.data.bones[thighIdx].length * STEP_HALF_WIDTH_RATIO)
      : Math.round(ppm * 0.08)
  const liftHeight = Math.round(stepHalfWidth * LIFT_HEIGHT_RATIO)

  // ground Y reference: hip position + full leg length
  const hipRIdx = boneIndex.get('hip_R')
  const groundY =
    hipRIdx !== undefined
      ? Math.round(
          bones[hipRIdx].worldY +
            skeleton.data.bones[boneIndex.get('thigh_R')!].length +
            skeleton.data.bones[boneIndex.get('lowerLeg_R')!].length
        )
      : Math.round(ppm * 0.25)

  const hipRX =
    hipRIdx !== undefined ? Math.round(bones[hipRIdx].worldX) : stepHalfWidth
  const hipLX =
    boneIndex.get('hip_L') !== undefined
      ? Math.round(bones[boneIndex.get('hip_L')!].worldX)
      : -stepHalfWidth

  if (input.phaseInt !== undefined) {
    gait.phaseInt = Math.max(0, input.phaseInt | 0) % 1000
  } else if (moveDir !== 0) {
    gait.phaseInt = (gait.phaseInt + deltaMsInt * STEP_SPEED) % 1000
  }

  const phaseR = gait.phaseInt
  const phaseL = (gait.phaseInt + 500) % 1000

  const sinR = SIN_LUT[phaseR]
  const sinL = SIN_LUT[phaseL]

  if (moveDir === 0) {
    footTR.x = hipRX
    footTR.y = groundY
    footTL.x = hipLX
    footTL.y = groundY
  } else {
    footTR.x = hipRX + (sinR * stepHalfWidth * poseMoveDir) / 100
    footTR.y = groundY - (sinR > 0 ? (sinR * liftHeight) / 100 : 0)

    footTL.x = hipLX + (sinL * stepHalfWidth * poseMoveDir) / 100
    footTL.y = groundY - (sinL > 0 ? (sinL * liftHeight) / 100 : 0)
  }

  skeleton.updateWorldTransform(Physics.none)
}
