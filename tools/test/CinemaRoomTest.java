package pl.pichkur.tvhome;
import java.util.*;
public class CinemaRoomTest {
    static final String A = "aaaaaaaaaaaaaaaaaaaa", B = "bbbbbbbbbbbbbbbbbbbb", C = "cccccccccccccccccccc";
    static int checks;
    static void check(boolean condition, String message) { checks++; if (!condition) throw new AssertionError(message); }
    static void rejects(Runnable action) { try { action.run(); throw new AssertionError("Must reject"); } catch (IllegalArgumentException expected) { checks++; } }
    public static void main(String[] args) throws Exception {
        CinemaRoom r = new CinemaRoom(Arrays.asList("1", "2", "3"));
        check(r.state("", 0).round == null, "no room until joining");
        rejects(() -> r.join("bad", "x", 0));
        CinemaRoom.Snapshot a = r.join(A, "<Yevhenii>", 0);
        String round = a.round;
        check(a.names.get(0).equals("Yevhenii"), "sanitized name");
        r.vote(A, round, "1", true, 1);
        check(r.state("", 1).matches.isEmpty(), "one person cannot match");
        check(r.state("", 1).mine.isEmpty(), "TV cannot see ballots");
        check(r.state(A, 1).mine.get("1"), "own votes restored");
        r.join(B, "Second", 1);
        rejects(() -> r.join(C, "Third", 1));
        check(r.join(A, "renamed", 1).progress.get(0) == 1, "rejoin preserves votes");
        check(r.vote(B, round, "1", true, 2).matches.equals(Arrays.asList("1")), "two yes match");
        r.vote(B, round, "1", true, 3);
        check(r.state(B, 3).progress.get(1) == 1, "duplicate request idempotent");
        check(r.state(B, 3).mine.size() == 1, "only own ballot");
        r.vote(B, round, "1", false, 4);
        check(r.state(A, 4).matches.isEmpty(), "changing yes removes match");
        rejects(() -> r.vote(C, round, "1", true, 4));
        rejects(() -> r.vote(A, round, "999", true, 4));
        rejects(() -> r.vote(A, "stale", "1", true, 4));
        Thread first = new Thread(() -> r.vote(A, round, "2", true, 5));
        Thread second = new Thread(() -> r.vote(B, round, "2", true, 5));
        first.start(); second.start(); first.join(); second.join();
        check(r.state("", 5).matches.equals(Arrays.asList("2")), "concurrent votes synchronized");
        check(r.state("", CinemaRoom.LIFETIME_MS).round == null, "room expires");
        rejects(() -> r.vote(A, round, "1", true, CinemaRoom.LIFETIME_MS));
        String next = r.join(A, "", CinemaRoom.LIFETIME_MS).round;
        check(!next.equals(round), "new round gets fresh identity");
        r.reset();
        check(r.state(A, CinemaRoom.LIFETIME_MS).names.isEmpty(), "reset clears members");
        rejects(() -> r.vote(A, next, "1", true, CinemaRoom.LIFETIME_MS));
        System.out.println("CinemaRoom: " + checks + " checks passed");
    }
}
