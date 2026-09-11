# One operator, one stage screen

Use **output (O)** for a projector or an OBS window capture. WaveScope shares
the rendered canvas with a video-only audience window. The operator's preview
and the audience therefore share the same preset, transition and animation.
The audience window contains no control deck, cursor, labels, dialogs or errors.
Its stream has no audio track.

## Soundcheck

1. Connect the projector and choose **Extend** in Windows display settings.
   Keep the browser console on the laptop.
2. Open WaveScope in Chrome or Edge. Start with **demo** to check picture.
   Choose an engine and a preset, then open **output (O)** and press
   **Open audience window**. Allow that popup if requested.
3. Move **WaveScope Audience Output** to the projector. Double-click inside
   it, or press **F**, for fullscreen. The operator should report
   **AUDIENCE LIVE · 1920×1080** at Auto resolution. Auto uses 1080p for
   audience output independently of the operator preview's size. An explicit
   RES selection takes precedence; projectM remains capped at 1440p.
4. Press **blackout audience** and confirm the projector turns black while
   the operator preview keeps moving. **restore audience** brings it back.
5. Switch from demo to **mic** for the band. If the mixing desk feeds a USB
   audio interface, select that interface as the browser's microphone input
   before arming mic. Confirm the picture responds during soundcheck.
   WaveScope analyzes microphone audio without playing it back to the PA.
   For music playing on this laptop, use **system** and include audio in the
   share picker. A local **file** plays audibly; its player supports pause,
   seek, replay and loop.
6. Browse and favorite the presets for the set. Single-clicking a browser
   result only selects it; **Play selected** takes it live. For projectM or
   Butterchurn, choose **Set morph target** to prepare a transition without
   changing the current picture.

## During the set

- Keep the console open and visible. The preview, performance buttons and
  setup deck remain visible while output is open. Browser background-tab
  throttling can interrupt rendering if the console is minimized.
- Use **previous visual / next visual** for direct changes. In projectM,
  direct picks cut; **morph** uses the chosen duration. Butterchurn retains
  its normal 2.7-second picker blend; **cut to target** cuts immediately.
- Use a named morph target and duration for rehearsed changes. Shuffle
  morph targets draw from the current engine's allowed favorites when
  **Shuffle favorites only** is enabled. An empty allowed pool holds.
- **hold automation** pauses DJ, VJ and timed changes without stopping
  the visual or audio. Manual controls continue to work. The preset lab also
  holds automation while open.
- Browse, change source, adjust settings or edit equations on the laptop.
  These overlays never enter the audience canvas. Applying a valid edit
  changes the live picture; a rejected edit leaves the previous preset
  running and displays its error in the lab.
- Use **blackout audience** between songs or while recovering a source.
  It only hides the audience video; rendering and audio continue.

## OBS

Add a **Window Capture** source for **WaveScope Audience Output** and crop
any browser/window borders if necessary. Add audio separately in OBS.
The independently controlled `/viz?embed=1` browser source and the
**companions (M)** launcher are different workflows: companions follow the
same audio but have their own renderers, presets and controls.

## Recovery and shutdown

- If output is disconnected, open **output settings** for its message.
  If playback was blocked, double-click the audience window. If it was
  navigated away or closed, close/reopen output from the console.
- Engine changes replace the canvas stream automatically. Allow a brief
  blank while the new engine starts. Blackout is preserved through switches.
- **Close output** releases the stream and returns to the normal console.
  Closing or leaving the console ends the stream. It is not a remote or
  independently running playback device.
- Rehearse the exact browser, projector and capture path before a show.
  Local automated checks do not validate a physical projector or OBS setup.
