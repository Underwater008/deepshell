import os from 'node:os'
import path from 'node:path'
import { TailscaleConnection } from '../lib/tailscale.js'

const [action, directory, portText = '3080'] = process.argv.slice(2)
const port = Number(portText)
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid harness port')
const connection = new TailscaleConnection({ stateDir: directory || path.join(os.homedir(), 'Library/Application Support/deepshell'), port })
try {
  if (action === 'prepare') await connection.state.prepareTrust()
  else if (action === 'resume') await connection.resume()
  else if (action === 'suspend') await connection.suspend()
  else if (action === 'disable') await connection.disable()
  else if (action === 'enable') console.log(await connection.enable())
  else if (action === 'status') console.log(JSON.stringify(await connection.status()))
  else if (action === 'host') {
    const config = await connection.state.read()
    if (config?.enabled) console.log(config.hostname)
  } else throw new Error('Unknown phone runtime action')
} catch (error) {
  console.error(error.message)
  if (error.setupUrl) console.error(`Finish setup in your browser: ${error.setupUrl}`)
  process.exitCode = 1
}
