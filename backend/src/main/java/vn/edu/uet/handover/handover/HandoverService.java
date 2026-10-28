package vn.edu.uet.handover.handover;

import java.net.URI;
import java.time.Clock;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.HashSet;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.util.function.Supplier;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import vn.edu.uet.handover.auth.UserRepository;
import vn.edu.uet.handover.common.ApiException;
import vn.edu.uet.handover.project.ProjectRepository;
import vn.edu.uet.handover.handover.HandoverDtos.*;
import vn.edu.uet.handover.handover.HandoverRepository.*;
import vn.edu.uet.handover.upload.StoragePort;
import vn.edu.uet.handover.upload.StoragePort.*;
import vn.edu.uet.handover.upload.UploadDtos.Download;

@Service
public class HandoverService {
    private final HandoverRepository handovers;
    private final ProjectRepository projects;
    private final UserRepository users;
    private final StoragePort storage;
    private final Clock clock;
    private final TransactionTemplate tx;
    public HandoverService(HandoverRepository handovers,ProjectRepository projects,UserRepository users,
            StoragePort storage,Clock clock,PlatformTransactionManager manager) {
        this.handovers=handovers;this.projects=projects;this.users=users;this.storage=storage;this.clock=clock;this.tx=new TransactionTemplate(manager);
    }
    public Handover create(UUID project,UUID actor,CreateHandover input,String requestId) {
        return tx.execute(status -> {
            owner(project,actor);projects.lock(project);owner(project,actor);
            if(input.title()==null || input.title().isBlank() || input.title().length()>200 || input.expiresAt()==null
                    || !uniqueNonempty(input.fileVersionIds()) || !uniqueNonempty(input.recipientUserIds())) throw error(400,"VALIDATION_ERROR");
            Instant now=now(),expires=input.expiresAt().truncatedTo(ChronoUnit.MICROS);
            if(!expires.isAfter(now)) throw error(400,"VALIDATION_ERROR");
            for(UUID id:input.fileVersionIds()) {
                Version v=handovers.version(project,id).orElseThrow(()->error(404,"FILE_NOT_FOUND"));
                if(!available(v)) throw error(409,"FILE_NOT_AVAILABLE");
            }
            for(UUID recipient:input.recipientUserIds()) if(!users.exists(recipient)) throw error(404,"USER_NOT_FOUND");
            UUID id=UUID.randomUUID();handovers.create(id,project,actor,input,now,expires);
            projects.audit(project,actor,"HANDOVER_CREATED",id,requestId);
            return handovers.view(header(id));
        });
    }
    public Handover get(UUID id,UUID actor) {
        return tx.execute(status -> {
            Header h=lock(id);readable(h,actor,false);
            return handovers.view(h);
        });
    }
    private record Manifest(Header header,List<Version> versions,List<Recipient> recipients) {}
    public Handover publish(UUID id,UUID actor,String requestId) {
        Manifest snapshot=tx.execute(status -> publishable(id,actor));
        if(!"DRAFT".equals(snapshot.header().status())) return get(id,actor);
        // Network work happens with no database locks or transaction held.
        for(Version v:snapshot.versions()) head(v);
        return tx.execute(status -> {
            Manifest current=publishable(id,actor);
            if(!"DRAFT".equals(current.header().status())) return handovers.view(current.header());
            if(!snapshot.versions().equals(current.versions()) || !snapshot.recipients().equals(current.recipients())) throw error(409,"HANDOVER_CHANGED");
            handovers.publish(id,now());projects.audit(current.header().project(),actor,"HANDOVER_PUBLISHED",id,requestId);
            return handovers.view(header(id));
        });
    }
    private Manifest publishable(UUID id,UUID actor) {
        Header h=lock(id);owner(h.project(),actor);active(h);
        List<Version> versions=handovers.versions(id);List<Recipient> recipients=handovers.recipients(id);
        if("DRAFT".equals(h.status())) {
            if(versions.isEmpty() || recipients.isEmpty()) throw error(409,"HANDOVER_EMPTY");
            for(Version v:versions) if(!available(v) || !"VERIFIED".equals(v.integrityStatus())) throw error(409,"FILE_NOT_VERIFIED");
            for(Recipient r:recipients) if(!"ACTIVE".equals(r.accessStatus()) || !users.exists(r.userId())) throw error(409,"RECIPIENT_UNAVAILABLE");
        }
        return new Manifest(h,versions,recipients);
    }
    public Confirmation confirm(UUID id,UUID actor,String requestId) {
        return tx.execute(status -> {
            Header h=lock(id);
            Recipient recipient=recipient(id,actor).orElseThrow(()->error(404,"HANDOVER_NOT_FOUND"));
            active(h);published(h);
            if(recipient.confirmedAt()==null) {
                handovers.confirm(id,actor,now());projects.audit(h.project(),actor,"HANDOVER_CONFIRMED",id,requestId);
            }
            List<Recipient> all=handovers.recipients(id);
            if(all.stream().filter(r->"ACTIVE".equals(r.accessStatus())).allMatch(r->r.confirmedAt()!=null)) handovers.confirmed(id);
            return new Confirmation(id,actor,recipient(id,actor).orElseThrow().confirmedAt(),"CONFIRMED");
        });
    }
    public Handover revoke(UUID id,UUID actor,String requestId) {
        return tx.execute(status -> {
            Header h=lock(id);owner(h.project(),actor);
            if("ACTIVE".equals(h.access())) {
                handovers.revoke(id);projects.audit(h.project(),actor,"HANDOVER_REVOKED",id,requestId);
            }
            return handovers.view(header(id));
        });
    }
    private record Downloadable(Header header,Version version) {}
    public Download download(UUID id,UUID version,UUID actor) {
        Downloadable first=downloadable(id,version,actor);
        head(first.version());
        Downloadable current=downloadable(id,version,actor);
        if(!first.version().equals(current.version())) throw error(409,"HANDOVER_CHANGED");
        Instant until=clock.instant().plusSeconds(300);
        if(current.header().expires().isBefore(until)) until=current.header().expires();
        Instant deadline=until;
        SignedRequest signed=call(()->storage.presignGet(current.version().ref(),deadline));
        Downloadable last=downloadable(id,version,actor);
        if(!current.version().equals(last.version())) throw error(409,"HANDOVER_CHANGED");
        validateSigned(signed,deadline);
        return new Download(signed.url(),last.version().ref().versionId(),signed.expiresAt());
    }
    private Downloadable downloadable(UUID id,UUID version,UUID actor) {
        return tx.execute(status -> {
            Header h=lock(id);readable(h,actor,true);
            Version v=handovers.versions(id).stream().filter(item->item.id().equals(version)).findFirst().orElseThrow(()->error(404,"FILE_NOT_FOUND"));
            if(!available(v) || !"VERIFIED".equals(v.integrityStatus())) throw error(409,"FILE_NOT_VERIFIED");
            return new Downloadable(h,v);
        });
    }
    private void head(Version v) {
        Optional<VersionHead> result=call(()->storage.headVersion(v.ref()));
        if(result.isEmpty() || result.get().deleteMarker()) throw error(409,"OBJECT_NOT_READY");
        VersionHead h=result.get();
        if(!v.ref().equals(h.ref())) throw error(503,"STORAGE_UNAVAILABLE");
        if(v.size()!=h.size() || !v.contentType().equals(h.contentType())) throw error(409,"UPLOAD_OBJECT_INVALID");
    }
    private void validateSigned(SignedRequest signed,Instant deadline) {
        if(signed==null || !"GET".equals(signed.method()) || signed.url()==null || signed.expiresAt()==null
                || !clock.instant().isBefore(signed.expiresAt()) || signed.expiresAt().isAfter(deadline)) throw error(503,"STORAGE_UNAVAILABLE");
        try {URI uri=URI.create(signed.url());if(!"https".equals(uri.getScheme()) || uri.getHost()==null) throw new IllegalArgumentException();}
        catch(IllegalArgumentException e) {throw error(503,"STORAGE_UNAVAILABLE");}
    }
    private Header header(UUID id) { return handovers.header(id).orElseThrow(()->error(404,"HANDOVER_NOT_FOUND")); }
    private Header lock(UUID id) {
        Header h=header(id);projects.lock(h.project());handovers.lock(id);return header(id);
    }
    private void owner(UUID project,UUID actor) {
        var p=projects.findVisible(project,actor).orElseThrow(()->error(404,"HANDOVER_NOT_FOUND"));
        if(!"OWNER".equals(p.role())) throw error(403,"OWNER_REQUIRED");
    }
    private Optional<Recipient> recipient(UUID id,UUID actor) {
        return handovers.recipients(id).stream().filter(r->r.userId().equals(actor) && "ACTIVE".equals(r.accessStatus())).findFirst();
    }
    private void readable(Header h,UUID actor,boolean download) {
        boolean owner=projects.isOwner(h.project(),actor);
        if(!owner && recipient(h.id(),actor).isEmpty()) throw error(404,"HANDOVER_NOT_FOUND");
        if(!owner || download) {active(h);published(h);}
    }
    private void active(Header h) {
        if(!"ACTIVE".equals(h.access())) throw error(409,"HANDOVER_REVOKED");
        if(!clock.instant().isBefore(h.expires())) throw error(409,"HANDOVER_EXPIRED");
    }
    private void published(Header h) { if(!List.of("READY","CONFIRMED").contains(h.status())) throw error(409,"HANDOVER_NOT_READY"); }
    private boolean available(Version v) { return "AVAILABLE".equals(v.uploadStatus()) && v.ref().versionId()!=null && !v.ref().versionId().isBlank() && !"null".equals(v.ref().versionId()); }
    private boolean uniqueNonempty(List<UUID> values) { return values!=null && !values.isEmpty() && values.stream().noneMatch(java.util.Objects::isNull) && new HashSet<>(values).size()==values.size(); }
    private Instant now() { return clock.instant().truncatedTo(ChronoUnit.MICROS); }
    private <T> T call(Supplier<T> operation) { try{return operation.get();}catch(StoragePort.Unavailable e){throw error(503,"STORAGE_UNAVAILABLE");} }
    private static ApiException error(int status,String code) {return new ApiException(HttpStatus.valueOf(status),code,code.replace('_',' '));}
}
