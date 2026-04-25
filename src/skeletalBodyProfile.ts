import type {
  BoneSegment,
  EditorMapData,
  MapCharacterBodyCollisionShape,
  MapCharacterBodyProfile,
} from './editorMapTypes'

interface SkeletalBounds {
  minX: number
  minY: number
  maxX: number
  maxY: number
  width: number
  height: number
}

export interface SkeletalBodyGeometry {
  centerX: number
  centerY: number
  bounds: SkeletalBounds
  points: number[]
  collisionShapes: MapCharacterBodyCollisionShape[] | undefined
}

export interface SkeletalBoneLocalTransform {
  pivotX: number
  pivotY: number
  cos: number
  sin: number
}

const DEFAULT_SKELETAL_BONE_WIDTH = 0.06
const SKELETAL_REFERENCE_SIZE = 128

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isPositiveNumber(value: unknown): value is number {
  return isFiniteNumber(value) && value > 0
}

export function resolveSkeletalBoneLocalTransform(
  segment: BoneSegment,
  out: SkeletalBoneLocalTransform
): boolean {
  if (
    !isFiniteNumber(segment.pivotX) ||
    !isFiniteNumber(segment.pivotY) ||
    !isFiniteNumber(segment.tipX) ||
    !isFiniteNumber(segment.tipY)
  ) {
    return false
  }
  const angleRad = Math.atan2(
    segment.tipY - segment.pivotY,
    segment.tipX - segment.pivotX
  )
  out.pivotX = segment.pivotX
  out.pivotY = segment.pivotY
  out.cos = Math.cos(angleRad)
  out.sin = Math.sin(angleRad)
  return true
}

export function writeSkeletalBoneLocalPoint(
  transform: SkeletalBoneLocalTransform,
  pointX: number,
  pointY: number,
  target: number[] | Float32Array,
  offset: number
): void {
  const dx = pointX - transform.pivotX
  const dy = pointY - transform.pivotY
  target[offset] = dx * transform.cos + dy * transform.sin
  target[offset + 1] = -dx * transform.sin + dy * transform.cos
}

function createBounds(
  minX: number,
  minY: number,
  maxX: number,
  maxY: number
): SkeletalBounds {
  return {
    minX,
    minY,
    maxX,
    maxY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY),
  }
}

function expandBounds(
  bounds: SkeletalBounds | null,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number
): SkeletalBounds {
  if (!bounds) {
    return createBounds(minX, minY, maxX, maxY)
  }
  if (minX < bounds.minX) bounds.minX = minX
  if (minY < bounds.minY) bounds.minY = minY
  if (maxX > bounds.maxX) bounds.maxX = maxX
  if (maxY > bounds.maxY) bounds.maxY = maxY
  bounds.width = Math.max(1, bounds.maxX - bounds.minX)
  bounds.height = Math.max(1, bounds.maxY - bounds.minY)
  return bounds
}

function getCollisionShapeBounds(
  shape: MapCharacterBodyCollisionShape
): SkeletalBounds | null {
  if (shape.kind === 'circle') {
    return createBounds(
      shape.center.x - shape.radius,
      shape.center.y - shape.radius,
      shape.center.x + shape.radius,
      shape.center.y + shape.radius
    )
  }
  if (shape.kind === 'ellipse') {
    const rotationRad = ((shape.rotationDeg ?? 0) * Math.PI) / 180
    const cos = Math.cos(rotationRad)
    const sin = Math.sin(rotationRad)
    const extentX = Math.sqrt(
      shape.radiusX * shape.radiusX * cos * cos +
        shape.radiusY * shape.radiusY * sin * sin
    )
    const extentY = Math.sqrt(
      shape.radiusX * shape.radiusX * sin * sin +
        shape.radiusY * shape.radiusY * cos * cos
    )
    return createBounds(
      shape.center.x - extentX,
      shape.center.y - extentY,
      shape.center.x + extentX,
      shape.center.y + extentY
    )
  }
  const rotationRad = ((shape.rotationDeg ?? 0) * Math.PI) / 180
  const cos = Math.cos(rotationRad)
  const sin = Math.sin(rotationRad)
  const extentX =
    Math.abs(shape.halfWidth * cos) + Math.abs(shape.halfHeight * sin)
  const extentY =
    Math.abs(shape.halfWidth * sin) + Math.abs(shape.halfHeight * cos)
  return createBounds(
    shape.center.x - extentX,
    shape.center.y - extentY,
    shape.center.x + extentX,
    shape.center.y + extentY
  )
}

function buildDefaultBoneBoundary(
  segment: BoneSegment
): MapCharacterBodyCollisionShape | null {
  if (
    !isFiniteNumber(segment.pivotX) ||
    !isFiniteNumber(segment.pivotY) ||
    !isFiniteNumber(segment.tipX) ||
    !isFiniteNumber(segment.tipY)
  ) {
    return null
  }
  const dx = segment.tipX - segment.pivotX
  const dy = segment.tipY - segment.pivotY
  const centerX = (segment.pivotX + segment.tipX) * 0.5
  const centerY = (segment.pivotY + segment.tipY) * 0.5
  const halfHeight = Math.max(1, Math.sqrt(dx * dx + dy * dy) * 0.5)
  const widthPx =
    (isPositiveNumber(segment.width)
      ? segment.width
      : DEFAULT_SKELETAL_BONE_WIDTH) * SKELETAL_REFERENCE_SIZE
  const halfWidth = Math.max(1, widthPx * 0.5)
  const rotationDeg =
    dx === 0 && dy === 0 ? 0 : (Math.atan2(-dx, dy) * 180) / Math.PI
  return {
    kind: 'capsule',
    center: {
      x: centerX,
      y: centerY,
    },
    halfWidth,
    halfHeight,
    rotationDeg,
  }
}

function cloneAbsoluteCollisionShape(
  shape: MapCharacterBodyCollisionShape
): MapCharacterBodyCollisionShape {
  if (shape.kind === 'circle') {
    return {
      kind: 'circle',
      center: {
        x: shape.center.x,
        y: shape.center.y,
      },
      radius: shape.radius,
    }
  }
  if (shape.kind === 'ellipse') {
    return {
      kind: 'ellipse',
      center: {
        x: shape.center.x,
        y: shape.center.y,
      },
      radiusX: shape.radiusX,
      radiusY: shape.radiusY,
      rotationDeg: shape.rotationDeg,
    }
  }
  return {
    kind: 'capsule',
    center: {
      x: shape.center.x,
      y: shape.center.y,
    },
    halfWidth: shape.halfWidth,
    halfHeight: shape.halfHeight,
    rotationDeg: shape.rotationDeg,
  }
}

function buildAbsoluteCollisionShapes(
  boneSegments: readonly BoneSegment[]
): MapCharacterBodyCollisionShape[] {
  const shapes: MapCharacterBodyCollisionShape[] = []
  for (let i = 0; i < boneSegments.length; i++) {
    const segment = boneSegments[i]
    const boundaryShapes = segment.boundaryShapes
    if (boundaryShapes && boundaryShapes.length > 0) {
      for (let j = 0; j < boundaryShapes.length; j++) {
        shapes.push(cloneAbsoluteCollisionShape(boundaryShapes[j]))
      }
      continue
    }
    const fallbackShape = buildDefaultBoneBoundary(segment)
    if (fallbackShape) {
      shapes.push(fallbackShape)
    }
  }
  return shapes
}

function buildReferenceBounds(
  boneSegments: readonly BoneSegment[],
  collisionShapes: readonly MapCharacterBodyCollisionShape[]
): SkeletalBounds | null {
  let bounds: SkeletalBounds | null = null
  for (let i = 0; i < boneSegments.length; i++) {
    const segment = boneSegments[i]
    if (
      isFiniteNumber(segment.shapeOffsetX) &&
      isFiniteNumber(segment.shapeOffsetY) &&
      isPositiveNumber(segment.shapeWidth) &&
      isPositiveNumber(segment.shapeHeight)
    ) {
      bounds = expandBounds(
        bounds,
        segment.shapeOffsetX,
        segment.shapeOffsetY,
        segment.shapeOffsetX + segment.shapeWidth,
        segment.shapeOffsetY + segment.shapeHeight
      )
    }
  }
  for (let i = 0; i < collisionShapes.length; i++) {
    const shapeBounds = getCollisionShapeBounds(collisionShapes[i])
    if (!shapeBounds) {
      continue
    }
    bounds = expandBounds(
      bounds,
      shapeBounds.minX,
      shapeBounds.minY,
      shapeBounds.maxX,
      shapeBounds.maxY
    )
  }
  if (bounds) {
    return bounds
  }
  for (let i = 0; i < boneSegments.length; i++) {
    const segment = boneSegments[i]
    if (
      !isFiniteNumber(segment.pivotX) ||
      !isFiniteNumber(segment.pivotY) ||
      !isFiniteNumber(segment.tipX) ||
      !isFiniteNumber(segment.tipY)
    ) {
      continue
    }
    bounds = expandBounds(
      bounds,
      Math.min(segment.pivotX, segment.tipX),
      Math.min(segment.pivotY, segment.tipY),
      Math.max(segment.pivotX, segment.tipX),
      Math.max(segment.pivotY, segment.tipY)
    )
  }
  return bounds
}

function buildRelativeCollisionShape(
  shape: MapCharacterBodyCollisionShape,
  centerX: number,
  centerY: number
): MapCharacterBodyCollisionShape {
  if (shape.kind === 'circle') {
    return {
      kind: 'circle',
      center: {
        x: shape.center.x - centerX,
        y: shape.center.y - centerY,
      },
      radius: shape.radius,
    }
  }
  if (shape.kind === 'ellipse') {
    return {
      kind: 'ellipse',
      center: {
        x: shape.center.x - centerX,
        y: shape.center.y - centerY,
      },
      radiusX: shape.radiusX,
      radiusY: shape.radiusY,
      rotationDeg: shape.rotationDeg,
    }
  }
  return {
    kind: 'capsule',
    center: {
      x: shape.center.x - centerX,
      y: shape.center.y - centerY,
    },
    halfWidth: shape.halfWidth,
    halfHeight: shape.halfHeight,
    rotationDeg: shape.rotationDeg,
  }
}

function roundProfileValue(value: number): number {
  return Math.round(value * 1000) / 1000
}

export function getCharacterBodyTextureDataUrl(
  profile: MapCharacterBodyProfile | null | undefined
): string {
  if (profile?.skeletalMode && profile.skeletalSurfaceDataUrl) {
    return profile.skeletalSurfaceDataUrl
  }
  return profile?.textureDataUrl ?? profile?.surfaceDataUrl ?? ''
}

export function deriveSkeletalBodyGeometry(
  boneSegments: readonly BoneSegment[] | undefined
): SkeletalBodyGeometry | null {
  if (!boneSegments || boneSegments.length === 0) {
    return null
  }
  const collisionShapes = buildAbsoluteCollisionShapes(boneSegments)
  const bounds = buildReferenceBounds(boneSegments, collisionShapes)
  if (!bounds) {
    return null
  }
  const centerX = Math.round((bounds.minX + bounds.maxX) * 0.5)
  const centerY = Math.round((bounds.minY + bounds.maxY) * 0.5)
  const points = [
    roundProfileValue(bounds.minX - centerX),
    roundProfileValue(bounds.minY - centerY),
    roundProfileValue(bounds.maxX - centerX),
    roundProfileValue(bounds.minY - centerY),
    roundProfileValue(bounds.maxX - centerX),
    roundProfileValue(bounds.maxY - centerY),
    roundProfileValue(bounds.minX - centerX),
    roundProfileValue(bounds.maxY - centerY),
  ]
  const relativeCollisionShapes =
    collisionShapes.length > 0
      ? collisionShapes.map((shape) =>
          buildRelativeCollisionShape(shape, centerX, centerY)
        )
      : undefined
  return {
    centerX,
    centerY,
    bounds,
    points,
    collisionShapes: relativeCollisionShapes,
  }
}

export function normalizeSkeletalBodyProfile(
  profile: MapCharacterBodyProfile | undefined
): MapCharacterBodyProfile | undefined {
  if (!profile?.skeletalMode || !profile.boneSegments?.length) {
    return profile
  }
  const geometry = deriveSkeletalBodyGeometry(profile.boneSegments)
  if (!geometry) {
    return profile
  }
  const nextWidth = isPositiveNumber(profile.width)
    ? profile.width
    : roundProfileValue(geometry.bounds.width / SKELETAL_REFERENCE_SIZE)
  const nextHeight = isPositiveNumber(profile.height)
    ? profile.height
    : roundProfileValue(geometry.bounds.height / SKELETAL_REFERENCE_SIZE)
  return {
    ...profile,
    points: geometry.points,
    collisionShapes: geometry.collisionShapes,
    width: nextWidth,
    height: nextHeight,
    surfaceDataUrl: profile.surfaceDataUrl ?? profile.skeletalSurfaceDataUrl,
    skeletalSurfaceOffsetX: 0,
    skeletalSurfaceOffsetY: 0,
    skeletalSurfaceWidth: 1,
    skeletalSurfaceHeight: 1,
  }
}

export function normalizeCharacterBodyMapProfiles(
  map: EditorMapData | null
): EditorMapData | null {
  if (!map) {
    return null
  }
  const nextPlayer = map.player
    ? {
        ...map.player,
        bodyProfile: normalizeSkeletalBodyProfile(map.player.bodyProfile),
      }
    : undefined
  const nextNpcs =
    map.npcs.length > 0
      ? map.npcs.map((npc) => ({
          ...npc,
          bodyProfile: normalizeSkeletalBodyProfile(npc.bodyProfile),
        }))
      : map.npcs
  const nextTemplates =
    map.npcTemplates && map.npcTemplates.length > 0
      ? map.npcTemplates.map((template) => ({
          ...template,
          bodyProfile: normalizeSkeletalBodyProfile(template.bodyProfile),
        }))
      : map.npcTemplates
  return {
    ...map,
    player: nextPlayer,
    npcs: nextNpcs,
    npcTemplates: nextTemplates,
  }
}
