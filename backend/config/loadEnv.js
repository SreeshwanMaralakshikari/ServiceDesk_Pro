// must be the first import of every entry point (server.js, app.js, seed):
// ES module imports are hoisted, so loading dotenv inside server.js body would
// run after the routers had already read process.env
import { config } from 'dotenv'

config()
