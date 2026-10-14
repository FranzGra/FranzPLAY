package io.github.franzgra.franzplay;

import java.net.URI;
import java.net.URISyntaxException;
import java.util.Locale;
import java.util.regex.Pattern;

/**
 * The address of a FranzPLAY server, checked once when the person types it.
 *
 * <p>Pure functions only: no Android, no network, so they are tested on the computer.
 */
final class ServerAddress {

    /** The port FranzPLAY listens on unless its owner chose another. */
    static final int DEFAULT_PORT = 8090;

    /** Why a typed address cannot be used. Each one has its own message for the person. */
    enum Problem {
        EMPTY,
        NOT_AN_ADDRESS,
        UNSUPPORTED_SCHEME,
    }

    /** Thrown by {@link #parse} with the reason the address was refused. */
    static final class InvalidAddressException extends Exception {
        private static final long serialVersionUID = 1L;

        final Problem problem;

        InvalidAddressException(Problem problem) {
            super(problem.name());
            this.problem = problem;
        }
    }

    private static final Pattern HEALTHY = Pattern.compile("\"status\"\\s*:\\s*\"ok\"");

    private ServerAddress() {}

    /**
     * Turns what the person typed into the server's origin, like {@code http://192.168.1.50:8090}.
     *
     * <ul>
     *   <li>Without {@code http://} or {@code https://}, http is used, and without a port
     *       FranzPLAY's own port {@value #DEFAULT_PORT} is added: "192.168.1.50" is enough.
     *   <li>Anything after the address (a pasted video link) is dropped: the app always opens
     *       the server's home page.
     * </ul>
     */
    static String parse(String typed) throws InvalidAddressException {
        String text = typed == null ? "" : typed.trim();
        if (text.isEmpty()) {
            throw new InvalidAddressException(Problem.EMPTY);
        }
        boolean hasScheme = text.contains("://");
        if (!hasScheme) {
            text = "http://" + text;
        }

        URI uri;
        try {
            uri = new URI(text);
        } catch (URISyntaxException e) {
            throw new InvalidAddressException(Problem.NOT_AN_ADDRESS);
        }
        String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase(Locale.ROOT);
        if (!scheme.equals("http") && !scheme.equals("https")) {
            throw new InvalidAddressException(Problem.UNSUPPORTED_SCHEME);
        }
        String host = uri.getHost();
        if (host == null || host.isEmpty() || uri.getUserInfo() != null) {
            throw new InvalidAddressException(Problem.NOT_AN_ADDRESS);
        }

        int port = uri.getPort();
        if (port == -1 && !hasScheme) {
            port = DEFAULT_PORT;
        }
        // URI keeps the brackets of an IPv6 host, like [fe80::1].
        String origin = scheme + "://" + host.toLowerCase(Locale.ROOT);
        if (port != -1 && port != defaultPort(scheme)) {
            origin += ":" + port;
        }
        return origin;
    }

    /**
     * Reports whether url belongs to the server, so it opens inside the app;
     * any other address opens in the phone's browser.
     */
    static boolean isOnServer(String server, String url) {
        try {
            URI a = new URI(server);
            URI b = new URI(url);
            if (a.getScheme() == null || b.getScheme() == null || a.getHost() == null || b.getHost() == null) {
                return false;
            }
            return a.getScheme().equalsIgnoreCase(b.getScheme())
                    && a.getHost().equalsIgnoreCase(b.getHost())
                    && effectivePort(a) == effectivePort(b);
        } catch (URISyntaxException e) {
            return false;
        }
    }

    /** Reports whether the body of GET /api/health is FranzPLAY saying it is alive. */
    static boolean isHealthy(String body) {
        return body != null && HEALTHY.matcher(body).find();
    }

    private static int effectivePort(URI uri) {
        return uri.getPort() != -1 ? uri.getPort() : defaultPort(uri.getScheme().toLowerCase(Locale.ROOT));
    }

    private static int defaultPort(String scheme) {
        return scheme.equals("https") ? 443 : 80;
    }
}
