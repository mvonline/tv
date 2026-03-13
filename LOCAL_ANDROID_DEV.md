# Local Android Development Setup (Windows)

To run this app on an Android Emulator or your phone locally, you need to set up the Tauri + Android toolchain.

### 1. Prerequisites
- **Node.js**: [Download](https://nodejs.org/)
- **Rust**: Run `winget install Rustlang.Rustup` or download from [rustup.rs](https://rustup.rs/).
- **Java (JDK 17)**: Recommended: [Temurin 17](https://adoptium.net/temurin/releases/?version=17).
- **Android Studio**: [Download](https://developer.android.com/studio).

### 2. Android Studio Configuration
1. Open Android Studio → **SDK Manager**.
2. Install:
   - Android SDK Platform (API 34 or 35).
   - Android SDK Build-Tools.
   - **NDK (Side by side)**.
   - **CMake**.
3. Create an **Emulator** (AVD) or enable **USB Debugging** on your physical phone.

### 3. Tauri Setup
Open PowerShell and run:
```powershell
# Install Tauri CLI globally
npm install -g @tauri-apps/cli

# Add Android targets to Rust
rustup target add aarch64-linux-android armv7-linux-androideabi i686-linux-android x86_64-linux-android
```

### 4. Run Locally
1. Connect your phone or start the Emulator.
2. Run:
```powershell
npm install
npm run tauri android dev
```

The first run will take a few minutes as it downloads the Android Gradle dependencies.
