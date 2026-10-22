// Edit freely: the box reloads this page on every return to the home screen.
window.TV_CONFIG = {
  // Dock order (package names). Apps that aren't installed are skipped.
  favorites: [
    'top.rootu.lamps',               // Lampa
    'com.google.android.youtube.tv',
    'dkc.video.hdbox',               // VideoBox
    'com.megogo.application',
    'com.netflix.ninja',
    'studio.scillarium.ottnavigator',
  ],
  // Never shown in the dock or the app drawer.
  hidden: [
    'com.amazon.amazonvideo.livingroom',
    'com.google.android.tv',            // Live Channels
    'com.softmedia.receiver',           // AirReceiver
    'com.xiaomi.mitv.tvmanager',
    'com.spocky.projengmenu',           // Projectivy (fallback launcher)
    'com.google.android.leanbacklauncher.recommendations',
  ],
  pollMs: 5000,
};
