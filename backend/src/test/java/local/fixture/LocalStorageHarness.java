package local.fixture;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpsConfigurator;
import com.sun.net.httpserver.HttpsServer;
import com.sun.net.httpserver.HttpExchange;
import java.net.InetSocketAddress;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.KeyStore;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicInteger;
import javax.net.ssl.KeyManagerFactory;
import javax.net.ssl.SSLContext;
import org.springframework.boot.SpringApplication;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Primary;
import vn.edu.uet.handover.HandoverApplication;
import vn.edu.uet.handover.upload.StoragePort;

/** Test classpath only, outside production component scanning; never packaged in the app JAR. */
public final class LocalStorageHarness {
    public static void main(String[] args) {
        if (!"true".equals(System.getenv("RUN_BUSINESS_E2E_TEST_HARNESS"))
                || !System.getenv().getOrDefault("DB_URL", "").matches("jdbc:postgresql://127\\.0\\.0\\.1:[0-9]+/frontend_browser")
                || !"false".equals(System.getenv("UPLOAD_S3_ENABLED")))
            throw new IllegalStateException("Disposable loopback test environment required");
        SpringApplication.run(new Class<?>[]{HandoverApplication.class, FixtureConfig.class}, args);
    }

    @Configuration(proxyBeanMethods=false)
    public static class FixtureConfig {
        @Bean(destroyMethod="close") @Primary
        FixtureStorage fixtureStorage() throws Exception { return new FixtureStorage(); }
    }

    public static final class FixtureStorage implements StoragePort, AutoCloseable {
        private record Ticket(PutSpec put, ObjectRef get, Instant expires) {}
        private record Stored(ObjectRef ref, byte[] bytes, String contentType, AtomicInteger reads) {}
        private final Map<String,Ticket> tickets=new ConcurrentHashMap<>();
        private final Map<ObjectRef,Stored> objects=new ConcurrentHashMap<>();
        private final Map<String,Boolean> usedKeys=new ConcurrentHashMap<>();
        private final HttpsServer server;
        private final String origin=System.getenv("LIVE_BASE_URL");
        private final String base;

        FixtureStorage() throws Exception {
            char[] password=System.getenv("FIXTURE_KEYSTORE_PASSWORD").toCharArray();
            var keys=KeyStore.getInstance("PKCS12");
            try(var stream=Files.newInputStream(Path.of(System.getenv("FIXTURE_KEYSTORE")))) { keys.load(stream,password); }
            var manager=KeyManagerFactory.getInstance(KeyManagerFactory.getDefaultAlgorithm()); manager.init(keys,password);
            var ssl=SSLContext.getInstance("TLS"); ssl.init(manager.getKeyManagers(),null,null);
            java.util.Arrays.fill(password,'\0');
            server=HttpsServer.create(new InetSocketAddress("127.0.0.1",Integer.parseInt(System.getenv("FIXTURE_STORAGE_PORT"))),0);
            server.setHttpsConfigurator(new HttpsConfigurator(ssl));
            server.setExecutor(Executors.newVirtualThreadPerTaskExecutor());
            server.createContext("/fixture/",this::handle); server.start();
            base="https://127.0.0.1:"+server.getAddress().getPort()+"/fixture/";
        }
        private String ticket(Ticket value) { String token=UUID.randomUUID().toString(); tickets.put(token,value); return base+token; }
        @Override public SignedRequest presignPut(PutSpec spec) {
            return new SignedRequest("PUT",ticket(new Ticket(spec,null,spec.notAfter())),
                    Map.of("Content-Type",spec.contentType(),"If-None-Match","*"),spec.notAfter());
        }
        @Override public Optional<VersionHead> headVersion(ObjectRef ref) {
            return Optional.ofNullable(objects.get(ref)).map(s->new VersionHead(s.ref(),s.bytes().length,s.contentType(),false));
        }
        @Override public Optional<byte[]> readChecksum(ObjectRef ref) {
            Stored value=objects.get(ref);
            if(value==null || value.reads().getAndIncrement()==0) return Optional.empty();
            try {
                Map<String,Object> document=new LinkedHashMap<>();
                document.put("schemaVersion",1);document.put("bucket",ref.bucket());document.put("objectKey",ref.objectKey());
                document.put("versionId",ref.versionId());document.put("size",value.bytes().length);document.put("status","SUCCEEDED");
                document.put("actualSha256",HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(value.bytes())));
                document.put("errorCode",null);document.put("processedAt",Instant.now().toString());
                return Optional.of(new ObjectMapper().writeValueAsBytes(document));
            } catch(Exception e) { throw new Unavailable(); }
        }
        @Override public SignedRequest presignGet(ObjectRef ref,Instant notAfter) {
            return new SignedRequest("GET",ticket(new Ticket(null,ref,notAfter)),Map.of(),notAfter);
        }
        private void handle(HttpExchange request) throws java.io.IOException {
            try(request) {
                String suppliedOrigin=request.getRequestHeaders().getFirst("Origin");
                if(suppliedOrigin!=null && !suppliedOrigin.equals(origin)) { reply(request,403,new byte[0]);return; }
                var headers=request.getResponseHeaders();
                headers.set("Access-Control-Allow-Origin",origin);
                headers.set("Vary","Origin");headers.set("Access-Control-Allow-Methods","PUT, GET, OPTIONS");
                headers.set("Access-Control-Allow-Headers","Content-Type, If-None-Match");
                headers.set("Access-Control-Expose-Headers","x-amz-version-id");
                if(request.getRequestHeaders().getFirst("Cookie")!=null || request.getRequestHeaders().getFirst("X-CSRF-TOKEN")!=null) {
                    reply(request,400,new byte[0]);return;
                }
                Ticket ticket=tickets.get(request.getRequestURI().getPath().substring("/fixture/".length()));
                if(ticket==null || !Instant.now().isBefore(ticket.expires())) { reply(request,403,new byte[0]);return; }
                String method=request.getRequestMethod();
                if("OPTIONS".equals(method)) { request.sendResponseHeaders(204,-1);return; }
                if("PUT".equals(method) && ticket.put()!=null) {
                    PutSpec spec=ticket.put();
                    if(!spec.contentType().equals(request.getRequestHeaders().getFirst("Content-Type"))
                            || !"*".equals(request.getRequestHeaders().getFirst("If-None-Match"))) { reply(request,400,new byte[0]);return; }
                    if(spec.size()>1048576) { reply(request,413,new byte[0]);return; }
                    byte[] bytes=request.getRequestBody().readNBytes((int)spec.size()+1);
                    if(bytes.length!=spec.size()) { reply(request,400,new byte[0]);return; }
                    if(usedKeys.putIfAbsent(spec.bucket()+"/"+spec.objectKey(),true)!=null) { reply(request,412,new byte[0]);return; }
                    String version="fixture+/="+UUID.randomUUID();
                    ObjectRef ref=new ObjectRef(spec.bucket(),spec.objectKey(),version);
                    objects.put(ref,new Stored(ref,bytes,spec.contentType(),new AtomicInteger()));
                    headers.set("x-amz-version-id",version);reply(request,200,new byte[0]);return;
                }
                if("GET".equals(method) && ticket.get()!=null) {
                    Stored value=objects.get(ticket.get());
                    if(value==null) { reply(request,404,new byte[0]);return; }
                    headers.set("Content-Type",value.contentType());
                    headers.set("Content-Disposition","attachment; filename=fixture.bin");
                    reply(request,200,value.bytes());return;
                }
                reply(request,405,new byte[0]);
            }
        }
        private void reply(HttpExchange request,int status,byte[] bytes) throws java.io.IOException {
            request.sendResponseHeaders(status,bytes.length==0?-1:bytes.length);
            if(bytes.length>0) request.getResponseBody().write(bytes);
        }
        @Override public void close() { server.stop(0); }
    }
}
