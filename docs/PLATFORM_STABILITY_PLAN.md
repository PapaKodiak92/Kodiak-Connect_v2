# Kodiak Connect Platform Stability Plan

This document is the working direction for stabilizing Kodiak Connect across Windows, Linux, Android, and web.

## Problem

Kodiak Connect has been drifting into platform-specific one-off fixes:

- Windows desktop uses Tauri on Microsoft Edge WebView2.
- Linux desktop uses Tauri on WebKitGTK, plus a custom Rust/GStreamer `webrtcbin` fallback for native RTC.
- Android uses Capacitor/Android WebView.
- Packaged Windows/Linux/Android apps use bundled frontend assets and must be released; a web deploy does not update installed apps.

The current Linux native RTC path is not acceptable as the long-term call stack. It is voice-only, hard to debug, depends on GStreamer pad/caps behavior, and has already consumed too much development time.

## Stabilization Rule

Do not keep patching platform breakages as unrelated one-off fixes.

For calls, updater, notifications, audio routing, and background behavior, build a small platform abstraction layer and keep the product behavior consistent above that layer.

## Compartmentalization Rule

Kodiak Connect should have one shared product UI and product core, with platform-specific adapters underneath it.

Shared product layer:

- React UI, workspace layout, chat surface, member lists, settings, and modals.
- Matrix auth/session/room/message behavior.
- Calls API shape.
- Media/GIF API shape.
- Updater API shape.
- Shared public app configuration.

Platform adapters:

- Windows: Tauri/desktop updater, notifications/tray, file opening, audio behavior, desktop call runtime.
- Linux: Tauri/desktop updater, notifications/tray, PulseAudio/PipeWire and Wayland/X11 behavior, desktop call runtime.
- Android: Capacitor/Android update path, notifications, foreground service, wake locks, audio routing.
- Web: browser-safe fallbacks with no native updater assumptions.

No random UI component should directly own platform APIs. Components should call shared service/adapter interfaces instead.

## Calls v2 Direction

### Core rule

Matrix/Synapse remains the chat, room, identity, and invitation system.

Matrix should announce and coordinate call intent, but it should not be responsible for carrying a custom app-maintained SDP/ICE call stack forever.

### Media transport target

Move calls to a dedicated SFU/media stack. Preferred target: LiveKit.

Reasons:

- One room/participant/track model for voice and video.
- SDKs exist for JavaScript/web, Android, and native platforms.
- Built-in reconnect and network-change behavior.
- Better TURN/ICE handling than the current direct peer-to-peer plus native Linux fallback.

### Platform behavior model

Shared product layer:

- start call
- join call
- leave call
- mute/unmute mic
- enable/disable camera
- participant speaking state
- participant connection quality
- screen share where supported

Platform adapters:

- Windows: desktop call runtime, update behavior, audio device behavior, notification/tray integration.
- Linux: PulseAudio/PipeWire device behavior, Wayland/X11 screen-share behavior, notification/tray integration.
- Android: foreground call service, wake locks, notification channel, audio focus, Bluetooth/earpiece routing.
- Web: browser WebRTC permissions and media devices.

### Desktop runtime decision

For Discord-grade calls, do not depend on Linux WebKitGTK plus custom GStreamer `webrtcbin` as the primary media runtime.

Pick one of these long-term directions:

1. Desktop calls run through a Chromium-backed runtime on Windows and Linux.
2. Desktop calls use a proven native SDK/sidecar with the same call API exposed to the frontend.

The current GStreamer `linux_webrtc.rs` path should be treated as temporary and should be removed after Calls v2 lands.

## Updater Stabilization Direction

The updater is part of platform stability, not a side feature.

Required rules:

- Release pipeline must verify the public desktop manifest after upload.
- Release pipeline must verify each artifact URL referenced by the manifest.
- Release pipeline must verify signature files exist and are non-empty before publishing the manifest.
- Do not publish a manifest until Windows and Linux artifacts are both uploaded and verified.
- Keep Android latest metadata separate from the Tauri desktop updater manifest.
- Do not use broad floating dependency ranges for release-critical packages once the app is in packaged distribution.

## Environment and Media Direction

Use one shared public client configuration shape for all platforms, then layer platform-specific build/runtime behavior underneath it.

Rules:

- Public `VITE_*` values may be bundled into clients.
- Secrets, provider API keys, updater private keys, tokens, and VPS paths must stay out of clients.
- GIF/media search should move behind the Kodiak media API so Windows, Linux, Android, and web all consume one normalized response shape.
- Clients should not directly own provider-specific media keys long term.

## Dependency Stability Direction

Avoid `latest` in release-critical dependencies. The lockfile makes `npm ci` repeatable, but floating package ranges still make casual `npm install` and dependency refreshes risky.

Release-critical packages include:

- Tauri API and plugins
- Tauri CLI
- Capacitor packages
- React/Vite/TypeScript build chain
- call SDKs
- updater/signing tooling

## Practical Next Steps

1. Stop patching Linux native RTC as the primary fix path.
2. Fix/verify the Windows updater path first so packaged users can receive fixes reliably.
3. Add release verification for the public updater manifest and artifact URLs.
4. Decide Calls v2 runtime: LiveKit plus Chromium-backed desktop calls, or LiveKit plus native desktop sidecar.
5. Implement Calls v2 behind a feature flag.
6. Keep existing chat/messaging stable while call migration is built.
7. Remove `linux_webrtc.rs` only after Calls v2 is working across Windows, Linux, Android, and web.
