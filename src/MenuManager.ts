import { DialogManager } from './DialogManager'
import { findDirectionalIndex } from './DirectionalNav'
import { type DisplayManager, DisplayOrientation } from './DisplayManager'
import { Language, localizer } from './Localizer'
import { saveManager } from './SaveManager'
import type { SaveMeta } from './saveTypes'

const MENU_ANIMATION_DURATION_MS = 300

export enum MenuAction {
  NewGame,
  Continue,
  Editor,
  Settings,
  Exit,
  Resume,
  MainMenu,
  Language,
  Back,
  LoadGame,
  SaveListSelect,
  SaveListNew,
  SaveListDelete,
  SaveGame,
  Fullscreen,
  Orientation,
  Resolution,
  AttackDefenseGestures,
}

export enum MenuMode {
  Start,
  Pause,
  Settings,
  SaveList,
}

interface MenuItem {
  label: string
  action: MenuAction
  y: number
  value?: string
  saveId?: string
  saveMeta?: SaveMeta
}

export class MenuManager {
  private canvas: HTMLElement
  private menuOverlay: HTMLDivElement
  private uiLayer: HTMLDivElement
  private menuTitle: HTMLDivElement
  private menuItemsContainer: HTMLDivElement
  private saveListContainer: HTMLDivElement
  private saveListTitle: HTMLDivElement
  private saveListList: HTMLDivElement
  private saveListActions: HTMLDivElement
  private inputTarget: HTMLElement
  private readonly mobileGame: boolean
  private focusOptions: FocusOptions = { preventScroll: true }
  private menuItemElements: HTMLButtonElement[] = []
  private activeItemCount = 0
  private visible = false
  private mode: MenuMode = MenuMode.Start
  private previousMode: MenuMode = MenuMode.Start
  private menuItems: MenuItem[] = []
  private selectedIndex = 0
  private onActionCallback?: (action: MenuAction, saveId?: string) => void
  private animTime = 0
  private inputReady = false

  private boundHandleItemMouseEnter: (event: Event) => void
  private boundHandleItemClick: (event: Event) => void

  private hasSavesCache = false
  private saveListCache: SaveMeta[] = []
  private dialogManager: DialogManager | null = null
  private displayManager: DisplayManager | null = null
  private lastSelectedSaveIndex = -1
  private attackDefenseGesturesEnabled = false

  constructor(
    canvas: HTMLElement,
    menuOverlay: HTMLDivElement,
    inputTarget: HTMLElement,
    mobileGame: boolean
  ) {
    this.canvas = canvas
    this.menuOverlay = menuOverlay
    const uiLayer = menuOverlay.parentElement
    const title = menuOverlay.querySelector<HTMLDivElement>('#menuTitle')
    const items = menuOverlay.querySelector<HTMLDivElement>('#menuItems')
    if (!(uiLayer instanceof HTMLDivElement) || !title || !items) {
      throw new Error('Menu overlay elements are missing.')
    }
    this.uiLayer = uiLayer
    this.menuTitle = title
    this.menuItemsContainer = items
    this.saveListContainer = document.createElement('div')
    this.saveListContainer.className = 'menu-save-list-container'
    this.saveListTitle = document.createElement('div')
    this.saveListTitle.className = 'menu-save-list-title'
    this.saveListList = document.createElement('div')
    this.saveListList.className = 'menu-save-list'
    this.saveListActions = document.createElement('div')
    this.saveListActions.className = 'menu-save-actions'
    this.saveListContainer.appendChild(this.saveListTitle)
    this.saveListContainer.appendChild(this.saveListList)
    this.menuItemsContainer.appendChild(this.saveListActions)
    this.menuItemsContainer.appendChild(this.saveListContainer)
    this.boundHandleItemMouseEnter = this.handleItemMouseEnter.bind(this)
    this.boundHandleItemClick = this.handleItemClick.bind(this)
    this.inputTarget = inputTarget
    this.mobileGame = mobileGame
    if (this.inputTarget.tabIndex < 0) {
      this.inputTarget.tabIndex = 0
    }
    if (this.menuOverlay.tabIndex < 0) {
      this.menuOverlay.tabIndex = 0
    }
    this.menuOverlay.classList.remove('is-visible')
    this.menuOverlay.setAttribute('aria-hidden', 'true')
    this.menuItemsContainer.inert = true
    this.initMenuItems()
    this.setupInput()
  }

  async initSaveState(): Promise<void> {
    this.hasSavesCache = await saveManager.hasSaves()
    if (this.hasSavesCache) {
      this.saveListCache = await saveManager.listSaves()
    }
  }

  async refreshSaveList(): Promise<void> {
    this.saveListCache = await saveManager.listSaves()
    this.hasSavesCache = this.saveListCache.length > 0
  }

  setDialogManager(dialogManager: DialogManager): void {
    this.dialogManager = dialogManager
  }

  setDisplayManager(displayManager: DisplayManager): void {
    this.displayManager = displayManager
    const refresh = () => {
      if (this.visible) {
        this.initMenuItems()
        this.syncMenuDom()
      }
    }
    displayManager.setOnFullscreenChange(refresh)
    displayManager.setOnResolutionChange(refresh)
  }

  setAttackDefenseGesturesEnabled(enabled: boolean): void {
    if (this.attackDefenseGesturesEnabled === enabled) {
      return
    }
    this.attackDefenseGesturesEnabled = enabled
    if (this.visible && this.mode === MenuMode.Settings) {
      this.initMenuItems()
      this.syncMenuDom()
    }
  }

  refreshLayout(): void {
    if (!this.visible) {
      return
    }
    this.initMenuItems()
    this.syncMenuDom()
    this.render(0)
  }

  private initMenuItems() {
    const preset = this.displayManager?.getCurrentPreset()
    const width =
      this.canvas.clientWidth || this.canvas.offsetWidth || preset?.width || 800
    const height =
      this.canvas.clientHeight ||
      this.canvas.offsetHeight ||
      preset?.height ||
      600

    // Small screen font scaling
    const isSmallScreen = height < 500 || width < 700
    this.menuOverlay.classList.toggle('menu-compact', isSmallScreen)

    const startY = height / 2 + (isSmallScreen ? 20 : 40)
    const spacing = isSmallScreen ? 28 : 35
    this.menuItems = []

    if (this.mode === MenuMode.Start) {
      if (this.hasSavesCache) {
        this.menuItems = [
          {
            label: localizer.t('menu_continue'),
            action: MenuAction.Continue,
            y: startY,
          },
          {
            label: localizer.t('menu_load_game'),
            action: MenuAction.LoadGame,
            y: startY + spacing,
          },
          {
            label: localizer.t('menu_editor'),
            action: MenuAction.Editor,
            y: startY + spacing * 2,
          },
          {
            label: localizer.t('menu_settings'),
            action: MenuAction.Settings,
            y: startY + spacing * 3,
          },
          {
            label: localizer.t('menu_exit'),
            action: MenuAction.Exit,
            y: startY + spacing * 4,
          },
        ]
      } else {
        this.menuItems = [
          {
            label: localizer.t('menu_new_game'),
            action: MenuAction.NewGame,
            y: startY,
          },
          {
            label: localizer.t('menu_editor'),
            action: MenuAction.Editor,
            y: startY + spacing,
          },
          {
            label: localizer.t('menu_settings'),
            action: MenuAction.Settings,
            y: startY + spacing * 2,
          },
          {
            label: localizer.t('menu_exit'),
            action: MenuAction.Exit,
            y: startY + spacing * 3,
          },
        ]
      }
      if (this.mobileGame) {
        const editorIndex = this.findMenuItemIndex(MenuAction.Editor)
        if (editorIndex >= 0) {
          this.menuItems.splice(editorIndex, 1)
          for (let i = editorIndex; i < this.menuItems.length; i++) {
            this.menuItems[i].y -= spacing
          }
        }
      }
    } else if (this.mode === MenuMode.Pause) {
      this.menuItems = [
        {
          label: localizer.t('menu_resume'),
          action: MenuAction.Resume,
          y: startY,
        },
        {
          label: localizer.t('menu_save_game'),
          action: MenuAction.SaveGame,
          y: startY + spacing,
        },
        {
          label: localizer.t('menu_main_menu'),
          action: MenuAction.MainMenu,
          y: startY + spacing * 2,
        },
        {
          label: localizer.t('menu_settings'),
          action: MenuAction.Settings,
          y: startY + spacing * 3,
        },
        {
          label: localizer.t('menu_exit'),
          action: MenuAction.Exit,
          y: startY + spacing * 4,
        },
      ]
    } else if (this.mode === MenuMode.Settings) {
      const currentLang = localizer.getCurrentLanguage()
      const langDisplay =
        currentLang === Language.ZhHans ? '简体中文' : 'English'
      const isFs = this.displayManager?.isFullscreen() ?? false
      const fsDisplay = isFs
        ? localizer.t('menu_settings_fullscreen_on')
        : localizer.t('menu_settings_fullscreen_off')
      const resDisplay = isFs
        ? '-'
        : (this.displayManager?.getCurrentPreset().label ?? '800×600')
      const orientationDisplay =
        this.displayManager?.getOrientation() === DisplayOrientation.Landscape
          ? localizer.t('menu_settings_orientation_landscape')
          : localizer.t('menu_settings_orientation_portrait')
      const attackDefenseDisplay = this.attackDefenseGesturesEnabled
        ? localizer.t('menu_settings_fullscreen_on')
        : localizer.t('menu_settings_fullscreen_off')

      let y = startY
      this.menuItems.push({
        label: localizer.t('menu_settings_language'),
        action: MenuAction.Language,
        y,
        value: langDisplay,
      })
      y += spacing
      this.menuItems.push({
        label: localizer.t('menu_settings_fullscreen'),
        action: MenuAction.Fullscreen,
        y,
        value: fsDisplay,
      })
      y += spacing
      if (this.mobileGame) {
        this.menuItems.push({
          label: localizer.t('menu_settings_orientation'),
          action: MenuAction.Orientation,
          y,
          value: orientationDisplay,
        })
        y += spacing
      }
      this.menuItems.push({
        label: localizer.t('menu_settings_resolution'),
        action: MenuAction.Resolution,
        y,
        value: resDisplay,
      })
      y += spacing
      this.menuItems.push({
        label: localizer.t('menu_settings_attack_defense_gestures'),
        action: MenuAction.AttackDefenseGestures,
        y,
        value: attackDefenseDisplay,
      })
      y += spacing
      this.menuItems.push({
        label: localizer.t('menu_back'),
        action: MenuAction.Back,
        y,
      })
    } else if (this.mode === MenuMode.SaveList) {
      this.initSaveListItems(startY, spacing)
    }

    if (this.selectedIndex >= this.menuItems.length) {
      this.selectedIndex = 0
    }
  }

  private initSaveListItems(startY: number, spacing: number) {
    const saves = this.saveListCache
    const saveItemSpacing = 60

    this.lastSelectedSaveIndex = -1
    if (saves.length === 0) {
      this.menuItems = [
        {
          label: localizer.t('save_list_empty'),
          action: MenuAction.SaveListSelect,
          y: startY,
        },
        {
          label: localizer.t('save_list_delete'),
          action: MenuAction.SaveListDelete,
          y: startY + spacing * 2,
        },
        {
          label: localizer.t('save_list_new'),
          action: MenuAction.SaveListNew,
          y: startY + spacing * 2,
        },
        {
          label: localizer.t('menu_back'),
          action: MenuAction.Back,
          y: startY + spacing * 3,
        },
      ]
      return
    }

    let y = startY
    for (let i = 0; i < saves.length; i++) {
      const save = saves[i]
      this.menuItems.push({
        label: save.name,
        action: MenuAction.SaveListSelect,
        y,
        saveId: save.id,
        saveMeta: save,
      })
      y += saveItemSpacing
    }
    this.lastSelectedSaveIndex = 0

    y += spacing * 0.5
    this.menuItems.push({
      label: localizer.t('save_list_delete'),
      action: MenuAction.SaveListDelete,
      y,
    })
    y += spacing

    this.menuItems.push({
      label: localizer.t('save_list_new'),
      action: MenuAction.SaveListNew,
      y,
    })
    y += spacing

    this.menuItems.push({
      label: localizer.t('menu_back'),
      action: MenuAction.Back,
      y,
    })
  }

  private setupInput() {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!this.canInteract()) return
      if (this.dialogManager?.consumeBlockedPostCloseKey(e)) return
      if (this.shouldIgnoreKeyEvent(e)) return

      if (e.key === 'ArrowUp' || e.key === 'w') {
        e.preventDefault()
        if (this.mode === MenuMode.SaveList) {
          const nextIndex = this.findSaveListDirectionalIndex(0, -1)
          this.setSelectedIndex(nextIndex)
          return
        }
        this.setSelectedIndex(
          (this.selectedIndex - 1 + this.menuItems.length) %
            this.menuItems.length
        )
      } else if (e.key === 'ArrowDown' || e.key === 's') {
        e.preventDefault()
        if (this.mode === MenuMode.SaveList) {
          const nextIndex = this.findSaveListDirectionalIndex(0, 1)
          this.setSelectedIndex(nextIndex)
          return
        }
        this.setSelectedIndex((this.selectedIndex + 1) % this.menuItems.length)
      } else if (e.key === 'ArrowLeft' || e.key === 'a') {
        if (this.mode === MenuMode.SaveList) {
          e.preventDefault()
          const nextIndex = this.findSaveListDirectionalIndex(-1, 0)
          this.setSelectedIndex(nextIndex)
          return
        }
        const item = this.menuItems[this.selectedIndex]
        if (item.action === MenuAction.Language) {
          e.preventDefault()
          this.cycleLanguage(-1)
        } else if (item.action === MenuAction.Resolution) {
          e.preventDefault()
          this.cycleResolution(-1)
        } else if (item.action === MenuAction.Fullscreen) {
          e.preventDefault()
          void this.handleToggleFullscreen()
        } else if (item.action === MenuAction.Orientation) {
          e.preventDefault()
          void this.handleToggleOrientation()
        } else if (item.action === MenuAction.AttackDefenseGestures) {
          e.preventDefault()
          this.selectMenuItem(this.selectedIndex)
        }
      } else if (e.key === 'ArrowRight' || e.key === 'd') {
        if (this.mode === MenuMode.SaveList) {
          e.preventDefault()
          const nextIndex = this.findSaveListDirectionalIndex(1, 0)
          this.setSelectedIndex(nextIndex)
          return
        }
        const item = this.menuItems[this.selectedIndex]
        if (item.action === MenuAction.Language) {
          e.preventDefault()
          this.cycleLanguage(1)
        } else if (item.action === MenuAction.Resolution) {
          e.preventDefault()
          this.cycleResolution(1)
        } else if (item.action === MenuAction.Fullscreen) {
          e.preventDefault()
          void this.handleToggleFullscreen()
        } else if (item.action === MenuAction.Orientation) {
          e.preventDefault()
          void this.handleToggleOrientation()
        } else if (item.action === MenuAction.AttackDefenseGestures) {
          e.preventDefault()
          this.selectMenuItem(this.selectedIndex)
        }
      } else if (e.key === 'Escape') {
        if (
          this.mode === MenuMode.Settings ||
          this.mode === MenuMode.SaveList
        ) {
          e.preventDefault()
          this.show(this.previousMode, true)
        }
      }
    }

    const handleKeyUp = (e: KeyboardEvent) => {
      if (!this.canInteract()) return
      if (this.dialogManager?.consumeBlockedPostCloseKey(e)) return
      if (this.shouldIgnoreKeyEvent(e)) return

      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        this.selectMenuItem(this.selectedIndex)
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (this.mode === MenuMode.SaveList) {
          const saveId = this.getSelectedSaveId()
          if (!saveId) return
          e.preventDefault()
          void this.handleDeleteSelectedSave()
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown, true)
    window.addEventListener('keyup', handleKeyUp, true)
  }

  private shouldIgnoreKeyEvent(e: KeyboardEvent): boolean {
    if (this.dialogManager?.isDialogOpen()) return true
    const target = e.target
    if (target instanceof HTMLInputElement) return true
    if (target instanceof HTMLTextAreaElement) return true
    if (target instanceof HTMLSelectElement) return true
    if (target instanceof HTMLElement && target.isContentEditable) {
      return true
    }
    return false
  }

  private findSaveListDirectionalIndex(
    directionX: number,
    directionY: number
  ): number {
    return findDirectionalIndex(
      this.selectedIndex,
      this.menuItems.length,
      (index) => {
        const element = this.menuItemElements[index]
        if (!element || element.style.display === 'none') {
          return null
        }
        return element
      },
      directionX,
      directionY
    )
  }

  private async deleteSave(saveId: string) {
    const success = await saveManager.deleteSave(saveId)
    if (success) {
      await this.refreshSaveList()
      this.initMenuItems()
      this.syncMenuDom()
      return
    }
    if (this.dialogManager) {
      await this.dialogManager.alert(localizer.t('save_delete_failed'))
    }
  }

  private getSelectedSaveId(): string | null {
    if (this.lastSelectedSaveIndex < 0) {
      return null
    }
    const item = this.menuItems[this.lastSelectedSaveIndex]
    if (!item || item.action !== MenuAction.SaveListSelect || !item.saveId) {
      return null
    }
    return item.saveId
  }

  private async handleDeleteSelectedSave() {
    const saveId = this.getSelectedSaveId()
    if (!saveId) return
    const item = this.menuItems[this.lastSelectedSaveIndex]
    const saveName = item?.saveMeta?.name ?? ''
    if (this.dialogManager) {
      const confirmed = await this.dialogManager.confirmHoldToDelete(
        localizer.t('save_list_delete_confirm').replace('{0}', saveName)
      )
      if (!confirmed) {
        return
      }
    }
    await this.deleteSave(saveId)
  }

  private async cycleLanguage(direction: number) {
    const languages = Object.values(Language)
    const currentLang = localizer.getCurrentLanguage()
    const currentIndex = languages.indexOf(currentLang)
    let newIndex = (currentIndex + direction) % languages.length
    if (newIndex < 0) newIndex += languages.length

    await localizer.setLanguage(languages[newIndex])
    this.initMenuItems()
    this.syncMenuDom()
  }

  private handleItemMouseEnter(event: Event) {
    if (!this.canInteract()) return
    const target = event.currentTarget
    if (!(target instanceof HTMLButtonElement)) return
    const index = Number.parseInt(target.dataset.index || '', 10)
    if (!Number.isFinite(index)) return
    if (index !== this.selectedIndex) {
      this.setSelectedIndex(index)
    }
  }

  private handleItemClick(event: Event) {
    if (!this.canInteract()) return
    const target = event.currentTarget
    if (!(target instanceof HTMLButtonElement)) return
    const index = Number.parseInt(target.dataset.index || '', 10)
    if (!Number.isFinite(index)) return
    const item = this.menuItems[index]
    if (!item) return
    this.setSelectedIndex(index)
    const direction = this.getDirectionalCycleClickDirection(event)
    if (item.action === MenuAction.Language) {
      if (direction !== 0) {
        this.cycleLanguage(direction)
      }
      return
    }
    if (item.action === MenuAction.Resolution) {
      if (direction !== 0) {
        this.cycleResolution(direction)
      }
      return
    }
    this.selectMenuItem(index)
  }

  private getDirectionalCycleClickDirection(event: Event): number {
    const target = event.target
    if (!(target instanceof HTMLElement)) {
      return 0
    }
    const control = target.closest<HTMLElement>('[data-cycle-direction]')
    if (!control) {
      return 0
    }
    const direction = Number.parseInt(control.dataset.cycleDirection ?? '', 10)
    if (direction === -1 || direction === 1) {
      return direction
    }
    return 0
  }

  private ensureMenuItemElements(count: number) {
    while (this.menuItemElements.length < count) {
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'menu-item'
      button.addEventListener('mouseenter', this.boundHandleItemMouseEnter)
      button.addEventListener('click', this.boundHandleItemClick)
      this.menuItemsContainer.appendChild(button)
      this.menuItemElements.push(button)
    }
  }

  private buildMenuItemText(item: MenuItem): string {
    let text = item.label
    if (item.value) {
      text += ` : ${item.value}`
    }
    return text
  }

  private updateMenuItemState(index: number) {
    if (index < 0 || index >= this.activeItemCount) return
    const item = this.menuItems[index]
    const element = this.menuItemElements[index]
    if (!item || !element) return
    const isSaveItem = item.action === MenuAction.SaveListSelect
    const isSelected =
      this.mode === MenuMode.SaveList && isSaveItem
        ? this.lastSelectedSaveIndex >= 0
          ? index === this.lastSelectedSaveIndex
          : index === this.selectedIndex
        : index === this.selectedIndex
    element.classList.toggle('is-selected', isSelected)
    element.classList.toggle('menu-item-back', item.action === MenuAction.Back)
    element.classList.toggle('menu-item-save', isSaveItem)
    element.classList.toggle(
      'menu-item-value',
      this.hasAlignedValueContent(item)
    )
    element.classList.toggle(
      'menu-item-cycle',
      this.isDirectionalCycleItem(item)
    )
    element.classList.toggle(
      'menu-item-save-new',
      item.action === MenuAction.SaveListNew && this.mode === MenuMode.SaveList
    )
    element.classList.toggle(
      'menu-item-save-delete',
      item.action === MenuAction.SaveListDelete &&
        this.mode === MenuMode.SaveList
    )
    element.disabled =
      item.action === MenuAction.SaveListDelete &&
      this.mode === MenuMode.SaveList &&
      this.lastSelectedSaveIndex < 0

    if (isSaveItem && item.saveMeta) {
      this.renderSaveItemContent(element, item.saveMeta)
    } else if (this.hasAlignedValueContent(item)) {
      this.renderAlignedValueContent(element, item)
    } else {
      element.textContent = this.buildMenuItemText(item)
    }
  }

  private hasAlignedValueContent(item: MenuItem): boolean {
    return !!item.value
  }

  private isDirectionalCycleItem(item: MenuItem): boolean {
    return (
      item.action === MenuAction.Language ||
      item.action === MenuAction.Resolution
    )
  }

  private renderAlignedValueContent(
    element: HTMLButtonElement,
    item: MenuItem
  ) {
    const label = document.createElement('span')
    label.className = 'menu-item-value-label'
    label.textContent = item.label

    const colon = document.createElement('span')
    colon.className = 'menu-item-value-colon'
    colon.textContent = ':'

    const content = document.createElement('span')
    content.className = 'menu-item-value-content'

    if (!this.isDirectionalCycleItem(item)) {
      const value = document.createElement('span')
      value.className = 'menu-item-static-value'
      value.textContent = item.value ?? ''
      content.appendChild(value)
      element.replaceChildren(label, colon, content)
      return
    }

    const controls = document.createElement('span')
    controls.className = 'menu-item-cycle-controls'

    const leftArrow = document.createElement('span')
    leftArrow.className = 'menu-item-cycle-arrow'
    leftArrow.dataset.cycleDirection = '-1'
    leftArrow.textContent = '<'

    const value = document.createElement('span')
    value.className = 'menu-item-cycle-value'
    value.textContent = item.value ?? ''

    const rightArrow = document.createElement('span')
    rightArrow.className = 'menu-item-cycle-arrow'
    rightArrow.dataset.cycleDirection = '1'
    rightArrow.textContent = '>'

    controls.append(leftArrow, value, rightArrow)
    content.appendChild(controls)
    element.replaceChildren(label, colon, content)
  }

  private renderSaveItemContent(element: HTMLButtonElement, meta: SaveMeta) {
    element.innerHTML = ''

    const thumb =
      meta.thumbnail && meta.thumbnail.length > 0
        ? this.createSaveThumbnailImage(meta.thumbnail)
        : this.createSaveThumbnailPlaceholder()
    element.appendChild(thumb)

    const textContainer = document.createElement('div')
    textContainer.className = 'save-item-text'

    const nameEl = document.createElement('span')
    nameEl.className = 'save-item-name'
    nameEl.textContent = meta.name

    const infoEl = document.createElement('span')
    infoEl.className = 'save-item-info'
    const playTime = saveManager.formatPlayTime(meta.playTimeMs)
    const lastPlayed = saveManager.formatLastPlayed(meta.updatedAt)
    infoEl.textContent = `${meta.mapName} · ${playTime} · ${lastPlayed}`

    textContainer.appendChild(nameEl)
    textContainer.appendChild(infoEl)
    element.appendChild(textContainer)
  }

  private createSaveThumbnailImage(src: string): HTMLImageElement {
    const img = document.createElement('img')
    img.className = 'save-item-thumb'
    img.src = src
    return img
  }

  private createSaveThumbnailPlaceholder(): HTMLDivElement {
    const placeholder = document.createElement('div')
    placeholder.className = 'save-item-thumb save-item-thumb-placeholder'
    return placeholder
  }

  private updateMenuTitle() {
    if (this.mode === MenuMode.SaveList) {
      this.menuTitle.textContent = localizer.t('save_list_title')
    } else {
      this.menuTitle.textContent = localizer.t('title')
    }
    this.menuTitle.classList.toggle(
      'menu-title-compact',
      this.mode === MenuMode.SaveList
    )
    const isSaveList = this.mode === MenuMode.SaveList
    this.menuTitle.style.display = isSaveList ? 'none' : ''
    this.saveListContainer.style.display = isSaveList ? 'flex' : 'none'
    this.saveListActions.classList.toggle('is-visible', isSaveList)
    if (isSaveList) {
      this.saveListTitle.textContent = localizer.t('save_list_title')
    }
  }

  private syncMenuDom() {
    this.updateMenuTitle()
    this.ensureMenuItemElements(this.menuItems.length)
    this.activeItemCount = this.menuItems.length
    if (this.mode === MenuMode.SaveList) {
      this.saveListList.innerHTML = ''
      this.saveListActions.innerHTML = ''
    }
    for (let i = 0; i < this.menuItemElements.length; i++) {
      const element = this.menuItemElements[i]
      const item = this.menuItems[i]
      if (i < this.activeItemCount) {
        element.style.display = ''
        element.dataset.index = String(i)
        this.updateMenuItemState(i)
        if (this.mode === MenuMode.SaveList && item) {
          element.style.top = ''
          if (item.action === MenuAction.SaveListSelect) {
            this.saveListList.appendChild(element)
          } else if (
            item.action === MenuAction.SaveListNew ||
            item.action === MenuAction.SaveListDelete
          ) {
            this.saveListActions.appendChild(element)
          } else {
            this.menuItemsContainer.appendChild(element)
          }
        } else if (item) {
          this.menuItemsContainer.appendChild(element)
        }
        if (item?.action === MenuAction.Back) {
          element.style.top = ''
        }
      } else {
        element.style.display = 'none'
        element.dataset.index = ''
      }
    }
    if (
      this.mode === MenuMode.SaveList &&
      this.lastSelectedSaveIndex >= 0 &&
      this.lastSelectedSaveIndex < this.menuItems.length
    ) {
      this.updateMenuItemState(this.lastSelectedSaveIndex)
    }
  }

  private setSelectedIndex(index: number) {
    if (index === this.selectedIndex) return
    const previousIndex = this.selectedIndex
    const previousSaveSelectedIndex = this.lastSelectedSaveIndex
    this.selectedIndex = index
    const selected = this.menuItems[index]
    if (
      this.mode === MenuMode.SaveList &&
      selected?.action === MenuAction.SaveListSelect
    ) {
      this.lastSelectedSaveIndex = index
    }
    this.updateMenuItemState(previousIndex)
    if (
      this.mode === MenuMode.SaveList &&
      previousSaveSelectedIndex >= 0 &&
      previousSaveSelectedIndex !== this.lastSelectedSaveIndex
    ) {
      this.updateMenuItemState(previousSaveSelectedIndex)
    }
    this.updateMenuItemState(index)
    if (
      this.mode === MenuMode.SaveList &&
      previousIndex !== this.lastSelectedSaveIndex
    ) {
      this.updateMenuItemState(this.lastSelectedSaveIndex)
    }
    if (this.mode === MenuMode.SaveList) {
      const deleteIndex = this.findMenuItemIndex(MenuAction.SaveListDelete)
      if (deleteIndex >= 0) {
        this.updateMenuItemState(deleteIndex)
      }
    }
    if (this.mode === MenuMode.SaveList) {
      const item = this.menuItems[this.selectedIndex]
      const element = this.menuItemElements[this.selectedIndex]
      if (
        item &&
        element &&
        item.action === MenuAction.SaveListSelect &&
        element.scrollIntoView
      ) {
        element.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
      }
    }
  }

  private cycleResolution(direction: number): void {
    if (!this.displayManager) return
    this.displayManager.cycleResolution(direction)
    this.initMenuItems()
    this.syncMenuDom()
  }

  private async handleToggleFullscreen(): Promise<void> {
    await this.displayManager?.toggleFullscreen()
  }

  private async handleToggleOrientation(): Promise<void> {
    const changed = await this.displayManager?.toggleOrientation()
    if (!changed || !this.visible || this.mode !== MenuMode.Settings) {
      return
    }
    this.initMenuItems()
    this.syncMenuDom()
  }

  private selectMenuItem(index: number) {
    const item = this.menuItems[index]

    if (item.action === MenuAction.Fullscreen) {
      void this.handleToggleFullscreen()
      return
    }

    if (item.action === MenuAction.Orientation) {
      void this.handleToggleOrientation()
      return
    }

    if (item.action === MenuAction.Settings) {
      this.previousMode = this.mode
      this.show(MenuMode.Settings, true)
      return
    }

    if (item.action === MenuAction.LoadGame) {
      this.previousMode = this.mode
      this.refreshSaveList().then(() => {
        this.show(MenuMode.SaveList, true)
      })
      return
    }

    if (item.action === MenuAction.Back) {
      this.show(this.previousMode, true)
      return
    }

    if (item.action === MenuAction.SaveListDelete) {
      void this.handleDeleteSelectedSave()
      return
    }

    if (this.onActionCallback) {
      this.onActionCallback(item.action, item.saveId)
    }
  }

  private findMenuItemIndex(action: MenuAction): number {
    for (let i = 0; i < this.menuItems.length; i++) {
      if (this.menuItems[i].action === action) {
        return i
      }
    }
    return -1
  }

  private canInteract(): boolean {
    return this.visible && this.inputReady
  }

  private setInputReady(ready: boolean): void {
    if (this.inputReady === ready) return
    this.inputReady = ready
    this.menuItemsContainer.inert = !ready
  }

  show(mode: MenuMode = MenuMode.Start, skipAnimation = false) {
    if (mode === MenuMode.SaveList) {
      this.dialogManager?.resetPostCloseKeyBlock()
    }
    this.mode = mode
    this.visible = true
    this.selectedIndex = 0
    this.animTime = skipAnimation ? MENU_ANIMATION_DURATION_MS : 0
    this.setInputReady(skipAnimation)
    this.initMenuItems()
    if (mode === MenuMode.SaveList && this.lastSelectedSaveIndex >= 0) {
      this.selectedIndex = this.lastSelectedSaveIndex
    }
    this.syncMenuDom()
    this.uiLayer.classList.add('is-interactive')
    this.menuOverlay.classList.add('is-visible')
    this.menuOverlay.setAttribute('aria-hidden', 'false')
    this.menuOverlay.focus(this.focusOptions)
    this.render(0)
  }

  async showWithSaveRefresh(
    mode: MenuMode = MenuMode.Start,
    skipAnimation = false
  ) {
    await this.initSaveState()
    this.show(mode, skipAnimation)
  }

  hide() {
    this.visible = false
    this.setInputReady(false)
    this.uiLayer.classList.remove('is-interactive')
    this.menuOverlay.classList.remove('is-visible')
    this.menuOverlay.setAttribute('aria-hidden', 'true')
  }

  isVisible(): boolean {
    return this.visible
  }

  getMode(): MenuMode {
    return this.mode
  }

  onAction(callback: (action: MenuAction, saveId?: string) => void) {
    this.onActionCallback = callback
  }

  render(deltaTime: number) {
    if (!this.visible) return

    const preset = this.displayManager?.getCurrentPreset()
    const height =
      this.canvas.clientHeight ||
      this.canvas.offsetHeight ||
      preset?.height ||
      600

    this.animTime += deltaTime * 1000
    const duration = MENU_ANIMATION_DURATION_MS
    const t = Math.min(1, this.animTime / duration)
    const ease = t

    if (t === 1) {
      this.setInputReady(true)
    }

    const isSmallScreen = height < 500
    const titleTargetY = isSmallScreen ? height * 0.22 : height / 2 - 150
    const titleStartY = -150
    const titleY = titleStartY + (titleTargetY - titleStartY) * ease

    const groupStartY = height / 2
    const currentGroupOffset = groupStartY * (1 - ease)

    this.menuTitle.style.top = `${titleY}px`

    if (this.mode === MenuMode.SaveList) {
      return
    }

    for (let i = 0; i < this.menuItems.length; i++) {
      const item = this.menuItems[i]
      const element = this.menuItemElements[i]
      if (!element) continue
      if (item.action === MenuAction.Back) {
        continue
      }
      const currentY = item.y + currentGroupOffset
      element.style.top = `${currentY}px`
    }
  }
}
