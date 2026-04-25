import {
  BoneData,
  IkConstraintData,
  RegionAttachment,
  Skeleton,
  SkeletonData,
  Skin,
  SlotData,
  TextureRegion,
} from '@esotericsoftware/spine-core'
import { SpineTexture } from '@esotericsoftware/spine-pixi-v8'
import { Texture as PixiTexture } from 'pixi.js'

import type { BonePart, BoneSegment } from '../editorMapTypes'
import {
  type SkeletalBoneLocalTransform,
  deriveSkeletalBodyGeometry,
  resolveSkeletalBoneLocalTransform,
  writeSkeletalBoneLocalPoint,
} from '../skeletalBodyProfile'

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

const VISIBLE_BONES: ReadonlyArray<{ boneName: string; part: BonePart }> = [
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

export interface BuiltSkeleton {
  skeleton: Skeleton
  boneIndex: ReadonlyMap<string, number>
}

export interface SkeletalSpineDefinition {
  skeletonData: SkeletonData
  boneIndex: ReadonlyMap<string, number>
}

const definitionCache = new Map<string, SkeletalSpineDefinition>()
const textureRegionCache = new Map<string, TextureRegion>()
const shapeImageCache = new Map<string, HTMLImageElement>()

interface LocalPoint {
  x: number
  y: number
}

export function getOrBuildSkeleton(
  segments: BoneSegment[] | undefined,
  radiusPx: number,
  ppm: number
): BuiltSkeleton {
  const definition = getOrBuildSkeletalSpineDefinition(segments, radiusPx, ppm)
  return {
    skeleton: new Skeleton(definition.skeletonData),
    boneIndex: definition.boneIndex,
  }
}

export function getOrBuildSkeletalSpineDefinition(
  segments: BoneSegment[] | undefined,
  radiusPx: number,
  ppm: number
): SkeletalSpineDefinition {
  const segs = mergeWithDefaults(segments)
  const key = buildSkeletalSpineCacheKey(segs, radiusPx, ppm)
  const cached = definitionCache.get(key)
  if (cached) {
    return cached
  }
  const definition = buildSkeletalSpineDefinition(segs, radiusPx, ppm)
  definitionCache.set(key, definition)
  return definition
}

export function buildSkeletalSpineCacheKey(
  segments: BoneSegment[] | undefined,
  radiusPx: number,
  ppm: number
): string {
  const segs = mergeWithDefaults(segments)
  let key = `${radiusPx}|${ppm}|`
  for (let i = 0; i < segs.length; i++) {
    const seg = segs[i]
    key += `${seg.part}:${seg.length},${seg.width},${seg.shapeDataUrl ?? ''},`
    key += `${seg.shapeOffsetX ?? ''},${seg.shapeOffsetY ?? ''},`
    key += `${seg.shapeWidth ?? ''},${seg.shapeHeight ?? ''},`
    key += `${seg.pivotX ?? ''},${seg.pivotY ?? ''},`
    key += `${seg.tipX ?? ''},${seg.tipY ?? ''};`
  }
  return key
}

export function invalidateSkeletonCache(): void {
  definitionCache.clear()
  textureRegionCache.clear()
  shapeImageCache.clear()
}

export function areSkeletalBoneShapeTexturesReady(
  segments: readonly BoneSegment[] | undefined
): boolean {
  if (!segments || segments.length === 0) {
    return true
  }
  for (let i = 0; i < segments.length; i++) {
    const dataUrl = segments[i].shapeDataUrl
    if (!dataUrl) {
      continue
    }
    const image = getOrCreateShapeImage(dataUrl)
    if (
      !(image.complete && image.naturalWidth > 0 && image.naturalHeight > 0)
    ) {
      return false
    }
  }
  return true
}

function mergeWithDefaults(segments: BoneSegment[] | undefined): BoneSegment[] {
  if (!segments || segments.length === 0) {
    return DEFAULT_SEGMENTS
  }
  const result: BoneSegment[] = []
  for (let i = 0; i < DEFAULT_SEGMENTS.length; i++) {
    const def = DEFAULT_SEGMENTS[i]
    const override = segments.find((segment) => segment.part === def.part)
    if (!override) {
      result.push(def)
      continue
    }
    result.push({
      ...def,
      ...override,
    })
  }
  return result
}

function buildSkeletalSpineDefinition(
  segs: BoneSegment[],
  radiusPx: number,
  ppm: number
): SkeletalSpineDefinition {
  const data = new SkeletonData()
  const boneIndex = new Map<string, number>()
  let boneDataIndex = 0
  const geometry = deriveSkeletalBodyGeometry(segs)
  const centerX = geometry?.centerX ?? 480
  const centerY = geometry?.centerY ?? 480

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
    segs.find((segment) => segment.part === part)!
  const root = addBone('root', null, 0, 0, 0, 0)
  const bodySetup = getSegmentSetup(get('body'), ppm, centerX, centerY)
  const headSetup = getSegmentSetup(get('head'), ppm, centerX, centerY)
  const upperArmRSetup = getSegmentSetup(
    get('upperArmR'),
    ppm,
    centerX,
    centerY
  )
  const forearmRSetup = getSegmentSetup(get('forearmR'), ppm, centerX, centerY)
  const handRSetup = getSegmentSetup(get('handR'), ppm, centerX, centerY)
  const upperArmLSetup = getSegmentSetup(
    get('upperArmL'),
    ppm,
    centerX,
    centerY
  )
  const forearmLSetup = getSegmentSetup(get('forearmL'), ppm, centerX, centerY)
  const handLSetup = getSegmentSetup(get('handL'), ppm, centerX, centerY)
  const thighRSetup = getSegmentSetup(get('thighR'), ppm, centerX, centerY)
  const lowerLegRSetup = getSegmentSetup(
    get('lowerLegR'),
    ppm,
    centerX,
    centerY
  )
  const footRSetup = getSegmentSetup(get('footR'), ppm, centerX, centerY)
  const thighLSetup = getSegmentSetup(get('thighL'), ppm, centerX, centerY)
  const lowerLegLSetup = getSegmentSetup(
    get('lowerLegL'),
    ppm,
    centerX,
    centerY
  )
  const footLSetup = getSegmentSetup(get('footL'), ppm, centerX, centerY)

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

  const defaultSkin = new Skin('default')
  for (let i = 0; i < VISIBLE_BONES.length; i++) {
    const visibleBone = VISIBLE_BONES[i]
    const boneData = data.bones[boneIndex.get(visibleBone.boneName)!]
    const slotName = `slot_${visibleBone.boneName}`
    const attachmentName = `attachment_${visibleBone.boneName}`
    const slotData = new SlotData(data.slots.length, slotName, boneData)
    slotData.attachmentName = attachmentName
    data.slots.push(slotData)
    defaultSkin.setAttachment(
      slotData.index,
      attachmentName,
      createAttachmentForBone(
        visibleBone.part,
        boneData.length,
        get(visibleBone.part),
        ppm
      )
    )
  }
  data.defaultSkin = defaultSkin
  data.skins.push(defaultSkin)

  return {
    skeletonData: data,
    boneIndex,
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

function createAttachmentForBone(
  part: BonePart,
  boneLengthPx: number,
  segment: BoneSegment,
  _ppm: number
): RegionAttachment {
  const hasShapeTexture = !!segment.shapeDataUrl
  const textureWidth = Math.max(
    1,
    Math.round(
      hasShapeTexture
        ? (segment.shapeWidth ?? boneLengthPx)
        : boneLengthPx > 0
          ? boneLengthPx
          : segment.width * EDITOR_PPM
    )
  )
  const textureHeight = Math.max(
    1,
    Math.round(
      hasShapeTexture
        ? (segment.shapeHeight ?? segment.width * EDITOR_PPM)
        : segment.width * EDITOR_PPM
    )
  )
  const attachment = new RegionAttachment(
    `${part}_attachment`,
    segment.shapeDataUrl ?? `fallback_${part}`
  )
  attachment.region = getTextureRegion(
    segment.shapeDataUrl,
    textureWidth,
    textureHeight
  )
  attachment.width = textureWidth
  attachment.height = textureHeight

  if (hasShapeTexture) {
    attachment.updateRegion()
    if (applyEditorShapeAttachmentGeometry(attachment, segment)) {
      return attachment
    }
  }

  attachment.x = boneLengthPx * 0.5
  attachment.y = 0
  attachment.rotation = 0
  if (!hasShapeTexture) {
    attachment.color.setFromString(getPartColorHex(part))
  }
  attachment.updateRegion()
  return attachment
}

function applyEditorShapeAttachmentGeometry(
  attachment: RegionAttachment,
  segment: BoneSegment
): boolean {
  if (
    segment.shapeOffsetX === undefined ||
    segment.shapeOffsetY === undefined ||
    segment.shapeWidth === undefined ||
    segment.shapeHeight === undefined ||
    !attachment.region
  ) {
    return false
  }

  const localTransform: SkeletalBoneLocalTransform = {
    pivotX: 0,
    pivotY: 0,
    cos: 1,
    sin: 0,
  }
  if (!resolveSkeletalBoneLocalTransform(segment, localTransform)) {
    return false
  }

  const left = segment.shapeOffsetX
  const top = segment.shapeOffsetY
  const right = left + segment.shapeWidth
  const bottom = top + segment.shapeHeight
  const offset = attachment.offset

  writeSkeletalBoneLocalPoint(localTransform, left, top, offset, 0)
  writeSkeletalBoneLocalPoint(localTransform, left, bottom, offset, 2)
  writeSkeletalBoneLocalPoint(localTransform, right, bottom, offset, 4)
  writeSkeletalBoneLocalPoint(localTransform, right, top, offset, 6)

  const region = attachment.region
  const uvs = attachment.uvs
  uvs[0] = region.u
  uvs[1] = region.v
  uvs[2] = region.u
  uvs[3] = region.v2
  uvs[4] = region.u2
  uvs[5] = region.v2
  uvs[6] = region.u2
  uvs[7] = region.v
  return true
}

function getSegmentSetup(
  segment: BoneSegment,
  _ppm: number,
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
  const angleDeg = (Math.atan2(dy, dx) * 180) / Math.PI
  return {
    pivot: { x: localPivotX, y: localPivotY },
    tip: { x: localTipX, y: localTipY },
    angleDeg,
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

function getTextureRegion(
  dataUrl: string | undefined,
  width: number,
  height: number
): TextureRegion {
  const key = `${dataUrl ?? '__fallback__'}|${width}|${height}`
  const cached = textureRegionCache.get(key)
  if (cached) {
    return cached
  }

  const pixiTexture = dataUrl
    ? PixiTexture.from(getOrCreateShapeImage(dataUrl))
    : PixiTexture.WHITE
  const region = new TextureRegion()
  region.texture = SpineTexture.from(pixiTexture.source)
  region.u = 0
  region.v = 0
  region.u2 = 1
  region.v2 = 1
  region.width = width
  region.height = height
  region.originalWidth = width
  region.originalHeight = height
  region.offsetX = 0
  region.offsetY = 0
  region.degrees = 0
  textureRegionCache.set(key, region)
  return region
}

function getOrCreateShapeImage(dataUrl: string): HTMLImageElement {
  const cached = shapeImageCache.get(dataUrl)
  if (cached) {
    return cached
  }
  const image = new Image()
  image.decoding = 'async'
  image.src = dataUrl
  shapeImageCache.set(dataUrl, image)
  return image
}

function getPartColorHex(part: BonePart): string {
  switch (part) {
    case 'body':
      return '#888888'
    case 'head':
      return '#aaaaaa'
    case 'upperArmR':
    case 'forearmR':
    case 'handR':
    case 'upperArmL':
    case 'forearmL':
    case 'handL':
      return '#777777'
    case 'thighR':
    case 'lowerLegR':
    case 'footR':
    case 'thighL':
    case 'lowerLegL':
    case 'footL':
      return '#666666'
  }
}
