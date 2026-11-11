package vn.edu.uet.handover;

import static org.assertj.core.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.LinkedHashSet;
import java.util.Locale;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Stream;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.MethodSource;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.autoconfigure.web.servlet.MockMvcPrint;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.security.core.context.SecurityContext;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.context.HttpSessionSecurityContextRepository;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import vn.edu.uet.handover.auth.PortalUser;
import vn.edu.uet.handover.auth.UserRepository;

/** Real PostgreSQL and full MockMvc security chain; CSRF comes from the actual public endpoint. */
@SpringBootTest(properties="app.upload.expiry-delay-ms=3600000")
@AutoConfigureMockMvc(print=MockMvcPrint.NONE)
@EnabledIfEnvironmentVariable(named="RUN_DB_TESTS",matches="true")
class RegistrationHttpIntegrationTest {
    static final String REGISTER="/api/v1/auth/register";
    static final String CONTEXT=HttpSessionSecurityContextRepository.SPRING_SECURITY_CONTEXT_KEY;
    @Autowired MockMvc mvc;
    @Autowired ObjectMapper json;
    @Autowired JdbcTemplate jdbc;
    @Autowired PasswordEncoder passwords;
    @Autowired UserRepository users;
    final Set<String> ownedEmails=new LinkedHashSet<>();
    String prefix;
    long projectsBefore,membershipsBefore;
    record Browser(MockHttpSession session,String header,String token) {}

    @BeforeEach void isolateTestUsers() {
        prefix="r03-"+UUID.randomUUID();ownedEmails.clear();
        projectsBefore=count("SELECT count(*) FROM projects");
        membershipsBefore=count("SELECT count(*) FROM memberships");
    }
    @AfterEach void verifyNoDefaultProjectOrMembershipAndCleanOwnedUsers() {
        try {
            assertThat(count("SELECT count(*) FROM projects")).isEqualTo(projectsBefore);
            assertThat(count("SELECT count(*) FROM memberships")).isEqualTo(membershipsBefore);
        } finally {
            for (String email:ownedEmails) jdbc.update("DELETE FROM app_users WHERE email = ?",email);
        }
    }
    long count(String sql,Object... args) { return jdbc.queryForObject(sql,Long.class,args); }
    String email(String suffix) {
        String value=prefix+"-"+suffix+"@example.test";ownedEmails.add(value);return value;
    }
    Browser csrf(MockHttpSession session) throws Exception {
        var request=get("/api/v1/auth/csrf");if (session!=null) request.session(session);
        MvcResult result=mvc.perform(request).andExpect(status().isOk()).andReturn();
        JsonNode value=json.readTree(result.getResponse().getContentAsString());
        assertThat(value.path("headerName").asText()).isNotBlank();assertThat(value.path("token").asText()).isNotBlank();
        var actual=(MockHttpSession)result.getRequest().getSession(false);assertThat(actual).isNotNull();
        return new Browser(actual,value.get("headerName").asText(),value.get("token").asText());
    }
    MockHttpServletRequestBuilder authorized(MockHttpServletRequestBuilder request,Browser browser) {
        return request.session(browser.session()).header(browser.header(),browser.token());
    }
    static ObjectNode template() {
        return new ObjectMapper().createObjectNode().put("displayName","  Nguyen Van A  ")
                .put("email","r03-invalid@example.test").put("password","HttpFixture123!").put("confirmPassword","HttpFixture123!");
    }
    MvcResult register(Browser browser,ObjectNode body,int expected) throws Exception {
        return mvc.perform(authorized(post(REGISTER),browser).contentType(MediaType.APPLICATION_JSON)
                .accept(MediaType.APPLICATION_JSON).content(json.writeValueAsBytes(body)))
                .andExpect(status().is(expected)).andReturn();
    }
    JsonNode error(MvcResult result,String code) throws Exception {
        JsonNode body=json.readTree(result.getResponse().getContentAsString());
        assertThat(body.properties()).extracting(java.util.Map.Entry::getKey).containsExactlyInAnyOrder("code","message","requestId");
        assertThat(body.path("code").asText()).isEqualTo(code);
        assertThat(body.path("message").asText()).isNotBlank();
        UUID.fromString(body.path("requestId").asText());
        assertThat(result.getResponse().getHeader("X-Request-Id")).isEqualTo(body.get("requestId").asText());
        assertThat(result.getResponse().getContentAsString()).doesNotContain("HttpFixture123!","LegacyFixture123!",
                "passwordHash","SQLException","org.postgresql","org.springframework","stackTrace","INSERT INTO");
        return body;
    }
    UUID seedExisting(String email) {
        UUID id=UUID.randomUUID();
        jdbc.update("INSERT INTO app_users(id,email,display_name,password_hash) VALUES (?,?,?,?)",
                id,email,"Existing account",passwords.encode("LegacyFixture123!"));return id;
    }
    Browser login(String email,String password) throws Exception {
        Browser before=csrf(null);
        String id=before.session().getId();
        MvcResult result=mvc.perform(authorized(post("/api/v1/auth/login"),before).contentType(MediaType.APPLICATION_FORM_URLENCODED)
                .param("email",email).param("password",password)).andExpect(status().isOk()).andReturn();
        var session=(MockHttpSession)result.getRequest().getSession(false);
        assertThat(session).isNotNull();assertThat(session.getId()).isNotEqualTo(id);
        return csrf(session);
    }

    @Test void anonymousRegistrationCreatesOneSafeAccountWithoutLoginThenTheNewAccountCanLoginAndLogout() throws Exception {
        String email=email("new");Browser browser=csrf(null);String sessionId=browser.session().getId();
        assertThat(browser.session().getAttribute(CONTEXT)).isNull();
        ObjectNode body=template().put("email"," "+email.toUpperCase(Locale.ROOT)+" ");
        MvcResult registered=register(browser,body,201);JsonNode view=json.readTree(registered.getResponse().getContentAsString());
        assertThat(view.properties()).extracting(java.util.Map.Entry::getKey).containsExactlyInAnyOrder("id","email","displayName");
        UUID id=UUID.fromString(view.get("id").asText());
        assertThat(view.get("email").asText()).isEqualTo(email);assertThat(view.get("displayName").asText()).isEqualTo("Nguyen Van A");
        PortalUser stored=(PortalUser)users.loadUserByUsername(email);assertThat(stored.id()).isEqualTo(id);
        assertThat(stored.isEnabled()).isTrue();assertThat(stored.getAuthorities()).isEmpty();
        assertThat(stored.getPassword()).matches("\\$2[aby]\\$12\\$.*");
        assertThat(passwords.matches("HttpFixture123!",stored.getPassword())).isTrue();
        assertThat(registered.getResponse().getContentAsString()).doesNotContain("HttpFixture123!",stored.getPassword(),"password","enabled","JSESSIONID","token");
        assertThat(count("SELECT count(*) FROM app_users WHERE email = ?",email)).isEqualTo(1);
        assertThat(count("SELECT count(*) FROM memberships WHERE user_id = ?",id)).isZero();
        assertThat(browser.session().getId()).isEqualTo(sessionId);assertThat(browser.session().getAttribute(CONTEXT)).isNull();
        error(mvc.perform(get("/api/v1/auth/me").session(browser.session())).andExpect(status().isUnauthorized()).andReturn(),"UNAUTHENTICATED");
        Browser loggedIn=login(email,"HttpFixture123!");
        mvc.perform(get("/api/v1/auth/me").session(loggedIn.session())).andExpect(status().isOk()).andExpect(jsonPath("$.id").value(id.toString()));
        mvc.perform(get("/api/v1/projects").session(loggedIn.session())).andExpect(status().isOk()).andExpect(jsonPath("$.items.length()").value(0));
        mvc.perform(authorized(post("/api/v1/auth/logout"),loggedIn)).andExpect(status().isNoContent());
        assertThat(loggedIn.session().isInvalid()).isTrue();
        mvc.perform(get("/api/v1/auth/me")).andExpect(status().isUnauthorized());
    }

    @ParameterizedTest(name="{index}") @ValueSource(booleans={false,true})
    void missingOrInvalidCsrfRejectsRegistrationWithoutCreatingAUser(boolean wrongToken) throws Exception {
        Browser browser=csrf(null);String email=email("csrf");long before=count("SELECT count(*) FROM app_users");
        var request=post(REGISTER).session(browser.session()).contentType(MediaType.APPLICATION_JSON).content(json.writeValueAsBytes(template().put("email",email)));
        if (wrongToken) request.header(browser.header(),"invalid-fixture-token");
        error(mvc.perform(request).andExpect(status().isForbidden()).andReturn(),"ACCESS_DENIED");
        assertThat(count("SELECT count(*) FROM app_users")).isEqualTo(before);
        assertThat(browser.session().getAttribute(CONTEXT)).isNull();csrf(browser.session());
    }

    static Stream<String> invalidBodies() throws Exception {
        ObjectMapper mapper=new ObjectMapper();var list=new java.util.ArrayList<String>();
        ObjectNode missing=template();missing.remove("email");list.add(mapper.writeValueAsString(missing));
        list.add("{}");list.add("null");list.add("");list.add("[]");list.add("{not-json");
        list.add(mapper.writeValueAsString(template().putNull("password")));
        list.add(mapper.writeValueAsString(template().put("password",123456789)));
        list.add(mapper.writeValueAsString(template().put("displayName",true)));
        list.add(mapper.writeValueAsString(template().put("role","OWNER")));
        list.add(mapper.writeValueAsString(template().put("email","not-an-email")));
        list.add(mapper.writeValueAsString(template().put("displayName","a".repeat(101))));
        list.add(mapper.writeValueAsString(template().put("password","short").put("confirmPassword","short")));
        list.add(mapper.writeValueAsString(template().put("password","á".repeat(36)+"a").put("confirmPassword","á".repeat(36)+"a")));
        list.add(mapper.writeValueAsString(template().put("confirmPassword","does-not-match")));
        return list.stream();
    }
    @ParameterizedTest(name="{index}") @MethodSource("invalidBodies")
    void representativeHttpValidationFailuresReturn400AndNeverWriteUsers(String body) throws Exception {
        String payload=body.replace("r03-invalid@example.test",email("invalid"));long before=count("SELECT count(*) FROM app_users");
        Browser browser=csrf(null);
        error(mvc.perform(authorized(post(REGISTER),browser).contentType(MediaType.APPLICATION_JSON).content(payload))
                .andExpect(status().isBadRequest()).andReturn(),"VALIDATION_ERROR");
        assertThat(count("SELECT count(*) FROM app_users")).isEqualTo(before);
    }

    @Test void duplicateEmailReturns409WithSafeErrorAndKeepsOldCredentialsUnchanged() throws Exception {
        String email=email("duplicate");UUID id=seedExisting(email);
        PortalUser before=(PortalUser)users.loadUserByUsername(email);
        MvcResult result=register(csrf(null),template().put("email"," "+email.toUpperCase(Locale.ROOT)+" "),409);
        error(result,"EMAIL_ALREADY_EXISTS");assertThat(result.getResponse().getContentAsString()).doesNotContain(email,before.getPassword());
        PortalUser after=(PortalUser)users.loadUserByUsername(email);
        assertThat(after.id()).isEqualTo(id);assertThat(after.view()).isEqualTo(before.view());assertThat(after.getPassword()).isEqualTo(before.getPassword());
        assertThat(passwords.matches("LegacyFixture123!",after.getPassword())).isTrue();assertThat(count("SELECT count(*) FROM app_users WHERE email = ?",email)).isEqualTo(1);
    }

    @ParameterizedTest(name="{index}")
    @ValueSource(strings={"text/plain","application/x-www-form-urlencoded","application/octet-stream"})
    void registrationRequiresJsonContentType(String contentType) throws Exception {
        Browser browser=csrf(null);long before=count("SELECT count(*) FROM app_users");
        error(mvc.perform(authorized(post(REGISTER),browser).contentType(contentType)
                .content(json.writeValueAsBytes(template().put("email",email("media")))))
                .andExpect(status().isUnsupportedMediaType()).andReturn(),"UNSUPPORTED_MEDIA_TYPE");
        assertThat(count("SELECT count(*) FROM app_users")).isEqualTo(before);
    }

    @ParameterizedTest(name="{index}")
    @ValueSource(strings={"/api/v1/auth/me","/api/v1/projects","/api/v1/projects/00000000-0000-0000-0000-000000000001/files","/api/v1/handovers/00000000-0000-0000-0000-000000000001"})
    void protectedEndpointsStillRejectAnonymousUsers(String path) throws Exception {
        error(mvc.perform(get(path)).andExpect(status().isUnauthorized()).andReturn(),"UNAUTHENTICATED");
    }

    @Test void existingLoginLogoutAndProjectCsrfProtectionAndSessionRotationAreUnchanged() throws Exception {
        String email=email("legacy");UUID id=seedExisting(email);Browser anonymous=csrf(null);String beforeId=anonymous.session().getId();
        error(mvc.perform(post("/api/v1/auth/login").session(anonymous.session()).param("email",email).param("password","LegacyFixture123!"))
                .andExpect(status().isForbidden()).andReturn(),"ACCESS_DENIED");
        error(mvc.perform(authorized(post("/api/v1/auth/login"),anonymous).param("email",email).param("password","wrong-fixture"))
                .andExpect(status().isUnauthorized()).andReturn(),"INVALID_CREDENTIALS");
        mvc.perform(authorized(post("/api/v1/auth/login"),anonymous).param("email",email).param("password","LegacyFixture123!")).andExpect(status().isOk());
        assertThat(anonymous.session().getId()).isNotEqualTo(beforeId);Browser current=csrf(anonymous.session());
        mvc.perform(get("/api/v1/auth/me").session(current.session())).andExpect(status().isOk()).andExpect(jsonPath("$.id").value(id.toString()));
        error(mvc.perform(post("/api/v1/projects").session(current.session()).contentType(MediaType.APPLICATION_JSON).content("{\"name\":\"blocked\"}"))
                .andExpect(status().isForbidden()).andReturn(),"ACCESS_DENIED");
        error(mvc.perform(post("/api/v1/projects").session(current.session()).header(anonymous.header(),anonymous.token()).contentType(MediaType.APPLICATION_JSON).content("{\"name\":\"blocked\"}"))
                .andExpect(status().isForbidden()).andReturn(),"ACCESS_DENIED");
        error(mvc.perform(authorized(post("/api/v1/projects"),current).contentType(MediaType.APPLICATION_JSON).content("{}"))
                .andExpect(status().isBadRequest()).andReturn(),"VALIDATION_ERROR");
        error(mvc.perform(post("/api/v1/auth/logout").session(current.session())).andExpect(status().isForbidden()).andReturn(),"ACCESS_DENIED");
        mvc.perform(get("/api/v1/auth/me").session(current.session())).andExpect(status().isOk());
        mvc.perform(authorized(post("/api/v1/auth/logout"),current)).andExpect(status().isNoContent());assertThat(current.session().isInvalid()).isTrue();
    }

    @Test void registrationDoesNotReplaceOrRotateAnAlreadyAuthenticatedSession() throws Exception {
        String existing=email("session"),newEmail=email("other");UUID oldId=seedExisting(existing);Browser current=login(existing,"LegacyFixture123!");
        String sessionId=current.session().getId();SecurityContext context=(SecurityContext)current.session().getAttribute(CONTEXT);
        var authentication=context.getAuthentication();
        register(current,template().put("email",newEmail),201);
        assertThat(current.session().getId()).isEqualTo(sessionId);
        assertThat(((SecurityContext)current.session().getAttribute(CONTEXT)).getAuthentication()).isSameAs(authentication);
        mvc.perform(get("/api/v1/auth/me").session(current.session())).andExpect(status().isOk()).andExpect(jsonPath("$.id").value(oldId.toString()));
        assertThat(users.existsByEmail(newEmail)).isTrue();assertThat(context.getAuthentication().getPrincipal()).isInstanceOf(PortalUser.class);
    }

    @Test void disabledSessionMayUsePublicRegistrationButCannotReachProtectedAreas() throws Exception {
        String existing=email("disabled"),newEmail=email("disabled-public");UUID id=seedExisting(existing);
        Browser reader=login(existing,"LegacyFixture123!"),writer=login(existing,"LegacyFixture123!");
        jdbc.update("UPDATE app_users SET enabled=false WHERE id=?",id);
        register(reader,template().put("email",newEmail),201);assertThat(reader.session().isInvalid()).isFalse();
        error(mvc.perform(get("/api/v1/auth/me").session(reader.session())).andExpect(status().isUnauthorized()).andReturn(),"ACCOUNT_DISABLED");
        error(mvc.perform(authorized(post("/api/v1/projects"),writer).contentType(MediaType.APPLICATION_JSON).content("{\"name\":\"blocked\"}"))
                .andExpect(status().isUnauthorized()).andReturn(),"ACCOUNT_DISABLED");
        assertThat(reader.session().isInvalid()).isTrue();assertThat(writer.session().isInvalid()).isTrue();
        assertThat(((PortalUser)users.loadUserByUsername(existing)).isEnabled()).isFalse();
    }

    @Test void disabledSessionCanStillBootstrapCsrfAndLogoutWithoutBeingReauthenticated() throws Exception {
        String email=email("disabled-logout");UUID id=seedExisting(email);Browser current=login(email,"LegacyFixture123!");
        jdbc.update("UPDATE app_users SET enabled=false WHERE id=?",id);Browser fresh=csrf(current.session());
        mvc.perform(authorized(post("/api/v1/auth/logout"),fresh)).andExpect(status().isNoContent());assertThat(fresh.session().isInvalid()).isTrue();
        Browser anonymous=csrf(null);
        error(mvc.perform(authorized(post("/api/v1/auth/login"),anonymous).param("email",email).param("password","LegacyFixture123!"))
                .andExpect(status().isUnauthorized()).andReturn(),"INVALID_CREDENTIALS");
    }

    @ParameterizedTest(name="{index}") @ValueSource(strings={"GET","PUT","DELETE"})
    void registrationIsNotPublicForUnintendedMethods(String method) throws Exception {
        Browser browser=csrf(null);long before=count("SELECT count(*) FROM app_users");
        var request=switch (method) {case "GET" -> get(REGISTER);case "PUT" -> put(REGISTER);default -> delete(REGISTER);};
        error(mvc.perform(authorized(request,browser).contentType(MediaType.APPLICATION_JSON).content(json.writeValueAsBytes(template().put("email",email("verb")))))
                .andExpect(status().isUnauthorized()).andReturn(),"UNAUTHENTICATED");
        assertThat(count("SELECT count(*) FROM app_users")).isEqualTo(before);
    }

    @Test void unacceptableResponseMediaTypeIsRejectedBeforeAnyAccountIsCreated() throws Exception {
        Browser browser=csrf(null);long before=count("SELECT count(*) FROM app_users");
        error(mvc.perform(authorized(post(REGISTER),browser).contentType(MediaType.APPLICATION_JSON).accept(MediaType.TEXT_PLAIN)
                .content(json.writeValueAsBytes(template().put("email",email("accept"))))).andExpect(status().isNotAcceptable()).andReturn(),"NOT_ACCEPTABLE");
        assertThat(count("SELECT count(*) FROM app_users")).isEqualTo(before);
    }
}
