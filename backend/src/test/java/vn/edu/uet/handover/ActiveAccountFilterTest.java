package vn.edu.uet.handover;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicBoolean;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DataAccessResourceFailureException;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import vn.edu.uet.handover.auth.ActiveAccountFilter;
import vn.edu.uet.handover.auth.PortalUser;
import vn.edu.uet.handover.auth.UserRepository;
import vn.edu.uet.handover.common.RequestIdFilter;

class ActiveAccountFilterTest {
    @AfterEach void clearContext() { SecurityContextHolder.clearContext(); }

    @Test void databaseOutageFailsClosedWithoutDestroyingSession() throws Exception {
        UserRepository users=mock(UserRepository.class);
        UUID id=UUID.randomUUID();
        when(users.exists(id)).thenThrow(new DataAccessResourceFailureException("offline"));
        var user=new PortalUser(id,"user@example.test","User","unused",true);
        var context=SecurityContextHolder.createEmptyContext();
        context.setAuthentication(UsernamePasswordAuthenticationToken.authenticated(user,null,List.of()));
        SecurityContextHolder.setContext(context);
        var request=new MockHttpServletRequest("GET","/api/v1/auth/me");
        request.setAttribute(RequestIdFilter.ATTRIBUTE,UUID.randomUUID().toString());
        var session=(MockHttpSession)request.getSession();
        var response=new MockHttpServletResponse();
        var invoked=new AtomicBoolean();
        new ActiveAccountFilter(users,new ObjectMapper()).doFilter(request,response,(req,res) -> invoked.set(true));
        assertThat(invoked).isFalse();
        assertThat(response.getStatus()).isEqualTo(503);
        assertThat(new ObjectMapper().readTree(response.getContentAsString()).get("code").asText()).isEqualTo("AUTH_UNAVAILABLE");
        assertThat(session.isInvalid()).isFalse();
    }

    @Test void anonymousRequestDoesNotLookupAnAccount() throws Exception {
        UserRepository users=mock(UserRepository.class);
        var invoked=new AtomicBoolean();
        new ActiveAccountFilter(users,new ObjectMapper()).doFilter(
                new MockHttpServletRequest("GET","/api/v1/auth/csrf"),new MockHttpServletResponse(),
                (req,res) -> invoked.set(true));
        assertThat(invoked).isTrue();
        verifyNoInteractions(users);
    }
    @Test void publicEndpointsAndLogoutBypassLookupEvenWithAnExistingPrincipal() throws Exception {
        UserRepository users=mock(UserRepository.class);
        var user=new PortalUser(UUID.randomUUID(),"user@example.test","User","unused",true);
        var context=SecurityContextHolder.createEmptyContext();
        context.setAuthentication(UsernamePasswordAuthenticationToken.authenticated(user,null,List.of()));
        SecurityContextHolder.setContext(context);
        for (String path:new String[]{"/api/v1/health","/api/v1/auth/csrf","/api/v1/auth/login","/api/v1/auth/logout"}) {
            var invoked=new AtomicBoolean();
            new ActiveAccountFilter(users,new ObjectMapper()).doFilter(
                    new MockHttpServletRequest(path.endsWith("login") || path.endsWith("logout") ? "POST" : "GET",path),
                    new MockHttpServletResponse(),(req,res) -> invoked.set(true));
            assertThat(invoked).as(path).isTrue();
        }
        verifyNoInteractions(users);
    }
}
