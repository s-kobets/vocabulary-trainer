import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const source = path.join(root, 'src/db/migrations')
const destination = path.join(root, 'dist/db/migrations')

if (fs.existsSync(source)) {
  fs.cpSync(source, destination, { recursive: true })
}
