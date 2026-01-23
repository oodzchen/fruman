import { Language, localizer } from './Localizer'

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
}

export enum MenuMode {
  Start,
  Pause,
  Settings,
}

interface MenuItem {
  label: string
  action: MenuAction
  y: number
  value?: string // For dynamic values like "English"
}

export class MenuManager {
  private canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private visible = false
  private mode: MenuMode = MenuMode.Start
  private previousMode: MenuMode = MenuMode.Start
  private menuItems: MenuItem[] = []
  private selectedIndex = 0
  private onActionCallback?: (action: MenuAction) => void
  private mouseX = 0
  private mouseY = 0
  private animTime = 0

  constructor(canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D) {
    this.canvas = canvas
    this.ctx = ctx
    this.initMenuItems()
    this.setupInput()
  }

  private initMenuItems() {
    const startY = this.canvas.height / 2 + 40
    const spacing = 35
    this.menuItems = []

    if (this.mode === MenuMode.Start) {
      this.menuItems = [
        {
          label: localizer.t('menu_new_game'),
          action: MenuAction.NewGame,
          y: startY,
        },
        {
          label: localizer.t('menu_continue_game'),
          action: MenuAction.Continue,
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
    } else if (this.mode === MenuMode.Pause) {
      this.menuItems = [
        {
          label: localizer.t('menu_resume'),
          action: MenuAction.Resume,
          y: startY,
        },
        {
          label: localizer.t('menu_main_menu'),
          action: MenuAction.MainMenu,
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
    } else if (this.mode === MenuMode.Settings) {
      const currentLang = localizer.getCurrentLanguage()
      const langDisplay =
        currentLang === Language.ZhHans ? '简体中文' : 'English'

      this.menuItems = [
        {
          label: localizer.t('menu_settings_language'),
          action: MenuAction.Language,
          y: startY,
          value: langDisplay,
        },
        {
          label: localizer.t('menu_back'),
          action: MenuAction.Back,
          y: startY + spacing * 2, // Extra spacing
        },
      ]
    }
  }

  private setupInput() {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!this.visible) return

      if (e.key === 'ArrowUp' || e.key === 'w') {
        e.preventDefault()
        this.selectedIndex =
          (this.selectedIndex - 1 + this.menuItems.length) %
          this.menuItems.length
        // Reset animation time slightly for feedback? No, keep it smooth.
      } else if (e.key === 'ArrowDown' || e.key === 's') {
        e.preventDefault()
        this.selectedIndex = (this.selectedIndex + 1) % this.menuItems.length
      } else if (e.key === 'ArrowLeft' || e.key === 'a') {
        const item = this.menuItems[this.selectedIndex]
        if (item.action === MenuAction.Language) {
          e.preventDefault()
          this.cycleLanguage(-1)
        }
      } else if (e.key === 'ArrowRight' || e.key === 'd') {
        const item = this.menuItems[this.selectedIndex]
        if (item.action === MenuAction.Language) {
          e.preventDefault()
          this.cycleLanguage(1)
        }
      } else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        this.selectMenuItem(this.selectedIndex)
            } else if (e.key === 'Escape') {
              // Handle Back if in settings
              if (this.mode === MenuMode.Settings) {
                 e.preventDefault()
                 this.show(this.previousMode, true)
              }
            }
          }
      
          const handleMouseMove = (e: MouseEvent) => {      if (!this.visible) return

      const rect = this.canvas.getBoundingClientRect()
      this.mouseX = e.clientX - rect.left
      this.mouseY = e.clientY - rect.top

      let hoveredIndex = -1
      for (let i = 0; i < this.menuItems.length; i++) {
        if (this.isMouseOverItem(i)) {
          hoveredIndex = i
          break
        }
      }

      if (hoveredIndex !== -1 && hoveredIndex !== this.selectedIndex) {
        this.selectedIndex = hoveredIndex
      }
    }

    const handleClick = (e: MouseEvent) => {
      if (!this.visible) return

      const rect = this.canvas.getBoundingClientRect()
      this.mouseX = e.clientX - rect.left
      this.mouseY = e.clientY - rect.top

      for (let i = 0; i < this.menuItems.length; i++) {
        if (this.isMouseOverItem(i)) {
          // If clicking language, maybe cycle it?
          // Or just allow selection to do nothing (as interaction is via arrows)
          // But 'selectMenuItem' is called.
          const item = this.menuItems[i]
          if (item.action === MenuAction.Language) {
            this.cycleLanguage(1)
          } else {
            this.selectMenuItem(i)
          }
          break
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    this.canvas.addEventListener('mousemove', handleMouseMove)
    this.canvas.addEventListener('click', handleClick)
  }

  private async cycleLanguage(direction: number) {
    const languages = Object.values(Language)
    const currentLang = localizer.getCurrentLanguage()
    const currentIndex = languages.indexOf(currentLang)
    let newIndex = (currentIndex + direction) % languages.length
    if (newIndex < 0) newIndex += languages.length

    await localizer.setLanguage(languages[newIndex])
    this.initMenuItems() // Refresh text
  }

  private isMouseOverItem(index: number): boolean {
    const item = this.menuItems[index]
    const centerX = this.canvas.width / 2
    const itemWidth = 300
    const itemHeight = 40

    return (
      this.mouseX >= centerX - itemWidth / 2 &&
      this.mouseX <= centerX + itemWidth / 2 &&
      this.mouseY >= item.y - itemHeight / 2 &&
      this.mouseY <= item.y + itemHeight / 2
    )
  }

    private selectMenuItem(index: number) {
      const item = this.menuItems[index]
      
      if (item.action === MenuAction.Settings) {
        this.previousMode = this.mode
        this.show(MenuMode.Settings, true)
        return
      }
  
      if (item.action === MenuAction.Back) {
        this.show(this.previousMode, true)
        return
      }
  
      if (this.onActionCallback) {
        this.onActionCallback(item.action)
      }
    }
  show(mode: MenuMode = MenuMode.Start, skipAnimation = false) {
    this.mode = mode
    this.visible = true
    this.selectedIndex = 0
    // If skipping animation, fast forward to end state (300ms)
    this.animTime = skipAnimation ? 300 : 0
    this.initMenuItems()
    this.render(0)
  }

  hide() {
    this.visible = false
  }

  isVisible(): boolean {
    return this.visible
  }

  onAction(callback: (action: MenuAction) => void) {
    this.onActionCallback = callback
  }

  render(deltaTime: number) {
    if (!this.visible) return

    const width = this.canvas.width
    const height = this.canvas.height
    const centerX = width / 2

    // Background with 80% transparency
    this.ctx.fillStyle = 'rgba(11, 12, 14, 0.2)'
    this.ctx.fillRect(0, 0, width, height)

    // Animation progress
    this.animTime += deltaTime * 1000 // convert to ms
    const duration = 300 // ms
    const t = Math.min(1, this.animTime / duration)
    const ease = t

    // Title Animation (From top)
    const titleTargetY = height / 2 - 150
    const titleStartY = -150
    const titleY = titleStartY + (titleTargetY - titleStartY) * ease

    this.ctx.font = 'bold 150px monospace'
    this.ctx.fillStyle = '#ffffff'
    this.ctx.textAlign = 'center'
    this.ctx.textBaseline = 'middle'
    this.ctx.fillText(localizer.t('title'), centerX, titleY)

    // Menu Items Animation (From bottom)
    this.ctx.font = '20px monospace'

    const groupStartY = height / 2
    const currentGroupOffset = groupStartY * (1 - ease)

    for (let i = 0; i < this.menuItems.length; i++) {
      const item = this.menuItems[i]
      const isSelected = i === this.selectedIndex

      const currentY = item.y + currentGroupOffset

      if (isSelected) {
        this.ctx.fillStyle = 'rgba(255, 255, 255, 0.2)'
        this.ctx.fillRect(centerX - 150, currentY - 15, 300, 30)
      }

      this.ctx.fillStyle = isSelected ? '#ffffff' : '#aaaaaa'

      let text = item.label
      if (item.value) {
        // Add arrows if selected
        if (isSelected && item.action === MenuAction.Language) {
          text += ` < ${item.value} >`
        } else {
          text += ` : ${item.value}`
        }
      }

      this.ctx.fillText(text, centerX, currentY)
    }
  }
}
