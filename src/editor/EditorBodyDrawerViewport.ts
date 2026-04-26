import { DISPLAY_SIZE, DRAW_WORLD_SIZE } from './EditorBodyDrawerTypes'

export function getCanvasVisibleWorldSize(scale: number): number {
  return scale > 0 ? DISPLAY_SIZE / scale : DISPLAY_SIZE
}

export function clampBodyPoint(
  pointX: number,
  pointY: number
): { x: number; y: number } {
  return {
    x: Math.max(0, Math.min(DRAW_WORLD_SIZE - 1, Math.round(pointX))),
    y: Math.max(0, Math.min(DRAW_WORLD_SIZE - 1, Math.round(pointY))),
  }
}
