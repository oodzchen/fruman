export interface TooltipManagerOptions {
  root: HTMLElement
  parent?: HTMLElement
  attributeName?: string
}

export class TooltipManager {
  private readonly root: HTMLElement
  private readonly tooltipEl: HTMLDivElement
  private readonly attributeName: string
  private activeTarget: HTMLElement | null = null
  private lastClientX = 0
  private lastClientY = 0

  constructor(options: TooltipManagerOptions) {
    this.root = options.root
    this.attributeName = options.attributeName ?? 'data-tooltip'
    this.tooltipEl = document.createElement('div')
    this.tooltipEl.className = 'global-tooltip'
    this.tooltipEl.setAttribute('role', 'tooltip')
    this.tooltipEl.setAttribute('aria-hidden', 'true')
    const parent = options.parent ?? this.root
    parent.appendChild(this.tooltipEl)

    this.root.addEventListener('pointerover', this.handlePointerOver, true)
    this.root.addEventListener('pointerout', this.handlePointerOut, true)
    this.root.addEventListener('pointermove', this.handlePointerMove, true)
    this.root.addEventListener('focusin', this.handleFocusIn, true)
    this.root.addEventListener('focusout', this.handleFocusOut, true)
  }

  hide(): void {
    this.activeTarget = null
    this.tooltipEl.classList.remove('is-visible')
    this.tooltipEl.setAttribute('aria-hidden', 'true')
  }

  private handlePointerOver = (event: PointerEvent): void => {
    const target = this.resolveTarget(event.target)
    if (!target) {
      return
    }
    this.lastClientX = Math.round(event.clientX)
    this.lastClientY = Math.round(event.clientY)
    this.show(target)
  }

  private handlePointerOut = (event: PointerEvent): void => {
    const active = this.activeTarget
    if (!active) {
      return
    }
    const related = event.relatedTarget
    if (related instanceof Node && active.contains(related)) {
      return
    }
    this.hide()
  }

  private handlePointerMove = (event: PointerEvent): void => {
    if (!this.activeTarget) {
      return
    }
    this.lastClientX = Math.round(event.clientX)
    this.lastClientY = Math.round(event.clientY)
    this.updatePosition(this.lastClientX, this.lastClientY)
  }

  private handleFocusIn = (event: FocusEvent): void => {
    const target = this.resolveTarget(event.target)
    if (!target) {
      return
    }
    const rect = target.getBoundingClientRect()
    this.lastClientX = Math.round(rect.left + rect.width / 2)
    this.lastClientY = Math.round(rect.bottom)
    this.show(target)
  }

  private handleFocusOut = (): void => {
    this.hide()
  }

  private show(target: HTMLElement): void {
    const text = target.getAttribute(this.attributeName)
    if (!text) {
      this.hide()
      return
    }
    this.activeTarget = target
    this.tooltipEl.textContent = text
    this.tooltipEl.classList.add('is-visible')
    this.tooltipEl.setAttribute('aria-hidden', 'false')
    this.updatePosition(this.lastClientX, this.lastClientY)
  }

  private resolveTarget(target: EventTarget | null): HTMLElement | null {
    if (!(target instanceof Element)) {
      return null
    }
    const selector = `[${this.attributeName}]`
    const element = target.closest<HTMLElement>(selector)
    if (!element || !this.root.contains(element)) {
      return null
    }
    const text = element.getAttribute(this.attributeName)
    return text && text.length > 0 ? element : null
  }

  private updatePosition(clientX: number, clientY: number): void {
    const rootRect = this.root.getBoundingClientRect()
    const tooltipRect = this.tooltipEl.getBoundingClientRect()
    const offset = 12
    let x = clientX + offset
    let y = clientY + offset

    if (x + tooltipRect.width > rootRect.right) {
      x = clientX - Math.round(tooltipRect.width) - offset
    }
    if (y + tooltipRect.height > rootRect.bottom) {
      y = clientY - Math.round(tooltipRect.height) - offset
    }
    if (x < rootRect.left + 4) {
      x = Math.round(rootRect.left) + 4
    }
    if (y < rootRect.top + 4) {
      y = Math.round(rootRect.top) + 4
    }

    this.tooltipEl.style.left = `${Math.round(x)}px`
    this.tooltipEl.style.top = `${Math.round(y)}px`
  }
}
