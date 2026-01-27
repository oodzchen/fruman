import { localizer } from './Localizer'

export class DialogManager {
  private container: HTMLDivElement
  private overlay: HTMLDivElement
  private contentBox: HTMLDivElement
  private messageBox: HTMLDivElement
  private inputBox: HTMLInputElement | null = null
  private buttonsContainer: HTMLDivElement
  private isOpen = false
  private resolveCallback: ((value: boolean | string | null) => void) | null =
    null

  constructor(parentElement: HTMLElement) {
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

    this.overlay.addEventListener('click', () => {
      this.close(false)
    })
  }

  private open(): void {
    this.isOpen = true
    this.container.style.display = 'block'
    this.container.style.pointerEvents = 'auto'
  }

  private close(result: boolean | string | null): void {
    if (!this.isOpen) return
    this.isOpen = false
    this.container.style.display = 'none'
    this.container.style.pointerEvents = 'none'

    if (this.inputBox) {
      this.inputBox.remove()
      this.inputBox = null
    }

    if (this.resolveCallback) {
      this.resolveCallback(result)
      this.resolveCallback = null
    }
  }

  private createButton(
    text: string,
    onClick: () => void,
    isPrimary = false
  ): HTMLButtonElement {
    const button = document.createElement('button')
    button.textContent = text
    button.style.cssText = `
      min-width: 100px;
      height: 32px;
      line-height: 32px;
      font-size: 14px;
      color: ${isPrimary ? '#ffffff' : '#aaaaaa'};
      background: ${isPrimary ? 'rgba(120, 100, 60, 0.4)' : 'transparent'};
      border: 1px solid ${isPrimary ? 'rgba(255, 255, 255, 0.32)' : 'rgba(255, 255, 255, 0.2)'};
      padding: 0 16px;
      cursor: pointer;
      font-family: monospace;
      box-sizing: border-box;
    `

    button.addEventListener('mouseenter', () => {
      button.style.color = '#ffffff'
      button.style.background = 'rgba(120, 100, 60, 0.5)'
      button.style.borderColor = 'rgba(255, 255, 255, 0.4)'
    })

    button.addEventListener('mouseleave', () => {
      button.style.color = isPrimary ? '#ffffff' : '#aaaaaa'
      button.style.background = isPrimary
        ? 'rgba(120, 100, 60, 0.4)'
        : 'transparent'
      button.style.borderColor = isPrimary
        ? 'rgba(255, 255, 255, 0.32)'
        : 'rgba(255, 255, 255, 0.2)'
    })

    button.addEventListener('click', onClick)
    return button
  }

  alert(message: string): Promise<void> {
    return new Promise((resolve) => {
      this.messageBox.textContent = message
      this.buttonsContainer.innerHTML = ''

      const okButton = this.createButton(
        localizer.t('editor_btn_confirm'),
        () => {
          this.close(true)
          resolve()
        },
        true
      )

      this.buttonsContainer.appendChild(okButton)
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
      this.open()

      setTimeout(() => {
        if (this.inputBox) {
          this.inputBox.focus()
          this.inputBox.select()
        }
      }, 100)
    })
  }
}
