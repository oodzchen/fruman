import { localizer } from './Localizer'
import type {
  PlayerUpgradeLevelsLike,
  PlayerUpgradeStat,
} from './playerUpgrade'
import {
  PLAYER_UPGRADE_STAT_ORDER,
  getPlayerUpgradePreviewPercent,
  isPlayerUpgradeStatMaxed,
} from './playerUpgrade'

const SVG_NS = 'http://www.w3.org/2000/svg'
const LEVEL_UP_TRANSITION_MS = 600
const LEVEL_UP_TRANSITION_EASING = 'cubic-bezier(0.22, 1, 0.36, 1)'
const LEVEL_UP_PANEL_HIDDEN_TRANSFORM = 'translate(-50%, calc(-50% + 100vh))'
const LEVEL_UP_PANEL_VISIBLE_TRANSFORM = 'translate(-50%, -50%)'
const LEVEL_VALUE_TRANSITION_MS = 1280
const LEVEL_VALUE_TRANSITION_EASING = 'cubic-bezier(0.2, 0.8, 0.2, 1)'
const LEVEL_VALUE_TRANSITION_DELAY_MS = 500

export interface LevelUpPromptState extends PlayerUpgradeLevelsLike {
  previousLevel?: number
  level: number
  pendingPoints: number
}

type SelectionHandler = (stat: PlayerUpgradeStat) => void

export class LevelUpManager {
  private container: HTMLDivElement
  private overlay: HTMLDivElement
  private panel: HTMLDivElement
  private levelPrefix: HTMLSpanElement
  private levelSuffix: HTMLSpanElement
  private levelValueViewport: HTMLSpanElement
  private levelValueCurrent: HTMLSpanElement
  private levelValueNext: HTMLSpanElement
  private list: HTMLDivElement
  private buttons: HTMLButtonElement[] = []
  private labels: HTMLDivElement[] = []
  private disabled: boolean[] = []
  private selectedIndex = 0
  private isOpenFlag = false
  private readonly inputTarget: HTMLElement
  private currentState: LevelUpPromptState | null = null
  private selectionHandler: SelectionHandler | null = null
  private boundHandleKeyDown: (event: KeyboardEvent) => void
  private pendingLevelValueAnimation = false
  private levelValueAnimationFrame = 0

  constructor(parentElement: HTMLElement, inputTarget: HTMLElement) {
    this.inputTarget = inputTarget
    this.container = document.createElement('div')
    this.container.style.cssText = `
      position: absolute;
      inset: 0;
      display: none;
      z-index: 95;
      pointer-events: none;
      font-family: monospace;
      color: #f5e9d4;
    `

    this.overlay = document.createElement('div')
    this.overlay.style.cssText = `
      position: absolute;
      inset: 0;
      background:
        radial-gradient(circle at 50% 42%, rgba(90, 70, 38, 0.16), transparent 46%),
        rgba(5, 6, 5, 0.56);
      opacity: 0;
      transition: opacity ${LEVEL_UP_TRANSITION_MS}ms ${LEVEL_UP_TRANSITION_EASING};
      pointer-events: auto;
    `

    this.panel = document.createElement('div')
    this.panel.style.cssText = `
      position: absolute;
      left: 50%;
      top: 50%;
      width: min(540px, calc(100% - 32px));
      transform: ${LEVEL_UP_PANEL_HIDDEN_TRANSFORM};
      opacity: 0;
      padding: 20px 18px 16px;
      border: 1px solid rgba(198, 170, 118, 0.42);
      background:
        linear-gradient(180deg, rgba(19, 18, 14, 0.96), rgba(10, 10, 8, 0.98));
      box-shadow:
        0 18px 60px rgba(0, 0, 0, 0.42);
      transition:
        transform ${LEVEL_UP_TRANSITION_MS}ms ${LEVEL_UP_TRANSITION_EASING},
        opacity ${LEVEL_UP_TRANSITION_MS}ms ${LEVEL_UP_TRANSITION_EASING};
      pointer-events: auto;
      box-sizing: border-box;
    `

    const header = document.createElement('div')
    header.style.cssText = `
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 14px;
      margin-bottom: 16px;
    `

    const titleIcon = this.createHeaderArrowIcon()

    const levelTitle = document.createElement('div')
    levelTitle.style.cssText = `
      display: inline-flex;
      align-items: center;
      justify-content: center;
      text-align: center;
      font-size: 30px;
      font-weight: 700;
      color: #f7ebd1;
      letter-spacing: 2px;
      box-sizing: border-box;
    `

    this.levelPrefix = document.createElement('span')
    this.levelPrefix.style.cssText = `
      white-space: pre;
    `

    this.levelValueViewport = document.createElement('span')
    this.levelValueViewport.style.cssText = `
      position: relative;
      display: inline-flex;
      align-items: flex-start;
      justify-content: center;
      width: 2ch;
      height: 1.2em;
      overflow: hidden;
      vertical-align: top;
    `

    this.levelValueCurrent = document.createElement('span')
    this.levelValueCurrent.style.cssText = `
      position: absolute;
      left: 0;
      top: 0;
      width: 100%;
      text-align: center;
      transform: translateY(0);
      opacity: 1;
      transition:
        transform ${LEVEL_VALUE_TRANSITION_MS}ms ${LEVEL_VALUE_TRANSITION_EASING},
        opacity ${LEVEL_VALUE_TRANSITION_MS}ms ${LEVEL_VALUE_TRANSITION_EASING};
    `

    this.levelValueNext = document.createElement('span')
    this.levelValueNext.style.cssText = `
      position: absolute;
      left: 0;
      top: 0;
      width: 100%;
      text-align: center;
      transform: translateY(100%);
      opacity: 0;
      transition:
        transform ${LEVEL_VALUE_TRANSITION_MS}ms ${LEVEL_VALUE_TRANSITION_EASING},
        opacity ${LEVEL_VALUE_TRANSITION_MS}ms ${LEVEL_VALUE_TRANSITION_EASING};
    `

    this.levelSuffix = document.createElement('span')
    this.levelSuffix.style.cssText = `
      white-space: pre;
    `

    this.levelValueViewport.appendChild(this.levelValueCurrent)
    this.levelValueViewport.appendChild(this.levelValueNext)
    levelTitle.appendChild(this.levelPrefix)
    levelTitle.appendChild(this.levelValueViewport)
    levelTitle.appendChild(this.levelSuffix)

    header.appendChild(titleIcon)
    header.appendChild(levelTitle)

    this.list = document.createElement('div')
    this.list.style.cssText = `
      display: flex;
      flex-direction: column;
      gap: 10px;
    `

    this.panel.appendChild(header)
    this.panel.appendChild(this.list)
    this.container.appendChild(this.overlay)
    this.container.appendChild(this.panel)
    parentElement.appendChild(this.container)

    this.boundHandleKeyDown = this.handleKeyDown.bind(this)
    this.panel.addEventListener('transitionend', (event) => {
      if (
        event.target !== this.panel ||
        event.propertyName !== 'transform' ||
        !this.pendingLevelValueAnimation ||
        !this.isOpenFlag
      ) {
        return
      }
      this.startLevelValueAnimation()
    })

    for (let i = 0; i < PLAYER_UPGRADE_STAT_ORDER.length; i++) {
      const stat = PLAYER_UPGRADE_STAT_ORDER[i]
      const row = this.createOptionButton(stat, i)
      this.list.appendChild(row)
    }
  }

  setSelectionHandler(handler: SelectionHandler | null): void {
    this.selectionHandler = handler
  }

  isOpen(): boolean {
    return this.isOpenFlag
  }

  show(state: LevelUpPromptState): void {
    this.currentState = state
    const wasOpen = this.isOpenFlag
    if (!this.isOpenFlag) {
      this.inputTarget.addEventListener(
        'keydown',
        this.boundHandleKeyDown,
        true
      )
    }
    this.isOpenFlag = true
    this.container.style.display = 'block'
    this.container.style.pointerEvents = 'auto'
    if (!wasOpen) {
      this.applyHiddenState()
    }
    this.refresh(!wasOpen)
    if (!wasOpen) {
      void this.panel.offsetHeight
      this.applyVisibleState()
    }
    this.inputTarget.focus({ preventScroll: true })
  }

  hide(): void {
    if (!this.isOpenFlag) {
      return
    }
    this.isOpenFlag = false
    this.cancelLevelValueAnimation()
    this.container.style.display = 'none'
    this.container.style.pointerEvents = 'none'
    this.applyHiddenState()
    this.inputTarget.removeEventListener(
      'keydown',
      this.boundHandleKeyDown,
      true
    )
  }

  private refresh(allowLevelValueAnimation: boolean): void {
    const state = this.currentState
    if (!state) {
      return
    }
    this.updateLevelValue(state, allowLevelValueAnimation)

    for (let i = 0; i < PLAYER_UPGRADE_STAT_ORDER.length; i++) {
      const stat = PLAYER_UPGRADE_STAT_ORDER[i]
      const isMaxed = isPlayerUpgradeStatMaxed(state, stat)
      this.disabled[i] = isMaxed
      const button = this.buttons[i]
      button.disabled = isMaxed
      button.style.opacity = isMaxed ? '0.45' : '1'
      this.labels[i].textContent = this.getOptionLabel(state, stat, isMaxed)
    }

    if (
      this.selectedIndex < 0 ||
      this.selectedIndex >= this.buttons.length ||
      this.disabled[this.selectedIndex]
    ) {
      this.selectedIndex = this.findNextEnabledIndex(1, this.buttons.length - 1)
    }
    this.applySelection()
  }

  private applyHiddenState(): void {
    this.overlay.style.opacity = '0'
    this.panel.style.opacity = '0'
    this.panel.style.transform = LEVEL_UP_PANEL_HIDDEN_TRANSFORM
  }

  private applyVisibleState(): void {
    this.overlay.style.opacity = '1'
    this.panel.style.opacity = '1'
    this.panel.style.transform = LEVEL_UP_PANEL_VISIBLE_TRANSFORM
  }

  private updateLevelValue(
    state: LevelUpPromptState,
    allowLevelValueAnimation: boolean
  ): void {
    const labelTemplate = localizer.t('ui_level_label')
    const parts = labelTemplate.split('{0}')
    this.levelPrefix.textContent = parts[0] ?? ''
    this.levelSuffix.textContent = parts[1] ?? ''

    const currentLevelText = String(state.level)
    const previousLevel =
      typeof state.previousLevel === 'number' &&
      Number.isFinite(state.previousLevel) &&
      state.previousLevel > 0
        ? state.previousLevel | 0
        : state.level
    const shouldAnimate =
      allowLevelValueAnimation && state.level > previousLevel
    const previousLevelText = String(previousLevel)
    const digits = Math.max(
      currentLevelText.length,
      previousLevelText.length,
      2
    )
    this.levelValueViewport.style.width = `${digits}ch`

    if (!shouldAnimate) {
      this.cancelLevelValueAnimation()
      this.pendingLevelValueAnimation = false
      this.levelValueCurrent.textContent = currentLevelText
      this.levelValueNext.textContent = currentLevelText
      this.levelValueCurrent.style.transitionDelay = '0ms'
      this.levelValueNext.style.transitionDelay = '0ms'
      this.levelValueCurrent.style.transform = 'translateY(0)'
      this.levelValueCurrent.style.opacity = '1'
      this.levelValueNext.style.transform = 'translateY(100%)'
      this.levelValueNext.style.opacity = '0'
      return
    }

    this.cancelLevelValueAnimation()
    this.pendingLevelValueAnimation = true
    this.levelValueCurrent.textContent = previousLevelText
    this.levelValueNext.textContent = currentLevelText
    this.levelValueCurrent.style.transitionDelay = '0ms'
    this.levelValueNext.style.transitionDelay = '0ms'
    this.levelValueCurrent.style.transform = 'translateY(0)'
    this.levelValueCurrent.style.opacity = '1'
    this.levelValueNext.style.transform = 'translateY(100%)'
    this.levelValueNext.style.opacity = '0'
  }

  private cancelLevelValueAnimation(): void {
    if (this.levelValueAnimationFrame !== 0) {
      cancelAnimationFrame(this.levelValueAnimationFrame)
      this.levelValueAnimationFrame = 0
    }
  }

  private startLevelValueAnimation(): void {
    this.pendingLevelValueAnimation = false
    this.cancelLevelValueAnimation()
    this.levelValueAnimationFrame = requestAnimationFrame(() => {
      this.levelValueAnimationFrame = 0
      const delay = `${LEVEL_VALUE_TRANSITION_DELAY_MS}ms`
      this.levelValueCurrent.style.transitionDelay = delay
      this.levelValueNext.style.transitionDelay = delay
      this.levelValueCurrent.style.transform = 'translateY(-100%)'
      this.levelValueCurrent.style.opacity = '0'
      this.levelValueNext.style.transform = 'translateY(0)'
      this.levelValueNext.style.opacity = '1'
    })
  }

  private getOptionLabel(
    state: LevelUpPromptState,
    stat: PlayerUpgradeStat,
    isMaxed: boolean
  ): string {
    if (isMaxed) {
      return localizer.t(`ui_level_up_${stat}_max`)
    }
    const value = getPlayerUpgradePreviewPercent(state, stat)
    return localizer.t(`ui_level_up_${stat}`).replace('{0}', String(value))
  }

  private createOptionButton(
    stat: PlayerUpgradeStat,
    index: number
  ): HTMLButtonElement {
    const button = document.createElement('button')
    button.type = 'button'
    button.style.cssText = `
      display: flex;
      align-items: center;
      gap: 14px;
      width: 100%;
      min-height: 88px;
      padding: 10px 12px;
      border: 1px solid rgba(141, 117, 78, 0.34);
      background: rgba(17, 16, 12, 0.72);
      color: inherit;
      cursor: pointer;
      box-sizing: border-box;
      text-align: left;
      transition:
        transform 120ms ease-out,
        background-color 120ms ease-out,
        box-shadow 120ms ease-out;
    `

    const iconWrap = document.createElement('div')
    iconWrap.style.cssText = `
      position: relative;
      flex: 0 0 66px;
      width: 66px;
      height: 66px;
      background:
        radial-gradient(circle at 35% 30%, rgba(162, 131, 76, 0.18), transparent 56%),
        rgba(28, 24, 17, 0.92);
      box-sizing: border-box;
    `
    iconWrap.appendChild(this.createOptionIcon(stat))

    const upgradeMark = document.createElement('div')
    upgradeMark.style.cssText = `
      position: absolute;
      right: -6px;
      bottom: -6px;
      width: 20px;
      height: 20px;
      display: flex;
      align-items: center;
      justify-content: center;
      box-sizing: border-box;
      text-shadow: 0 0 8px rgba(241, 222, 180, 0.28);
    `
    upgradeMark.appendChild(this.createArrowSvg(20))
    iconWrap.appendChild(upgradeMark)

    const textWrap = document.createElement('div')
    textWrap.style.cssText = `
      display: flex;
      flex: 1 1 auto;
      align-items: center;
      min-width: 0;
    `

    const label = document.createElement('div')
    label.style.cssText = `
      font-size: 20px;
      line-height: 1.4;
      color: #f5e9d4;
      letter-spacing: 0.5px;
      white-space: normal;
      word-break: break-word;
    `
    textWrap.appendChild(label)

    button.appendChild(iconWrap)
    button.appendChild(textWrap)

    button.addEventListener('pointerenter', () => {
      this.setSelectedIndex(index)
    })
    button.addEventListener('click', (event) => {
      event.preventDefault()
      this.setSelectedIndex(index)
      this.confirmSelection()
    })

    this.buttons.push(button)
    this.labels.push(label)
    this.disabled.push(false)
    return button
  }

  private createHeaderArrowIcon(): HTMLDivElement {
    const wrap = document.createElement('div')
    wrap.style.cssText = `
      width: 52px;
      height: 52px;
      display: flex;
      align-items: center;
      justify-content: center;
      box-sizing: border-box;
      flex: 0 0 auto;
    `
    wrap.appendChild(this.createArrowSvg(46))
    return wrap
  }

  private createArrowSvg(size: number): SVGSVGElement {
    const svg = document.createElementNS(SVG_NS, 'svg')
    svg.setAttribute('viewBox', '0 0 48 48')
    svg.setAttribute('width', String(size))
    svg.setAttribute('height', String(size))

    const arrow = document.createElementNS(SVG_NS, 'path')
    arrow.setAttribute('d', 'M24 3L39 19H30V45H18V19H9Z')
    arrow.setAttribute('fill', '#f0ddb2')
    svg.appendChild(arrow)

    return svg
  }

  private createOptionIcon(stat: PlayerUpgradeStat): SVGSVGElement {
    const svg = document.createElementNS(SVG_NS, 'svg')
    svg.setAttribute('viewBox', '0 0 64 64')
    svg.setAttribute('width', '64')
    svg.setAttribute('height', '64')
    svg.style.cssText = 'position: absolute; inset: 0;'

    const stroke = '#e8d6af'

    if (stat === 'attack') {
      const sword = document.createElementNS(SVG_NS, 'path')
      sword.setAttribute(
        'd',
        'M32 6 L37 16 V44 H44 V47 H34 V53 L36 56 L32 59 L28 56 L30 53 V47 H20 V44 H27 V16 Z'
      )
      sword.setAttribute('fill', stroke)
      sword.setAttribute('transform', 'rotate(42 32 32)')
      svg.appendChild(sword)
    } else if (stat === 'defense') {
      const shield = document.createElementNS(SVG_NS, 'path')
      shield.setAttribute(
        'd',
        'M32 10 L48 16 V30 C48 40 41 49 32 54 C23 49 16 40 16 30 V16 Z'
      )
      shield.setAttribute('fill', stroke)
      svg.appendChild(shield)
    } else if (stat === 'agility') {
      const agilityTrail = document.createElementNS(SVG_NS, 'path')
      agilityTrail.setAttribute(
        'd',
        'M4 18 H17 V22 H4 Z M21 18 H29 V22 H21 Z M1 31 H15 V35 H1 Z M19 31 H30 V35 H19 Z M5 44 H20 V48 H5 Z M24 44 H32 V48 H24 Z'
      )
      agilityTrail.setAttribute('fill', stroke)
      svg.appendChild(agilityTrail)

      const agilityFoot = document.createElementNS(SVG_NS, 'path')
      agilityFoot.setAttribute(
        'd',
        'M31 8 H38 L46 11 C44 18 43 24 42 29 C41 33 43 37 48 40 C52 43 54 46 54 49 C54 52 51 54 46 54 H38 C35 54 32 53 30 50 L26 46 C23 43 20 42 16 41 C13 40 12 38 12 35 C12 32 14 30 17 28 C20 26 22 22 23 16 Z'
      )
      agilityFoot.setAttribute('fill', stroke)
      svg.appendChild(agilityFoot)
    } else {
      const rock = document.createElementNS(SVG_NS, 'path')
      rock.setAttribute(
        'd',
        'M17 30 L26 16 H39 L50 24 L48 40 L39 50 H24 L15 41 L14 33 Z'
      )
      rock.setAttribute('fill', stroke)
      svg.appendChild(rock)

      const rockLines = document.createElementNS(SVG_NS, 'path')
      rockLines.setAttribute('d', 'M29 22 L26 30 L31 35 L28 42 M38 26 L35 33')
      rockLines.setAttribute('fill', 'none')
      rockLines.setAttribute('stroke', 'rgba(0, 0, 0, 0.24)')
      rockLines.setAttribute('stroke-width', '2')
      rockLines.setAttribute('stroke-linecap', 'round')
      rockLines.setAttribute('stroke-linejoin', 'round')
      svg.appendChild(rockLines)
    }

    return svg
  }

  private handleKeyDown(event: KeyboardEvent): void {
    if (!this.isOpenFlag) {
      return
    }
    const key = event.key.toLowerCase()
    if (key === 'w' || key === 'arrowup') {
      event.preventDefault()
      event.stopPropagation()
      this.moveSelection(-1)
      return
    }
    if (key === 's' || key === 'arrowdown') {
      event.preventDefault()
      event.stopPropagation()
      this.moveSelection(1)
      return
    }
    if (key === 'enter' || key === ' ') {
      event.preventDefault()
      event.stopPropagation()
      this.confirmSelection()
      return
    }
    if (key === 'escape') {
      event.preventDefault()
      event.stopPropagation()
    }
  }

  private moveSelection(direction: -1 | 1): void {
    this.selectedIndex = this.findNextEnabledIndex(
      direction,
      this.selectedIndex
    )
    this.applySelection()
  }

  private findNextEnabledIndex(direction: -1 | 1, fromIndex: number): number {
    const count = this.buttons.length
    if (count <= 0) {
      return 0
    }
    let index = fromIndex
    for (let step = 0; step < count; step++) {
      index = (index + direction + count) % count
      if (!this.disabled[index]) {
        return index
      }
    }
    return fromIndex >= 0 && fromIndex < count ? fromIndex : 0
  }

  private setSelectedIndex(index: number): void {
    if (index < 0 || index >= this.buttons.length) {
      return
    }
    if (this.disabled[index]) {
      return
    }
    this.selectedIndex = index
    this.applySelection()
  }

  private applySelection(): void {
    for (let i = 0; i < this.buttons.length; i++) {
      const selected = i === this.selectedIndex && !this.disabled[i]
      const button = this.buttons[i]
      button.style.borderColor = selected
        ? 'rgba(227, 195, 134, 0.92)'
        : 'rgba(141, 117, 78, 0.34)'
      button.style.background = selected
        ? 'rgba(54, 41, 22, 0.96)'
        : 'rgba(17, 16, 12, 0.72)'
      button.style.boxShadow = selected
        ? '0 12px 28px rgba(0, 0, 0, 0.26)'
        : 'none'
      button.style.transform = selected ? 'translateX(4px)' : 'translateX(0)'
    }
  }

  private confirmSelection(): void {
    if (
      !this.currentState ||
      this.selectedIndex < 0 ||
      this.selectedIndex >= PLAYER_UPGRADE_STAT_ORDER.length ||
      this.disabled[this.selectedIndex]
    ) {
      return
    }
    const stat = PLAYER_UPGRADE_STAT_ORDER[this.selectedIndex]
    this.selectionHandler?.(stat)
  }
}
