import { fabric } from 'fabric'

import type { GameClient } from '../GameClient'
import type { EditorCameraManager } from './EditorCameraManager'
import type { EditorMapSerializer } from './EditorMapSerializer'
import type { CameraFrame, EditorMap } from './types'

interface EditorThumbnailCaptureContext {
  fabricCanvas: () => fabric.Canvas | null
  gameCanvas: HTMLCanvasElement
  gameClient: () => GameClient | null
  mapSerializer: EditorMapSerializer
  cameraManager: EditorCameraManager
  currentMapMeta: () => EditorMap | null
}

export class EditorThumbnailCapture {
  private ctx: EditorThumbnailCaptureContext

  constructor(ctx: EditorThumbnailCaptureContext) {
    this.ctx = ctx
  }

  async capture(): Promise<string | null> {
    if (this.ctx.gameClient()) {
      return this.captureFromPreview()
    }
    return this.captureFromEditor()
  }

  private async captureFromPreview(): Promise<string | null> {
    const gameClient = this.ctx.gameClient()
    if (!gameClient) {
      return null
    }

    const data = this.ctx.mapSerializer.serializeCurrentMapData()

    this.ctx.gameCanvas.style.visibility = 'visible'

    gameClient.setAudioMuted(true)
    gameClient.applyMapPreview(data)
    gameClient.start()

    await new Promise((resolve) => setTimeout(resolve, 1000))

    const snapshotDataUrl = this.ctx.gameCanvas.toDataURL('image/jpeg', 0.8)

    gameClient.clearMapPreview()
    gameClient.stop()
    gameClient.setEditorPreview(true)
    gameClient.setAudioMuted(false)
    this.ctx.gameCanvas.style.visibility = 'hidden'

    if (!snapshotDataUrl) return null
    return this.resizeThumbnail(snapshotDataUrl, 200, 160)
  }

  private async captureFromEditor(): Promise<string | null> {
    const fabricCanvas = this.ctx.fabricCanvas()
    if (!fabricCanvas) {
      return null
    }

    const originalTransform = fabricCanvas.viewportTransform?.slice()
    const originalWidth = fabricCanvas.width ?? 800
    const originalHeight = fabricCanvas.height ?? 600

    let cameraFrame: CameraFrame | null = null
    if (this.ctx.cameraManager.getCameraViews().length > 0) {
      cameraFrame = this.ctx.cameraManager.getCameraViews()[0].frame
    }

    fabricCanvas.discardActiveObject()
    fabricCanvas.requestRenderAll()

    let snapshotDataUrl = ''

    if (cameraFrame && cameraFrame.width && cameraFrame.height) {
      const wasVisible = cameraFrame.visible
      const wasIconVisible =
        this.ctx.cameraManager.getCameraViews()[0].icon.visible
      cameraFrame.visible = false
      this.ctx.cameraManager.getCameraViews()[0].icon.visible = false

      const frameWidth = (cameraFrame.width ?? 0) * (cameraFrame.scaleX ?? 1)
      const frameHeight = (cameraFrame.height ?? 0) * (cameraFrame.scaleY ?? 1)

      const scaleX = originalWidth / frameWidth
      const scaleY = originalHeight / frameHeight
      const scale = Math.min(scaleX, scaleY)

      const centerX = cameraFrame.left ?? 0
      const centerY = cameraFrame.top ?? 0

      const tx = originalWidth / 2 - centerX * scale
      const ty = originalHeight / 2 - centerY * scale

      fabricCanvas.setViewportTransform([scale, 0, 0, scale, tx, ty])
      fabricCanvas.renderAll()

      snapshotDataUrl = fabricCanvas.toDataURL({
        format: 'jpeg',
        quality: 0.8,
        multiplier: 1,
      })

      cameraFrame.visible = wasVisible
      this.ctx.cameraManager.getCameraViews()[0].icon.visible = wasIconVisible
    } else {
      snapshotDataUrl = fabricCanvas.toDataURL({
        format: 'jpeg',
        quality: 0.8,
      })
    }

    if (originalTransform) {
      fabricCanvas.setViewportTransform(originalTransform)
    }
    fabricCanvas.renderAll()

    if (!snapshotDataUrl) return null
    return this.resizeThumbnail(snapshotDataUrl, 200, 160)
  }

  private resizeThumbnail(
    dataUrl: string,
    width: number,
    height: number
  ): Promise<string> {
    return new Promise((resolve) => {
      const img = new Image()
      img.onload = () => {
        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        const ctx = canvas.getContext('2d')
        if (!ctx) {
          resolve(dataUrl)
          return
        }

        const srcRatio = img.width / img.height
        const dstRatio = width / height

        let drawW = width
        let drawH = height
        let offsetX = 0
        let offsetY = 0

        if (srcRatio > dstRatio) {
          drawH = height
          drawW = height * srcRatio
          offsetX = (width - drawW) / 2
        } else {
          drawW = width
          drawH = width / srcRatio
          offsetY = (height - drawH) / 2
        }

        ctx.drawImage(img, offsetX, offsetY, drawW, drawH)
        resolve(canvas.toDataURL('image/jpeg', 0.8))
      }
      img.onerror = () => resolve(dataUrl)
      img.src = dataUrl
    })
  }
}
