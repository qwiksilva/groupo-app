# TestFlight Release Steps (Groupo Mobile)

## 1) Pre-release checks
- Ensure backend is deployed and healthy first (Render).
- In `groupo-mobile`, run:
  - `npx tsc --noEmit`
  - `npm run lint`
- Smoke test key flows on a device/simulator.

## 2) Bump iOS app version/build
- Open `groupo-mobile/app.json` and update:
  - `expo.version` (user-visible version, e.g. `1.2.0`)
  - `expo.ios.buildNumber` (must increase every iOS upload, e.g. `6` -> `7`)

## 3) Commit and push code
- From repo root:
  - `git add .`
  - `git commit -m "Release iOS TestFlight vX.Y.Z (build N)"`
  - `git push`

## 4) Build iOS binary with EAS
- In `groupo-mobile`:
  - `eas login`
  - `eas whoami`
  - `eas build -p ios --profile production`

Notes:
- If this is a new machine/project setup, EAS may prompt for Apple credentials/certs.
- Wait for build completion (CLI gives a build URL).

## 5) Submit to App Store Connect / TestFlight
- After build completes:
  - `eas submit -p ios --latest`

Alternative:
- Submit from EAS build page in browser.

## 6) Configure TestFlight in App Store Connect
- Go to App Store Connect -> your app -> TestFlight.
- Wait for Apple processing to finish.
- Fill required compliance metadata if prompted.
- Add build to Internal Testing group (and External group if needed).

## 7) Verify install and sanity test
- Install latest TestFlight build.
- Verify:
  - login/session
  - group/albums tabs
  - posting/commenting/likes
  - notifications

## Common failure points
- `buildNumber` not incremented -> upload rejected.
- Wrong Apple team/bundle identifier.
- Backend not deployed before mobile release.
- Notification credentials/project config missing.
