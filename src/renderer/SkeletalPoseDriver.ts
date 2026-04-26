import { Physics, type Skeleton } from '@esotericsoftware/spine-core'

import type { SkeletalAnimationName } from '../skeletalAnimation'
import { OFFSETS } from '../worker/binaryProtocol'

// SIN LUT: 1000 entries, amplitude 100, integers only
const SIN_LUT = new Int16Array(1000)
for (let i = 0; i < 1000; i++) {
  SIN_LUT[i] = Math.round(Math.sin((i / 1000) * Math.PI * 2) * 100)
}

export interface GaitState {
  activeAnimation: SkeletalAnimationName
  animationElapsedMs: number
  phaseInt: number
  footLX: number
  footLY: number
  footRX: number
  footRY: number
}

export interface SkeletalPoseInput {
  entityX: number
  entityY: number
  animationName: SkeletalAnimationName
  combatReady: boolean
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
    activeAnimation: 'idle',
    animationElapsedMs: 0,
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
  state.activeAnimation = 'idle'
  state.animationElapsedMs = 0
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
const RUN_STEP_SPEED = 2
const STEP_HALF_WIDTH_RATIO = 0.3 // fraction of arm-reach used as step half-width
const LIFT_HEIGHT_RATIO = 0.4 // fraction of step-half-width lifted
// resting hand position offset from shoulder (body-local units)
const REST_HAND_OFFSET_Y = 30 // pixels below shoulder
const IDLE_SWAY_CYCLE_MS = 1800
const BODY_IDLE_BOB_PX = 4
const BODY_MOVE_BOB_PX = 6
const BODY_RUN_BOB_PX = 9
const BODY_JUMP_LIFT_PX = 16
const BODY_ROLL_DROP_PX = 12
const BODY_COLLAPSE_DROP_PX = 20
const BODY_STAGGER_DROP_PX = 6
const BODY_IDLE_ROTATION_DEG = 2
const BODY_MOVE_ROTATION_DEG = 4
const BODY_RUN_ROTATION_DEG = 7
const BODY_STAGGER_ROTATION_DEG = 12
const BODY_COLLAPSE_ROTATION_DEG = 84
const HEAD_IDLE_ROTATION_DEG = 5
const HEAD_STAGGER_ROTATION_DEG = 14
const HEAD_COLLAPSE_ROTATION_DEG = 28
const ARM_IDLE_SWAY_PX = 7
const ARM_JUMP_RAISE_PX = 28
const ARM_STAGGER_SWAY_PX = 20
const ARM_ROLL_TUCK_PX = 14
const ARM_COLLAPSE_TUCK_PX = 16
const JUMP_FOOT_LIFT_NUMERATOR = 19
const JUMP_FOOT_LIFT_DENOMINATOR = 10
const ROLL_FOOT_LIFT_NUMERATOR = 7
const ROLL_FOOT_LIFT_DENOMINATOR = 10
const STAGGER_FOOT_LIFT_NUMERATOR = 3
const STAGGER_FOOT_LIFT_DENOMINATOR = 5
const COLLAPSE_FOOT_LIFT_NUMERATOR = 4
const COLLAPSE_FOOT_LIFT_DENOMINATOR = 5
const ROLL_DURATION_MS = 520
const STAGGER_DURATION_MS = 720
const COLLAPSE_DURATION_MS = 760

export function updateSkeletalPose(
  skeleton: Skeleton,
  boneIndex: ReadonlyMap<string, number>,
  gait: GaitState,
  animationName: SkeletalAnimationName,
  buf: Float32Array,
  offset: number,
  moveDir: number,
  facing: number,
  ppm: number,
  deltaMsInt: number
): void {
  updateSkeletalPoseFromInput(skeleton, boneIndex, gait, {
    entityX: buf[offset + OFFSETS.X],
    entityY: buf[offset + OFFSETS.Y],
    animationName,
    combatReady: buf[offset + OFFSETS.MOTION_IS_COMBAT_READY] === 1,
    weaponActive: buf[offset + OFFSETS.WEAPON_ACTIVE] === 1,
    weaponX: buf[offset + OFFSETS.WEAPON_X],
    weaponY: buf[offset + OFFSETS.WEAPON_Y],
    moveDir,
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
  const animationName = input.animationName
  const combatReady = input.combatReady
  const weaponActive = input.weaponActive
  const weaponX = input.weaponX
  const weaponY = input.weaponY
  const moveDir = input.moveDir | 0
  const facing = input.facing
  const ppm = input.ppm
  const deltaMsInt = input.deltaMsInt | 0
  const facingSign = facing < 0 ? -1 : 1
  const poseMoveDir = moveDir * facingSign
  const moveStepDir = poseMoveDir === 0 ? facingSign : poseMoveDir
  const footForwardDir = 1

  if (gait.activeAnimation !== animationName) {
    gait.activeAnimation = animationName
    gait.animationElapsedMs = 0
  } else if (deltaMsInt > 0) {
    gait.animationElapsedMs += deltaMsInt
  }

  const bodyIdx = boneIndex.get('body')
  const headIdx = boneIndex.get('head')
  const shoulderRIdx = boneIndex.get('shoulder_R')
  const shoulderLIdx = boneIndex.get('shoulder_L')
  const upperArmRIdx = boneIndex.get('upperArm_R')
  const upperArmLIdx = boneIndex.get('upperArm_L')
  const forearmRIdx = boneIndex.get('forearm_R')
  const forearmLIdx = boneIndex.get('forearm_L')
  const hipRIdx = boneIndex.get('hip_R')
  const hipLIdx = boneIndex.get('hip_L')
  const thighRIdx = boneIndex.get('thigh_R')
  const lowerLegRIdx = boneIndex.get('lowerLeg_R')
  const footRIdx = boneIndex.get('foot_R')
  const footLIdx = boneIndex.get('foot_L')
  const body = bodyIdx !== undefined ? bones[bodyIdx] : null
  const head = headIdx !== undefined ? bones[headIdx] : null
  const shoulderR = shoulderRIdx !== undefined ? bones[shoulderRIdx] : null
  const shoulderL = shoulderLIdx !== undefined ? bones[shoulderLIdx] : null
  const hipR = hipRIdx !== undefined ? bones[hipRIdx] : null
  const hipL = hipLIdx !== undefined ? bones[hipLIdx] : null
  const footR = footRIdx !== undefined ? bones[footRIdx] : null
  const footL = footLIdx !== undefined ? bones[footLIdx] : null

  if (body) {
    resetBoneTransform(body)
  }
  if (head) {
    resetBoneTransform(head)
  }
  if (shoulderR) {
    resetBoneTransform(shoulderR)
  }
  if (shoulderL) {
    resetBoneTransform(shoulderL)
  }
  if (hipR) {
    resetBoneTransform(hipR)
  }
  if (hipL) {
    resetBoneTransform(hipL)
  }

  let bodyYOffset = 0
  let bodyRotationDeg = 0
  let headRotationDeg = 0
  let idleArmSwing = 0

  if (animationName === 'move' || animationName === 'run') {
    const stepSpeed = animationName === 'run' ? RUN_STEP_SPEED : STEP_SPEED
    if (input.phaseInt !== undefined) {
      gait.phaseInt = Math.max(0, input.phaseInt | 0) % 1000
    } else {
      gait.phaseInt = (gait.phaseInt + deltaMsInt * stepSpeed) % 1000
    }
    const stepSin = sampleSine100(gait.phaseInt)
    bodyYOffset = -Math.max(
      0,
      (stepSin *
        (animationName === 'run' ? BODY_RUN_BOB_PX : BODY_MOVE_BOB_PX)) /
        100
    )
    bodyRotationDeg =
      (stepSin *
        moveStepDir *
        (animationName === 'run'
          ? BODY_RUN_ROTATION_DEG
          : BODY_MOVE_ROTATION_DEG)) /
      100
  } else {
    gait.phaseInt = 0
    const swaySin = sampleAnimationSine100(
      gait.animationElapsedMs,
      animationName === 'roll'
        ? ROLL_DURATION_MS
        : animationName === 'stagger'
          ? STAGGER_DURATION_MS
          : IDLE_SWAY_CYCLE_MS
    )
    if (animationName === 'idle') {
      bodyYOffset = -(Math.abs(swaySin) * BODY_IDLE_BOB_PX) / 100
      bodyRotationDeg = (swaySin * BODY_IDLE_ROTATION_DEG) / 100
      headRotationDeg = (-swaySin * HEAD_IDLE_ROTATION_DEG) / 100
      idleArmSwing = (swaySin * ARM_IDLE_SWAY_PX) / 100
    } else if (animationName === 'jump') {
      bodyYOffset = -BODY_JUMP_LIFT_PX
      bodyRotationDeg = -(moveStepDir * BODY_MOVE_ROTATION_DEG)
      headRotationDeg = moveStepDir * HEAD_IDLE_ROTATION_DEG
    } else if (animationName === 'roll') {
      bodyYOffset = BODY_ROLL_DROP_PX
      bodyRotationDeg = moveStepDir * 78
      headRotationDeg = -moveStepDir * 22
    } else if (animationName === 'stagger') {
      bodyYOffset = BODY_STAGGER_DROP_PX
      bodyRotationDeg = -moveStepDir * BODY_STAGGER_ROTATION_DEG
      headRotationDeg = -moveStepDir * HEAD_STAGGER_ROTATION_DEG
      idleArmSwing = moveStepDir * ARM_STAGGER_SWAY_PX
    } else if (animationName === 'collapse') {
      const collapseProgress = Math.min(
        100,
        Math.max(
          0,
          Math.floor((gait.animationElapsedMs * 100) / COLLAPSE_DURATION_MS)
        )
      )
      bodyYOffset = (BODY_COLLAPSE_DROP_PX * collapseProgress) / 100
      bodyRotationDeg =
        (moveStepDir * BODY_COLLAPSE_ROTATION_DEG * collapseProgress) / 100
      headRotationDeg =
        (-moveStepDir * HEAD_COLLAPSE_ROTATION_DEG * collapseProgress) / 100
      idleArmSwing =
        (moveStepDir * ARM_COLLAPSE_TUCK_PX * collapseProgress) / 100
    }
  }

  if (body) {
    body.y = body.data.y + bodyYOffset
    body.rotation = body.data.rotation + bodyRotationDeg
  }
  if (head) {
    head.rotation = head.data.rotation + headRotationDeg
  }

  skeleton.updateWorldTransform(Physics.none)

  // -- HAND IK --
  // Weapon grip converted from world-facing space into unflipped skeleton space.
  const weaponLocalX = Math.round((weaponX - entityX) * ppm) * facingSign
  const weaponLocalY = Math.round((weaponY - entityY) * ppm)

  const handTRIdx = boneIndex.get('handTarget_R')!
  const handTLIdx = boneIndex.get('handTarget_L')!
  const handTR = bones[handTRIdx]
  const handTL = bones[handTLIdx]

  // shoulder world-y reference for resting hand
  const restY =
    shoulderR !== null
      ? shoulderR.worldY +
        getRelaxedArmReachPx(skeleton, upperArmRIdx, forearmRIdx)
      : weaponLocalY
  const restLeftY =
    shoulderL !== null
      ? shoulderL.worldY +
        getRelaxedArmReachPx(skeleton, upperArmLIdx, forearmLIdx)
      : restY

  if (animationName === 'jump') {
    if (shoulderR && shoulderL) {
      handTR.x = shoulderR.worldX + moveStepDir * ARM_IDLE_SWAY_PX
      handTR.y = shoulderR.worldY - ARM_JUMP_RAISE_PX
      handTL.x = shoulderL.worldX - moveStepDir * ARM_IDLE_SWAY_PX
      handTL.y = shoulderL.worldY - ARM_JUMP_RAISE_PX
    }
  } else if (animationName === 'roll') {
    if (shoulderR && shoulderL) {
      handTR.x = shoulderR.worldX + moveStepDir * ARM_ROLL_TUCK_PX
      handTR.y = shoulderR.worldY + ARM_ROLL_TUCK_PX
      handTL.x = shoulderL.worldX - moveStepDir * ARM_ROLL_TUCK_PX
      handTL.y = shoulderL.worldY + ARM_ROLL_TUCK_PX
    }
  } else if (animationName === 'stagger') {
    if (shoulderR && shoulderL) {
      handTR.x = shoulderR.worldX + idleArmSwing
      handTR.y = shoulderR.worldY + REST_HAND_OFFSET_Y - ARM_STAGGER_SWAY_PX
      handTL.x = shoulderL.worldX - idleArmSwing
      handTL.y = shoulderL.worldY + REST_HAND_OFFSET_Y + ARM_STAGGER_SWAY_PX
    }
  } else if (animationName === 'collapse') {
    if (shoulderR && shoulderL) {
      handTR.x = shoulderR.worldX + idleArmSwing
      handTR.y = shoulderR.worldY + REST_HAND_OFFSET_Y + ARM_COLLAPSE_TUCK_PX
      handTL.x = shoulderL.worldX - idleArmSwing
      handTL.y = shoulderL.worldY + REST_HAND_OFFSET_Y + ARM_COLLAPSE_TUCK_PX
    }
  } else if (weaponActive && combatReady) {
    handTR.x = weaponLocalX
    handTR.y = weaponLocalY
    if (shoulderL) {
      handTL.x = shoulderL.worldX - ARM_IDLE_SWAY_PX / 2
      handTL.y = restLeftY
    }
  } else {
    // no weapon: both arms hang naturally under the shoulders
    if (shoulderR && shoulderL) {
      handTR.x = shoulderR.worldX + idleArmSwing
      handTR.y = restY
      handTL.x = shoulderL.worldX - idleArmSwing
      handTL.y = restLeftY
    }
  }

  // -- LEG GAIT --
  const footTRIdx = boneIndex.get('footTarget_R')!
  const footTLIdx = boneIndex.get('footTarget_L')!
  const footTR = bones[footTRIdx]
  const footTL = bones[footTLIdx]

  // step dimensions derived from thigh length
  const stepHalfWidth =
    thighRIdx !== undefined
      ? Math.round(
          skeleton.data.bones[thighRIdx].length * STEP_HALF_WIDTH_RATIO
        )
      : Math.round(ppm * 0.08)
  const liftHeight = Math.round(stepHalfWidth * LIFT_HEIGHT_RATIO)

  // ground Y reference: hip position + full leg length
  const groundY =
    hipRIdx !== undefined &&
    thighRIdx !== undefined &&
    lowerLegRIdx !== undefined
      ? Math.round(
          bones[hipRIdx].worldY +
            skeleton.data.bones[thighRIdx].length +
            skeleton.data.bones[lowerLegRIdx].length
        )
      : Math.round(ppm * 0.25)

  const hipRX =
    hipRIdx !== undefined ? Math.round(bones[hipRIdx].worldX) : stepHalfWidth
  const hipLX =
    hipLIdx !== undefined ? Math.round(bones[hipLIdx].worldX) : -stepHalfWidth

  if (animationName === 'move' || animationName === 'run') {
    const phaseR = gait.phaseInt
    const phaseL = (gait.phaseInt + 500) % 1000
    const sinR = SIN_LUT[phaseR]
    const sinL = SIN_LUT[phaseL]
    const stepWidth =
      animationName === 'run' ? (stepHalfWidth * 13) / 10 : stepHalfWidth
    const stepLift =
      animationName === 'run' ? (liftHeight * 14) / 10 : liftHeight
    footTR.x = hipRX + (sinR * stepWidth * moveStepDir) / 100
    footTR.y = groundY - (sinR > 0 ? (sinR * stepLift) / 100 : 0)
    footTL.x = hipLX + (sinL * stepWidth * moveStepDir) / 100
    footTL.y = groundY - (sinL > 0 ? (sinL * stepLift) / 100 : 0)
    gait.footRX = footTR.x
    gait.footRY = footTR.y
    gait.footLX = footTL.x
    gait.footLY = footTL.y
  } else if (animationName === 'jump') {
    footTR.x = hipRX + (stepHalfWidth * footForwardDir) / 2
    footTR.y =
      groundY -
      (liftHeight * JUMP_FOOT_LIFT_NUMERATOR) / JUMP_FOOT_LIFT_DENOMINATOR
    footTL.x = hipLX + (stepHalfWidth * footForwardDir) / 2
    footTL.y =
      groundY -
      (liftHeight * JUMP_FOOT_LIFT_NUMERATOR) / JUMP_FOOT_LIFT_DENOMINATOR
    gait.footRX = footTR.x
    gait.footRY = footTR.y
    gait.footLX = footTL.x
    gait.footLY = footTL.y
  } else if (animationName === 'roll') {
    footTR.x = hipRX + (stepHalfWidth * footForwardDir) / 2
    footTR.y =
      groundY -
      (liftHeight * ROLL_FOOT_LIFT_NUMERATOR) / ROLL_FOOT_LIFT_DENOMINATOR
    footTL.x = hipLX + (stepHalfWidth * footForwardDir) / 2
    footTL.y =
      groundY -
      (liftHeight * ROLL_FOOT_LIFT_NUMERATOR) / ROLL_FOOT_LIFT_DENOMINATOR
    gait.footRX = footTR.x
    gait.footRY = footTR.y
    gait.footLX = footTL.x
    gait.footLY = footTL.y
  } else if (animationName === 'stagger') {
    footTR.x = hipRX + stepHalfWidth * footForwardDir
    footTR.y =
      groundY -
      (liftHeight * STAGGER_FOOT_LIFT_NUMERATOR) / STAGGER_FOOT_LIFT_DENOMINATOR
    footTL.x = hipLX + (stepHalfWidth * footForwardDir) / 4
    footTL.y = groundY
    gait.footRX = footTR.x
    gait.footRY = footTR.y
    gait.footLX = footTL.x
    gait.footLY = footTL.y
  } else if (animationName === 'collapse') {
    const collapseProgress = Math.min(
      100,
      Math.max(
        0,
        Math.floor((gait.animationElapsedMs * 100) / COLLAPSE_DURATION_MS)
      )
    )
    const footLift =
      (liftHeight * COLLAPSE_FOOT_LIFT_NUMERATOR * (100 - collapseProgress)) /
      (COLLAPSE_FOOT_LIFT_DENOMINATOR * 100)
    footTR.x =
      hipRX + (stepHalfWidth * footForwardDir * (100 - collapseProgress)) / 200
    footTR.y = groundY - footLift
    footTL.x =
      hipLX + (stepHalfWidth * footForwardDir * (100 - collapseProgress)) / 200
    footTL.y = groundY - footLift
    gait.footRX = footTR.x
    gait.footRY = footTR.y
    gait.footLX = footTL.x
    gait.footLY = footTL.y
  } else {
    if (
      gait.footRX === 0 &&
      gait.footRY === 0 &&
      gait.footLX === 0 &&
      gait.footLY === 0
    ) {
      gait.footRX = hipRX
      gait.footRY = groundY
      gait.footLX = hipLX
      gait.footLY = groundY
    }
    footTR.x = gait.footRX
    footTR.y = gait.footRY
    footTL.x = gait.footLX
    footTL.y = gait.footLY
  }

  syncLegIkConstraints(skeleton)
  skeleton.updateWorldTransform(Physics.none)
  if (footR && footL) {
    setBoneWorldRotation(footR, 0)
    setBoneWorldRotation(footL, 0)
    skeleton.updateWorldTransform(Physics.none)
  }
}

function resetBoneTransform(bone: {
  data: {
    x: number
    y: number
    rotation: number
    scaleX: number
    scaleY: number
  }
  x: number
  y: number
  rotation: number
  scaleX: number
  scaleY: number
}): void {
  bone.x = bone.data.x
  bone.y = bone.data.y
  bone.rotation = bone.data.rotation
  bone.scaleX = bone.data.scaleX
  bone.scaleY = bone.data.scaleY
}

function sampleAnimationSine100(elapsedMs: number, cycleMs: number): number {
  if (!(cycleMs > 0)) {
    return 0
  }
  const phase = Math.max(0, elapsedMs | 0) % cycleMs
  return SIN_LUT[Math.floor((phase * 1000) / cycleMs) % 1000]
}

function sampleSine100(phaseInt: number): number {
  return SIN_LUT[Math.max(0, phaseInt | 0) % 1000]
}

function getRelaxedArmReachPx(
  skeleton: Skeleton,
  upperArmIdx: number | undefined,
  forearmIdx: number | undefined
): number {
  if (upperArmIdx === undefined || forearmIdx === undefined) {
    return REST_HAND_OFFSET_Y
  }
  return Math.round(
    skeleton.data.bones[upperArmIdx].length +
      skeleton.data.bones[forearmIdx].length
  )
}

function setBoneWorldRotation(
  bone: {
    parent: { getWorldRotationX(): number } | null
    rotation: number
  },
  worldRotationDeg: number
): void {
  const parentWorldRotation = bone.parent ? bone.parent.getWorldRotationX() : 0
  bone.rotation = worldRotationDeg - parentWorldRotation
}

function syncLegIkConstraints(skeleton: {
  ikConstraints: ReadonlyArray<{
    data: { name: string }
    bendDirection: number
  }>
}): void {
  const ikConstraints = skeleton.ikConstraints
  for (let i = 0; i < ikConstraints.length; i++) {
    const constraint = ikConstraints[i]
    const name = constraint.data.name
    if (name === 'legIK_R' || name === 'legIK_L') {
      constraint.bendDirection = -1
    }
  }
}
