package pl.pichkur.tvhome;

/** One display scale for Android stream steps, the TV and phone remote. */
final class VolumeScale {
    static int clamp(int level, int max) { return Math.max(0, Math.min(level, Math.max(0, max))); }
    static int percent(int level, int max, boolean muted) {
        return max <= 0 || muted ? 0 : Math.round(100f * clamp(level, max) / max);
    }
}
