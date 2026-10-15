package vn.edu.uet.handover.project;

import java.util.List;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import vn.edu.uet.handover.auth.UserRepository;
import vn.edu.uet.handover.common.ApiException;
import vn.edu.uet.handover.project.ProjectDtos.*;

@Service
@Transactional(readOnly=true)
public class ProjectService {
    private final ProjectRepository projects;
    private final UserRepository users;
    private final long quota;
    public ProjectService(ProjectRepository projects, UserRepository users, @Value("${app.project-quota-bytes}") long quota) {
        if (quota <= 0) throw new IllegalArgumentException("PROJECT_QUOTA_BYTES must be positive");
        this.projects=projects; this.users=users; this.quota=quota;
    }
    public ProjectView get(UUID id, UUID actor) {
        return projects.findVisible(id,actor).orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND,"PROJECT_NOT_FOUND","Project not found"));
    }
    public ProjectPage list(UUID actor, int page, int size) {
        if (page < 0 || size < 1 || size > 100) throw new ApiException(HttpStatus.BAD_REQUEST,"VALIDATION_ERROR","page >= 0 and size 1..100 required");
        return new ProjectPage(projects.list(actor,page,size),page,size);
    }
    @Transactional
    public ProjectView create(UUID actor, CreateProject input, String requestId) {
        UUID id=UUID.randomUUID();
        projects.create(id,input.name().trim(),input.description()==null ? "" : input.description().trim(),actor,quota);
        projects.audit(id,actor,"PROJECT_CREATED",id,requestId);
        return get(id,actor);
    }
    public List<MemberView> members(UUID id, UUID actor) { get(id,actor); return projects.members(id); }
    private void requireOwner(UUID id, UUID actor) {
        if (!"OWNER".equals(get(id,actor).role())) throw new ApiException(HttpStatus.FORBIDDEN,"OWNER_REQUIRED","Project owner required");
    }
    private void protectOwner(UUID id, UUID target) {
        if (projects.isOwner(id,target)) throw new ApiException(HttpStatus.CONFLICT,"OWNER_IMMUTABLE","Ownership transfer is not supported in week 1");
    }
    @Transactional
    public MemberView put(UUID id, UUID actor, UUID target, SetMember input, String requestId) {
        requireOwner(id,actor);
        projects.lock(id);
        protectOwner(id,target);
        if (!users.exists(target)) throw new ApiException(HttpStatus.NOT_FOUND,"USER_NOT_FOUND","User not found");
        projects.putMember(id,target,input.role());
        projects.audit(id,actor,"MEMBER_ROLE_SET",target,requestId);
        return projects.members(id).stream().filter(m -> m.userId().equals(target)).findFirst().orElseThrow();
    }
    @Transactional
    public void delete(UUID id, UUID actor, UUID target, String requestId) {
        requireOwner(id,actor);
        projects.lock(id);
        protectOwner(id,target);
        if (projects.deleteMember(id,target)==0) throw new ApiException(HttpStatus.NOT_FOUND,"MEMBER_NOT_FOUND","Member not found");
        projects.audit(id,actor,"MEMBER_REMOVED",target,requestId);
    }
}
