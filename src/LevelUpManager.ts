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

export interface LevelUpPromptState extends PlayerUpgradeLevelsLike {
  level: number
  pendingPoints: number
}

type SelectionHandler = (stat: PlayerUpgradeStat) => void

export class LevelUpManager {
  private container: HTMLDivElement
  private overlay: HTMLDivElement
  private panel: HTMLDivElement
  private levelValue: HTMLDivElement
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
        radial-gradient(circle at 50% 42%, rgba(90, 70, 38, 0.24), transparent 46%),
        rgba(5, 6, 5, 0.82);
      pointer-events: auto;
    `

    this.panel = document.createElement('div')
    this.panel.style.cssText = `
      position: absolute;
      left: 50%;
      top: 50%;
      width: min(540px, calc(100% - 32px));
      transform: translate(-50%, -50%);
      padding: 20px 18px 16px;
      border: 1px solid rgba(198, 170, 118, 0.42);
      background:
        linear-gradient(180deg, rgba(19, 18, 14, 0.96), rgba(10, 10, 8, 0.98));
      box-shadow:
        0 18px 60px rgba(0, 0, 0, 0.42);
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

    this.levelValue = document.createElement('div')
    this.levelValue.style.cssText = `
      text-align: center;
      font-size: 30px;
      font-weight: 700;
      color: #f7ebd1;
      letter-spacing: 2px;
      box-sizing: border-box;
    `

    header.appendChild(titleIcon)
    header.appendChild(this.levelValue)

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
    this.refresh()
    this.inputTarget.focus({ preventScroll: true })
  }

  hide(): void {
    if (!this.isOpenFlag) {
      return
    }
    this.isOpenFlag = false
    this.container.style.display = 'none'
    this.container.style.pointerEvents = 'none'
    this.inputTarget.removeEventListener(
      'keydown',
      this.boundHandleKeyDown,
      true
    )
  }

  private refresh(): void {
    const state = this.currentState
    if (!state) {
      return
    }
    this.levelValue.textContent = localizer
      .t('ui_level_label')
      .replace('{0}', String(state.level))

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
    const fill = '#b99a62'
    const mutedFill = '#73603b'

    if (stat === 'attack') {
      const blade = document.createElementNS(SVG_NS, 'path')
      blade.setAttribute('d', 'M18 44L41 21L45 25L22 48L16 50Z')
      blade.setAttribute('fill', fill)
      svg.appendChild(blade)

      const guard = document.createElementNS(SVG_NS, 'path')
      guard.setAttribute('d', 'M34 30L40 24L47 31L41 37Z')
      guard.setAttribute('fill', stroke)
      svg.appendChild(guard)

      const handle = document.createElementNS(SVG_NS, 'path')
      handle.setAttribute('d', 'M15 47L20 42L26 48L21 53Z')
      handle.setAttribute('fill', mutedFill)
      svg.appendChild(handle)
    } else if (stat === 'defense') {
      const shield = document.createElementNS(SVG_NS, 'path')
      shield.setAttribute(
        'd',
        'M32 10L48 16V30C48 40 41 49 32 54C23 49 16 40 16 30V16Z'
      )
      shield.setAttribute('fill', fill)
      shield.setAttribute('stroke', stroke)
      shield.setAttribute('stroke-width', '2')
      shield.setAttribute('stroke-linejoin', 'round')
      svg.appendChild(shield)

      const core = document.createElementNS(SVG_NS, 'path')
      core.setAttribute(
        'd',
        'M32 18L41 21V30C41 36 37 42 32 45C27 42 23 36 23 30V21Z'
      )
      core.setAttribute('fill', '#3d3220')
      svg.appendChild(core)
    } else if (stat === 'agility') {
      const sole = document.createElementNS(SVG_NS, 'path')
      sole.setAttribute(
        'd',
        'M18 41C22 33 28 27 36 26C40 26 44 28 46 31C49 36 47 42 41 46C34 50 25 50 18 45Z'
      )
      sole.setAttribute('fill', fill)
      sole.setAttribute('stroke', stroke)
      sole.setAttribute('stroke-width', '2')
      sole.setAttribute('stroke-linejoin', 'round')
      svg.appendChild(sole)

      const toe1 = document.createElementNS(SVG_NS, 'circle')
      toe1.setAttribute('cx', '45')
      toe1.setAttribute('cy', '21')
      toe1.setAttribute('r', '4')
      toe1.setAttribute('fill', stroke)
      svg.appendChild(toe1)

      const toe2 = document.createElementNS(SVG_NS, 'circle')
      toe2.setAttribute('cx', '39')
      toe2.setAttribute('cy', '18')
      toe2.setAttribute('r', '3.5')
      toe2.setAttribute('fill', stroke)
      svg.appendChild(toe2)

      const toe3 = document.createElementNS(SVG_NS, 'circle')
      toe3.setAttribute('cx', '32')
      toe3.setAttribute('cy', '17')
      toe3.setAttribute('r', '3')
      toe3.setAttribute('fill', stroke)
      svg.appendChild(toe3)
    } else {
      const rock = document.createElementNS(SVG_NS, 'path')
      rock.setAttribute('d', 'M18 24L27 14H39L48 22L46 38L35 50L21 47L15 34Z')
      rock.setAttribute('fill', fill)
      rock.setAttribute('stroke', stroke)
      rock.setAttribute('stroke-width', '2')
      rock.setAttribute('stroke-linejoin', 'round')
      svg.appendChild(rock)

      const crack = document.createElementNS(SVG_NS, 'path')
      crack.setAttribute('d', 'M34 18L29 28L35 33L30 44')
      crack.setAttribute('fill', 'none')
      crack.setAttribute('stroke', '#3f3422')
      crack.setAttribute('stroke-width', '2')
      crack.setAttribute('stroke-linecap', 'round')
      crack.setAttribute('stroke-linejoin', 'round')
      svg.appendChild(crack)
    }

    return svg
  }

  private handleKeyDown(event: KeyboardEvent): void {
    if (!this.isOpenFlag) {
      return
    }
    const key = event.key.toLowerCase()
    if (
      key === 'w' ||
      key === 'a' ||
      key === 'arrowup' ||
      key === 'arrowleft'
    ) {
      event.preventDefault()
      event.stopPropagation()
      this.moveSelection(-1)
      return
    }
    if (
      key === 's' ||
      key === 'd' ||
      key === 'arrowdown' ||
      key === 'arrowright'
    ) {
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
