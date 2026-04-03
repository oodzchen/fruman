import * as fabric from 'fabric'

import { getTerrainBrushCursorStyle } from '../terrain/TerrainBrushCursor'
import type { TerrainBrushId } from '../terrain/TerrainTypes'
import { EditorTerrainLayerManager } from './EditorTerrainLayerManager'

interface EditorTerrainBrushControllerContext {
  getCanvas: () => fabric.Canvas | null
  terrainManager: EditorTerrainLayerManager
  onCommit: () => void
}

export class EditorTerrainBrushController {
  private readonly ctx: EditorTerrainBrushControllerContext
  private selectedBrushId: TerrainBrushId | null = null
  private isPainting = false
  private lastCellX = 0
  private lastCellY = 0
  private didDisableSelection = false

  constructor(ctx: EditorTerrainBrushControllerContext) {
    this.ctx = ctx
  }

  selectBrush(brushId: TerrainBrushId): void {
    this.selectedBrushId = brushId
    this.restoreCanvasCursor()
  }

  clearBrush(): void {
    this.selectedBrushId = null
    this.cancelStroke()
    this.restoreCanvasCursor()
  }

  isBrushSelected(): boolean {
    return this.selectedBrushId !== null
  }

  getSelectedBrushId(): TerrainBrushId | null {
    return this.selectedBrushId
  }

  restoreCanvasCursor(): void {
    const canvas = this.ctx.getCanvas()
    if (!canvas) {
      return
    }
    const cursor = this.selectedBrushId
      ? getTerrainBrushCursorStyle(this.selectedBrushId)
      : 'default'
    canvas.defaultCursor = cursor
    canvas.hoverCursor = cursor
    canvas.moveCursor = cursor
  }

  handlePointerDown(opt: fabric.TPointerEventInfo): boolean {
    if (!this.selectedBrushId) {
      return false
    }
    const mouseEvent = opt.e as MouseEvent
    if (mouseEvent.button !== 0) {
      return false
    }
    const canvas = this.ctx.getCanvas()
    if (!canvas) {
      return false
    }

    const pointer = canvas.getScenePoint(mouseEvent)
    const cellSizePx = this.ctx.terrainManager.getCellSizePx()
    const cellX = Math.floor(pointer.x / cellSizePx)
    const cellY = Math.floor(pointer.y / cellSizePx)

    canvas.discardActiveObject()
    this.isPainting = true
    this.lastCellX = cellX
    this.lastCellY = cellY
    if (canvas.selection) {
      this.didDisableSelection = true
      canvas.selection = false
    } else {
      this.didDisableSelection = false
    }
    this.ctx.terrainManager.beginStroke(this.selectedBrushId, cellX, cellY)
    this.ctx.terrainManager.requestRender()
    return true
  }

  handlePointerMove(opt: fabric.TPointerEventInfo): boolean {
    if (!this.isPainting) {
      return false
    }
    const canvas = this.ctx.getCanvas()
    if (!canvas) {
      return false
    }
    const mouseEvent = opt.e as MouseEvent
    const pointer = canvas.getScenePoint(mouseEvent)
    const cellSizePx = this.ctx.terrainManager.getCellSizePx()
    const cellX = Math.floor(pointer.x / cellSizePx)
    const cellY = Math.floor(pointer.y / cellSizePx)
    if (cellX === this.lastCellX && cellY === this.lastCellY) {
      return true
    }
    if (this.applyBrushLine(this.lastCellX, this.lastCellY, cellX, cellY)) {
      this.ctx.terrainManager.requestRender()
    }
    this.lastCellX = cellX
    this.lastCellY = cellY
    return true
  }

  handlePointerUp(): boolean {
    if (!this.isPainting) {
      return false
    }
    this.finalizeStroke()
    return true
  }

  private finalizeStroke(): void {
    const canvas = this.ctx.getCanvas()
    if (canvas && this.didDisableSelection) {
      canvas.selection = true
    }
    this.didDisableSelection = false
    this.isPainting = false
    const changed = this.ctx.terrainManager.finishStroke()
    this.ctx.terrainManager.requestRender()
    if (changed) {
      this.ctx.onCommit()
    }
  }

  private cancelStroke(): void {
    const canvas = this.ctx.getCanvas()
    if (canvas && this.didDisableSelection) {
      canvas.selection = true
    }
    this.didDisableSelection = false
    this.isPainting = false
    this.ctx.terrainManager.cancelStroke()
  }

  private applyBrushLine(
    fromCellX: number,
    fromCellY: number,
    toCellX: number,
    toCellY: number
  ): boolean {
    if (!this.selectedBrushId) {
      return false
    }

    let changed = false
    let x = fromCellX
    let y = fromCellY
    const dx = Math.abs(toCellX - fromCellX)
    const dy = Math.abs(toCellY - fromCellY)
    const stepX = fromCellX < toCellX ? 1 : -1
    const stepY = fromCellY < toCellY ? 1 : -1
    let error = dx - dy

    while (true) {
      if (this.ctx.terrainManager.applyStrokeCell(x, y)) {
        changed = true
      }
      if (x === toCellX && y === toCellY) {
        break
      }
      const error2 = error * 2
      if (error2 > -dy) {
        error -= dy
        x += stepX
      }
      if (error2 < dx) {
        error += dx
        y += stepY
      }
    }

    return changed
  }
}
