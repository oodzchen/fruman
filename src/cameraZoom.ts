import { DEFAULT_CAMERA_ZOOM } from './constants'

export const CAMERA_ZOOM_STEP = 0.1
export const INITIAL_CAMERA_ZOOM = import.meta.env.PROD
  ? DEFAULT_CAMERA_ZOOM
  : 1
export const CAMERA_ZOOM_KEY_STEP = import.meta.env.PROD
  ? CAMERA_ZOOM_STEP
  : 0.2

const PRODUCTION_CAMERA_ZOOM_MIN = DEFAULT_CAMERA_ZOOM - CAMERA_ZOOM_STEP
const PRODUCTION_CAMERA_ZOOM_MAX = DEFAULT_CAMERA_ZOOM + CAMERA_ZOOM_STEP

export function clampProductionCameraZoom(zoom: number): number {
  if (!import.meta.env.PROD) {
    return zoom
  }
  return Math.max(
    PRODUCTION_CAMERA_ZOOM_MIN,
    Math.min(PRODUCTION_CAMERA_ZOOM_MAX, zoom)
  )
}
