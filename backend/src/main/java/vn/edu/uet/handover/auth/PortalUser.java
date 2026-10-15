package vn.edu.uet.handover.auth;

import java.util.List;
import java.util.UUID;
import org.springframework.security.core.userdetails.User;

public class PortalUser extends User {
    private final UUID id;
    private final String displayName;
    public PortalUser(UUID id, String email, String displayName, String passwordHash, boolean enabled) {
        super(email, passwordHash, enabled, true, true, true, List.of());
        this.id = id;
        this.displayName = displayName;
    }
    public UUID id() { return id; }
    public UserView view() { return new UserView(id, getUsername(), displayName); }
    public record UserView(UUID id, String email, String displayName) {}
}
