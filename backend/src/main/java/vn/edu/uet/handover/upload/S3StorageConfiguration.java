package vn.edu.uet.handover.upload;

import java.time.Clock;
import java.time.Duration;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import software.amazon.awssdk.http.apache.ApacheHttpClient;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.presigner.S3Presigner;

@Configuration(proxyBeanMethods = false)
@ConditionalOnProperty(name = "app.upload.s3-enabled", havingValue = "true")
class S3StorageConfiguration {
    @Bean
    Region uploadRegion(@Value("${app.upload.s3-region}") String region,
                        @Value("${app.upload.bucket}") String bucket) {
        if (region.isBlank() || bucket.isBlank()) {
            throw new IllegalStateException("AWS_REGION and UPLOAD_BUCKET are required for S3");
        }
        return Region.of(region);
    }

    @Bean(destroyMethod = "close")
    S3Client uploadS3Client(Region region) {
        return S3Client.builder().region(region)
                .httpClientBuilder(ApacheHttpClient.builder().socketTimeout(Duration.ofSeconds(3)))
                .overrideConfiguration(config -> config
                        .apiCallTimeout(Duration.ofSeconds(8))
                        .apiCallAttemptTimeout(Duration.ofSeconds(3)))
                .build();
    }

    @Bean(destroyMethod = "close")
    S3Presigner uploadPresigner(Region region) {
        return S3Presigner.builder().region(region).build();
    }

    @Bean
    StoragePort s3Storage(S3Client client, S3Presigner presigner, Clock clock) {
        return new S3StorageAdapter(client, presigner, clock);
    }
}
