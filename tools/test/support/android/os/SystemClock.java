package android.os;
/** JVM-only clock seam for exercising the real service; excluded from Android source sets. */
public final class SystemClock {
    public static Runnable beforeRead;
    public static long elapsedRealtime() { Runnable r=beforeRead;beforeRead=null;if(r!=null)r.run();return 1000L; }
}
