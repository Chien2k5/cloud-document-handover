package vn.edu.uet.handover.auth;

import java.util.UUID;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.context.annotation.Profile;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Component;

@Component
@Profile("local")
public class LocalDemoUsers implements ApplicationRunner {
    private final JdbcTemplate jdbc;
    private final PasswordEncoder encoder;
    private final String password;
    public LocalDemoUsers(JdbcTemplate jdbc, PasswordEncoder encoder, @Value("${LOCAL_DEMO_PASSWORD:}") String password) {
        this.jdbc = jdbc; this.encoder = encoder; this.password = password;
    }
    @Override
    public void run(ApplicationArguments args) {
        if (password.isBlank()) return;
        if (password.length() < 12 || password.getBytes(java.nio.charset.StandardCharsets.UTF_8).length > 72)
            throw new IllegalArgumentException("LOCAL_DEMO_PASSWORD must be 12+ characters and at most 72 UTF-8 bytes");
        String hash = encoder.encode(password);
        for (String name : new String[]{"dung", "editor", "viewer", "outsider"}) {
            jdbc.update("INSERT INTO app_users(id,email,display_name,password_hash) VALUES (?,?,?,?) ON CONFLICT (email) DO NOTHING",
                    UUID.randomUUID(), name + "@example.test", name, hash);
        }
    }
}
