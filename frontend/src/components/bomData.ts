type UnknownRecord = Record<string, unknown>

export interface BomComponent {
  componentId: string
  model: string
  quantity: number
  name: string
  nameCn: string
  semanticName: string
  category: string
  subsystem: string
  kind: string
  dimensions: string
  sizeMm: number[]
  massKg: number | null
  powerW: number | null
  material: string
  mountFace: string
  source: string
  description: string
  imagePath: string | null
  imageExists: boolean
  cadPath: string | null
  cadExists: boolean
  datasheetPath: string | null
  datasheetExists: boolean
  thermal: UnknownRecord
  raw: UnknownRecord
}

export interface BomInfo {
  schemaVersion: string
  bomId: string
  sourcePath: string
  sourceVersion: string
  totalRecords: number
  matchedRecords: number
  missingRecords: number
  components: BomComponent[]
}

function asRecord(value: unknown): UnknownRecord {
  return value && typeof value === "object" ? value as UnknownRecord : {}
}

function asString(value: unknown, fallback = "-") {
  return typeof value === "string" && value.trim() ? value : fallback
}

function asNumber(value: unknown, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback
}

function asNullableNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function asBoolean(value: unknown) {
  return value === true
}

function asNumberArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is number => typeof item === "number" && Number.isFinite(item))
    : []
}

function createImageUrl(path: string | null) {
  if (!path) return null
  return `/api/image?${new URLSearchParams({ path }).toString()}`
}

export function parseBomInfo(value: unknown): BomInfo {
  const parsed = asRecord(value)
  const components = Array.isArray(parsed.components)
    ? parsed.components
    : Array.isArray(parsed.items) ? parsed.items : []
  const sourceFiles = asRecord(parsed.source_files)

  return {
    schemaVersion: asString(parsed.schema_version, "1.0"),
    bomId: asString(parsed.bom_id, "unknown-bom"),
    sourcePath: asString(parsed.source_path ?? sourceFiles.bom_json, ""),
    sourceVersion: asString(parsed.source_version, ""),
    totalRecords: asNumber(parsed.total_records, components.length),
    matchedRecords: asNumber(parsed.matched_records, components.length),
    missingRecords: asNumber(parsed.missing_records, 0),
    components: components.map((item) => {
      const component = asRecord(item)
      const display = asRecord(component.display_info)
      const assets = asRecord(display.assets)
      const excel = asRecord(component.excel_and_cad)
      const imagePath = asString(assets.image_path ?? excel.image_path, "")
      const cadPath = asString(assets.cad_rotated_path ?? assets.cad_path ?? excel.cad_rotated_path ?? excel.cad_path, "")
      const datasheetPath = asString(assets.datasheet_path ?? excel.datasheet_path, "")

      return {
        componentId: asString(display.component_id ?? component.component_id ?? component.thermal_db_component_id),
        model: asString(display.model ?? excel.excel_model),
        quantity: asNumber(component.quantity, 1),
        name: asString(display.name ?? excel.excel_name),
        nameCn: asString(display.name_cn ?? excel.excel_name_cn, ""),
        semanticName: asString(display.semantic_name ?? component.semantic_name, ""),
        category: asString(component.category, ""),
        subsystem: asString(display.subsystem ?? excel.excel_subsystem, ""),
        kind: asString(display.kind ?? excel.excel_kind, ""),
        dimensions: asString(display.dimensions ?? excel.excel_dimensions, ""),
        sizeMm: asNumberArray(component.size_mm),
        massKg: asNullableNumber(component.mass_kg),
        powerW: asNullableNumber(component.power_W),
        material: asString(display.material ?? excel.excel_material, ""),
        mountFace: asString(display.mount_face ?? excel.excel_mount_face, ""),
        source: asString(display.source ?? excel.excel_source, ""),
        description: asString(display.description ?? excel.excel_description, ""),
        imagePath: imagePath || null,
        imageExists: asBoolean(assets.image_path_exists ?? excel.image_path_exists),
        cadPath: cadPath || null,
        cadExists: asBoolean(assets.cad_rotated_path_exists ?? assets.cad_path_exists ?? excel.cad_rotated_path_exists ?? excel.cad_path_exists),
        datasheetPath: datasheetPath || null,
        datasheetExists: asBoolean(assets.datasheet_path_exists ?? excel.datasheet_path_exists),
        thermal: asRecord(display.thermal),
        raw: component,
      } satisfies BomComponent
    }),
  }
}

export const EMPTY_BOM_INFO: BomInfo = {
  schemaVersion: "-",
  bomId: "-",
  sourcePath: "",
  sourceVersion: "",
  totalRecords: 0,
  matchedRecords: 0,
  missingRecords: 0,
  components: [],
}

export { createImageUrl }
