package vn.edu.uet.handover.project;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import vn.edu.uet.handover.project.ProjectDtos.*;

@Repository
public class ProjectRepository {
    private final JdbcTemplate jdbc;
    private static final String VISIBLE = "SELECT p.*, m.role FROM projects p JOIN memberships m ON m.project_id=p.id WHERE m.user_id=?";
    public ProjectRepository(JdbcTemplate jdbc) { this.jdbc = jdbc; }
    public Optional<ProjectView> findVisible(UUID id, UUID actor) {
        return jdbc.query(VISIBLE + " AND p.id=?", this::mapProject, actor, id).stream().findFirst();
    }
    public List<ProjectView> list(UUID actor, int page, int size) {
        return jdbc.query(VISIBLE + " ORDER BY p.created_at,p.id LIMIT ? OFFSET ?", this::mapProject, actor, size, (long) page * size);
    }
    public void create(UUID id, String name, String description, UUID owner, long quota) {
        jdbc.update("INSERT INTO projects(id,name,description,created_by,quota_bytes) VALUES (?,?,?,?,?)", id, name, description, owner, quota);
        jdbc.update("INSERT INTO memberships(project_id,user_id,role) VALUES (?,?,'OWNER')", id, owner);
    }
    public void lock(UUID id) { jdbc.queryForObject("SELECT id FROM projects WHERE id=? FOR UPDATE", UUID.class, id); }
    public List<MemberView> members(UUID id) {
        return jdbc.query("SELECT m.user_id,u.display_name,m.role FROM memberships m JOIN app_users u ON u.id=m.user_id WHERE m.project_id=? ORDER BY m.created_at,m.user_id",
                (rs,n) -> new MemberView(rs.getObject("user_id", UUID.class), rs.getString("display_name"), rs.getString("role")), id);
    }
    public boolean isOwner(UUID id, UUID user) {
        return Boolean.TRUE.equals(jdbc.queryForObject("SELECT EXISTS(SELECT 1 FROM memberships WHERE project_id=? AND user_id=? AND role='OWNER')", Boolean.class, id, user));
    }
    public void putMember(UUID id, UUID user, String role) {
        jdbc.update("INSERT INTO memberships(project_id,user_id,role) VALUES (?,?,?) ON CONFLICT (project_id,user_id) DO UPDATE SET role=EXCLUDED.role", id,user,role);
    }
    public int deleteMember(UUID id, UUID user) { return jdbc.update("DELETE FROM memberships WHERE project_id=? AND user_id=?", id,user); }
    public void audit(UUID id, UUID actor, String action, UUID target, String requestId) {
        jdbc.update("INSERT INTO audit_events(id,project_id,actor_id,action,target_id,request_id) VALUES (?,?,?,?,?,?)",
                UUID.randomUUID(),id,actor,action,target,requestId);
    }
    private ProjectView mapProject(ResultSet rs, int n) throws SQLException {
        return new ProjectView(rs.getObject("id", UUID.class), rs.getString("name"), rs.getString("description"),
                rs.getLong("quota_bytes"),rs.getLong("used_bytes"),rs.getLong("reserved_bytes"),rs.getString("role"),rs.getTimestamp("created_at").toInstant());
    }
}
