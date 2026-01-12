import { DEFAULT_JUMP_BUFFER_WINDOW } from './constants'

interface BufferedInput {
  action: string
  timestamp: number
  bufferWindow: number
  active: boolean
}

const MAX_BUFFERED_INPUTS = 8

export class InputBuffer {
  private bufferedInputs: BufferedInput[]
  private defaultBufferWindow = DEFAULT_JUMP_BUFFER_WINDOW

  constructor() {
    this.bufferedInputs = new Array(MAX_BUFFERED_INPUTS)
    for (let i = 0; i < MAX_BUFFERED_INPUTS; i++) {
      this.bufferedInputs[i] = {
        action: '',
        timestamp: 0,
        bufferWindow: 0,
        active: false,
      }
    }
  }

  bufferAction(action: string, bufferWindow?: number) {
    const window = Math.max(0, bufferWindow ?? this.defaultBufferWindow)
    const now = performance.now()

    for (let i = 0; i < MAX_BUFFERED_INPUTS; i++) {
      const input = this.bufferedInputs[i]
      if (input.active && input.action === action) {
        input.timestamp = now
        input.bufferWindow = window
        return
      }
    }

    for (let i = 0; i < MAX_BUFFERED_INPUTS; i++) {
      const input = this.bufferedInputs[i]
      if (!input.active) {
        input.action = action
        input.timestamp = now
        input.bufferWindow = window
        input.active = true
        return
      }
    }
  }

  hasActiveAction(action: string): boolean {
    const now = performance.now()
    for (let i = 0; i < MAX_BUFFERED_INPUTS; i++) {
      const input = this.bufferedInputs[i]
      if (!input.active || input.action !== action) continue
      const elapsed = now - input.timestamp
      if (input.bufferWindow !== 0 && elapsed >= input.bufferWindow) {
        input.active = false
        continue
      }
      return true
    }
    return false
  }

  tryExecute(
    action: string,
    canExecute: () => boolean,
    execute: () => void
  ): boolean {
    const now = performance.now()

    for (let i = 0; i < MAX_BUFFERED_INPUTS; i++) {
      const input = this.bufferedInputs[i]
      if (!input.active || input.action !== action) continue

      const elapsed = now - input.timestamp
      const isZeroWindow = input.bufferWindow === 0

      if (!isZeroWindow && elapsed >= input.bufferWindow) {
        input.active = false
        return false
      }

      if (canExecute()) {
        execute()
        input.active = false
        return true
      }

      if (isZeroWindow) {
        input.active = false
      }

      return false
    }

    return false
  }

  clearAction(action: string) {
    for (let i = 0; i < MAX_BUFFERED_INPUTS; i++) {
      const input = this.bufferedInputs[i]
      if (input.active && input.action === action) {
        input.active = false
        return
      }
    }
  }

  clearAll() {
    for (let i = 0; i < MAX_BUFFERED_INPUTS; i++) {
      this.bufferedInputs[i].active = false
    }
  }

  update() {
    const now = performance.now()
    for (let i = 0; i < MAX_BUFFERED_INPUTS; i++) {
      const input = this.bufferedInputs[i]
      if (!input.active) continue
      if (
        input.bufferWindow !== 0 &&
        now - input.timestamp >= input.bufferWindow
      ) {
        input.active = false
      }
    }
  }

  setDefaultBufferWindow(window: number) {
    this.defaultBufferWindow = window
  }

  getDefaultBufferWindow(): number {
    return this.defaultBufferWindow
  }

  getDebugInfo(): string[] {
    const result: string[] = []
    const now = performance.now()
    for (let i = 0; i < MAX_BUFFERED_INPUTS; i++) {
      const input = this.bufferedInputs[i]
      if (input.active && input.bufferWindow > 0) {
        result.push(
          `${input.action} (${(input.bufferWindow - (now - input.timestamp)).toFixed(0)}ms)`
        )
      }
    }
    return result
  }
}
