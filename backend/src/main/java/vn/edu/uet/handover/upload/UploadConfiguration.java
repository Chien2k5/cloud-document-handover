package vn.edu.uet.handover.upload;

import java.time.Clock;
import java.time.Instant;
import java.util.Optional;
import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.EnableScheduling;

@Configuration
@EnableScheduling
public class UploadConfiguration {
    @Bean @ConditionalOnMissingBean(Clock.class)
    Clock uploadClock() { return Clock.systemUTC(); }

    // Fail closed until the team's real adapter is supplied. Never serve fake URLs in the app.
    @Bean @ConditionalOnMissingBean(StoragePort.class)
    StoragePort unavailableStorage() {
        return new StoragePort() {
            public SignedRequest presignPut(PutSpec spec) { throw new Unavailable(); }
            public Optional<VersionHead> headVersion(ObjectRef ref) { throw new Unavailable(); }
            public Optional<byte[]> readChecksum(ObjectRef ref) { throw new Unavailable(); }
            public SignedRequest presignGet(ObjectRef ref, Instant until) { throw new Unavailable(); }
        };
    }
}
