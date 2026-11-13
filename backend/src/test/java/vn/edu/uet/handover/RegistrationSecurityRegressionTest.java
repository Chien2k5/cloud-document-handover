package vn.edu.uet.handover;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.net.URI;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.junit.jupiter.api.extension.ExtendWith;
import org.junit.jupiter.api.parallel.Execution;
import org.junit.jupiter.api.parallel.ExecutionMode;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.autoconfigure.web.servlet.MockMvcPrint;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import org.springframework.dao.DataAccessResourceFailureException;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.security.core.context.SecurityContext;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.context.HttpSessionSecurityContextRepository;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import vn.edu.uet.handover.auth.UserRepository;

/** Real PostgreSQL/MockMvc. Run only with an explicitly provisioned disposable DB.
 * No TRUNCATE, schema mutation, AWS, fake principals or fabricated CSRF tokens.
 * One test injects a repository lookup outage solely to exercise HTTP/log sanitization.
 */
@SpringBootTest(properties="app.upload.expiry-delay-ms=3600000")
@AutoConfigureMockMvc(print=MockMvcPrint.NONE)
@EnabledIfEnvironmentVariable(named="RUN_DB_TESTS",matches="true")
@Execution(ExecutionMode.SAME_THREAD)
@ExtendWith(OutputCaptureExtension.class)
class RegistrationSecurityRegressionTest {
    static final String REGISTER="/api/v1/auth/register";
    static final String CONTEXT=HttpSessionSecurityContextRepository.SPRING_SECURITY_CONTEXT_KEY;
    static final String[] TABLES={"app_users","projects","memberships","file_metadata","file_versions",
            "upload_sessions","handovers","handover_items","handover_recipients","audit_events"};
    @Autowired MockMvc mvc;
    @Autowired ObjectMapper json;
    @Autowired JdbcTemplate jdbc;
    @Autowired PasswordEncoder passwords;
    @MockitoSpyBean UserRepository users;
    final Set<String> ownedEmails=new LinkedHashSet<>();
    final Set<UUID> ownedProjects=new LinkedHashSet<>();
    Map<String,Long> before;
    String prefix;
    record Browser(MockHttpSession session,String header,String token) {}

    @BeforeEach void isolateFixtures() {
        prefix="r06-"+UUID.randomUUID(); ownedEmails.clear(); ownedProjects.clear(); before=counts();
    }
    @AfterEach void removeOnlyOwnedFixturesAndVerifyNoResidualWrites() {
        // The only project fixture is explicitly tracked. Child cleanup also works if a denial assertion fails.
        for (UUID project:ownedProjects) {
            jdbc.update("DELETE FROM handover_recipients WHERE handover_id IN (SELECT id FROM handovers WHERE project_id=?)",project);
            jdbc.update("DELETE FROM handover_items WHERE project_id=?",project);
            jdbc.update("DELETE FROM handovers WHERE project_id=?",project);
            jdbc.update("DELETE FROM upload_sessions WHERE project_id=?",project);
            jdbc.update("DELETE FROM file_versions WHERE project_id=?",project);
            jdbc.update("DELETE FROM file_metadata WHERE project_id=?",project);
            jdbc.update("DELETE FROM audit_events WHERE project_id=?",project);
            jdbc.update("DELETE FROM memberships WHERE project_id=?",project);
            jdbc.update("DELETE FROM projects WHERE id=?",project);
        }
        for (String email:ownedEmails) jdbc.update("DELETE FROM app_users WHERE email=?",email);
        assertThat(counts()).isEqualTo(before);
    }
    Map<String,Long> counts() {
        var result=new LinkedHashMap<String,Long>();
        for (String table:TABLES) result.put(table,jdbc.queryForObject("SELECT count(*) FROM "+table,Long.class));
        return result; // Table names come only from the fixed internal allowlist, never request data.
    }
    String email(String suffix) { String value=prefix+"-"+suffix+"@example.test"; ownedEmails.add(value); return value; }
    String secret() { return "  Fixture-"+UUID.randomUUID()+"  "; }
    ObjectNode body(String email,String password) {
        return json.createObjectNode().put("displayName","  Security Review User  ").put("email",email)
                .put("password",password).put("confirmPassword",password);
    }
    Browser csrf(MockHttpSession session) throws Exception {
        var request=get("/api/v1/auth/csrf"); if (session!=null) request.session(session);
        var result=mvc.perform(request).andExpect(status().isOk()).andReturn();
        JsonNode token=json.readTree(result.getResponse().getContentAsString());
        assertThat(token.path("headerName").asText()).isNotBlank(); assertThat(token.path("token").asText()).isNotBlank();
        var actual=(MockHttpSession)result.getRequest().getSession(false); assertThat(actual).isNotNull();
        return new Browser(actual,token.get("headerName").asText(),token.get("token").asText());
    }
    MockHttpServletRequestBuilder authorized(MockHttpServletRequestBuilder request,Browser browser) {
        return request.session(browser.session()).header(browser.header(),browser.token());
    }
    MvcResult register(Browser browser,ObjectNode input,int expected) throws Exception {
        return mvc.perform(authorized(post(REGISTER),browser).contentType(MediaType.APPLICATION_JSON)
                .accept(MediaType.APPLICATION_JSON).content(json.writeValueAsBytes(input)))
                .andExpect(status().is(expected)).andReturn();
    }
    JsonNode error(MvcResult result,String code,String... secrets) throws Exception {
        String text=result.getResponse().getContentAsString(); JsonNode value=json.readTree(text);
        assertThat(value.properties()).extracting(Map.Entry::getKey).containsExactlyInAnyOrder("code","message","requestId");
        assertThat(value.path("code").asText()).isEqualTo(code); assertThat(value.path("message").asText()).isNotBlank();
        UUID.fromString(value.path("requestId").asText());
        assertThat(result.getResponse().getHeader("X-Request-Id")).isEqualTo(value.get("requestId").asText());
        assertThat(text).doesNotContain("password","stackTrace","SQLException","org.postgresql","org.springframework","INSERT INTO","SELECT password_hash");
        for (String secret:secrets) assertThat(text.contains(secret)).as("credential absent from error").isFalse();
        return value;
    }
    JsonNode publicView(MvcResult result,String password) throws Exception {
        String text=result.getResponse().getContentAsString(); JsonNode value=json.readTree(text);
        assertThat(value.properties()).extracting(Map.Entry::getKey).containsExactlyInAnyOrder("id","email","displayName");
        UUID.fromString(value.path("id").asText()); assertThat(text.contains(password)).isFalse(); return value;
    }
    UUID seed(String email,String password) {
        UUID id=UUID.randomUUID();
        jdbc.update("INSERT INTO app_users(id,email,display_name,password_hash) VALUES (?,?,?,?)",id,email,"Existing R06 account",passwords.encode(password));
        return id;
    }
    Browser login(String email,String password) throws Exception {
        Browser anonymous=csrf(null); String before=anonymous.session().getId();
        var result=mvc.perform(authorized(post("/api/v1/auth/login"),anonymous).contentType(MediaType.APPLICATION_FORM_URLENCODED)
                .param("email",email).param("password",password)).andExpect(status().isOk()).andReturn();
        var session=(MockHttpSession)result.getRequest().getSession(false);
        assertThat(session.getId()).isNotEqualTo(before); return csrf(session);
    }
    void me(Browser browser,UUID id) throws Exception {
        mvc.perform(get("/api/v1/auth/me").session(browser.session())).andExpect(status().isOk()).andExpect(jsonPath("$.id").value(id.toString()));
    }
    void noLeak(CapturedOutput output,String... secrets) {
        for (String secret:secrets) assertThat(output.getAll().contains(secret)).as("credential or internal detail absent from captured application output").isFalse();
    }

    @Test void foreignSessionCsrfCannotRegisterOrAlterEitherSession() throws Exception {
        Browser first=csrf(null),second=csrf(null); String a=first.session().getId(),b=second.session().getId();
        assertThat(a).isNotEqualTo(b); assertThat(first.token()).isNotEqualTo(second.token());
        String email=email("foreign-csrf"),password=secret(); Map<String,Long> prior=counts();
        var result=mvc.perform(post(REGISTER).session(first.session()).header(second.header(),second.token())
                .contentType(MediaType.APPLICATION_JSON).content(json.writeValueAsBytes(body(email,password))))
                .andExpect(status().isForbidden()).andReturn();
        error(result,"ACCESS_DENIED",password); assertThat(counts()).isEqualTo(prior);
        assertThat(first.session().getId()).isEqualTo(a); assertThat(second.session().getId()).isEqualTo(b);
        assertThat(first.session().getAttribute(CONTEXT)).isNull(); assertThat(second.session().getAttribute(CONTEXT)).isNull();
        JsonNode created=publicView(register(first,body(email,password),201),password);
        assertThat(created.path("email").asText()).isEqualTo(email);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM app_users WHERE email=?",Long.class,email)).isEqualTo(1);
        mvc.perform(get("/api/v1/auth/me").session(second.session())).andExpect(status().isUnauthorized());
    }

    @Test void registrationInAnotherSessionPreservesAccountAndCsrf() throws Exception {
        String existing=email("existing"),existingPassword=secret(),newEmail=email("new"),newPassword=secret();
        UUID oldId=seed(existing,existingPassword); Browser old=login(existing,existingPassword);
        String sessionId=old.session().getId(); var authentication=((SecurityContext)old.session().getAttribute(CONTEXT)).getAuthentication();
        var persisted=jdbc.queryForMap("SELECT * FROM app_users WHERE id=?",oldId);
        Browser newcomer=csrf(null); JsonNode created=publicView(register(newcomer,body(newEmail,newPassword),201),newPassword);
        assertThat(newcomer.session().getAttribute(CONTEXT)).isNull();
        assertThat(old.session().getId()).isEqualTo(sessionId); assertThat(old.session().isInvalid()).isFalse();
        assertThat(((SecurityContext)old.session().getAttribute(CONTEXT)).getAuthentication()).isSameAs(authentication);
        assertThat(jdbc.queryForMap("SELECT * FROM app_users WHERE id=?",oldId)).isEqualTo(persisted); me(old,oldId);
        // Old token remains valid: invalid business JSON reaches validation, never creates a project.
        error(mvc.perform(authorized(post("/api/v1/projects"),old).contentType(MediaType.APPLICATION_JSON).content("{}"))
                .andExpect(status().isBadRequest()).andReturn(),"VALIDATION_ERROR");
        error(mvc.perform(post("/api/v1/projects").session(old.session()).contentType(MediaType.APPLICATION_JSON).content("{}"))
                .andExpect(status().isForbidden()).andReturn(),"ACCESS_DENIED");
        Browser newLogin=login(newEmail,newPassword); me(newLogin,UUID.fromString(created.get("id").asText())); me(old,oldId);
        mvc.perform(authorized(post("/api/v1/auth/logout"),newLogin)).andExpect(status().isNoContent());
        assertThat(newLogin.session().isInvalid()).isTrue(); me(old,oldId);
        assertThat(jdbc.queryForMap("SELECT * FROM app_users WHERE id=?",oldId)).isEqualTo(persisted);
        assertThat(counts().get("projects")).isEqualTo(before.get("projects")); assertThat(counts().get("memberships")).isEqualTo(before.get("memberships"));
        mvc.perform(authorized(post("/api/v1/auth/logout"),old)).andExpect(status().isNoContent()); assertThat(old.session().isInvalid()).isTrue();
    }

    @Test void newAccountCannotReadOrMutateForeignWorkspace() throws Exception {
        String ownerEmail=email("owner"),ownerPassword=secret(),newEmail=email("outsider"),password=secret();
        UUID ownerId=seed(ownerEmail,ownerPassword); Browser owner=login(ownerEmail,ownerPassword);
        var projectResult=mvc.perform(authorized(post("/api/v1/projects"),owner).contentType(MediaType.APPLICATION_JSON)
                .content("{\"name\":\"R06 private workspace\"}")).andExpect(status().isCreated()).andReturn();
        UUID project=UUID.fromString(json.readTree(projectResult.getResponse().getContentAsString()).get("id").asText()); ownedProjects.add(project);
        UUID handover=UUID.randomUUID();
        jdbc.update("INSERT INTO handovers(id,project_id,title,created_by,expires_at) VALUES (?,?,?, ?,now()+interval '1 day')",handover,project,"Private R06 fixture",ownerId);
        mvc.perform(get("/api/v1/handovers/"+handover).session(owner.session())).andExpect(status().isOk());
        JsonNode created=publicView(register(csrf(null),body(newEmail,password),201),password); UUID newId=UUID.fromString(created.get("id").asText());
        Browser outsider=login(newEmail,password); Map<String,Long> prior=counts();
        var originalProject=jdbc.queryForMap("SELECT * FROM projects WHERE id=?",project);
        mvc.perform(get("/api/v1/projects").session(outsider.session())).andExpect(status().isOk()).andExpect(jsonPath("$.items.length()").value(0));
        for (String path:new String[]{"/api/v1/projects/"+project,"/api/v1/projects/"+project+"/members","/api/v1/projects/"+project+"/files"})
            error(mvc.perform(get(path).session(outsider.session())).andExpect(status().isNotFound()).andReturn(),"PROJECT_NOT_FOUND");
        error(mvc.perform(authorized(put("/api/v1/projects/"+project+"/members/"+newId),outsider).contentType(MediaType.APPLICATION_JSON).content("{\"role\":\"EDITOR\"}"))
                .andExpect(status().isNotFound()).andReturn(),"PROJECT_NOT_FOUND");
        error(mvc.perform(authorized(delete("/api/v1/projects/"+project+"/members/"+ownerId),outsider))
                .andExpect(status().isNotFound()).andReturn(),"PROJECT_NOT_FOUND");
        var upload=json.createObjectNode().put("filename","fixture.txt").put("contentType","text/plain").put("size",1).put("expectedSha256","a".repeat(64));
        error(mvc.perform(authorized(post("/api/v1/projects/"+project+"/files/uploads"),outsider).contentType(MediaType.APPLICATION_JSON).content(json.writeValueAsBytes(upload)))
                .andExpect(status().isNotFound()).andReturn(),"PROJECT_NOT_FOUND");
        error(mvc.perform(get("/api/v1/handovers/"+handover).session(outsider.session())).andExpect(status().isNotFound()).andReturn(),"HANDOVER_NOT_FOUND");
        error(mvc.perform(authorized(post("/api/v1/handovers/"+handover+"/publish"),outsider)).andExpect(status().isNotFound()).andReturn(),"HANDOVER_NOT_FOUND");
        assertThat(counts()).isEqualTo(prior); assertThat(jdbc.queryForMap("SELECT * FROM projects WHERE id=?",project)).isEqualTo(originalProject);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM memberships WHERE user_id=?",Long.class,newId)).isZero();
        mvc.perform(get("/api/v1/projects/"+project).session(owner.session())).andExpect(status().isOk()).andExpect(jsonPath("$.role").value("OWNER"));
    }

    @Test void successfulInvalidAndDisabledDuplicateRequestsDoNotLeakLogs(CapturedOutput output) throws Exception {
        String email=email("log"),password=secret(),replacement=secret(),invalid="Invalid-"+UUID.randomUUID()+"x".repeat(40);
        Browser browser=csrf(null); JsonNode created=publicView(register(browser,body(email,password),201),password);
        UUID id=UUID.fromString(created.get("id").asText()); jdbc.update("UPDATE app_users SET enabled=false WHERE id=?",id);
        var old=jdbc.queryForMap("SELECT * FROM app_users WHERE id=?",id); String hash=old.get("password_hash").toString();
        error(register(browser,body(email("invalid-log"),invalid),400),"VALIDATION_ERROR",password,invalid,hash);
        error(register(browser,body(" "+email.toUpperCase(Locale.ROOT)+" ",replacement),409),"EMAIL_ALREADY_EXISTS",password,replacement,hash);
        assertThat(jdbc.queryForMap("SELECT * FROM app_users WHERE id=?",id)).isEqualTo(old);
        assertThat(old.get("enabled")).isEqualTo(false); assertThat(passwords.matches(password,hash)).isTrue(); assertThat(passwords.matches(replacement,hash)).isFalse();
        assertThat(jdbc.queryForObject("SELECT count(*) FROM app_users WHERE email=?",Long.class,email)).isEqualTo(1);
        noLeak(output,password,replacement,invalid,hash);
    }

    @Test void unexpectedLookupFailureIsSanitizedWithoutWriting(CapturedOutput output) throws Exception {
        String email=email("outage"),password=secret(),internal="SELECT password_hash FROM private_r06_marker";
        Map<String,Long> prior=counts();
        // Fault injection tests the real advice/logging only. All integrity scenarios above use real SQL.
        doThrow(new DataAccessResourceFailureException(internal+" "+password)).when(users).existsByEmail(email);
        JsonNode failure=error(register(csrf(null),body(email,password),500),"INTERNAL_ERROR",password,internal);
        assertThat(failure.path("message").asText()).isEqualTo("Request could not be processed");
        assertThat(counts()).isEqualTo(prior);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM app_users WHERE email=?",Long.class,email)).isZero();
        verify(users,never()).insertRegisteredUser(any(UUID.class),eq(email),anyString(),anyString());
        noLeak(output,password,internal,"org.springframework.dao.DataAccessResourceFailureException");
    }

    @ParameterizedTest(name="{index}") @ValueSource(strings={"HEAD","PATCH","OPTIONS"})
    void additionalMethodsStayProtected(String method) throws Exception {
        Browser browser=csrf(null); Map<String,Long> prior=counts(); String email=email("method"),password=secret();
        mvc.perform(authorized(request(HttpMethod.valueOf(method),REGISTER),browser).contentType(MediaType.APPLICATION_JSON)
                .content(json.writeValueAsBytes(body(email,password)))).andExpect(status().isUnauthorized());
        assertThat(counts()).isEqualTo(prior); assertThat(browser.session().getAttribute(CONTEXT)).isNull();
    }

    @ParameterizedTest(name="{index}")
    @ValueSource(strings={"/api/v1/auth/register/","/api/v1/auth/register;probe=1","/api/v1/auth//register","/api/v1/auth/%72egister","/api/v1/auth/register%2fextra"})
    void alternatePathsWithoutCsrfCannotWrite(String path) throws Exception {
        Browser browser=csrf(null); Map<String,Long> prior=counts(); String password=secret();
        var result=mvc.perform(post(URI.create(path)).session(browser.session()).contentType(MediaType.APPLICATION_JSON)
                .content(json.writeValueAsBytes(body(email("alias"),password)))).andReturn();
        // 400 is the StrictHttpFirewall boundary; 403 is CsrfFilter. Neither reaches registration.
        assertThat(result.getResponse().getStatus()).isIn(400,403);
        if (result.getResponse().getStatus()==403) error(result,"ACCESS_DENIED",password);
        assertThat(counts()).isEqualTo(prior); assertThat(browser.session().getAttribute(CONTEXT)).isNull();
        verify(users,never()).insertRegisteredUser(any(UUID.class),anyString(),anyString(),anyString());
    }
}
