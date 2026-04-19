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
 * 判断 profile 是否需要被渲染侧识别（有自定义多边形或 spine 动画）。
 * 与 isValidCharacterBodyProfile 不同，此函数允许 points 为空（spine 专用 profile）。
 */
export function hasRenderableBodyProfile(
  profile: MapCharacterBodyProfile | null | undefined
): profile is MapCharacterBodyProfile {
  return !!profile && (profile.points.length >= 6 || !!profile.spineKey)
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
  profile: MapCharacterBodyProfile | null | undefined
): MapCharacterBodyEyeStyle {
  const style = profile?.eyeStyle
  return style === 'noOutline' ||
    style === 'pupilOnly' ||
    style === 'cute' ||
    style === 'transparent' ||
    style === 'standard'
    ? style
    : DEFAULT_CHARACTER_EYE_STYLE
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
  const pupilRadiusX = Math.max(
    safeScaleX,
    CHARACTER_EYE_PUPIL_RADIUS * safeScaleX * resolvedEyeScaleX
  )
  const pupilRadiusY = Math.max(
    safeScaleY,
    CHARACTER_EYE_PUPIL_RADIUS * safeScaleY * resolvedEyeScaleY
  )
  const pupilOffsetXBase = Math.max(safeScaleX, pupilRadiusX * 0.5)
  const highlightRadiusX = Math.max(safeScaleX, pupilRadiusX * 0.4)
  const highlightRadiusY = Math.max(safeScaleY, pupilRadiusY * 0.4)
  const cuteHighlightOffsetX = -Math.max(safeScaleX, pupilRadiusX * 0.4)
  const cuteHighlightOffsetY = -Math.max(safeScaleY, pupilRadiusY * 0.4)
  return {
    style,
    centerX,
    centerY,
    rotationRad: getCharacterRotationRad(rotationDeg),
    outerRadiusX: Math.max(
      safeScaleX,
      CHARACTER_EYE_OUTER_RADIUS * safeScaleX * resolvedEyeScaleX
    ),
    outerRadiusY: Math.max(
      safeScaleY,
      CHARACTER_EYE_OUTER_RADIUS * safeScaleY * resolvedEyeScaleY
    ),
    whiteRadiusX: Math.max(
      safeScaleX,
      CHARACTER_EYE_WHITE_RADIUS * safeScaleX * resolvedEyeScaleX
    ),
    whiteRadiusY: Math.max(
      safeScaleY,
      CHARACTER_EYE_WHITE_RADIUS * safeScaleY * resolvedEyeScaleY
    ),
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
    cuteRadiusX: Math.max(
      safeScaleX,
      CHARACTER_EYE_OUTER_RADIUS * safeScaleX * resolvedEyeScaleX + safeScaleX
    ),
    cuteRadiusY: Math.max(
      safeScaleY,
      CHARACTER_EYE_WHITE_RADIUS * safeScaleY * resolvedEyeScaleY + safeScaleY
    ),
  }
}

export function getCharacterEyeGeometryFromProfile(
  profile: MapCharacterBodyProfile | null | undefined,
  facingDirection: number,
  scaleX = 1,
  scaleY = 1
): CharacterEyeGeometry {
  const facing = facingDirection < 0 ? -1 : 1
  const clampedOffset = clampCharacterEyeOffsetToCircle(
    getCharacterEyeDrawX(profile),
    getCharacterEyeDrawY(profile),
    getCharacterEyeMoveCircleRadius(
      getProfileReferenceWidth(profile),
      getProfileReferenceHeight(profile)
    )
  )
  return getCharacterEyeGeometry(
    clampedOffset.x * scaleX * facing,
    clampedOffset.y * scaleY,
    facingDirection,
    getCharacterEyeScaleX(profile),
    getCharacterEyeScaleY(profile),
    getCharacterEyeStyle(profile),
    getCharacterEyeRotationDeg(profile) * facing,
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
    ctx.restore()
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
  if (geometry.style === 'transparent') {
    return getRotatedBounds(
      geometry.centerX,
      geometry.centerY,
      -geometry.outerRadiusX,
      -geometry.outerRadiusY,
      geometry.outerRadiusX,
      geometry.outerRadiusY,
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
