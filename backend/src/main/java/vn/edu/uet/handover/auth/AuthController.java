package vn.edu.uet.handover.auth;

import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.web.csrf.CsrfToken;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/auth")
public class AuthController {
    private final RegistrationService registration;
    public AuthController(RegistrationService registration) { this.registration = registration; }

    @PostMapping(value="/register", consumes=MediaType.APPLICATION_JSON_VALUE, produces=MediaType.APPLICATION_JSON_VALUE)
    ResponseEntity<PortalUser.UserView> register(@Valid @RequestBody RegistrationRequest input) {
        return ResponseEntity.status(HttpStatus.CREATED).body(registration.register(input));
    }
    @GetMapping("/csrf")
    CsrfView csrf(CsrfToken token) { return new CsrfView(token.getHeaderName(), token.getToken()); }
    @GetMapping("/me")
    PortalUser.UserView me(@AuthenticationPrincipal PortalUser user) { return user.view(); }
    public record CsrfView(String headerName, String token) {}
}
