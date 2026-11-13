package vn.edu.uet.handover.auth;

import java.util.Locale;
import java.util.Optional;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.security.core.userdetails.UsernameNotFoundException;
import org.springframework.stereotype.Repository;

@Repository
public class UserRepository implements UserDetailsService {
    private final JdbcTemplate jdbc;
    public UserRepository(JdbcTemplate jdbc) { this.jdbc = jdbc; }
    @Override
    public UserDetails loadUserByUsername(String email) {
        return jdbc.query("SELECT id,email,display_name,password_hash,enabled FROM app_users WHERE email = ?",
                (rs, n) -> new PortalUser(rs.getObject("id", UUID.class), rs.getString("email"),
                        rs.getString("display_name"), rs.getString("password_hash"), rs.getBoolean("enabled")),
                email.trim().toLowerCase(Locale.ROOT)).stream().findFirst()
                .orElseThrow(() -> new UsernameNotFoundException("Invalid credentials"));
    }
    public boolean exists(UUID id) {
        return Boolean.TRUE.equals(jdbc.queryForObject("SELECT EXISTS(SELECT 1 FROM app_users WHERE id = ? AND enabled)", Boolean.class, id));
    }
    public boolean existsByEmail(String email) {
        return Boolean.TRUE.equals(jdbc.queryForObject("SELECT EXISTS(SELECT 1 FROM app_users WHERE email = ?)", Boolean.class, email));
    }
    /** Only the email constraint is suppressed; all unrelated database failures propagate. */
    public Optional<PortalUser.UserView> insertRegisteredUser(UUID id, String email, String displayName, String passwordHash) {
        return jdbc.query("INSERT INTO app_users(id,email,display_name,password_hash,enabled) VALUES (?,?,?,?,true) "
                        + "ON CONFLICT ON CONSTRAINT uq_user_email DO NOTHING RETURNING id,email,display_name",
                (rs,n) -> new PortalUser.UserView(rs.getObject("id",UUID.class),rs.getString("email"),rs.getString("display_name")),
                id,email,displayName,passwordHash).stream().findFirst();
    }

}
