const path = require('node:path');
function playwright() {
  try { return require('playwright'); } catch {
    if (!process.env.NODE_PATH) throw new Error('Install playwright or set NODE_PATH to a supplied runtime.');
    return require(require.resolve('playwright', { paths: process.env.NODE_PATH.split(path.delimiter) }));
  }
}
module.exports = { playwright };
