import { localizer } from './Localizer'

export enum MenuAction {
  NewGame,
  Continue,
  Editor,
  Settings,
  Exit,
  Resume,
  MainMenu,
}

export enum MenuMode {
  Start,
  Pause,
}

interface MenuItem {
  label: string
  action: MenuAction
  y: number
}

export class MenuManager {
  private canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private visible = false
  private mode: MenuMode = MenuMode.Start
  private menuItems: MenuItem[] = []
  private selectedIndex = 0
  private onActionCallback?: (action: MenuAction) => void
  private mouseX = 0
  private mouseY = 0

  constructor(canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D) {
    this.canvas = canvas
    this.ctx = ctx
    this.initMenuItems()
    this.setupInput()
  }

  private initMenuItems() {
    const startY = this.canvas.height / 2 + 40
    const spacing = 35

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
    } else {
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
        this.render()
      } else if (e.key === 'ArrowDown' || e.key === 's') {
        e.preventDefault()
        this.selectedIndex = (this.selectedIndex + 1) % this.menuItems.length
        this.render()
      } else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        this.selectMenuItem(this.selectedIndex)
      }
    }

    const handleMouseMove = (e: MouseEvent) => {
      if (!this.visible) return

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
        this.render()
      }
    }

    const handleClick = (e: MouseEvent) => {
      if (!this.visible) return

      const rect = this.canvas.getBoundingClientRect()
      this.mouseX = e.clientX - rect.left
      this.mouseY = e.clientY - rect.top

      for (let i = 0; i < this.menuItems.length; i++) {
        if (this.isMouseOverItem(i)) {
          this.selectMenuItem(i)
          break
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    this.canvas.addEventListener('mousemove', handleMouseMove)
    this.canvas.addEventListener('click', handleClick)
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
    if (this.onActionCallback) {
      this.onActionCallback(item.action)
    }
  }

  show(mode: MenuMode = MenuMode.Start) {
    this.mode = mode
    this.visible = true
    this.selectedIndex = 0
    this.initMenuItems()
    this.render()
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

  render() {
    if (!this.visible) return

    const width = this.canvas.width
    const height = this.canvas.height
    const centerX = width / 2

    this.ctx.fillStyle = 'rgba(11, 12, 14, 0.2)'
    this.ctx.fillRect(0, 0, width, height)

    this.ctx.font = 'bold 150px monospace'
    this.ctx.fillStyle = '#ffffff'
    this.ctx.textAlign = 'center'
    this.ctx.textBaseline = 'middle'
    this.ctx.fillText(localizer.t('title'), centerX, height / 2 - 150)

    this.ctx.font = '20px monospace'
    for (let i = 0; i < this.menuItems.length; i++) {
      const item = this.menuItems[i]
      const isSelected = i === this.selectedIndex

      if (isSelected) {
        this.ctx.fillStyle = 'rgba(255, 255, 255, 0.2)'
        this.ctx.fillRect(centerX - 120, item.y - 15, 240, 30)
      }

      this.ctx.fillStyle = isSelected ? '#ffffff' : '#aaaaaa'
      this.ctx.fillText(item.label, centerX, item.y)
    }
  }
}
