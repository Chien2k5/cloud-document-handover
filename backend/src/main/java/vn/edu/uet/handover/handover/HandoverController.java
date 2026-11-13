package vn.edu.uet.handover.handover;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import java.net.URI;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;
import vn.edu.uet.handover.auth.PortalUser;
import vn.edu.uet.handover.common.ApiException;
import vn.edu.uet.handover.common.RequestIdFilter;
import vn.edu.uet.handover.handover.HandoverDtos.*;
import vn.edu.uet.handover.upload.UploadDtos.Download;

@RestController
@RequestMapping("/api/v1")
public class HandoverController {
    private final HandoverService service;
    public HandoverController(HandoverService service) {this.service=service;}
    @PostMapping(value="/projects/{id}/handovers",consumes="application/json")
    ResponseEntity<Handover> create(@PathVariable UUID id,@AuthenticationPrincipal PortalUser user,
            @Valid @RequestBody CreateHandover input,HttpServletRequest request) {
        Handover h=service.create(id,user.id(),input,RequestIdFilter.id(request));
        return ResponseEntity.created(URI.create("/api/v1/handovers/"+h.id())).body(h);
    }
    @GetMapping("/handovers/{handoverId}")
    Handover get(@PathVariable UUID handoverId,@AuthenticationPrincipal PortalUser user) {return service.get(handoverId,user.id());}
    @PostMapping("/handovers/{handoverId}/publish")
    Handover publish(@PathVariable UUID handoverId,@AuthenticationPrincipal PortalUser user,@RequestBody(required=false) byte[] body,HttpServletRequest request) {
        noBody(body);return service.publish(handoverId,user.id(),RequestIdFilter.id(request));
    }
    @PostMapping("/handovers/{handoverId}/confirm")
    Confirmation confirm(@PathVariable UUID handoverId,@AuthenticationPrincipal PortalUser user,@RequestBody(required=false) byte[] body,HttpServletRequest request) {
        noBody(body);return service.confirm(handoverId,user.id(),RequestIdFilter.id(request));
    }
    @GetMapping("/handovers/{handoverId}/items/{fileVersionId}/download")
    Download download(@PathVariable UUID handoverId,@PathVariable UUID fileVersionId,@AuthenticationPrincipal PortalUser user) {return service.download(handoverId,fileVersionId,user.id());}
    @PostMapping("/handovers/{handoverId}/revoke")
    Handover revoke(@PathVariable UUID handoverId,@AuthenticationPrincipal PortalUser user,@RequestBody(required=false) byte[] body,HttpServletRequest request) {
        noBody(body);return service.revoke(handoverId,user.id(),RequestIdFilter.id(request));
    }
    private void noBody(byte[] body) {if(body!=null && body.length>0) throw new ApiException(HttpStatus.BAD_REQUEST,"VALIDATION_ERROR","This operation accepts no request body");}
}
