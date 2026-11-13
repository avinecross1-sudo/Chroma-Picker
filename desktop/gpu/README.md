# GPU renderer (proof of concept)

`gpu-render.js` runs the ray tracer from `plugin/js/render.js` as a WebGL2 fragment shader. It takes the same scene object, and the camera, mesh tree and corner occlusion come from render.js itself (`sceneCamera`, `prepare`, `meshOf`), so the two renderers draw the same picture. At one sample per pixel the frames match render.js on every shape at every zoom (mean difference about 0.5 of 255 per channel, no pixel more than 24 off).

It is not wired into the app yet. Photoshop's UXP panels have no WebGL, so the plugin keeps render.js.

`bench.html` times both renderers and checks they match. Open it in a browser from this folder, or run it under Playwright.
