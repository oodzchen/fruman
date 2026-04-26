import type { BonePart, BoneSegment } from '../editorMapTypes'
import type { BuiltSkeleton } from './SkeletalSpineBuilder'

const EDITOR_PPM = 128

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
] as const

const shapeImageCache = new Map<string, HTMLImageElement>()

export function renderSkeletalBodyToCanvas(
  ctx: CanvasRenderingContext2D,
  built: BuiltSkeleton,
  segments: readonly BoneSegment[] | undefined,
  centerX: number,
  centerY: number,
  scale: number,
  facing: number
): void {
  if (!(scale > 0)) {
    return
  }
  const bones = built.skeleton.bones
  const boneIndex = built.boneIndex

  ctx.save()
  ctx.translate(centerX, centerY)
  ctx.scale(facing < 0 ? -scale : scale, -scale)

  for (let i = 0; i < VISIBLE_BONES.length; i++) {
    const visibleBone = VISIBLE_BONES[i]
    const boneIdx = boneIndex.get(visibleBone.boneName)
    if (boneIdx === undefined) {
      continue
    }
    const bone = bones[boneIdx]
    const segment = findSegmentByPart(segments, visibleBone.part)
    if (
      segment?.shapeDataUrl &&
      typeof segment.shapeOffsetX === 'number' &&
      typeof segment.shapeOffsetY === 'number' &&
      typeof segment.shapeWidth === 'number' &&
      segment.shapeWidth > 0 &&
      typeof segment.shapeHeight === 'number' &&
      segment.shapeHeight > 0
    ) {
      const image = getOrCreateShapeImage(segment.shapeDataUrl)
      if (image.complete && image.naturalWidth > 0 && image.naturalHeight > 0) {
        const editorDx = (segment.tipX ?? 0) - (segment.pivotX ?? 0)
        const editorDy = (segment.tipY ?? 0) - (segment.pivotY ?? 0)
        const editorAngle =
          editorDx === 0 && editorDy === 0 ? 0 : Math.atan2(editorDy, editorDx)
        ctx.save()
        ctx.translate(bone.worldX, bone.worldY)
        ctx.rotate(bone.getWorldRotationX() * (Math.PI / 180) - editorAngle)
        ctx.drawImage(
          image,
          segment.shapeOffsetX - (segment.pivotX ?? 0),
          segment.shapeOffsetY - (segment.pivotY ?? 0),
          segment.shapeWidth,
          segment.shapeHeight
        )
        ctx.restore()
        continue
      }
    }

    const lengthPx = built.skeleton.data.bones[boneIdx].length
    const widthPx = Math.max(
      1,
      Math.round((segment?.width ?? 0.06) * EDITOR_PPM)
    )
    const halfWidth = widthPx * 0.5
    ctx.save()
    ctx.translate(bone.worldX, bone.worldY)
    ctx.rotate(bone.getWorldRotationX() * (Math.PI / 180))
    ctx.fillStyle = getPartColor(visibleBone.part)
    ctx.beginPath()
    ctx.roundRect(
      0,
      -halfWidth,
      lengthPx,
      widthPx,
      Math.max(1, halfWidth * 0.3)
    )
    ctx.fill()
    ctx.restore()
  }

  ctx.restore()
}

function findSegmentByPart(
  segments: readonly BoneSegment[] | undefined,
  part: BonePart
): BoneSegment | null {
  if (!segments || segments.length === 0) {
    return null
  }
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i]
    if (segment.part === part) {
      return segment
    }
  }
  return null
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

function getPartColor(part: BonePart): string {
  switch (part) {
    case 'body':
      return '#8d8a7b'
    case 'head':
      return '#b8b09d'
    case 'upperArmR':
    case 'forearmR':
    case 'handR':
    case 'upperArmL':
    case 'forearmL':
    case 'handL':
      return '#6d6658'
    case 'thighR':
    case 'lowerLegR':
    case 'footR':
    case 'thighL':
    case 'lowerLegL':
    case 'footL':
      return '#544e45'
  }
}
