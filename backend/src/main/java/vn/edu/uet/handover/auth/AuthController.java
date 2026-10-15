package vn.edu.uet.handover.auth;

import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.web.csrf.CsrfToken;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/auth")
public class AuthController {
    @GetMapping("/csrf")
    CsrfView csrf(CsrfToken token) { return new CsrfView(token.getHeaderName(), token.getToken()); }
    @GetMapping("/me")
    PortalUser.UserView me(@AuthenticationPrincipal PortalUser user) { return user.view(); }
    public record CsrfView(String headerName, String token) {}
}
