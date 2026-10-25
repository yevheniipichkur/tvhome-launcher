package pl.pichkur.tvhome;

import java.util.*;

/** Bounded public discover parameters. No arbitrary URLs or upstream parameter passthrough. */
final class CinemaQuery {
    static final int[] GENRES = {0,28,12,16,35,80,99,18,10751,14,36,27,10402,9648,10749,878,10770,53,10752,37};
    static final String[] NAMES = {"Усі жанри","Бойовик","Пригоди","Анімація","Комедія","Кримінал","Документальний","Драма","Сімейний","Фентезі","Історичний","Жахи","Музика","Детектив","Романтика","Фантастика","Телефільм","Трилер","Воєнний","Вестерн"};
    final int genre, fromYear, toYear, rating;
    final String sort;
    CinemaQuery(int genre, int fromYear, int toYear, int rating, String sort) {
        int year = Calendar.getInstance(TimeZone.getTimeZone("UTC")).get(Calendar.YEAR);
        boolean valid = false; for (int g : GENRES) if (g == genre) valid = true;
        if (!valid || fromYear < 1900 || toYear > year || fromYear > toYear || rating < 0 || rating > 9 ||
            !Arrays.asList("popularity.desc", "vote_average.desc", "primary_release_date.desc").contains(sort))
            throw new IllegalArgumentException("Перевірте жанр, роки та рейтинг добірки.");
        this.genre=genre; this.fromYear=fromYear; this.toYear=toYear; this.rating=rating; this.sort=sort;
    }
    static CinemaQuery defaults() { return new CinemaQuery(0,1900,Calendar.getInstance(TimeZone.getTimeZone("UTC")).get(Calendar.YEAR),0,"popularity.desc"); }
    String key() { return genre+"-"+fromYear+"-"+toYear+"-"+rating+"-"+sort; }
    static String genreName(int id) { for (int i=0;i<GENRES.length;i++) if (GENRES[i]==id) return NAMES[i]; return "Кіно"; }
    @Override public boolean equals(Object o) { return o instanceof CinemaQuery && key().equals(((CinemaQuery)o).key()); }
    @Override public int hashCode() { return key().hashCode(); }
}
