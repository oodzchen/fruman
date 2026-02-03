import type { EditorMapData } from './editorMapTypes'
import type { SaveData, SaveMeta } from './saveTypes'
import {
  hasSaves as checkHasSaves,
  createSave,
  deleteSave as deleteSaveFromStorage,
  getLastSaveId,
  listSaves,
  loadSaveData,
  setLastSaveId,
  updateSave,
} from './storage'

class SaveManager {
  private static instance: SaveManager | null = null

  static getInstance(): SaveManager {
    if (!SaveManager.instance) {
      SaveManager.instance = new SaveManager()
    }
    return SaveManager.instance
  }

  async createSave(
    name: string,
    mapId: string,
    mapName: string,
    mapData: EditorMapData,
    playerMaxHealth: number
  ): Promise<SaveMeta | null> {
    const meta = await createSave(
      name,
      mapId,
      mapName,
      mapData,
      playerMaxHealth
    )
    if (meta) {
      await setLastSaveId(meta.id)
    }
    return meta
  }

  async save(saveId: string, saveData: SaveData): Promise<SaveMeta | null> {
    const meta = await updateSave(saveData)
    if (meta) {
      await setLastSaveId(saveId)
    }
    return meta
  }

  async loadSave(saveId: string): Promise<SaveData | null> {
    const data = await loadSaveData(saveId)
    if (data) {
      await setLastSaveId(saveId)
    }
    return data
  }

  async listSaves(): Promise<SaveMeta[]> {
    return listSaves()
  }

  async deleteSave(saveId: string): Promise<boolean> {
    const result = await deleteSaveFromStorage(saveId)
    if (result) {
      const lastId = await getLastSaveId()
      if (lastId === saveId) {
        const saves = await listSaves()
        if (saves.length > 0) {
          await setLastSaveId(saves[0].id)
        }
      }
    }
    return result
  }

  async hasSaves(): Promise<boolean> {
    return checkHasSaves()
  }

  async getLastSaveId(): Promise<string | null> {
    return getLastSaveId()
  }

  formatPlayTime(ms: number): string {
    const totalSeconds = Math.floor(ms / 1000)
    const hours = Math.floor(totalSeconds / 3600)
    const minutes = Math.floor((totalSeconds % 3600) / 60)
    const seconds = totalSeconds % 60

    if (hours > 0) {
      return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
    }
    return `${minutes}:${String(seconds).padStart(2, '0')}`
  }

  formatLastPlayed(timestamp: number): string {
    const now = Date.now()
    const diff = now - timestamp

    const minute = 60 * 1000
    const hour = 60 * minute
    const day = 24 * hour

    if (diff < minute) {
      return 'just now'
    }
    if (diff < hour) {
      const mins = Math.floor(diff / minute)
      return `${mins}m ago`
    }
    if (diff < day) {
      const hrs = Math.floor(diff / hour)
      return `${hrs}h ago`
    }

    const date = new Date(timestamp)
    const month = date.getMonth() + 1
    const d = date.getDate()
    return `${month}/${d}`
  }
}

export const saveManager = SaveManager.getInstance()
