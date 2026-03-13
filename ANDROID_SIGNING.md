# Android Keystore Preparation

To sign your Android app so it can be installed on your phone, you need to generate a "Keystore" file.

### 1. Generate the Keystore (Windows)

If you have Android Studio installed, you'll have `keytool`. Open PowerShell and run:

```powershell
keytool -genkey -v -keystore mastv.keystore -alias mastv_alias -keyalg RSA -keysize 2048 -validity 10000
```

**What to do during the process:**
- **Password**: Choose a password (e.g., `mastv123`) and remember it!
- **Details**: You can leave the name/org details blank or just put "MasTV".
- **File**: This will create a file named `mastv.keystore` in your current folder.

### 2. Prepare for GitHub

Once you have `mastv.keystore`, follow these steps to add it to your GitHub Secrets:

1. **Base64 Encode the file**:
   ```powershell
   [Convert]::ToBase64String([IO.File]::ReadAllBytes("mastv.keystore")) | Out-File -FilePath mastv_base64.txt
   ```
2. **Copy the content**: Open `mastv_base64.txt` and copy the long string of text.

### 3. Add to GitHub Secrets

Go to your GitHub Repository → **Settings** → **Secrets and variables** → **Actions** and add:

- `ANDROID_KEYSTORE_BASE64`: (The content of `mastv_base64.txt`)
- `ANDROID_KEYSTORE_PASSWORD`: (The password you chose)
- `ANDROID_KEY_ALIAS`: `mastv_alias`
- `ANDROID_KEY_PASSWORD`: (Same as your keystore password)

### 4. Update Workflow (I will handle this)

Once you provide the secrets, I will update the GitHub Actions workflow to automatically sign the APK using these credentials. This will make it a "Stable Release" APK that anyone can install!
