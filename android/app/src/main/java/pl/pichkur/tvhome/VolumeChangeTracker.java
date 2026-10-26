package pl.pichkur.tvhome;

/** Deduplicates firmware notifications; own commands already display their confirmation. */
final class VolumeChangeTracker {
    private int current;
    private boolean muted;
    VolumeChangeTracker(int current, boolean muted) { this.current = current; this.muted = muted; }
    boolean changed(int next, boolean nextMuted, boolean own) {
        boolean different = next != current || nextMuted != muted;
        current = next; muted = nextMuted;
        return different && !own;
    }
}
