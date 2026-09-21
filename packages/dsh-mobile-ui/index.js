// dsh-mobile-ui — a browser-only Cordis plugin (see lib/client.js for the
// whole implementation). The host half intentionally does nothing: the
// package exists so the harness serves the client bundle and mounts it as a
// trusted composition row (cordis.patch.yml `- insert:`), which keeps the
// mobile layout alive across restarts and upstream updates — a dynamic
// plugin would vanish with the process.
export function apply() {}
