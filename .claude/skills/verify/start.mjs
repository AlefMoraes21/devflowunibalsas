// Gera um par de chaves só para este teste e sobe o servidor do repositório com o mock do Google.
import crypto from 'node:crypto';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
const DIR = fileURLToPath(new URL('.', import.meta.url));
const REPO = process.env.VERIFY_REPO;
const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048, publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
fs.writeFileSync(DIR + 'pub.pem', publicKey);
const env = { ...process.env, FLOW_PRIVATE_KEY: privateKey, FLOW_PROJECT_ID: 'local-verify', FLOW_WORKER_ORIGIN: 'https://local-verify.a.run.app/', PORT: '8080', CONTROL_PORT: '8099', VERIFY_REPO: REPO, RBS_TOKEN: 'shim-local' };
for (const k of ['BLIP_API_URL', 'BLIP_BOT_KEY', 'META_APP_SECRET', 'APP_SECRET']) delete env[k];
const p = spawn(process.execPath, ['--import', pathToFileURL(DIR + 'mock-google.mjs').href, 'server.js'], { cwd: REPO, env, stdio: 'inherit' });
console.log('pid', p.pid);
p.on('exit', c => { console.log('servidor saiu', c); process.exit(c ?? 0); });
