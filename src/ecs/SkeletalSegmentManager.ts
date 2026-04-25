import {
  BoneData,
  IkConstraintData,
  Physics,
  Skeleton,
  SkeletonData,
} from '@esotericsoftware/spine-core'

import {
  buildCollisionOutlineLoopsFromShapes,
  decomposeCharacterBodyLocalPoints,
} from '../characterBodyCollision'
import { DEFAULT_BODY_FRICTION } from '../constants'
import type { BonePart, BoneSegment } from '../editorMapTypes'
import {
  type GaitState,
  acquireGaitState,
  releaseGaitState,
  updateSkeletalPoseFromInput,
} from '../renderer/SkeletalPoseDriver'
import {
  type SkeletalBoneLocalTransform,
  buildDefaultSkeletalBoneBoundary,
  deriveSkeletalBodyGeometry,
  normalizeSkeletalBodyProfile,
  resolveSkeletalBoneLocalTransform,
  writeSkeletalBoneLocalPoint,
} from '../skeletalBodyProfile'
import type { MainModule, b2ShapeId, b2WorldId } from '../types'
import { appendConvexPolygonShapes } from './CharacterBodyPhysics'
import type { Entity } from './Entity'
import { checkOBBvsFlatPolygon } from './OBBCollision'
import { System } from './System'

const EDITOR_PPM = 128
const DEFAULT_SEGMENTS: BoneSegment[] = [
  {
    part: 'body',
    length: 0.32,
    width: 0.14,
    pivotX: 480,
    pivotY: 474,
    tipX: 480,
    tipY: 376,
  },
  {
    part: 'head',
    length: 0.16,
    width: 0.16,
    pivotX: 480,
    pivotY: 376,
    tipX: 480,
    tipY: 340,
  },
  {
    part: 'upperArmR',
    length: 0.15,
    width: 0.06,
    pivotX: 508,
    pivotY: 384,
    tipX: 548,
    tipY: 422,
  },
  {
    part: 'forearmR',
    length: 0.13,
    width: 0.05,
    pivotX: 548,
    pivotY: 422,
    tipX: 578,
    tipY: 456,
  },
  {
    part: 'handR',
    length: 0.07,
    width: 0.05,
    pivotX: 578,
    pivotY: 456,
    tipX: 592,
    tipY: 472,
  },
  {
    part: 'upperArmL',
    length: 0.15,
    width: 0.06,
    pivotX: 452,
    pivotY: 384,
    tipX: 412,
    tipY: 422,
  },
  {
    part: 'forearmL',
    length: 0.13,
    width: 0.05,
    pivotX: 412,
    pivotY: 422,
    tipX: 382,
    tipY: 456,
  },
  {
    part: 'handL',
    length: 0.07,
    width: 0.05,
    pivotX: 382,
    pivotY: 456,
    tipX: 368,
    tipY: 472,
  },
  {
    part: 'thighR',
    length: 0.18,
    width: 0.08,
    pivotX: 495,
    pivotY: 468,
    tipX: 495,
    tipY: 542,
  },
  {
    part: 'lowerLegR',
    length: 0.16,
    width: 0.06,
    pivotX: 495,
    pivotY: 542,
    tipX: 495,
    tipY: 600,
  },
  {
    part: 'footR',
    length: 0.08,
    width: 0.05,
    pivotX: 495,
    pivotY: 600,
    tipX: 518,
    tipY: 614,
  },
  {
    part: 'thighL',
    length: 0.18,
    width: 0.08,
    pivotX: 465,
    pivotY: 468,
    tipX: 465,
    tipY: 542,
  },
  {
    part: 'lowerLegL',
    length: 0.16,
    width: 0.06,
    pivotX: 465,
    pivotY: 542,
    tipX: 465,
    tipY: 600,
  },
  {
    part: 'footL',
    length: 0.08,
    width: 0.05,
    pivotX: 465,
    pivotY: 600,
    tipX: 442,
    tipY: 614,
  },
]

const BONE_PARTS: ReadonlyArray<{ boneName: string; part: BonePart }> = [
  { boneName: 'thigh_R', part: 'thighR' },
  { boneName: 'lowerLeg_R', part: 'lowerLegR' },
  { boneName: 'foot_R', part: 'footR' },
  { boneName: 'thigh_L', part: 'thighL' },
  { boneName: 'lowerLeg_L', part: 'lowerLegL' },
  { boneName: 'foot_L', part: 'footL' },
  { boneName: 'body', part: 'body' },
  { boneName: 'head', part: 'head' },
  { boneName: 'upperArm_R', part: 'upperArmR' },
  { boneName: 'forearm_R', part: 'forearmR' },
  { boneName: 'hand_R', part: 'handR' },
  { boneName: 'upperArm_L', part: 'upperArmL' },
  { boneName: 'forearm_L', part: 'forearmL' },
  { boneName: 'hand_L', part: 'handL' },
]

interface LocalPoint {
  x: number
  y: number
}

interface SkeletalSegmentEntry {
  boneName: string
  polygonsPx: number[][]
}

interface SkeletalSegmentRuntime {
  entityId: number
  facing: -1 | 1
  gait: GaitState
  skeleton: Skeleton
  boneIndex: ReadonlyMap<string, number>
  segments: SkeletalSegmentEntry[]
  segmentShapeIds: b2ShapeId[][]
  localPolygons: number[][][]
  worldPolygons: number[][][]
  pointBuffers: InstanceType<MainModule['b2Vec2']>[][][]
  totalShapeCount: number
  coverageRadius: number
}

function getFacing(entity: Entity, fallback: -1 | 1): -1 | 1 {
  const direction = entity.input?.lastMoveDirection ?? 0
  if (direction < 0) {
    return -1
  }
  if (direction > 0) {
    return 1
  }
  return fallback
}

function mergeWithDefaults(segments: BoneSegment[] | undefined): BoneSegment[] {
  if (!segments || segments.length === 0) {
    return DEFAULT_SEGMENTS
  }
  const result: BoneSegment[] = []
  for (let i = 0; i < DEFAULT_SEGMENTS.length; i++) {
    const def = DEFAULT_SEGMENTS[i]
    const override = segments.find((segment) => segment.part === def.part)
    result.push(override ? { ...def, ...override } : def)
  }
  return result
}

function buildSegmentLocalPolygons(segment: BoneSegment): number[][] {
  const localTransform: SkeletalBoneLocalTransform = {
    pivotX: 0,
    pivotY: 0,
    cos: 1,
    sin: 0,
  }
  if (!resolveSkeletalBoneLocalTransform(segment, localTransform)) {
    return []
  }

  const sourceShapes =
    segment.boundaryShapes && segment.boundaryShapes.length > 0
      ? segment.boundaryShapes
      : (() => {
          const fallbackShape = buildDefaultSkeletalBoneBoundary(segment)
          return fallbackShape ? [fallbackShape] : []
        })()
  if (sourceShapes.length === 0) {
    return []
  }

  const loops = buildCollisionOutlineLoopsFromShapes(sourceShapes)
  if (!loops || loops.length === 0) {
    return []
  }

  const result: number[][] = []
  for (let i = 0; i < loops.length; i++) {
    const polygons = decomposeCharacterBodyLocalPoints(loops[i])
    if (!polygons || polygons.length === 0) {
      continue
    }
    for (let j = 0; j < polygons.length; j++) {
      const polygon = polygons[j]
      const localPolygon = new Array<number>(polygon.length)
      for (let k = 0; k < polygon.length; k += 2) {
        writeSkeletalBoneLocalPoint(
          localTransform,
          polygon[k],
          polygon[k + 1],
          localPolygon,
          k
        )
      }
      result.push(localPolygon)
    }
  }
  return result
}

function getSegmentSetup(
  segment: BoneSegment,
  centerX: number,
  centerY: number
): { pivot: LocalPoint; tip: LocalPoint; angleDeg: number; lengthPx: number } {
  const fallbackLengthPx = Math.max(1, Math.round(segment.length * EDITOR_PPM))
  const pivotX = segment.pivotX ?? centerX
  const pivotY = segment.pivotY ?? centerY
  const tipX = segment.tipX ?? pivotX + fallbackLengthPx
  const tipY = segment.tipY ?? pivotY
  const localPivotX = pivotX - centerX
  const localPivotY = pivotY - centerY
  const localTipX = tipX - centerX
  const localTipY = tipY - centerY
  const dx = localTipX - localPivotX
  const dy = localTipY - localPivotY
  const lengthPx = Math.max(
    1,
    Math.round(Math.sqrt(dx * dx + dy * dy)) || fallbackLengthPx
  )
  return {
    pivot: { x: localPivotX, y: localPivotY },
    tip: { x: localTipX, y: localTipY },
    angleDeg: (Math.atan2(dy, dx) * 180) / Math.PI,
    lengthPx,
  }
}

function toParentTransform(
  point: LocalPoint,
  parentOrigin: LocalPoint,
  parentAngleDeg: number
): LocalPoint {
  const dx = point.x - parentOrigin.x
  const dy = point.y - parentOrigin.y
  const angleRad = (-parentAngleDeg * Math.PI) / 180
  const cos = Math.cos(angleRad)
  const sin = Math.sin(angleRad)
  return {
    x: dx * cos - dy * sin,
    y: dx * sin + dy * cos,
  }
}

function addIkConstraint(
  data: SkeletonData,
  name: string,
  order: number,
  chainIndices: number[],
  targetIndex: number,
  bendDirection: number
): void {
  const ik = new IkConstraintData(name)
  ik.order = order
  for (let i = 0; i < chainIndices.length; i++) {
    ik.bones.push(data.bones[chainIndices[i]])
  }
  ik.target = data.bones[targetIndex]
  ik.bendDirection = bendDirection
  ik.mix = 1
  ik.softness = 0
  data.ikConstraints.push(ik)
}

function buildRuntimeSkeleton(
  segments: BoneSegment[]
): { skeleton: Skeleton; boneIndex: ReadonlyMap<string, number> } | null {
  const geometry = deriveSkeletalBodyGeometry(segments)
  if (!geometry) {
    return null
  }
  const centerX = geometry.centerX
  const centerY = geometry.centerY
  const data = new SkeletonData()
  const boneIndex = new Map<string, number>()
  let boneDataIndex = 0
  const addBone = (
    name: string,
    parent: BoneData | null,
    x: number,
    y: number,
    rotation: number,
    length: number
  ): BoneData => {
    const boneData = new BoneData(boneDataIndex, name, parent)
    boneData.x = x
    boneData.y = y
    boneData.rotation = rotation
    boneData.length = length
    boneData.scaleX = 1
    boneData.scaleY = 1
    data.bones.push(boneData)
    boneIndex.set(name, boneDataIndex)
    boneDataIndex += 1
    return boneData
  }

  const get = (part: BonePart): BoneSegment =>
    segments.find((segment) => segment.part === part)!

  const root = addBone('root', null, 0, 0, 0, 0)
  const bodySetup = getSegmentSetup(get('body'), centerX, centerY)
  const headSetup = getSegmentSetup(get('head'), centerX, centerY)
  const upperArmRSetup = getSegmentSetup(get('upperArmR'), centerX, centerY)
  const forearmRSetup = getSegmentSetup(get('forearmR'), centerX, centerY)
  const handRSetup = getSegmentSetup(get('handR'), centerX, centerY)
  const upperArmLSetup = getSegmentSetup(get('upperArmL'), centerX, centerY)
  const forearmLSetup = getSegmentSetup(get('forearmL'), centerX, centerY)
  const handLSetup = getSegmentSetup(get('handL'), centerX, centerY)
  const thighRSetup = getSegmentSetup(get('thighR'), centerX, centerY)
  const lowerLegRSetup = getSegmentSetup(get('lowerLegR'), centerX, centerY)
  const footRSetup = getSegmentSetup(get('footR'), centerX, centerY)
  const thighLSetup = getSegmentSetup(get('thighL'), centerX, centerY)
  const lowerLegLSetup = getSegmentSetup(get('lowerLegL'), centerX, centerY)
  const footLSetup = getSegmentSetup(get('footL'), centerX, centerY)

  const body = addBone(
    'body',
    root,
    bodySetup.pivot.x,
    bodySetup.pivot.y,
    bodySetup.angleDeg,
    bodySetup.lengthPx
  )
  const headLocal = toParentTransform(
    headSetup.pivot,
    bodySetup.pivot,
    bodySetup.angleDeg
  )
  addBone(
    'head',
    body,
    headLocal.x,
    headLocal.y,
    headSetup.angleDeg - bodySetup.angleDeg,
    headSetup.lengthPx
  )

  const shoulderRLocal = toParentTransform(
    upperArmRSetup.pivot,
    bodySetup.pivot,
    bodySetup.angleDeg
  )
  const shoulderR = addBone(
    'shoulder_R',
    body,
    shoulderRLocal.x,
    shoulderRLocal.y,
    0,
    0
  )
  const shoulderLLocal = toParentTransform(
    upperArmLSetup.pivot,
    bodySetup.pivot,
    bodySetup.angleDeg
  )
  const shoulderL = addBone(
    'shoulder_L',
    body,
    shoulderLLocal.x,
    shoulderLLocal.y,
    0,
    0
  )

  const upperArmR = addBone(
    'upperArm_R',
    shoulderR,
    0,
    0,
    upperArmRSetup.angleDeg - bodySetup.angleDeg,
    upperArmRSetup.lengthPx
  )
  const forearmRLocal = toParentTransform(
    forearmRSetup.pivot,
    upperArmRSetup.pivot,
    upperArmRSetup.angleDeg
  )
  const forearmR = addBone(
    'forearm_R',
    upperArmR,
    forearmRLocal.x,
    forearmRLocal.y,
    forearmRSetup.angleDeg - upperArmRSetup.angleDeg,
    forearmRSetup.lengthPx
  )
  const handRLocal = toParentTransform(
    handRSetup.pivot,
    forearmRSetup.pivot,
    forearmRSetup.angleDeg
  )
  addBone(
    'hand_R',
    forearmR,
    handRLocal.x,
    handRLocal.y,
    handRSetup.angleDeg - forearmRSetup.angleDeg,
    handRSetup.lengthPx
  )

  const upperArmL = addBone(
    'upperArm_L',
    shoulderL,
    0,
    0,
    upperArmLSetup.angleDeg - bodySetup.angleDeg,
    upperArmLSetup.lengthPx
  )
  const forearmLLocal = toParentTransform(
    forearmLSetup.pivot,
    upperArmLSetup.pivot,
    upperArmLSetup.angleDeg
  )
  const forearmL = addBone(
    'forearm_L',
    upperArmL,
    forearmLLocal.x,
    forearmLLocal.y,
    forearmLSetup.angleDeg - upperArmLSetup.angleDeg,
    forearmLSetup.lengthPx
  )
  const handLLocal = toParentTransform(
    handLSetup.pivot,
    forearmLSetup.pivot,
    forearmLSetup.angleDeg
  )
  addBone(
    'hand_L',
    forearmL,
    handLLocal.x,
    handLLocal.y,
    handLSetup.angleDeg - forearmLSetup.angleDeg,
    handLSetup.lengthPx
  )

  const hipR = addBone(
    'hip_R',
    root,
    thighRSetup.pivot.x,
    thighRSetup.pivot.y,
    0,
    0
  )
  const hipL = addBone(
    'hip_L',
    root,
    thighLSetup.pivot.x,
    thighLSetup.pivot.y,
    0,
    0
  )

  const thighR = addBone(
    'thigh_R',
    hipR,
    0,
    0,
    thighRSetup.angleDeg,
    thighRSetup.lengthPx
  )
  const lowerLegRLocal = toParentTransform(
    lowerLegRSetup.pivot,
    thighRSetup.pivot,
    thighRSetup.angleDeg
  )
  const lowerLegR = addBone(
    'lowerLeg_R',
    thighR,
    lowerLegRLocal.x,
    lowerLegRLocal.y,
    lowerLegRSetup.angleDeg - thighRSetup.angleDeg,
    lowerLegRSetup.lengthPx
  )
  const footRLocal = toParentTransform(
    footRSetup.pivot,
    lowerLegRSetup.pivot,
    lowerLegRSetup.angleDeg
  )
  addBone(
    'foot_R',
    lowerLegR,
    footRLocal.x,
    footRLocal.y,
    footRSetup.angleDeg - lowerLegRSetup.angleDeg,
    footRSetup.lengthPx
  )

  const thighL = addBone(
    'thigh_L',
    hipL,
    0,
    0,
    thighLSetup.angleDeg,
    thighLSetup.lengthPx
  )
  const lowerLegLLocal = toParentTransform(
    lowerLegLSetup.pivot,
    thighLSetup.pivot,
    thighLSetup.angleDeg
  )
  const lowerLegL = addBone(
    'lowerLeg_L',
    thighL,
    lowerLegLLocal.x,
    lowerLegLLocal.y,
    lowerLegLSetup.angleDeg - thighLSetup.angleDeg,
    lowerLegLSetup.lengthPx
  )
  const footLLocal = toParentTransform(
    footLSetup.pivot,
    lowerLegLSetup.pivot,
    lowerLegLSetup.angleDeg
  )
  addBone(
    'foot_L',
    lowerLegL,
    footLLocal.x,
    footLLocal.y,
    footLSetup.angleDeg - lowerLegLSetup.angleDeg,
    footLSetup.lengthPx
  )

  addBone('handTarget_R', root, handRSetup.tip.x, handRSetup.tip.y, 0, 0)
  addBone('handTarget_L', root, handLSetup.tip.x, handLSetup.tip.y, 0, 0)
  addBone('footTarget_R', root, footRSetup.tip.x, footRSetup.tip.y, 0, 0)
  addBone('footTarget_L', root, footLSetup.tip.x, footLSetup.tip.y, 0, 0)

  addIkConstraint(
    data,
    'armIK_R',
    0,
    [boneIndex.get('upperArm_R')!, boneIndex.get('forearm_R')!],
    boneIndex.get('handTarget_R')!,
    1
  )
  addIkConstraint(
    data,
    'armIK_L',
    1,
    [boneIndex.get('upperArm_L')!, boneIndex.get('forearm_L')!],
    boneIndex.get('handTarget_L')!,
    1
  )
  addIkConstraint(
    data,
    'legIK_R',
    2,
    [boneIndex.get('thigh_R')!, boneIndex.get('lowerLeg_R')!],
    boneIndex.get('footTarget_R')!,
    -1
  )
  addIkConstraint(
    data,
    'legIK_L',
    3,
    [boneIndex.get('thigh_L')!, boneIndex.get('lowerLeg_L')!],
    boneIndex.get('footTarget_L')!,
    -1
  )

  const skeleton = new Skeleton(data)
  skeleton.setToSetupPose()
  skeleton.updateWorldTransform(Physics.none)
  return {
    skeleton,
    boneIndex,
  }
}

function createWorldPolygonCache(
  segmentShapes: readonly number[][][]
): number[][][] {
  const cache = new Array<number[][]>(segmentShapes.length)
  for (let i = 0; i < segmentShapes.length; i++) {
    const sourcePolygons = segmentShapes[i]
    const targetPolygons = new Array<number[]>(sourcePolygons.length)
    for (let j = 0; j < sourcePolygons.length; j++) {
      targetPolygons[j] = new Array<number>(sourcePolygons[j].length)
    }
    cache[i] = targetPolygons
  }
  return cache
}

function createShapeIdCache(
  segmentShapes: readonly number[][][]
): b2ShapeId[][] {
  const cache = new Array<b2ShapeId[]>(segmentShapes.length)
  for (let i = 0; i < segmentShapes.length; i++) {
    cache[i] = new Array<b2ShapeId>(segmentShapes[i].length)
  }
  return cache
}

export class SkeletalSegmentManager extends System {
  private readonly box2d: MainModule
  private readonly runtimes = new Map<number, SkeletalSegmentRuntime>()
  private readonly scratchShapeIds: b2ShapeId[] = []
  private entityLookup?: (id: number) => Entity | undefined
  private maxActiveCoverageRadius = 0

  constructor(box2d: MainModule, _worldId: b2WorldId) {
    super()
    this.box2d = box2d
    this.setRequiredComponents([])
  }

  setEntityLookup(entityLookup: (id: number) => Entity | undefined): void {
    this.entityLookup = entityLookup
  }

  createSegments(entity: Entity): void {
    const normalizedBodyProfile = normalizeSkeletalBodyProfile(
      entity.render?.bodyProfile ?? undefined
    )
    if (
      !normalizedBodyProfile?.skeletalMode ||
      !normalizedBodyProfile.boneSegments ||
      normalizedBodyProfile.boneSegments.length === 0 ||
      !entity.render ||
      !entity.physics
    ) {
      return
    }

    this.destroySegments(entity.id)

    const segments = mergeWithDefaults(normalizedBodyProfile.boneSegments)
    const built = buildRuntimeSkeleton(segments)
    const geometry = deriveSkeletalBodyGeometry(segments)
    if (!built || !geometry) {
      return
    }

    const segmentShapes: number[][][] = []
    const segmentEntries: SkeletalSegmentEntry[] = []
    for (let i = 0; i < BONE_PARTS.length; i++) {
      const entry = BONE_PARTS[i]
      const segment = segments.find((current) => current.part === entry.part)
      if (!segment) {
        continue
      }
      const polygonsPx = buildSegmentLocalPolygons(segment)
      if (polygonsPx.length === 0) {
        continue
      }
      segmentEntries.push({
        boneName: entry.boneName,
        polygonsPx,
      })
      segmentShapes.push(polygonsPx)
    }
    if (segmentEntries.length === 0) {
      return
    }

    const maxX = Math.max(
      Math.abs(geometry.bounds.minX - geometry.centerX),
      Math.abs(geometry.bounds.maxX - geometry.centerX)
    )
    const maxY = Math.max(
      Math.abs(geometry.bounds.minY - geometry.centerY),
      Math.abs(geometry.bounds.maxY - geometry.centerY)
    )

    const runtime: SkeletalSegmentRuntime = {
      entityId: entity.id,
      facing: getFacing(entity, 1),
      gait: acquireGaitState(),
      skeleton: built.skeleton,
      boneIndex: built.boneIndex,
      segments: segmentEntries,
      segmentShapeIds: createShapeIdCache(segmentShapes),
      localPolygons: createWorldPolygonCache(segmentShapes),
      worldPolygons: createWorldPolygonCache(segmentShapes),
      pointBuffers: this.createPointBufferCache(segmentShapes),
      totalShapeCount: 0,
      coverageRadius: Math.sqrt(maxX * maxX + maxY * maxY) / EDITOR_PPM,
    }

    this.syncRuntime(runtime, entity, 0, false)
    this.replaceRuntimeShapes(runtime, entity)
    this.runtimes.set(entity.id, runtime)
    if (runtime.coverageRadius > this.maxActiveCoverageRadius) {
      this.maxActiveCoverageRadius = runtime.coverageRadius
    }
  }

  destroySegments(entityId: number): void {
    const runtime = this.runtimes.get(entityId)
    if (!runtime) {
      return
    }
    this.destroyRuntime(runtime)
    this.runtimes.delete(entityId)
  }

  clear(): void {
    for (const runtime of this.runtimes.values()) {
      this.destroyRuntime(runtime)
    }
    this.runtimes.clear()
    this.maxActiveCoverageRadius = 0
  }

  getEntityCoverageRadius(entity: Entity): number {
    return this.runtimes.get(entity.id)?.coverageRadius ?? 0
  }

  getMaxActiveCoverageRadius(): number {
    return this.maxActiveCoverageRadius
  }

  getEntityGaitPhase(entityId: number): number {
    return this.runtimes.get(entityId)?.gait.phaseInt ?? 0
  }

  collectDebugCollisionData(): { entityId: number; polygons: number[][] }[] {
    if (!this.entityLookup || this.runtimes.size === 0) {
      return []
    }
    const result: { entityId: number; polygons: number[][] }[] = []
    for (const runtime of this.runtimes.values()) {
      const entity = this.entityLookup(runtime.entityId)
      if (!entity || !entity.transform || !entity.render) {
        continue
      }
      const polygons: number[][] = []
      for (let i = 0; i < runtime.worldPolygons.length; i++) {
        const segmentPolygons = runtime.worldPolygons[i]
        for (let j = 0; j < segmentPolygons.length; j++) {
          const worldPolygon = segmentPolygons[j]
          const localPolygon = new Array<number>(worldPolygon.length)
          for (let k = 0; k < worldPolygon.length; k += 2) {
            localPolygon[k] = worldPolygon[k] - entity.transform.x
            localPolygon[k + 1] = worldPolygon[k + 1] - entity.transform.y
          }
          polygons.push(localPolygon)
        }
      }
      if (polygons.length > 0) {
        result.push({
          entityId: runtime.entityId,
          polygons,
        })
      }
    }
    return result
  }

  testWeaponHit(
    entityId: number,
    weaponX: number,
    weaponY: number,
    weaponWidth: number,
    weaponHeight: number,
    weaponRotation: number
  ): boolean {
    const runtime = this.runtimes.get(entityId)
    if (!runtime) {
      return false
    }
    for (let i = 0; i < runtime.worldPolygons.length; i++) {
      const polygons = runtime.worldPolygons[i]
      for (let j = 0; j < polygons.length; j++) {
        if (
          checkOBBvsFlatPolygon(
            weaponX,
            weaponY,
            weaponWidth,
            weaponHeight,
            weaponRotation,
            polygons[j]
          )
        ) {
          return true
        }
      }
    }
    return false
  }

  update(_entities: Entity[], deltaTime: number): void {
    if (!this.entityLookup) {
      return
    }
    let maxCoverageRadius = 0
    for (const runtime of this.runtimes.values()) {
      const entity = this.entityLookup(runtime.entityId)
      if (
        !entity ||
        !entity.transform ||
        !entity.render ||
        !entity.physics ||
        !entity.render.bodyProfile?.skeletalMode ||
        entity.stats?.isDead ||
        entity.stats?.isVanished
      ) {
        this.destroySegments(runtime.entityId)
        continue
      }

      runtime.facing = getFacing(entity, runtime.facing)
      const requiresShapeRebuild =
        entity.physics.shapeIds.length !== runtime.totalShapeCount ||
        (runtime.totalShapeCount > 0 &&
          entity.physics.shapeIds[0] !== runtime.segmentShapeIds[0]?.[0])
      this.syncRuntime(runtime, entity, deltaTime, !requiresShapeRebuild)
      if (requiresShapeRebuild) {
        this.replaceRuntimeShapes(runtime, entity)
      }
      if (runtime.coverageRadius > maxCoverageRadius) {
        maxCoverageRadius = runtime.coverageRadius
      }
    }
    this.maxActiveCoverageRadius = maxCoverageRadius
  }

  syncAfterPhysics(): void {
    if (!this.entityLookup) {
      return
    }
    for (const runtime of this.runtimes.values()) {
      const entity = this.entityLookup(runtime.entityId)
      if (
        !entity ||
        !entity.transform ||
        !entity.render ||
        !entity.physics ||
        !entity.render.bodyProfile?.skeletalMode ||
        entity.stats?.isDead ||
        entity.stats?.isVanished
      ) {
        continue
      }
      this.syncRuntime(runtime, entity, 0, false)
    }
  }

  private createPointBufferCache(
    segmentShapes: readonly number[][][]
  ): InstanceType<MainModule['b2Vec2']>[][][] {
    const cache = new Array<InstanceType<MainModule['b2Vec2']>[][]>(
      segmentShapes.length
    )
    for (let i = 0; i < segmentShapes.length; i++) {
      const segmentPolygons = segmentShapes[i]
      const polygonBuffers = new Array<InstanceType<MainModule['b2Vec2']>[]>(
        segmentPolygons.length
      )
      for (let j = 0; j < segmentPolygons.length; j++) {
        const polygon = segmentPolygons[j]
        const pointCount = polygon.length / 2
        const pointBuffer = new Array<InstanceType<MainModule['b2Vec2']>>(
          pointCount
        )
        for (let k = 0; k < pointCount; k++) {
          pointBuffer[k] = new this.box2d.b2Vec2(0, 0)
        }
        polygonBuffers[j] = pointBuffer
      }
      cache[i] = polygonBuffers
    }
    return cache
  }

  private replaceRuntimeShapes(
    runtime: SkeletalSegmentRuntime,
    entity: Entity
  ): void {
    if (!entity.physics) {
      return
    }

    const {
      b2DefaultShapeDef,
      b2Shape_GetDensity,
      b2Shape_GetFilter,
      b2Shape_GetFriction,
      b2DestroyShape,
    } = this.box2d
    const templateShapeId = entity.physics.shapeIds[0] ?? entity.physics.shapeId
    const shapeDef = b2DefaultShapeDef()
    shapeDef.density =
      templateShapeId !== undefined ? b2Shape_GetDensity(templateShapeId) : 1
    shapeDef.material.friction =
      templateShapeId !== undefined
        ? b2Shape_GetFriction(templateShapeId)
        : DEFAULT_BODY_FRICTION
    if (templateShapeId !== undefined) {
      const filter = b2Shape_GetFilter(templateShapeId)
      shapeDef.filter.categoryBits = filter.categoryBits
      shapeDef.filter.maskBits = filter.maskBits
    }

    const shapeIds =
      entity.physics.shapeIds.length > 0
        ? entity.physics.shapeIds
        : [entity.physics.shapeId]
    for (let i = 0; i < shapeIds.length; i++) {
      b2DestroyShape(shapeIds[i], true)
    }
    entity.physics.shapeIds.length = 0

    runtime.totalShapeCount = 0
    const bodyId = entity.physics.bodyId
    for (let i = 0; i < runtime.localPolygons.length; i++) {
      this.scratchShapeIds.length = 0
      appendConvexPolygonShapes(
        this.box2d,
        bodyId,
        shapeDef,
        runtime.localPolygons[i],
        this.scratchShapeIds
      )
      const segmentShapeIds = runtime.segmentShapeIds[i]
      for (let j = 0; j < segmentShapeIds.length; j++) {
        segmentShapeIds[j] = this.scratchShapeIds[j]
        entity.physics.shapeIds.push(segmentShapeIds[j])
      }
      runtime.totalShapeCount += this.scratchShapeIds.length
    }
    entity.physics.shapeId = entity.physics.shapeIds[0]
    shapeDef.delete()
  }

  private updateRuntimeShape(
    shapeId: b2ShapeId,
    polygon: readonly number[],
    pointBuffer: InstanceType<MainModule['b2Vec2']>[]
  ): void {
    if (polygon.length < 6 || pointBuffer.length * 2 !== polygon.length) {
      return
    }
    const { b2ComputeHull, b2MakePolygon, b2Shape_SetPolygon } = this.box2d
    for (let i = 0; i < pointBuffer.length; i++) {
      const vertexOffset = i * 2
      pointBuffer[i].x = polygon[vertexOffset]
      pointBuffer[i].y = polygon[vertexOffset + 1]
    }
    const hull = b2ComputeHull(pointBuffer)
    const polygonShape = b2MakePolygon(hull, 0)
    b2Shape_SetPolygon(shapeId, polygonShape)
    hull.delete()
    polygonShape.delete()
  }

  private syncRuntime(
    runtime: SkeletalSegmentRuntime,
    entity: Entity,
    deltaTime: number,
    updatePhysicsShapes: boolean
  ): void {
    const weapon = entity.weapon
    updateSkeletalPoseFromInput(
      runtime.skeleton,
      runtime.boneIndex,
      runtime.gait,
      {
        entityX: entity.transform?.x ?? 0,
        entityY: entity.transform?.y ?? 0,
        weaponActive: weapon?.isEquipped === true,
        weaponX: weapon?.visual.x ?? entity.transform?.x ?? 0,
        weaponY: weapon?.visual.y ?? entity.transform?.y ?? 0,
        moveDir: entity.input?.lastMoveDirection ?? runtime.facing,
        facing: runtime.facing,
        ppm: EDITOR_PPM,
        deltaMsInt: Math.max(0, Math.round(deltaTime * 1000)) | 0,
      }
    )

    for (let i = 0; i < runtime.segments.length; i++) {
      const segment = runtime.segments[i]
      const boneIdx = runtime.boneIndex.get(segment.boneName)
      if (boneIdx === undefined) {
        continue
      }
      const bone = runtime.skeleton.bones[boneIdx]
      const angleRad = (bone.getWorldRotationX() * Math.PI) / 180
      const cos = Math.cos(angleRad)
      const sin = Math.sin(angleRad)
      const sourcePolygons = segment.polygonsPx
      const localTargetPolygons = runtime.localPolygons[i]
      const worldTargetPolygons = runtime.worldPolygons[i]

      for (let j = 0; j < sourcePolygons.length; j++) {
        const source = sourcePolygons[j]
        const localTarget = localTargetPolygons[j]
        const worldTarget = worldTargetPolygons[j]
        for (let k = 0; k < source.length; k += 2) {
          const absX = bone.worldX + source[k] * cos - source[k + 1] * sin
          const absY = bone.worldY + source[k] * sin + source[k + 1] * cos
          const localX = (absX * runtime.facing) / EDITOR_PPM
          const localY = absY / EDITOR_PPM
          localTarget[k] = localX
          localTarget[k + 1] = localY
          worldTarget[k] = (entity.transform?.x ?? 0) + localX
          worldTarget[k + 1] = (entity.transform?.y ?? 0) + localY
        }
        if (updatePhysicsShapes) {
          this.updateRuntimeShape(
            runtime.segmentShapeIds[i][j],
            localTarget,
            runtime.pointBuffers[i][j]
          )
        }
      }
    }
  }

  private destroyRuntime(runtime: SkeletalSegmentRuntime): void {
    releaseGaitState(runtime.gait)
    for (let i = 0; i < runtime.pointBuffers.length; i++) {
      const segmentPointBuffers = runtime.pointBuffers[i]
      for (let j = 0; j < segmentPointBuffers.length; j++) {
        const polygonPoints = segmentPointBuffers[j]
        for (let k = 0; k < polygonPoints.length; k++) {
          polygonPoints[k].delete()
        }
      }
    }
  }
}
