import type {
  BonePart,
  MapCharacterBodyBrowStyle,
  MapCharacterBodyEyeStyle,
  MapCharacterBodyPresetId,
  MapCharacterBodyProfile,
} from '../editorMapTypes'

export type BodyDrawMode =
  | 'contour'
  | 'select'
  | 'collision'
  | 'shape'
  | 'fill'
  | 'erase'
  | 'texture'
export type DecompPoint = [number, number]
export type DecompPolygon = DecompPoint[]
export type EditorBodyLayerKind = 'core' | 'eye' | 'brow' | 'paint' | 'bone'
export type EditorSelectionHandle =
  | 'n'
  | 'ne'
  | 'e'
  | 'se'
  | 's'
  | 'sw'
  | 'w'
  | 'nw'
export type EditorRotationHandle = 'rotate'
export type EditorCollisionShapeKind = 'circle' | 'ellipse' | 'capsule'

export interface EditorBodyLayer {
  id: number
  name: string
  kind: EditorBodyLayerKind
  canvas: HTMLCanvasElement | null
  ctx: CanvasRenderingContext2D | null
  bounds: EditorCanvasBounds | null
  boundsDirty: boolean
  bonePart?: BonePart
  bonePivotX?: number
  bonePivotY?: number
  boneTipX?: number
  boneTipY?: number
  boneBoundaryShapes?: EditorCollisionShape[]
  boneShapeCustomized?: boolean
}

export interface EditorCanvasBounds {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

export interface EditorCanvasSnapshot {
  bounds: EditorCanvasBounds | null
  image: ImageData | null
}

export interface EditorCanvasState {
  canvas: HTMLCanvasElement
  ctx: CanvasRenderingContext2D
  bounds: EditorCanvasBounds | null
  boundsDirty: boolean
}

export interface EditorBodyLayerSnapshot {
  id: number
  name: string
  kind: 'brow' | 'paint' | 'bone'
  image: EditorCanvasSnapshot
}

export interface EditorSelectionScaleSession {
  layerId: number
  handle: EditorSelectionHandle
  initialBounds: EditorCanvasBounds
  centerX: number
  centerY: number
  handleOffsetX: number
  handleOffsetY: number
  coreMask: EditorCanvasSnapshot | null
  coreShape: EditorCanvasSnapshot | null
  coreTexture: EditorCanvasSnapshot | null
  contourPoints: number[] | null
  layerSnapshot: EditorCanvasSnapshot | null
}

export interface EditorSelectionRotateSession {
  layerId: number
  centerX: number
  centerY: number
  startAngleDeg: number
  coreMask: EditorCanvasSnapshot | null
  coreShape: EditorCanvasSnapshot | null
  coreTexture: EditorCanvasSnapshot | null
  contourPoints: number[] | null
  layerSnapshot: EditorCanvasSnapshot | null
  eyeRotationDeg: number
  browRotationDeg: number
}

export interface EditorCollisionShapeBase {
  id: number
  kind: EditorCollisionShapeKind
  centerX: number
  centerY: number
}

export interface EditorCollisionCircleShape extends EditorCollisionShapeBase {
  kind: 'circle'
  radius: number
}

export interface EditorCollisionEllipseShape extends EditorCollisionShapeBase {
  kind: 'ellipse'
  radiusX: number
  radiusY: number
  rotationDeg: number
}

export interface EditorCollisionCapsuleShape extends EditorCollisionShapeBase {
  kind: 'capsule'
  halfWidth: number
  halfHeight: number
  rotationDeg: number
}

export type EditorCollisionShape =
  | EditorCollisionCircleShape
  | EditorCollisionEllipseShape
  | EditorCollisionCapsuleShape

export interface EditorCollisionScaleSession {
  shapeId: number
  handle: EditorSelectionHandle
  centerX: number
  centerY: number
  rotationDeg: number
  handleOffsetLocalX: number
  handleOffsetLocalY: number
  initialShape: EditorCollisionShape
}

export interface EditorCollisionRotateSession {
  shapeId: number
  centerX: number
  centerY: number
  startAngleDeg: number
  initialRotationDeg: number
}

export interface EditorCharacterBodyDrawerOptions {
  title: string
  initialProfile?: MapCharacterBodyProfile
  initialColor?: string
  defaultBodyWidth?: number
  defaultBodyHeight?: number
  initialFacing?: number
}

export type EditorCharacterBodyPresetId = MapCharacterBodyPresetId | 'custom'

export const DISPLAY_SIZE = 320
export const DISPLAY_PANEL_SIZE = 480
export const MIN_BRUSH_SIZE = 2
export const MAX_BRUSH_SIZE = 24
export const DEFAULT_BRUSH_SIZE = 8
export const MASK_ALPHA_THRESHOLD = 16
export const MAX_PROFILE_POINTS = 96
export const DRAWER_HISTORY_MAX_ENTRIES = 8
export const PROFILE_POINT_PRECISION = 0.0001
export const CONTOUR_CURSOR_SIZE = 10
export const CONTOUR_MIN_POINT_COUNT = 3
export const CONTOUR_GUIDE_POINT_RADIUS = 3
export const CONTOUR_SELECT_DISTANCE_SQ = 100
export const CONTOUR_EDGE_SELECT_DISTANCE_SQ = 100
export const DRAW_WORLD_SIZE = DISPLAY_SIZE * 3
export const DRAW_WORLD_HALF = DRAW_WORLD_SIZE / 2
export const CANVAS_ZOOM_MIN_PERCENT = 25
export const CANVAS_ZOOM_MAX_PERCENT = 300
export const CANVAS_ZOOM_STEP_PERCENT = 25
export const CANVAS_ZOOM_DEFAULT_PERCENT = 100
export const DEFAULT_CONTOUR_SEGMENTS = 16
export const MAX_EDITOR_CONTOUR_POINTS = 96
export const LEGACY_PROFILE_REFERENCE_SIZE = 128
export const DEFAULT_BODY_BLOOD_COLOR = '#7a1010'
export const TRANSPARENT_BODY_COLOR = '#00000000'
export const DEFAULT_EDITOR_EYE_RADIUS = 8
export const SELECTION_HANDLE_SIZE = 10
export const SELECTION_HANDLE_HIT_SIZE = 14
export const SELECTION_ROTATE_HANDLE_SIZE = 12
export const SELECTION_ROTATE_HANDLE_HIT_SIZE = 16
export const SELECTION_ROTATE_HANDLE_OFFSET = 20
export const SELECTION_MIN_SIZE = 4
export const CORE_LAYER_ID = 1
export const EYE_LAYER_ID = 2
export const BROW_LAYER_ID = 3
export const MIN_COLLISION_RADIUS = 4
export const MIN_COLLISION_HALF_EXTENT = 4
export const CUSTOM_BODY_PRESET_ID = 'custom'
export const BODY_PRESET_IDS: MapCharacterBodyPresetId[] = [
  'banana',
  'kiwano',
  'pandaAnt',
  'pineapple',
  'tomato',
  'watermelon',
]
export const PINEAPPLE_PRESET_IMAGE_SRC = '/images/presets/pineapple.png'
export const TOMATO_PRESET_IMAGE_SRC = '/images/presets/tomato.png'
export const WATERMELON_PRESET_IMAGE_SRC = '/images/presets/watermelon.png'
export const BANANA_PRESET_IMAGE_SRC = '/images/presets/banana.png'
export const KIWANO_PRESET_IMAGE_SRC = '/images/presets/kiwano.png'
export const PANDA_ANT_PRESET_IMAGE_SRC = '/images/presets/panda_ant.png'
export const BANANA_PRESET_POINTS = [
  3, -47, -5, -39, -17, -32, -23, -21, -27, -6, -25, 10, -19, 23, -11, 32, -2,
  41, 10, 47, 26, 47, 21, 36, 11, 27, 3, 17, -3, 7, -5, -9, -3, -25, 3, -38,
] as const
export const KIWANO_PRESET_POINTS = [
  -58, -6, -54, -20, -42, -30, -24, -37, 0, -40, 24, -37, 42, -30, 54, -18, 58,
  -3, 56, 12, 46, 24, 28, 33, 2, 36, -24, 34, -44, 24, -56, 10,
] as const
export const PANDA_ANT_PRESET_POINTS = [
  -64, 2, -52, -8, -42, -12, -28, -16, -14, -12, -4, -3, 10, -8, 24, -18, 42,
  -16, 56, -8, 68, 2, 56, 14, 44, 18, 30, 22, 12, 26, -6, 20, -18, 14, -30, 16,
  -42, 12, -54, 10,
] as const
export const PINEAPPLE_PRESET_POINTS = [
  -18, -64, -8, -90, 0, -72, 10, -96, 20, -66, 34, -78, 30, -52, 48, -36, 56,
  -8, 52, 22, 38, 50, 12, 64, -12, 64, -38, 50, -52, 24, -56, -8, -48, -36, -28,
  -52, -34, -76,
] as const
export const TOMATO_PRESET_POINTS = [
  -13, -32, -5, -41, 0, -32, 7, -41, 15, -32, 27, -24, 35, -7, 32, 15, 20, 31,
  0, 37, -20, 31, -32, 15, -35, -7, -27, -24,
] as const
export const WATERMELON_PRESET_POINTS = [
  -36, -12, -31, -24, -19, -32, 0, -35, 19, -32, 31, -24, 36, -12, 37, 7, 33,
  20, 23, 29, 7, 35, -7, 35, -23, 29, -33, 20, -37, 7,
] as const

export interface BodyPresetConfig {
  color: string
  bloodColor: string
  eyeX: number
  eyeY: number
  points: readonly number[]
  imageSrc?: string
  mirrorImageX?: boolean
  imageTargetHeight?: number
}

export interface BodyPresetBounds {
  minX: number
  minY: number
  maxX: number
  maxY: number
  width: number
  height: number
  centerX: number
  centerY: number
}

export interface EditorCharacterBodyDrawerHistorySnapshot {
  mask: EditorCanvasSnapshot
  shape: EditorCanvasSnapshot
  texture: EditorCanvasSnapshot
  layers: EditorBodyLayerSnapshot[]
  layerOrder: number[]
  brushSize: string
  color: string
  bloodColor: string
  bloodColorAssigned: boolean
  mode: BodyDrawMode
  eyeX: number
  eyeY: number
  eyeScaleX: number
  eyeScaleY: number
  eyeRotationDeg: number
  eyeStyle: MapCharacterBodyEyeStyle
  browStyle: MapCharacterBodyBrowStyle
  browOffsetX: number
  browOffsetY: number
  browScaleX: number
  browScaleY: number
  browRotationDeg: number
  contourPoints: number[]
  contourClosed: boolean
  selectedContourIndex: number
  selectedLayerId: number
  nextLayerId: number
  presetId: EditorCharacterBodyPresetId
  collisionShapes: EditorCollisionShape[]
  nextCollisionShapeId: number
  selectedCollisionShapeId: number
  collisionToolKind: EditorCollisionShapeKind
  collisionShapesCustomized: boolean
}

export interface EditorCharacterBodyDrawerHistoryContext {
  captureSnapshot: () => EditorCharacterBodyDrawerHistorySnapshot
  applySnapshot: (snapshot: EditorCharacterBodyDrawerHistorySnapshot) => void
}

export interface EditorCharacterBodyDrawerHistoryEntry {
  snapshot: EditorCharacterBodyDrawerHistorySnapshot
}
