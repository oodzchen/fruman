import { isHexColorString, normalizeHexColor } from './colorUtils'
import type {
  EditorMapData,
  MapCharacterBodyBrowStyle,
  MapCharacterBodyEyeStyle,
  MapCharacterBodyProfile,
} from './editorMapTypes'

export const CHARACTER_BODY_DRAW_SIZE = 128
export const CHARACTER_BODY_DRAW_HALF = CHARACTER_BODY_DRAW_SIZE / 2
export const PLAYER_BODY_PROFILE_INDEX = 1
export const NPC_BODY_PROFILE_INDEX_START = 2
export const DEFAULT_CHARACTER_EYE_X = 32
export const DEFAULT_CHARACTER_EYE_Y = -32
export const DEFAULT_CHARACTER_EYE_SCALE = 1
export const DEFAULT_CHARACTER_EYE_ROTATION_DEG = 0
export const DEFAULT_CHARACTER_EYE_STYLE: MapCharacterBodyEyeStyle = 'standard'
export const DEFAULT_CHARACTER_BROW_STYLE: MapCharacterBodyBrowStyle = 'none'
export const DEFAULT_CHARACTER_BROW_OFFSET_X = 0
export const DEFAULT_CHARACTER_BROW_OFFSET_Y = 0
export const DEFAULT_CHARACTER_BROW_SCALE = 1
export const DEFAULT_CHARACTER_BROW_ROTATION_DEG = 0
const MIN_CHARACTER_EYE_COORD = -56
const MAX_CHARACTER_EYE_COORD = 56
const MIN_CHARACTER_EYE_SCALE = 0.25
const MAX_CHARACTER_EYE_SCALE = 8
const CHARACTER_EYE_OUTER_RADIUS = 8
const CHARACTER_EYE_WHITE_RADIUS = 6
const CHARACTER_EYE_PUPIL_RADIUS = 5
const CHARACTER_EYE_BODY_MARGIN = 2
const CHARACTER_EYE_FIT_SAMPLE_COUNT = 24
const CHARACTER_EYE_FIT_GRID_STEP = 2
const CHARACTER_CUTE_EYE_SIZE_MULTIPLIER = 2

type CharacterBodyFeatureDrawStyle = string | CanvasGradient | CanvasPattern

export interface CharacterBodyFeatureDrawContext {
  fillStyle: CharacterBodyFeatureDrawStyle
  strokeStyle: CharacterBodyFeatureDrawStyle
  lineWidth: number
  lineCap: CanvasLineCap
  save(): void
  restore(): void
  translate(x: number, y: number): void
  rotate(angle: number): void
  beginPath(): void
  arc(
    x: number,
    y: number,
    radius: number,
    startAngle: number,
    endAngle: number,
    counterclockwise?: boolean
  ): void
  ellipse(
    x: number,
    y: number,
    radiusX: number,
    radiusY: number,
    rotation: number,
    startAngle: number,
    endAngle: number,
    counterclockwise?: boolean
  ): void
  moveTo(x: number, y: number): void
  quadraticCurveTo(cpx: number, cpy: number, x: number, y: number): void
  fill(): void
  stroke(): void
  clip(): void
  setLineDash?(segments: number[]): void
}

export interface CharacterEyeGeometry {
  style: MapCharacterBodyEyeStyle
  centerX: number
  centerY: number
  rotationRad: number
  outerRadiusX: number
  outerRadiusY: number
  whiteRadiusX: number
  whiteRadiusY: number
  pupilRadiusX: number
  pupilRadiusY: number
  pupilOffsetX: number
  highlightOffsetX: number
  highlightOffsetY: number
  highlightRadiusX: number
  highlightRadiusY: number
  cuteRadiusX: number
  cuteRadiusY: number
}

export interface CharacterBrowGeometry {
  centerX: number
  centerY: number
  rotationRad: number
  halfWidth: number
  halfHeight: number
  thickness: number
  archHeight: number
  baselineOffsetY: number
}

export interface CharacterFeatureBounds {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

interface CharacterEyeBodyPointCache {
  points: number[]
  pointCount: number
  sourceX: number
  sourceY: number
  eyeScaleX: number
  eyeScaleY: number
  eyeStyle: MapCharacterBodyEyeStyle
  rotationDeg: number
  x: number
  y: number
}

const characterEyeBodyPointCache = new WeakMap<
  MapCharacterBodyProfile,
  CharacterEyeBodyPointCache
>()

function getCharacterRotationRad(rotationDeg: number): number {
  return (rotationDeg * Math.PI) / 180
}

function getRotatedBounds(
  centerX: number,
  centerY: number,
  minLocalX: number,
  minLocalY: number,
  maxLocalX: number,
  maxLocalY: number,
  rotationRad: number
): CharacterFeatureBounds {
  if (rotationRad === 0) {
    return {
      minX: centerX + minLocalX,
      minY: centerY + minLocalY,
      maxX: centerX + maxLocalX,
      maxY: centerY + maxLocalY,
    }
  }
  const cos = Math.cos(rotationRad)
  const sin = Math.sin(rotationRad)
  let minX = 0
  let minY = 0
  let maxX = 0
  let maxY = 0
  for (let i = 0; i < 4; i++) {
    const localX = i === 0 || i === 3 ? minLocalX : maxLocalX
    const localY = i < 2 ? minLocalY : maxLocalY
    const worldX = centerX + localX * cos - localY * sin
    const worldY = centerY + localX * sin + localY * cos
    if (i === 0) {
      minX = worldX
      minY = worldY
      maxX = worldX
      maxY = worldY
      continue
    }
    if (worldX < minX) minX = worldX
    if (worldY < minY) minY = worldY
    if (worldX > maxX) maxX = worldX
    if (worldY > maxY) maxY = worldY
  }
  return { minX, minY, maxX, maxY }
}

function getPositiveProfileSize(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : 0
}

function getProfilePointBounds(points: number[]): {
  width: number
  height: number
} | null {
  const extents = getProfilePointExtents(points)
  if (!extents) {
    return null
  }
  return {
    width: extents.width,
    height: extents.height,
  }
}

function getProfilePointExtents(points: number[]): {
  minX: number
  maxX: number
  minY: number
  maxY: number
  width: number
  height: number
} | null {
  if (points.length < 6) {
    return null
  }
  let minX = points[0]
  let maxX = points[0]
  let minY = points[1]
  let maxY = points[1]
  for (let i = 2; i < points.length; i += 2) {
    const x = points[i]
    const y = points[i + 1]
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
  }
  return {
    minX,
    maxX,
    minY,
    maxY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY),
  }
}

function hasProfileAbsoluteSize(
  profile: MapCharacterBodyProfile | null | undefined
): boolean {
  return getPositiveProfileSize(profile?.width) > 0
}

function getProfileReferenceWidth(
  profile: MapCharacterBodyProfile | null | undefined
): number {
  if (!hasProfileAbsoluteSize(profile)) {
    return CHARACTER_BODY_DRAW_SIZE
  }
  return (
    getProfilePointBounds(profile?.points ?? [])?.width ??
    CHARACTER_BODY_DRAW_SIZE
  )
}

function getProfileReferenceHeight(
  profile: MapCharacterBodyProfile | null | undefined
): number {
  if (!hasProfileAbsoluteSize(profile)) {
    return CHARACTER_BODY_DRAW_SIZE
  }
  return (
    getProfilePointBounds(profile?.points ?? [])?.height ??
    CHARACTER_BODY_DRAW_SIZE
  )
}

function resolveCharacterBodyProfileSize(
  profile: MapCharacterBodyProfile | null | undefined
): {
  width: number
  height: number
} {
  const width = getPositiveProfileSize(profile?.width)
  const height = getPositiveProfileSize(profile?.height)
  if (width <= 0 && height <= 0) {
    return { width: 0, height: 0 }
  }
  const bounds = getProfilePointBounds(profile?.points ?? [])
  if (!bounds) {
    return {
      width,
      height: height > 0 ? height : width,
    }
  }
  if (width > 0 && height > 0) {
    const scaleX = width / bounds.width
    const scaleY = height / bounds.height
    const uniformScale = (scaleX + scaleY) * 0.5
    return {
      width: bounds.width * uniformScale,
      height: bounds.height * uniformScale,
    }
  }
  if (width > 0) {
    const uniformScale = width / bounds.width
    return {
      width,
      height: bounds.height * uniformScale,
    }
  }
  const uniformScale = height / bounds.height
  return {
    width: bounds.width * uniformScale,
    height,
  }
}

export function getCharacterBodyProfileWidth(
  profile: MapCharacterBodyProfile | null | undefined
): number {
  return resolveCharacterBodyProfileSize(profile).width
}

export function getCharacterBodyProfileHeight(
  profile: MapCharacterBodyProfile | null | undefined
): number {
  return resolveCharacterBodyProfileSize(profile).height
}

export function isValidCharacterBodyProfile(
  profile: MapCharacterBodyProfile | null | undefined
): profile is MapCharacterBodyProfile {
  return !!profile && profile.points.length >= 6
}

/**
 * 判断 profile 是否需要被渲染侧识别（自定义多边形、spine 动画或骨骼体型）。
 * 与 isValidCharacterBodyProfile 不同，此函数允许 points 为空。
 */
export function hasRenderableBodyProfile(
  profile: MapCharacterBodyProfile | null | undefined
): profile is MapCharacterBodyProfile {
  return (
    !!profile &&
    (profile.points.length >= 6 ||
      !!profile.spineKey ||
      (profile.skeletalMode === true &&
        !!profile.boneSegments &&
        profile.boneSegments.length > 0))
  )
}

export function getCharacterBodyColor(
  profile: MapCharacterBodyProfile | null | undefined,
  fallbackColor: string
): string {
  const color = profile?.color
  if (isHexColorString(color)) {
    return normalizeHexColor(color)
  }
  return normalizeHexColor(fallbackColor)
}

export function getCharacterBloodColor(
  profile: MapCharacterBodyProfile | null | undefined,
  fallbackColor: string
): string {
  const color = profile?.bloodColor
  if (isHexColorString(color)) {
    return normalizeHexColor(color)
  }
  if (fallbackColor.length === 0) {
    return ''
  }
  return normalizeHexColor(fallbackColor)
}

export function clampCharacterEyeCoord(value: number): number {
  if (!Number.isFinite(value)) {
    return 0
  }
  return Math.max(
    MIN_CHARACTER_EYE_COORD,
    Math.min(MAX_CHARACTER_EYE_COORD, Math.round(value))
  )
}

export function getCharacterEyeDrawX(
  profile: MapCharacterBodyProfile | null | undefined
): number {
  if (typeof profile?.eyeX === 'number' && Number.isFinite(profile.eyeX)) {
    return clampCharacterEyeCoord(profile.eyeX)
  }
  return DEFAULT_CHARACTER_EYE_X
}

export function getCharacterEyeDrawY(
  profile: MapCharacterBodyProfile | null | undefined
): number {
  if (typeof profile?.eyeY === 'number' && Number.isFinite(profile.eyeY)) {
    return clampCharacterEyeCoord(profile.eyeY)
  }
  return DEFAULT_CHARACTER_EYE_Y
}

export function clampCharacterEyeScale(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_CHARACTER_EYE_SCALE
  }
  const rounded = Math.round(value * 1000) / 1000
  return Math.max(
    MIN_CHARACTER_EYE_SCALE,
    Math.min(MAX_CHARACTER_EYE_SCALE, rounded)
  )
}

export function getCharacterEyeScaleX(
  profile: MapCharacterBodyProfile | null | undefined
): number {
  if (
    typeof profile?.eyeScaleX === 'number' &&
    Number.isFinite(profile.eyeScaleX)
  ) {
    return clampCharacterEyeScale(profile.eyeScaleX)
  }
  return DEFAULT_CHARACTER_EYE_SCALE
}

export function getCharacterEyeScaleY(
  profile: MapCharacterBodyProfile | null | undefined
): number {
  if (
    typeof profile?.eyeScaleY === 'number' &&
    Number.isFinite(profile.eyeScaleY)
  ) {
    return clampCharacterEyeScale(profile.eyeScaleY)
  }
  return DEFAULT_CHARACTER_EYE_SCALE
}

export function getCharacterEyeStyle(
  profile: MapCharacterBodyProfile | null | undefined,
  fallbackStyle: MapCharacterBodyEyeStyle = DEFAULT_CHARACTER_EYE_STYLE
): MapCharacterBodyEyeStyle {
  const style = profile?.eyeStyle
  return style === 'noOutline' ||
    style === 'pupilOnly' ||
    style === 'cute' ||
    style === 'transparent' ||
    style === 'standard'
    ? style
    : fallbackStyle
}

export function getCharacterEyeRotationDeg(
  profile: MapCharacterBodyProfile | null | undefined
): number {
  const value = profile?.eyeRotationDeg
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.round(value)
    : DEFAULT_CHARACTER_EYE_ROTATION_DEG
}

export function getCharacterBrowStyle(
  profile: MapCharacterBodyProfile | null | undefined
): MapCharacterBodyBrowStyle {
  const style = profile?.browStyle
  return style === 'none' ||
    style === 'straight' ||
    style === 'thick' ||
    style === 'thin' ||
    style === 'custom'
    ? style
    : DEFAULT_CHARACTER_BROW_STYLE
}

export function getCharacterBrowOffsetX(
  profile: MapCharacterBodyProfile | null | undefined
): number {
  const value = profile?.browOffsetX
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.round(value)
    : DEFAULT_CHARACTER_BROW_OFFSET_X
}

export function getCharacterBrowOffsetY(
  profile: MapCharacterBodyProfile | null | undefined
): number {
  const value = profile?.browOffsetY
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.round(value)
    : DEFAULT_CHARACTER_BROW_OFFSET_Y
}

export function getCharacterBrowScaleX(
  profile: MapCharacterBodyProfile | null | undefined
): number {
  const value = profile?.browScaleX
  return typeof value === 'number' && Number.isFinite(value)
    ? clampCharacterEyeScale(value)
    : DEFAULT_CHARACTER_BROW_SCALE
}

export function getCharacterEyeMoveCircleRadius(
  referenceWidth: number,
  referenceHeight: number
): number {
  if (!Number.isFinite(referenceWidth) || !Number.isFinite(referenceHeight)) {
    return 0
  }
  const minSize = Math.min(Math.abs(referenceWidth), Math.abs(referenceHeight))
  return Math.max(0, Math.floor(minSize * 0.5))
}

export function clampCharacterEyeOffsetToCircle(
  offsetX: number,
  offsetY: number,
  maxRadius: number
): { x: number; y: number } {
  if (
    !Number.isFinite(offsetX) ||
    !Number.isFinite(offsetY) ||
    !Number.isFinite(maxRadius) ||
    maxRadius <= 0
  ) {
    return { x: 0, y: 0 }
  }
  const dx = Math.round(offsetX)
  const dy = Math.round(offsetY)
  const distanceSq = dx * dx + dy * dy
  const radius = Math.floor(maxRadius)
  const radiusSq = radius * radius
  if (distanceSq <= radiusSq) {
    return { x: dx, y: dy }
  }
  const distance = Math.sqrt(distanceSq)
  if (distance <= 0) {
    return { x: 0, y: 0 }
  }
  return {
    x: Math.round((dx * radius) / distance),
    y: Math.round((dy * radius) / distance),
  }
}

function isPointInsideCharacterBodyPoints(
  points: readonly number[],
  pointX: number,
  pointY: number
): boolean {
  if (points.length < 6) {
    return false
  }
  let inside = false
  let previousIndex = points.length - 2
  for (let currentIndex = 0; currentIndex < points.length; currentIndex += 2) {
    const currentX = points[currentIndex]
    const currentY = points[currentIndex + 1]
    const previousX = points[previousIndex]
    const previousY = points[previousIndex + 1]
    const currentAbove = currentY > pointY
    const previousAbove = previousY > pointY
    if (
      currentAbove !== previousAbove &&
      pointX <
        ((previousX - currentX) * (pointY - currentY)) /
          (previousY - currentY) +
          currentX
    ) {
      inside = !inside
    }
    previousIndex = currentIndex
  }
  return inside
}

function getCharacterBodyPointCentroid(points: readonly number[]): {
  x: number
  y: number
} | null {
  if (points.length < 6) {
    return null
  }
  let areaTwice = 0
  let centroidX = 0
  let centroidY = 0
  const pointCount = points.length / 2
  for (let i = 0; i < pointCount; i++) {
    const currentOffset = i * 2
    const nextOffset = ((i + 1) % pointCount) * 2
    const currentX = points[currentOffset]
    const currentY = points[currentOffset + 1]
    const nextX = points[nextOffset]
    const nextY = points[nextOffset + 1]
    const cross = currentX * nextY - nextX * currentY
    areaTwice += cross
    centroidX += (currentX + nextX) * cross
    centroidY += (currentY + nextY) * cross
  }
  if (Math.abs(areaTwice) <= 0.0001) {
    return null
  }
  return {
    x: centroidX / (areaTwice * 3),
    y: centroidY / (areaTwice * 3),
  }
}

function getCharacterBodyPointAverage(points: readonly number[]): {
  x: number
  y: number
} | null {
  if (points.length < 6) {
    return null
  }
  let totalX = 0
  let totalY = 0
  const pointCount = points.length / 2
  for (let i = 0; i < points.length; i += 2) {
    totalX += points[i]
    totalY += points[i + 1]
  }
  return {
    x: totalX / pointCount,
    y: totalY / pointCount,
  }
}

function getCharacterBodyInteriorAnchor(points: readonly number[]): {
  x: number
  y: number
} | null {
  const centroid = getCharacterBodyPointCentroid(points)
  if (
    centroid &&
    isPointInsideCharacterBodyPoints(points, centroid.x, centroid.y)
  ) {
    return centroid
  }
  const average = getCharacterBodyPointAverage(points)
  if (
    average &&
    isPointInsideCharacterBodyPoints(points, average.x, average.y)
  ) {
    return average
  }
  for (let i = 0; i < points.length; i += 2) {
    const nextOffset = (i + 2) % points.length
    const edgeCenterX = (points[i] + points[nextOffset]) * 0.5
    const edgeCenterY = (points[i + 1] + points[nextOffset + 1]) * 0.5
    if (isPointInsideCharacterBodyPoints(points, edgeCenterX, edgeCenterY)) {
      return {
        x: edgeCenterX,
        y: edgeCenterY,
      }
    }
  }
  return null
}

export function clampCharacterPointToBodyPoints(
  pointX: number,
  pointY: number,
  points: readonly number[]
): { x: number; y: number } {
  const roundedX = Math.round(pointX)
  const roundedY = Math.round(pointY)
  if (
    points.length < 6 ||
    isPointInsideCharacterBodyPoints(points, roundedX, roundedY)
  ) {
    return { x: roundedX, y: roundedY }
  }
  const anchor = getCharacterBodyInteriorAnchor(points)
  if (!anchor) {
    return { x: roundedX, y: roundedY }
  }
  let lowX = anchor.x
  let lowY = anchor.y
  let highX = pointX
  let highY = pointY
  for (let i = 0; i < 8; i++) {
    const midX = (lowX + highX) * 0.5
    const midY = (lowY + highY) * 0.5
    if (isPointInsideCharacterBodyPoints(points, midX, midY)) {
      lowX = midX
      lowY = midY
    } else {
      highX = midX
      highY = midY
    }
  }
  let resolvedX = Math.round(lowX)
  let resolvedY = Math.round(lowY)
  for (let i = 0; i < 16; i++) {
    if (isPointInsideCharacterBodyPoints(points, resolvedX, resolvedY)) {
      return { x: resolvedX, y: resolvedY }
    }
    resolvedX += Math.sign(Math.round(anchor.x) - resolvedX)
    resolvedY += Math.sign(Math.round(anchor.y) - resolvedY)
  }
  return {
    x: Math.round(anchor.x),
    y: Math.round(anchor.y),
  }
}

function getCharacterCuteEyeRadiusX(
  unitScaleX: number,
  resolvedEyeScaleX: number
): number {
  return Math.max(
    unitScaleX,
    (CHARACTER_EYE_WHITE_RADIUS * unitScaleX * resolvedEyeScaleX + unitScaleX) *
      CHARACTER_CUTE_EYE_SIZE_MULTIPLIER
  )
}

function getCharacterCuteEyeRadiusY(
  unitScaleY: number,
  resolvedEyeScaleY: number
): number {
  return Math.max(
    unitScaleY,
    (CHARACTER_EYE_OUTER_RADIUS * unitScaleY * resolvedEyeScaleY + unitScaleY) *
      CHARACTER_CUTE_EYE_SIZE_MULTIPLIER
  )
}

function getCharacterEyeFitRadii(
  eyeScaleX: number,
  eyeScaleY: number,
  style: MapCharacterBodyEyeStyle
): { x: number; y: number } {
  const resolvedScaleX = clampCharacterEyeScale(eyeScaleX)
  const resolvedScaleY = clampCharacterEyeScale(eyeScaleY)
  const outerRadiusX = CHARACTER_EYE_OUTER_RADIUS * resolvedScaleX
  const outerRadiusY = CHARACTER_EYE_OUTER_RADIUS * resolvedScaleY
  if (style !== 'cute') {
    return {
      x: outerRadiusX,
      y: outerRadiusY,
    }
  }
  return {
    x: getCharacterCuteEyeRadiusX(1, resolvedScaleX),
    y: getCharacterCuteEyeRadiusY(1, resolvedScaleY),
  }
}

function isEyeFitInsideCharacterBodyPoints(
  points: readonly number[],
  centerX: number,
  centerY: number,
  radiusX: number,
  radiusY: number,
  rotationDeg: number
): boolean {
  if (!isPointInsideCharacterBodyPoints(points, centerX, centerY)) {
    return false
  }
  const fitRadiusX = radiusX + CHARACTER_EYE_BODY_MARGIN
  const fitRadiusY = radiusY + CHARACTER_EYE_BODY_MARGIN
  const rotationRad = getCharacterRotationRad(rotationDeg)
  const cosRotation = Math.cos(rotationRad)
  const sinRotation = Math.sin(rotationRad)
  for (let i = 0; i < CHARACTER_EYE_FIT_SAMPLE_COUNT; i++) {
    const angle = (Math.PI * 2 * i) / CHARACTER_EYE_FIT_SAMPLE_COUNT
    const localX = Math.cos(angle) * fitRadiusX
    const localY = Math.sin(angle) * fitRadiusY
    const sampleX = centerX + localX * cosRotation - localY * sinRotation
    const sampleY = centerY + localX * sinRotation + localY * cosRotation
    if (!isPointInsideCharacterBodyPoints(points, sampleX, sampleY)) {
      return false
    }
  }
  return true
}

function getCharacterBodyPointBounds(points: readonly number[]): {
  minX: number
  minY: number
  maxX: number
  maxY: number
  width: number
  height: number
} | null {
  if (points.length < 6) {
    return null
  }
  let minX = points[0]
  let minY = points[1]
  let maxX = minX
  let maxY = minY
  for (let i = 2; i < points.length; i += 2) {
    const x = points[i]
    const y = points[i + 1]
    if (x < minX) minX = x
    if (y < minY) minY = y
    if (x > maxX) maxX = x
    if (y > maxY) maxY = y
  }
  return {
    minX,
    minY,
    maxX,
    maxY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY),
  }
}

function findNearestFittingEyeCenter(
  points: readonly number[],
  targetX: number,
  targetY: number,
  radiusX: number,
  radiusY: number,
  rotationDeg: number
): { x: number; y: number } | null {
  const roundedTargetX = Math.round(targetX)
  const roundedTargetY = Math.round(targetY)
  if (
    isEyeFitInsideCharacterBodyPoints(
      points,
      roundedTargetX,
      roundedTargetY,
      radiusX,
      radiusY,
      rotationDeg
    )
  ) {
    return {
      x: roundedTargetX,
      y: roundedTargetY,
    }
  }

  const bounds = getCharacterBodyPointBounds(points)
  if (!bounds) {
    return null
  }
  const maxSearchRadius = Math.ceil(Math.max(bounds.width, bounds.height))
  for (
    let radius = CHARACTER_EYE_FIT_GRID_STEP;
    radius <= maxSearchRadius;
    radius += CHARACTER_EYE_FIT_GRID_STEP
  ) {
    const minY = roundedTargetY - radius
    const maxY = roundedTargetY + radius
    const minX = roundedTargetX - radius
    const maxX = roundedTargetX + radius
    for (let y = minY; y <= maxY; y += CHARACTER_EYE_FIT_GRID_STEP) {
      if (
        isEyeFitInsideCharacterBodyPoints(
          points,
          minX,
          y,
          radiusX,
          radiusY,
          rotationDeg
        )
      ) {
        return { x: minX, y }
      }
      if (
        isEyeFitInsideCharacterBodyPoints(
          points,
          maxX,
          y,
          radiusX,
          radiusY,
          rotationDeg
        )
      ) {
        return { x: maxX, y }
      }
    }
    for (
      let x = minX + CHARACTER_EYE_FIT_GRID_STEP;
      x < maxX;
      x += CHARACTER_EYE_FIT_GRID_STEP
    ) {
      if (
        isEyeFitInsideCharacterBodyPoints(
          points,
          x,
          minY,
          radiusX,
          radiusY,
          rotationDeg
        )
      ) {
        return { x, y: minY }
      }
      if (
        isEyeFitInsideCharacterBodyPoints(
          points,
          x,
          maxY,
          radiusX,
          radiusY,
          rotationDeg
        )
      ) {
        return { x, y: maxY }
      }
    }
  }

  const anchor = getCharacterBodyInteriorAnchor(points)
  if (
    anchor &&
    isEyeFitInsideCharacterBodyPoints(
      points,
      anchor.x,
      anchor.y,
      radiusX,
      radiusY,
      rotationDeg
    )
  ) {
    return anchor
  }
  return null
}

function moveFittingEyeCenterTowardTarget(
  points: readonly number[],
  startX: number,
  startY: number,
  targetX: number,
  targetY: number,
  radiusX: number,
  radiusY: number,
  rotationDeg: number
): { x: number; y: number } {
  let lowX = startX
  let lowY = startY
  let highX = targetX
  let highY = targetY
  for (let i = 0; i < 8; i++) {
    const midX = (lowX + highX) * 0.5
    const midY = (lowY + highY) * 0.5
    if (
      isEyeFitInsideCharacterBodyPoints(
        points,
        midX,
        midY,
        radiusX,
        radiusY,
        rotationDeg
      )
    ) {
      lowX = midX
      lowY = midY
    } else {
      highX = midX
      highY = midY
    }
  }
  const roundedX = Math.round(lowX)
  const roundedY = Math.round(lowY)
  if (
    isEyeFitInsideCharacterBodyPoints(
      points,
      roundedX,
      roundedY,
      radiusX,
      radiusY,
      rotationDeg
    )
  ) {
    return { x: roundedX, y: roundedY }
  }
  return { x: lowX, y: lowY }
}

export function clampCharacterEyeCenterToBodyPoints(
  centerX: number,
  centerY: number,
  points: readonly number[],
  eyeScaleX: number,
  eyeScaleY: number,
  style: MapCharacterBodyEyeStyle,
  rotationDeg: number
): { x: number; y: number } {
  if (points.length < 6) {
    return {
      x: Math.round(centerX),
      y: Math.round(centerY),
    }
  }
  const fitRadii = getCharacterEyeFitRadii(eyeScaleX, eyeScaleY, style)
  const nearest = findNearestFittingEyeCenter(
    points,
    centerX,
    centerY,
    fitRadii.x,
    fitRadii.y,
    rotationDeg
  )
  if (!nearest) {
    return clampCharacterPointToBodyPoints(centerX, centerY, points)
  }
  return moveFittingEyeCenterTowardTarget(
    points,
    nearest.x,
    nearest.y,
    centerX,
    centerY,
    fitRadii.x,
    fitRadii.y,
    rotationDeg
  )
}

function clampCharacterEyeOffsetToBodyProfile(
  profile: MapCharacterBodyProfile | null | undefined,
  offsetX: number,
  offsetY: number,
  eyeScaleX: number,
  eyeScaleY: number,
  eyeStyle: MapCharacterBodyEyeStyle,
  rotationDeg: number
): { x: number; y: number } {
  if (!profile || profile.points.length < 6) {
    return { x: offsetX, y: offsetY }
  }
  const points = profile.points
  const cached = characterEyeBodyPointCache.get(profile)
  if (
    cached &&
    cached.points === points &&
    cached.pointCount === points.length &&
    cached.sourceX === offsetX &&
    cached.sourceY === offsetY &&
    cached.eyeScaleX === eyeScaleX &&
    cached.eyeScaleY === eyeScaleY &&
    cached.eyeStyle === eyeStyle &&
    cached.rotationDeg === rotationDeg
  ) {
    return { x: cached.x, y: cached.y }
  }
  const resolved = clampCharacterEyeCenterToBodyPoints(
    offsetX,
    offsetY,
    points,
    eyeScaleX,
    eyeScaleY,
    eyeStyle,
    rotationDeg
  )
  characterEyeBodyPointCache.set(profile, {
    points,
    pointCount: points.length,
    sourceX: offsetX,
    sourceY: offsetY,
    eyeScaleX,
    eyeScaleY,
    eyeStyle,
    rotationDeg,
    x: resolved.x,
    y: resolved.y,
  })
  return resolved
}

export function getCharacterBrowScaleY(
  profile: MapCharacterBodyProfile | null | undefined
): number {
  const value = profile?.browScaleY
  return typeof value === 'number' && Number.isFinite(value)
    ? clampCharacterEyeScale(value)
    : DEFAULT_CHARACTER_BROW_SCALE
}

export function getCharacterBrowRotationDeg(
  profile: MapCharacterBodyProfile | null | undefined
): number {
  const value = profile?.browRotationDeg
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.round(value)
    : DEFAULT_CHARACTER_BROW_ROTATION_DEG
}

export function getCharacterEyeGeometry(
  centerX: number,
  centerY: number,
  facingDirection: number,
  eyeScaleX: number,
  eyeScaleY: number,
  style: MapCharacterBodyEyeStyle,
  rotationDeg = DEFAULT_CHARACTER_EYE_ROTATION_DEG,
  scaleX = 1,
  scaleY = 1
): CharacterEyeGeometry {
  const safeScaleX = Math.max(Math.abs(scaleX), 0.001)
  const safeScaleY = Math.max(Math.abs(scaleY), 0.001)
  const resolvedEyeScaleX = clampCharacterEyeScale(eyeScaleX)
  const resolvedEyeScaleY = clampCharacterEyeScale(eyeScaleY)
  const basePupilRadiusX = Math.max(
    safeScaleX,
    CHARACTER_EYE_PUPIL_RADIUS * safeScaleX * resolvedEyeScaleX
  )
  const basePupilRadiusY = Math.max(
    safeScaleY,
    CHARACTER_EYE_PUPIL_RADIUS * safeScaleY * resolvedEyeScaleY
  )
  const outerRadiusX = Math.max(
    safeScaleX,
    CHARACTER_EYE_OUTER_RADIUS * safeScaleX * resolvedEyeScaleX
  )
  const outerRadiusY = Math.max(
    safeScaleY,
    CHARACTER_EYE_OUTER_RADIUS * safeScaleY * resolvedEyeScaleY
  )
  const whiteRadiusX = Math.max(
    safeScaleX,
    CHARACTER_EYE_WHITE_RADIUS * safeScaleX * resolvedEyeScaleX
  )
  const whiteRadiusY = Math.max(
    safeScaleY,
    CHARACTER_EYE_WHITE_RADIUS * safeScaleY * resolvedEyeScaleY
  )
  const cuteRadiusX = getCharacterCuteEyeRadiusX(safeScaleX, resolvedEyeScaleX)
  const cuteRadiusY = getCharacterCuteEyeRadiusY(safeScaleY, resolvedEyeScaleY)
  const pupilRadiusX =
    style === 'cute'
      ? Math.max(basePupilRadiusX, (cuteRadiusX * 9) / 10)
      : basePupilRadiusX
  const pupilRadiusY =
    style === 'cute'
      ? Math.max(basePupilRadiusY, (cuteRadiusY * 8) / 9)
      : basePupilRadiusY
  const pupilOffsetXBase =
    style === 'cute'
      ? Math.max(safeScaleX, (cuteRadiusX * 2) / 5)
      : Math.max(safeScaleX, pupilRadiusX * 0.5)
  const highlightRadiusX = Math.max(safeScaleX, pupilRadiusX * 0.4)
  const highlightRadiusY = Math.max(safeScaleY, pupilRadiusY * 0.4)
  const cuteHighlightOffsetX = -Math.max(safeScaleX, pupilRadiusX * 0.4)
  const cuteHighlightOffsetY = -Math.max(safeScaleY, pupilRadiusY * 0.4)
  return {
    style,
    centerX,
    centerY,
    rotationRad: getCharacterRotationRad(rotationDeg),
    outerRadiusX,
    outerRadiusY,
    whiteRadiusX,
    whiteRadiusY,
    pupilRadiusX,
    pupilRadiusY,
    pupilOffsetX: facingDirection < 0 ? -pupilOffsetXBase : pupilOffsetXBase,
    highlightOffsetX:
      style === 'cute'
        ? cuteHighlightOffsetX
        : -Math.max(safeScaleX, pupilRadiusX * 0.3),
    highlightOffsetY:
      style === 'cute'
        ? cuteHighlightOffsetY
        : -Math.max(safeScaleY, pupilRadiusY * 0.3),
    highlightRadiusX,
    highlightRadiusY,
    cuteRadiusX,
    cuteRadiusY,
  }
}

export function getCharacterEyeGeometryFromProfile(
  profile: MapCharacterBodyProfile | null | undefined,
  facingDirection: number,
  scaleX = 1,
  scaleY = 1,
  fallbackStyle: MapCharacterBodyEyeStyle = DEFAULT_CHARACTER_EYE_STYLE
): CharacterEyeGeometry {
  const facing = facingDirection < 0 ? -1 : 1
  const eyeScaleX = getCharacterEyeScaleX(profile)
  const eyeScaleY = getCharacterEyeScaleY(profile)
  const eyeStyle = getCharacterEyeStyle(profile, fallbackStyle)
  const eyeRotationDeg = getCharacterEyeRotationDeg(profile) * facing
  const circleClampedOffset = clampCharacterEyeOffsetToCircle(
    getCharacterEyeDrawX(profile),
    getCharacterEyeDrawY(profile),
    getCharacterEyeMoveCircleRadius(
      getProfileReferenceWidth(profile),
      getProfileReferenceHeight(profile)
    )
  )
  const clampedOffset = clampCharacterEyeOffsetToBodyProfile(
    profile,
    circleClampedOffset.x,
    circleClampedOffset.y,
    eyeScaleX,
    eyeScaleY,
    eyeStyle,
    eyeRotationDeg
  )
  return getCharacterEyeGeometry(
    clampedOffset.x * scaleX * facing,
    clampedOffset.y * scaleY,
    facingDirection,
    eyeScaleX,
    eyeScaleY,
    eyeStyle,
    eyeRotationDeg,
    scaleX,
    scaleY
  )
}

export function getCharacterBrowGeometry(
  eyeGeometry: CharacterEyeGeometry,
  style: MapCharacterBodyBrowStyle,
  browOffsetX: number,
  browOffsetY: number,
  browScaleX: number,
  browScaleY: number,
  browRotationDeg = DEFAULT_CHARACTER_BROW_ROTATION_DEG,
  scaleX = 1,
  scaleY = 1
): CharacterBrowGeometry | null {
  if (style === 'none' || style === 'custom') {
    return null
  }
  const safeScaleX = Math.max(Math.abs(scaleX), 0.001)
  const safeScaleY = Math.max(Math.abs(scaleY), 0.001)
  const resolvedScaleX = clampCharacterEyeScale(browScaleX)
  const resolvedScaleY = clampCharacterEyeScale(browScaleY)
  const baseHalfWidth = Math.max(
    8 * safeScaleX,
    (eyeGeometry.outerRadiusX * 7) / 5
  )
  const baseThickness =
    (style === 'thick' ? 4 : style === 'straight' ? 3 : 2) * safeScaleY
  const baseArchHeight =
    (style === 'thick' ? 4 : style === 'straight' ? 0 : 2) * safeScaleY
  const thickness = Math.max(safeScaleY, baseThickness * resolvedScaleY)
  const archHeight =
    style === 'straight'
      ? 0
      : Math.max(safeScaleY, baseArchHeight * resolvedScaleY)
  const baselineOffsetY = safeScaleY
  return {
    centerX: eyeGeometry.centerX + browOffsetX * safeScaleX,
    centerY:
      eyeGeometry.centerY -
      eyeGeometry.outerRadiusY -
      5 * safeScaleY +
      browOffsetY * safeScaleY -
      archHeight * 0.5,
    rotationRad: getCharacterRotationRad(browRotationDeg),
    halfWidth: Math.max(4 * safeScaleX, baseHalfWidth * resolvedScaleX),
    halfHeight: thickness + archHeight + baselineOffsetY,
    thickness,
    archHeight,
    baselineOffsetY,
  }
}

export function getCharacterBrowGeometryFromProfile(
  profile: MapCharacterBodyProfile | null | undefined,
  eyeGeometry: CharacterEyeGeometry,
  facingDirection: number,
  scaleX = 1,
  scaleY = 1
): CharacterBrowGeometry | null {
  const facing = facingDirection < 0 ? -1 : 1
  return getCharacterBrowGeometry(
    eyeGeometry,
    getCharacterBrowStyle(profile),
    getCharacterBrowOffsetX(profile) * facing,
    getCharacterBrowOffsetY(profile),
    getCharacterBrowScaleX(profile),
    getCharacterBrowScaleY(profile),
    getCharacterBrowRotationDeg(profile) * facing,
    scaleX,
    scaleY
  )
}

export function drawCharacterEyeGeometry(
  ctx: CharacterBodyFeatureDrawContext,
  geometry: CharacterEyeGeometry,
  pupilColor: string
): void {
  ctx.save()
  ctx.translate(geometry.centerX, geometry.centerY)
  if (geometry.rotationRad !== 0) {
    ctx.rotate(geometry.rotationRad)
  }
  if (geometry.style === 'transparent') {
    const outlineWidth = Math.max(
      1,
      Math.round(Math.min(geometry.outerRadiusX, geometry.outerRadiusY) / 4)
    )
    const dashLength = Math.max(outlineWidth * 2, Math.round(outlineWidth * 3))
    const gapLength = Math.max(
      outlineWidth + 1,
      Math.round((outlineWidth * 3) / 2)
    )
    ctx.strokeStyle = 'rgba(36,24,16,0.78)'
    ctx.lineWidth = outlineWidth
    ctx.setLineDash?.([dashLength, gapLength])
    ctx.beginPath()
    ctx.ellipse(
      0,
      0,
      geometry.outerRadiusX,
      geometry.outerRadiusY,
      0,
      0,
      Math.PI * 2
    )
    ctx.stroke()
    ctx.setLineDash?.([])
    ctx.restore()
    return
  }
  if (geometry.style === 'pupilOnly') {
    ctx.fillStyle = pupilColor
    ctx.beginPath()
    ctx.ellipse(
      geometry.pupilOffsetX,
      0,
      geometry.pupilRadiusX,
      geometry.pupilRadiusY,
      0,
      0,
      Math.PI * 2
    )
    ctx.fill()
    ctx.fillStyle = 'rgba(255,255,255,0.95)'
    ctx.beginPath()
    ctx.ellipse(
      geometry.pupilOffsetX + geometry.highlightOffsetX,
      geometry.highlightOffsetY,
      geometry.highlightRadiusX,
      geometry.highlightRadiusY,
      0,
      0,
      Math.PI * 2
    )
    ctx.fill()
    ctx.restore()
    return
  }
  if (geometry.style === 'standard') {
    ctx.fillStyle = '#201710'
    ctx.beginPath()
    ctx.ellipse(
      0,
      0,
      geometry.outerRadiusX,
      geometry.outerRadiusY,
      0,
      0,
      Math.PI * 2
    )
    ctx.fill()
    ctx.fillStyle = '#f4ecdc'
    ctx.beginPath()
    ctx.ellipse(
      0,
      0,
      geometry.whiteRadiusX,
      geometry.whiteRadiusY,
      0,
      0,
      Math.PI * 2
    )
    ctx.fill()
  } else if (geometry.style === 'cute') {
    ctx.save()
    ctx.beginPath()
    ctx.ellipse(
      0,
      0,
      geometry.cuteRadiusX,
      geometry.cuteRadiusY,
      0,
      0,
      Math.PI * 2
    )
    ctx.clip()
    ctx.fillStyle = '#fbf5ea'
    ctx.beginPath()
    ctx.ellipse(
      0,
      0,
      geometry.cuteRadiusX,
      geometry.cuteRadiusY,
      0,
      0,
      Math.PI * 2
    )
    ctx.fill()
  } else {
    ctx.fillStyle = '#f4ecdc'
    ctx.beginPath()
    ctx.ellipse(
      0,
      0,
      geometry.outerRadiusX,
      geometry.outerRadiusY,
      0,
      0,
      Math.PI * 2
    )
    ctx.fill()
  }
  ctx.fillStyle = pupilColor
  ctx.beginPath()
  ctx.ellipse(
    geometry.pupilOffsetX,
    0,
    geometry.pupilRadiusX,
    geometry.pupilRadiusY,
    0,
    0,
    Math.PI * 2
  )
  ctx.fill()
  ctx.fillStyle =
    geometry.style === 'cute'
      ? 'rgba(255,255,255,0.98)'
      : 'rgba(255,255,255,0.95)'
  ctx.beginPath()
  ctx.ellipse(
    geometry.pupilOffsetX + geometry.highlightOffsetX,
    geometry.highlightOffsetY,
    geometry.highlightRadiusX,
    geometry.highlightRadiusY,
    0,
    0,
    Math.PI * 2
  )
  ctx.fill()
  if (geometry.style === 'cute') {
    ctx.restore()
  }
  ctx.restore()
}

export function drawCharacterBrowGeometry(
  ctx: CharacterBodyFeatureDrawContext,
  geometry: CharacterBrowGeometry,
  color: string
): void {
  ctx.save()
  ctx.translate(geometry.centerX, geometry.centerY)
  if (geometry.rotationRad !== 0) {
    ctx.rotate(geometry.rotationRad)
  }
  ctx.strokeStyle = color
  ctx.lineCap = 'round'
  ctx.lineWidth = geometry.thickness
  ctx.beginPath()
  ctx.moveTo(-geometry.halfWidth, geometry.baselineOffsetY)
  ctx.quadraticCurveTo(
    0,
    -geometry.archHeight,
    geometry.halfWidth,
    geometry.baselineOffsetY
  )
  ctx.stroke()
  ctx.restore()
}

export function getCharacterEyeBounds(
  geometry: CharacterEyeGeometry
): CharacterFeatureBounds {
  if (geometry.style === 'transparent' || geometry.style === 'cute') {
    const radiusX =
      geometry.style === 'cute' ? geometry.cuteRadiusX : geometry.outerRadiusX
    const radiusY =
      geometry.style === 'cute' ? geometry.cuteRadiusY : geometry.outerRadiusY
    return getRotatedBounds(
      geometry.centerX,
      geometry.centerY,
      -radiusX,
      -radiusY,
      radiusX,
      radiusY,
      geometry.rotationRad
    )
  }
  const minLocalX = Math.min(
    -geometry.outerRadiusX,
    geometry.pupilOffsetX - geometry.pupilRadiusX,
    geometry.pupilOffsetX +
      geometry.highlightOffsetX -
      geometry.highlightRadiusX,
    -geometry.cuteRadiusX
  )
  const maxLocalX = Math.max(
    geometry.outerRadiusX,
    geometry.pupilOffsetX + geometry.pupilRadiusX,
    geometry.pupilOffsetX +
      geometry.highlightOffsetX +
      geometry.highlightRadiusX,
    geometry.cuteRadiusX
  )
  const minLocalY = Math.min(
    -geometry.outerRadiusY,
    -geometry.pupilRadiusY,
    geometry.highlightOffsetY - geometry.highlightRadiusY,
    -geometry.cuteRadiusY
  )
  const maxLocalY = Math.max(
    geometry.outerRadiusY,
    geometry.pupilRadiusY,
    geometry.highlightOffsetY + geometry.highlightRadiusY,
    geometry.cuteRadiusY
  )
  return getRotatedBounds(
    geometry.centerX,
    geometry.centerY,
    minLocalX,
    minLocalY,
    maxLocalX,
    maxLocalY,
    geometry.rotationRad
  )
}

export function getCharacterBrowBounds(
  geometry: CharacterBrowGeometry
): CharacterFeatureBounds {
  return getRotatedBounds(
    geometry.centerX,
    geometry.centerY,
    -geometry.halfWidth - geometry.thickness,
    -geometry.archHeight - geometry.thickness,
    geometry.halfWidth + geometry.thickness,
    geometry.thickness + geometry.baselineOffsetY,
    geometry.rotationRad
  )
}

export function getCharacterEyeOffsetX(
  profile: MapCharacterBodyProfile | null | undefined,
  radius: number,
  facingDirection: number
): number {
  const facing = facingDirection < 0 ? -1 : 1
  const bodyWidth = getCharacterBodyProfileWidth(profile)
  const referenceWidth = getProfileReferenceWidth(profile)
  return (
    (getCharacterEyeDrawX(profile) *
      (bodyWidth > 0 ? bodyWidth : radius * 2) *
      facing) /
    referenceWidth
  )
}

export function getCharacterEyeOffsetY(
  profile: MapCharacterBodyProfile | null | undefined,
  radius: number,
  bodyHeight: number
): number {
  const profileHeight = getCharacterBodyProfileHeight(profile)
  const referenceHeight = getProfileReferenceHeight(profile)
  return (
    (getCharacterEyeDrawY(profile) *
      (profileHeight > 0
        ? profileHeight
        : getCharacterBodyHeight(bodyHeight, radius))) /
    referenceHeight
  )
}

export function getNpcBodyProfileIndex(npcIndex: number): number {
  return NPC_BODY_PROFILE_INDEX_START + npcIndex
}

export function getCharacterBodyHeight(
  bodyHeight: number,
  radius: number
): number {
  return bodyHeight > 0 ? bodyHeight : radius * 2
}

export function getCharacterBodyHalfWidth(
  profile: MapCharacterBodyProfile | null | undefined,
  radius: number
): number {
  const width = getCharacterBodyProfileWidth(profile)
  return (width > 0 ? width : radius * 2) * 0.5
}

export function getCharacterBodyHalfHeight(
  profile: MapCharacterBodyProfile | null | undefined,
  radius: number,
  bodyHeight: number
): number {
  const height = getCharacterBodyProfileHeight(profile)
  return (
    (height > 0 ? height : getCharacterBodyHeight(bodyHeight, radius)) * 0.5
  )
}

const MAX_GROUND_PICKUP_RADIUS_BONUS = 5.0

export function getCharacterGroundPickupRadius(
  profile: MapCharacterBodyProfile | null | undefined,
  radius: number,
  bodyHeight: number,
  baseRadius: number
): number {
  if (baseRadius <= 0) {
    return 0
  }
  const halfWidth = getCharacterBodyHalfWidth(profile, radius)
  const halfHeight = getCharacterBodyHalfHeight(profile, radius, bodyHeight)
  const heightBonus = Math.max(0, halfHeight - radius)
  const widthBonus = Math.max(0, halfWidth - radius)
  return (
    baseRadius +
    Math.min(MAX_GROUND_PICKUP_RADIUS_BONUS, Math.max(heightBonus, widthBonus))
  )
}

export function buildCharacterBodyLocalPoints(
  profile: MapCharacterBodyProfile | null | undefined,
  radius: number,
  bodyHeight: number
): number[] | null {
  if (!isValidCharacterBodyProfile(profile) || radius <= 0) {
    return null
  }
  const width = getCharacterBodyProfileWidth(profile) || radius * 2
  const height =
    getCharacterBodyProfileHeight(profile) ||
    getCharacterBodyHeight(bodyHeight, radius)
  const points = profile.points
  const scaleX = width / getProfileReferenceWidth(profile)
  const scaleY = height / getProfileReferenceHeight(profile)
  const localPoints = new Array<number>(points.length)
  for (let i = 0; i < points.length; i += 2) {
    localPoints[i] = points[i] * scaleX
    localPoints[i + 1] = points[i + 1] * scaleY
  }
  return localPoints
}

export function getCharacterBodyProfileFromMap(
  map: EditorMapData | null,
  profileIndex: number
): MapCharacterBodyProfile | null {
  if (!map || profileIndex <= 0) {
    return null
  }
  if (profileIndex === PLAYER_BODY_PROFILE_INDEX) {
    return map.player?.bodyProfile ?? null
  }
  const npcIndex = profileIndex - NPC_BODY_PROFILE_INDEX_START
  if (npcIndex < 0 || npcIndex >= map.npcs.length) {
    return null
  }
  return map.npcs[npcIndex]?.bodyProfile ?? null
}
