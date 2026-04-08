import { localizer } from './Localizer'

export class InitializationManager {
  private container: HTMLElement
  private barEl: HTMLDivElement
  private labelEl: HTMLDivElement
  private progress = 0
  private currentStep = ''
  private steps: string[] = []
  private completedSteps = 0

  constructor(container: HTMLElement) {
    this.container = container

    const wrapper = document.createElement('div')
    wrapper.style.cssText =
      'position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;background:#0b0c0e;z-index:100;font-family:monospace;color:#fff'

    const title = document.createElement('div')
    title.style.cssText = 'font-size:32px;margin-bottom:40px'
    title.textContent = localizer.t('title')

    const barOuter = document.createElement('div')
    barOuter.style.cssText =
      'width:400px;height:30px;border:2px solid #fff;position:relative'

    this.barEl = document.createElement('div')
    this.barEl.style.cssText = 'height:100%;width:0;background:#fff'
    barOuter.appendChild(this.barEl)

    this.labelEl = document.createElement('div')
    this.labelEl.style.cssText = 'margin-top:16px;font-size:16px;color:#aaa'

    wrapper.appendChild(title)
    wrapper.appendChild(barOuter)
    wrapper.appendChild(this.labelEl)
    this.container.appendChild(wrapper)
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

  remove() {
    const wrapper = this.barEl.parentElement?.parentElement
    wrapper?.remove()
  }

  private render() {
    this.barEl.style.width = `${this.progress * 100}%`
    const pct = Math.floor(this.progress * 100)
    this.labelEl.textContent = `${pct}% - ${localizer.t(this.currentStep)}`
  }
}
