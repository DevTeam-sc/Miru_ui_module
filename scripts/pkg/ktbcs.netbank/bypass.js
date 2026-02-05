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

  // V3.3: RegisterNatives Interception (The Magic Bullet)

  // This traps V-Key method registration without risky class scanning

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

      // Keep callback alive by defining it outside the hook context

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

            // args[0] = JNIEnv*

            // args[1] = jclass

            // args[2] = JNINativeMethod*

            // args[3] = jint (nMethods)

            var methods = args[2];

            var count = args[3].toInt32();



            if (methods.isNull() || count <= 0) return;



            for (var i = 0; i < count; i++) {

              var methodPtr = methods.add(i * Process.pointerSize * 3);

              var namePtr = Memory.readPointer(methodPtr);

              if (namePtr.isNull()) continue;



              var name = Memory.readUtf8String(namePtr);



              // Check for V-Key patterns (gwbke, urkut, or others)

              if (

                name === "gwbke" ||

                name === "urkut" ||

                name === "VerifyNative" ||

                (name.length === 5 && /^[a-z]+$/.test(name)) // Random 5-char lowercase often V-Key

              ) {

                // console.log(

                //   "[VKEY] Trap: " +

                //     name +

                //     " detected! Neutralizing... (Safe Log)",

                // );



                // Replace the function pointer in the JNINativeMethod struct

                // struct JNINativeMethod { char* name; char* signature; void* fnPtr; }

                Memory.writePointer(

                  methodPtr.add(Process.pointerSize * 2),

                  dummyVKeyCallback,

                );

                // console.log(

                //   "[VKEY] Replaced " +

                //     name +

                //     " implementation with dummy. (Safe Log)",

                // );

              }

            }

          } catch (e) {

            // console.log("[VKEY] Error in hook: " + e);

          } finally {

            threadIds[tid] = false;

          }

        },

      });

      miruV.log("[RegisterNatives] Hook installed on libart.so");

    }

  }



  // Passive Dlopen Monitor (Logging Only)

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



  // tryHook("android_dlopen_ext");

  // tryHook("dlopen");

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

      var finish = Activity.finish.overload();

      finish.implementation = function () {

        var n = this.getClass().getName().toString();

        if (

          n.indexOf("VGFullScreenDialogActivity") !== -1 ||

          n.toLowerCase().indexOf("vguard") !== -1

        ) {

          finish.call(this);

          return;

        }

        miruV.log("block Activity.finish " + n);

      };

      var finishAffinity = Activity.finishAffinity;

      finishAffinity.implementation = function () {

        var n = this.getClass().getName().toString();

        if (

          n.indexOf("VGFullScreenDialogActivity") !== -1 ||

          n.toLowerCase().indexOf("vguard") !== -1

        ) {

          finish.call(this);

          return;

        }

        miruV.log("block Activity.finishAffinity " + n);

      };

    } catch (e) {}



    try {

      var Context = Java.use("android.content.Context");

      var s1 = null;

      var s2 = null;

      try {

        s1 = Context.startActivity.overload("android.content.Intent");

      } catch (e) {}

      try {

        s2 = Context.startActivity.overload(

          "android.content.Intent",

          "android.os.Bundle",

        );

      } catch (e) {}



      function isVKeyDialog(intent) {

        if (!intent) return false;

        var c = intent.getComponent();

        if (!c) return false;

        try {

          var cn = c.getClassName();

          return (

            cn.indexOf("VGFullScreenDialogActivity") !== -1 ||

            cn.toLowerCase().indexOf("vguard") !== -1

          );

        } catch (e) {

          return false;

        }

      }



      function isDevDialog(intent) {

        if (!intent) return false;

        var c = intent.getComponent();

        if (!c) return false;

        try {

          var cn = c.getClassName();

          var l = cn.toLowerCase();

          return (

            l.indexOf("developer") !== -1 ||

            l.indexOf("devmode") !== -1 ||

            l.indexOf("debug") !== -1

          );

        } catch (e) {

          return false;

        }

      }



      try {

        if (s1)

          s1.implementation = function (i) {

            if (isVKeyDialog(i) || isDevDialog(i)) {

              miruV.log("block startActivity SecurityDialog");

              return;

            }

            return s1.call(this, i);

          };

      } catch (e) {}



      try {

        if (s2)

          s2.implementation = function (i, o) {

            if (isVKeyDialog(i) || isDevDialog(i)) {

              miruV.log("block startActivity SecurityDialog");

              return;

            }

            return s2.call(this, i, o);

          };

      } catch (e) {}

    } catch (e) {}

  });

}



function installUsbDebugHider() {

  Java.perform(function () {

    try {

      var Debug = Java.use("android.os.Debug");

      Debug.isDebuggerConnected.implementation = function () {

        return false;

      };

      Debug.waitingForDebugger.implementation = function () {

        return false;

      };

    } catch (e) {}

    try {

      var Global = Java.use("android.provider.Settings$Global");

      var g1 = null;

      var g2 = null;

      var gS = null;

      try {

        g1 = Global.getInt.overload(

          "android.content.ContentResolver",

          "java.lang.String",

        );

      } catch (e) {}

      try {

        g2 = Global.getInt.overload(

          "android.content.ContentResolver",

          "java.lang.String",

          "int",

        );

      } catch (e) {}

      try {

        gS = Global.getString.overload(

          "android.content.ContentResolver",

          "java.lang.String",

        );

      } catch (e) {}

      function isDevKey(k) {

        if (!k) return false;

        k = k.toString();

        return (

          k === "adb_enabled" ||

          k === "development_settings_enabled" ||

          k === "verifier_verify_adb_installs"

        );

      }

      try {

        if (g1)

          g1.implementation = function (cr, name) {

            if (isDevKey(name)) return 0;

            return g1.call(this, cr, name);

          };

      } catch (e) {}

      try {

        if (g2)

          g2.implementation = function (cr, name, def) {

            if (isDevKey(name)) return 0;

            return g2.call(this, cr, name, def);

          };

      } catch (e) {}

      try {

        if (gS)

          gS.implementation = function (cr, name) {

            if (isDevKey(name)) return null;

            return gS.call(this, cr, name);

          };

      } catch (e) {}

    } catch (e) {}

    try {

      var Secure = Java.use("android.provider.Settings$Secure");

      var s1 = null;

      var s2 = null;

      var sS = null;

      try {

        s1 = Secure.getInt.overload(

          "android.content.ContentResolver",

          "java.lang.String",

        );

      } catch (e) {}

      try {

        s2 = Secure.getInt.overload(

          "android.content.ContentResolver",

          "java.lang.String",

          "int",

        );

      } catch (e) {}

      try {

        sS = Secure.getString.overload(

          "android.content.ContentResolver",

          "java.lang.String",

        );

      } catch (e) {}

      function isDevKeyS(k) {

        if (!k) return false;

        k = k.toString();

        return (

          k === "adb_enabled" ||

          k === "development_settings_enabled" ||

          k === "verifier_verify_adb_installs"

        );

      }

      try {

        if (s1)

          s1.implementation = function (cr, name) {

            if (isDevKeyS(name)) return 0;

            return s1.call(this, cr, name);

          };

      } catch (e) {}

      try {

        if (s2)

          s2.implementation = function (cr, name, def) {

            if (isDevKeyS(name)) return 0;

            return s2.call(this, cr, name, def);

          };

      } catch (e) {}

      try {

        if (sS)

          sS.implementation = function (cr, name) {

            if (isDevKeyS(name)) return null;

            return sS.call(this, cr, name);

          };

      } catch (e) {}

    } catch (e) {}

    try {

      var SystemProperties = Java.use("android.os.SystemProperties");

      var spGet = null;

      try {

        spGet = SystemProperties.get.overload("java.lang.String");

      } catch (e) {}

      if (spGet) {

        spGet.implementation = function (key) {

          var v = spGet.call(this, key);

          try {

            var k = key ? key.toString() : "";

            if (k.indexOf("usb") !== -1 || k.indexOf("adb") !== -1) return "";

            if (k === "ro.debuggable") return "0";

            if (k === "ro.secure") return "1";

            if (k === "ro.build.type") return "user";

            if (k === "ro.build.tags") return "release-keys";

            if (k.indexOf("proxy") !== -1) return "";

            if (k.indexOf("https.proxy") !== -1) return "";

            if (k.indexOf("http.proxy") !== -1) return "";

          } catch (e) {}

          return v;

        };

      }

    } catch (e) {}

    try {

      var Build = Java.use("android.os.Build");

      try {

        Build.TYPE.value = "user";

      } catch (e) {}

      try {

        var t = Build.TAGS.value;

        if (t && ("" + t).indexOf("test-keys") !== -1)

          Build.TAGS.value = "release-keys";

      } catch (e) {}

      try {

        var fp = Build.FINGERPRINT.value;

        if (fp)

          Build.FINGERPRINT.value = ("" + fp).replace(

            /test-keys|dev-keys/gi,

            "release-keys",

          );

      } catch (e) {}

    } catch (e) {}

    try {

      var Context = Java.use("android.content.Context");

      var getAI = null;

      try {

        getAI = Context.getApplicationInfo.overload();

      } catch (e) {}

      if (getAI) {

        getAI.implementation = function () {

          var ai = getAI.call(this);

          try {

            var FLAG_DEBUGGABLE = 0x0002;

            var f = ai.flags.value;

            ai.flags.value = f & ~FLAG_DEBUGGABLE;

          } catch (e) {}

          return ai;

        };

      }

    } catch (e) {}

    miruV.log("usbdebug hider installed");

  });

}



function installSettingsBypass() {

  Java.perform(function () {

    try {

      var SettingsSecure = Java.use("android.provider.Settings$Secure");

      var SettingsGlobal = Java.use("android.provider.Settings$Global");

      var SettingsSystem = Java.use("android.provider.Settings$System");



      function hookGetInt(Class) {

        var overloads = Class.getInt.overloads;

        for (var i = 0; i < overloads.length; i++) {

          let o = overloads[i];

          let orig = o;

          o.implementation = function () {

            var name = arguments[1];

            if (

              name === "development_settings_enabled" ||

              name === "adb_enabled" ||

              name === "accessibility_enabled" ||

              name === "location_mode"

            ) {

              if (name === "location_mode") {

                miruV.log("[Settings] location_mode -> 3");

                return 3;

              }

              miruV.log("[Settings] " + name + " -> 0");

              return 0;

            }

            return orig.apply(this, arguments);

          };

        }

      }



      function hookGetString(Class) {

        var overloads = Class.getString.overloads;

        for (var i = 0; i < overloads.length; i++) {

          let o = overloads[i];

          let orig = o;

          o.implementation = function () {

            var name = arguments[1];

            if (name === "enabled_accessibility_services") {

              miruV.log("[Settings] enabled_accessibility_services -> ''");

              return "";

            }

            if (name === "location_providers_allowed") {

              miruV.log("[Settings] location_providers_allowed -> gps,network");

              return "gps,network";

            }

            if (name === "mock_location") {

              miruV.log("[Settings] mock_location -> 0");

              return "0";

            }

            return orig.apply(this, arguments);

          };

        }

      }



      hookGetInt(SettingsSecure);

      hookGetInt(SettingsGlobal);

      hookGetString(SettingsSecure);

      hookGetString(SettingsGlobal);

      hookGetInt(SettingsSystem);

      hookGetString(SettingsSystem);



      try {

        var gsfuS = SettingsSecure.getStringForUser.overload(

          "android.content.ContentResolver",

          "java.lang.String",

          "int",

        );

        var origS = gsfuS;

        gsfuS.implementation = function (cr, name, userId) {

          try {

            var n = name ? name.toString() : "";

            if (

              n === "development_settings_enabled" ||

              n === "adb_enabled" ||

              n === "location_mode"

            ) {

              miruV.log("[Settings] getStringForUser " + n + " -> 0");

              return "0";

            }

          } catch (e) {}

          return origS.call(this, cr, name, userId);

        };

      } catch (e) {}

      try {

        var gsfuG = SettingsGlobal.getStringForUser.overload(

          "android.content.ContentResolver",

          "java.lang.String",

          "int",

        );

        var origG = gsfuG;

        gsfuG.implementation = function (cr, name, userId) {

          try {

            var n = name ? name.toString() : "";

            if (

              n === "development_settings_enabled" ||

              n === "adb_enabled" ||

              n === "location_mode"

            ) {

              miruV.log("[Settings] getStringForUser " + n + " -> 0");

              return "0";

            }

          } catch (e) {}

          return origG.call(this, cr, name, userId);

        };

      } catch (e) {}



      try {

        var getIntForUserS = SettingsSecure.getIntForUser.overload(

          "android.content.ContentResolver",

          "java.lang.String",

          "int",

        );

        getIntForUserS.implementation = function (cr, name, user) {

          if (name === "development_settings_enabled" || name === "adb_enabled")

            return 0;

          return getIntForUserS.call(this, cr, name, user);

        };

      } catch (e) {}

      try {

        var getIntForUserG = SettingsGlobal.getIntForUser.overload(

          "android.content.ContentResolver",

          "java.lang.String",

          "int",

        );

        getIntForUserG.implementation = function (cr, name, user) {

          if (name === "development_settings_enabled" || name === "adb_enabled")

            return 0;

          return getIntForUserG.call(this, cr, name, user);

        };

      } catch (e) {}



      try {

        var ContentResolver = Java.use("android.content.ContentResolver");

        var MatrixCursor = Java.use("android.database.MatrixCursor");

        var query = ContentResolver.query.overload(

          "android.net.Uri",

          "java.lang.String[]",

          "java.lang.String",

          "java.lang.String[]",

          "java.lang.String",

        );

        query.implementation = function (

          uri,

          projection,

          selection,

          selectionArgs,

          sortOrder,

        ) {

          try {

            var auth = uri.getAuthority();

            if (auth && ("" + auth).indexOf("settings") !== -1) {

              var cols = projection

                ? projection

                : Java.array("java.lang.String", ["name", "value"]);

              var cur = MatrixCursor.$new(cols);

              var name =

                selectionArgs && selectionArgs.length > 0

                  ? selectionArgs[0]

                  : "";

              var val = "0";

              if (name === "location_mode") val = "3";

              cur.addRow(Java.array("java.lang.Object", [name, val]));

              return cur;

            }

          } catch (e) {}

          return query.call(

            this,

            uri,

            projection,

            selection,

            selectionArgs,

            sortOrder,

          );

        };

      } catch (e) {}

      miruV.log("[Settings] bypass installed");

    } catch (e) {}

  });

}



function installUiStringLogger() {

  Java.perform(function () {

    try {

      var TextView = Java.use("android.widget.TextView");

      var Handler = Java.use("android.os.Handler");

      var Looper = Java.use("android.os.Looper");

      var Runnable = Java.use("java.lang.Runnable");

      var View = Java.use("android.view.View");



      try {

        var st1 = TextView.setText.overload("java.lang.CharSequence");

        st1.implementation = function (cs) {

          var s = "";

          try {

            s = cs ? cs.toString() : "";

            // Encode Thai characters to unicode escape for debugging

            var hex = "";

            for (var i = 0; i < s.length; i++) {

              var code = s.charCodeAt(i);

              if (code > 127) {

                hex += "\\u" + ("0000" + code.toString(16)).slice(-4);

              } else {

                hex += s.charAt(i);

              }

            }

            if (hex !== s) {

              miruV.log("[UI] TextView.setText (Encoded): " + hex);

            }



            // Stack Trace Trigger for Error Dialogs

            if (

              s.indexOf("ไม่สามารถทำรายการได้") !== -1 ||

              s.indexOf("กรุณาลองใหม่") !== -1

            ) {

              miruV.log("[UI] ERROR TEXT DETECTED! Printing Stack Trace:");

              var trace = Java.use("android.util.Log").getStackTraceString(

                Java.use("java.lang.Throwable").$new(),

              );

              miruV.log(trace);

            }

          } catch (e) {}

          miruV.log("[UI] TextView.setText: " + s);

          return st1.call(this, cs);

        };

      } catch (e) {}

      try {

        var st2 = TextView.setText.overload("int");

        st2.implementation = function (id) {

          var name = "";

          var s = "";

          try {

            name = this.getResources().getResourceEntryName(id);

            s = this.getResources().getString(id).toString();

          } catch (e) {}

          miruV.log("[UI] TextView.setText id=" + id + " (" + name + "): " + s);

          return st2.call(this, id);

        };

      } catch (e) {}

    } catch (e) {}

    try {

      var Context = Java.use("android.content.Context");

      try {

        var gs1 = Context.getString.overload("int");

        gs1.implementation = function (id) {

          var name = "";

          var s = "";

          try {

            name = this.getResources().getResourceEntryName(id);

            s = this.getResources().getString(id).toString();

          } catch (e) {}

          miruV.log(

            "[UI] Context.getString id=" + id + " (" + name + "): " + s,

          );

          return gs1.call(this, id);

        };

      } catch (e) {}

      try {

        var gs2 = Context.getString.overload("int", "java.lang.Object[]");

        gs2.implementation = function (id, args) {

          var name = "";

          var s = "";

          try {

            name = this.getResources().getResourceEntryName(id);

            s = this.getResources().getString(id).toString();

          } catch (e) {}

          miruV.log(

            "[UI] Context.getString(id, args) id=" +

              id +

              " (" +

              name +

              "): " +

              s,

          );

          return gs2.call(this, id, args);

        };

      } catch (e) {}

    } catch (e) {}

    try {

      var Builder = Java.use("android.app.AlertDialog$Builder");

      try {

        var sm1 = Builder.setMessage.overload("java.lang.CharSequence");

        sm1.implementation = function (cs) {

          var s = cs ? cs.toString() : "";

          miruV.log("[UI] AlertDialog.setMessage: " + s);

          return sm1.call(this, cs);

        };

      } catch (e) {}

      try {

        var sm2 = Builder.setMessage.overload("int");

        sm2.implementation = function (id) {

          var name = "";

          var s = "";

          try {

            var ctx = this.mContext.value;

            name = ctx.getResources().getResourceEntryName(id);

            s = ctx.getResources().getString(id).toString();

          } catch (e) {}

          miruV.log(

            "[UI] AlertDialog.setMessage id=" + id + " (" + name + "): " + s,

          );

          return sm2.call(this, id);

        };

      } catch (e) {}

    } catch (e) {}

    try {

      var Activity = Java.use("android.app.Activity");

      try {

        var onResume = Activity.onResume.overload();

        onResume.implementation = function () {

          var n = "";

          try {

            n = this.getClass().getName().toString();

          } catch (e) {}

          miruV.log("[UI] onResume: " + n);

          try {

            var l = ("" + n).toLowerCase();

            if (

              l.indexOf("developer") !== -1 ||

              l.indexOf("devmode") !== -1 ||

              l.indexOf("security") !== -1 ||

              l.indexOf("interim") !== -1

            ) {

              miruV.log("[UI] block DevMode/Security screen: " + n);

              this.finish();

              return;

            }

          } catch (e) {}

          return onResume.call(this);

        };

      } catch (e) {}

    } catch (e) {}

    miruV.log("[UI] string logger installed");

  });

}



function installTouchSpoof() {

  Java.perform(function () {

    try {

      var MotionEvent = Java.use("android.view.MotionEvent");

      var InputDevice = Java.use("android.view.InputDevice");

      try {

        MotionEvent.getToolType.implementation = function (index) {

          return 1;

        };

      } catch (e) {}

      try {

        MotionEvent.getSource.implementation = function () {

          return 0x0102;

        };

      } catch (e) {}

      try {

        MotionEvent.getDeviceId.implementation = function () {

          return 1;

        };

      } catch (e) {}

      try {

        MotionEvent.getFlags.implementation = function () {

          var flags = this.getFlags();

          return flags & ~1 & ~2;

        };

      } catch (e) {}

      try {

        InputDevice.getName.implementation = function () {

          var name = this.getName();

          if (!name) return name;

          var s = name.toString();

          if (

            s.indexOf("Virtual") !== -1 ||

            s.indexOf("vbox") !== -1 ||

            s.indexOf("geny") !== -1

          )

            return "NVTcapacitiveTouchScreen";

          return name;

        };

      } catch (e) {}

      try {

        InputDevice.isVirtual.implementation = function () {

          return false;

        };

      } catch (e) {}

      try {

        InputDevice.getVendorId.implementation = function () {

          var id = this.getVendorId();

          return id === 0 ? 1234 : id;

        };

      } catch (e) {}

      try {

        InputDevice.getProductId.implementation = function () {

          var id = this.getProductId();

          return id === 0 ? 5678 : id;

        };

      } catch (e) {}

      miruV.log("[Touch] spoofed");

    } catch (e) {

      miruV.log("[Touch] error: " + e);

    }

  });

}



function installFlagSecureBypass() {

  Java.perform(function () {

    try {

      var Window = Java.use("android.view.Window");

      try {

        Window.setFlags.implementation = function (flags, mask) {

          var FLAG_SECURE = 0x00002000;

          var FLAG_NOT_TOUCHABLE = 0x00000010;

          if ((flags & FLAG_SECURE) !== 0) flags &= ~FLAG_SECURE;

          if ((flags & FLAG_NOT_TOUCHABLE) !== 0) {

            miruV.log("[Window] Preventing FLAG_NOT_TOUCHABLE");

            flags &= ~FLAG_NOT_TOUCHABLE;

          }

          return this.setFlags(flags, mask);

        };

      } catch (e) {}

      try {

        Window.addFlags.implementation = function (flags) {

          var FLAG_SECURE = 0x00002000;

          var FLAG_NOT_TOUCHABLE = 0x00000010;

          if ((flags & FLAG_SECURE) !== 0) flags &= ~FLAG_SECURE;

          if ((flags & FLAG_NOT_TOUCHABLE) !== 0) {

            miruV.log("[Window] Preventing FLAG_NOT_TOUCHABLE (addFlags)");

            flags &= ~FLAG_NOT_TOUCHABLE;

          }

          return this.addFlags(flags);

        };

      } catch (e) {}

      miruV.log("[Window] FLAG_SECURE bypass installed");

    } catch (e) {}

  });

}



function installWifiBypass() {

  Java.perform(function () {

    try {

      var WifiManager = Java.use("android.net.wifi.WifiManager");

      try {

        WifiManager.isWifiEnabled.implementation = function () {

          return false;

        };

      } catch (e) {}

      try {

        WifiManager.getWifiState.implementation = function () {

          return 1;

        };

      } catch (e) {}

    } catch (e) {}

    try {

      var NetworkInfo = Java.use("android.net.NetworkInfo");

      try {

        NetworkInfo.getType.implementation = function () {

          return 0;

        };

      } catch (e) {}

      try {

        NetworkInfo.getTypeName.implementation = function () {

          return "MOBILE";

        };

      } catch (e) {}

      try {

        NetworkInfo.isConnected.implementation = function () {

          return true;

        };

      } catch (e) {}

      try {

        NetworkInfo.isConnectedOrConnecting.implementation = function () {

          return true;

        };

      } catch (e) {}

      try {

        NetworkInfo.isAvailable.implementation = function () {

          return true;

        };

      } catch (e) {}

      try {

        NetworkInfo.getSubtype.implementation = function () {

          return 13;

        };

      } catch (e) {}

      try {

        NetworkInfo.getSubtypeName.implementation = function () {

          return "LTE";

        };

      } catch (e) {}

    } catch (e) {}

    try {

      var NetworkCapabilities = Java.use("android.net.NetworkCapabilities");

      try {

        var hasTransport = NetworkCapabilities.hasTransport.overload("int");

        hasTransport.implementation = function (type) {

          if (type === 1 || type === 4) {

            try {

              miruV.log(

                "NETCAP_BYPASS Bypassed NetworkCapabilities.hasTransport(" +

                  type +

                  ")",

              );

            } catch (e) {}

            return false;

          }

          return hasTransport.call(this, type);

        };

      } catch (e) {

        try {

          miruV.error("NETCAP_BYPASS_ERR hasTransport: " + e);

        } catch (e2) {}

      }

      try {

        var _hasCapability = NetworkCapabilities.hasCapability;

        _hasCapability.implementation = function (c) {

          var NET_CAPABILITY_NOT_METERED = 11;

          if (c === NET_CAPABILITY_NOT_METERED) return false;

          return _hasCapability.call(this, c);

        };

      } catch (e) {}

    } catch (e) {}

    try {

      var ConnectivityManager = Java.use("android.net.ConnectivityManager");

      try {

        var getAllNetworks = ConnectivityManager.getAllNetworks;

        getAllNetworks.implementation = function () {

          try {

            return Java.array("android.net.Network", []);

          } catch (e) {

            return getAllNetworks.call(this);

          }

        };

      } catch (e) {}

      try {

        var getDefaultProxy = ConnectivityManager.getDefaultProxy;

        getDefaultProxy.implementation = function () {

          return null;

        };

      } catch (e) {}

      try {

        var getActiveNetwork = ConnectivityManager.getActiveNetwork;

        getActiveNetwork.implementation = function () {

          var net = getActiveNetwork.call(this);

          return net;

        };

      } catch (e) {}

      try {

        var getActiveNetworkInfo = ConnectivityManager.getActiveNetworkInfo;

        getActiveNetworkInfo.implementation = function () {

          var info = getActiveNetworkInfo.call(this);

          return info;

        };

      } catch (e) {}

    } catch (e) {}

    try {

      var VpnService = Java.use("android.net.VpnService");

      try {

        var prepare = VpnService.prepare.overload("android.content.Context");

        prepare.implementation = function (ctx) {

          try {

            miruV.log("[Network] VpnService.prepare bypassed");

          } catch (e) {}

          return null;

        };

      } catch (e) {}

    } catch (e) {}

    try {

      var ProxyInfo = Java.use("android.net.ProxyInfo");

      try {

        var getHost = ProxyInfo.getHost;

        getHost.implementation = function () {

          try {

            miruV.log("proxyHost ProxyInfo.getHost = null");

          } catch (e) {}

          return null;

        };

      } catch (e) {}

      try {

        var getPort = ProxyInfo.getPort;

        getPort.implementation = function () {

          try {

            miruV.log("proxyPort ProxyInfo.getPort = -1");

          } catch (e) {}

          return -1;

        };

      } catch (e) {}

    } catch (e) {}

    try {

      var WifiInfo = Java.use("android.net.wifi.WifiInfo");

      try {

        WifiInfo.getSSID.implementation = function () {

          return '"<unknown ssid>"';

        };

      } catch (e) {}

      try {

        WifiInfo.getBSSID.implementation = function () {

          return "02:00:00:00:00:00";

        };

      } catch (e) {}

      try {

        WifiInfo.getNetworkId.implementation = function () {

          return -1;

        };

      } catch (e) {}

    } catch (e) {}

    try {

      var WifiManager = Java.use("android.net.wifi.WifiManager");

      try {

        var getConfiguredNetworks = WifiManager.getConfiguredNetworks;

        getConfiguredNetworks.implementation = function () {

          var ArrayList = Java.use("java.util.ArrayList");

          return ArrayList.$new();

        };

      } catch (e) {}

      try {

        var getScanResults = WifiManager.getScanResults;

        getScanResults.implementation = function () {

          var ArrayList = Java.use("java.util.ArrayList");

          return ArrayList.$new();

        };

      } catch (e) {}

    } catch (e) {}

    try {

      var Global = Java.use("android.provider.Settings$Global");

      var g1 = null;

      var g2 = null;

      try {

        g1 = Global.getInt.overload(

          "android.content.ContentResolver",

          "java.lang.String",

        );

      } catch (e) {}

      try {

        g2 = Global.getInt.overload(

          "android.content.ContentResolver",

          "java.lang.String",

          "int",

        );

      } catch (e) {}

      function isWifiKey(k) {

        if (!k) return false;

        k = k.toString();

        return (

          k === "wifi_on" || k === "wifi_networks_available_notification_on"

        );

      }

      try {

        if (g1)

          g1.implementation = function (cr, name) {

            if (isWifiKey(name)) return 0;

            return g1.call(this, cr, name);

          };

      } catch (e) {}

      try {

        if (g2)

          g2.implementation = function (cr, name, def) {

            if (isWifiKey(name)) return 0;

            return g2.call(this, cr, name, def);

          };

      } catch (e) {}

    } catch (e) {}

    miruV.log("[Network] Wi-Fi bypass installed");

  });

}



// ==========================================

// FLIGHT RECORDER & THREAT TRAP

// ==========================================

const flightRecorder = [];

function recordAction(type, detail) {

  if (flightRecorder.length > 50) flightRecorder.shift();

  flightRecorder.push({ t: Date.now(), type: type, detail: detail });

}



function dumpFlightRecorder() {

  miruV.error("=== FLIGHT RECORDER DUMP ===");

  flightRecorder.forEach(function (r) {

    console.log(

      "[" + new Date(r.t).toISOString() + "] " + r.type + ": " + r.detail,

    );

  });

  miruV.error("============================");

}



function installThreatTrap() {

  Java.perform(function () {

    // Trap JSON Threats

    try {

      var JSONObject = Java.use("org.json.JSONObject");

      var put = JSONObject.put.overload("java.lang.String", "java.lang.Object");

      put.implementation = function (k, v) {

        var key = k ? k.toString() : "";

        var val = v ? v.toString() : "null";

        if (key === "threat") {

          miruV.error("!!! THREAT DETECTED !!! Value: " + val);

          dumpFlightRecorder();

          // Stack Trace

          try {

            var Exception = Java.use("java.lang.Exception");

            console.log(

              Java.use("android.util.Log").getStackTraceString(

                Exception.$new(),

              ),

            );

          } catch (e) {}

        }

        return put.call(this, k, v);

      };

    } catch (e) {}



    // Recorder Hooks

    try {

      var File = Java.use("java.io.File");

      var init = File.$init.overload("java.lang.String");

      init.implementation = function (path) {

        recordAction("FILE", path);

        return init.call(this, path);

      };

    } catch (e) {}



    try {

      var SystemProperties = Java.use("android.os.SystemProperties");

      var get = SystemProperties.get.overload("java.lang.String");

      get.implementation = function (key) {

        recordAction("PROP", key);

        return get.call(this, key);

      };

    } catch (e) {}

  });

}



function installOnClickListenerMonitor() {

  Java.perform(function () {

    try {

      var View = Java.use("android.view.View");

      var setOnClickListener = View.setOnClickListener.overload(

        "android.view.View$OnClickListener",

      );

      setOnClickListener.implementation = function (listener) {

        if (listener) {

          var name = "";

          try {

            name =

              listener && listener.$className

                ? listener.$className

                : "" + listener;

          } catch (e) {

            name = "UnknownListener";

          }

          miruV.log("[UI] setOnClickListener: " + name);

        }

        return setOnClickListener.call(this, listener);

      };

    } catch (e) {}



    try {

      var View = Java.use("android.view.View");

      var performClick = View.performClick.overload();

      performClick.implementation = function () {

        var id = this.getId();

        var name = "";

        try {

          name = this.getResources().getResourceEntryName(id);

        } catch (e) {}

        miruV.log("[UI] Clicked View ID: " + id + " (" + name + ")");

        return performClick.call(this);

      };

    } catch (e) {}

  });

}



function installPrefsMonitor() {

  Java.perform(function () {

    try {

      var EditorImpl = Java.use("android.app.SharedPreferencesImpl$EditorImpl");



      if (EditorImpl.putString.implementation) return; // Already hooked



      EditorImpl.putString.implementation = function (k, v) {

        miruV.log("[Prefs] putString: " + k + " = " + v);

        return this.putString(k, v);

      };

      EditorImpl.putBoolean.implementation = function (k, v) {

        miruV.log("[Prefs] putBoolean: " + k + " = " + v);

        return this.putBoolean(k, v);

      };

      EditorImpl.apply.implementation = function () {

        miruV.log("[Prefs] apply() called - attempting async save");

        this.apply();

      };

      EditorImpl.commit.implementation = function () {

        var res = this.commit();

        miruV.log("[Prefs] commit() returned: " + res);

        return res;

      };

      miruV.log("[Prefs] SharedPreferences Monitor installed");

    } catch (e) {

      // miruV.log("[Prefs] Hook warning: " + e);

    }

  });

}



function installFileBypass() {

  Java.perform(function () {

    try {

      var File = Java.use("java.io.File");

      var exists = File.exists.overload();

      exists.implementation = function () {

        var path = this.getPath();

        if (

          path.indexOf("TSupportConfig") !== -1 ||

          path.indexOf("magisk") !== -1 ||

          path.indexOf("su") !== -1

        ) {

          miruV.log("[File] Hiding existence: " + path);

          return false;

        }

        return exists.call(this);

      };



      var isFile = File.isFile.overload();

      isFile.implementation = function () {

        var path = this.getPath();

        if (path.indexOf("TSupportConfig") !== -1) return false;

        return isFile.call(this);

      };

    } catch (e) {}

  });

}



function installPmBypass() {

  Java.perform(function () {

    try {

      var ApplicationPackageManager = Java.use(

        "android.app.ApplicationPackageManager",

      );

      var hide = [

        "gr.nikolasspyr.integritycheck",

        "com.zhenxi.hunter",

        "ru.maximoff.apktool",

        "com.topjohnwu.magisk",

      ];



      try {

        var getPackageInfo = ApplicationPackageManager.getPackageInfo.overload(

          "java.lang.String",

          "int",

        );

        getPackageInfo.implementation = function (p, f) {

          if (hide.indexOf(p) !== -1) {

            miruV.log("[PM] Hiding package: " + p);

            var NameNotFoundException = Java.use(

              "android.content.pm.PackageManager$NameNotFoundException",

            );

            throw NameNotFoundException.$new(p);

          }

          return getPackageInfo.call(this, p, f);

        };

      } catch (e) {}



      try {

        var getApplicationInfo =

          ApplicationPackageManager.getApplicationInfo.overload(

            "java.lang.String",

            "int",

          );

        getApplicationInfo.implementation = function (p, f) {

          if (hide.indexOf(p) !== -1) {

            miruV.log("[PM] Hiding app info: " + p);

            var NameNotFoundException = Java.use(

              "android.content.pm.PackageManager$NameNotFoundException",

            );

            throw NameNotFoundException.$new(p);

          }

          return getApplicationInfo.call(this, p, f);

        };

      } catch (e) {}

    } catch (e) {}

  });

}



function installLogSanitizer() {

  Java.perform(function () {

    try {

      var Log = Java.use("android.util.Log");

      var intercept = function (methodName) {

        var overloads = Log[methodName].overloads;

        for (var i = 0; i < overloads.length; i++) {

          overloads[i].implementation = function (tag, msg, tr) {

            var s = (tag || "") + (msg || "");

            if (s.toLowerCase().indexOf("frida") !== -1) {

              return 0;

            }

            return this[methodName].apply(this, arguments);

          };

        }

      };

      // Intercept standard logging methods

      ["d", "v", "i", "e", "w", "wtf"].forEach(intercept);

    } catch (e) {}

  });

}



function installKtbSpecificHooks() {

  Java.perform(function () {

    try {

      var d = Java.use("th.co.ktb.next.foundation.ui.d");

      var onClick = d.onClick.overload("android.view.View");

      onClick.implementation = function (v) {

        miruV.log("[KTB] th.co.ktb.next.foundation.ui.d.onClick triggered");

        // Stack Trace

        var trace = Java.use("android.util.Log").getStackTraceString(

          Java.use("java.lang.Throwable").$new(),

        );

        miruV.log("[KTB] onClick Trace:\n" + trace);

        return onClick.call(this, v);

      };

    } catch (e) {

      miruV.log("[KTB] Failed to hook th.co.ktb.next.foundation.ui.d: " + e);

    }

  });

}



function installCustomPopupDialogTracer() {

  Java.perform(function () {

    try {

      // 1. Hook Constructor directly to catch instantiation

      var CustomPopupDialog = Java.use(

        "th.co.ktb.next.foundation.ui.CustomPopupDialog",

      );

      var init = CustomPopupDialog.$init.overload();

      init.implementation = function () {

        miruV.log("[KTB] CustomPopupDialog instantiated (Constructor)");

        return init.call(this);

      };



      // 2. Hook show() if available

      try {

        var show = CustomPopupDialog.show.overload(

          "androidx.fragment.app.FragmentManager",

          "java.lang.String",

        );

        show.implementation = function (fm, tag) {

          miruV.log("[KTB] CustomPopupDialog.show() called with tag: " + tag);

          var trace = Java.use("android.util.Log").getStackTraceString(

            Java.use("java.lang.Throwable").$new(),

          );

          miruV.log("[KTB] Show Trace:\n" + trace);

          return show.call(this, fm, tag);

        };

      } catch (e) {

        miruV.log("[KTB] CustomPopupDialog.show hook failed: " + e);

      }



      // 3. Keep onCreate hook

      var onCreate = CustomPopupDialog.onCreate.overload("android.os.Bundle");

      onCreate.implementation = function (bundle) {

        miruV.log("[KTB] CustomPopupDialog.onCreate triggered");

        return onCreate.call(this, bundle);

      };

    } catch (e) {

      miruV.log(

        "[KTB] Critical: Failed to find or hook CustomPopupDialog class: " + e,

      );

      // Fallback: enumerate classes to find similar names

      Java.enumerateLoadedClasses({

        onMatch: function (name) {

          if (name.indexOf("CustomPopupDialog") !== -1) {

            miruV.log("[KTB] Found potential class: " + name);

          }

        },

        onComplete: function () {},

      });

    }

  });

}



function installDialogTracer() {

  Java.perform(function () {

    try {

      var Dialog = Java.use("android.app.Dialog");

      Dialog.show.implementation = function () {

        miruV.log("[UI] Dialog.show() called");

        var trace = Java.use("android.util.Log").getStackTraceString(

          Java.use("java.lang.Throwable").$new(),

        );

        miruV.log(trace);

        return this.show();

      };

    } catch (e) {}

    try {

      var AlertDialog = Java.use("android.app.AlertDialog$Builder");

      var show = AlertDialog.show.overload();

      show.implementation = function () {

        miruV.log("[UI] AlertDialog.Builder.show() called");

        var trace = Java.use("android.util.Log").getStackTraceString(

          Java.use("java.lang.Throwable").$new(),

        );

        miruV.log(trace);

        return show.call(this);

      };

    } catch (e) {}

  });

}



function installActivityTracker() {

  Java.perform(function () {

    try {

      var Activity = Java.use("android.app.Activity");

      Activity.onResume.implementation = function () {

        var name = this.getClass().getName();

        miruV.log("[Activity] onResume: " + name);

        this.onResume();

      };

    } catch (e) {

      miruV.log("[Activity] Failed to hook Activity: " + e);

    }

  });

}



function installAppTamperingBypass() {

  Java.perform(function () {

    try {

      var AppTamperingHelperImpl = Java.use(

        "th.co.ktb.next.ui.root.AppTamperingHelperImpl",

      );

      AppTamperingHelperImpl.handleException.implementation = function (

        exception,

      ) {

        miruV.log(

          "[Tampering] AppTamperingHelperImpl.handleException triggered!",

        );

        if (exception) {

          try {

            var trace =

              Java.use("android.util.Log").getStackTraceString(exception);

            miruV.log("[Tampering] Stack: " + trace);

          } catch (e) {}

        }

        miruV.log(

          "[Tampering] Suppressing exception handling (Bypassing V-Key check)",

        );

        return; // Do nothing

      };

    } catch (e) {

      miruV.log("[Tampering] AppTamperingHelperImpl hook failed: " + e);

    }

  });

}



function installAutoClicker() {

  Java.perform(function () {

    miruV.log("[AutoClick] Installing robust auto-clicker...");

    var View = Java.use("android.view.View");

    var ViewGroup = Java.use("android.view.ViewGroup");

    var TextView = Java.use("android.widget.TextView");

    var Activity = Java.use("android.app.Activity");

    var Handler = Java.use("android.os.Handler");

    var Looper = Java.use("android.os.Looper");

    var Runnable = Java.use("java.lang.Runnable");



    function findAndClick(root) {

      if (!root) return false;



      if (root instanceof TextView) {

        var text = "";

        try {

          text = root.getText().toString();

        } catch (e) {}



        if (

          text.indexOf("เริ่มใช้งาน") !== -1 ||

          text.indexOf("Start") !== -1 ||

          text.indexOf("เข้าสู่ระบบ") !== -1 ||

          text.indexOf("ตกลง") !== -1 ||

          text.indexOf("Confirm") !== -1

        ) {

          if (root.isShown() && root.isEnabled()) {

            miruV.log("[AutoClick] Found target button: " + text);

            root.performClick();

            miruV.log("[AutoClick] CLICKED!");

            return true;

          }

        }

      }



      if (root instanceof ViewGroup) {

        var count = root.getChildCount();

        for (var i = 0; i < count; i++) {

          if (findAndClick(root.getChildAt(i))) return true;

        }

      }

      return false;

    }



    Activity.onResume.implementation = function () {

      this.onResume();

      var activity = this;

      var name = activity.getClass().getName();

      // miruV.log("[AutoClick] Activity onResume: " + name);



      var h = Handler.$new(Looper.getMainLooper());

      var r = Runnable.$new({

        run: function () {

          try {

            var window = activity.getWindow();

            if (window) {

              var decor = window.getDecorView();

              findAndClick(decor);

            }

          } catch (e) {

            miruV.log("[AutoClick] Error: " + e);

          }

        },

      });

      // Check immediately and after a short delay

      h.postDelayed(r, 500);

      h.postDelayed(r, 1500);

    };

  });

}



function installCustomPopupSuppressor() {

  Java.perform(function () {

    miruV.log("[UI] Installing CustomPopupDialog suppressor...");

    try {

      var CustomPopupDialog = Java.use(

        "th.co.ktb.next.foundation.ui.CustomPopupDialog",

      );



      function searchAndDismiss(dialog, v) {

        if (!v) return;

        var TextView = Java.use("android.widget.TextView");

        var ViewGroup = Java.use("android.view.ViewGroup");



        var textFound = false;



        function scan(view) {

          if (!view) return;

          if (view instanceof TextView) {

            var txt = "";

            try {

              txt = view.getText().toString();

            } catch (e) {}

            // miruV.log("[UI-Scan] Found TextView: " + txt);

            if (

              txt.indexOf("กรุณาลองใหม่") !== -1 ||

              txt.indexOf("ไม่สามารถทำรายการ") !== -1 ||

              txt.indexOf("ระบบขัดข้อง") !== -1 ||

              txt.indexOf("Please try again") !== -1 ||

              txt.indexOf("Cannot perform") !== -1

            ) {

              miruV.log("[UI] Suppressing CustomPopupDialog with text: " + txt);

              textFound = true;

            }

          }

          if (view instanceof ViewGroup) {

            var count = view.getChildCount();

            for (var i = 0; i < count; i++) {

              scan(view.getChildAt(i));

              if (textFound) return;

            }

          }

        }

        scan(v);



        if (textFound) {

          try {

            dialog.dismiss();

            miruV.log("[UI] CustomPopupDialog dismissed.");

          } catch (e) {

            miruV.log("[UI] Failed to dismiss: " + e);

          }

        }

      }



      CustomPopupDialog.onViewCreated.implementation = function (

        view,

        savedInstanceState,

      ) {

        this.onViewCreated(view, savedInstanceState);

        try {

          searchAndDismiss(this, view);

        } catch (e) {}

      };



      try {

        CustomPopupDialog.onResume.implementation = function () {

          this.onResume();

          try {

            var dialog = this.getDialog();

            if (dialog) {

              var window = dialog.getWindow();

              if (window) {

                searchAndDismiss(this, window.getDecorView());

              }

            }

          } catch (e) {}

        };

      } catch (e) {

        // Method might not be overridden

      }

    } catch (e) {

      miruV.log("[UI] Failed to hook CustomPopupDialog: " + e);

    }

  });

}



function main() {

  miruV.log("[Main] Starting minimal execution...");



  // Minimal test: Only basic anti-suicide to prevent immediate exit

  try {

    // installJavaAntiSuicideAndDialogBlock();

  } catch (e) {

    miruV.log("[Main] installJavaAntiSuicideAndDialogBlock failed: " + e);

  }



  // Disable EVERYTHING else

  /*

  try {

    installFileBypass();

  } catch (e) {

    miruV.log("[Main] installFileBypass failed: " + e);

  }

  // ... (All other functions commented out)

  */



  // Re-enable installDlopenMonitor for RegisterNatives bypassing

  try {

    installDlopenMonitor();

  } catch (e) {

    miruV.log("[Main] installDlopenMonitor failed: " + e);

  }



  miruV.log("[Main] Minimal setup complete. Waiting for crash...");

}



function installWebViewSslBypass() {

  Java.perform(function () {

    try {

      var WebViewClient = Java.use("android.webkit.WebViewClient");

      WebViewClient.onReceivedSslError.implementation = function (

        view,

        handler,

        error,

      ) {

        miruV.log("[WebView] SSL Error bypassed: " + error);

        handler.proceed();

      };

      miruV.log("[WebView] SSL Bypass installed");

    } catch (e) {

      miruV.log("[WebView] Failed to install SSL Bypass: " + e);

    }

  });

}



function installCronetBypass() {

  Java.perform(function () {

    try {

      var CronetEngineBuilder = Java.use(

        "org.chromium.net.CronetEngine$Builder",

      );



      // 1. Enable Public Key Pinning Bypass for Local Trust Anchors

      try {

        var enableBypass =

          CronetEngineBuilder.enablePublicKeyPinningBypassForLocalTrustAnchors.overload(

            "boolean",

          );

        enableBypass.implementation = function (enable) {

          miruV.log(

            "[Cronet] Enabling PublicKeyPinningBypassForLocalTrustAnchors",

          );

          return enableBypass.call(this, true);

        };

      } catch (e) {}



      // 2. Disable adding Public Key Pins

      try {

        var addPin = CronetEngineBuilder.addPublicKeyPins.overload(

          "java.lang.String",

          "java.util.Set",

          "boolean",

          "java.util.Date",

        );

        addPin.implementation = function (

          host,

          pins,

          includeSubdomains,

          expirationDate,

        ) {

          miruV.log("[Cronet] Blocked addPublicKeyPins for " + host);

          return this;

        };

      } catch (e) {}



      miruV.log("[Cronet] Bypass hooks installed");

    } catch (e) {

      // miruV.log("[Cronet] Not found or error: " + e);

    }

  });

}



function fixExistingOkHttpClients() {

  // Scans the heap for existing OkHttpClient instances and neutralizes them

  // Critical for 'Attach' mode where clients are created before we hook

  setTimeout(function () {

    Java.perform(function () {

      miruV.log("[HeapScan] Scanning for OkHttpClient instances...");



      // Helper to find field by type

      function findField(cls, typeName) {

        var fields = cls.class.getDeclaredFields();

        for (var i = 0; i < fields.length; i++) {

          if (fields[i].getType().getName().indexOf(typeName) !== -1) {

            fields[i].setAccessible(true);

            return fields[i];

          }

        }

        return null;

      }



      var OkHttpClient = null;

      try {

        OkHttpClient = Java.use("okhttp3.OkHttpClient");

      } catch (e) {

        return;

      }



      var CertificatePinner = Java.use("okhttp3.CertificatePinner");

      var HostnameVerifier = Java.use("javax.net.ssl.HostnameVerifier");



      // Trust-All Verifier

      var TrustAllVerifier = Java.registerClass({

        name: "com.miru.TrustAllVerifier",

        implements: [HostnameVerifier],

        methods: {

          verify: function (hostname, session) {

            return true;

          },

        },

      });

      var trustAll = TrustAllVerifier.$new();



      Java.choose("okhttp3.OkHttpClient", {

        onMatch: function (instance) {

          try {

            miruV.log(

              "[HeapScan] Found OkHttpClient instance: " + instance.toString(),

            );



            // 1. Kill CertificatePinner

            // We can't easily replace the final field directly via JS access if it's obfuscated,

            // but we can try reflection via Java

            var pinnerField = findField(OkHttpClient, "CertificatePinner");

            if (pinnerField) {

              try {

                pinnerField.set(instance, CertificatePinner.DEFAULT.value);

                miruV.log("[HeapScan] >> Reset CertificatePinner to DEFAULT");

              } catch (e) {

                miruV.log("[HeapScan] >> Failed to set Pinner: " + e);

              }

            }



            // 2. Kill HostnameVerifier

            var verifierField = findField(OkHttpClient, "HostnameVerifier");

            if (verifierField) {

              try {

                verifierField.set(instance, trustAll);

                miruV.log("[HeapScan] >> Set TrustAll HostnameVerifier");

              } catch (e) {

                miruV.log("[HeapScan] >> Failed to set Verifier: " + e);

              }

            }



            // 3. SSLSocketFactory (Optional, risky if we don't have a good X509TrustManager matched)

            // Skipping for now to avoid crashes due to mismatch

          } catch (e) {

            miruV.log("[HeapScan] Error modifying instance: " + e);

          }

        },

        onComplete: function () {

          miruV.log("[HeapScan] Scan complete.");

        },

      });

    });

  }, 3000); // Delay to ensure we are attached and stabilized

}



function installEkycConsentBypass() {

  Java.perform(function () {

    try {

      var targetClass =

        "th.co.ktb.next.ui.customerconsent.ekyc.EkycConsentFragment";



      var exists = false;

      try {

        Java.use(targetClass);

        exists = true;

      } catch (e) {

        Java.enumerateLoadedClasses({

          onMatch: function (name) {

            if (name.indexOf("EkycConsentFragment") !== -1) {

              targetClass = name;

              exists = true;

            }

          },

          onComplete: function () {},

        });

      }



      if (!exists) return;



      var C = Java.use(targetClass);



      try {

        C.j1.implementation = function () {

          try {

            miruV.log("[Policy] EkycConsentFragment.j1() forcing TRUE");

          } catch (e) {}

          return true;

        };

      } catch (e) {}



      try {

        var methods = C.class.getDeclaredMethods();

        for (var i = 0; i < methods.length; i++) {

          var m = methods[i];

          var name = m.getName();

          var retType = m.getReturnType().getName();



          if (retType !== "boolean") continue;

          if (name === "j1") continue;



          (function (methodName) {

            try {

              var overloads = C[methodName].overloads;

              overloads.forEach(function (ov) {

                ov.implementation = function () {

                  var ret = ov.apply(this, arguments);



                  var lower = methodName.toLowerCase();

                  if (

                    lower.indexOf("valid") !== -1 ||

                    lower.indexOf("check") !== -1 ||

                    lower.indexOf("consent") !== -1 ||

                    lower.indexOf("policy") !== -1

                  ) {

                    try {

                      miruV.log(

                        "[Policy] " +

                          targetClass +

                          "." +

                          methodName +

                          "() -> forcing TRUE",

                      );

                    } catch (e) {}

                    return true;

                  }



                  return ret;

                };

              });

            } catch (e) {}

          })(name);

        }

      } catch (e) {}



      try {

        miruV.log("[Policy] EkycConsentFragment bypass installed");

      } catch (e) {}

    } catch (e) {}

  });

}



function installOkHttpRealCallSpoof() {

  var tries = 0;

  var max = 20;

  var interval = setInterval(function () {

    tries++;

    try {

      Java.perform(function () {

        var RealCall = null;

        var targetClassName = "okhttp3.RealCall";

        var foundClass = false;



        // 1. Try standard name

        try {

          RealCall = Java.use(targetClassName);

          foundClass = true;

        } catch (e) {

          // 2. Hunt for obfuscated RealCall

          if (tries % 5 === 0) {

            try {

              Java.enumerateLoadedClasses({

                onMatch: function (className) {

                  if (foundClass) return;

                  if (

                    className.indexOf("RealCall") !== -1 ||

                    className.indexOf("okhttp") !== -1

                  ) {

                    try {

                      var cls = Java.use(className);

                      var methods = cls.class.getDeclaredMethods();

                      for (var i = 0; i < methods.length; i++) {

                        if (

                          methods[i].getName() ===

                          "getResponseWithInterceptorChain"

                        ) {

                          targetClassName = className;

                          foundClass = true;

                          miruV.log(

                            "[Hunter] Found RealCall class: " + className,

                          );

                          RealCall = cls;

                          // Dump methods for debugging

                          var mList = cls.class.getDeclaredMethods();

                          miruV.log(

                            "[Hunter] Inspecting " +

                              className +

                              " methods (" +

                              mList.length +

                              "):",

                          );

                          for (var k = 0; k < mList.length; k++) {

                            var m = mList[k];

                            var args = m

                              .getParameterTypes()

                              .map(function (c) {

                                return c.getName();

                              })

                              .join(",");

                            miruV.log(

                              " - " +

                                m.getName() +

                                "(" +

                                args +

                                ") : " +

                                m.getReturnType().getName(),

                            );

                          }

                          return;

                        }

                      }

                    } catch (e) {}

                  }

                },

                onComplete: function () {},

              });

            } catch (e) {}

          }

        }



        if (!RealCall && !foundClass) {

          // Try to use com.android.okhttp.Call directly if not found yet

          try {

            RealCall = Java.use("com.android.okhttp.Call");

            foundClass = true;

            miruV.log("[Hunter] Fallback to com.android.okhttp.Call");

            var mList = RealCall.class.getDeclaredMethods();

            miruV.log("[Hunter] Methods:");

            for (var k = 0; k < mList.length; k++) {

              var m = mList[k];

              var args = m

                .getParameterTypes()

                .map(function (c) {

                  return c.getName();

                })

                .join(",");

              miruV.log(

                " - " +

                  m.getName() +

                  "(" +

                  args +

                  ") : " +

                  m.getReturnType().getName(),

              );

            }

          } catch (e) {}

        }



        if (!RealCall) return;



        var targetMethod = null;

        try {

          // Signature Hunting: Find method that returns okhttp3.Response and takes 0 arguments

          var methods = RealCall.class.getDeclaredMethods();

          for (var i = 0; i < methods.length; i++) {

            if (methods[i].getName() === "getResponseWithInterceptorChain") {

              targetMethod = "getResponseWithInterceptorChain";

              break;

            }

          }



          if (!targetMethod) {

            // Fallback to signature

            for (var i = 0; i < methods.length; i++) {

              var m = methods[i];

              var args = m.getParameterTypes();

              if (

                args.length === 0 &&

                m.getReturnType().getName().indexOf("Response") !== -1

              ) {

                targetMethod = m.getName();

                miruV.log(

                  "[Hunter] Found RealCall method by signature: " +

                    targetMethod,

                );

                break;

              }

            }

          }

        } catch (e) {}



        if (!targetMethod) return;



        var original = null;

        try {

          original = RealCall[targetMethod].overload("boolean");

        } catch (e) {

          try {

            original = RealCall[targetMethod].overload();

          } catch (e2) {}

        }



        if (!original) {

          miruV.log(

            "[Hunter] Failed to find suitable overload for " + targetMethod,

          );

          return;

        }



        original.implementation = function (arg0) {

          var request = null;

          var url = "";

          var method = "";

          var isGroupStarted = false;



          try {

            // Try standard method first

            if (this.request) {

              request = this.request();

            }



            // Fallback: Reflection to find 'originalRequest' or similar field of type Request

            if (!request) {

              var fields = this.getClass().getDeclaredFields();

              for (var i = 0; i < fields.length; i++) {

                fields[i].setAccessible(true);

                var val = fields[i].get(this);

                if (

                  val &&

                  val.toString().indexOf("Request") !== -1 &&

                  val.url

                ) {

                  request = val;

                  break;

                }

              }

            }



            if (request) {

              url = request.url().toString();

              method = request.method();

              miruV.group("[Network] " + method + " " + url);

              isGroupStarted = true;

            }

          } catch (e) {}



          try {

            if (

              url.indexOf("detect-recording") !== -1 ||

              url.indexOf("log/tamper") !== -1 ||

              url.indexOf("device-detect") !== -1

            ) {

              miruV.log("├─ [Match] Critical security endpoint detected");

              var ResponseBuilder = null;

              try {

                ResponseBuilder = Java.use("okhttp3.Response$Builder");

              } catch (e) {}



              if (ResponseBuilder) {

                // Standard OkHttp available

                var Protocol = Java.use("okhttp3.Protocol");

                var ResponseBody = Java.use("okhttp3.ResponseBody");

                var MediaType = Java.use("okhttp3.MediaType");



                var json = "{}";



                if (url.indexOf("detect-recording") !== -1) {

                  json =

                    '{"isBlackList":false,"isVKey":false,"suspiciousAppList":[],"threat":""}';

                } else if (url.indexOf("log/tamper") !== -1) {

                  json =

                    '{"nextRequestWaitMillis":"86400000","logResponseDetails":[]}';

                } else if (url.indexOf("device-detect") !== -1) {

                  json = "{}";

                }



                miruV.log("├─ [Spoof] Payload: " + json);



                var mediaType = null;

                try {

                  mediaType = MediaType.parse(

                    "application/json; charset=utf-8",

                  );

                } catch (e) {}



                var body = null;

                try {

                  body = ResponseBody.create(mediaType, json);

                } catch (e) {}



                var protocol = Protocol.HTTP_1_1;

                try {

                  if (!protocol) protocol = Protocol.values()[0];

                } catch (e) {}



                try {

                  var builder = ResponseBuilder.$new()

                    .request(request)

                    .protocol(protocol)

                    .code(200)

                    .message("OK")

                    .body(body);



                  var spoofed = builder.build();

                  miruV.log("└─ [Action] Returned Fake 200 OK");

                  if (isGroupStarted) miruV.groupEnd();

                  return spoofed;

                } catch (e) {}

              } else {

                miruV.log(

                  "└─ [Block] OkHttp classes missing, blocking request",

                );

                if (isGroupStarted) miruV.groupEnd();

                var IOException = Java.use("java.io.IOException");

                throw IOException.$new("Miru Blocked");

              }

            }

          } catch (e) {}



          var res = original.apply(this, arguments);

          if (isGroupStarted) {

            try {

              miruV.log("└─ [Result] " + (res ? res.code() : "null"));

            } catch (e) {}

            miruV.groupEnd();

          }

          return res;

        };



        try {

          miruV.log(

            "[Network] OkHttp RealCall spoof installed on " +

              targetClassName +

              "." +

              targetMethod,

          );

        } catch (e) {}



        clearInterval(interval);

      });

    } catch (e) {}



    if (tries >= max) {

      clearInterval(interval);

    }

  }, 1000);

}



function installOnboardingIdBypass() {

  Java.perform(function () {

    try {

      var targetClass =

        "th.co.ktb.next.ui.onboarding.id.manualinput.cid.OnboardingCitizenIdVerifyFragment";



      var exists = false;

      try {

        Java.use(targetClass);

        exists = true;

      } catch (e) {

        Java.enumerateLoadedClasses({

          onMatch: function (name) {

            if (name.indexOf("OnboardingCitizenIdVerifyFragment") !== -1) {

              targetClass = name;

              exists = true;

            }

          },

          onComplete: function () {},

        });

      }



      if (!exists) return;



      var C = Java.use(targetClass);

      try {

        C.j1.implementation = function () {

          try {

            miruV.log("[ID] j1() called, forcing TRUE");

          } catch (e) {}

          return true;

        };

      } catch (e) {}



      try {

        C.valid13.implementation = function (a) {

          try {

            miruV.log("[ID] valid13(" + a + ") -> TRUE");

          } catch (e) {}

          return true;

        };

      } catch (e) {}



      try {

        var methods = C.class.getDeclaredMethods();

        for (var i = 0; i < methods.length; i++) {

          var m = methods[i];

          var name = m.getName();

          var retType = m.getReturnType().getName();

          if (retType !== "boolean") continue;

          if (name === "j1" || name === "valid13") continue;



          (function (methodName) {

            try {

              var overloads = C[methodName].overloads;

              overloads.forEach(function (ov) {

                ov.implementation = function () {

                  var ret = ov.apply(this, arguments);

                  try {

                    miruV.log("[ID] " + methodName + "() called, ret=" + ret);

                  } catch (e) {}



                  if (

                    methodName.indexOf("valid13") !== -1 ||

                    (arguments.length > 0 &&

                      arguments[0] &&

                      arguments[0].toString().replace(/\s/g, "").length === 13)

                  ) {

                    try {

                      miruV.log(

                        "[ID] bypass " +

                          methodName +

                          " (arg looks like ID) -> TRUE",

                      );

                    } catch (e) {}

                    return true;

                  }



                  if (arguments.length === 0) {

                    if (

                      [

                        "isVisible",

                        "isAdded",

                        "isHidden",

                        "isResumed",

                        "isRemoving",

                        "isDetached",

                        "isInLayout",

                        "isMenuVisible",

                        "isStateSaved",

                      ].indexOf(methodName) === -1

                    ) {

                      try {

                        miruV.log(

                          "[ID] potential validator " +

                            methodName +

                            "() -> forcing TRUE",

                        );

                      } catch (e) {}

                      return true;

                    }

                  }



                  return ret;

                };

              });

            } catch (e) {}

          })(name);

        }

      } catch (e) {}



      try {

        miruV.log("[ID] OnboardingCitizenIdVerifyFragment bypass installed");

      } catch (e) {}

    } catch (e) {}

  });

}



function installSslTrustManagerBypass() {

  Java.perform(function () {

    miruV.log("[SSL] Installing Enhanced Universal SSL Bypass...");



    // Strategy: Hook existing TrustManager implementations instead of replacing them.

    // This avoids crashes in native code (Cronet/WebView) that expect specific TrustManager types.



    try {

      var TrustManagerImpl = Java.use(

        "com.android.org.conscrypt.TrustManagerImpl",

      );



      // Hook verifyChain (returns List<X509Certificate>)

      try {

        TrustManagerImpl.verifyChain.implementation = function (

          untrustedChain,

          trustAnchorChain,

          host,

          clientAuth,

          ocspData,

          tlsSctData,

        ) {

          miruV.log("[SSL] Conscrypt verifyChain bypassed for " + host);

          return untrustedChain;

        };

      } catch (e) {

        miruV.log("[SSL] verifyChain hook failed: " + e);

      }



      // Hook checkTrusted (returns List<X509Certificate>)

      try {

        TrustManagerImpl.checkTrusted.implementation = function (

          chain,

          authType,

          session,

          parameters,

          authType2,

        ) {

          miruV.log("[SSL] Conscrypt checkTrusted bypassed");

          // Convert array to List to avoid null/empty issues

          var Arrays = Java.use("java.util.Arrays");

          if (chain) {

            return Arrays.asList(chain);

          }

          var ArrayList = Java.use("java.util.ArrayList");

          return ArrayList.$new();

        };

      } catch (e) {

        miruV.log("[SSL] checkTrusted hook failed: " + e);

      }



      // Hook generic checkServerTrusted

      try {

        var checkServerTrusted = TrustManagerImpl.checkServerTrusted.overload(

          "[Ljava.security.cert.X509Certificate;",

          "java.lang.String",

        );

        checkServerTrusted.implementation = function (chain, authType) {

          // miruV.log("[SSL] Conscrypt checkServerTrusted(2 args) bypassed");

        };

      } catch (e2) {}



      try {

        var checkServerTrusted2 = TrustManagerImpl.checkServerTrusted.overload(

          "[Ljava.security.cert.X509Certificate;",

          "java.lang.String",

          "java.net.Socket",

        );

        checkServerTrusted2.implementation = function (

          chain,

          authType,

          socket,

        ) {

          // miruV.log("[SSL] Conscrypt checkServerTrusted(3 args) bypassed");

        };

      } catch (e) {}



      try {

        var checkServerTrusted3 = TrustManagerImpl.checkServerTrusted.overload(

          "[Ljava.security.cert.X509Certificate;",

          "java.lang.String",

          "javax.net.ssl.SSLEngine",

        );

        checkServerTrusted3.implementation = function (

          chain,

          authType,

          engine,

        ) {

          // miruV.log("[SSL] Conscrypt checkServerTrusted(3 args engine) bypassed");

        };

      } catch (e) {}



      miruV.log("[SSL] Conscrypt TrustManagerImpl hooks installed");

    } catch (e) {

      miruV.log("[SSL] Failed to hook Conscrypt TrustManagerImpl: " + e);

    }



    // Attempt to hook X509TrustManagerExtensions for Chromium

    try {

      var Extensions = Java.use("android.net.http.X509TrustManagerExtensions");

      Extensions.checkServerTrusted.implementation = function (

        chain,

        authType,

        host,

      ) {

        miruV.log(

          "[SSL] X509TrustManagerExtensions.checkServerTrusted bypassed",

        );

        var Arrays = Java.use("java.util.Arrays");

        if (chain) return Arrays.asList(chain);

        return Java.use("java.util.ArrayList").$new();

      };

    } catch (e) {

      // miruV.log("[SSL] X509TrustManagerExtensions hook failed: " + e);

    }



    // 4. Hook NetworkSecurityTrustManager (Android 7+)

    try {

      var NetworkSecurityTrustManager = Java.use(

        "android.security.net.config.NetworkSecurityTrustManager",

      );

      try {

        var checkPins =

          NetworkSecurityTrustManager.checkPins.overload("java.util.List");

        checkPins.implementation = function (pins) {

          miruV.log("[SSL] NetworkSecurityTrustManager.checkPins bypassed");

          return;

        };

      } catch (e) {}



      try {

        var checkServerTrusted =

          NetworkSecurityTrustManager.checkServerTrusted.overload(

            "[Ljava.security.cert.X509Certificate;",

            "java.lang.String",

            "java.lang.String",

          );

        checkServerTrusted.implementation = function (certs, authType, host) {

          miruV.log(

            "[SSL] NetworkSecurityTrustManager.checkServerTrusted(host=" +

              host +

              ") bypassed",

          );

          return java.util.Collections.emptyList(); // Returns List<X509Certificate>

        };

      } catch (e) {}

    } catch (e) {}



    // 6. Hook HttpsURLConnection (WebView already handled separately)

    try {

      var HttpsURLConnection = Java.use("javax.net.ssl.HttpsURLConnection");

      try {

        HttpsURLConnection.setDefaultHostnameVerifier.implementation =

          function (hostnameVerifier) {

            // miruV.log("[SSL] HttpsURLConnection.setDefaultHostnameVerifier bypassed");

            return;

          };

      } catch (e) {}

      try {

        HttpsURLConnection.setSSLSocketFactory.implementation = function (

          SSLSocketFactory,

        ) {

          // miruV.log("[SSL] HttpsURLConnection.setSSLSocketFactory bypassed");

          return;

        };

      } catch (e) {}

      try {

        HttpsURLConnection.setHostnameVerifier.implementation = function (

          hostnameVerifier,

        ) {

          // miruV.log("[SSL] HttpsURLConnection.setHostnameVerifier bypassed");

          return;

        };

      } catch (e) {}

    } catch (e) {}



    // 7. Hook SSLContext to inject custom TrustManager (Fallback)

    // DISABLED: Can cause SIGSEGV/StackOverflow with Conscrypt native code

    /*

    try {

      var SSLContext = Java.use("javax.net.ssl.SSLContext");

      var TrustManager = Java.use("javax.net.ssl.X509TrustManager");

      var MyTrustManager = Java.registerClass({

        name: "com.miru.MyTrustManager",

        implements: [TrustManager],

        methods: {

          checkClientTrusted: function (chain, authType) {},

          checkServerTrusted: function (chain, authType) {},

          getAcceptedIssuers: function () {

            return [];

          },

        },

      });

      var myTM = [MyTrustManager.$new()];



      var init = SSLContext.init.overload(

        "[Ljavax.net.ssl.KeyManager;",

        "[Ljavax.net.ssl.TrustManager;",

        "java.security.SecureRandom",

      );

      init.implementation = function (km, tm, random) {

        miruV.log("[SSL] SSLContext.init called. Replacing TrustManagers.");

        init.call(this, km, myTM, random);

      };

    } catch (e) {

      miruV.log("[SSL] SSLContext hook failed: " + e);

    }

    */



    // 8. Hook OkHttpClient.Builder to inject SSLSocketFactory

    try {

      var OkHttpClientBuilder = Java.use("okhttp3.OkHttpClient$Builder");

      try {

        OkHttpClientBuilder.sslSocketFactory.overload(

          "javax.net.ssl.SSLSocketFactory",

          "javax.net.ssl.X509TrustManager",

        ).implementation = function (sslSocketFactory, trustManager) {

          miruV.log(

            "[SSL] OkHttpClient.Builder.sslSocketFactory (standard) called. Replacing.",

          );

          var SSLContext = Java.use("javax.net.ssl.SSLContext");

          var context = SSLContext.getInstance("TLS");

          var TrustManager = Java.use("javax.net.ssl.X509TrustManager");

          var MyTrustManager = Java.registerClass({

            name: "com.miru.MyTrustManagerOkHttp",

            implements: [TrustManager],

            methods: {

              checkClientTrusted: function (chain, authType) {},

              checkServerTrusted: function (chain, authType) {},

              getAcceptedIssuers: function () {

                return [];

              },

            },

          });

          var myTM = [MyTrustManager.$new()];

          context.init(null, myTM, null);

          var factory = context.getSocketFactory();

          return this.sslSocketFactory(factory, myTM[0]);

        };

      } catch (e) {}

    } catch (e) {}



    miruV.log("[SSL] Enhanced TrustManager bypass active");

  });

}



function installOkHttpCertificatePinnerBypass() {

  var tries = 0;

  var max = 20;

  var interval = setInterval(function () {

    tries++;

    try {

      Java.perform(function () {

        var foundAny = false;



        // 1. Try OkHttp3 (Standard)

        try {

          var CertificatePinner = Java.use("okhttp3.CertificatePinner");



          try {

            CertificatePinner.check.overload(

              "java.lang.String",

              "java.util.List",

            ).implementation = function (str, list) {

              miruV.log(

                "[SSL] OkHttp3 CertificatePinner.check(String, List) bypassed for " +

                  str,

              );

              return;

            };

          } catch (e) {}



          try {

            CertificatePinner.check.overload(

              "java.lang.String",

              "[Ljava.security.cert.Certificate;",

            ).implementation = function (str, certs) {

              miruV.log(

                "[SSL] OkHttp3 CertificatePinner.check(String, Certificate[]) bypassed for " +

                  str,

              );

              return;

            };

          } catch (e) {}



          miruV.log("[SSL] OkHttp3 CertificatePinner hooks installed");

          foundAny = true;

        } catch (e) {}



        // 2. Try Legacy OkHttp (com.android.okhttp)

        try {

          var LegacyPinner = Java.use("com.android.okhttp.CertificatePinner");

          var overloads = LegacyPinner.check.overloads;

          for (var i = 0; i < overloads.length; i++) {

            overloads[i].implementation = function () {

              miruV.log("[SSL] Legacy OkHttp CertificatePinner.check bypassed");

              return;

            };

          }

          miruV.log("[SSL] Legacy OkHttp CertificatePinner hooks installed");

          foundAny = true;

        } catch (e) {}



        // 3. Try to find OkHttpClient.Builder to force TrustManager

        try {

          var OkHttpClientBuilder = Java.use("okhttp3.OkHttpClient$Builder");

          // If we found the builder, we can try to intercept build() or sslSocketFactory()

          // But replacing the whole client is hard.

          // Let's hook sslSocketFactory(SSLSocketFactory, X509TrustManager)

          try {

            var sslSocketFactory = OkHttpClientBuilder.sslSocketFactory;

            // We can't easily pass our custom TrustManager here because of type mismatch if classes are different loaders.

            // But we can Log it.

            // miruV.log("[SSL] Found OkHttpClient$Builder");

          } catch (e) {}

        } catch (e) {}



        if (foundAny) clearInterval(interval);

      });

    } catch (e) {}

    if (tries > max) clearInterval(interval);

  }, 1000);

}



function installVpnProxyBypass() {

  Java.perform(function () {

    try {

      var ProxyInfo = Java.use("android.net.ProxyInfo");

      try {

        ProxyInfo.getHost.implementation = function () {

          return null;

        };

      } catch (e) {}

      try {

        ProxyInfo.getPort.implementation = function () {

          return 0;

        };

      } catch (e) {}

      try {

        ProxyInfo.isValid.implementation = function () {

          return false;

        };

      } catch (e) {}

    } catch (e) {}

    try {

      var ProxySelector = Java.use("java.net.ProxySelector");

      var ArrayList = Java.use("java.util.ArrayList");

      try {

        var select = ProxySelector.select;

        select.implementation = function (uri) {

          var list = ArrayList.$new();

          return list;

        };

      } catch (e) {}

    } catch (e) {}

    try {

      var Proxy = Java.use("java.net.Proxy");

      var InetSocketAddress = Java.use("java.net.InetSocketAddress");

      var URI = Java.use("java.net.URI");

      try {

        var newProxy = Proxy.$new.overload(

          "java.net.Proxy$Type",

          "java.net.SocketAddress",

        );

        newProxy.implementation = function (type, addr) {

          try {

            var t = type ? type.name() : "";

            if (t && t.toString().indexOf("HTTP") !== -1) {

              var no = InetSocketAddress.$new("", 0);

              return Proxy.$new(Proxy.Type.DIRECT.value, no);

            }

          } catch (e) {}

          return newProxy.call(this, type, addr);

        };

      } catch (e) {}

    } catch (e) {}

    miruV.log("[Network] VPN/Proxy bypass installed");

  });

}



function installDialogSuppressor() {

  Java.perform(function () {

    var suppressedBuilders = {};

    var suppressedDialogs = {};

    function shouldSuppress(msg) {

      try {

        var s = (msg || "").toString();

        var l = s.toLowerCase();

        var match =

          l.indexOf("ไม่สามารถทำรายการได้") !== -1 ||

          l.indexOf("กรุณาลองใหม่ภายหลัง") !== -1 ||

          l.indexOf("กรุณาปิดสัญญาณ wi-fi") !== -1 ||

          l.indexOf("กรุณาปิดสัญญาณ wi") !== -1 ||

          l.indexOf("please turn off wi-fi") !== -1 ||

          l.indexOf("turn off wi-fi") !== -1 ||

          l.indexOf("cannot proceed") !== -1 ||

          l.indexOf("try again later") !== -1 ||

          l.indexOf("ไม่สามารถเข้าสู่ระบบ") !== -1 ||

          l.indexOf("cannot login") !== -1;



        if (match) {

          miruV.log("[UI] Suppressing dialog with message: " + s);

          try {

            var Log = Java.use("android.util.Log");

            var Throwable = Java.use("java.lang.Throwable");

            miruV.log(

              "[UI] Stack trace: " + Log.getStackTraceString(Throwable.$new()),

            );

          } catch (e) {

            miruV.log("[UI] Failed to get stack trace: " + e);

          }

        }

        return match;

      } catch (e) {

        return false;

      }

    }



    function hookBuilder(BuilderClassName) {

      try {

        var Builder = Java.use(BuilderClassName);

        try {

          var sm1 = Builder.setMessage.overload("java.lang.CharSequence");

          sm1.implementation = function (cs) {

            var s = cs ? cs.toString() : "";

            if (shouldSuppress(s)) {

              suppressedBuilders[this.$h] = true;

            }

            return sm1.call(this, cs);

          };

        } catch (e) {}

        try {

          var sm2 = Builder.setMessage.overload("int");

          sm2.implementation = function (id) {

            var s = "";

            try {

              var ctx = this.mContext.value;

              s = ctx.getResources().getString(id).toString();

            } catch (e) {}

            if (shouldSuppress(s)) {

              suppressedBuilders[this.$h] = true;

            }

            return sm2.call(this, id);

          };

        } catch (e) {}

        try {

          var create = Builder.create.overload();

          create.implementation = function () {

            var dlg = create.call(this);

            if (suppressedBuilders[this.$h]) {

              suppressedDialogs[dlg.$h] = true;

            }

            return dlg;

          };

        } catch (e) {}

      } catch (e) {}

    }



    function hookDialog(DialogClassName) {

      try {

        var Dialog = Java.use(DialogClassName);

        try {

          var show = Dialog.show.overload();

          show.implementation = function () {

            if (suppressedDialogs[this.$h]) {

              miruV.log("[UI] suppressed error dialog");

              return;

            }

            return show.call(this);

          };

        } catch (e) {}

      } catch (e) {}

    }



    hookBuilder("android.app.AlertDialog$Builder");

    hookBuilder("androidx.appcompat.app.AlertDialog$Builder");

    hookDialog("android.app.AlertDialog");

    hookDialog("androidx.appcompat.app.AlertDialog");

    hookDialog("com.google.android.material.bottomsheet.BottomSheetDialog");

    miruV.log("[UI] dialog suppressor installed");

  });

}



function installNetworkLogger() {

  Java.perform(function () {

    try {

      var RealCall = Java.use("okhttp3.RealCall");

      RealCall.getResponseWithInterceptorChain.implementation = function () {

        var response = this.getResponseWithInterceptorChain();

        try {

          var code = response.code();

          var request = response.request();

          var url = request.url().toString();

          miruV.log("[Network] " + code + " " + url);



          if (code === 401 || code === 403 || code === 500) {

            miruV.log("[Network] FAILURE detected: " + code + " for " + url);

          }

        } catch (e) {

          miruV.log("[Network] Error logging response: " + e);

        }

        return response;

      };

      miruV.log("[Network] Logger installed on OkHttp3 RealCall");

    } catch (e) {

      miruV.log("[Network] Failed to install network logger: " + e);

    }

  });

}



setImmediate(main);



var features = {

  FUNC_SSL_UNPINNING: function () {

    /*

    try {

      installWebViewSslBypass();

    } catch (e) {}

    try {

      installCronetBypass();

    } catch (e) {}

    try {

      fixExistingOkHttpClients();

    } catch (e) {}

    try {

      installOkHttpCertificatePinnerBypass();

    } catch (e) {}

    */

  },

  FUNC_BYPASS_VKEY: function () {

    try {

      installDlopenMonitor();

    } catch (e) {}

  },

  FUNC_ANTI_SUICIDE: function () {

    /*

    try {

      installJavaAntiSuicideAndDialogBlock();

    } catch (e) {}

    try {

      installDialogSuppressor();

    } catch (e) {}

    */

  },

  FUNC_ACTIVITY_MONITOR: function () {

    /*

    try {

      installNetworkLogger();

    } catch (e) {}

    */

  },

  FUNC_VPN_PROXY: function () {

    /*

    try {

      installVpnProxyBypass();

    } catch (e) {}

    */

  },

};



if (typeof registerBypass === "function") {

  registerBypass(features);

} else {

  console.log("🚀 Standalone Mode: Activating features...");

  setImmediate(main);

}

