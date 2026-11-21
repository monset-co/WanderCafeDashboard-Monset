// npm run vapid: makes the key pair for push notifications. Run once; keep the private key secret.
import { makeVapidKeys } from '../server/push.js'

const { publicKey, privateKey } = await makeVapidKeys()
console.log(`
Cloudflare › your Worker › Settings:

  Build › Variables and secrets (the app needs the public key):
    VITE_VAPID_PUBLIC_KEY = ${publicKey}

  Variables and Secrets (the running Worker):
    VAPID_PUBLIC_KEY  = ${publicKey}
    VAPID_PRIVATE_KEY = ${privateKey}      <- add as a Secret
`)
