package vn.edu.uet.handover.upload;

import com.fasterxml.jackson.core.JsonParser;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.net.URI;
import java.time.Clock;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.HashSet;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.function.Supplier;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import vn.edu.uet.handover.common.ApiException;
import vn.edu.uet.handover.project.ProjectDtos.ProjectView;
import vn.edu.uet.handover.project.ProjectRepository;
import vn.edu.uet.handover.project.ProjectService;
import vn.edu.uet.handover.upload.StoragePort.*;
import vn.edu.uet.handover.upload.UploadDtos.*;
import vn.edu.uet.handover.upload.UploadRepository.Session;

@Service
public class UploadService {
    private final UploadRepository uploads;
    private final ProjectRepository projects;
    private final ProjectService access;
    private final StoragePort storage;
    private final Clock clock;
    private final ObjectMapper json;
    private final TransactionTemplate tx;
    private final String bucket;
    private final long ttl;

    public UploadService(UploadRepository uploads, ProjectRepository projects, ProjectService access,
            StoragePort storage, Clock clock, ObjectMapper json, PlatformTransactionManager manager,
            @Value("${app.upload.bucket:}") String bucket, @Value("${app.upload.ttl-seconds:300}") long ttl) {
        if(ttl<1 || ttl>300) throw new IllegalArgumentException("Upload TTL must be 1..300 seconds");
        this.uploads=uploads; this.projects=projects; this.access=access; this.storage=storage;
        this.clock=clock; this.json=json.copy(); this.tx=new TransactionTemplate(manager); this.bucket=bucket; this.ttl=ttl;
        this.json.enable(JsonParser.Feature.STRICT_DUPLICATE_DETECTION);
        this.json.enable(DeserializationFeature.FAIL_ON_TRAILING_TOKENS);
    }

    public UploadCreated init(UUID project, UUID actor, UploadRequest input, String requestId) {
        // Validation here also protects service callers outside MVC.
        if(!Set.of("OWNER","EDITOR").contains(access.get(project,actor).role())) throw error(403,"UPLOAD_FORBIDDEN");
        if(input.size()==null || input.size()<1 || input.size()>104857600L || input.filename()==null || input.filename().isBlank()
                || input.filename().length()>255 || input.expectedSha256()==null || !input.expectedSha256().matches("[0-9a-f]{64}"))
            throw error(400,"VALIDATION_ERROR");
        try {
            MediaType type=MediaType.parseMediaType(input.contentType());
            if(type.isWildcardType() || type.isWildcardSubtype() || input.contentType().length()>255
                    || input.contentType().contains("\r") || input.contentType().contains("\n")) throw new IllegalArgumentException();
        } catch(IllegalArgumentException e) { throw error(400,"VALIDATION_ERROR"); }
        if(bucket.isBlank()) throw error(503,"STORAGE_UNAVAILABLE");
        Session session=tx.execute(status -> {
            ProjectView p=lock(project,actor,true);
            expireLocked(project);
            p=access.get(project,actor);
            if(input.size()>p.quotaBytes()-p.usedBytes()-p.reservedBytes()) throw error(409,"QUOTA_EXCEEDED");
            UUID file=input.fileId()==null?UUID.randomUUID():input.fileId();
            if(input.fileId()!=null) {
                String filename=uploads.filename(project,file).orElseThrow(()->error(404,"FILE_NOT_FOUND"));
                if(!filename.equals(input.filename())) throw error(409,"FILE_NAME_CONFLICT");
            }
            UUID version=UUID.randomUUID(), upload=UUID.randomUUID();
            // PostgreSQL timestamps use microseconds; truncate before persisting the deadline.
            Instant now=clock.instant().truncatedTo(java.time.temporal.ChronoUnit.MICROS);
            uploads.insert(project,actor,file,version,upload,input.fileId()==null,input,bucket,
                    "uploads/"+project+"/"+upload,now,now.plusSeconds(ttl));
            projects.audit(project,actor,"UPLOAD_INITIATED",version,requestId);
            return session(project,upload);
        });
        SignedRequest signed;
        try {
            signed=call(()->storage.presignPut(new PutSpec(session.bucket(),session.key(),input.contentType(),input.size(),session.expires())));
            validateSigned(signed,"PUT",session.expires());
            if(!input.contentType().equals(header(signed.requiredHeaders(),"Content-Type"))
                    || !"*".equals(header(signed.requiredHeaders(),"If-None-Match"))) throw error(503,"STORAGE_UNAVAILABLE");
        } catch(RuntimeException e) {
            tx.executeWithoutResult(status -> {
                projects.lock(project);
                Session current=session(project,session.id());
                if(pending(current)) uploads.transition(current,"FAILED",null,clock.instant());
            });
            throw e;
        }
        // Signing can outlive a reservation or membership. Never return an expired/freed URL.
        tx.executeWithoutResult(status -> {
            lock(project,actor,true);
            Session current=session(project,session.id());
            if(!pending(current) || !clock.instant().isBefore(current.expires())) throw error(409,"UPLOAD_EXPIRED");
        });
        return new UploadCreated(session.id(),session.version().fileId(),session.version().id(),"PENDING","INTEGRITY_PENDING",
                new PresignedUpload("PUT",signed.url(),signed.requiredHeaders(),signed.expiresAt()));
    }

    private record Decision(Session session, String error) {}
    private Decision inspect(UUID project, UUID upload, UUID actor, String version) {
        lock(project,actor,true);
        Session s=session(project,upload);
        if(!s.actor().equals(actor)) throw error(403,"UPLOAD_OWNER_REQUIRED");
        if("AVAILABLE".equals(s.version().uploadStatus()))
            return new Decision(s,version.equals(s.version().versionId())?null:"UPLOAD_ALREADY_COMPLETED");
        if(pending(s) && !clock.instant().isBefore(s.expires())) {
            uploads.transition(s,"EXPIRED",null,clock.instant());
            s=session(project,upload);
        }
        if("EXPIRED".equals(s.version().uploadStatus())) return new Decision(s,"UPLOAD_EXPIRED");
        return new Decision(s,pending(s)?null:"UPLOAD_FAILED");
    }
    public UploadState complete(UUID project, UUID upload, UUID actor, String version, String requestId) {
        if(version==null || version.isBlank() || "null".equals(version)) throw error(400,"VALIDATION_ERROR");
        Decision first=tx.execute(status -> inspect(project,upload,actor,version));
        check(first);
        if(!pending(first.session())) return view(first.session());
        Session snapshot=first.session();
        ObjectRef ref=new ObjectRef(snapshot.bucket(),snapshot.key(),version);
        Optional<VersionHead> head=call(()->storage.headVersion(ref)); // no DB transaction during network I/O
        Decision result=tx.execute(status -> {
            Decision current=inspect(project,upload,actor,version);
            if(current.error()!=null || !pending(current.session())) return current;
            if(head.isEmpty()) return new Decision(current.session(),"OBJECT_NOT_READY");
            VersionHead h=head.get();
            if(!ref.equals(h.ref())) throw error(503,"STORAGE_UNAVAILABLE");
            if(h.deleteMarker()) return new Decision(current.session(),"OBJECT_NOT_READY");
            if(h.size()!=snapshot.version().size()
                    || !snapshot.version().contentType().equals(h.contentType())) {
                uploads.transition(current.session(),"FAILED",null,clock.instant());
                return new Decision(session(project,upload),"UPLOAD_OBJECT_INVALID");
            }
            uploads.transition(current.session(),"AVAILABLE",version,clock.instant());
            projects.audit(project,actor,"UPLOAD_COMPLETED",snapshot.version().id(),requestId);
            return new Decision(session(project,upload),null);
        });
        check(result); // HTTP conflicts are raised after committing expiry/failure and quota release.
        return view(result.session());
    }

    public UploadState state(UUID project, UUID upload, UUID actor) {
        Session s=tx.execute(status -> {
            lock(project,actor,false);
            Session current=session(project,upload);
            if(pending(current) && !clock.instant().isBefore(current.expires()))
                uploads.transition(current,"EXPIRED",null,clock.instant());
            return session(project,upload);
        });
        if(!"AVAILABLE".equals(s.version().uploadStatus()) || terminalIntegrity(s)) return view(s);
        Optional<byte[]> document=call(()->storage.readChecksum(s.ref()));
        if(document.isEmpty()) { access.get(project,actor); return view(session(project,upload)); }
        String hash=checksum(document.get(),s);
        return tx.execute(status -> {
            lock(project,actor,false);
            Session current=session(project,upload);
            if(!terminalIntegrity(current)) {
                String integrity=hash==null?"FAILED":hash.equals(current.version().expectedSha256())?"VERIFIED":"MISMATCH";
                uploads.integrity(current,integrity,hash);
            }
            return view(session(project,upload));
        });
    }

    private String checksum(byte[] bytes, Session s) {
        if(bytes.length>65536) return null;
        try {
            JsonNode n=json.readTree(bytes);
            Set<String> fields=new HashSet<>(); n.fieldNames().forEachRemaining(fields::add);
            if(!n.isObject() || !fields.equals(Set.of("schemaVersion","bucket","objectKey","versionId","size","status","actualSha256","errorCode","processedAt"))
                    || !n.path("schemaVersion").isIntegralNumber() || !n.path("schemaVersion").canConvertToInt() || n.path("schemaVersion").intValue()!=1
                    || !text(n,"bucket",s.bucket()) || !text(n,"objectKey",s.key()) || !text(n,"versionId",s.version().versionId())
                    || !n.path("size").isIntegralNumber() || !n.path("size").canConvertToLong() || n.path("size").longValue()!=s.version().size()
                    || !text(n,"status","SUCCEEDED") || !n.path("errorCode").isNull()
                    || !n.path("actualSha256").isTextual() || !n.path("actualSha256").asText().matches("[0-9a-f]{64}")
                    || !n.path("processedAt").isTextual()) return null;
            OffsetDateTime.parse(n.path("processedAt").textValue());
            return n.path("actualSha256").textValue();
        } catch(Exception e) { return null; }
    }
    private boolean text(JsonNode n,String key,String expected) { return n.path(key).isTextual() && expected.equals(n.path(key).textValue()); }

    public FilePage list(UUID project, UUID actor, int page, int size) {
        if(page<0 || size<1 || size>100) throw error(400,"VALIDATION_ERROR");
        return tx.execute(status -> { lock(project,actor,false); return new FilePage(uploads.list(project,page,size),page,size); });
    }
    public Download download(UUID project, UUID version, UUID actor) {
        Session s=downloadable(project,version,actor);
        Optional<VersionHead> head=call(()->storage.headVersion(s.ref()));
        if(head.isEmpty()) throw error(409,"OBJECT_NOT_READY");
        VersionHead h=head.get();
        if(!h.ref().equals(s.ref())) throw error(503,"STORAGE_UNAVAILABLE");
        if(h.deleteMarker() || h.size()!=s.version().size() || !s.version().contentType().equals(h.contentType()))
            throw error(409,"UPLOAD_OBJECT_INVALID");
        Instant until=clock.instant().plusSeconds(ttl);
        SignedRequest signed=call(()->storage.presignGet(s.ref(),until));
        validateSigned(signed,"GET",until);
        downloadable(project,version,actor); // recheck permissions after storage calls
        return new Download(signed.url(),s.version().versionId(),signed.expiresAt());
    }
    private Session downloadable(UUID project, UUID version, UUID actor) {
        return tx.execute(status -> {
            lock(project,actor,false);
            Session s=uploads.byVersion(project,version).orElseThrow(()->error(404,"FILE_NOT_FOUND"));
            if(!"AVAILABLE".equals(s.version().uploadStatus()) || !"VERIFIED".equals(s.version().integrityStatus())) throw error(409,"FILE_NOT_VERIFIED");
            return s;
        });
    }

    @Scheduled(fixedDelayString="${app.upload.expiry-delay-ms:30000}",initialDelayString="${app.upload.expiry-delay-ms:30000}")
    public void expire() {
        for(UUID project:uploads.expiredProjects(clock.instant(),20))
            tx.executeWithoutResult(status -> { projects.lock(project); expireLocked(project); });
    }
    private void expireLocked(UUID project) {
        for(Session s:uploads.expired(project,clock.instant(),100)) uploads.transition(s,"EXPIRED",null,clock.instant());
    }
    private ProjectView lock(UUID project, UUID actor, boolean write) {
        access.get(project,actor);
        projects.lock(project);
        ProjectView p=access.get(project,actor);
        if(write && !Set.of("OWNER","EDITOR").contains(p.role())) throw error(403,"UPLOAD_FORBIDDEN");
        return p;
    }
    private Session session(UUID project, UUID upload) { return uploads.session(project,upload).orElseThrow(()->error(404,"UPLOAD_NOT_FOUND")); }
    private boolean pending(Session s) { return "PENDING".equals(s.version().uploadStatus()); }
    private boolean terminalIntegrity(Session s) { return Set.of("VERIFIED","MISMATCH").contains(s.version().integrityStatus()); }
    private UploadState view(Session s) { return new UploadState(s.id(),s.version(),s.expires()); }
    private void check(Decision decision) { if(decision.error()!=null) throw error(409,decision.error()); }
    private <T> T call(Supplier<T> operation) {
        try { return operation.get(); } catch(StoragePort.Unavailable e) { throw error(503,"STORAGE_UNAVAILABLE"); }
    }
    private String header(Map<String,String> headers,String name) {
        return headers.entrySet().stream().filter(e->e.getKey().equalsIgnoreCase(name)).map(Map.Entry::getValue).findFirst().orElse(null);
    }
    private void validateSigned(SignedRequest s,String method,Instant until) {
        if(s==null || !method.equals(s.method()) || s.url()==null || s.requiredHeaders()==null || s.expiresAt()==null
                || !clock.instant().isBefore(s.expiresAt()) || s.expiresAt().isAfter(until)) throw error(503,"STORAGE_UNAVAILABLE");
        try { URI uri=URI.create(s.url()); if(!"https".equals(uri.getScheme()) || uri.getHost()==null) throw new IllegalArgumentException(); }
        catch(IllegalArgumentException e) { throw error(503,"STORAGE_UNAVAILABLE"); }
    }
    private static ApiException error(int status,String code) { return new ApiException(HttpStatus.valueOf(status),code,code.replace('_',' ')); }
}
