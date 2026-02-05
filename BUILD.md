# Building & Installing Miru Next Bypass

## Prerequisites

- Android NDK (for compiling C++ code)
- ADB installed and added to PATH
- Rooted Android device connected via ADB

## 1. Compile C++ (Zygisk)

The module requires `libmiru.so` to be compiled and placed in `zygisk/`.
Navigate to `zygisk/jni` and run:

```bash
ndk-build
```

Or use Android Studio to build the project.
Copy the resulting `.so` files to:

- `zygisk/armeabi-v7a.so`
- `zygisk/arm64-v8a.so`

## 2. Deploy & Install

We have provided a helper script to package and install the module.

**Run in PowerShell:**

```powershell
./scripts/deploy_module.ps1
```

This script will:

1. Zip the module contents.
2. Push it to `/sdcard/Download/miru_next_bypass.zip`.
3. Attempt to install via Magisk CLI.
   - If CLI fails, install manually from the Magisk App (Select from Storage -> Download).

## 3. Manual Installation

1. Zip the contents of `artifacts/magisk_module`.
2. Push to device.
3. Open Magisk App -> Modules -> Install from Storage -> Select Zip.
4. Reboot.
