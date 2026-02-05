const logEl = document.getElementById('log');
const enabledEl = document.getElementById('enabled');
const levelEl = document.getElementById('level');
const levelValEl = document.getElementById('levelVal');

levelEl.addEventListener('input', () => levelValEl.textContent = levelEl.value);

function log(msg) {
  logEl.textContent += msg + "\n";
  logEl.scrollTop = logEl.scrollHeight;
}

/**
 * TODO:
 * Replace this stub with actual KernelSU WebUI exec bridge for your KSU version.
 * Common patterns include window.ksu.exec(cmd) or fetch-based endpoints.
 */
async function ksuExec(cmd) {
  throw new Error("ksuExec() bridge not implemented. Wire this to your KernelSU WebUI.");
}

async function refresh() {
  log("[*] Refresh...");
  const out = await ksuExec(`/data/adb/ksu/modules/miru_ui_module/scripts/status.sh`);
  const cfg = JSON.parse(out);
  enabledEl.checked = !!cfg.enabled;
  levelEl.value = cfg.level ?? 1;
  levelValEl.textContent = levelEl.value;
  log("[+] Loaded: " + out);
}

async function apply() {
  log("[*] Apply...");
  const enabled = enabledEl.checked ? "true" : "false";
  const level = String(levelEl.value);
  const out = await ksuExec(`/data/adb/ksu/modules/miru_ui_module/scripts/apply.sh ${enabled} ${level}`);
  log("[+] " + out);
  await refresh();
}

async function reset() {
  log("[*] Reset...");
  const out = await ksuExec(`/data/adb/ksu/modules/miru_ui_module/scripts/reset.sh`);
  log("[+] " + out);
  await refresh();
}

document.getElementById('btnRefresh').addEventListener('click', () => refresh().catch(e => log("[!] " + e.message)));
document.getElementById('btnApply').addEventListener('click', () => apply().catch(e => log("[!] " + e.message)));
document.getElementById('btnReset').addEventListener('click', () => reset().catch(e => log("[!] " + e.message)));

log("[*] UI ready");
