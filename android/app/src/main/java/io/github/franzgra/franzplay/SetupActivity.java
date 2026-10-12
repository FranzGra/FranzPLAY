package io.github.franzgra.franzplay;

import android.app.Activity;
import android.content.Intent;
import android.os.Bundle;
import android.view.KeyEvent;
import android.view.View;
import android.view.inputmethod.EditorInfo;
import android.widget.Button;
import android.widget.EditText;
import android.widget.ProgressBar;
import android.widget.TextView;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Asks for the server's address, checks that FranzPLAY answers there, and saves it.
 * It opens on the first start, from the error screen, and from the icon's
 * "Cambia server" shortcut.
 */
public class SetupActivity extends Activity {

    private static final int TIMEOUT_MS = 6000;
    private static final int MAX_BODY_BYTES = 4096;

    private final ExecutorService network = Executors.newSingleThreadExecutor();

    private EditText address;
    private Button connect;
    private ProgressBar progress;
    private TextView problem;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_setup);
        Insets.padForSystemBars(findViewById(R.id.setup_root));

        address = findViewById(R.id.address);
        connect = findViewById(R.id.connect);
        progress = findViewById(R.id.progress);
        problem = findViewById(R.id.problem);

        String saved = Settings.server(this);
        if (saved != null && savedInstanceState == null) {
            address.setText(saved);
        }
        connect.setOnClickListener(v -> check());
        address.setOnEditorActionListener((TextView v, int action, KeyEvent event) -> {
            if (action == EditorInfo.IME_ACTION_GO) {
                check();
                return true;
            }
            return false;
        });
    }

    @Override
    protected void onDestroy() {
        network.shutdownNow();
        super.onDestroy();
    }

    private void check() {
        String origin;
        try {
            origin = ServerAddress.parse(address.getText().toString());
        } catch (ServerAddress.InvalidAddressException e) {
            showProblem(messageFor(e.problem));
            return;
        }
        setBusy(true);
        network.execute(() -> {
            boolean found = answersAsFranzPLAY(origin);
            runOnUiThread(() -> {
                if (isFinishing() || isDestroyed()) {
                    return;
                }
                setBusy(false);
                if (!found) {
                    showProblem(getString(R.string.setup_not_found, origin));
                    return;
                }
                Settings.saveServer(this, origin);
                Intent open = new Intent(this, MainActivity.class);
                open.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TASK | Intent.FLAG_ACTIVITY_NEW_TASK);
                startActivity(open);
                finish();
            });
        });
    }

    /** Calls GET /api/health; any failure means "not a FranzPLAY server here". */
    private static boolean answersAsFranzPLAY(String origin) {
        HttpURLConnection connection = null;
        try {
            connection = (HttpURLConnection) new URL(origin + "/api/health").openConnection();
            connection.setConnectTimeout(TIMEOUT_MS);
            connection.setReadTimeout(TIMEOUT_MS);
            if (connection.getResponseCode() != HttpURLConnection.HTTP_OK) {
                return false;
            }
            try (InputStream in = connection.getInputStream()) {
                return ServerAddress.isHealthy(readSome(in));
            }
        } catch (IOException | RuntimeException e) {
            return false;
        } finally {
            if (connection != null) {
                connection.disconnect();
            }
        }
    }

    private static String readSome(InputStream in) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buffer = new byte[1024];
        int n;
        while (out.size() < MAX_BODY_BYTES && (n = in.read(buffer)) != -1) {
            out.write(buffer, 0, n);
        }
        return out.toString(StandardCharsets.UTF_8.name());
    }

    private String messageFor(ServerAddress.Problem p) {
        switch (p) {
            case EMPTY:
                return getString(R.string.setup_empty);
            case UNSUPPORTED_SCHEME:
                return getString(R.string.setup_scheme);
            case NOT_AN_ADDRESS:
            default:
                return getString(R.string.setup_not_address);
        }
    }

    private void setBusy(boolean busy) {
        connect.setEnabled(!busy);
        address.setEnabled(!busy);
        progress.setVisibility(busy ? View.VISIBLE : View.GONE);
        connect.setText(busy ? R.string.setup_checking : R.string.setup_connect);
        if (busy) {
            problem.setVisibility(View.GONE);
        }
    }

    private void showProblem(String message) {
        problem.setText(message);
        problem.setVisibility(View.VISIBLE);
    }
}
