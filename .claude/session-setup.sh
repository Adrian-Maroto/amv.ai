#!/bin/sh
# What the gate needs that a fresh container does not have.
#
# bubblewrap: `a-command-cannot-read-your-keys` measures the bridge's file fence,
# and without bwrap there is nothing to measure - the suite fails and says so
# rather than passing on the fallback. Installed only where that is safe to do
# without asking anybody: Linux, apt, already root. Everywhere else this does
# nothing, and the suite's message says what to install.
[ "$(uname -s)" = Linux ] || exit 0
command -v apt-get >/dev/null 2>&1 || exit 0
[ "$(id -u)" = 0 ] || exit 0
# Xvfb, xdotool, ImageMagick: `amv-uses-the-screen-only-when-you-started-it-so`
# drives the bridge's screen control on a real virtual display.
need=""
command -v bwrap   >/dev/null 2>&1 || need="$need bubblewrap"
command -v Xvfb    >/dev/null 2>&1 || need="$need xvfb"
command -v xdotool >/dev/null 2>&1 || need="$need xdotool"
command -v import  >/dev/null 2>&1 || need="$need imagemagick"
[ -n "$need" ] || exit 0
apt-get install -y -qq $need >/dev/null 2>&1 \
  || { apt-get update -qq >/dev/null 2>&1 && apt-get install -y -qq $need >/dev/null 2>&1; }
exit 0
