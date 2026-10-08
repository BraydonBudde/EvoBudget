# Guide videos

The short films behind "Watch it in action" in the guide. Each is recorded
on the real app: a phone-sized browser runs a scripted visit, with a touch
indicator, captions and a title and end card drawn over it, and every frame
is captured and encoded to H.264 MP4 (plays everywhere, iPhones included).

The page runs 3.5 times slower while it is filmed and the frames are played
back at full speed, so the app's heavier screens still come out smooth.

## Making one

1. Start the local preview: `node deploy/local-preview.js`
2. Have Playwright for Node (`npm i playwright`) and an ffmpeg with libx264.
   `pip install imageio-ffmpeg` bundles one; point `FFMPEG` at it:
   `FFMPEG=$(python -c "import imageio_ffmpeg as f; print(f.get_ffmpeg_exe())")`
3. Run a film: `node deploy/guide-video/film.js <section>`, for example
   `film.js budget`. It writes `media/guide/<section>.mp4` and its poster
   `<section>.jpg`. `DM_FAST=1` does a quick dry run at normal speed with
   nothing recorded, and `DM_LOG=1` prints each step as it happens.
4. Put its length in seconds in `GUIDE_VIDEO_SECS` in `ultimate-budget.js`.

Each section's storyboard is a short file in `films/`: a title, an end line,
and the taps and captions in between. The recorder's helpers type on the
app's own keypad, pick dates and dropdown options, and swipe, so a film
reads like the steps a person would take.

`demo_seed.js` is the believable month the films are shot on. Nothing touches
real data: the browser is a fresh one with only that seed in it.
