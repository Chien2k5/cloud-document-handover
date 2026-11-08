package vn.edu.uet.handover.upload;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Clock;
import java.time.Instant;
import java.util.Objects;
import java.util.UUID;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;

/** Exercises the compiled Java consumer from its JAR, with no Spring context/DB/AWS. */
public class ChecksumContractCheck {
    public static void main(String[] args) throws Exception {
        var json=new ObjectMapper();
        var cases=json.readTree(Files.readAllBytes(Path.of(args[0])));
        var service=new UploadService(null,null,null,null,Clock.systemUTC(),json,
                new DataSourceTransactionManager(),"fixture-bucket",300);
        var parser=UploadService.class.getDeclaredMethod("checksum",byte[].class,UploadRepository.Session.class);
        parser.setAccessible(true);
        int checked=0;
        for(var test:cases) {
            var ref=new StoragePort.ObjectRef(test.get("bucket").asText(),test.get("objectKey").asText(),test.get("versionId").asText());
            if(!S3StorageAdapter.resultKey(ref).equals(test.get("resultKey").asText()))
                throw new AssertionError("Python/Java result key mismatch: "+test.get("name").asText());
            UUID upload=UUID.randomUUID(),project=UUID.randomUUID();
            var version=new UploadDtos.FileVersion(UUID.randomUUID(),UUID.randomUUID(),"fixture.txt","text/plain",
                    test.get("size").asLong(),ref.versionId(),"a".repeat(64),null,"AVAILABLE","INTEGRITY_PENDING",upload);
            var session=new UploadRepository.Session(upload,project,UUID.randomUUID(),ref.bucket(),ref.objectKey(),Instant.now().plusSeconds(300),version);
            String actual=(String)parser.invoke(service,test.get("document").asText().getBytes(StandardCharsets.UTF_8),session);
            String expected=test.get("expectedHash").isNull()?null:test.get("expectedHash").asText();
            if(!Objects.equals(actual,expected))
                throw new AssertionError("Python/Java parser mismatch: "+test.get("name").asText());
            checked++;
        }
        System.out.println("PASS Java production checksum parser and result key: "+checked+" cases; no DB/AWS");
    }
}
