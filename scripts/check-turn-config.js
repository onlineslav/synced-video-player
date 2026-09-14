// electron-builder beforePack hook: fail closed before a secret enters an artifact.
const fs = require('node:fs')
const path = require('node:path')
const {validatePublicConfig} = require('../main/turn')
module.exports = () => {
  const file = path.join(__dirname, '../config/turn.json')
  if (fs.existsSync(file)) validatePublicConfig(JSON.parse(fs.readFileSync(file, 'utf8')))
}
