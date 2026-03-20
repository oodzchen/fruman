import { localizer } from '../Localizer'
import {
  DEFAULT_WEAPON_GROUND_ROTATION_RAD,
  WEAPON_DEFAULT_DATA,
} from '../constants'
import type { WeaponCategory } from '../editorMapTypes'
import { renderWeapon } from '../renderer/WeaponRenderer'
import type { EnemyType, WeaponType } from '../types'
import { DEBUG_EDITOR_MENU } from './EditorConstants'
import { EditorMenuNavigator, EditorSubmenuMode } from './EditorMenuNavigator'
import { computeWeaponRenderDimensions } from './EditorRenderUtils'
import { ObjectType } from './types'
import type { GroundShapeType } from './types'

export interface EditorMenuSystemContext {
  editorWorkspace: HTMLDivElement
  hasObjectOfType: (type: ObjectType) => boolean
  hasWeaponType: (weaponType: WeaponType) => boolean
  onObjectTypeSelected: (type: ObjectType) => void
  onGroundShapeSelected: (shape: GroundShapeType) => void
  onObstacleShapeSelected: (shape: GroundShapeType) => void
  onWeaponSelected: (
    weaponType: WeaponType,
    category: WeaponCategory,
    size?: number
  ) => void
  onEnemySelected: (enemyType: EnemyType) => void
  onPanelMenuAdd: () => void
  onPanelMenuPaste: () => void
}

export class EditorMenuSystem {
  private ctx: EditorMenuSystemContext
  private editorWorkspace: HTMLDivElement
  private objectTypeMenu: HTMLDivElement
  private panelMenu: HTMLDivElement
  private panelMenuAddBtn: HTMLButtonElement
  private panelMenuPasteBtn: HTMLButtonElement
  private groundSubmenu: HTMLDivElement
  private obstacleSubmenu: HTMLDivElement
  private weaponMenu: HTMLDivElement
  private enemySubmenu: HTMLDivElement
  private groundMenuItem: HTMLButtonElement
  private obstacleMenuItem: HTMLButtonElement
  private weaponMenuItem: HTMLButtonElement
  private enemyMenuItem: HTMLButtonElement
  private editorObjectItems: NodeListOf<HTMLButtonElement>
  private groundSubmenuItems: NodeListOf<HTMLButtonElement>
  private obstacleSubmenuItems: NodeListOf<HTMLButtonElement>
  private weaponItems: NodeListOf<HTMLButtonElement>
  private weaponGroupTitles: NodeListOf<HTMLDivElement>
  private enemySubmenuItems: NodeListOf<HTMLButtonElement>
  private objectTypeMenuBackBtn: HTMLButtonElement
  private groundSubmenuBackBtn: HTMLButtonElement
  private obstacleSubmenuBackBtn: HTMLButtonElement
  private weaponMenuBackBtn: HTMLButtonElement
  private enemySubmenuBackBtn: HTMLButtonElement
  private readonly weaponPreviewPixelsPerMeter = 16
  private readonly weaponPreviewAngle = DEFAULT_WEAPON_GROUND_ROTATION_RAD

  private menuNavigator: EditorMenuNavigator
  private menuMode: EditorSubmenuMode = EditorSubmenuMode.None
  private menuSelectedIndex = 0
  private panelMenuX = 0
  private panelMenuY = 0
  private objectTypeMenuX = 0
  private objectTypeMenuY = 0
  private boundHandleMenuItemMouseEnter: (event: Event) => void

  constructor(ctx: EditorMenuSystemContext) {
    this.ctx = ctx
    this.editorWorkspace = ctx.editorWorkspace

    const objectTypeMenu = document.getElementById('editorObjectTypeMenu')
    const panelMenu = document.getElementById('editorPanelMenu')
    const panelMenuPaste = document.getElementById('editorPanelMenuPaste')
    const panelMenuAdd = document.getElementById('editorPanelMenuAdd')
    const groundSubmenu = document.getElementById('editorGroundSubmenu')
    const obstacleSubmenu = document.getElementById('editorObstacleSubmenu')
    const weaponMenu = document.getElementById('editorWeaponMenu')
    const enemySubmenu = document.getElementById('editorEnemySubmenu')

    const groundMenuItem = document.querySelector<HTMLButtonElement>(
      '.editor-object-item[data-type="ground"]'
    )
    const obstacleMenuItem = document.querySelector<HTMLButtonElement>(
      '.editor-object-item[data-type="obstacle"]'
    )
    const weaponMenuItem = document.querySelector<HTMLButtonElement>(
      '.editor-object-item[data-type="weapon"]'
    )
    const enemyMenuItem = document.querySelector<HTMLButtonElement>(
      '.editor-object-item[data-type="enemy"]'
    )

    const editorObjectItems = document.querySelectorAll<HTMLButtonElement>(
      '.editor-object-item'
    )
    const groundSubmenuItems = document.querySelectorAll<HTMLButtonElement>(
      '#editorGroundSubmenu .editor-submenu-item'
    )
    const obstacleSubmenuItems = document.querySelectorAll<HTMLButtonElement>(
      '#editorObstacleSubmenu .editor-submenu-item'
    )
    const weaponItems = document.querySelectorAll<HTMLButtonElement>(
      '#editorWeaponMenu .editor-submenu-item'
    )
    const weaponGroupTitles = document.querySelectorAll<HTMLDivElement>(
      '#editorWeaponMenu .editor-submenu-group-title'
    )
    const enemySubmenuItems = document.querySelectorAll<HTMLButtonElement>(
      '#editorEnemySubmenu .editor-submenu-item'
    )

    const objectTypeMenuBackBtn = document.querySelector<HTMLButtonElement>(
      '#editorObjectTypeMenu .editor-object-item[data-action="back"]'
    )
    const groundSubmenuBackBtn = document.querySelector<HTMLButtonElement>(
      '#editorGroundSubmenu .editor-submenu-item[data-action="back"]'
    )
    const obstacleSubmenuBackBtn = document.querySelector<HTMLButtonElement>(
      '#editorObstacleSubmenu .editor-submenu-item[data-action="back"]'
    )
    const weaponMenuBackBtn = document.querySelector<HTMLButtonElement>(
      '#editorWeaponMenu .editor-submenu-item[data-action="back"]'
    )
    const enemySubmenuBackBtn = document.querySelector<HTMLButtonElement>(
      '#editorEnemySubmenu .editor-submenu-item[data-action="back"]'
    )

    if (
      !(objectTypeMenu instanceof HTMLDivElement) ||
      !(panelMenu instanceof HTMLDivElement) ||
      !(panelMenuPaste instanceof HTMLButtonElement) ||
      !(panelMenuAdd instanceof HTMLButtonElement) ||
      !(groundSubmenu instanceof HTMLDivElement) ||
      !(obstacleSubmenu instanceof HTMLDivElement) ||
      !(weaponMenu instanceof HTMLDivElement) ||
      !(enemySubmenu instanceof HTMLDivElement) ||
      !(groundMenuItem instanceof HTMLButtonElement) ||
      !(obstacleMenuItem instanceof HTMLButtonElement) ||
      !(weaponMenuItem instanceof HTMLButtonElement) ||
      !(enemyMenuItem instanceof HTMLButtonElement) ||
      !(objectTypeMenuBackBtn instanceof HTMLButtonElement) ||
      !(groundSubmenuBackBtn instanceof HTMLButtonElement) ||
      !(obstacleSubmenuBackBtn instanceof HTMLButtonElement) ||
      !(weaponMenuBackBtn instanceof HTMLButtonElement) ||
      !(enemySubmenuBackBtn instanceof HTMLButtonElement)
    ) {
      throw new Error('EditorMenuSystem: required elements not found')
    }

    this.objectTypeMenu = objectTypeMenu
    this.panelMenu = panelMenu
    this.panelMenuPasteBtn = panelMenuPaste
    this.panelMenuAddBtn = panelMenuAdd
    this.groundSubmenu = groundSubmenu
    this.obstacleSubmenu = obstacleSubmenu
    this.weaponMenu = weaponMenu
    this.enemySubmenu = enemySubmenu
    this.groundMenuItem = groundMenuItem
    this.obstacleMenuItem = obstacleMenuItem
    this.weaponMenuItem = weaponMenuItem
    this.enemyMenuItem = enemyMenuItem
    this.editorObjectItems = editorObjectItems
    this.groundSubmenuItems = groundSubmenuItems
    this.obstacleSubmenuItems = obstacleSubmenuItems
    this.weaponItems = weaponItems
    this.weaponGroupTitles = weaponGroupTitles
    this.enemySubmenuItems = enemySubmenuItems
    this.objectTypeMenuBackBtn = objectTypeMenuBackBtn
    this.groundSubmenuBackBtn = groundSubmenuBackBtn
    this.obstacleSubmenuBackBtn = obstacleSubmenuBackBtn
    this.weaponMenuBackBtn = weaponMenuBackBtn
    this.enemySubmenuBackBtn = enemySubmenuBackBtn

    this.menuNavigator = new EditorMenuNavigator({
      getMenuItems: (mode) => this.getMenuItems(mode),
      getCurrentMode: () => this.menuMode,
      setCurrentMode: (mode) => {
        this.menuMode = mode
      },
      getCurrentSelectedIndex: () => this.menuSelectedIndex,
      setCurrentSelectedIndex: (index) => {
        this.menuSelectedIndex = index
      },
    })

    this.boundHandleMenuItemMouseEnter =
      this.handleMenuItemMouseEnter.bind(this)
    this.setupEventListeners()
  }

  private getMenuItems(mode: EditorSubmenuMode): NodeListOf<HTMLButtonElement> {
    switch (mode) {
      case EditorSubmenuMode.Object:
        return this.editorObjectItems
      case EditorSubmenuMode.Ground:
        return this.groundSubmenuItems
      case EditorSubmenuMode.Obstacle:
        return this.obstacleSubmenuItems
      case EditorSubmenuMode.Weapon:
        return this.weaponItems
      case EditorSubmenuMode.Enemy:
        return this.enemySubmenuItems
      default:
        return this.editorObjectItems
    }
  }

  private setupEventListeners() {
    this.editorObjectItems.forEach((item) => {
      item.addEventListener('click', () => {
        const action = item.dataset.action
        if (action === 'back') {
          this.handleMenuBack()
          return
        }
        const type = item.dataset.type as ObjectType | undefined
        if (type) {
          this.setObjectTypeHighlight(type)
          this.ctx.onObjectTypeSelected(type)
        }
      })
    })
    this.bindMenuItems(this.editorObjectItems, EditorSubmenuMode.Object)

    this.groundSubmenuItems.forEach((item) => {
      item.addEventListener('click', () => {
        const action = item.dataset.action
        if (action === 'back') {
          this.handleMenuBack()
          return
        }
        const shape = item.dataset.shape as GroundShapeType | undefined
        if (shape) {
          this.ctx.onGroundShapeSelected(shape)
          this.hideObjectTypeMenu()
        }
      })
    })
    this.bindMenuItems(this.groundSubmenuItems, EditorSubmenuMode.Ground)

    this.obstacleSubmenuItems.forEach((item) => {
      item.addEventListener('click', () => {
        const action = item.dataset.action
        if (action === 'back') {
          this.handleMenuBack()
          return
        }
        const shape = item.dataset.shape as GroundShapeType | undefined
        if (shape) {
          this.ctx.onObstacleShapeSelected(shape)
          this.hideObjectTypeMenu()
        }
      })
    })
    this.bindMenuItems(this.obstacleSubmenuItems, EditorSubmenuMode.Obstacle)

    this.weaponItems.forEach((item) => {
      item.addEventListener('click', () => {
        const action = item.dataset.action
        if (action === 'back') {
          this.handleMenuBack()
          return
        }
        const weaponType = item.dataset.weapon as WeaponType | undefined
        const category = item.dataset.category as WeaponCategory | undefined
        const sizeStr = item.dataset.size
        const size = sizeStr ? Number.parseInt(sizeStr, 10) : undefined
        if (weaponType && category) {
          this.ctx.onWeaponSelected(weaponType, category, size)
          this.hideObjectTypeMenu()
        }
      })
    })
    this.bindMenuItems(this.weaponItems, EditorSubmenuMode.Weapon)

    this.enemySubmenuItems.forEach((item) => {
      item.addEventListener('click', () => {
        const action = item.dataset.action
        if (action === 'back') {
          this.handleMenuBack()
          return
        }
        const enemyType = item.dataset.enemy as EnemyType | undefined
        if (enemyType) {
          this.ctx.onEnemySelected(enemyType)
          this.hideObjectTypeMenu()
        }
      })
    })
    this.bindMenuItems(this.enemySubmenuItems, EditorSubmenuMode.Enemy)

    this.panelMenuAddBtn.addEventListener('pointerdown', (event) => {
      event.preventDefault()
      event.stopPropagation()
      this.ctx.onPanelMenuAdd()
    })

    this.panelMenuPasteBtn.addEventListener('pointerdown', (event) => {
      event.preventDefault()
      event.stopPropagation()
      if (this.panelMenuPasteBtn.disabled) {
        return
      }
      this.ctx.onPanelMenuPaste()
    })

    this.panelMenu.addEventListener('pointerdown', (event) => {
      event.stopPropagation()
    })
    this.objectTypeMenu.addEventListener('pointerdown', (event) => {
      event.stopPropagation()
    })
    this.groundSubmenu.addEventListener('pointerdown', (event) => {
      event.stopPropagation()
    })
    this.obstacleSubmenu.addEventListener('pointerdown', (event) => {
      event.stopPropagation()
    })
    this.weaponMenu.addEventListener('pointerdown', (event) => {
      event.stopPropagation()
    })
    this.enemySubmenu.addEventListener('pointerdown', (event) => {
      event.stopPropagation()
    })
  }

  private bindMenuItems(
    items: NodeListOf<HTMLButtonElement>,
    mode: EditorSubmenuMode
  ) {
    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      item.dataset.menuIndex = String(i)
      item.dataset.menuMode = mode
      item.addEventListener('mouseenter', this.boundHandleMenuItemMouseEnter)
    }
  }

  private handleMenuItemMouseEnter(event: Event) {
    if (this.menuMode === EditorSubmenuMode.None) {
      return
    }
    const target = event.currentTarget
    if (!(target instanceof HTMLButtonElement)) {
      return
    }
    const mode = target.dataset.menuMode as EditorSubmenuMode | undefined
    if (!mode || mode !== this.menuMode) {
      return
    }
    const index = Number.parseInt(target.dataset.menuIndex ?? '', 10)
    if (!Number.isFinite(index)) {
      return
    }
    this.menuNavigator.setSelectedIndex(index)
  }

  private handleMenuBack() {
    if (this.menuMode === EditorSubmenuMode.Ground) {
      this.hideGroundSubmenu()
      if (this.isObjectTypeMenuVisible()) {
        this.menuNavigator.setMode(EditorSubmenuMode.Object, true)
      }
      return
    }
    if (this.menuMode === EditorSubmenuMode.Obstacle) {
      this.hideObstacleSubmenu()
      if (this.isObjectTypeMenuVisible()) {
        this.menuNavigator.setMode(EditorSubmenuMode.Object, true)
      }
      return
    }
    if (this.menuMode === EditorSubmenuMode.Weapon) {
      this.hideWeaponMenu()
      if (this.isObjectTypeMenuVisible()) {
        this.menuNavigator.setMode(EditorSubmenuMode.Object, true)
      }
      return
    }
    if (this.menuMode === EditorSubmenuMode.Enemy) {
      this.hideEnemySubmenu()
      if (this.isObjectTypeMenuVisible()) {
        this.menuNavigator.setMode(EditorSubmenuMode.Object, true)
      }
      return
    }
    if (this.menuMode === EditorSubmenuMode.Object) {
      this.hideObjectTypeMenu()
      this.menuNavigator.setMode(EditorSubmenuMode.None, false)
    }
  }

  getMenuNavigator(): EditorMenuNavigator {
    return this.menuNavigator
  }

  getMenuMode(): EditorSubmenuMode {
    return this.menuMode
  }

  getMenuSelectedIndex(): number {
    return this.menuSelectedIndex
  }

  getPanelMenuPosition(): { x: number; y: number } {
    return { x: this.panelMenuX, y: this.panelMenuY }
  }

  updateLocalization() {
    this.panelMenuAddBtn.textContent = localizer.t('editor_panel_add_object')
    this.panelMenuPasteBtn.textContent = localizer.t('editor_object_menu_paste')

    this.editorObjectItems.forEach((item) => {
      const type = item.dataset.type
      if (type) {
        item.textContent = localizer.t(`editor_object_${type}`)
      }
    })

    this.groundSubmenuItems.forEach((item) => {
      const shape = item.dataset.shape
      if (shape) {
        item.textContent = localizer.t(`editor_ground_shape_${shape}`)
      }
    })

    this.obstacleSubmenuItems.forEach((item) => {
      const shape = item.dataset.shape
      if (shape) {
        item.textContent = localizer.t(`editor_ground_shape_${shape}`)
      }
    })

    this.weaponGroupTitles.forEach((title) => {
      const category = title.dataset.categoryTitle
      if (category) {
        title.textContent = localizer.t(`editor_weapon_category_${category}`)
      }
    })

    this.weaponItems.forEach((item) => {
      const weapon = item.dataset.weapon
      const sizeStr = item.dataset.size
      if (weapon && sizeStr) {
        this.setWeaponMenuItemContent(
          item,
          localizer.t(`editor_weapon_size_${weapon}_${sizeStr}`)
        )
      } else if (weapon) {
        this.setWeaponMenuItemContent(
          item,
          localizer.t(`editor_weapon_${weapon}`)
        )
      }
    })

    this.enemySubmenuItems.forEach((item) => {
      const enemy = item.dataset.enemy
      if (enemy) {
        item.textContent = localizer.t(`editor_enemy_${enemy}`)
      }
    })

    this.objectTypeMenuBackBtn.textContent = localizer.t('menu_back')
    this.groundSubmenuBackBtn.textContent = localizer.t('menu_back')
    this.obstacleSubmenuBackBtn.textContent = localizer.t('menu_back')
    this.weaponMenuBackBtn.textContent = localizer.t('menu_back')
    this.enemySubmenuBackBtn.textContent = localizer.t('menu_back')
  }

  private setWeaponMenuItemContent(
    item: HTMLButtonElement,
    label: string
  ): void {
    const weaponType = item.dataset.weapon as WeaponType | undefined
    if (!weaponType) {
      item.textContent = label
      return
    }

    item.textContent = ''
    item.classList.add('editor-submenu-item-weapon')

    const icon = document.createElement('canvas')
    icon.width = 44
    icon.height = 18
    icon.className = 'editor-submenu-item-icon'
    this.renderWeaponMenuIcon(icon, weaponType, item.dataset.size)
    item.appendChild(icon)

    const text = document.createElement('span')
    text.className = 'editor-submenu-item-label'
    text.textContent = label
    item.appendChild(text)
  }

  private renderWeaponMenuIcon(
    canvas: HTMLCanvasElement,
    weaponType: WeaponType,
    sizeValue?: string
  ): void {
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      return
    }

    const template = WEAPON_DEFAULT_DATA[weaponType]
    const parsedSize = sizeValue ? Number.parseInt(sizeValue, 10) : NaN
    const sizeLevel =
      Number.isFinite(parsedSize) && parsedSize > 0
        ? parsedSize
        : template.sizeLevel
    const renderType = this.getWeaponRenderType(weaponType)
    const isBow = weaponType === 'bow'
    const dims = computeWeaponRenderDimensions(
      template,
      sizeLevel,
      this.weaponPreviewPixelsPerMeter,
      isBow
    )

    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.save()
    ctx.translate(Math.round(canvas.width / 2), Math.round(canvas.height / 2))
    ctx.rotate(this.weaponPreviewAngle)

    const maxWidth = canvas.width - 6
    const maxHeight = canvas.height - 4
    const scaleX = Math.max(1, Math.floor((maxWidth * 1000) / dims.widthPx))
    const baseHeight = isBow ? dims.boundingHeightPx : dims.heightPx
    const scaleY = Math.max(1, Math.floor((maxHeight * 1000) / baseHeight))
    const scale = Math.min(scaleX, scaleY)
    const drawWidth = Math.max(1, Math.floor((dims.widthPx * scale) / 1000))
    const drawHeight = Math.max(1, Math.floor((dims.heightPx * scale) / 1000))

    renderWeapon(ctx, renderType, drawWidth, drawHeight, '#b4bdc7')
    ctx.restore()
  }

  private getWeaponRenderType(
    weaponType: WeaponType
  ): 'sword' | 'spear' | 'hammer' | 'bow' | 'hook' {
    if (weaponType === 'hook') {
      return 'hook'
    }
    if (weaponType === 'bow') {
      return 'bow'
    }
    if (weaponType === 'hammer' || weaponType === 'bigHammer') {
      return 'hammer'
    }
    if (weaponType === 'spear') {
      return 'spear'
    }
    return 'sword'
  }

  handleKeyDown(event: KeyboardEvent): boolean {
    const items = this.getMenuItems(this.menuMode)
    if (this.menuMode === EditorSubmenuMode.None) {
      return false
    }
    if (items.length === 0) {
      return false
    }
    const key = event.key
    if (key === 'ArrowUp' || key === 'w') {
      event.preventDefault()
      const nextIndex = this.menuNavigator.findNextSelectableIndex(
        items,
        this.menuSelectedIndex,
        -1
      )
      this.menuNavigator.setSelectedIndex(nextIndex)
      return true
    }
    if (key === 'ArrowDown' || key === 's') {
      event.preventDefault()
      const nextIndex = this.menuNavigator.findNextSelectableIndex(
        items,
        this.menuSelectedIndex,
        1
      )
      this.menuNavigator.setSelectedIndex(nextIndex)
      return true
    }
    if (key === 'Enter' || key === ' ') {
      event.preventDefault()
      const item = items[this.menuSelectedIndex]
      if (item && !item.disabled) {
        item.click()
      }
      return true
    }
    if (key === 'Escape') {
      event.preventDefault()
      this.handleMenuBack()
      return true
    }
    return false
  }

  hideAll() {
    this.hidePanelMenu()
    this.hideObjectTypeMenu()
    this.hideGroundSubmenu()
    this.hideObstacleSubmenu()
    this.hideWeaponMenu()
    this.hideEnemySubmenu()
  }

  hideAllSubmenus() {
    this.hideGroundSubmenu()
    this.hideObstacleSubmenu()
    this.hideWeaponMenu()
    this.hideEnemySubmenu()
  }

  isAnyMenuVisible(): boolean {
    return (
      this.panelMenu.classList.contains('is-visible') ||
      this.objectTypeMenu.classList.contains('is-visible') ||
      this.groundSubmenu.classList.contains('is-visible') ||
      this.obstacleSubmenu.classList.contains('is-visible') ||
      this.weaponMenu.classList.contains('is-visible') ||
      this.enemySubmenu.classList.contains('is-visible')
    )
  }

  containsTarget(target: Node): boolean {
    return (
      this.panelMenu.contains(target) ||
      this.objectTypeMenu.contains(target) ||
      this.groundSubmenu.contains(target) ||
      this.obstacleSubmenu.contains(target) ||
      this.weaponMenu.contains(target) ||
      this.enemySubmenu.contains(target)
    )
  }

  showPanelMenu(clientX: number, clientY: number) {
    this.hideGroundSubmenu()
    this.hideObstacleSubmenu()
    this.hideEnemySubmenu()
    this.hideObjectTypeMenu()
    this.panelMenuX = clientX
    this.panelMenuY = clientY
    this.panelMenu.classList.add('is-visible')
    this.adjustMenuPosition(this.panelMenu, clientX, clientY)
    if (DEBUG_EDITOR_MENU) {
      // console.log('[editor] show panel menu', { clientX, clientY })
    }
  }

  setPanelMenuPasteEnabled(enabled: boolean) {
    this.panelMenuPasteBtn.disabled = !enabled
  }

  hidePanelMenu() {
    if (!this.panelMenu.classList.contains('is-visible')) {
      return
    }
    this.panelMenu.classList.remove('is-visible')
    if (DEBUG_EDITOR_MENU) {
      // console.log('[editor] hide panel menu')
    }
  }

  showObjectTypeMenu(clientX: number, clientY: number) {
    this.hidePanelMenu()
    this.hideGroundSubmenu()
    this.hideObstacleSubmenu()
    this.hideEnemySubmenu()
    this.setObjectTypeHighlight(null)
    this.objectTypeMenuX = clientX
    this.objectTypeMenuY = clientY

    this.editorObjectItems.forEach((item) => {
      const type = item.dataset.type as ObjectType | undefined
      if (!type) {
        return
      }
      if (type === 'player' || type === 'camera') {
        if (this.ctx.hasObjectOfType(type)) {
          item.disabled = true
          item.classList.add('disabled')
        } else {
          item.disabled = false
          item.classList.remove('disabled')
        }
      }
    })

    this.objectTypeMenu.classList.add('is-visible')
    this.adjustMenuPosition(this.objectTypeMenu, clientX, clientY)
    this.menuNavigator.setMode(EditorSubmenuMode.Object, true)
  }

  hideObjectTypeMenu() {
    if (!this.objectTypeMenu.classList.contains('is-visible')) {
      return
    }
    this.objectTypeMenu.classList.remove('is-visible')
    this.setObjectTypeHighlight(null)
    this.hideGroundSubmenu()
    this.hideObstacleSubmenu()
    this.hideWeaponMenu()
    this.hideEnemySubmenu()
    this.menuNavigator.setMode(EditorSubmenuMode.None, false)
  }

  isObjectTypeMenuVisible(): boolean {
    return this.objectTypeMenu.classList.contains('is-visible')
  }

  showGroundSubmenu() {
    this.positionGroundSubmenu()
    this.groundSubmenu.classList.add('is-visible')
    this.menuNavigator.setMode(EditorSubmenuMode.Ground, true)
    this.setObjectTypeHighlight(ObjectType.Ground)
  }

  hideGroundSubmenu() {
    this.groundSubmenu.classList.remove('is-visible')
    if (this.menuMode === EditorSubmenuMode.Ground) {
      if (this.objectTypeMenu.classList.contains('is-visible')) {
        this.menuNavigator.setMode(EditorSubmenuMode.Object, true)
      } else {
        this.menuNavigator.setMode(EditorSubmenuMode.None, false)
      }
    }
  }

  showObstacleSubmenu() {
    this.positionObstacleSubmenu()
    this.obstacleSubmenu.classList.add('is-visible')
    this.menuNavigator.setMode(EditorSubmenuMode.Obstacle, true)
    this.setObjectTypeHighlight(ObjectType.Obstacle)
  }

  hideObstacleSubmenu() {
    this.obstacleSubmenu.classList.remove('is-visible')
    if (this.menuMode === EditorSubmenuMode.Obstacle) {
      if (this.objectTypeMenu.classList.contains('is-visible')) {
        this.menuNavigator.setMode(EditorSubmenuMode.Object, true)
      } else {
        this.menuNavigator.setMode(EditorSubmenuMode.None, false)
      }
    }
  }

  showWeaponMenu() {
    const hasHook = this.ctx.hasWeaponType('hook')
    this.weaponItems.forEach((item) => {
      if (item.dataset.weapon === 'hook') {
        if (hasHook) {
          item.disabled = true
          item.classList.add('disabled')
        } else {
          item.disabled = false
          item.classList.remove('disabled')
        }
      }
    })
    this.positionWeaponMenu()
    this.weaponMenu.classList.add('is-visible')
    this.menuNavigator.setMode(EditorSubmenuMode.Weapon, true)
    this.setObjectTypeHighlight(ObjectType.Weapon)
  }

  hideWeaponMenu() {
    this.weaponMenu.classList.remove('is-visible')
    if (this.menuMode === EditorSubmenuMode.Weapon) {
      if (this.objectTypeMenu.classList.contains('is-visible')) {
        this.menuNavigator.setMode(EditorSubmenuMode.Object, true)
      } else {
        this.menuNavigator.setMode(EditorSubmenuMode.None, false)
      }
    }
  }

  showEnemySubmenu() {
    this.positionEnemySubmenu()
    this.enemySubmenu.classList.add('is-visible')
    this.menuNavigator.setMode(EditorSubmenuMode.Enemy, true)
    this.setObjectTypeHighlight(ObjectType.Enemy)
  }

  hideEnemySubmenu() {
    this.enemySubmenu.classList.remove('is-visible')
    if (this.menuMode === EditorSubmenuMode.Enemy) {
      if (this.objectTypeMenu.classList.contains('is-visible')) {
        this.menuNavigator.setMode(EditorSubmenuMode.Object, true)
      } else {
        this.menuNavigator.setMode(EditorSubmenuMode.None, false)
      }
    }
  }

  positionGroundSubmenu() {
    this.positionShapeSubmenu(this.groundMenuItem, this.groundSubmenu)
  }

  positionObstacleSubmenu() {
    this.positionShapeSubmenu(this.obstacleMenuItem, this.obstacleSubmenu)
  }

  positionWeaponMenu() {
    this.positionShapeSubmenu(this.weaponMenuItem, this.weaponMenu)
  }

  positionEnemySubmenu() {
    this.positionShapeSubmenu(this.enemyMenuItem, this.enemySubmenu)
  }

  handleWindowResize() {
    if (
      this.objectTypeMenu.classList.contains('is-visible') &&
      this.groundSubmenu.classList.contains('is-visible')
    ) {
      this.positionGroundSubmenu()
    }
    if (
      this.objectTypeMenu.classList.contains('is-visible') &&
      this.obstacleSubmenu.classList.contains('is-visible')
    ) {
      this.positionObstacleSubmenu()
    }
  }

  private positionShapeSubmenu(
    menuItem: HTMLButtonElement,
    submenu: HTMLDivElement
  ) {
    const menuRect = this.objectTypeMenu.getBoundingClientRect()
    const itemRect = menuItem.getBoundingClientRect()
    const x = menuRect.right + 6
    const y = itemRect.top
    this.adjustMenuPosition(submenu, x, y)
  }

  private adjustMenuPosition(menu: HTMLElement, x: number, y: number) {
    const wasVisible = menu.classList.contains('is-visible')
    if (!wasVisible) {
      menu.style.visibility = 'hidden'
      menu.classList.add('is-visible')
    }

    menu.style.left = `${x}px`
    menu.style.top = `${y}px`

    const rect = menu.getBoundingClientRect()
    const viewportRect = this.editorWorkspace.getBoundingClientRect()

    let newX = x
    let newY = y

    if (newX + rect.width > viewportRect.right) {
      newX = viewportRect.right - rect.width - 4
    }
    if (newY + rect.height > viewportRect.bottom) {
      newY = viewportRect.bottom - rect.height - 4
    }
    if (newX < viewportRect.left + 4) {
      newX = viewportRect.left + 4
    }
    if (newY < viewportRect.top + 4) {
      newY = viewportRect.top + 4
    }

    menu.style.left = `${newX}px`
    menu.style.top = `${newY}px`

    if (!wasVisible) {
      menu.classList.remove('is-visible')
      menu.style.visibility = ''
    }
  }

  private setObjectTypeHighlight(type: ObjectType | null) {
    this.editorObjectItems.forEach((item) => {
      const itemType = item.dataset.type as ObjectType | undefined
      if (type && itemType === type) {
        item.classList.add('is-selected')
      } else {
        item.classList.remove('is-selected')
      }
    })
  }
}
