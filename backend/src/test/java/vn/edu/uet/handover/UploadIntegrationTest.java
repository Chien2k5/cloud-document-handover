package vn.edu.uet.handover;

import static org.assertj.core.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.charset.StandardCharsets;
import java.time.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.context.annotation.Primary;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.web.servlet.MockMvc;
import vn.edu.uet.handover.common.ApiException;
import vn.edu.uet.handover.project.ProjectDtos.CreateProject;
import vn.edu.uet.handover.project.ProjectService;
import vn.edu.uet.handover.upload.*;
import vn.edu.uet.handover.upload.StoragePort.*;
import vn.edu.uet.handover.upload.UploadDtos.*;

/** Real PostgreSQL/transactions + test-only storage port. This is NOT an AWS test. */
@SpringBootTest(webEnvironment=SpringBootTest.WebEnvironment.RANDOM_PORT,
    properties={"app.upload.bucket=fixture-bucket","app.upload.expiry-delay-ms=3600000","server.servlet.session.cookie.secure=false"})
@AutoConfigureMockMvc
@Import(UploadIntegrationTest.Fixture.class)
@EnabledIfEnvironmentVariable(named="RUN_DB_TESTS",matches="true")
class UploadIntegrationTest {
    @TestConfiguration static class Fixture {
        @Bean @Primary FakeStorage fakeStorage() { return new FakeStorage(); }
        @Bean @Primary MutableClock testClock() { return new MutableClock(); }
    }
    static class MutableClock extends Clock {
        volatile Instant now=Instant.now();
        public ZoneId getZone() { return ZoneOffset.UTC; }
        public Clock withZone(ZoneId zone) { return this; }
        public Instant instant() { return now; }
        void advance(long seconds) { now=now.plusSeconds(seconds); }
    }
    static class FakeStorage implements StoragePort {
        final Map<ObjectRef,VersionHead> heads=new ConcurrentHashMap<>();
        final Map<ObjectRef,byte[]> results=new ConcurrentHashMap<>();
        volatile boolean fail=false, unsafePut=false;
        volatile Runnable onHead=()->{};
        volatile Runnable onRead=()->{};
        final AtomicInteger reads=new AtomicInteger(),headCalls=new AtomicInteger();
        public SignedRequest presignPut(PutSpec s) {
            if(fail) throw new Unavailable();
            return new SignedRequest("PUT","https://storage.invalid/fixture",unsafePut?Map.of("Content-Type",s.contentType()):
                    Map.of("Content-Type",s.contentType(),"If-None-Match","*"),s.notAfter());
        }
        public Optional<VersionHead> headVersion(ObjectRef ref) {
            headCalls.incrementAndGet(); onHead.run();
            if(fail) throw new Unavailable();
            return Optional.ofNullable(heads.get(ref));
        }
        public Optional<byte[]> readChecksum(ObjectRef ref) {
            reads.incrementAndGet(); if(fail) throw new Unavailable();
            Optional<byte[]> snapshot=Optional.ofNullable(results.get(ref)); onRead.run(); return snapshot;
        }
        public SignedRequest presignGet(ObjectRef ref,Instant until) {
            if(fail) throw new Unavailable();
            return new SignedRequest("GET","https://storage.invalid/fixture?versionId="+ref.versionId(),Map.of(),until);
        }
    }
    @Autowired UploadService service;
    @Autowired UploadRepository repository;
    @Autowired ProjectService projects;
    @Autowired JdbcTemplate jdbc;
    @Autowired MockMvc mvc;
    @Autowired ObjectMapper json;
    @Autowired PasswordEncoder passwords;
    @Autowired FakeStorage storage;
    @Autowired MutableClock clock;
    @org.springframework.boot.test.web.server.LocalServerPort int serverPort;
    UUID owner,editor,viewer,outsider,project,other;
    String password;
    final String requestId=UUID.randomUUID().toString();
    final String sha="a".repeat(64);

    @BeforeEach void seed() throws Exception {
        jdbc.execute("TRUNCATE app_users,projects,memberships,file_metadata,file_versions,upload_sessions,handovers,handover_items,handover_recipients,audit_events CASCADE");
        clock.now=Instant.now(); storage.heads.clear(); storage.results.clear(); storage.fail=false; storage.unsafePut=false;
        storage.onHead=()->{}; storage.onRead=()->{}; storage.reads.set(0); storage.headCalls.set(0);
        password=UUID.randomUUID().toString();
        String hash=passwords.encode(password);
        owner=user("owner",hash); editor=user("editor",hash); viewer=user("viewer",hash); outsider=user("outsider",hash);
        CreateProject input=json.readValue("{\"name\":\"Upload fixture\"}",CreateProject.class);
        project=projects.create(owner,input,requestId).id(); other=projects.create(outsider,input,requestId).id();
        jdbc.update("INSERT INTO memberships(project_id,user_id,role) VALUES (?,?,'EDITOR'),(?,?,'VIEWER')",project,editor,project,viewer);
    }
    UUID user(String name,String hash) {
        UUID id=UUID.randomUUID(); jdbc.update("INSERT INTO app_users(id,email,display_name,password_hash) VALUES (?,?,?,?)",id,name+"@example.com",name,hash); return id;
    }
    UploadRequest request(long size,UUID file) { return new UploadRequest("report.txt","text/plain",size,sha,file); }
    UploadCreated init() { return service.init(project,owner,request(10,null),requestId); }
    ObjectRef object(UploadCreated u,String version) {
        var s=repository.session(project,u.uploadId()).orElseThrow(); return new ObjectRef(s.bucket(),s.key(),version);
    }
    void put(UploadCreated u,String version,long size) { ObjectRef ref=object(u,version); storage.heads.put(ref,new VersionHead(ref,size,"text/plain",false)); }
    void complete(UploadCreated u,String version) { put(u,version,10); service.complete(project,u.uploadId(),owner,version,requestId); }
    byte[] result(ObjectRef ref,String actual) throws Exception {
        Map<String,Object> n=new LinkedHashMap<>();
        n.put("schemaVersion",1);n.put("bucket",ref.bucket());n.put("objectKey",ref.objectKey());n.put("versionId",ref.versionId());
        n.put("size",10);n.put("status","SUCCEEDED");n.put("actualSha256",actual);n.put("errorCode",null);n.put("processedAt",clock.instant().toString());
        return json.writeValueAsBytes(n);
    }
    void code(Runnable r,String expected) { assertThatThrownBy(r::run).isInstanceOfSatisfying(ApiException.class,e->assertThat(e.code()).isEqualTo(expected)); }
    void counters(long used,long reserved) {
        var p=projects.get(project,owner); assertThat(p.usedBytes()).isEqualTo(used);assertThat(p.reservedBytes()).isEqualTo(reserved);
    }
    MockHttpSession login(String name) throws Exception {
        return (MockHttpSession)mvc.perform(post("/api/v1/auth/login").with(csrf()).param("email",name+"@example.com").param("password",password))
                .andExpect(status().isOk()).andReturn().getRequest().getSession(false);
    }
    String base() { return "/api/v1/projects/"+project+"/files"; }

    @Test void initCompleteChecksumDownloadAndVersionHistory() throws Exception {
        UploadCreated u=init(); counters(0,10);
        assertThat(service.state(project,u.uploadId(),owner).fileVersion().uploadStatus()).isEqualTo("PENDING");
        complete(u,"opaque+v1/="); counters(10,0);
        assertThat(service.state(project,u.uploadId(),viewer).fileVersion().integrityStatus()).isEqualTo("INTEGRITY_PENDING");
        code(()->service.download(project,u.fileVersionId(),viewer),"FILE_NOT_VERIFIED");
        storage.results.put(object(u,"opaque+v1/="),result(object(u,"opaque+v1/="),sha));
        assertThat(service.state(project,u.uploadId(),viewer).fileVersion().integrityStatus()).isEqualTo("VERIFIED");
        int heads=storage.headCalls.get(); clock.advance(301);
        assertThat(service.complete(project,u.uploadId(),owner,"opaque+v1/=",requestId).fileVersion().integrityStatus()).isEqualTo("VERIFIED");
        assertThat(storage.headCalls.get()).isEqualTo(heads); counters(10,0);
        code(()->service.complete(project,u.uploadId(),owner,"v2",requestId),"UPLOAD_ALREADY_COMPLETED");
        assertThat(service.download(project,u.fileVersionId(),viewer).versionId()).isEqualTo("opaque+v1/=");
        UploadCreated v2=service.init(project,owner,request(10,u.fileId()),requestId); complete(v2,"v2");
        assertThat(v2.fileId()).isEqualTo(u.fileId()); assertThat(v2.fileVersionId()).isNotEqualTo(u.fileVersionId());
        assertThat(object(v2,"v2").objectKey()).isNotEqualTo(object(u,"v2").objectKey());
        assertThat(service.list(project,viewer,0,20).items()).hasSize(2);
        assertThat(service.download(project,u.fileVersionId(),viewer).versionId()).isEqualTo("opaque+v1/="); counters(20,0);
        UploadCreated separate=init(); assertThat(separate.fileId()).isNotEqualTo(u.fileId()); counters(20,10);
    }
    @Test void missingInvalidStorageOutageAndExpiryReleaseOnce() {
        UploadCreated u=init();
        code(()->service.complete(project,u.uploadId(),owner,"missing",requestId),"OBJECT_NOT_READY");counters(0,10);
        storage.fail=true; code(()->service.complete(project,u.uploadId(),owner,"v1",requestId),"STORAGE_UNAVAILABLE");counters(0,10);storage.fail=false;
        put(u,"v1",11); code(()->service.complete(project,u.uploadId(),owner,"v1",requestId),"UPLOAD_OBJECT_INVALID"); counters(0,0);
        code(()->service.complete(project,u.uploadId(),owner,"v1",requestId),"UPLOAD_FAILED");counters(0,0);
        UploadCreated exp=init(); clock.advance(300);
        code(()->service.complete(project,exp.uploadId(),owner,"v1",requestId),"UPLOAD_EXPIRED");counters(0,0);
        service.expire();service.expire(); counters(0,0);
        assertThat(service.state(project,exp.uploadId(),owner).fileVersion().uploadStatus()).isEqualTo("EXPIRED");
    }
    @Test void failedPresignCompensatesAndUnsafeReplayableSigningFailsClosed() {
        storage.fail=true; code(this::init,"STORAGE_UNAVAILABLE"); counters(0,0);
        storage.fail=false;storage.unsafePut=true; code(this::init,"STORAGE_UNAVAILABLE");counters(0,0);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM file_versions WHERE upload_status='FAILED'",Integer.class)).isEqualTo(2);
    }
    @Test void checksumMalformedWrongIdentityAndTerminalStates() throws Exception {
        UploadCreated u=init();complete(u,"v1");ObjectRef ref=object(u,"v1");
        String valid=new String(result(ref,sha),StandardCharsets.UTF_8);
        for(String bad:List.of("{}","null",valid.replace("\"versionId\":\"v1\"","\"versionId\":\"v2\""),
                valid.replace("\"size\":10","\"size\":11"),valid.replace("\"schemaVersion\":1","\"schemaVersion\":4294967297"),
                valid.replace("\"status\":\"SUCCEEDED\"","\"status\":\"FAILED\""),valid+"{}",
                valid.replace("\"schemaVersion\":1","\"schemaVersion\":1,\"schemaVersion\":1")," ".repeat(65537))) {
            storage.results.put(ref,bad.getBytes(StandardCharsets.UTF_8));
            assertThat(service.state(project,u.uploadId(),owner).fileVersion().integrityStatus()).isEqualTo("FAILED");counters(10,0);
        }
        storage.results.remove(ref);assertThat(service.state(project,u.uploadId(),owner).fileVersion().integrityStatus()).isEqualTo("FAILED");
        storage.results.put(ref,result(ref,"b".repeat(64)));
        assertThat(service.state(project,u.uploadId(),owner).fileVersion().integrityStatus()).isEqualTo("MISMATCH");
        int reads=storage.reads.get();storage.results.put(ref,result(ref,sha));
        assertThat(service.state(project,u.uploadId(),owner).fileVersion().integrityStatus()).isEqualTo("MISMATCH");
        assertThat(storage.reads.get()).isEqualTo(reads);code(()->service.download(project,u.fileVersionId(),owner),"FILE_NOT_VERIFIED");
    }
    @Test void rightsCurrentMembershipAndCrossProjectIds() {
        code(()->service.init(project,viewer,request(10,null),requestId),"UPLOAD_FORBIDDEN");
        code(()->service.init(project,outsider,request(10,null),requestId),"PROJECT_NOT_FOUND");
        UploadCreated u=init();put(u,"v1",10);
        code(()->service.complete(project,u.uploadId(),editor,"v1",requestId),"UPLOAD_OWNER_REQUIRED");
        code(()->service.state(other,u.uploadId(),outsider),"UPLOAD_NOT_FOUND");
        code(()->service.download(other,u.fileVersionId(),outsider),"FILE_NOT_FOUND");
        code(()->service.init(other,outsider,request(10,u.fileId()),requestId),"FILE_NOT_FOUND");
        code(()->service.init(project,owner,new UploadRequest("renamed","text/plain",10L,sha,u.fileId()),requestId),"FILE_NAME_CONFLICT");
        storage.onHead=()->jdbc.update("DELETE FROM memberships WHERE project_id=? AND user_id=?",project,owner);
        code(()->service.complete(project,u.uploadId(),owner,"v1",requestId),"PROJECT_NOT_FOUND");
        assertThat(repository.session(project,u.uploadId()).orElseThrow().version().uploadStatus()).isEqualTo("PENDING");
    }
    @Test void quotaConcurrentReservationsUseRealSeparateTransactions() throws Exception {
        jdbc.update("UPDATE projects SET quota_bytes=50 WHERE id=?",project);
        try(var pool=Executors.newFixedThreadPool(8)) {
            CyclicBarrier start=new CyclicBarrier(8);List<Future<Boolean>> jobs=new ArrayList<>();
            for(int i=0;i<8;i++) jobs.add(pool.submit(()-> { start.await(10,TimeUnit.SECONDS);try {init();return true;}catch(ApiException e){assertThat(e.code()).isEqualTo("QUOTA_EXCEEDED");return false;} }));
            int successes=0;for(var job:jobs) if(job.get(20,TimeUnit.SECONDS)) successes++;
            assertThat(successes).isEqualTo(5);counters(0,50);
        }
        clock.advance(300);service.expire();counters(0,0);init();counters(0,10);
    }
    @Test void concurrentCompleteOnlyMovesQuotaAndAuditsOnce() throws Exception {
        UploadCreated u=init();put(u,"v1",10);CyclicBarrier heads=new CyclicBarrier(6);
        storage.onHead=()-> {try{heads.await(10,TimeUnit.SECONDS);}catch(Exception e){throw new RuntimeException(e);}};
        try(var pool=Executors.newFixedThreadPool(6)) {
            List<Future<UploadState>> jobs=new ArrayList<>();
            for(int i=0;i<6;i++) jobs.add(pool.submit(()->service.complete(project,u.uploadId(),owner,"v1",requestId)));
            for(var job:jobs) assertThat(job.get(20,TimeUnit.SECONDS).fileVersion().uploadStatus()).isEqualTo("AVAILABLE");
        }
        counters(10,0);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM audit_events WHERE action='UPLOAD_COMPLETED'",Integer.class)).isEqualTo(1);
    }
    @Test void expiryWinsWhileHeadIsInFlightWithoutDoubleRelease() throws Exception {
        UploadCreated u=init();put(u,"v1",10);CountDownLatch entered=new CountDownLatch(1),resume=new CountDownLatch(1);
        storage.onHead=()-> {entered.countDown();try{assertThat(resume.await(10,TimeUnit.SECONDS)).isTrue();}catch(InterruptedException e){throw new RuntimeException(e);}};
        try(var pool=Executors.newSingleThreadExecutor()) {
            Future<?> job=pool.submit(()->code(()->service.complete(project,u.uploadId(),owner,"v1",requestId),"UPLOAD_EXPIRED"));
            try {assertThat(entered.await(10,TimeUnit.SECONDS)).isTrue();clock.advance(300);service.expire();counters(0,0);}
            finally {resume.countDown();}
            job.get(15,TimeUnit.SECONDS);
        }
        counters(0,0);service.expire();counters(0,0);
    }
    @Test void databaseRollbackLeavesNoReservationOrMetadata() {
        assertThatThrownBy(()->service.init(project,owner,request(10,null),"x".repeat(37))).isInstanceOf(org.springframework.dao.DataIntegrityViolationException.class);
        counters(0,0);
        for(String table:List.of("file_metadata","file_versions","upload_sessions")) assertThat(jdbc.queryForObject("SELECT count(*) FROM "+table,Integer.class)).isZero();
    }
    @Test void staleConcurrentPollCannotOverwriteVerifiedResult() throws Exception {
        UploadCreated u=init();complete(u,"v1");ObjectRef ref=object(u,"v1");
        storage.results.put(ref,"{}".getBytes(StandardCharsets.UTF_8));
        CountDownLatch entered=new CountDownLatch(1),resume=new CountDownLatch(1);
        storage.onRead=()-> {
            if(Thread.currentThread().getName().equals("stale-poll")) {
                entered.countDown();try {assertThat(resume.await(10,TimeUnit.SECONDS)).isTrue();}catch(InterruptedException e){throw new RuntimeException(e);}
            }
        };
        try(var pool=Executors.newSingleThreadExecutor(Thread.ofPlatform().name("stale-poll").factory())) {
            Future<UploadState> stale=pool.submit(()->service.state(project,u.uploadId(),owner));
            try {
                assertThat(entered.await(10,TimeUnit.SECONDS)).isTrue();storage.results.put(ref,result(ref,sha));
                assertThat(service.state(project,u.uploadId(),owner).fileVersion().integrityStatus()).isEqualTo("VERIFIED");
            } finally {resume.countDown();}
            assertThat(stale.get(15,TimeUnit.SECONDS).fileVersion().integrityStatus()).isEqualTo("VERIFIED");
        }
        assertThat(service.state(project,u.uploadId(),owner).fileVersion().actualSha256()).isEqualTo(sha);counters(10,0);
    }
    @Test void httpStrictInputsCsrfPermissionsAndResponseContract() throws Exception {
        MockHttpSession session=login("owner");
        String valid=json.writeValueAsString(request(10,null));
        // Optional fileId must be omitted, not explicitly null.
        valid=valid.replace(",\"fileId\":null","");
        for(String bad:List.of("{}",valid.replace("\"size\":10","\"size\":\"10\""),valid.replace("\"size\":10","\"size\":10.5"),
                valid.replace("\"filename\":\"report.txt\"","\"filename\":123"),valid.replace("\"filename\":\"report.txt\"","\"filename\":null"),
                valid.replace("\"size\":10","\"size\":0"),valid.replace("\"size\":10","\"size\":104857601"),
                valid.substring(0,valid.length()-1)+",\"fileId\":null}",valid.substring(0,valid.length()-1)+",\"integrityStatus\":\"VERIFIED\"}"))
            mvc.perform(post(base()+"/uploads").session(session).with(csrf()).contentType("application/json").content(bad)).andExpect(status().isBadRequest());
        counters(0,0);
        mvc.perform(post(base()+"/uploads").session(session).contentType("application/json").content(valid)).andExpect(status().isForbidden());
        mvc.perform(post(base()+"/uploads").session(session).with(csrf()).contentType("text/plain").content(valid)).andExpect(status().isUnsupportedMediaType());
        JsonNode created=json.readTree(mvc.perform(post(base()+"/uploads").session(session).with(csrf()).contentType("application/json").content(valid))
                .andExpect(status().isCreated()).andExpect(jsonPath("$.presignedUpload.headers.If-None-Match").value("*"))
                .andReturn().getResponse().getContentAsString());
        UUID upload=UUID.fromString(created.get("uploadId").asText());
        for(String bad:List.of("{}","{\"versionId\":123}","{\"versionId\":\"null\"}","{\"versionId\":\" \"}"))
            mvc.perform(post(base()+"/uploads/"+upload+"/complete").session(session).with(csrf()).contentType("application/json").content(bad)).andExpect(status().isBadRequest());
        mvc.perform(get(base()+"/uploads/"+upload).session(session)).andExpect(status().isOk()).andExpect(jsonPath("$.fileVersion.uploadStatus").value("PENDING"));
        mvc.perform(get(base()).session(login("viewer"))).andExpect(status().isOk()).andExpect(jsonPath("$.items.length()").value(1));
        mvc.perform(post(base()+"/uploads").session(login("viewer")).with(csrf()).contentType("application/json").content(valid)).andExpect(status().isForbidden());
        mvc.perform(get(base()).session(login("outsider"))).andExpect(status().isNotFound());
        mvc.perform(get(base())).andExpect(status().isUnauthorized());
        mvc.perform(get(base()+"?size=101").session(session)).andExpect(status().isBadRequest());
        jdbc.update("UPDATE app_users SET enabled=false WHERE id=?",owner);
        mvc.perform(get(base()).session(session)).andExpect(status().isUnauthorized()).andExpect(jsonPath("$.code").value("ACCOUNT_DISABLED"));
    }

    @Test void realTcpCookieCsrfUploadCompleteIntegrityAndDownload() throws Exception {
        var cookies=new java.net.CookieManager(null,java.net.CookiePolicy.ACCEPT_ALL);
        try(var client=java.net.http.HttpClient.newBuilder().cookieHandler(cookies).connectTimeout(Duration.ofSeconds(5)).build()) {
            var csrf=http(client,"GET","/api/v1/auth/csrf",null,null,null,200).get("token").asText();
            String form="email=owner%40example.com&password="+java.net.URLEncoder.encode(password,StandardCharsets.UTF_8);
            http(client,"POST","/api/v1/auth/login",form,"application/x-www-form-urlencoded",csrf,200);
            csrf=http(client,"GET","/api/v1/auth/csrf",null,null,null,200).get("token").asText();
            String input=json.writeValueAsString(request(10,null)).replace(",\"fileId\":null","");
            JsonNode created=http(client,"POST",base()+"/uploads",input,"application/json",csrf,201);
            UploadCreated u=new UploadCreated(UUID.fromString(created.get("uploadId").asText()),UUID.fromString(created.get("fileId").asText()),
                    UUID.fromString(created.get("fileVersionId").asText()),"PENDING","INTEGRITY_PENDING",null);
            // Byte storage and Lambda result are explicit fake fixtures, not S3/Lambda execution.
            put(u,"tcp-v1",10);
            http(client,"POST",base()+"/uploads/"+u.uploadId()+"/complete","{\"versionId\":\"tcp-v1\"}","application/json",csrf,200);
            assertThat(http(client,"GET",base()+"/uploads/"+u.uploadId(),null,null,null,200).at("/fileVersion/integrityStatus").asText()).isEqualTo("INTEGRITY_PENDING");
            http(client,"GET",base()+"/"+u.fileVersionId()+"/download",null,null,null,409);
            storage.results.put(object(u,"tcp-v1"),result(object(u,"tcp-v1"),sha));
            assertThat(http(client,"GET",base()+"/uploads/"+u.uploadId(),null,null,null,200).at("/fileVersion/integrityStatus").asText()).isEqualTo("VERIFIED");
            assertThat(http(client,"GET",base()+"/"+u.fileVersionId()+"/download",null,null,null,200).get("versionId").asText()).isEqualTo("tcp-v1");
            assertThat(http(client,"GET",base(),null,null,null,200).get("items").size()).isEqualTo(1);
            http(client,"POST",base()+"/uploads/"+u.uploadId()+"/complete","{\"versionId\":\"tcp-v1\"}","application/json",csrf,200);
            counters(10,0);
            http(client,"POST","/api/v1/auth/logout","","application/x-www-form-urlencoded",csrf,204);
            http(client,"GET",base(),null,null,null,401);
        }
    }
    JsonNode http(java.net.http.HttpClient client,String method,String path,String body,String type,String token,int expected) throws Exception {
        var b=java.net.http.HttpRequest.newBuilder(java.net.URI.create("http://127.0.0.1:"+serverPort+path)).timeout(Duration.ofSeconds(10));
        if(type!=null) b.header("Content-Type",type);
        if(token!=null) b.header("X-CSRF-TOKEN",token);
        b.method(method,body==null?java.net.http.HttpRequest.BodyPublishers.noBody():java.net.http.HttpRequest.BodyPublishers.ofString(body));
        var response=client.send(b.build(),java.net.http.HttpResponse.BodyHandlers.ofString());
        assertThat(response.statusCode()).as(method+" "+path).isEqualTo(expected);
        assertThat(response.headers().firstValue("X-Request-Id")).isPresent();
        JsonNode parsed=response.body().isEmpty()?json.nullNode():json.readTree(response.body());
        String schema=expected>=400?"Error":path.endsWith("/auth/csrf")?"Csrf":path.endsWith("/auth/login")?"User":
                path.endsWith("/download")?"Download":path.endsWith("/uploads")?"UploadCreated":
                path.contains("/uploads/")?"UploadState":path.equals(base())?"FilePage":null;
        if(schema!=null) assertThat(new ContractTest().schema(schema).validate(parsed)).as("HTTP response schema "+schema).isEmpty();
        return parsed;
    }
}
