package io.github.franzgra.franzplay;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

import org.junit.Test;

public class ServerAddressTest {

    @Test
    public void parseAcceptsWhatPeopleType() throws Exception {
        String[][] cases = {
            // typed, want
            {"192.168.1.50", "http://192.168.1.50:8090"},
            {"  192.168.1.50  ", "http://192.168.1.50:8090"},
            {"192.168.1.50:9000", "http://192.168.1.50:9000"},
            {"franzplay.local", "http://franzplay.local:8090"},
            {"FranzPLAY.Local:8090/", "http://franzplay.local:8090"},
            {"http://192.168.1.50", "http://192.168.1.50"},
            {"http://192.168.1.50:80", "http://192.168.1.50"},
            {"http://192.168.1.50:8090///", "http://192.168.1.50:8090"},
            {"HTTPS://video.example.org", "https://video.example.org"},
            {"https://video.example.org:443", "https://video.example.org"},
            {"https://video.example.org:8443", "https://video.example.org:8443"},
            {"http://192.168.1.50:8090/video/42?t=10", "http://192.168.1.50:8090"},
            {"[fe80::1]:8090", "http://[fe80::1]:8090"},
        };
        for (String[] c : cases) {
            assertEquals("typed " + c[0], c[1], ServerAddress.parse(c[0]));
        }
    }

    @Test
    public void parseRefusesWhatIsNotAServer() {
        Object[][] cases = {
            {"", ServerAddress.Problem.EMPTY},
            {"   ", ServerAddress.Problem.EMPTY},
            {null, ServerAddress.Problem.EMPTY},
            {"ftp://192.168.1.50", ServerAddress.Problem.UNSUPPORTED_SCHEME},
            {"javascript://alert(1)", ServerAddress.Problem.UNSUPPORTED_SCHEME},
            {"http://", ServerAddress.Problem.NOT_AN_ADDRESS},
            {"192.168.1.50 casa", ServerAddress.Problem.NOT_AN_ADDRESS},
            {"http://mario:segreto@192.168.1.50", ServerAddress.Problem.NOT_AN_ADDRESS},
        };
        for (Object[] c : cases) {
            try {
                String got = ServerAddress.parse((String) c[0]);
                fail("typed \"" + c[0] + "\": want refused, got " + got);
            } catch (ServerAddress.InvalidAddressException e) {
                assertEquals("typed \"" + c[0] + "\"", c[1], e.problem);
            }
        }
    }

    @Test
    public void isOnServerKeepsOnlyTheServerInsideTheApp() {
        String server = "http://192.168.1.50:8090";
        assertTrue(ServerAddress.isOnServer(server, "http://192.168.1.50:8090/video/42"));
        assertTrue(ServerAddress.isOnServer(server, "HTTP://192.168.1.50:8090/"));
        assertFalse(ServerAddress.isOnServer(server, "http://192.168.1.50:9000/"));
        assertFalse(ServerAddress.isOnServer(server, "https://192.168.1.50:8090/"));
        assertFalse(ServerAddress.isOnServer(server, "https://www.youtube.com/watch?v=x"));
        assertFalse(ServerAddress.isOnServer(server, "mailto:mario@example.org"));
        assertFalse(ServerAddress.isOnServer(server, "not an address"));

        assertTrue(ServerAddress.isOnServer("https://video.example.org", "https://video.example.org:443/x"));
        assertTrue(ServerAddress.isOnServer("http://casa", "http://casa:80/x"));
    }

    @Test
    public void isHealthyRecognisesFranzPLAY() {
        assertTrue(ServerAddress.isHealthy("{\"status\":\"ok\",\"version\":\"v1.0\"}\n"));
        assertTrue(ServerAddress.isHealthy("{ \"status\" : \"ok\" }"));
        assertFalse(ServerAddress.isHealthy("<html>router login</html>"));
        assertFalse(ServerAddress.isHealthy("{\"status\":\"down\"}"));
        assertFalse(ServerAddress.isHealthy(""));
        assertFalse(ServerAddress.isHealthy(null));
    }
}
