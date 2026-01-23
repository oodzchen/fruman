import { localizer } from './Localizer'

export class InitializationManager {
  private canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private progress = 0
  private currentStep = ''
  private steps: string[] = []
  private completedSteps = 0

  constructor(canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D) {
    this.canvas = canvas
    this.ctx = ctx
  }

  setSteps(steps: string[]) {
    this.steps = steps
    this.completedSteps = 0
    this.progress = 0
  }

  nextStep(stepName: string) {
    this.currentStep = stepName
    this.completedSteps++
    this.progress = this.completedSteps / this.steps.length
    this.render()
  }

  complete() {
    this.progress = 1
    this.render()
  }

  render() {
    const width = this.canvas.width
    const height = this.canvas.height

    this.ctx.clearRect(0, 0, width, height)

    this.ctx.fillStyle = '#0b0c0e'
    this.ctx.fillRect(0, 0, width, height)

    const centerX = width / 2
    const centerY = height / 2

    this.ctx.font = '32px monospace'
    this.ctx.fillStyle = '#ffffff'
    this.ctx.textAlign = 'center'
    this.ctx.fillText(localizer.t('title'), centerX, centerY - 80)

    const barWidth = 400
    const barHeight = 30
    const barX = centerX - barWidth / 2
    const barY = centerY - barHeight / 2

    this.ctx.strokeStyle = '#ffffff'
    this.ctx.lineWidth = 2
    this.ctx.strokeRect(barX, barY, barWidth, barHeight)

    const progressWidth = barWidth * this.progress
    this.ctx.fillStyle = '#ffffff'
    this.ctx.fillRect(barX, barY, progressWidth, barHeight)

    this.ctx.font = '16px monospace'
    this.ctx.fillStyle = '#aaaaaa'
    const progressPercent = Math.floor(this.progress * 100)
    const stepText = localizer.t(this.currentStep)
    this.ctx.fillText(
      `${progressPercent}% - ${stepText}`,
      centerX,
      centerY + 60
    )
  }
}
