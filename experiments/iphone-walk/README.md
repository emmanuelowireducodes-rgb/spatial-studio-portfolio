# iPhone Physical Walk Prototype

This directory is an isolated static experiment. It does not import or modify Spatial Studio's production app.

## Run locally

The camera API requires a secure context. `localhost` is treated as secure by browsers:

```powershell
python -m http.server 4173 --bind 127.0.0.1
```

Run that command from the project root and open `http://localhost:4173/experiments/iphone-walk/`.

## HTTPS test deployment on Netlify

The root `netlify.toml` is intentionally unchanged because it deploys the portfolio. For an isolated HTTPS test site, open Netlify Drop and upload the **contents** of this folder, or put all prototype files at the root of a separate test repository/site. That avoids applying the portfolio's root Netlify build settings. Netlify will issue the test site's HTTPS URL, for example:

`https://<your-netlify-test-site>.netlify.app/`

The page loads the official `@8thwall/engine-binary@1.0.0` browser distribution from jsDelivr at `https://cdn.jsdelivr.net/npm/@8thwall/engine-binary@1.0.0/dist/xr.js` and Three.js 0.174 from jsDelivr. The package manifest declares version `1.0.0` and includes `dist`; the official engine guide documents the same `dist/xr.js` path using the `@1` version alias. The prototype's inline loader reports SDK download failure and XR8 readiness separately. The SDK is not copied into the production portfolio. The prototype includes the required attribution and license link. Check the current XR Engine License Agreement before any broader distribution.

## Physical iPhone test checklist

### Responsiveness and sensitivity

The **Positional Response** setting defaults to **1.5× Responsive** and offers **1× Natural** and **2× Enhanced**. It scales translation from the Recenter origin only. XR8 continues to own camera position and orientation; the prototype offsets the virtual room by the extra translation needed to produce that gain, without assigning pose twice or changing orientation/FOV. The selected gain applies immediately to the latest valid pose. During limited tracking, the extra room translation is held until tracking returns to `NORMAL`.

There is no application-side pose interpolation, damping, or throttling. XR8's camera and render pipeline drive the view; the room transform is updated on each valid XR pose callback. Coordinate diagnostics update at most 10 times per second, while render FPS and valid XR pose updates per second are reported about once a second. These rates help distinguish slow rendering/pose delivery from movement that simply feels too small. The prototype does not lower tracking quality to chase frame rate.

1. Deploy this directory at the root of a dedicated HTTPS Netlify test site. Open the URL directly in Safari; do not embed it in an iframe or in-app browser.
2. On an iPhone with Safari 16.4 or later, open the URL and tap **Start Physical Walk**.
3. Accept camera and motion/orientation permission. Keep the rear camera pointed toward a well-lit, visually textured area and move slowly within a clear space.
4. Wait for `Tracking normally`; tap **Recenter**. The room is rebased against the currently rendered camera pose without changing camera FOV.
5. Choose a response setting. Move forward 30 cm while watching **Front Display Distance**, **Tracked / Applied Travel**, **Render and pose rate**, and **Effective Camera XYZ**. At 1× the applied travel should be about 0.30 m; at the default 1.5× it should be about 0.45 m; at 2× it should be about 0.60 m. The 1.60 m front panel should grow promptly as its measured distance shrinks.
6. Move backward 30 cm; confirm display distance increases and the panel shrinks. Move sideways and confirm parallax relative to the 3.80 m reference. Rotate in place and confirm the quaternion changes.
7. Confirm the viewport shows only the opaque virtual room and no camera image. Tap **Stop / Exit** and confirm the browser camera indicator goes away.
8. Record iPhone model, iOS version, Safari version, raw and rendered travel, tracking quality, observed drift, camera background, console errors, and whether stopping releases the camera.

Do not treat desktop testing or a successful build as proof of visual perspective movement or responsiveness. Prior iPhone testing confirmed live tracked position and perspective movement. The selectable gain and rate diagnostics in this revision still need to be retested on a physical iPhone.

## API and caveats

`XR8.XrController.pipelineModule()` supplies `processCpuResult.reality.position`, `.rotation`, `.trackingStatus`, and `.trackingReason`. `XR8.Threejs.pipelineModule()` drives the Three.js camera from the same tracked pose. The page omits `XR8.GlTextureRenderer.pipelineModule()`, does not request the optional Three.js camera texture, and uses an opaque WebGL context. These choices should keep the camera available to SLAM without rendering the live camera background; verify on-device.

The XR8 Three.js integration requires `XR8.XrController.updateCameraProjectionMatrix({origin, facing})` after the initial Three.js camera pose is set. Without this call, the pose readout can change while the renderer camera remains at its initial pose. This prototype now makes that one-time synchronization call; XR8 then owns the camera pose on subsequent frames. Raw tracked coordinates are never copied into the camera a second time.

World tracking is configured with `scale: 'absolute'`, which the XR8 docs define as meter units. Coordinates use the default right-handed axes; Three.js camera forward is local -Z. The one-time initial camera origin is `(0, 1.55, 0)` with identity facing. The large front display is centered 1.60 m along -Z and the smaller reference display is at 3.80 m. Recenter stores the raw pose and rendered camera pose, then applies the inverse rendered camera transform to the office group; it does not call XR8 recenter, move the camera directly, or change FOV. The readout compares raw and applied travel and shows target distance. Its 0.30 m threshold is only a diagnostic; values remain engine measurements.

The simple virtual test room is illustrative, does not represent the user's real surroundings, and has no collision model for actual-world obstacles. The iPhone test confirmed that raw tracked position values change, but initially showed no visible perspective change. The camera synchronization and absolute-scale changes are intended to fix that; verify the visual result on the iPhone before claiming success.

8th Wall's hosted editor and hosting are retired. The current docs list Safari on iOS 16.4+ as supported, require HTTPS, WebGL, `getUserMedia`, deviceorientation when SLAM is enabled, and WebAssembly SIMD. Engine binary maintenance is listed through March 2026, so compatibility with later iOS/Safari releases and future updates is uncertain.

## Startup diagnostics

The page shows separate statuses for secure context, browser capabilities, the 8th Wall SDK download, the `window.XR8` runtime, the Three.js bridge, pipeline registration, camera permission/frame arrival, renderer startup, and valid 6DoF pose updates. The Three.js module is explicitly assigned to `window.THREE` because the 8th Wall Three.js pipeline reads that global. A CDN load failure, camera denial, XR exception, or missing pose is shown inline with a retry-oriented explanation and also logged to the console.

The original initialization failure was the missing `window.THREE` bridge: ES module imports do not create the global expected by `XR8.Threejs.pipelineModule()`. This was cross-checked against the official 8th Wall Three.js example, which assigns `window.THREE = THREE` before registering the pipeline. The prototype now performs that assignment before the Start button is enabled.

Safari may require an explicit tap to grant motion/orientation access; the Start button requests those permissions before starting the pipeline. The browser status checks WebGL, WebAssembly SIMD, camera API and orientation API before enabling tracking.

The project environment used for this prototype could not reach jsDelivr to independently perform an HTTP request against the exact pinned URL. The in-page SDK diagnostic is the runtime check to use on the deployed HTTPS page; a physical iPhone test is still required.
