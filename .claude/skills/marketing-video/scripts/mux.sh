#!/bin/bash
# Mix the 6 chapter MP3s onto a single voiceover track at their start times,
# then mux with the rendered video.
set -e

OUT_DIR="$(dirname "$0")/out"
cd "$OUT_DIR"

echo "Building voiceover.mp3 with chapter delays..."
ffmpeg -y \
  -i ch01.mp3 -i ch02.mp3 -i ch03.mp3 -i ch04.mp3 -i ch05.mp3 -i ch06.mp3 \
  -filter_complex "\
    [0]adelay=0|0[a0]; \
    [1]adelay=7000|7000[a1]; \
    [2]adelay=22000|22000[a2]; \
    [3]adelay=33000|33000[a3]; \
    [4]adelay=45000|45000[a4]; \
    [5]adelay=55000|55000[a5]; \
    [a0][a1][a2][a3][a4][a5]amix=inputs=6:duration=longest:normalize=0,\
    aresample=async=1,apad" \
  -t 68 -ac 2 -b:a 192k voiceover.mp3 2>&1 | tail -5

echo
echo "Muxing video.mp4 + voiceover.mp3 → final.mp4..."
ffmpeg -y \
  -i video.mp4 \
  -i voiceover.mp3 \
  -c:v copy \
  -c:a aac -b:a 192k \
  -map 0:v:0 -map 1:a:0 \
  -shortest \
  final.mp4 2>&1 | tail -5

echo
echo "Done: $OUT_DIR/final.mp4"
ls -lh final.mp4
