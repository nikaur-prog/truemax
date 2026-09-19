# Native app preparation

> Status, 11 September 2026: Native adapter seams are local preparation only, not a signed app. Physical-device, permission, OAuth, storage and purchase validation remain. See the
> [current continuation handoff](CLAUDE_HANDOFF_2026-09-11.md) for branch preservation,
> verification evidence and the next execution order. Historical details below
> do not imply that the whole roadmap has shipped.

This is preparation, not an App Store-ready build. The existing TypeScript/Vite
app can be reused in a Capacitor shell, but a web wrapper alone will not repair
rendering performance, authentication or billing.

## Implemented seams

- `src/engine/nativeBridge.ts` accepts a native App lifecycle implementation and
  a native file-sharing implementation without loading any native SDK on the
  website's scan path.
- Camera preview, Max 3D and canvas recovery respect native foreground state as
  well as browser visibility. Bridge subscriptions have explicit cleanup.
- `saveFile` delegates to an installed native share adapter. Explicit dismissal
  is terminal; native errors never trigger a second surprise download. The
  normal website retains its existing share/download behavior.
- The native host owns temporary export file cleanup. Neither bridge uploads
  photos, stores access tokens, changes permissions or bypasses authentication.

The interfaces follow the Capacitor App event shape. Native bootstrap can pass
`App` to `bindNativeAppLifecycle(App)`. A Share implementation must first write
the export to the app's temporary storage, share that local URI, and remove it
after the share operation completes. Do not put biometric exports in a public
directory or upload them as a workaround.

## Remaining release gates

1. Select the permanent bundle identifier and Apple Developer team. Install
   pinned Capacitor packages, generate the iOS project and sign a TestFlight
   build. Keep bundled assets; do not conceal a web-only shell behind a remote
   `server.url` and call it finished.
2. Introduce an explicit app API transport. Current `/api/...` requests and
   server same-origin protections assume the website origin. Do not weaken
   those protections to wildcard CORS. Define allowed native transport and
   authenticate every account request before migrating callers.
3. Implement secure token storage plus OAuth, confirmation, password reset and
   sign-in-link callbacks. Current web redirects must not be reused blindly
   for a `capacitor://` origin. Configure exact allowed redirects and verified
   universal links with account-state and replay checks.
4. Wire native camera/gallery permissions, photo orientation and restored
   picker state through the existing image preparation path. Validate model
   and WASM loading in WKWebView and test real-device memory pressure.
5. Design App Store billing/restore/refund handling against the existing server
   entitlement state. Website Apple Pay is not App Store in-app purchasing.
   Check rules for the actual storefronts before enabling purchase links.
6. Verify account deletion, privacy disclosures, explicit optional contribution,
   age protections, accessibility and app-review positioning. Do not market
   photo-derived measurements as clinical diagnoses or validated outcomes.

## Device acceptance pass

Run first scan, review, rapid measurement navigation, side correction, app
background/return, interrupted picker, share cancellation, OAuth return,
purchase restoration and sign-out on an older iPhone and a current iPhone.
Desktop Chromium tests and mobile-sized browser screenshots are not physical
iPhone or native-runtime certification.

Sources checked 10 September 2026:

- [Capacitor installation](https://capacitorjs.com/docs/getting-started)
- [App lifecycle](https://capacitorjs.com/docs/apis/app)
- [Share](https://capacitorjs.com/docs/apis/share)
- [Supabase native deep links](https://supabase.com/docs/guides/auth/native-mobile-deep-linking)
- [App Store review guidelines](https://developer.apple.com/app-store/review/guidelines/)
