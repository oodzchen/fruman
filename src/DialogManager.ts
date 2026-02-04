import { localizer } from './Localizer'

export class DialogManager {
  private container: HTMLDivElement
  private overlay: HTMLDivElement
  private contentBox: HTMLDivElement
  private messageBox: HTMLDivElement
  private inputBox: HTMLInputElement | null = null
  private buttonsContainer: HTMLDivElement
  private inputTarget: HTMLElement
  private focusOptions: FocusOptions = { preventScroll: true }
  private activeButtons: HTMLButtonElement[] = []
  private selectedButtonIndex = 0
  private isOpen = false
  private isLoading = false
  private resolveCallback: ((value: boolean | string | null) => void) | null =
    null
  private boundHandleKeyDown: (event: KeyboardEvent) => void

  constructor(parentElement: HTMLElement, inputTarget?: HTMLElement) {
    this.container = document.createElement('div')
    this.container.style.cssText = `
      position: absolute;
      inset: 0;
      display: none;
      z-index: 100;
      pointer-events: none;
    `

    this.overlay = document.createElement('div')
    this.overlay.style.cssText = `
      position: absolute;
      inset: 0;
      background: rgba(0, 0, 0, 0.75);
      pointer-events: auto;
    `

    this.contentBox = document.createElement('div')
    this.contentBox.style.cssText = `
      position: absolute;
      left: 50%;
      top: 50%;
      transform: translate(-50%, -50%);
      min-width: 300px;
      max-width: 500px;
      padding: 24px;
      background: rgba(0, 0, 0, 0.9);
      border: 1px solid rgba(255, 255, 255, 0.25);
      font-family: monospace;
      color: #ffffff;
      box-sizing: border-box;
    `

    this.messageBox = document.createElement('div')
    this.messageBox.style.cssText = `
      font-size: 16px;
      line-height: 1.5;
      margin-bottom: 20px;
      text-align: center;
      white-space: pre-wrap;
      word-break: break-word;
    `

    this.buttonsContainer = document.createElement('div')
    this.buttonsContainer.style.cssText = `
      display: flex;
      gap: 12px;
      justify-content: center;
    `

    this.contentBox.appendChild(this.messageBox)
    this.contentBox.appendChild(this.buttonsContainer)
    this.container.appendChild(this.overlay)
    this.container.appendChild(this.contentBox)
    parentElement.appendChild(this.container)
    this.boundHandleKeyDown = this.handleKeyDown.bind(this)
    this.inputTarget = inputTarget ?? parentElement
    if (this.inputTarget.tabIndex < 0) {
      this.inputTarget.tabIndex = 0
    }

    this.overlay.addEventListener('click', () => {
      if (this.isLoading) {
        return
      }
      this.close(false)
    })
  }

  private open(): void {
    this.isOpen = true
    this.container.style.display = 'block'
    this.container.style.pointerEvents = 'auto'
    this.inputTarget.addEventListener('keydown', this.boundHandleKeyDown, true)
    this.inputTarget.focus(this.focusOptions)
  }

  isDialogOpen(): boolean {
    return this.isOpen
  }

  private close(result: boolean | string | null): void {
    if (!this.isOpen) return
    this.isOpen = false
    this.container.style.display = 'none'
    this.container.style.pointerEvents = 'none'
    this.inputTarget.removeEventListener(
      'keydown',
      this.boundHandleKeyDown,
      true
    )

    if (this.inputBox) {
      this.inputBox.remove()
      this.inputBox = null
    }

    if (this.resolveCallback) {
      this.resolveCallback(result)
      this.resolveCallback = null
    }
    this.activeButtons.length = 0
  }

  private applyButtonStyle(button: HTMLButtonElement, selected: boolean) {
    button.classList.toggle('is-selected', selected)
  }

  private setDialogButtons(buttons: HTMLButtonElement[]) {
    this.activeButtons = buttons
    this.selectedButtonIndex = 0
    this.applyDialogButtonSelection()
  }

  private applyDialogButtonSelection() {
    for (let i = 0; i < this.activeButtons.length; i++) {
      this.applyButtonStyle(
        this.activeButtons[i],
        i === this.selectedButtonIndex
      )
    }
  }

  private setSelectedButtonIndex(index: number) {
    if (this.activeButtons.length === 0) {
      return
    }
    if (index < 0) {
      this.selectedButtonIndex = 0
    } else if (index >= this.activeButtons.length) {
      this.selectedButtonIndex = this.activeButtons.length - 1
    } else {
      this.selectedButtonIndex = index
    }
    this.applyDialogButtonSelection()
    this.activeButtons[this.selectedButtonIndex].focus()
  }

  private findDirectionalButtonIndex(dirX: number, dirY: number): number {
    if (this.activeButtons.length === 0) {
      return this.selectedButtonIndex
    }
    const currentButton = this.activeButtons[this.selectedButtonIndex]
    const currentRect = currentButton.getBoundingClientRect()
    const currentLeft = Math.round(currentRect.left)
    const currentTop = Math.round(currentRect.top)
    const currentWidth = Math.round(currentRect.width)
    const currentHeight = Math.round(currentRect.height)
    const currentX = currentLeft + (currentWidth >> 1)
    const currentY = currentTop + (currentHeight >> 1)

    let bestIndex = this.selectedButtonIndex
    let bestScore = Number.MAX_SAFE_INTEGER

    for (let i = 0; i < this.activeButtons.length; i++) {
      if (i === this.selectedButtonIndex) {
        continue
      }
      const button = this.activeButtons[i]
      const rect = button.getBoundingClientRect()
      const left = Math.round(rect.left)
      const top = Math.round(rect.top)
      const width = Math.round(rect.width)
      const height = Math.round(rect.height)
      const centerX = left + (width >> 1)
      const centerY = top + (height >> 1)
      const dx = centerX - currentX
      const dy = centerY - currentY
      if (dirY !== 0) {
        if (dy === 0 || dy * dirY <= 0) {
          continue
        }
        const absDy = Math.abs(dy)
        const absDx = Math.abs(dx)
        if (absDy < absDx) {
          continue
        }
        const score = absDy * absDy * 4 + absDx * absDx
        if (score < bestScore) {
          bestScore = score
          bestIndex = i
        }
      } else if (dirX !== 0) {
        if (dx === 0 || dx * dirX <= 0) {
          continue
        }
        const absDx = Math.abs(dx)
        const absDy = Math.abs(dy)
        if (absDx < absDy) {
          continue
        }
        const score = absDx * absDx * 4 + absDy * absDy
        if (score < bestScore) {
          bestScore = score
          bestIndex = i
        }
      }
    }

    return bestIndex
  }

  private handleKeyDown(event: KeyboardEvent) {
    if (!this.isOpen) {
      return
    }
    if (this.isLoading) {
      event.preventDefault()
      event.stopPropagation()
      return
    }
    const key = event.key
    if (key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      if (this.inputBox) {
        this.close(null)
      } else if (this.activeButtons.length === 1) {
        this.close(true)
      } else {
        this.close(false)
      }
      return
    }
    if (key === 'Enter' || key === ' ') {
      if (this.activeButtons.length === 0) {
        return
      }
      event.preventDefault()
      event.stopPropagation()
      this.activeButtons[this.selectedButtonIndex].click()
      return
    }
    if (
      key === 'ArrowLeft' ||
      key === 'ArrowRight' ||
      key === 'ArrowUp' ||
      key === 'ArrowDown'
    ) {
      if (
        this.inputBox &&
        document.activeElement === this.inputBox &&
        (key === 'ArrowLeft' || key === 'ArrowRight')
      ) {
        return
      }
      if (this.activeButtons.length === 0) {
        return
      }
      event.preventDefault()
      event.stopPropagation()
      if (key === 'ArrowLeft') {
        this.setSelectedButtonIndex(this.findDirectionalButtonIndex(-1, 0))
      } else if (key === 'ArrowRight') {
        this.setSelectedButtonIndex(this.findDirectionalButtonIndex(1, 0))
      } else if (key === 'ArrowUp') {
        this.setSelectedButtonIndex(this.findDirectionalButtonIndex(0, -1))
      } else if (key === 'ArrowDown') {
        this.setSelectedButtonIndex(this.findDirectionalButtonIndex(0, 1))
      }
    }
  }

  private createButton(
    text: string,
    onClick: () => void,
    isPrimary = false
  ): HTMLButtonElement {
    const button = document.createElement('button')
    button.textContent = text
    button.className = 'editor-action-btn'
    button.dataset.primary = isPrimary ? '1' : '0'
    button.style.minWidth = '100px'

    button.addEventListener('click', onClick)
    return button
  }

  alert(message: string): Promise<void> {
    return new Promise((resolve) => {
      this.resolveCallback = () => {
        resolve()
      }
      this.messageBox.textContent = message
      this.buttonsContainer.innerHTML = ''

      const okButton = this.createButton(
        localizer.t('editor_btn_confirm'),
        () => {
          this.close(true)
        },
        true
      )

      this.buttonsContainer.appendChild(okButton)
      this.setDialogButtons([okButton])
      this.open()

      setTimeout(() => okButton.focus(), 100)
    })
  }

  confirm(message: string): Promise<boolean> {
    return new Promise((resolve) => {
      this.resolveCallback = (result) => {
        resolve(result === true)
      }

      this.messageBox.textContent = message
      this.buttonsContainer.innerHTML = ''

      const confirmButton = this.createButton(
        localizer.t('editor_btn_confirm'),
        () => {
          this.close(true)
        },
        true
      )

      const cancelButton = this.createButton(
        localizer.t('editor_btn_cancel'),
        () => {
          this.close(false)
        }
      )

      this.buttonsContainer.appendChild(confirmButton)
      this.buttonsContainer.appendChild(cancelButton)
      this.setDialogButtons([confirmButton, cancelButton])
      this.open()

      setTimeout(() => confirmButton.focus(), 100)
    })
  }

  confirmWithCancel(
    message: string,
    confirmLabel: string,
    cancelLabel: string,
    dismissLabel: string
  ): Promise<'confirm' | 'cancel' | 'dismiss'> {
    return new Promise((resolve) => {
      this.resolveCallback = (result) => {
        if (
          result === 'confirm' ||
          result === 'cancel' ||
          result === 'dismiss'
        ) {
          resolve(result)
          return
        }
        resolve('dismiss')
      }

      this.messageBox.textContent = message
      this.buttonsContainer.innerHTML = ''

      const confirmButton = this.createButton(
        confirmLabel,
        () => {
          this.close('confirm')
        },
        true
      )

      const cancelButton = this.createButton(cancelLabel, () => {
        this.close('cancel')
      })

      const dismissButton = this.createButton(dismissLabel, () => {
        this.close('dismiss')
      })

      this.buttonsContainer.appendChild(confirmButton)
      this.buttonsContainer.appendChild(cancelButton)
      this.buttonsContainer.appendChild(dismissButton)
      this.setDialogButtons([confirmButton, cancelButton, dismissButton])
      this.open()

      setTimeout(() => confirmButton.focus(), 100)
    })
  }

  prompt(message: string, defaultValue = ''): Promise<string | null> {
    return new Promise((resolve) => {
      this.resolveCallback = (result) => {
        resolve(typeof result === 'string' ? result : null)
      }

      this.messageBox.textContent = message
      this.buttonsContainer.innerHTML = ''

      this.inputBox = document.createElement('input')
      this.inputBox.type = 'text'
      this.inputBox.value = defaultValue
      this.inputBox.style.cssText = `
        width: 100%;
        height: 36px;
        padding: 0 12px;
        margin-bottom: 20px;
        background: rgba(255, 255, 255, 0.08);
        border: 1px solid rgba(255, 255, 255, 0.25);
        color: #ffffff;
        font-size: 14px;
        font-family: monospace;
        box-sizing: border-box;
        outline: none;
      `

      this.inputBox.addEventListener('focus', () => {
        if (this.inputBox) {
          this.inputBox.style.background = 'rgba(255, 255, 255, 0.12)'
          this.inputBox.style.borderColor = 'rgba(255, 255, 255, 0.4)'
        }
      })

      this.inputBox.addEventListener('blur', () => {
        if (this.inputBox) {
          this.inputBox.style.background = 'rgba(255, 255, 255, 0.08)'
          this.inputBox.style.borderColor = 'rgba(255, 255, 255, 0.25)'
        }
      })

      this.inputBox.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          const value = this.inputBox?.value.trim() || ''
          this.close(value)
        } else if (e.key === 'Escape') {
          e.preventDefault()
          this.close(null)
        }
      })

      const confirmButton = this.createButton(
        localizer.t('editor_btn_confirm'),
        () => {
          const value = this.inputBox?.value.trim() || ''
          this.close(value)
        },
        true
      )

      const cancelButton = this.createButton(
        localizer.t('editor_btn_cancel'),
        () => {
          this.close(null)
        }
      )

      this.contentBox.insertBefore(this.inputBox, this.buttonsContainer)
      this.buttonsContainer.appendChild(confirmButton)
      this.buttonsContainer.appendChild(cancelButton)
      this.setDialogButtons([confirmButton, cancelButton])
      this.open()

      setTimeout(() => {
        if (this.inputBox) {
          this.inputBox.focus()
          this.inputBox.select()
        }
      }, 100)
    })
  }

  showLoading(message: string): void {
    if (this.isOpen) {
      return
    }
    this.isLoading = true
    this.messageBox.textContent = message
    this.buttonsContainer.innerHTML = ''
    this.activeButtons.length = 0
    this.open()
  }

  hideLoading(): void {
    if (!this.isLoading) {
      return
    }
    this.isLoading = false
    this.close(null)
  }
}
