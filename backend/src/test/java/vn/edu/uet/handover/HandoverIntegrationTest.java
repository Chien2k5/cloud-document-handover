package vn.edu.uet.handover;

import static org.assertj.core.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.net.*;
import java.net.http.*;
import java.nio.charset.StandardCharsets;
import java.time.*;
import java.util.*;
import java.util.concurrent.*;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.context.annotation.Primary;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.web.servlet.MockMvc;
import vn.edu.uet.handover.common.ApiException;
import vn.edu.uet.handover.handover.*;
import vn.edu.uet.handover.handover.HandoverDtos.*;
import vn.edu.uet.handover.project.ProjectDtos.CreateProject;
import vn.edu.uet.handover.project.ProjectService;
import vn.edu.uet.handover.upload.UploadService;
import vn.edu.uet.handover.upload.UploadDtos.UploadRequest;
import vn.edu.uet.handover.upload.StoragePort.*;

/** PostgreSQL and HTTP are real. Storage is a test-source fixture; AWS is NOT RUN. */
@SpringBootTest(webEnvironment=SpringBootTest.WebEnvironment.RANDOM_PORT,properties={
        "app.upload.bucket=fixture-bucket","app.upload.expiry-delay-ms=3600000","server.servlet.session.cookie.secure=false"})
@AutoConfigureMockMvc
@Import(HandoverIntegrationTest.Fixture.class)
@EnabledIfEnvironmentVariable(named="RUN_DB_TESTS",matches="true")
class HandoverIntegrationTest {
    @TestConfiguration static class Fixture {
        @Bean @Primary Storage storageFixture() {return new Storage();}
        @Bean @Primary UploadIntegrationTest.MutableClock handoverClock() {return new UploadIntegrationTest.MutableClock();}
    }
    static class Storage extends UploadIntegrationTest.FakeStorage {
        Runnable onGet=()->{};
        Instant lastDeadline;
        ObjectRef lastRef;
        boolean overlong=false,insecure=false;
        @Override public SignedRequest presignGet(ObjectRef ref,Instant until) {
            if(fail) throw new Unavailable();
            lastDeadline=until;lastRef=ref;onGet.run();
            return new SignedRequest("GET",(insecure?"http":"https")+"://storage.invalid/handover",Map.of(),overlong?until.plusSeconds(1):until);
        }
    }
    @Autowired HandoverService service;
    @Autowired HandoverRepository repository;
    @Autowired ProjectService projects;
    @Autowired UploadService uploads;
    @Autowired JdbcTemplate jdbc;
    @Autowired MockMvc mvc;
    @Autowired ObjectMapper json;
    @Autowired PasswordEncoder passwords;
    @Autowired Storage storage;
    @Autowired UploadIntegrationTest.MutableClock clock;
    @LocalServerPort int port;
    UUID owner,editor,viewer,recipient,recipient2,stranger,project,other,version,file;
    String password;
    final String sha="a".repeat(64),requestId=UUID.randomUUID().toString();

    @BeforeEach void seed() throws Exception {
        jdbc.execute("TRUNCATE app_users,projects,memberships,file_metadata,file_versions,upload_sessions,handovers,handover_items,handover_recipients,audit_events CASCADE");
        clock.now=Instant.now();storage.heads.clear();storage.results.clear();storage.fail=false;storage.unsafePut=false;storage.overlong=false;storage.insecure=false;
        storage.onHead=()->{};storage.onRead=()->{};storage.onGet=()->{};storage.headCalls.set(0);storage.reads.set(0);
        password=UUID.randomUUID().toString();String hash=passwords.encode(password);
        owner=user("owner",hash);editor=user("editor",hash);viewer=user("viewer",hash);recipient=user("recipient",hash);recipient2=user("recipient2",hash);stranger=user("stranger",hash);
        var input=json.readValue("{\"name\":\"Handover fixture\"}",CreateProject.class);
        project=projects.create(owner,input,requestId).id();other=projects.create(stranger,input,requestId).id();
        jdbc.update("INSERT INTO memberships(project_id,user_id,role) VALUES (?,?,'EDITOR'),(?,?,'VIEWER')",project,editor,project,viewer);
        file=UUID.randomUUID();version=version(project,file,"v1+opaque/=","VERIFIED");
    }
    UUID user(String name,String hash) {UUID id=UUID.randomUUID();jdbc.update("INSERT INTO app_users(id,email,display_name,password_hash) VALUES (?,?,?,?)",id,name+"@example.com",name,hash);return id;}
    UUID version(UUID p,UUID f,String s3,String integrity) {
        UUID id=UUID.randomUUID();
        jdbc.update("INSERT INTO file_metadata(id,project_id,filename,created_by) VALUES (?,?,'report.txt',?)",f,p,p.equals(project)?owner:stranger);
        String actual=integrity.equals("VERIFIED")?sha:integrity.equals("MISMATCH")?"b".repeat(64):null;
        jdbc.update("INSERT INTO file_versions(id,file_id,project_id,bucket,object_key,s3_version_id,content_type,size_bytes,expected_sha256,actual_sha256,upload_status,integrity_status,created_by) VALUES (?,?,?,'fixture-bucket',?,?,'text/plain',10,?,?,'AVAILABLE',?,?)",
                id,f,p,"uploads/"+p+"/"+id,s3,sha,actual,integrity,p.equals(project)?owner:stranger);
        var ref=repository.version(p,id).orElseThrow().ref();storage.heads.put(ref,new VersionHead(ref,10,"text/plain",false));
        return id;
    }
    CreateHandover input(List<UUID> versions,List<UUID> people) {return new CreateHandover("Goi ban giao",versions,people,clock.instant().plusSeconds(120));}
    Handover draft() {return service.create(project,owner,input(List.of(version),List.of(recipient,recipient2)),requestId);}
    Handover ready() {var h=draft();return service.publish(h.id(),owner,requestId);}
    void code(Runnable run,String code) {assertThatThrownBy(run::run).isInstanceOfSatisfying(ApiException.class,e->assertThat(e.code()).isEqualTo(code));}
    int audits(String action) {return jdbc.queryForObject("SELECT count(*) FROM audit_events WHERE action=?",Integer.class,action);}
    MockHttpSession login(String name) throws Exception {
        return (MockHttpSession)mvc.perform(post("/api/v1/auth/login").with(csrf()).param("email",name+"@example.com").param("password",password)).andExpect(status().isOk()).andReturn().getRequest().getSession(false);
    }
    @Test void completeWorkflowPinsV1AndRecordsEachRecipientOnce() {
        var d=draft();assertThat(d.status()).isEqualTo("DRAFT");
        code(()->service.get(d.id(),recipient),"HANDOVER_NOT_READY");
        var h=service.publish(d.id(),owner,requestId);assertThat(h.status()).isEqualTo("READY");
        int heads=storage.headCalls.get();assertThat(service.publish(h.id(),owner,requestId)).isEqualTo(h);assertThat(storage.headCalls.get()).isEqualTo(heads);
        var v2=uploads.init(project,owner,new UploadRequest("report.txt","text/plain",10L,sha,file),requestId);
        var ref=new ObjectRef("fixture-bucket","uploads/"+project+"/"+v2.uploadId(),"v2");storage.heads.put(ref,new VersionHead(ref,10,"text/plain",false));
        uploads.complete(project,v2.uploadId(),owner,"v2",requestId);
        assertThat(service.download(h.id(),version,recipient).versionId()).isEqualTo("v1+opaque/=");
        assertThat(storage.lastRef.versionId()).isEqualTo("v1+opaque/=");assertThat(storage.lastDeadline).isEqualTo(h.expiresAt());
        assertThat(service.get(h.id(),recipient).items()).hasSize(1);assertThat(service.get(h.id(),recipient).items().getFirst().fileVersionId()).isEqualTo(version);
        var first=service.confirm(h.id(),recipient,requestId);assertThat(first.userId()).isEqualTo(recipient);
        assertThat(service.get(h.id(),owner).status()).isEqualTo("READY");clock.advance(1);
        assertThat(service.confirm(h.id(),recipient,requestId).confirmedAt()).isEqualTo(first.confirmedAt());
        service.confirm(h.id(),recipient2,requestId);assertThat(service.get(h.id(),owner).status()).isEqualTo("CONFIRMED");
        assertThat(audits("HANDOVER_CREATED")).isEqualTo(1);assertThat(audits("HANDOVER_PUBLISHED")).isEqualTo(1);assertThat(audits("HANDOVER_CONFIRMED")).isEqualTo(2);
    }
    @Test void draftValidatesOwnershipVersionsRecipientsAndRollsBack() {
        code(()->service.create(project,editor,input(List.of(version),List.of(recipient)),requestId),"OWNER_REQUIRED");
        code(()->service.create(project,stranger,input(List.of(version),List.of(recipient)),requestId),"HANDOVER_NOT_FOUND");
        code(()->service.create(project,owner,input(List.of(version,version),List.of(recipient)),requestId),"VALIDATION_ERROR");
        code(()->service.create(project,owner,input(List.of(version),List.of(recipient,recipient)),requestId),"VALIDATION_ERROR");
        code(()->service.create(project,owner,input(List.of(),List.of(recipient)),requestId),"VALIDATION_ERROR");
        UUID foreign=version(other,UUID.randomUUID(),"foreign","VERIFIED");
        code(()->service.create(project,owner,input(List.of(foreign),List.of(recipient)),requestId),"FILE_NOT_FOUND");
        jdbc.update("UPDATE app_users SET enabled=false WHERE id=?",recipient);
        code(()->service.create(project,owner,input(List.of(version),List.of(recipient)),requestId),"USER_NOT_FOUND");
        jdbc.update("UPDATE app_users SET enabled=true WHERE id=?",recipient);
        assertThatThrownBy(()->service.create(project,owner,input(List.of(version),List.of(recipient)),"x".repeat(37))).isInstanceOf(org.springframework.dao.DataIntegrityViolationException.class);
        for(String table:List.of("handovers","handover_items","handover_recipients")) assertThat(jdbc.queryForObject("SELECT count(*) FROM "+table,Integer.class)).isZero();
        assertThat(audits("HANDOVER_CREATED")).isZero();
    }
    @Test void publicationRejectsUnverifiedStatesAndDisabledRecipient() {
        for(String state:List.of("INTEGRITY_PENDING","MISMATCH","FAILED")) {
            UUID bad=version(project,UUID.randomUUID(),state,state);
            Handover h=service.create(project,owner,input(List.of(bad),List.of(recipient)),requestId);
            code(()->service.publish(h.id(),owner,requestId),"FILE_NOT_VERIFIED");assertThat(service.get(h.id(),owner).status()).isEqualTo("DRAFT");
        }
        UUID pending=version(project,UUID.randomUUID(),"pending","INTEGRITY_PENDING");
        jdbc.update("UPDATE file_versions SET upload_status='PENDING',s3_version_id=NULL WHERE id=?",pending);
        code(()->service.create(project,owner,input(List.of(pending),List.of(recipient)),requestId),"FILE_NOT_AVAILABLE");
        var h=draft();jdbc.update("UPDATE app_users SET enabled=false WHERE id=?",recipient);
        code(()->service.publish(h.id(),owner,requestId),"RECIPIENT_UNAVAILABLE");assertThat(audits("HANDOVER_PUBLISHED")).isZero();
    }
    @Test void publicationHeadFailuresNeverReportReady() {
        var h=draft();var ref=repository.version(project,version).orElseThrow().ref();VersionHead valid=storage.heads.remove(ref);
        code(()->service.publish(h.id(),owner,requestId),"OBJECT_NOT_READY");storage.fail=true;
        code(()->service.publish(h.id(),owner,requestId),"STORAGE_UNAVAILABLE");storage.fail=false;
        storage.heads.put(ref,new VersionHead(new ObjectRef(ref.bucket(),ref.objectKey(),"wrong"),10,"text/plain",false));
        code(()->service.publish(h.id(),owner,requestId),"STORAGE_UNAVAILABLE");
        storage.heads.put(ref,new VersionHead(ref,11,"text/plain",false));code(()->service.publish(h.id(),owner,requestId),"UPLOAD_OBJECT_INVALID");
        storage.heads.put(ref,new VersionHead(ref,10,"text/plain",true));code(()->service.publish(h.id(),owner,requestId),"OBJECT_NOT_READY");
        assertThat(service.get(h.id(),owner).status()).isEqualTo("DRAFT");assertThat(audits("HANDOVER_PUBLISHED")).isZero();
        storage.heads.put(ref,valid);assertThat(service.publish(h.id(),owner,requestId).status()).isEqualTo("READY");
    }
    @Test void externalRecipientGetsOnlyNamedPackageAndItem() throws Exception {
        var h=ready();MockHttpSession external=login("recipient"),outside=login("stranger");
        String base="/api/v1/handovers/"+h.id();
        mvc.perform(get(base).session(external)).andExpect(status().isOk());
        mvc.perform(get("/api/v1/projects/"+project).session(external)).andExpect(status().isNotFound());
        mvc.perform(get("/api/v1/projects/"+project+"/files").session(external)).andExpect(status().isNotFound());
        mvc.perform(get(base).session(outside)).andExpect(status().isNotFound());
        mvc.perform(get(base).session(login("editor"))).andExpect(status().isNotFound());
        mvc.perform(post(base+"/publish").session(login("editor")).with(csrf())).andExpect(status().isForbidden());
        code(()->service.confirm(h.id(),owner,requestId),"HANDOVER_NOT_FOUND");
        code(()->service.download(h.id(),UUID.randomUUID(),recipient),"FILE_NOT_FOUND");
        jdbc.update("UPDATE handover_recipients SET access_status='REVOKED' WHERE handover_id=? AND user_id=?",h.id(),recipient);
        code(()->service.get(h.id(),recipient),"HANDOVER_NOT_FOUND");code(()->service.confirm(h.id(),recipient,requestId),"HANDOVER_NOT_FOUND");
    }
    @Test void expiryBoundaryRejectsNewAccessAndConfirmation() {
        var h=ready();clock.now=h.expiresAt();int heads=storage.headCalls.get();
        code(()->service.get(h.id(),recipient),"HANDOVER_EXPIRED");code(()->service.download(h.id(),version,owner),"HANDOVER_EXPIRED");
        code(()->service.confirm(h.id(),recipient,requestId),"HANDOVER_EXPIRED");code(()->service.publish(h.id(),owner,requestId),"HANDOVER_EXPIRED");
        assertThat(storage.headCalls.get()).isEqualTo(heads);assertThat(service.get(h.id(),owner).status()).isEqualTo("READY");assertThat(audits("HANDOVER_CONFIRMED")).isZero();
    }
    @Test void revokeIsIdempotentAndPreservesConfirmationHistory() {
        var h=ready();var confirmed=service.confirm(h.id(),recipient,requestId);
        assertThat(service.revoke(h.id(),owner,requestId).accessStatus()).isEqualTo("REVOKED");service.revoke(h.id(),owner,requestId);
        code(()->service.download(h.id(),version,owner),"HANDOVER_REVOKED");code(()->service.get(h.id(),recipient),"HANDOVER_REVOKED");
        code(()->service.confirm(h.id(),recipient2,requestId),"HANDOVER_REVOKED");
        assertThat(service.get(h.id(),owner).recipients().stream().filter(r->r.userId().equals(recipient)).findFirst().orElseThrow().confirmedAt()).isEqualTo(confirmed.confirmedAt());
        assertThat(audits("HANDOVER_REVOKED")).isEqualTo(1);
    }
    @Test void concurrentPublishAndConfirmRemainIdempotent() throws Exception {
        var h=draft();CyclicBarrier head=new CyclicBarrier(4);storage.onHead=()->await(head);
        try(var pool=Executors.newFixedThreadPool(4)) {
            List<Future<Handover>> jobs=new ArrayList<>();for(int i=0;i<4;i++)jobs.add(pool.submit(()->service.publish(h.id(),owner,requestId)));
            for(var job:jobs)assertThat(job.get(20,TimeUnit.SECONDS).status()).isEqualTo("READY");
        }
        assertThat(audits("HANDOVER_PUBLISHED")).isEqualTo(1);
        try(var pool=Executors.newFixedThreadPool(6)) {
            CyclicBarrier start=new CyclicBarrier(6);List<Future<Confirmation>> jobs=new ArrayList<>();
            for(int i=0;i<6;i++){UUID actor=i%2==0?recipient:recipient2;jobs.add(pool.submit(()->{await(start);return service.confirm(h.id(),actor,requestId);}));}
            for(var job:jobs)assertThat(job.get(20,TimeUnit.SECONDS).status()).isEqualTo("CONFIRMED");
        }
        assertThat(service.get(h.id(),owner).status()).isEqualTo("CONFIRMED");assertThat(audits("HANDOVER_CONFIRMED")).isEqualTo(2);
    }
    @Test void revokeOrExpiryDuringHeadCannotPublish() {
        var h=draft();storage.onHead=()->service.revoke(h.id(),owner,requestId);
        code(()->service.publish(h.id(),owner,requestId),"HANDOVER_REVOKED");assertThat(service.get(h.id(),owner).status()).isEqualTo("DRAFT");
        storage.onHead=()->{};var second=draft();storage.onHead=()->clock.advance(120);
        code(()->service.publish(second.id(),owner,requestId),"HANDOVER_EXPIRED");assertThat(service.get(second.id(),owner).status()).isEqualTo("DRAFT");assertThat(audits("HANDOVER_PUBLISHED")).isZero();
    }
    @Test void signerCannotExtendLifetimeOrBypassRevoke() {
        var h=ready();storage.overlong=true;code(()->service.download(h.id(),version,recipient),"STORAGE_UNAVAILABLE");
        storage.overlong=false;storage.insecure=true;code(()->service.download(h.id(),version,recipient),"STORAGE_UNAVAILABLE");
        storage.insecure=false;storage.onGet=()->service.revoke(h.id(),owner,requestId);
        code(()->service.download(h.id(),version,recipient),"HANDOVER_REVOKED");assertThat(service.get(h.id(),owner).accessStatus()).isEqualTo("REVOKED");
    }
    @Test void httpRejectsForgedFieldsBadTypesNoBodyCsrfAndDisabledSession() throws Exception {
        MockHttpSession session=login("owner");String path="/api/v1/projects/"+project+"/handovers";String valid=json.writeValueAsString(input(List.of(version),List.of(recipient)));
        for(String bad:List.of("{}",valid.replace("\"title\":\"Goi ban giao\"","\"title\":12"),valid.replace("\"title\":\"Goi ban giao\"","\"title\":null"),
                valid.replace("\"fileVersionIds\":[\""+version+"\"]","\"fileVersionIds\":[null]"),valid.substring(0,valid.length()-1)+",\"createdBy\":\""+stranger+"\"}",
                "{\"title\":\"x\",\"fileVersionIds\":[\""+version+"\"],\"recipientUserIds\":[\""+recipient+"\"],\"expiresAt\":123}"))
            mvc.perform(post(path).session(session).with(csrf()).contentType("application/json").content(bad)).andExpect(status().isBadRequest());
        mvc.perform(post(path).session(session).contentType("application/json").content(valid)).andExpect(status().isForbidden());
        mvc.perform(post(path).session(session).with(csrf()).contentType("text/plain").content(valid)).andExpect(status().isUnsupportedMediaType());
        var h=draft();String base="/api/v1/handovers/"+h.id();
        mvc.perform(post(base+"/publish").session(session).with(csrf()).contentType("application/json").content("{\"status\":\"READY\"}")).andExpect(status().isBadRequest());
        mvc.perform(get(base)).andExpect(status().isUnauthorized());
        jdbc.update("UPDATE app_users SET enabled=false WHERE id=?",owner);
        mvc.perform(post(base+"/publish").session(session).with(csrf())).andExpect(status().isUnauthorized()).andExpect(jsonPath("$.code").value("ACCOUNT_DISABLED"));
        assertThat(audits("HANDOVER_PUBLISHED")).isZero();
    }
    @Test void realTcpWorkflowMatchesOpenApiAndSupportsOutsideRecipient() throws Exception {
        try(var ownerClient=client();var recipientClient=client()) {
            String ownerCsrf=tcpLogin(ownerClient,"owner"),recipientCsrf=tcpLogin(recipientClient,"recipient");
            JsonNode created=http(ownerClient,"POST","/api/v1/projects/"+project+"/handovers",json.writeValueAsString(input(List.of(version),List.of(recipient))),ownerCsrf,201,"Handover");
            String base="/api/v1/handovers/"+created.get("id").asText();
            http(ownerClient,"POST",base+"/publish",null,ownerCsrf,200,"Handover");
            http(recipientClient,"GET",base,null,null,200,"Handover");
            assertThat(http(recipientClient,"GET",base+"/items/"+version+"/download",null,null,200,"Download").get("versionId").asText()).isEqualTo("v1+opaque/=");
            http(recipientClient,"POST",base+"/confirm",null,recipientCsrf,200,"Confirmation");
            assertThat(http(ownerClient,"GET",base,null,null,200,"Handover").get("status").asText()).isEqualTo("CONFIRMED");
            http(ownerClient,"POST",base+"/revoke",null,ownerCsrf,200,"Handover");
            http(recipientClient,"POST",base+"/confirm",null,recipientCsrf,409,"Error");
            http(recipientClient,"GET","/api/v1/projects/"+project,null,null,404,"Error");
        }
    }
    HttpClient client() {return HttpClient.newBuilder().cookieHandler(new CookieManager(null,CookiePolicy.ACCEPT_ALL)).connectTimeout(Duration.ofSeconds(5)).build();}
    String tcpLogin(HttpClient client,String name) throws Exception {
        String csrf=http(client,"GET","/api/v1/auth/csrf",null,null,200,"Csrf").get("token").asText();
        var request=HttpRequest.newBuilder(URI.create("http://127.0.0.1:"+port+"/api/v1/auth/login")).timeout(Duration.ofSeconds(10)).header("X-CSRF-TOKEN",csrf)
                .header("Content-Type","application/x-www-form-urlencoded").POST(HttpRequest.BodyPublishers.ofString("email="+name+"%40example.com&password="+URLEncoder.encode(password,StandardCharsets.UTF_8))).build();
        assertThat(client.send(request,HttpResponse.BodyHandlers.discarding()).statusCode()).isEqualTo(200);
        return http(client,"GET","/api/v1/auth/csrf",null,null,200,"Csrf").get("token").asText();
    }
    JsonNode http(HttpClient client,String method,String path,String body,String token,int expected,String schema) throws Exception {
        var request=HttpRequest.newBuilder(URI.create("http://127.0.0.1:"+port+path)).timeout(Duration.ofSeconds(10));
        if(token!=null) request.header("X-CSRF-TOKEN",token);if(body!=null)request.header("Content-Type","application/json");
        request.method(method,body==null?HttpRequest.BodyPublishers.noBody():HttpRequest.BodyPublishers.ofString(body));
        var response=client.send(request.build(),HttpResponse.BodyHandlers.ofString());
        assertThat(response.statusCode()).as(method+" "+path).isEqualTo(expected);assertThat(response.headers().firstValue("X-Request-Id")).isPresent();
        JsonNode parsed=json.readTree(response.body());assertThat(new ContractTest().schema(schema).validate(parsed)).as(schema).isEmpty();return parsed;
    }
    static void await(CyclicBarrier barrier) {try{barrier.await(10,TimeUnit.SECONDS);}catch(Exception e){throw new RuntimeException(e);}}
}
