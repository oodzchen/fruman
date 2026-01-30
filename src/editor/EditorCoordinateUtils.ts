import type { EditorMapData } from '../editorMapTypes'

export interface CameraCenterResult {
  zoom: number
  centerX: number
  centerY: number
}

export interface CameraOffsetResult {
  x: number
  y: number
  zoom: number
}

export function computeCameraCenterFromOffset(
  camera: EditorMapData['camera'],
  canvasWidth: number,
  canvasHeight: number,
  invPixelsPerMeter: number
): CameraCenterResult {
  const zoom = camera.zoom > 0 ? camera.zoom : 1
  const invZoom = 1 / zoom
  const canvasWidthMeters = canvasWidth * invPixelsPerMeter
  const canvasHeightMeters = canvasHeight * invPixelsPerMeter
  const anchorX = canvasWidthMeters * 0.5
  const anchorY = canvasHeightMeters
  const viewWidth = canvasWidthMeters * invZoom
  const viewHeight = canvasHeightMeters * invZoom
  const left = anchorX * (1 - invZoom) + camera.x
  const top = anchorY * (1 - invZoom) + camera.y
  const centerX = left + viewWidth * 0.5
  const centerY = top + viewHeight * 0.5
  return { centerX, centerY, zoom }
}

export function computeCameraOffsetFromCenter(
  centerX: number,
  centerY: number,
  zoom: number,
  canvasWidth: number,
  canvasHeight: number,
  invPixelsPerMeter: number
): CameraOffsetResult {
  const invZoom = zoom > 0 ? 1 / zoom : 1
  const canvasWidthMeters = canvasWidth * invPixelsPerMeter
  const canvasHeightMeters = canvasHeight * invPixelsPerMeter
  const anchorX = canvasWidthMeters * 0.5
  const anchorY = canvasHeightMeters
  const viewWidth = canvasWidthMeters * invZoom
  const viewHeight = canvasHeightMeters * invZoom
  const desiredLeft = centerX - viewWidth * 0.5
  const desiredTop = centerY - viewHeight * 0.5
  const cameraX = desiredLeft - anchorX * (1 - invZoom)
  const cameraY = desiredTop - anchorY * (1 - invZoom)
  return { x: cameraX, y: cameraY, zoom }
}
