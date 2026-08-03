import { strFromU8, unzipSync } from 'fflate'
import fs from 'node:fs/promises'
import path from 'node:path'
import type { Plugin, ResolvedConfig } from 'vite'

const MAP_DATA_DIR_NAME = 'map_data'
const MAP_DATA_MANIFEST_NAME = 'manifest.json'
const MAP_DATA_GENERATED_MARKER = '.fruman-generated-map-data'
const MAP_META_JSON_NAME = 'map-meta.json'
const ZIP_EXTENSION = '.zip'

type MapDataManifestEntrySource = 'directory' | 'zip'

interface MapDataManifestEntry {
  id: string
  name: string
  source: MapDataManifestEntrySource
  version: string
  mapPath?: string
  metaPath?: string
  archivePath?: string
  assetManifestPath?: string
  isDefault?: boolean
}

interface MapDataManifest {
  version: 1
  entries: MapDataManifestEntry[]
}

async function hashFile(filePath: string): Promise<string> {
  const bytes = await fs.readFile(filePath)
  let hash = 2166136261
  for (let i = 0; i < bytes.length; i++) {
    hash ^= bytes[i]
    hash = Math.imul(hash, 16777619)
  }
  return `${bytes.length.toString(36)}-${(hash >>> 0).toString(36)}`
}

function toPublicPath(value: string): string {
  return value.split(path.sep).join('/')
}

function trimZipExtension(fileName: string): string {
  return fileName.slice(0, -ZIP_EXTENSION.length)
}

function isZipFile(fileName: string): boolean {
  return fileName.toLowerCase().endsWith(ZIP_EXTENSION)
}

function isJsonFile(fileName: string): boolean {
  return fileName.toLowerCase().endsWith('.json')
}

function isMapJsonCandidate(fileName: string): boolean {
  const lowerName = fileName.toLowerCase()
  return (
    isJsonFile(lowerName) &&
    lowerName !== MAP_DATA_MANIFEST_NAME &&
    lowerName !== MAP_META_JSON_NAME &&
    lowerName !== 'environment-assets.json'
  )
}

function createMapDataEntryName(relativeId: string): string {
  const normalizedId = toPublicPath(relativeId)
  const baseName = path.posix.basename(normalizedId)
  return baseName.length > 0 ? baseName : 'map'
}

function isDefaultMapDataEntry(relativeId: string): boolean {
  return createMapDataEntryName(relativeId).toLowerCase() === 'default'
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

async function readDirectorySafe(dirPath: string): Promise<
  Array<{
    name: string
    isDirectory: () => boolean
    isFile: () => boolean
  }>
> {
  try {
    return await fs.readdir(dirPath, { withFileTypes: true })
  } catch {
    return []
  }
}

async function findDirectMapJsonFile(dirPath: string): Promise<string | null> {
  const entries = await readDirectorySafe(dirPath)
  let firstJsonFile: string | null = null
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]
    if (!entry.isFile()) {
      continue
    }
    if (entry.name.toLowerCase() === 'map.json') {
      return path.join(dirPath, entry.name)
    }
    if (!firstJsonFile && isMapJsonCandidate(entry.name)) {
      firstJsonFile = path.join(dirPath, entry.name)
    }
  }
  return firstJsonFile
}

async function findAssetManifestPath(
  mapJsonPath: string
): Promise<string | undefined> {
  const assetManifestPath = path.join(
    path.dirname(mapJsonPath),
    'environment-assets.json'
  )
  return (await pathExists(assetManifestPath)) ? assetManifestPath : undefined
}

function readNameFromJson(value: unknown): string | null {
  if (typeof value !== 'object' || value === null) {
    return null
  }
  const name = (value as { name?: unknown }).name
  return typeof name === 'string' && name.length > 0 ? name : null
}

async function readNameFromJsonFile(filePath: string): Promise<string | null> {
  try {
    return readNameFromJson(JSON.parse(await fs.readFile(filePath, 'utf8')))
  } catch {
    return null
  }
}

async function findMapMetaPath(
  mapJsonPath: string
): Promise<string | undefined> {
  const metaPath = path.join(path.dirname(mapJsonPath), MAP_META_JSON_NAME)
  return (await pathExists(metaPath)) ? metaPath : undefined
}

async function resolveDirectoryMapName(
  relativeId: string,
  mapJsonPath: string,
  metaPath: string | undefined
): Promise<string> {
  if (metaPath) {
    const metaName = await readNameFromJsonFile(metaPath)
    if (metaName) {
      return metaName
    }
  }
  const mapName = await readNameFromJsonFile(mapJsonPath)
  return mapName ?? createMapDataEntryName(relativeId)
}

function findArchiveMapMetaBytes(
  files: Record<string, Uint8Array>
): Uint8Array | null {
  const direct = files[MAP_META_JSON_NAME]
  if (direct) {
    return direct
  }
  const fileNames = Object.keys(files)
  for (let i = 0; i < fileNames.length; i++) {
    const fileName = fileNames[i]
    if (fileName.toLowerCase().endsWith(`/${MAP_META_JSON_NAME}`)) {
      return files[fileName]
    }
  }
  return null
}

function readArchiveMetaName(files: Record<string, Uint8Array>): string | null {
  const meta = findArchiveMapMetaBytes(files)
  if (!meta) {
    return null
  }
  try {
    return readNameFromJson(JSON.parse(strFromU8(meta)))
  } catch {
    return null
  }
}

async function readZipMapName(zipPath: string): Promise<string | null> {
  try {
    const archiveBytes = new Uint8Array(await fs.readFile(zipPath))
    return readArchiveMetaName(unzipSync(archiveBytes))
  } catch {
    return null
  }
}

async function scanMapDataDirectory(
  publicDir: string,
  mapDataDir: string,
  relativeDir: string,
  includeZipEntries: boolean,
  entries: MapDataManifestEntry[]
): Promise<void> {
  const absoluteDir = path.join(mapDataDir, relativeDir)
  const directMapJsonPath = await findDirectMapJsonFile(absoluteDir)
  if (directMapJsonPath) {
    const normalizedId = toPublicPath(relativeDir || 'root')
    const assetManifestPath = await findAssetManifestPath(directMapJsonPath)
    const metaPath = await findMapMetaPath(directMapJsonPath)
    const name = await resolveDirectoryMapName(
      normalizedId,
      directMapJsonPath,
      metaPath
    )
    entries.push({
      id: normalizedId,
      name,
      source: 'directory',
      version: await hashFile(directMapJsonPath),
      mapPath: toPublicPath(path.relative(publicDir, directMapJsonPath)),
      metaPath: metaPath
        ? toPublicPath(path.relative(publicDir, metaPath))
        : undefined,
      assetManifestPath: assetManifestPath
        ? toPublicPath(path.relative(publicDir, assetManifestPath))
        : undefined,
      isDefault: isDefaultMapDataEntry(normalizedId),
    })
    return
  }

  const children = await readDirectorySafe(absoluteDir)
  for (let i = 0; i < children.length; i++) {
    const child = children[i]
    if (child.name.startsWith('.')) {
      continue
    }
    const childRelativePath = relativeDir
      ? path.join(relativeDir, child.name)
      : child.name
    if (child.isDirectory()) {
      await scanMapDataDirectory(
        publicDir,
        mapDataDir,
        childRelativePath,
        includeZipEntries,
        entries
      )
      continue
    }
    if (!includeZipEntries || !child.isFile() || !isZipFile(child.name)) {
      continue
    }
    const sourceId = toPublicPath(trimZipExtension(childRelativePath))
    const archivePath = path.join(mapDataDir, childRelativePath)
    const name =
      (await readZipMapName(archivePath)) ?? createMapDataEntryName(sourceId)
    entries.push({
      id: sourceId,
      name,
      source: 'zip',
      version: await hashFile(archivePath),
      archivePath: toPublicPath(path.relative(publicDir, archivePath)),
      isDefault: isDefaultMapDataEntry(sourceId),
    })
  }
}

async function createMapDataManifest(
  publicDir: string,
  includeZipEntries: boolean
): Promise<MapDataManifest> {
  const mapDataDir = path.join(publicDir, MAP_DATA_DIR_NAME)
  const entries: MapDataManifestEntry[] = []
  if (await pathExists(mapDataDir)) {
    await scanMapDataDirectory(
      publicDir,
      mapDataDir,
      '',
      includeZipEntries,
      entries
    )
  }
  entries.sort((a, b) => a.id.localeCompare(b.id))
  return { version: 1, entries }
}

function normalizeArchiveEntryPath(fileName: string): string | null {
  const normalized = path.posix.normalize(fileName.replace(/\\/g, '/'))
  if (
    normalized.length === 0 ||
    normalized === '.' ||
    normalized.startsWith('../') ||
    path.posix.isAbsolute(normalized)
  ) {
    return null
  }
  return normalized
}

async function collectZipFiles(
  dirPath: string,
  relativeDir: string,
  zipFiles: string[]
): Promise<void> {
  const children = await readDirectorySafe(path.join(dirPath, relativeDir))
  for (let i = 0; i < children.length; i++) {
    const child = children[i]
    if (child.name.startsWith('.')) {
      continue
    }
    const childRelativePath = relativeDir
      ? path.join(relativeDir, child.name)
      : child.name
    if (child.isDirectory()) {
      await collectZipFiles(dirPath, childRelativePath, zipFiles)
      continue
    }
    if (child.isFile() && isZipFile(child.name)) {
      zipFiles.push(childRelativePath)
    }
  }
}

async function resolveArchiveExtractPath(
  mapDataDir: string,
  relativeZipPath: string
): Promise<string> {
  const relativeBasePath = trimZipExtension(relativeZipPath)
  let relativeTargetPath = relativeBasePath
  let suffix = 1
  while (await pathExists(path.join(mapDataDir, relativeTargetPath))) {
    relativeTargetPath = `${relativeBasePath}-archive-${suffix}`
    suffix += 1
  }
  return relativeTargetPath
}

async function extractMapDataArchive(
  mapDataDir: string,
  relativeZipPath: string
): Promise<string | null> {
  const zipPath = path.join(mapDataDir, relativeZipPath)
  const relativeTargetPath = await resolveArchiveExtractPath(
    mapDataDir,
    relativeZipPath
  )
  const targetDir = path.join(mapDataDir, relativeTargetPath)
  const archiveBytes = new Uint8Array(await fs.readFile(zipPath))
  const files = unzipSync(archiveBytes)

  await fs.mkdir(targetDir, { recursive: true })
  await fs.writeFile(path.join(targetDir, MAP_DATA_GENERATED_MARKER), '')

  const fileNames = Object.keys(files)
  let extractedFileCount = 0
  for (let i = 0; i < fileNames.length; i++) {
    const fileName = fileNames[i]
    const normalizedPath = normalizeArchiveEntryPath(fileName)
    if (!normalizedPath) {
      continue
    }
    const targetPath = path.join(targetDir, normalizedPath)
    if (fileName.endsWith('/')) {
      await fs.mkdir(targetPath, { recursive: true })
      continue
    }
    await fs.mkdir(path.dirname(targetPath), { recursive: true })
    await fs.writeFile(targetPath, files[fileName])
    extractedFileCount += 1
  }

  return extractedFileCount > 0 ? targetDir : null
}

async function removeGeneratedMapDataDirectories(
  dirPath: string
): Promise<void> {
  const children = await readDirectorySafe(dirPath)
  for (let i = 0; i < children.length; i++) {
    const child = children[i]
    if (!child.isDirectory() || child.name.startsWith('.')) {
      continue
    }
    const childPath = path.join(dirPath, child.name)
    if (await pathExists(path.join(childPath, MAP_DATA_GENERATED_MARKER))) {
      await fs.rm(childPath, { recursive: true, force: true })
      continue
    }
    await removeGeneratedMapDataDirectories(childPath)
  }
}

async function extractMapDataArchivesForBuild(
  publicDir: string
): Promise<string[]> {
  const mapDataDir = path.join(publicDir, MAP_DATA_DIR_NAME)
  if (!(await pathExists(mapDataDir))) {
    return []
  }

  await removeGeneratedMapDataDirectories(mapDataDir)

  const zipFiles: string[] = []
  await collectZipFiles(mapDataDir, '', zipFiles)
  const generatedDirs: string[] = []
  for (let i = 0; i < zipFiles.length; i++) {
    const generatedDir = await extractMapDataArchive(mapDataDir, zipFiles[i])
    if (generatedDir) {
      generatedDirs.push(generatedDir)
    }
  }
  return generatedDirs
}

async function removeZipFiles(dirPath: string): Promise<void> {
  const children = await readDirectorySafe(dirPath)
  for (let i = 0; i < children.length; i++) {
    const child = children[i]
    const childPath = path.join(dirPath, child.name)
    if (child.isDirectory()) {
      await removeZipFiles(childPath)
      continue
    }
    if (child.isFile() && isZipFile(child.name)) {
      await fs.rm(childPath, { force: true })
    }
  }
}

export function mapDataPlugin(): Plugin {
  let resolvedConfig: ResolvedConfig | null = null
  let generatedDirs: string[] = []

  return {
    name: 'fruman-map-data',
    enforce: 'pre',
    configResolved(config) {
      resolvedConfig = config
    },
    async buildStart() {
      if (!resolvedConfig || resolvedConfig.command !== 'build') {
        return
      }
      generatedDirs = await extractMapDataArchivesForBuild(
        resolvedConfig.publicDir
      )
    },
    configureServer(server) {
      server.middlewares.use(
        `/${MAP_DATA_DIR_NAME}/${MAP_DATA_MANIFEST_NAME}`,
        async (_req, res) => {
          if (!resolvedConfig) {
            res.statusCode = 500
            res.end()
            return
          }
          const manifest = await createMapDataManifest(
            resolvedConfig.publicDir,
            true
          )
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          res.end(JSON.stringify(manifest, null, 2))
        }
      )
    },
    async generateBundle(_options, bundle) {
      if (!resolvedConfig || resolvedConfig.command !== 'build') {
        return
      }
      const manifest = await createMapDataManifest(
        resolvedConfig.publicDir,
        false
      )
      delete bundle[`${MAP_DATA_DIR_NAME}/${MAP_DATA_MANIFEST_NAME}`]
      this.emitFile({
        type: 'asset',
        fileName: `${MAP_DATA_DIR_NAME}/${MAP_DATA_MANIFEST_NAME}`,
        source: JSON.stringify(manifest, null, 2),
      })
    },
    async writeBundle(options) {
      if (!resolvedConfig || resolvedConfig.command !== 'build') {
        return
      }
      const outDir =
        options.dir ??
        path.resolve(resolvedConfig.root, resolvedConfig.build.outDir)
      const mapDataOutDir = path.join(outDir, MAP_DATA_DIR_NAME)
      if (await pathExists(mapDataOutDir)) {
        await removeZipFiles(mapDataOutDir)
      }
    },
    async closeBundle() {
      for (let i = generatedDirs.length - 1; i >= 0; i--) {
        await fs.rm(generatedDirs[i], { recursive: true, force: true })
      }
      generatedDirs = []
    },
  }
}
