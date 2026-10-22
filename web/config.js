// Edit freely: the box reloads this page on every return to the home screen.
window.TV_CONFIG = {
  // Dock order (package names). Apps that aren't installed are skipped.
  favorites: [
    'top.rootu.lampa',
    'com.google.android.youtube.tv',
    'com.megogo.application',
    'com.videobox.tv',
    'com.netflix.ninja',
    'studio.scillarium.ottnavigator',
  ],
  // Never shown in the dock or the app drawer.
  hidden: [
    'com.amazon.amazonvideo.livingroom',
    'com.google.android.tv',
    'com.google.android.leanbacklauncher.recommendations',
    'com.ionitech.airscreen',
    'com.waxrain.airplaydmr',
    'com.waxrain.airplaydmr2',
  ],
  pollMs: 5000,
};
