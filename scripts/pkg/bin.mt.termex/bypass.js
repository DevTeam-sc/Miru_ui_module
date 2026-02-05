// Miru Bypass Script for bin.mt.termex
"use strict";

const CONFIG = {
  vkey: {
    namePatterns: ["vkey", "checks", "guard", "kap"],
  },
};

const miruV = {
  indent: 0,
  ts: function () {
    return new Date().toISOString();
  },
  _rawLog: function (msg) {
    console.log("[" + miruV.ts() + "] " + msg);
    try {
      var Log = Java.use("android.util.Log");
      Log.d("Miru", msg);
    } catch (e) {}
  },
  log: function (m) {
    var prefix = "";
    for (var i = 0; i < this.indent; i++) prefix += "│  ";
    var marker = this.indent > 0 ? "├─ " : "";
    this._rawLog("[VKEY] " + prefix + marker + m);
  },
  group: function (label) {
    this.log(label);
    this.indent++;
  },
  groupEnd: function () {
    if (this.indent > 0) this.indent--;
    var prefix = "";
    for (var i = 0; i < this.indent; i++) prefix += "│  ";
    this._rawLog("[VKEY] " + prefix + "└─ [End]");
  },
  error: function (m) {
    var msg = "[VKEY:err] " + m;
    console.error("[" + miruV.ts() + "] " + msg);
    try {
      var Log = Java.use("android.util.Log");
      Log.e("Miru", msg);
    } catch (e) {}
  },
  safe: function (label, fn) {
    try {
      return fn();
    } catch (e) {
      miruV.error(label + ": " + e);
    }
  },
};

function looksLikeVKeyModule(mod) {
  var name = (mod.name || "").toLowerCase();
  for (var i = 0; i < CONFIG.vkey.namePatterns.length; i++) {
    if (name.indexOf(CONFIG.vkey.namePatterns[i]) !== -1) return true;
  }
  return false;
}

function hookVKeyExportsInModule(mod) {
  miruV.safe("hookVKeyExportsInModule", function () {
    var exps = mod.enumerateExports();
    exps.forEach(function (e) {
      var nm = e.name || "";
      var lower = nm.toLowerCase();
      if (
        nm.indexOf("com_vkey_android") !== -1 ||
        lower.indexOf("threat") !== -1 ||
        lower.indexOf("detect") !== -1 ||
        lower.indexOf("vkey") !== -1
      ) {
        miruV.log("hooking " + mod.name + "!" + nm);
        Interceptor.attach(e.address, {
          onLeave: function (retval) {
            try {
              retval.replace(0);
            } catch (e2) {}
          },
        });
      }
    });
  });
}

function scanAndHookExistingVKey() {
  miruV.safe("scanModules", function () {
    Process.enumerateModules().forEach(function (m) {
      if (looksLikeVKeyModule(m)) {
        miruV.log("candidate module " + m.name);
        hookVKeyExportsInModule(m);
      }
    });
  });
}

function installDlopenMonitor() {
  var libart = Process.findModuleByName("libart.so");
  if (libart) {
    var symbols = libart.enumerateSymbols();
    var registerNativesAddr = null;
    for (var i = 0; i < symbols.length; i++) {
      var name = symbols[i].name;
      if (
        name.indexOf("RegisterNatives") !== -1 &&
        name.indexOf("JNI") !== -1 &&
        name.indexOf("CheckJNI") === -1
      ) {
        registerNativesAddr = symbols[i].address;
        miruV.log("[RegisterNatives] Found symbol: " + name);
        break;
      }
    }

    if (registerNativesAddr) {
      var dummyVKeyCallback = new NativeCallback(
        function () {
          console.log("[VKEY] Dummy implementation called! (Safe Log)");
          return 0;
        },
        "void",
        [],
      );

      var threadIds = {};
      Interceptor.attach(registerNativesAddr, {
        onEnter: function (args) {
          var tid = Process.getCurrentThreadId();
          if (threadIds[tid]) return;
          threadIds[tid] = true;
          try {
            var methods = args[2];
            var count = args[3].toInt32();

            if (methods.isNull() || count <= 0) return;

            for (var i = 0; i < count; i++) {
              var methodPtr = methods.add(i * Process.pointerSize * 3);
              var namePtr = Memory.readPointer(methodPtr);
              if (namePtr.isNull()) continue;

              var name = Memory.readUtf8String(namePtr);

              if (
                name === "gwbke" ||
                name === "urkut" ||
                name === "VerifyNative" ||
                (name.length === 5 && /^[a-z]+$/.test(name))
              ) {
                Memory.writePointer(
                  methodPtr.add(Process.pointerSize * 2),
                  dummyVKeyCallback,
                );
              }
            }
          } catch (e) {
          } finally {
            threadIds[tid] = false;
          }
        },
      });
      miruV.log("[RegisterNatives] Hook installed on libart.so");
    }
  }

  function tryHook(name) {
    var ptr = Module.findExportByName(null, name);
    if (!ptr) return;
    Interceptor.attach(ptr, {
      onEnter: function (args) {
        this.path = null;
        try {
          this.path = Memory.readUtf8String(args[0]);
        } catch (e) {}
      },
      onLeave: function () {
        if (!this.path) return;
        var base = null;
        try {
          base = this.path.split("/").pop();
        } catch (e) {}
        if (!base) return;
        var lower = base.toLowerCase();
        for (var i = 0; i < CONFIG.vkey.namePatterns.length; i++) {
          if (lower.indexOf(CONFIG.vkey.namePatterns[i]) !== -1) {
            miruV.log(name + " loaded " + this.path);
            miruV.safe("postLoadVKey", function () {
              var m = Process.findModuleByName(base);
              if (m) hookVKeyExportsInModule(m);
            });
            break;
          }
        }
      },
    });
    miruV.log(name + " monitor installed");
  }
}

function installJavaAntiSuicideAndDialogBlock() {
  Java.perform(function () {
    try {
      var System = Java.use("java.lang.System");
      System.exit.implementation = function (code) {
        miruV.log("block System.exit(" + code + ")");
      };
    } catch (e) {}

    try {
      var Runtime = Java.use("java.lang.Runtime");
      Runtime.exit.implementation = function (code) {
        miruV.log("block Runtime.exit(" + code + ")");
      };
      Runtime.halt.implementation = function (code) {
        miruV.log("block Runtime.halt(" + code + ")");
      };
    } catch (e) {}

    try {
      var P = Java.use("android.os.Process");
      var kp = P.killProcess;
      kp.implementation = function (pid) {
        miruV.log("block Process.killProcess(" + pid + ")");
      };
      var ss = P.sendSignal;
      ss.implementation = function (pid, sig) {
        miruV.log("block Process.sendSignal(" + pid + "," + sig + ")");
      };
    } catch (e) {}

    try {
        var Activity = Java.use("android.app.Activity");
        // Safe overload finding
        var finish = null;
        try { finish = Activity.finish.overload(); } catch(e){}
        
        if (finish) {
            finish.implementation = function () {
                var n = this.getClass().getName().toString();
                if (n.indexOf("VGFullScreenDialogActivity") !== -1 || n.toLowerCase().indexOf("vguard") !== -1) {
                    finish.call(this);
                    return;
                }
                miruV.log("block Activity.finish " + n);
            };
        }
    } catch (e) {}
  });
}

setTimeout(function () {
  miruV.log("Miru V-Key Bypass Loaded (Auto-Template)");
  scanAndHookExistingVKey();
  installDlopenMonitor();
  installJavaAntiSuicideAndDialogBlock();
}, 1000);
