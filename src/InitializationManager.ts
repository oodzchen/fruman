import { localizer } from './Localizer'

interface InitializationManagerOptions {
  titleKey?: string
  visible?: boolean
}

export class InitializationManager {
  private container: HTMLElement
  private wrapper: HTMLDivElement
  private titleEl: HTMLDivElement
  private barEl: HTMLDivElement
  private labelEl: HTMLDivElement
  private progressPercent = 0
  private currentStep = ''
  private steps: string[] = []
  private completedSteps = 0

  constructor(
    container: HTMLElement,
    options: InitializationManagerOptions = {}
  ) {
    this.container = container

    const wrapper = document.createElement('div')
    const display = options.visible === false ? 'none' : 'flex'
    wrapper.style.cssText = `position:absolute;inset:0;display:${display};flex-direction:column;align-items:center;justify-content:center;background:#0b0c0e;z-index:100;font-family:monospace;color:#fff`

    const title = document.createElement('div')
    title.style.cssText = 'font-size:32px;margin-bottom:40px'
    title.textContent = localizer.t(options.titleKey ?? 'title')

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
    this.wrapper = wrapper
    this.titleEl = title
  }

  setTitle(titleKey: string) {
    this.titleEl.textContent = localizer.t(titleKey)
  }

  setSteps(steps: readonly string[]) {
    this.steps = [...steps]
    this.completedSteps = 0
    this.progressPercent = 0
  }

  nextStep(stepName: string) {
    this.currentStep = stepName
    this.completedSteps++
    this.progressPercent = Math.floor(
      (this.completedSteps * 100) / Math.max(1, this.steps.length)
    )
    this.render()
  }

  setProgressPercent(stepName: string, progressPercent: number) {
    this.currentStep = stepName
    this.progressPercent = Math.min(100, Math.max(0, progressPercent | 0))
    this.render()
  }

  complete() {
    this.progressPercent = 100
    this.render()
  }

  show() {
    this.wrapper.style.display = 'flex'
  }

  hide() {
    this.wrapper.style.display = 'none'
  }

  isVisible(): boolean {
    return this.wrapper.style.display !== 'none'
  }

  remove() {
    this.wrapper.remove()
  }

  private render() {
    this.barEl.style.width = `${this.progressPercent}%`
    this.labelEl.textContent = `${this.progressPercent}% - ${localizer.t(this.currentStep)}`
  }
}
