import { copyFile, mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const serverDir = dirname(dirname(fileURLToPath(import.meta.url)))
const source = resolve(serverDir, '../flowable-service/src/main/resources/processes/plm-approvals.bpmn20.xml')
const destination = resolve(serverDir, 'workflow/processes/plm-approvals.bpmn20.xml')
await mkdir(dirname(destination), { recursive: true })
await copyFile(source, destination)
console.log('Synchronized PLM BPMN model for the Node tenant deployment adapter.')
