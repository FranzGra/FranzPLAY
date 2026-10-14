package io.github.franzgra.franzplay;

import android.os.Build;
import android.view.View;
import android.view.WindowInsets;

/**
 * Keeps the app's content clear of the phone's own bars.
 *
 * <p>Since Android 15 the app is drawn under the status bar, the navigation bar and the
 * keyboard; padding the content by their size keeps buttons reachable and text readable.
 */
final class Insets {

    private Insets() {}

    @SuppressWarnings("deprecation") // the old way, for Android 8 to 10
    static void padForSystemBars(View view) {
        view.setOnApplyWindowInsetsListener((v, insets) -> {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                android.graphics.Insets bars = insets.getInsets(
                        WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout() | WindowInsets.Type.ime());
                v.setPadding(bars.left, bars.top, bars.right, bars.bottom);
            } else {
                v.setPadding(
                        insets.getSystemWindowInsetLeft(),
                        insets.getSystemWindowInsetTop(),
                        insets.getSystemWindowInsetRight(),
                        insets.getSystemWindowInsetBottom());
            }
            return insets;
        });
        view.requestApplyInsets();
    }
}
