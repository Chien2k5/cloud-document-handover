package vn.edu.uet.handover.project;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import java.net.URI;
import java.util.List;
import java.util.UUID;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;
import vn.edu.uet.handover.auth.PortalUser;
import vn.edu.uet.handover.common.RequestIdFilter;
import vn.edu.uet.handover.project.ProjectDtos.*;

@RestController
@RequestMapping("/api/v1/projects")
public class ProjectController {
    private final ProjectService service;
    public ProjectController(ProjectService service) { this.service=service; }
    @PostMapping
    ResponseEntity<ProjectView> create(@AuthenticationPrincipal PortalUser user, @Valid @RequestBody CreateProject input, HttpServletRequest request) {
        var project=service.create(user.id(),input,RequestIdFilter.id(request));
        return ResponseEntity.created(URI.create("/api/v1/projects/"+project.id())).body(project);
    }
    @GetMapping
    ProjectPage list(@AuthenticationPrincipal PortalUser user, @RequestParam(defaultValue="0") int page, @RequestParam(defaultValue="20") int size) {
        return service.list(user.id(),page,size);
    }
    @GetMapping("/{id}")
    ProjectView get(@PathVariable UUID id, @AuthenticationPrincipal PortalUser user) { return service.get(id,user.id()); }
    @GetMapping("/{id}/members")
    List<MemberView> members(@PathVariable UUID id, @AuthenticationPrincipal PortalUser user) { return service.members(id,user.id()); }
    @PutMapping("/{id}/members/{userId}")
    MemberView put(@PathVariable UUID id, @PathVariable UUID userId, @AuthenticationPrincipal PortalUser user,
                   @Valid @RequestBody SetMember input, HttpServletRequest request) {
        return service.put(id,user.id(),userId,input,RequestIdFilter.id(request));
    }
    @DeleteMapping("/{id}/members/{userId}")
    ResponseEntity<Void> delete(@PathVariable UUID id, @PathVariable UUID userId, @AuthenticationPrincipal PortalUser user, HttpServletRequest request) {
        service.delete(id,user.id(),userId,RequestIdFilter.id(request));
        return ResponseEntity.noContent().build();
    }
}
