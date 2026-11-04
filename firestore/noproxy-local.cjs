// Test-only preload for the firebase CLI. firebase-tools sends ALL its HTTP calls through HTTPS_PROXY and ignores
// NO_PROXY, so behind a corporate/sandbox proxy the Storage emulator cannot reach the local Firestore emulator for
// cross-service rules (firestore.get in storage.rules). This keeps the proxy for real hosts and honours NO_PROXY
// (e.g. 127.0.0.1) for local emulator calls. Harmless when no proxy is set.
const undici = require('undici');
undici.ProxyAgent = class extends undici.EnvHttpProxyAgent { constructor() { super(); } };
