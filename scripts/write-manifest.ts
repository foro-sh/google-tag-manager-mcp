import { writeFileSync } from 'node:fs'
import { toolsManifest } from '../tools.ts'

const unused = { getAccessToken: () => Promise.reject(new Error('unused')) }
writeFileSync(new URL('../foro-tools.json', import.meta.url), `${JSON.stringify(toolsManifest({ auth: unused }), null, 2)}\n`)
