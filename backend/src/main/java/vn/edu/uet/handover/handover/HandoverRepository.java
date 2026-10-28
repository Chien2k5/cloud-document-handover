package vn.edu.uet.handover.handover;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import vn.edu.uet.handover.handover.HandoverDtos.*;
import vn.edu.uet.handover.upload.StoragePort.ObjectRef;

@Repository
public class HandoverRepository {
    private final JdbcTemplate jdbc;
    public HandoverRepository(JdbcTemplate jdbc) { this.jdbc=jdbc; }
    public record Header(UUID id,UUID project,String title,String status,String access,Instant expires) {}
    public record Version(UUID id,String filename,ObjectRef ref,long size,String contentType,
                          String expectedSha256,String uploadStatus,String integrityStatus) {
        Item item() { return new Item(id,filename,ref.versionId(),expectedSha256); }
    }
    public Optional<Header> header(UUID id) {
        return jdbc.query("SELECT * FROM handovers WHERE id=?",(r,n)->new Header(r.getObject("id",UUID.class),
                r.getObject("project_id",UUID.class),r.getString("title"),r.getString("status"),r.getString("access_status"),r.getTimestamp("expires_at").toInstant()),id).stream().findFirst();
    }
    public void lock(UUID id) { jdbc.queryForObject("SELECT id FROM handovers WHERE id=? FOR UPDATE",UUID.class,id); }
    private static final String VERSIONS="SELECT v.*,f.filename FROM file_versions v JOIN file_metadata f ON f.id=v.file_id ";
    private final org.springframework.jdbc.core.RowMapper<Version> mapVersion=(r,n)->new Version(r.getObject("id",UUID.class),r.getString("filename"),
            new ObjectRef(r.getString("bucket"),r.getString("object_key"),r.getString("s3_version_id")),r.getLong("size_bytes"),
            r.getString("content_type"),r.getString("expected_sha256"),r.getString("upload_status"),r.getString("integrity_status"));
    public Optional<Version> version(UUID project,UUID id) {
        return jdbc.query(VERSIONS+"WHERE v.project_id=? AND v.id=?",mapVersion,project,id).stream().findFirst();
    }
    public List<Version> versions(UUID handover) {
        return jdbc.query(VERSIONS+"JOIN handover_items i ON i.file_version_id=v.id AND i.project_id=v.project_id WHERE i.handover_id=? ORDER BY v.id",mapVersion,handover);
    }
    public List<Recipient> recipients(UUID handover) {
        return jdbc.query("SELECT * FROM handover_recipients WHERE handover_id=? ORDER BY user_id",(r,n)->
                new Recipient(r.getObject("user_id",UUID.class),r.getString("access_status"),r.getTimestamp("confirmed_at")==null?null:r.getTimestamp("confirmed_at").toInstant()),handover);
    }
    public Handover view(Header h) { return new Handover(h.id(),h.project(),h.title(),h.status(),h.access(),h.expires(),versions(h.id()).stream().map(Version::item).toList(),recipients(h.id())); }
    public void create(UUID id,UUID project,UUID actor,CreateHandover input,Instant now,Instant expires) {
        jdbc.update("INSERT INTO handovers(id,project_id,title,created_by,created_at,expires_at) VALUES (?,?,?,?,?,?)",
                id,project,input.title().trim(),actor,Timestamp.from(now),Timestamp.from(expires));
        for(UUID version:input.fileVersionIds()) jdbc.update("INSERT INTO handover_items(handover_id,project_id,file_version_id) VALUES (?,?,?)",id,project,version);
        for(UUID recipient:input.recipientUserIds()) jdbc.update("INSERT INTO handover_recipients(handover_id,user_id) VALUES (?,?)",id,recipient);
    }
    public void publish(UUID id,Instant now) { jdbc.update("UPDATE handovers SET status='READY',published_at=? WHERE id=? AND status='DRAFT'",Timestamp.from(now),id); }
    public void confirm(UUID id,UUID actor,Instant now) { jdbc.update("UPDATE handover_recipients SET confirmed_at=? WHERE handover_id=? AND user_id=? AND confirmed_at IS NULL",Timestamp.from(now),id,actor); }
    public void confirmed(UUID id) { jdbc.update("UPDATE handovers SET status='CONFIRMED' WHERE id=? AND status='READY'",id); }
    public void revoke(UUID id) { jdbc.update("UPDATE handovers SET access_status='REVOKED' WHERE id=? AND access_status='ACTIVE'",id); }
}
