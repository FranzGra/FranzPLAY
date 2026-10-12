package io.github.franzgra.franzplay;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.Intent;
import android.content.pm.ActivityInfo;
import android.content.pm.ApplicationInfo;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.TextView;
import android.window.OnBackInvokedDispatcher;

/**
 * The app itself: a window that shows the FranzPLAY server's own web interface.
 *
 * <p>The interface lives only in web/ and comes from the server, so updating the
 * server updates the app too. This class adds what a browser tab would miss:
 * full-screen videos, choosing files to upload, the phone's share panel, the back
 * button, and a clear screen when the server cannot be reached.
 */
public class MainActivity extends Activity {

    private static final int PICK_FILES = 1;

    /** The name the web page sees for {@link ShareBridge}. */
    private static final String BRIDGE = "FranzPLAYAndroid";

    /**
     * Gives the page navigator.share, which Android's WebView lacks, so the
     * Condividi button opens the phone's share panel instead of copying the link.
     */
    private static final String SHARE_SHIM = "if (typeof navigator.share !== 'function') {"
            + " navigator.share = function (data) {"
            + " data = data || {};"
            + " " + BRIDGE + ".share(String(data.title || ''), String(data.url || data.text || ''));"
            + " return Promise.resolve(); }; }";

    private String server;
    private WebView web;
    private FrameLayout fullScreen;
    private View problem;
    private TextView problemText;

    private View customView;
    private WebChromeClient.CustomViewCallback customViewCallback;
    private ValueCallback<Uri[]> pendingFiles;
    private boolean loadFailed;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        server = Settings.server(this);
        if (server == null) {
            startActivity(new Intent(this, SetupActivity.class));
            finish();
            return;
        }

        setContentView(R.layout.activity_main);
        Insets.padForSystemBars(findViewById(R.id.content));
        web = findViewById(R.id.web);
        fullScreen = findViewById(R.id.full_screen);
        problem = findViewById(R.id.problem);
        problemText = findViewById(R.id.problem_text);
        findViewById(R.id.retry).setOnClickListener(v -> retry());
        findViewById(R.id.change_server).setOnClickListener(v -> startActivity(new Intent(this, SetupActivity.class)));

        setUpWebView();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(
                    OnBackInvokedDispatcher.PRIORITY_DEFAULT, this::goBack);
        }

        if (savedInstanceState == null || web.restoreState(savedInstanceState) == null) {
            web.loadUrl(server + "/");
        }
    }

    @SuppressLint("SetJavaScriptEnabled") // the interface is a JavaScript app
    private void setUpWebView() {
        boolean debuggable = (getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0;
        WebView.setWebContentsDebuggingEnabled(debuggable);

        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false); // the next video starts by itself
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setUserAgentString(settings.getUserAgentString() + " FranzPLAYAndroid/" + versionName());

        CookieManager.getInstance().setAcceptCookie(true);
        web.addJavascriptInterface(new ShareBridge(), BRIDGE);
        web.setWebViewClient(new Client());
        web.setWebChromeClient(new Chrome());
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        if (web != null) {
            web.saveState(outState);
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (web != null) {
            web.onResume();
        }
    }

    @Override
    protected void onPause() {
        if (web != null) {
            web.onPause();
            CookieManager.getInstance().flush(); // stay signed in after the app is closed
        }
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        if (pendingFiles != null) {
            pendingFiles.onReceiveValue(null);
            pendingFiles = null;
        }
        if (web != null) {
            web.destroy();
            web = null;
        }
        super.onDestroy();
    }

    /**
     * Back before Android 13. From 13 on, the callback registered in onCreate is
     * used instead, and Android no longer calls this method.
     */
    @Override
    @SuppressWarnings("deprecation")
    @SuppressLint("GestureBackNavigation")
    public void onBackPressed() {
        goBack();
    }

    private void goBack() {
        if (customView != null) {
            leaveFullScreen();
        } else if (web != null && web.canGoBack()) {
            web.goBack();
        } else {
            finish();
        }
    }

    private void retry() {
        problem.setVisibility(View.GONE);
        String url = web.getUrl();
        if (url == null || !ServerAddress.isOnServer(server, url)) {
            web.loadUrl(server + "/");
        } else {
            web.reload();
        }
    }

    private void showProblem(CharSequence description) {
        problemText.setText(getString(R.string.problem_text, server, description));
        problem.setVisibility(View.VISIBLE);
    }

    private void openOutside(Uri uri) {
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, uri));
        } catch (ActivityNotFoundException e) {
            // Nothing on the phone opens this kind of link: staying on the page is the only choice.
        }
    }

    private String versionName() {
        try {
            return getPackageManager().getPackageInfo(getPackageName(), 0).versionName;
        } catch (android.content.pm.PackageManager.NameNotFoundException e) {
            return "?";
        }
    }

    // --- Full screen -------------------------------------------------------

    private void enterFullScreen(View view, WebChromeClient.CustomViewCallback callback) {
        if (customView != null) {
            callback.onCustomViewHidden();
            return;
        }
        customView = view;
        customViewCallback = callback;
        fullScreen.addView(view, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
        fullScreen.setVisibility(View.VISIBLE);
        setSystemBarsHidden(true);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_SENSOR); // turn the phone to watch wide
    }

    private void leaveFullScreen() {
        if (customView == null) {
            return;
        }
        fullScreen.removeView(customView);
        fullScreen.setVisibility(View.GONE);
        customView = null;
        setSystemBarsHidden(false);
        getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED);
        WebChromeClient.CustomViewCallback callback = customViewCallback;
        customViewCallback = null;
        if (callback != null) {
            callback.onCustomViewHidden();
        }
    }

    @SuppressWarnings("deprecation") // the old way, for Android 8 to 10
    private void setSystemBarsHidden(boolean hidden) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            WindowInsetsController controller = getWindow().getInsetsController();
            if (controller == null) {
                return;
            }
            if (hidden) {
                controller.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
                controller.hide(WindowInsets.Type.systemBars());
            } else {
                controller.show(WindowInsets.Type.systemBars());
            }
        } else {
            getWindow().getDecorView().setSystemUiVisibility(hidden
                    ? View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                            | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                    : View.SYSTEM_UI_FLAG_VISIBLE);
        }
    }

    // --- Choosing files (upload a video, profile photo) ---------------------

    private boolean pickFiles(ValueCallback<Uri[]> callback, WebChromeClient.FileChooserParams params) {
        if (pendingFiles != null) {
            pendingFiles.onReceiveValue(null);
        }
        pendingFiles = callback;
        Intent intent = params.createIntent();
        if (params.getMode() == WebChromeClient.FileChooserParams.MODE_OPEN_MULTIPLE) {
            intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
        }
        try {
            startActivityForResult(intent, PICK_FILES);
            return true;
        } catch (ActivityNotFoundException e) {
            pendingFiles = null;
            return false; // the page sees "nothing chosen"
        }
    }

    @Override
    @SuppressWarnings("deprecation") // no extra library for the newer way
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != PICK_FILES || pendingFiles == null) {
            return;
        }
        pendingFiles.onReceiveValue(chosenFiles(resultCode, data));
        pendingFiles = null;
    }

    private static Uri[] chosenFiles(int resultCode, Intent data) {
        if (resultCode != RESULT_OK || data == null) {
            return null;
        }
        ClipData clip = data.getClipData();
        if (clip != null && clip.getItemCount() > 0) {
            Uri[] uris = new Uri[clip.getItemCount()];
            for (int i = 0; i < uris.length; i++) {
                uris[i] = clip.getItemAt(i).getUri();
            }
            return uris;
        }
        return data.getData() == null ? null : new Uri[] {data.getData()};
    }

    // --- What the WebView asks the app -------------------------------------

    private final class Client extends WebViewClient {

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            if (ServerAddress.isOnServer(server, request.getUrl().toString())) {
                return false;
            }
            openOutside(request.getUrl()); // links to other sites open in the browser
            return true;
        }

        @Override
        public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
            loadFailed = false;
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            if (!loadFailed) {
                problem.setVisibility(View.GONE);
            }
            view.evaluateJavascript(SHARE_SHIM, null);
        }

        @Override
        public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
            if (request.isForMainFrame()) {
                loadFailed = true;
                showProblem(error.getDescription());
            }
        }

        @Override
        public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
            // The page's engine stopped (usually low memory): start again instead of closing.
            if (web != null) {
                ((FrameLayout) web.getParent()).removeView(web);
                web.destroy();
                web = null;
            }
            recreate();
            return true;
        }
    }

    private final class Chrome extends WebChromeClient {

        @Override
        public void onShowCustomView(View view, CustomViewCallback callback) {
            enterFullScreen(view, callback);
        }

        @Override
        public void onHideCustomView() {
            leaveFullScreen();
        }

        @Override
        public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
            return pickFiles(callback, params);
        }
    }

    /** Called by the page through {@link #SHARE_SHIM}. */
    final class ShareBridge {

        @JavascriptInterface
        public void share(String title, String url) {
            if (url.isEmpty() || !ServerAddress.isOnServer(server, url)) {
                return; // only FranzPLAY's own pages are shared
            }
            Intent send = new Intent(Intent.ACTION_SEND)
                    .setType("text/plain")
                    .putExtra(Intent.EXTRA_SUBJECT, title)
                    .putExtra(Intent.EXTRA_TEXT, url);
            runOnUiThread(() -> startActivity(Intent.createChooser(send, getString(R.string.share_title))));
        }
    }
}
