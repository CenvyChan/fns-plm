import type { Bom, Material, PlmDocument, SalesBomSnapshot } from './types.ts'

/** Local PLM search only. Never issues an ERP query or mutates material data. */
export const normalizeMaterialQuery = (value: string) => value.normalize('NFKC').trim().toLowerCase()

export function materialSearchText(material?: Material): string {
  if (!material || typeof material !== 'object') return ''
  return [material.partNo, material.name, material.specification, material.category,
    material.proposedGroupNumber, ...(material.classificationPath ?? []),
    ...Object.values(material.specificationFields ?? {}), ...Object.values(material.dimensions ?? {})]
    .filter(value => typeof value === 'string').join(' ')
}

export function matchesSearchText(text: string, query: string): boolean {
  return normalizeMaterialQuery(text).includes(normalizeMaterialQuery(query))
}

export const matchesMaterial = (material: Material, query: string) => matchesSearchText(materialSearchText(material), query)

/** Show model/spec values as well as identity so same-name materials can be distinguished. */
export function materialOptionLabel(material: Material): string {
  const specs = [...new Set([material.specification, ...Object.values(material.specificationFields ?? {})].filter(Boolean))]
  return [material.partNo, material.name, ...specs].join(' · ')
}

export function matchesDocumentMaterial(document: PlmDocument, materials: Record<string, Material>, query: string): boolean {
  return matchesSearchText([document.docNo, document.title, document.type,
    materialSearchText(materials[document.materialId ?? ''])].join(' '), query)
}

export function bomSearchText(bom: Bom, materials: Record<string, Material>): string {
  return [bom.bomNo, bom.revision, bom.scope, materialSearchText(materials[bom.parentMaterialId]),
    ...bom.lines.map(line => materialSearchText(materials[line.materialId])),
    ...(bom.salesRules ?? []).map(rule => materialSearchText(materials[rule.materialId]))].join(' ')
}

export const matchesBomMaterial = (bom: Bom, materials: Record<string, Material>, query: string) => matchesSearchText(bomSearchText(bom, materials), query)

export function matchesSnapshotMaterial(snapshot: SalesBomSnapshot, materials: Record<string, Material>, query: string): boolean {
  return matchesSearchText([snapshot.orderNo, snapshot.bomNo, materialSearchText(materials[snapshot.parentMaterialId]),
    ...snapshot.lines.map(line => materialSearchText(materials[line.materialId]))].join(' '), query)
}
