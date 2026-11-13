package vn.edu.uet.handover.upload;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import java.net.URI;
import java.util.UUID;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;
import vn.edu.uet.handover.auth.PortalUser;
import vn.edu.uet.handover.common.RequestIdFilter;
import vn.edu.uet.handover.upload.UploadDtos.*;

@RestController
@RequestMapping("/api/v1/projects/{id}/files")
public class UploadController {
    private final UploadService service;
    public UploadController(UploadService service) { this.service=service; }
    @PostMapping(value="/uploads",consumes="application/json")
    ResponseEntity<UploadCreated> init(@PathVariable UUID id,@AuthenticationPrincipal PortalUser user,
            @Valid @RequestBody UploadRequest input,HttpServletRequest request) {
        UploadCreated result=service.init(id,user.id(),input,RequestIdFilter.id(request));
        return ResponseEntity.created(URI.create("/api/v1/projects/"+id+"/files/uploads/"+result.uploadId())).body(result);
    }
    @PostMapping(value="/uploads/{uploadId}/complete",consumes="application/json")
    UploadState complete(@PathVariable UUID id,@PathVariable UUID uploadId,@AuthenticationPrincipal PortalUser user,
            @Valid @RequestBody CompleteUpload input,HttpServletRequest request) {
        return service.complete(id,uploadId,user.id(),input.versionId(),RequestIdFilter.id(request));
    }
    @GetMapping("/uploads/{uploadId}")
    UploadState state(@PathVariable UUID id,@PathVariable UUID uploadId,@AuthenticationPrincipal PortalUser user) {
        return service.state(id,uploadId,user.id());
    }
    @GetMapping
    FilePage list(@PathVariable UUID id,@AuthenticationPrincipal PortalUser user,
            @RequestParam(defaultValue="0") int page,@RequestParam(defaultValue="20") int size) {
        return service.list(id,user.id(),page,size);
    }
    @GetMapping("/{fileVersionId}/download")
    Download download(@PathVariable UUID id,@PathVariable UUID fileVersionId,@AuthenticationPrincipal PortalUser user) {
        return service.download(id,fileVersionId,user.id());
    }
}
