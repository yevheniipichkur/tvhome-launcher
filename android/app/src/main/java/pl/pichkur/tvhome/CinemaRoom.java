package pl.pichkur.tvhome;

import java.util.*;

/** Two private ballots on the box. No server/account, no individual votes in public state. */
final class CinemaRoom {
    static final long LIFETIME_MS = 6 * 60 * 60 * 1000L;
    private final List<String> deck;
    private final LinkedHashMap<String, Player> players = new LinkedHashMap<>();
    private String round;
    private long created;
    private static final class Player {
        final String name;
        final LinkedHashMap<String, Boolean> votes = new LinkedHashMap<>();
        Player(String name) { this.name = name; }
    }
    static final class Snapshot {
        String round;
        final List<String> names = new ArrayList<>();
        final List<Integer> progress = new ArrayList<>();
        final List<String> matches = new ArrayList<>();
        final Map<String, Boolean> mine = new LinkedHashMap<>();
        boolean joined;
    }
    CinemaRoom(List<String> ids) { deck = new ArrayList<>(ids); }
    private void expire(long now) {
        if (round != null && now - created >= LIFETIME_MS) { round = null; players.clear(); }
    }
    synchronized Snapshot state(String client, long now) {
        expire(now);
        Snapshot s = new Snapshot(); s.round = round;
        for (Map.Entry<String, Player> e : players.entrySet()) {
            s.names.add(e.getValue().name); s.progress.add(e.getValue().votes.size());
            if (e.getKey().equals(client)) { s.joined = true; s.mine.putAll(e.getValue().votes); }
        }
        if (players.size() == 2) for (String id : deck) {
            boolean both = true;
            for (Player p : players.values()) both &= Boolean.TRUE.equals(p.votes.get(id));
            if (both) s.matches.add(id);
        }
        return s;
    }
    synchronized Snapshot join(String client, String name, long now) {
        expire(now);
        if (client == null || !client.matches("[a-zA-Z0-9-]{20,64}")) throw new IllegalArgumentException("Невірний код телефону. Перезавантажте сторінку.");
        if (!players.containsKey(client) && players.size() >= 2) throw new IllegalArgumentException("У кімнаті вже двоє. Новий вечір можна почати з телевізора.");
        if (round == null) { round = UUID.randomUUID().toString(); created = now; }
        if (!players.containsKey(client)) {
            String clean = name == null ? "" : name.replaceAll("[\\p{Cntrl}<>]", "").trim();
            if (clean.isEmpty()) clean = "Глядач " + (players.size() + 1);
            players.put(client, new Player(clean.substring(0, Math.min(32, clean.length()))));
        }
        return state(client, now);
    }
    synchronized Snapshot vote(String client, String expectedRound, String id, boolean yes, long now) {
        expire(now);
        if (round == null || !round.equals(expectedRound)) throw new IllegalArgumentException("Вечір змінився. Приєднайтеся ще раз.");
        Player p = players.get(client);
        if (p == null) throw new IllegalArgumentException("Спочатку приєднайтеся до вечора.");
        if (!deck.contains(id)) throw new IllegalArgumentException("Фільму немає в добірці.");
        p.votes.put(id, yes); // Retries are idempotent; undo/change never inflates progress.
        return state(client, now);
    }
    synchronized void replaceDeck(List<String> ids, long now) {
        expire(now);
        if (round != null) throw new IllegalArgumentException("Спочатку почніть новий вечір.");
        deck.clear(); deck.addAll(new LinkedHashSet<>(ids));
    }
    synchronized void appendDeck(List<String> ids) {
        for (String id : ids) if (!deck.contains(id)) deck.add(id);
    }
    synchronized void reset() { round = null; players.clear(); }
}
