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
3. Run a film: `node deploy/guide-video/film_transactions.js`
   It writes `media/guide/transactions.mp4` and the poster `transactions.jpg`.
4. List it in `GUIDE_VIDEOS` in `ultimate-budget.js` with its length in seconds.

`demo_seed.js` is the believable month the films are shot on. Nothing touches
real data: the browser is a fresh one with only that seed in it.
