import * as fabric from 'fabric'

import type { NpcType } from '../types'

type RectOptions = NonNullable<ConstructorParameters<typeof fabric.Rect>[0]>
type CircleOptions = NonNullable<ConstructorParameters<typeof fabric.Circle>[0]>
type PolygonOptions = NonNullable<
  ConstructorParameters<typeof fabric.Polygon>[1]
>

// ========================================
// 对象池
// ========================================

const POLYGON_POINT_POOL: fabric.Point[] = []

export const acquirePoint = (x: number, y: number) => {
  const point = POLYGON_POINT_POOL.pop() ?? new fabric.Point(0, 0)
  point.x = x
  point.y = y
  return point
}

export const releasePoint = (point: fabric.Point) => {
  POLYGON_POINT_POOL.push(point)
}

// ========================================
// 编辑器配置常量
// ========================================

export const EDITOR_PIXELS_PER_METER = 50

export const DEBUG_EDITOR_MENU = false

export const DEFAULT_NPC_TYPE: NpcType = 'default'

export const EDITOR_HISTORY_MAX_ENTRIES = 60
export const EDITOR_NUDGE_STEP_PX = 1
export const EDITOR_CLIPBOARD_PASTE_OFFSET_PX = 14
export const EDITOR_VIEW_ZOOM_SCALE = 1000
export const EDITOR_VIEW_MIN_ZOOM_SCALED = 100
export const EDITOR_VIEW_MAX_ZOOM_SCALED = 20000

// ========================================
// 颜色常量
// ========================================

export const GROUND_FILL_COLOR = 'rgba(107, 74, 43, 0.85)'
export const OBSTACLE_FILL_COLOR = 'rgba(112, 64, 14, 0.85)'

export const CAMERA_FRAME_STROKE = 'rgba(220, 220, 220, 0.75)'
export const CAMERA_FRAME_FILL = 'rgba(200, 200, 200, 0.06)'
export const CAMERA_FRAME_FILL_UNFOCUSED = 'rgba(0, 0, 0, 0)'
export const CAMERA_ICON_STROKE = 'rgba(230, 230, 230, 0.9)'
export const CAMERA_ICON_FILL = 'rgba(230, 230, 230, 0.18)'

export const PLAYER_BODY_COLOR = '#FF7A1A'
export const PLAYER_EYE_COLOR = '#000000'
export const NPC_EYE_COLOR = '#000000'
export const HOOK_ANCHOR_COLOR = '#c6b07a'
export const HOOK_ANCHOR_BORDER_COLOR = '#6d5a3f'

// ========================================
// 形状配置
// ========================================

const BASE_SHAPE_OPTIONS = {
  selectable: true,
  hasControls: true,
  lockScalingFlip: true,
  objectCaching: false,
  strokeUniform: true,
  originX: 'center' as const,
  originY: 'center' as const,
}

export const GROUND_RECT_OPTIONS: RectOptions = {
  ...BASE_SHAPE_OPTIONS,
  width: 160,
  height: 44,
  fill: GROUND_FILL_COLOR,
}

export const OBSTACLE_RECT_OPTIONS: RectOptions = {
  ...BASE_SHAPE_OPTIONS,
  width: 160,
  height: 44,
  fill: OBSTACLE_FILL_COLOR,
}

export const GROUND_CIRCLE_OPTIONS: CircleOptions = {
  ...BASE_SHAPE_OPTIONS,
  radius: 60,
  fill: GROUND_FILL_COLOR,
}

export const OBSTACLE_CIRCLE_OPTIONS: CircleOptions = {
  ...BASE_SHAPE_OPTIONS,
  radius: 60,
  fill: OBSTACLE_FILL_COLOR,
}

export const TRIANGLE_POINT_DATA: ReadonlyArray<readonly [number, number]> = [
  [-70, 50],
  [0, -60],
  [70, 50],
]

export const POLYGON_POINT_DATA: ReadonlyArray<readonly [number, number]> = [
  [-90, -40],
  [60, -60],
  [110, 10],
  [60, 70],
  [-80, 60],
]

export const GROUND_TRIANGLE_OPTIONS: PolygonOptions = {
  ...BASE_SHAPE_OPTIONS,
  fill: GROUND_FILL_COLOR,
}

export const OBSTACLE_TRIANGLE_OPTIONS: PolygonOptions = {
  ...BASE_SHAPE_OPTIONS,
  fill: OBSTACLE_FILL_COLOR,
}

export const GROUND_EDITABLE_POLYGON_OPTIONS: PolygonOptions = {
  ...BASE_SHAPE_OPTIONS,
  fill: GROUND_FILL_COLOR,
  perPixelTargetFind: false,
}

export const OBSTACLE_EDITABLE_POLYGON_OPTIONS: PolygonOptions = {
  ...BASE_SHAPE_OPTIONS,
  fill: OBSTACLE_FILL_COLOR,
  perPixelTargetFind: false,
}

export const CAMERA_FRAME_OPTIONS: RectOptions = {
  fill: CAMERA_FRAME_FILL,
  stroke: CAMERA_FRAME_STROKE,
  strokeWidth: 2,
  strokeDashArray: [6, 6],
  originX: 'center',
  originY: 'center',
  selectable: true,
  hasControls: true,
  lockScalingFlip: true,
  lockRotation: true,
  lockUniScaling: true,
  centeredScaling: true,
  objectCaching: false,
  strokeUniform: true,
  cornerStyle: 'circle',
  cornerColor: 'rgba(230, 230, 230, 0.9)',
  cornerStrokeColor: 'rgba(20, 20, 20, 0.4)',
  cornerSize: 10,
  transparentCorners: false,
}

// ========================================
// 辅助函数
// ========================================

export const createTrianglePoints = () => {
  const points: fabric.Point[] = new Array(TRIANGLE_POINT_DATA.length)
  for (let i = 0; i < TRIANGLE_POINT_DATA.length; i++) {
    const data = TRIANGLE_POINT_DATA[i]
    points[i] = acquirePoint(data[0], data[1])
  }
  return points
}

export const createEditablePolygonPoints = () => {
  const points: fabric.Point[] = new Array(POLYGON_POINT_DATA.length)
  for (let i = 0; i < POLYGON_POINT_DATA.length; i++) {
    const data = POLYGON_POINT_DATA[i]
    points[i] = acquirePoint(data[0], data[1])
  }
  return points
}
