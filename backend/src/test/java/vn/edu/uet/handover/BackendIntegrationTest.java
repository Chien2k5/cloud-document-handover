package vn.edu.uet.handover;

import static org.assertj.core.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.web.servlet.MockMvc;

// Opt-in: DB_URL must refer to a disposable, initially empty PostgreSQL database.
@SpringBootTest
@AutoConfigureMockMvc
@EnabledIfEnvironmentVariable(named="RUN_DB_TESTS", matches="true")
class BackendIntegrationTest {
    @Autowired MockMvc mvc;
    @Autowired JdbcTemplate jdbc;
    @Autowired ObjectMapper json;
    @Autowired PasswordEncoder passwords;
    UUID owner, editor, viewer, outsider;
    String password;

    @BeforeEach
    void seed() {
        jdbc.execute("TRUNCATE app_users,projects,memberships,file_metadata,file_versions,upload_sessions,handovers,handover_items,handover_recipients,audit_events CASCADE");
        password=UUID.randomUUID().toString();
        String hash=passwords.encode(password);
        owner=user("owner",hash); editor=user("editor",hash); viewer=user("viewer",hash); outsider=user("outsider",hash);
    }
    UUID user(String name,String hash) {
        UUID id=UUID.randomUUID();
        jdbc.update("INSERT INTO app_users(id,email,display_name,password_hash) VALUES (?,?,?,?)",id,name+"@example.test",name,hash);
        return id;
    }
    MockHttpSession login(String name) throws Exception {
        return (MockHttpSession) mvc.perform(post("/api/v1/auth/login").with(csrf()).param("email",name+"@example.test").param("password",password))
                .andExpect(status().isOk()).andExpect(jsonPath("$.email").value(name+"@example.test"))
                .andExpect(jsonPath("$.password").doesNotExist()).andReturn().getRequest().getSession(false);
    }
    UUID project(MockHttpSession session) throws Exception {
        String body=mvc.perform(post("/api/v1/projects").session(session).with(csrf()).contentType("application/json").content("{\"name\":\"Project A\"}"))
                .andExpect(status().isCreated()).andExpect(jsonPath("$.role").value("OWNER"))
                .andReturn().getResponse().getContentAsString();
        return UUID.fromString(json.readTree(body).get("id").asText());
    }
    void member(UUID id, UUID user,String role) { jdbc.update("INSERT INTO memberships(project_id,user_id,role) VALUES (?,?,?)",id,user,role); }

    @Test void migrationHealthAndAuthentication() throws Exception {
        assertThat(jdbc.queryForObject("SELECT success FROM flyway_schema_history WHERE version='1'",Boolean.class)).isTrue();
        mvc.perform(get("/api/v1/health")).andExpect(status().isOk()).andExpect(jsonPath("$.status").value("UP"));
        mvc.perform(get("/api/v1/auth/me")).andExpect(status().isUnauthorized()).andExpect(jsonPath("$.requestId").isNotEmpty());
        mvc.perform(get("/api/v1/auth/csrf")).andExpect(status().isOk()).andExpect(jsonPath("$.token").isNotEmpty());
        mvc.perform(post("/api/v1/auth/login").with(csrf()).param("email","owner@example.test").param("password","incorrect"))
                .andExpect(status().isUnauthorized());
        mvc.perform(post("/api/v1/auth/login").param("email","owner@example.test").param("password",password))
                .andExpect(status().isForbidden());
        MockHttpSession session=login("owner");
        mvc.perform(get("/api/v1/auth/me").session(session)).andExpect(status().isOk()).andExpect(jsonPath("$.id").value(owner.toString()));
        mvc.perform(post("/api/v1/auth/logout").session(session).with(csrf())).andExpect(status().isNoContent());
        assertThat(session.isInvalid()).isTrue();
    }
    @Test void projectsAreIsolatedAndOwnerIsAssignedByServer() throws Exception {
        MockHttpSession a=login("owner"), b=login("outsider");
        UUID id=project(a), other=project(b);
        mvc.perform(get("/api/v1/projects/"+id).session(a)).andExpect(status().isOk());
        mvc.perform(get("/api/v1/projects/"+id).session(b)).andExpect(status().isNotFound());
        mvc.perform(get("/api/v1/projects/"+other).session(a)).andExpect(status().isNotFound());
        mvc.perform(get("/api/v1/projects").session(a)).andExpect(status().isOk()).andExpect(jsonPath("$.items.length()").value(1));
        mvc.perform(post("/api/v1/projects").session(a).with(csrf()).contentType("application/json").content("{\"name\":\"x\",\"role\":\"OWNER\"}"))
                .andExpect(status().isBadRequest());
        mvc.perform(get("/api/v1/projects/"+id)).andExpect(status().isUnauthorized());
    }
    @Test void membershipMutationRequiresOwnerAndCannotRemoveOwner() throws Exception {
        MockHttpSession a=login("owner"), e=login("editor"), v=login("viewer");
        UUID id=project(a); member(id,editor,"EDITOR"); member(id,viewer,"VIEWER");
        for (MockHttpSession s : new MockHttpSession[]{e,v}) {
            mvc.perform(get("/api/v1/projects/"+id).session(s)).andExpect(status().isOk());
            mvc.perform(put("/api/v1/projects/"+id+"/members/"+outsider).session(s).with(csrf()).contentType("application/json").content("{\"role\":\"EDITOR\"}"))
                    .andExpect(status().isForbidden());
        }
        mvc.perform(put("/api/v1/projects/"+id+"/members/"+outsider).session(a).with(csrf()).contentType("application/json").content("{\"role\":\"VIEWER\"}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.role").value("VIEWER"));
        mvc.perform(delete("/api/v1/projects/"+id+"/members/"+owner).session(a).with(csrf())).andExpect(status().isConflict());
        mvc.perform(delete("/api/v1/projects/"+id+"/members/"+viewer).session(a).with(csrf())).andExpect(status().isNoContent());
        mvc.perform(get("/api/v1/projects/"+id).session(v)).andExpect(status().isNotFound());
        assertThat(jdbc.queryForObject("SELECT count(*) FROM audit_events WHERE project_id=?",Integer.class,id)).isEqualTo(3);
    }
    @Test void validationCsrfAndUnimplementedRoutes() throws Exception {
        MockHttpSession a=login("owner"); UUID id=project(a);
        mvc.perform(post("/api/v1/projects").session(a).contentType("application/json").content("{\"name\":\"x\"}"))
                .andExpect(status().isForbidden());
        mvc.perform(post("/api/v1/projects").session(a).with(csrf()).contentType("application/json").content("{\"name\":\" \"}"))
                .andExpect(status().isBadRequest());
        mvc.perform(get("/api/v1/projects/bad-uuid").session(a)).andExpect(status().isBadRequest());
        mvc.perform(get("/api/v1/projects?size=101").session(a)).andExpect(status().isBadRequest());
        mvc.perform(put("/api/v1/projects/"+id+"/members/"+editor).session(a).with(csrf()).contentType("application/json").content("{\"role\":\"OWNER\"}"))
                .andExpect(status().isBadRequest());
        mvc.perform(post("/api/v1/projects/"+id+"/files/uploads").session(a).with(csrf()).contentType("application/json").content("{}"))
                .andExpect(status().isNotFound());
    }
    @Test void databaseConstraintsProtectVersionAndCrossProjectReferences() throws Exception {
        UUID a=project(login("owner")), b=project(login("outsider"));
        UUID file=UUID.randomUUID(), version=UUID.randomUUID(), handover=UUID.randomUUID();
        jdbc.update("INSERT INTO file_metadata(id,project_id,filename,created_by) VALUES (?,?,'report.txt',?)",file,a,owner);
        String insert="INSERT INTO file_versions(id,file_id,project_id,bucket,object_key,content_type,size_bytes,expected_sha256,created_by) VALUES (?,?,?,'test-bucket','uploads/test','text/plain',100,?,?)";
        jdbc.update(insert,version,file,a,"a".repeat(64),owner);
        assertThatThrownBy(() -> jdbc.update(insert,UUID.randomUUID(),file,b,"a".repeat(64),owner)).isInstanceOf(DataIntegrityViolationException.class);
        assertThatThrownBy(() -> jdbc.update("UPDATE file_versions SET upload_status='AVAILABLE' WHERE id=?",version)).isInstanceOf(DataIntegrityViolationException.class);
        jdbc.update("UPDATE file_versions SET upload_status='AVAILABLE',s3_version_id='v1' WHERE id=?",version);
        assertThat(jdbc.queryForObject("SELECT integrity_status FROM file_versions WHERE id=?",String.class,version)).isEqualTo("INTEGRITY_PENDING");
        assertThatThrownBy(() -> jdbc.update("UPDATE file_versions SET integrity_status='VERIFIED',actual_sha256=? WHERE id=?","b".repeat(64),version)).isInstanceOf(DataIntegrityViolationException.class);
        jdbc.update("UPDATE file_versions SET integrity_status='VERIFIED',actual_sha256=expected_sha256 WHERE id=?",version);
        jdbc.update("INSERT INTO handovers(id,project_id,title,created_by,expires_at) VALUES (?,?,'handover',?,now()+interval '1 day')",handover,b,outsider);
        assertThatThrownBy(() -> jdbc.update("INSERT INTO handover_items(handover_id,project_id,file_version_id) VALUES (?,?,?)",handover,b,version)).isInstanceOf(DataIntegrityViolationException.class);
        assertThatThrownBy(() -> jdbc.update("INSERT INTO memberships(project_id,user_id,role) VALUES (?,?,'EDITOR')",a,owner)).isInstanceOf(DataIntegrityViolationException.class);
        assertThatThrownBy(() -> jdbc.update("UPDATE projects SET reserved_bytes=quota_bytes+1 WHERE id=?",a)).isInstanceOf(DataIntegrityViolationException.class);
        UUID ownHandover=UUID.randomUUID();
        jdbc.update("INSERT INTO handovers(id,project_id,title,created_by,expires_at) VALUES (?,?,'own handover',?,now()+interval '1 day')",ownHandover,a,owner);
        jdbc.update("INSERT INTO handover_items(handover_id,project_id,file_version_id) VALUES (?,?,?)",ownHandover,a,version);
        assertThatThrownBy(() -> jdbc.update("DELETE FROM file_versions WHERE id=?",version)).isInstanceOf(DataIntegrityViolationException.class);
    }
}
