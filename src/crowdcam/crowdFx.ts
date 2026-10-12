// crowdcam/crowdFx.ts — the camera effects Crowd Cam offers under the record button.
// Same ids / names / cover images as create.tsx's FX strip (only the live GL effects; the plain colour grades are baked at compose time, which
// Crowd Cam doesn't have). `gl` is passed straight to <LiveEffectPreview effect=...>, exactly like create.tsx does with glShaderEffect.
export interface CrowdFx { id: string; name: string; emoji: string; gl: string; image?: any }

export const CROWD_FX: CrowdFx[] = [
  { id: 'fx_gl_vintage_flicker', name: 'Old Film', emoji: '🎞️', gl: 'vintage_flicker', image: require('../assets/images/filters/fx_gl_vintage_flicker.png') },
  { id: 'fx_gl_neon_edge', name: 'Neon Trace', emoji: '💡', gl: 'neon_edge', image: require('../assets/images/filters/fx_gl_neon_edge.png') },
  { id: 'fx_gl_duotone_pulse', name: 'Duo Pulse', emoji: '🔵', gl: 'duotone_pulse', image: require('../assets/images/filters/fx_gl_duotone_pulse.png') },
  { id: 'fx_gl_liquid_chrome', name: 'Liquid Chrome', emoji: '🌊', gl: 'liquid_chrome', image: require('../assets/images/filters/fx_gl_liquid_chrome.png') },
  { id: 'fx_gl_ink_wash', name: 'Ink Wash', emoji: '🖌️', gl: 'ink_wash', image: require('../assets/images/filters/fx_gl_ink_wash.png') },
  { id: 'fx_gl_mood_ring', name: 'Mood Ring', emoji: '💍', gl: 'mood_ring', image: require('../assets/images/filters/fx_gl_mood_ring.png') },
  { id: 'fx_gl_wink_spark', name: 'Wink Spark', emoji: '✨', gl: 'wink_spark', image: require('../assets/images/filters/fx_gl_wink_spark.png') },
  { id: 'fx_gl_smile_shatter', name: 'Smile Shatter', emoji: '💥', gl: 'smile_shatter', image: require('../assets/images/filters/fx_gl_smile_shatter.png') },
  { id: 'fx_gl_head_tilt_zoom', name: 'Tilt Zoom', emoji: '🎯', gl: 'head_tilt_zoom', image: require('../assets/images/filters/fx_gl_head_tilt_zoom.png') },
  { id: 'fx_gl_color_drain', name: 'Color Drain', emoji: '🩶', gl: 'color_drain', image: require('../assets/images/filters/fx_gl_color_drain.png') },
  { id: 'fx_gl_silence_ripple', name: 'Silence Ripple', emoji: '🔵', gl: 'silence_ripple', image: require('../assets/images/filters/fx_gl_silence_ripple.png') },
  { id: 'fx_gl_split_prism', name: 'Split Prism', emoji: '🔺', gl: 'split_prism', image: require('../assets/images/filters/fx_gl_split_prism.png') },
  { id: 'fx_gl_double_take', name: 'Double Take', emoji: '👥', gl: 'double_take', image: require('../assets/images/filters/fx_gl_double_take.png') },
  { id: 'fx_gl_blink_freeze', name: 'Blink Freeze', emoji: '📸', gl: 'blink_freeze', image: require('../assets/images/filters/fx_gl_blink_freeze.png') },
  { id: 'fx_gl_skin_smooth', name: 'Skin Smooth', emoji: '🌸', gl: 'skin_smooth' },
  { id: 'fx_gl_snow_fall', name: 'Snow Fall', emoji: '❄️', gl: 'snow_fall', image: require('../assets/images/filters/fx_gl_snow_fall.png') },
  { id: 'fx_gl_retro_vhs', name: 'Retro VHS', emoji: '📼', gl: 'retro_vhs', image: require('../assets/images/filters/fx_gl_retro_vhs.png') },
  { id: 'fx_gl_light_leak', name: 'Light Leak', emoji: '🌅', gl: 'light_leak', image: require('../assets/images/filters/fx_gl_light_leak.png') },
  { id: 'fx_gl_mouth_words', name: 'Mouth Words', emoji: '💬', gl: 'mouth_words', image: require('../assets/images/filters/fx_gl_mouth_words.png') },
  { id: 'fx_gl_palm_magic', name: 'Palm Magic', emoji: '✨', gl: 'palm_magic', image: require('../assets/images/filters/fx_gl_palm_magic.png') },
  { id: 'fx_gl_rock_paper_scissors', name: 'Rock Paper Scissors', emoji: '✂️', gl: 'rock_paper_scissors', image: require('../assets/images/filters/fx_gl_rock_paper_scissors.png') },
  { id: 'fx_gl_spin_effect', name: 'Spin Effect', emoji: '🌀', gl: 'spin_effect', image: require('../assets/images/filters/fx_gl_spin_effect.png') },
];

export const crowdFxById = (id: string | null): CrowdFx | null => CROWD_FX.find(f => f.id === id) ?? null;
