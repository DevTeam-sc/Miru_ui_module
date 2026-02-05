// loadfunc.js - Browser/WebUI version
// Loads bypass functions from server files via ksu.exec or fetch

(function () {
  const MODULE_ID_CANDIDATES = ["miru-jshook"];

  const PACKAGE_MAP = {
    "ktbcs.netbank": "scripts/ktbcs.netbank/bypass.js",
  };

  function readBypassFile(filename) {
    if (typeof ksu !== "undefined") {
      if (filename && filename.startsWith("/")) {
        return ksu
          .exec(`cat "${filename}"`)
          .then(({ stdout }) => stdout || null)
          .catch(() => null);
      }

      // If filename is relative (e.g. scripts/...), prepend module root
      const ids = MODULE_ID_CANDIDATES;
      let chain = Promise.resolve(null);
      ids.forEach((mid) => {
        chain = chain.then((prev) => {
          if (prev) return prev;
          // Try path relative to module root
          const filePath = `/data/adb/modules/${mid}/${filename}`;
          return ksu
            .exec(`cat "${filePath}"`)
            .then(({ stdout }) => (stdout ? stdout : null))
            .catch(() => null);
        });
      });
      return chain;
    }

    const pathsToTry = [
      `../../system/etc/${filename}`,
      `../system/etc/${filename}`,
      `/scripts/magisk_module/system/etc/${filename}`,
    ];

    let chain = Promise.resolve(null);
    pathsToTry.forEach((p) => {
      chain = chain.then((prev) => {
        if (prev) return prev;
        return fetch(p)
          .then((res) => (res && res.ok ? res.text() : null))
          .then((txt) => (txt ? txt : null))
          .catch(() => null);
      });
    });
    return chain;
  }

  function scanAndRegisterFunctions(currentConfig) {
    console.log("Scanning bypass functions (FUNC_ prefix only)...");
    let hasUpdates = false;

    if (!currentConfig.targets) currentConfig.targets = {};

    function ensureTarget(pkg) {
      if (!currentConfig.targets[pkg]) {
        currentConfig.targets[pkg] = {
          name: pkg,
          enabled: true,
          features: {},
        };
        hasUpdates = true;
      }
      if (!currentConfig.targets[pkg].features)
        currentConfig.targets[pkg].features = {};
      return currentConfig.targets[pkg];
    }

    function collectScriptRefs(pkg) {
      const refs = [];
      const base = PACKAGE_MAP[pkg];
      if (base) refs.push(base);

      const target = currentConfig.targets[pkg];
      if (target && target.scripts && target.scripts.primary)
        refs.push(target.scripts.primary);
      if (target && target.overrideBypassScript)
        refs.push(target.overrideBypassScript);

      const manual =
        target && target.scripts && Array.isArray(target.scripts.manual)
          ? target.scripts.manual
          : target && Array.isArray(target.manualScripts)
            ? target.manualScripts
            : [];

      if (manual && manual.length) {
        manual.forEach((it) => {
          if (!it) return;
          if (typeof it === "string") refs.push(it);
          else if (typeof it === "object") {
            if (it.path) refs.push(it.path);
            else if (it.name && it.name.startsWith("/")) refs.push(it.name);
          }
        });
      }

      const seen = new Set();
      return refs
        .map((x) => (x ? x.toString().trim() : ""))
        .filter((x) => x.length > 0)
        .filter((x) => {
          if (seen.has(x)) return false;
          seen.add(x);
          return true;
        });
    }

    const pkgSet = Array.from(
      new Set([
        ...Object.keys(PACKAGE_MAP),
        ...Object.keys(currentConfig.targets || {}),
      ]),
    );

    const funcRegex = /^\s*(FUNC_[A-Z0-9_]*)\s*:\s*function/gm;

    let pkgChain = Promise.resolve();
    pkgSet.forEach((pkg) => {
      pkgChain = pkgChain.then(() => {
        const target = ensureTarget(pkg);
        const refs = collectScriptRefs(pkg);
        if (!refs.length) return null;

        const foundFeatures = new Set();

        let refChain = Promise.resolve();
        refs.forEach((ref) => {
          refChain = refChain.then(() =>
            readBypassFile(ref).then((content) => {
              if (!content) return null;
              let match;
              while ((match = funcRegex.exec(content)) !== null) {
                const featureName = match[1];
                foundFeatures.add(featureName);
                if (target.features[featureName] === undefined) {
                  target.features[featureName] = true;
                  hasUpdates = true;
                }
              }
              return null;
            }),
          );
        });

        return refChain.then(() => {
          const currentFeatures = Object.keys(target.features);
          for (const feat of currentFeatures) {
            if (!foundFeatures.has(feat)) {
              delete target.features[feat];
              hasUpdates = true;
            }
          }
          return null;
        });
      });
    });

    return pkgChain.then(() => ({ config: currentConfig, hasUpdates }));
  }

  if (typeof window !== "undefined") {
    window.scanAndRegisterFunctions = scanAndRegisterFunctions;
  }
})();
