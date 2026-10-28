package vn.edu.uet.handover.upload;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import vn.edu.uet.handover.upload.UploadDtos.*;

@Repository
public class UploadRepository {
    private final JdbcTemplate jdbc;
    public UploadRepository(JdbcTemplate jdbc) { this.jdbc=jdbc; }
    public record Session(UUID id, UUID project, UUID actor, String bucket, String key, Instant expires,
                          FileVersion version) {
        StoragePort.ObjectRef ref() { return new StoragePort.ObjectRef(bucket,key,version.versionId()); }
    }
    private static final String SELECT="SELECT s.id AS upload_id,s.initiated_by,s.expires_at,v.*,f.filename "
        +"FROM upload_sessions s JOIN file_versions v ON v.id=s.file_version_id JOIN file_metadata f ON f.id=v.file_id ";
    public Optional<Session> session(UUID project, UUID upload) {
        return jdbc.query(SELECT+"WHERE s.project_id=? AND s.id=?",this::map,project,upload).stream().findFirst();
    }
    public Optional<Session> byVersion(UUID project, UUID version) {
        return jdbc.query(SELECT+"WHERE s.project_id=? AND v.id=?",this::map,project,version).stream().findFirst();
    }
    public List<FileVersion> list(UUID project, int page, int size) {
        return jdbc.query(SELECT+"WHERE v.project_id=? ORDER BY v.created_at,v.id LIMIT ? OFFSET ?",this::map,
                project,size,(long)page*size).stream().map(Session::version).toList();
    }
    public Optional<String> filename(UUID project, UUID file) {
        return jdbc.query("SELECT filename FROM file_metadata WHERE project_id=? AND id=?",(r,n)->r.getString(1),project,file).stream().findFirst();
    }
    public void insert(UUID project, UUID actor, UUID file, UUID version, UUID upload, boolean newFile,
                       UploadRequest input, String bucket, String key, Instant now, Instant expires) {
        if(newFile) jdbc.update("INSERT INTO file_metadata(id,project_id,filename,created_by) VALUES (?,?,?,?)",file,project,input.filename(),actor);
        jdbc.update("INSERT INTO file_versions(id,file_id,project_id,bucket,object_key,content_type,size_bytes,expected_sha256,created_by) VALUES (?,?,?,?,?,?,?,?,?)",
                version,file,project,bucket,key,input.contentType(),input.size(),input.expectedSha256(),actor);
        jdbc.update("INSERT INTO upload_sessions(id,project_id,file_version_id,initiated_by,reserved_bytes,created_at,expires_at) VALUES (?,?,?,?,?,?,?)",
                upload,project,version,actor,input.size(),Timestamp.from(now),Timestamp.from(expires));
        jdbc.update("UPDATE projects SET reserved_bytes=reserved_bytes+? WHERE id=?",input.size(),project);
    }
    /** Caller holds the project lock; every state/counter writer uses that same lock. */
    public void transition(Session s, String target, String version, Instant now) {
        if(jdbc.update("UPDATE file_versions SET upload_status=?,s3_version_id=? WHERE id=? AND upload_status='PENDING'",target,version,s.version().id())!=1)
            throw new IllegalStateException("Concurrent transition without project lock");
        boolean available="AVAILABLE".equals(target);
        jdbc.update("UPDATE projects SET reserved_bytes=reserved_bytes-?,used_bytes=used_bytes+? WHERE id=?",
                s.version().size(),available?s.version().size():0,s.project());
        if(available) jdbc.update("UPDATE upload_sessions SET completed_at=? WHERE id=?",Timestamp.from(now),s.id());
    }
    public void integrity(Session s, String state, String hash) {
        jdbc.update("UPDATE file_versions SET integrity_status=?,actual_sha256=? WHERE id=? AND upload_status='AVAILABLE' AND integrity_status IN ('INTEGRITY_PENDING','FAILED')",
                state,hash,s.version().id());
    }
    public List<UUID> expiredProjects(Instant now, int limit) {
        return jdbc.query("SELECT DISTINCT s.project_id FROM upload_sessions s JOIN file_versions v ON v.id=s.file_version_id WHERE v.upload_status='PENDING' AND s.expires_at<=? ORDER BY s.project_id LIMIT ?",
                (r,n)->r.getObject(1,UUID.class),Timestamp.from(now),limit);
    }
    public List<Session> expired(UUID project, Instant now, int limit) {
        return jdbc.query(SELECT+"WHERE s.project_id=? AND v.upload_status='PENDING' AND s.expires_at<=? ORDER BY s.expires_at,s.id LIMIT ?",
                this::map,project,Timestamp.from(now),limit);
    }
    private Session map(ResultSet r,int n) throws SQLException {
        return new Session(r.getObject("upload_id",UUID.class),r.getObject("project_id",UUID.class),r.getObject("initiated_by",UUID.class),
            r.getString("bucket"),r.getString("object_key"),r.getTimestamp("expires_at").toInstant(),
            new FileVersion(r.getObject("id",UUID.class),r.getObject("file_id",UUID.class),r.getString("filename"),r.getString("content_type"),r.getLong("size_bytes"),
                r.getString("s3_version_id"),r.getString("expected_sha256"),r.getString("actual_sha256"),r.getString("upload_status"),r.getString("integrity_status")));
    }
}
