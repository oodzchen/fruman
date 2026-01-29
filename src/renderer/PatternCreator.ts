export class PatternCreator {
  static createBackgroundPattern(
    targetCtx: CanvasRenderingContext2D
  ): CanvasPattern | null {
    const canvas = this.drawBackgroundToCanvas()
    if (!canvas) return null
    return targetCtx.createPattern(canvas, 'repeat')
  }

  static createBackgroundImage(): HTMLImageElement | null {
    const canvas = this.drawBackgroundToCanvas()
    if (!canvas) return null
    const image = new Image()
    image.src = canvas.toDataURL('image/png')
    return image
  }

  static createGroundPattern(
    targetCtx: CanvasRenderingContext2D
  ): CanvasPattern | null {
    const canvas = this.drawGroundToCanvas()
    if (!canvas) return null
    return targetCtx.createPattern(canvas, 'repeat')
  }

  static createGroundImage(onLoad?: () => void): HTMLImageElement | null {
    const canvas = this.drawGroundToCanvas()
    if (!canvas) return null
    const image = new Image()
    image.src = canvas.toDataURL('image/png')
    if (onLoad) {
      image.onload = onLoad
    }
    return image
  }

  static createObstaclePattern(
    targetCtx: CanvasRenderingContext2D
  ): CanvasPattern | null {
    const canvas = this.drawObstacleToCanvas()
    if (!canvas) return null
    return targetCtx.createPattern(canvas, 'repeat')
  }

  static createObstacleImage(onLoad?: () => void): HTMLImageElement | null {
    const canvas = this.drawObstacleToCanvas()
    if (!canvas) return null
    const image = new Image()
    image.src = canvas.toDataURL('image/png')
    if (onLoad) {
      image.onload = onLoad
    }
    return image
  }

  private static drawBackgroundToCanvas(): HTMLCanvasElement | null {
    const patternSize = 80
    const patternCanvas = document.createElement('canvas')
    patternCanvas.width = patternSize
    patternCanvas.height = patternSize
    const patternCtx = patternCanvas.getContext('2d')
    if (!patternCtx) return null

    patternCtx.fillStyle = '#0b0c0e'
    patternCtx.fillRect(0, 0, patternSize, patternSize)

    patternCtx.strokeStyle = '#394155'
    patternCtx.lineWidth = 1

    const drawTriangle = (
      x1: number,
      y1: number,
      x2: number,
      y2: number,
      x3: number,
      y3: number
    ) => {
      patternCtx.beginPath()
      patternCtx.moveTo(x1, y1)
      patternCtx.lineTo(x2, y2)
      patternCtx.lineTo(x3, y3)
      patternCtx.closePath()
      patternCtx.stroke()
    }

    const halfSize = patternSize / 2
    const height = (Math.sqrt(3) / 2) * halfSize

    drawTriangle(0, height, halfSize, 0, halfSize, height)
    drawTriangle(halfSize, 0, patternSize, height, halfSize, height)
    drawTriangle(0, height, halfSize, height * 2, halfSize, height)
    drawTriangle(halfSize, height * 2, patternSize, height, halfSize, height)

    patternCtx.beginPath()
    patternCtx.moveTo(0, height)
    patternCtx.lineTo(patternSize, height)
    patternCtx.stroke()

    return patternCanvas
  }

  private static drawGroundToCanvas(): HTMLCanvasElement | null {
    const size = 96
    const patternCanvas = document.createElement('canvas')
    patternCanvas.width = size
    patternCanvas.height = size
    const patternCtx = patternCanvas.getContext('2d')
    if (!patternCtx) return null

    patternCtx.fillStyle = '#826343'
    patternCtx.fillRect(0, 0, size, size)

    patternCtx.strokeStyle = '#a29f4f'
    patternCtx.lineWidth = 1

    const mid = size / 2
    patternCtx.beginPath()
    patternCtx.moveTo(0, mid)
    patternCtx.lineTo(mid, 0)
    patternCtx.lineTo(size, mid)
    patternCtx.lineTo(mid, size)
    patternCtx.closePath()
    patternCtx.stroke()

    patternCtx.beginPath()
    patternCtx.moveTo(mid / 2, mid)
    patternCtx.lineTo(mid, mid / 2)
    patternCtx.lineTo((mid * 3) / 2, mid)
    patternCtx.lineTo(mid, (mid * 3) / 2)
    patternCtx.closePath()
    patternCtx.stroke()

    return patternCanvas
  }

  private static drawObstacleToCanvas(): HTMLCanvasElement | null {
    const size = 88
    const patternCanvas = document.createElement('canvas')
    patternCanvas.width = size
    patternCanvas.height = size
    const patternCtx = patternCanvas.getContext('2d')
    if (!patternCtx) return null

    patternCtx.fillStyle = '#70400e'
    patternCtx.fillRect(0, 0, size, size)

    patternCtx.strokeStyle = '#d7a168'
    patternCtx.lineWidth = 1

    const radius = size / 4
    const rowHeight = Math.sqrt(3) * radius

    const drawHex = (cx: number, cy: number) => {
      patternCtx.beginPath()
      for (let i = 0; i < 6; i += 1) {
        const angle = (Math.PI / 3) * i + Math.PI / 6
        const x = cx + radius * Math.cos(angle)
        const y = cy + radius * Math.sin(angle)
        if (i === 0) {
          patternCtx.moveTo(x, y)
        } else {
          patternCtx.lineTo(x, y)
        }
      }
      patternCtx.closePath()
      patternCtx.stroke()
    }

    for (let row = -1; row <= 2; row += 1) {
      const y = row * rowHeight + rowHeight
      for (let col = -1; col <= 2; col += 1) {
        const xOffset = row % 2 === 0 ? 0 : radius
        const x = col * radius * 2 + radius + xOffset
        drawHex(x, y)
      }
    }

    return patternCanvas
  }
}
