import * as fabric from 'fabric'

import { getTerrainBrushCursorStyle } from '../../terrain/TerrainBrushCursor'
import type { TerrainBrushId } from '../../terrain/TerrainTypes'
import { EditorTerrainLayerManager } from './EditorTerrainLayerManager'

interface EditorTerrainBrushControllerContext {
  getCanvas: () => fabric.Canvas | null
  terrainManager: EditorTerrainLayerManager
  isObjectLocked: (object: fabric.Object | null) => boolean
  onCommit: () => void
}

export class EditorTerrainBrushController {
  private readonly ctx: EditorTerrainBrushControllerContext
  private selectedBrushId: TerrainBrushId | null = null
  private isPainting = false
  private lastCellX = 0
  private lastCellY = 0
  private didDisableSelection = false
  private didDisableCanvasSelectionForBrush = false

  constructor(ctx: EditorTerrainBrushControllerContext) {
    this.ctx = ctx
  }

  selectBrush(brushId: TerrainBrushId): void {
    this.selectedBrushId = brushId
    this.ctx.terrainManager.setContourEditMode(brushId === 'contour')
    this.applyCanvasSelectionForBrush()
    this.restoreCanvasCursor()
  }

  clearBrush(): void {
    this.selectedBrushId = null
    this.cancelStroke()
    this.ctx.terrainManager.setContourEditMode(false)
    this.restoreCanvasSelectionForBrush()
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
    if (this.selectedBrushId) {
      this.applyCanvasSelectionForBrush()
    } else {
      this.restoreCanvasSelectionForBrush()
    }
  }

  handlePointerDown(opt: fabric.TPointerEventInfo): boolean {
    const mouseEvent = opt.e as MouseEvent
    if (mouseEvent.button !== 0) {
      return false
    }
    if (this.ctx.isObjectLocked(opt.target ?? null)) {
      return false
    }
    if (!this.selectedBrushId) {
      return this.ctx.terrainManager.handleSelectionContourPointerDown(opt)
    }
    if (this.selectedBrushId === 'contour') {
      return this.ctx.terrainManager.handleContourPointerDown(opt)
    }
    const canvas = this.ctx.getCanvas()
    if (!canvas) {
      return false
    }

    const pointer = canvas.getScenePoint(mouseEvent)
    const pickedCell = this.ctx.terrainManager.pickStrokeCell(
      pointer.x,
      pointer.y
    )
    const cellX = pickedCell.cellX
    const cellY = pickedCell.cellY

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
    if (!this.selectedBrushId) {
      return this.ctx.terrainManager.handleSelectionContourPointerMove(opt)
    }
    if (this.selectedBrushId === 'contour') {
      return this.ctx.terrainManager.handleContourPointerMove(opt)
    }
    if (!this.isPainting) {
      return false
    }
    const canvas = this.ctx.getCanvas()
    if (!canvas) {
      return false
    }
    const mouseEvent = opt.e as MouseEvent
    const pointer = canvas.getScenePoint(mouseEvent)
    const pickedCell = this.ctx.terrainManager.pickStrokeCell(
      pointer.x,
      pointer.y
    )
    const cellX = pickedCell.cellX
    const cellY = pickedCell.cellY
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
    if (!this.selectedBrushId) {
      const changed = this.ctx.terrainManager.handleSelectionContourPointerUp()
      if (changed) {
        this.ctx.onCommit()
      }
      return changed
    }
    if (this.selectedBrushId === 'contour') {
      const changed = this.ctx.terrainManager.handleContourPointerUp()
      if (changed) {
        this.ctx.onCommit()
      }
      return changed
    }
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
    this.restoreCanvasCursor()
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
    this.restoreCanvasCursor()
  }

  private applyCanvasSelectionForBrush(): void {
    const canvas = this.ctx.getCanvas()
    if (!canvas) {
      return
    }
    if (this.selectedBrushId && canvas.selection) {
      canvas.selection = false
      this.didDisableCanvasSelectionForBrush = true
      return
    }
    this.didDisableCanvasSelectionForBrush = false
  }

  private restoreCanvasSelectionForBrush(): void {
    const canvas = this.ctx.getCanvas()
    if (!canvas || !this.didDisableCanvasSelectionForBrush) {
      return
    }
    canvas.selection = true
    this.didDisableCanvasSelectionForBrush = false
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
