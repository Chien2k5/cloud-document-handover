package vn.edu.uet.handover.auth;

import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.header.HeaderWriterFilter;
import vn.edu.uet.handover.common.ApiError;
import vn.edu.uet.handover.common.RequestIdFilter;

@Configuration
public class SecurityConfig {
    private final ObjectMapper json;
    private final UserRepository users;
    public SecurityConfig(ObjectMapper json, UserRepository users) { this.json = json; this.users = users; }
    @Bean
    PasswordEncoder passwordEncoder() { return new BCryptPasswordEncoder(12); }
    @Bean
    SecurityFilterChain security(HttpSecurity http) throws Exception {
        http.addFilterAfter(new ActiveAccountFilter(users, json), HeaderWriterFilter.class);
        http.authorizeHttpRequests(auth -> auth
                .requestMatchers("/api/v1/health", "/api/v1/auth/csrf", "/api/v1/auth/login").permitAll()
                .anyRequest().authenticated());
        // Keep Spring Security's session CSRF protection, token rotation and session fixation protection.
        http.formLogin(form -> form.loginPage("/api/v1/auth/login").loginProcessingUrl("/api/v1/auth/login").usernameParameter("email")
                .successHandler((req, res, auth) -> {
                    res.setContentType("application/json");
                    json.writeValue(res.getOutputStream(), ((PortalUser) auth.getPrincipal()).view());
                })
                .failureHandler((req, res, e) -> error(req, res, 401, "INVALID_CREDENTIALS", "Invalid email or password")));
        http.logout(logout -> logout.logoutUrl("/api/v1/auth/logout").deleteCookies("JSESSIONID")
                .logoutSuccessHandler((req, res, auth) -> res.setStatus(204)));
        http.exceptionHandling(errors -> errors
                .authenticationEntryPoint((req, res, e) -> error(req, res, 401, "UNAUTHENTICATED", "Login required"))
                .accessDeniedHandler((req, res, e) -> error(req, res, 403, "ACCESS_DENIED", "Permission denied or invalid CSRF token")));
        http.requestCache(cache -> cache.disable());
        return http.build();
    }
    private void error(HttpServletRequest req, HttpServletResponse res, int status, String code, String message) throws IOException {
        res.setStatus(status);
        res.setContentType("application/json");
        json.writeValue(res.getOutputStream(), new ApiError(code, message, RequestIdFilter.id(req)));
    }
}
