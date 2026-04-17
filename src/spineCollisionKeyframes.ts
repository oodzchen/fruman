import {
  type Bone,
  BoundingBoxAttachment,
  type Slot,
} from '@esotericsoftware/spine-pixi-v8'

import { decomposeCharacterBodyLocalPoints } from './characterBodyCollision'
import type { MapCharacterBodyProfile } from './editorMapTypes'
import {
  acquireSpine,
  getSpineBoundsAtScale,
  getSpinePreviewMatchedScale,
  releaseSpine,
} from './renderer/SpineBodyManager'
import type { NpcType } from './types'
import type { WorkerSpineCollisionData } from './worker/protocol'

const SPINE_COLLISION_SAMPLE_RATE = 30
const RAD_PER_DEG = Math.PI / 180

interface SpineCollisionSegmentSource {
  bone: Bone
  shapes: number[][]
  localRadius: number
}

interface SpineCollisionAnalysis {
  coverageRadius: number
  proxyHalfWidth: number
  proxyTopY: number
  segmentOffsetY: number
}

function isPositiveNumber(value: number | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

function mirrorPolygonX(polygon: readonly number[]): number[] {
  const mirrored = new Array<number>(polygon.length)
  for (let i = 0; i < polygon.length; i += 2) {
    mirrored[i] = -polygon[i]
    mirrored[i + 1] = polygon[i + 1]
  }
  return mirrored
}

function scaleVertices(
  vertices: ArrayLike<number>,
  scale: number
): number[] | null {
  if (vertices.length < 6 || vertices.length % 2 !== 0) {
    return null
  }
  const scaled = new Array<number>(vertices.length)
  for (let i = 0; i < vertices.length; i++) {
    scaled[i] = vertices[i] * scale
  }
  return scaled
}

function computePolygonRadius(polygons: readonly number[][]): number {
  let maxDistanceSq = 0
  for (let i = 0; i < polygons.length; i++) {
    const polygon = polygons[i]
    for (let j = 0; j < polygon.length; j += 2) {
      const x = polygon[j]
      const y = polygon[j + 1]
      const distanceSq = x * x + y * y
      if (distanceSq > maxDistanceSq) {
        maxDistanceSq = distanceSq
      }
    }
  }
  return Math.sqrt(maxDistanceSq)
}

function findBoundingBoxSlotForBone(
  slots: readonly Slot[],
  bone: Bone
): Slot | null {
  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i]
    if (slot.bone !== bone) {
      continue
    }
    const attachment = slot.getAttachment()
    if (attachment instanceof BoundingBoxAttachment) {
      return slot
    }
  }
  return null
}

function collectSegmentSources(
  bones: readonly Bone[],
  slots: readonly Slot[],
  scaleToMeters: number
): SpineCollisionSegmentSource[] | null {
  const segments: SpineCollisionSegmentSource[] = []
  for (let i = 0; i < bones.length; i++) {
    const bone = bones[i]
    if (bone.data.name === 'root') {
      continue
    }
    const slot = findBoundingBoxSlotForBone(slots, bone)
    if (!slot) {
      continue
    }
    const attachment = slot.getAttachment()
    if (!(attachment instanceof BoundingBoxAttachment)) {
      continue
    }
    const localPoints = scaleVertices(attachment.vertices, scaleToMeters)
    if (!localPoints) {
      return null
    }
    // attachment.vertices 是 Spine Y-up 骨骼局部坐标，
    // 物理/渲染使用 Y-down，需要对 Y 坐标取反使旋转变换一致
    for (let j = 1; j < localPoints.length; j += 2) {
      localPoints[j] = -localPoints[j]
    }
    const shapes = decomposeCharacterBodyLocalPoints(localPoints)
    if (!shapes || shapes.length === 0) {
      return null
    }
    segments.push({
      bone,
      shapes,
      localRadius: computePolygonRadius(shapes),
    })
  }
  return segments.length > 0 ? segments : null
}

function cloneSegmentShapes(
  segments: readonly SpineCollisionSegmentSource[]
): number[][][] {
  const result = new Array<number[][]>(segments.length)
  for (let i = 0; i < segments.length; i++) {
    const polygons = segments[i].shapes
    const cloned = new Array<number[]>(polygons.length)
    for (let j = 0; j < polygons.length; j++) {
      cloned[j] = polygons[j].slice()
    }
    result[i] = cloned
  }
  return result
}

function analyzeCollisionSamples(
  boneTransforms: Float32Array,
  sampleCount: number,
  segmentCount: number,
  segments: readonly SpineCollisionSegmentSource[]
): SpineCollisionAnalysis {
  let maxDistance = 0
  let minX = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  const stride = segmentCount * 3
  for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex++) {
    const sampleOffset = sampleIndex * stride
    for (let segmentIndex = 0; segmentIndex < segmentCount; segmentIndex++) {
      const baseOffset = sampleOffset + segmentIndex * 3
      const x = boneTransforms[baseOffset]
      const y = boneTransforms[baseOffset + 1]
      const rotation = boneTransforms[baseOffset + 2]
      const distance =
        Math.sqrt(x * x + y * y) + segments[segmentIndex].localRadius
      if (distance > maxDistance) {
        maxDistance = distance
      }

      const cosRotation = Math.cos(rotation)
      const sinRotation = Math.sin(rotation)
      const segmentShapes = segments[segmentIndex].shapes
      for (
        let polygonIndex = 0;
        polygonIndex < segmentShapes.length;
        polygonIndex++
      ) {
        const polygon = segmentShapes[polygonIndex]
        for (
          let vertexIndex = 0;
          vertexIndex < polygon.length;
          vertexIndex += 2
        ) {
          const localX = polygon[vertexIndex]
          const localY = polygon[vertexIndex + 1]
          const worldX = x + localX * cosRotation - localY * sinRotation
          const worldY = y + localX * sinRotation + localY * cosRotation
          if (worldX < minX) {
            minX = worldX
          }
          if (worldX > maxX) {
            maxX = worldX
          }
          if (worldY < minY) {
            minY = worldY
          }
          if (worldY > maxY) {
            maxY = worldY
          }
        }
      }
    }
  }
  const segmentOffsetY = Number.isFinite(maxY) ? -maxY : 0
  return {
    coverageRadius: maxDistance,
    proxyHalfWidth:
      Number.isFinite(minX) && Number.isFinite(maxX)
        ? Math.max(Math.abs(minX), Math.abs(maxX))
        : 0,
    proxyTopY: Number.isFinite(minY) ? minY + segmentOffsetY : 0,
    segmentOffsetY,
  }
}

export function buildSpineCollisionKeyframes(
  npcType: NpcType,
  bodyProfile: MapCharacterBodyProfile,
  pixelsPerMeter: number
): WorkerSpineCollisionData | null {
  const spineKey = bodyProfile.spineKey ?? ''
  const animationName = bodyProfile.spineAnimationName ?? ''
  if (!spineKey || !animationName || !(pixelsPerMeter > 0)) {
    return null
  }

  const spine = acquireSpine(spineKey)
  if (!spine) {
    return null
  }

  try {
    const animation = spine.skeleton.data.findAnimation(animationName)
    if (!animation || !(animation.duration > 0)) {
      return null
    }

    const profileSpineScale = isPositiveNumber(bodyProfile.spineScale)
      ? bodyProfile.spineScale
      : 1
    const renderScale = getSpinePreviewMatchedScale(spineKey, profileSpineScale)
    const scaleToMeters = renderScale / pixelsPerMeter
    const bounds = getSpineBoundsAtScale(spineKey, renderScale)
    const anchorOffsetX = bounds.offsetX + bounds.width * 0.5
    const anchorOffsetY = -bounds.offsetY - bounds.height

    const segments = collectSegmentSources(
      spine.skeleton.bones,
      spine.skeleton.slots,
      scaleToMeters
    )
    if (!segments) {
      return null
    }

    const sampleCount = Math.max(
      2,
      Math.round(animation.duration * SPINE_COLLISION_SAMPLE_RATE)
    )
    const segmentCount = segments.length
    const boneTransforms = new Float32Array(sampleCount * segmentCount * 3)

    spine.state.clearTracks()
    spine.skeleton.setToSetupPose()
    spine.state.setAnimation(0, animationName, true)
    spine.update(0)

    let currentTime = 0
    for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex++) {
      const targetTime = (animation.duration * sampleIndex) / sampleCount
      const deltaTime = targetTime - currentTime
      if (deltaTime > 0) {
        spine.update(deltaTime)
        currentTime = targetTime
      }
      const sampleOffset = sampleIndex * segmentCount * 3
      for (let segmentIndex = 0; segmentIndex < segmentCount; segmentIndex++) {
        const bone = segments[segmentIndex].bone
        const transformOffset = sampleOffset + segmentIndex * 3
        boneTransforms[transformOffset] =
          (anchorOffsetX - bone.worldX * renderScale) / pixelsPerMeter
        boneTransforms[transformOffset + 1] =
          (anchorOffsetY + bone.worldY * renderScale) / pixelsPerMeter
        boneTransforms[transformOffset + 2] =
          bone.getWorldRotationX() * RAD_PER_DEG
      }
    }

    const analysis = analyzeCollisionSamples(
      boneTransforms,
      sampleCount,
      segmentCount,
      segments
    )

    return {
      npcType,
      spineKey,
      animationName,
      spineScale: profileSpineScale,
      animationDuration: animation.duration,
      sampleCount,
      segmentCount,
      coverageRadius: analysis.coverageRadius,
      proxyHalfWidth: analysis.proxyHalfWidth,
      proxyTopY: analysis.proxyTopY,
      segmentOffsetY: analysis.segmentOffsetY,
      segmentShapes: cloneSegmentShapes(segments),
      boneTransforms: boneTransforms.buffer,
    }
  } finally {
    releaseSpine(spineKey, spine)
  }
}

export function buildMirroredSegmentShapes(
  segmentShapes: readonly number[][][]
): number[][][] {
  const mirrored = new Array<number[][]>(segmentShapes.length)
  for (let i = 0; i < segmentShapes.length; i++) {
    const sourcePolygons = segmentShapes[i]
    const targetPolygons = new Array<number[]>(sourcePolygons.length)
    for (let j = 0; j < sourcePolygons.length; j++) {
      targetPolygons[j] = mirrorPolygonX(sourcePolygons[j])
    }
    mirrored[i] = targetPolygons
  }
  return mirrored
}
