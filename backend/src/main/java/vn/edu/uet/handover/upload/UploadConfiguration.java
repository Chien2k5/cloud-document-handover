package vn.edu.uet.handover.upload;

import java.time.Clock;
import java.time.Instant;
import java.util.Optional;
import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.EnableScheduling;

@Configuration
@EnableScheduling
public class UploadConfiguration {
    @Bean @ConditionalOnMissingBean(Clock.class)
    Clock uploadClock() { return Clock.systemUTC(); }

    @Bean @ConditionalOnMissingBean(StoragePort.class)
    @ConditionalOnProperty(name = "app.upload.s3-enabled", havingValue = "false", matchIfMissing = true)
    StoragePort unavailableStorage() {
        return new StoragePort() {
            public SignedRequest presignPut(PutSpec spec) { throw new Unavailable(); }
            public Optional<VersionHead> headVersion(ObjectRef ref) { throw new Unavailable(); }
            public Optional<byte[]> readChecksum(ObjectRef ref) { throw new Unavailable(); }
            public SignedRequest presignGet(ObjectRef ref, Instant until) { throw new Unavailable(); }
        };
    }
}
