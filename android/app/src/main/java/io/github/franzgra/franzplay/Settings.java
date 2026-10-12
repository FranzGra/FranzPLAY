package io.github.franzgra.franzplay;

import android.content.Context;
import android.content.SharedPreferences;

/** What the app remembers on the phone: only the server's address. */
final class Settings {

    private static final String FILE = "franzplay";
    private static final String SERVER = "server";

    private Settings() {}

    /** Returns the saved server origin, or null before the first setup. */
    static String server(Context context) {
        return prefs(context).getString(SERVER, null);
    }

    static void saveServer(Context context, String origin) {
        prefs(context).edit().putString(SERVER, origin).apply();
    }

    private static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(FILE, Context.MODE_PRIVATE);
    }
}
