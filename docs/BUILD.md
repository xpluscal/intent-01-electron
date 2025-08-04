# Building Intent for macOS

This guide explains how to build and package the Intent Electron app for macOS distribution.

## Prerequisites

- Node.js 18 or later
- npm or pnpm
- Xcode Command Line Tools (for building native modules)
- (Optional) Apple Developer account for code signing and notarization

## Quick Start

### Development Build (Unsigned)

For local testing without code signing:

```bash
npm run dist:mac:dev
```

This creates an unsigned `.dmg` and `.zip` in the `release` folder.

### Production Build

For distribution with code signing and notarization:

```bash
npm run dist:mac
```

## Build Scripts

- `npm run build` - Compile TypeScript and bundle the app
- `npm run dist:mac` - Build for current architecture (signed if certs available)
- `npm run dist:mac:arm64` - Build for Apple Silicon only
- `npm run dist:mac:x64` - Build for Intel only  
- `npm run dist:mac:universal` - Build universal binary (both architectures)
- `npm run dist:mac:dev` - Build without code signing (for testing)

## Code Signing Setup

### 1. Get a Developer Certificate

1. Join the [Apple Developer Program](https://developer.apple.com/programs/) ($99/year)
2. In Xcode or Apple Developer portal, create a "Developer ID Application" certificate
3. Export the certificate as a `.p12` file with a password

### 2. Configure Environment Variables

Create a `.env` file (copy from `.env.example`):

```bash
# Certificate file path
CSC_LINK=/path/to/your/certificate.p12

# Certificate password
CSC_KEY_PASSWORD=your-certificate-password
```

### 3. Build with Signing

```bash
npm run dist:mac
```

The app will be automatically signed during the build process.

## Notarization Setup

Notarization is required for apps distributed outside the Mac App Store.

### 1. Create App-Specific Password

1. Go to [appleid.apple.com](https://appleid.apple.com/account/manage)
2. Sign in and navigate to "Security"
3. Under "App-Specific Passwords", click "Generate Password"
4. Name it "Intent Notarization" and save the password

### 2. Configure Environment Variables

Add to your `.env` file:

```bash
# Your Apple ID
APPLE_ID=your-email@example.com

# App-specific password (NOT your Apple ID password)
APPLE_APP_SPECIFIC_PASSWORD=xxxx-xxxx-xxxx-xxxx

# Team ID from developer.apple.com/account/#/membership
APPLE_TEAM_ID=XXXXXXXXXX
```

### 3. Build with Notarization

```bash
npm run dist:mac
```

The app will be signed and then notarized automatically. This can take 5-10 minutes.

## Build Output

Builds are output to the `release/{version}` directory:

- `Intent-{version}-{arch}.dmg` - Disk image for distribution
- `Intent-{version}-{arch}.zip` - ZIP archive for distribution
- `mac` or `mac-arm64` folder - Unpacked app

## Troubleshooting

### "App is damaged" Error

If users see this error, the app needs to be notarized. Make sure you've:
1. Signed the app with a valid Developer ID certificate
2. Notarized the app with valid Apple credentials
3. Used the hardened runtime (already configured)

### Build Fails on TypeScript Errors

Use the development build script which bypasses TypeScript errors:

```bash
npm run dist:mac:dev
```

### Certificate Not Found

Make sure:
1. The certificate path in `CSC_LINK` is absolute
2. The `.p12` file exists and is readable
3. The password in `CSC_KEY_PASSWORD` is correct

### Notarization Fails

Common issues:
1. Invalid Apple ID or password
2. App-specific password not configured
3. Team ID incorrect
4. Network issues (Apple's servers)

Check the console output for specific error messages.

## GitHub Releases

To enable auto-updater with GitHub releases:

1. Create a GitHub personal access token with `repo` scope
2. Add to `.env`: `GH_TOKEN=your-token`
3. Build and publish: `npm run dist:mac -- --publish always`

## Architecture Notes

- Apple Silicon Macs can run both `arm64` and `x64` builds
- Intel Macs can only run `x64` builds
- Universal builds contain both architectures but are larger
- For best performance, use architecture-specific builds

## Security

- Never commit `.env` files with certificates or passwords
- Store certificates securely
- Use environment variables in CI/CD pipelines
- Rotate app-specific passwords regularly