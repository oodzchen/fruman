import { DEFAULT_JUMP_BUFFER_WINDOW } from './constants'

interface BufferedInput {
  action: string
  timestamp: number
  bufferWindow: number
}

export class InputBuffer {
  private bufferedInputs: BufferedInput[] = []
  private defaultBufferWindow = DEFAULT_JUMP_BUFFER_WINDOW

  bufferAction(action: string, bufferWindow?: number) {
    const window = Math.max(0, bufferWindow ?? this.defaultBufferWindow)

    const existingIndex = this.bufferedInputs.findIndex(
      (input) => input.action === action
    )

    if (existingIndex !== -1) {
      this.bufferedInputs[existingIndex].timestamp = Date.now()
      this.bufferedInputs[existingIndex].bufferWindow = window
    } else {
      this.bufferedInputs.push({
        action,
        timestamp: Date.now(),
        bufferWindow: window,
      })
    }
  }

  tryExecute(
    action: string,
    canExecute: () => boolean,
    execute: () => void
  ): boolean {
    const index = this.bufferedInputs.findIndex(
      (input) => input.action === action
    )

    if (index === -1) return false

    const input = this.bufferedInputs[index]
    const elapsed = Date.now() - input.timestamp
    const isZeroWindow = input.bufferWindow === 0

    if (!isZeroWindow && elapsed >= input.bufferWindow) {
      this.bufferedInputs.splice(index, 1)
      return false
    }

    if (canExecute()) {
      execute()
      this.bufferedInputs.splice(index, 1)
      return true
    }

    // Zero-window inputs are never cached across frames.
    if (isZeroWindow) {
      this.bufferedInputs.splice(index, 1)
    }

    return false
  }

  clearAction(action: string) {
    const index = this.bufferedInputs.findIndex(
      (input) => input.action === action
    )
    if (index !== -1) {
      this.bufferedInputs.splice(index, 1)
    }
  }

  update() {
    const now = Date.now()
    this.bufferedInputs = this.bufferedInputs.filter(
      (input) =>
        input.bufferWindow === 0 || now - input.timestamp < input.bufferWindow
    )
  }

  setDefaultBufferWindow(window: number) {
    this.defaultBufferWindow = window
  }

  getDefaultBufferWindow(): number {
    return this.defaultBufferWindow
  }

  getDebugInfo(): string[] {
    const now = Date.now()
    return this.bufferedInputs
      .filter((input) => input.bufferWindow > 0)
      .map(
        (input) =>
          `${input.action} (${(
            input.bufferWindow -
            (now - input.timestamp)
          ).toFixed(0)}ms)`
      )
  }
}
