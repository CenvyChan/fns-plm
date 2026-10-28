import type { Entity, Workspace } from './workspace-store.js'

const strings = (values: unknown[]): string[] => values.filter((value): value is string => typeof value === 'string')
const fieldValues = (value: unknown): string[] => value && typeof value === 'object' && !Array.isArray(value) ? strings(Object.values(value)) : []
const materialTerms = (material: Entity): string[] => strings([
  material.partNo, material.name, material.specification, material.category, material.proposedGroupNumber,
  ...(Array.isArray(material.classificationPath) ? material.classificationPath : []),
  ...fieldValues(material.specificationFields), ...fieldValues(material.dimensions),
]).map(value => value.normalize('NFKC'))
type MaterialSearchCollection = 'materials' | 'boms' | 'documents' | 'salesBomSnapshots'

/** Only explicit PLM references are joined, using the already account-scoped workspace. */
export function resolveWorkspaceSearch(workspace: Pick<Workspace, MaterialSearchCollection>, collection: MaterialSearchCollection): (row: Entity) => ReadonlyArray<string> {
  const byId = new Map(workspace.materials.map(material => [material.id, material]))
  const termsFor = (id: unknown) => typeof id === 'string' && byId.has(id) ? materialTerms(byId.get(id)!) : []
  const lineTerms = (value: unknown): string[] => Array.isArray(value) ? value.flatMap(line => line && typeof line === 'object' ? termsFor(line.materialId) : []) : []
  return row => {
    if (collection === 'materials') return materialTerms(row)
    if (collection === 'documents') return termsFor(row.materialId)
    const terms = [...termsFor(row.parentMaterialId), ...lineTerms(row.lines)]
    if (collection === 'boms') terms.push(...lineTerms(row.salesRules))
    return terms
  }
}
