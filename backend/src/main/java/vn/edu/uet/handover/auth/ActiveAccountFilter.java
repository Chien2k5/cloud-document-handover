package vn.edu.uet.handover.auth;

import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import org.springframework.dao.DataAccessException;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.web.authentication.logout.CookieClearingLogoutHandler;
import org.springframework.security.web.authentication.logout.SecurityContextLogoutHandler;
import org.springframework.web.filter.OncePerRequestFilter;
import vn.edu.uet.handover.common.ApiError;
import vn.edu.uet.handover.common.RequestIdFilter;

/** Runs only inside the security chain, after the persisted context is loaded. */
public class ActiveAccountFilter extends OncePerRequestFilter {
    private final UserRepository users;
    private final ObjectMapper json;
    private final SecurityContextLogoutHandler logout = new SecurityContextLogoutHandler();
    private final CookieClearingLogoutHandler cookies = new CookieClearingLogoutHandler("JSESSIONID");

    public ActiveAccountFilter(UserRepository users, ObjectMapper json) {
        this.users = users;
        this.json = json;
    }

    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        // Public auth/bootstrap and logout must not depend on a DB account lookup.
        // Login still checks enabled through the authentication provider; logout
        // remains protected by Spring Security's CSRF handling.
        String path = request.getRequestURI().substring(request.getContextPath().length());
        return switch (path) {
            case "/api/v1/health", "/api/v1/auth/csrf", "/api/v1/auth/login", "/api/v1/auth/logout" -> true;
            default -> false;
        };
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
        if (authentication != null && authentication.getPrincipal() instanceof PortalUser user) {
            final boolean enabled;
            try {
                enabled = users.exists(user.id());
            } catch (DataAccessException e) {
                error(request, response, 503, "AUTH_UNAVAILABLE", "Account status temporarily unavailable");
                return; // Fail closed, preserve session so a transient DB failure can be retried.
            }
            if (!enabled) {
                logout.logout(request, response, authentication);
                cookies.logout(request, response, authentication);
                error(request, response, 401, "ACCOUNT_DISABLED", "Account disabled or no longer available");
                return;
            }
        }
        chain.doFilter(request, response);
    }

    private void error(HttpServletRequest request, HttpServletResponse response, int status, String code, String message) throws IOException {
        response.setStatus(status);
        response.setContentType("application/json");
        json.writeValue(response.getOutputStream(), new ApiError(code, message, RequestIdFilter.id(request)));
    }
}
